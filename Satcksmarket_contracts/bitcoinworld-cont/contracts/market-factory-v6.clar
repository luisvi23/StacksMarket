;; ------------------------------------------------------------
;; market-factory-v6 (Fixed-b LMSR + fixed-per-share redemption + SELL)
;; - True LMSR pricing with fixed b per market (never recomputed).
;; - Numerically stable log-sum-exp centering in cost function.
;; - Redemption is fixed-per-share: payout = shares * UNIT.
;; - Pool invariant (informational): pool = seed + SUM(AC_buys) - SUM(AC_sells) - SUM(payouts).
;; - External dependency: .sbtc-v3::transfer(uint principal principal)
;; - ensure-user-balance pre-check for wallet balance.
;; - BUY + SELL paths with protocol + LP fees (fees always paid by the trader).
;; ------------------------------------------------------------

(define-constant ADMIN 'ST1PSHE32YTEE21FGYEVTA24N681KRGSQM4VF9XZP)

;; ------------------------- global fee config -------------------------
(define-data-var protocol-fee-bps uint u0)
(define-data-var lp-fee-bps       uint u0)

;; protocol split must sum to 100 (drip + brc + team = 100)
(define-data-var pct-drip uint u50)
(define-data-var pct-brc  uint u30)
(define-data-var pct-team uint u20)

;; fee recipients (default ADMIN until configured)
(define-data-var DRIP_VAULT principal ADMIN)
(define-data-var BRC20_VAULT principal ADMIN)
(define-data-var TEAM_WALLET principal ADMIN)
(define-data-var LP_WALLET   principal ADMIN)

(define-data-var fees-locked bool false)

;; contract principal capture (set once)
(define-data-var SELF principal ADMIN)

;; --------------------------- per-market state ------------------------
(define-map m-status      { m: uint } { s: (string-ascii 10) })  ;; "open" | "resolved"
(define-map m-outcome     { m: uint } { o: (string-ascii 3) })   ;; "" | "YES" | "NO"
(define-map m-initialized { m: uint } { v: bool })
(define-map m-paused      { m: uint } { v: bool })
(define-map m-max-trade   { m: uint } { v: uint })

;; LMSR state
(define-map m-q-yes { m: uint } { q: uint })
(define-map m-q-no  { m: uint } { q: uint })
(define-map m-pool  { m: uint } { p: uint })
(define-map m-b     { m: uint } { b: uint })

;; user caps and spent (per market)
(define-map user-caps  { m: uint, user: principal } { cap: uint })
(define-map user-spent { m: uint, user: principal } { spent: uint })

;; YES/NO ledgers (per market)
(define-map yes-holdings { m: uint, user: principal } { bal: uint })
(define-map no-holdings  { m: uint, user: principal } { bal: uint })
(define-map yes-supply   { m: uint } { s: uint })
(define-map no-supply    { m: uint } { s: uint })

;; ------------------------------ errors -------------------------------
(define-constant ERR-ONLY-ADMIN (err u706))
(define-constant ERR-PAUSED      (err u720))
(define-constant ERR-NOT-OPEN    (err u100))
(define-constant ERR-NOT-INIT    (err u721))
(define-constant ERR-B-ZERO      (err u703))
(define-constant ERR-AMOUNT      (err u704))
(define-constant ERR-SLIPPAGE    (err u732))
(define-constant ERR-INSOLVENT-RESOLVE (err u712))

;; wallet / token errors
(define-constant ERR-NO-WALLET-BAL (err u760))  ;; user does not have enough sBTC for TOTAL
(define-constant ERR-TOKEN-READ    (err u761))  ;; could not read token balance (sbtc-v3 get-balance)

;; SELL-specific errors
(define-constant ERR-NO-SHARES        (err u770)) ;; user has not enough YES/NO shares
(define-constant ERR-POOL-LIQUIDITY   (err u771)) ;; pool has not enough liquidity to pay refund
(define-constant ERR-BAD-REFUND       (err u772)) ;; internal: negative/zero refund where it shouldn't

;; -------------------------- math constants --------------------------
(define-constant SCALE u1000000)                  ;; 6-decimal fixed point
(define-constant SCALE-INT (to-int SCALE))
(define-constant LN2-SCALED (to-int u693147))     ;; approx ln(2) * 1e6
(define-constant i2 (to-int u2))
(define-constant i3 (to-int u3))
(define-constant i6 (to-int u6))

;; UNIT = 1 => 1 share ganadora paga 1 satoshi de sBTC.
(define-constant UNIT u1)

;; ---------------------------- utilities -----------------------------
(define-private (only-admin)
  (begin (asserts! (is-eq tx-sender ADMIN) ERR-ONLY-ADMIN) (ok true))
)

(define-private (guard-not-locked)
  (if (is-eq (var-get fees-locked) false) (ok true) (err u743))
)

(define-private (ceil-div (n uint) (d uint))
  (/ (+ n (- d u1)) d)
)

(define-private (ceil-bps (amount uint) (bps uint))
  (ceil-div (* amount bps) u10000)
)

;; read balance and assert it covers `need`
(define-private (ensure-user-balance (need uint))
  (let (
    (bal (unwrap! (contract-call? .sbtc-v3 get-balance tx-sender) ERR-TOKEN-READ))
  )
    (print { ev: "wallet-balance", who: tx-sender, bal: bal, need: need })
    (asserts! (>= bal need) ERR-NO-WALLET-BAL)
    (ok true)
  )
)

;; ---------------------- per-market getters --------------------------
(define-private (get-b-or0 (m uint))
  (default-to u0 (get b (map-get? m-b { m: m })))
)

(define-private (get-pool-or0 (m uint))
  (default-to u0 (get p (map-get? m-pool { m: m })))
)

(define-private (get-qy-or0 (m uint))
  (default-to u0 (get q (map-get? m-q-yes { m: m })))
)

(define-private (get-qn-or0 (m uint))
  (default-to u0 (get q (map-get? m-q-no { m: m })))
)

(define-private (get-status-str (m uint))
  (default-to "open" (get s (map-get? m-status { m: m })))
)

(define-private (get-paused (m uint))
  (default-to false (get v (map-get? m-paused { m: m })))
)

(define-private (get-initialized-bool (m uint))
  (default-to false (get v (map-get? m-initialized { m: m })))
)

(define-private (get-max-trade-or0 (m uint))
  (default-to u0 (get v (map-get? m-max-trade { m: m })))
)

;; ---------------------------- fixed-point ---------------------------
(define-private (exp-fixed (x int))
  (let ((x2 (/ (* x x) SCALE-INT))
        (x3 (/ (* x2 x) SCALE-INT)))
    (+ SCALE-INT (+ x (+ (/ x2 i2) (/ x3 i6))))
  )
)

(define-private (ln-fixed (y int))
  (let ((z  (- y SCALE-INT))
        (z2 (/ (* z z) SCALE-INT))
        (z3 (/ (* z2 z) SCALE-INT)))
    (+ z (- (/ z2 i2)) (/ z3 i3))
  )
)

;; LMSR cost with recentering: ln(exp(a)+exp(b)) = ln(2) + ln((exp(a)+exp(b))/2)
(define-private (cost-fn (b uint) (qY uint) (qN uint))
  (let (
        (B-INT (to-int b))
        (bpos  (> b u0))
        (qYsc  (if bpos (/ (* (to-int qY) SCALE-INT) B-INT) 0))
        (qNsc  (if bpos (/ (* (to-int qN) SCALE-INT) B-INT) 0))
        (t1    (exp-fixed qYsc))
        (t2    (exp-fixed qNsc))
        (sum   (+ t1 t2))
        (half  (/ sum i2))
        (lnsum (+ LN2-SCALED (ln-fixed half)))
       )
    (if bpos (/ (* B-INT lnsum) SCALE-INT) 0)
  )
)

(define-private (calculate-cost (b uint) (qY uint) (qN uint) (amt uint) (yes? bool))
  (let ((base (cost-fn b qY qN))
        (new  (if yes? (cost-fn b (+ qY amt) qN) (cost-fn b qY (+ qN amt))))
        (diff (- new base)))
    (if (> (to-int amt) 0)
        (if (> diff 0)
            (let ((u (to-uint diff))) (if (> u u0) u u1))
            u1)
        u0)
  )
)

;; ---------------------- fixed b: init once --------------------------
(define-private (init-b (m uint) (initial-liquidity uint))
  (begin
    (let (
      (num (* (to-int initial-liquidity) SCALE-INT))
      ;; b = seed / ln(2)
      (den LN2-SCALED)
    )
      (map-set m-b { m: m } { b: (to-uint (/ num den)) })
    )
    true
  )
)


;; kept for compatibility; no-op
(define-private (recompute-b (m uint)) true)

;; ------------------------ caps and spent helpers --------------------
(define-read-only (get-cap (m uint) (who principal))
  (default-to u0 (get cap (map-get? user-caps { m: m, user: who })))
)

(define-read-only (get-spent (m uint) (who principal))
  (default-to u0 (get spent (map-get? user-spent { m: m, user: who })))
)

(define-private (bump-cap-if-needed (m uint) (who principal) (target-cap uint))
  (let ((cur (default-to u0 (get cap (map-get? user-caps { m: m, user: who })))) )
    (if (> target-cap cur)
        (begin (map-set user-caps { m: m, user: who } { cap: target-cap }) true)
        true)
  )
)

(define-private (add-spent (m uint) (who principal) (delta uint))
  (let ((cur (default-to u0 (get spent (map-get? user-spent { m: m, user: who })) ))
        (nw  (+ cur delta)))
    (begin (map-set user-spent { m: m, user: who } { spent: nw }) true)
  )
)

;; ----------------------------- guards --------------------------------
(define-private (ensure-open (m uint))
  (begin
    (asserts! (is-eq (get-status-str m) "open") (err u100))
    (asserts! (is-eq (get-paused m) false) ERR-PAUSED)
    (asserts! (is-eq (get-initialized-bool m) true) ERR-NOT-INIT)
    (ok true)
  )
)

(define-private (check-trade-limit (m uint) (amount uint))
  (let ((mt (get-max-trade-or0 m)))
    (if (and (> mt u0) (> amount mt)) (err u722) (ok true))
  )
)

;; -------------------------- yes/no ledgers ---------------------------
(define-read-only (get-yes-balance (m uint) (who principal))
  (default-to u0 (get bal (map-get? yes-holdings { m: m, user: who })))
)

(define-read-only (get-no-balance (m uint) (who principal))
  (default-to u0 (get bal (map-get? no-holdings { m: m, user: who })))
)

(define-read-only (get-yes-supply (m uint))
  (default-to u0 (get s (map-get? yes-supply { m: m })))
)

(define-read-only (get-no-supply (m uint))
  (default-to u0 (get s (map-get? no-supply { m: m })))
)

(define-private (mint-yes (m uint) (to principal) (amt uint))
  (let (
    (cur (default-to u0 (get bal (map-get? yes-holdings { m: m, user: to })) ))
    (sup (default-to u0 (get s   (map-get? yes-supply   { m: m })) ))
  )
    (map-set yes-holdings { m: m, user: to } { bal: (+ cur amt) })
    (map-set yes-supply   { m: m }            { s:   (+ sup amt) })
    true
  )
)

(define-private (mint-no (m uint) (to principal) (amt uint))
  (let (
    (cur (default-to u0 (get bal (map-get? no-holdings { m: m, user: to })) ))
    (sup (default-to u0 (get s   (map-get? no-supply   { m: m })) ))
  )
    (map-set no-holdings { m: m, user: to } { bal: (+ cur amt) })
    (map-set no-supply   { m: m }            { s:   (+ sup amt) })
    true
  )
)

(define-private (burn-yes-all (m uint) (from principal))
  (let (
    (bal (default-to u0 (get bal (map-get? yes-holdings { m: m, user: from })) ))
    (sup (default-to u0 (get s   (map-get? yes-supply   { m: m })) ))
  )
    (begin
      (asserts! (> bal u0) (err u105))
      (map-set yes-holdings { m: m, user: from } { bal: u0 })
      (map-set yes-supply   { m: m }             { s: (- sup bal) })
      (ok bal)
    )
  )
)

(define-private (burn-no-all (m uint) (from principal))
  (let (
    (bal (default-to u0 (get bal (map-get? no-holdings { m: m, user: from })) ))
    (sup (default-to u0 (get s   (map-get? no-supply   { m: m })) ))
  )
    (begin
      (asserts! (> bal u0) (err u105))
      (map-set no-holdings { m: m, user: from } { bal: u0 })
      (map-set no-supply   { m: m }             { s: (- sup bal) })
      (ok bal)
    )
  )
)

;; --------------------------- admin controls --------------------------
(define-public (set-fees (protocol-bps uint) (lp-bps uint))
  (begin
    (try! (only-admin))
    (try! (guard-not-locked))
    (asserts! (<= protocol-bps u10000) (err u740))
    (asserts! (<= lp-bps       u10000) (err u741))
    (var-set protocol-fee-bps protocol-bps)
    (var-set lp-fee-bps       lp-bps)
    (ok true)
  )
)

(define-public (set-fee-recipients (drip principal) (brc principal) (team principal) (lp principal))
  (begin
    (try! (only-admin))
    (try! (guard-not-locked))
    (var-set DRIP_VAULT drip)
    (var-set BRC20_VAULT brc)
    (var-set TEAM_WALLET team)
    (var-set LP_WALLET   lp)
    (ok true)
  )
)

(define-public (set-protocol-split (pdrip uint) (pbrc uint) (pteam uint))
  (begin
    (try! (only-admin))
    (try! (guard-not-locked))
    (asserts! (is-eq (+ pdrip (+ pbrc pteam)) u100) (err u742))
    (var-set pct-drip pdrip)
    (var-set pct-brc  pbrc)
    (var-set pct-team pteam)
    (ok true)
  )
)

(define-public (lock-fees-config)
  (begin (try! (only-admin)) (var-set fees-locked true) (ok true))
)

(define-public (pause (m uint))
  (begin (try! (only-admin)) (map-set m-paused { m: m } { v: true }) (ok true))
)

(define-public (unpause (m uint))
  (begin (try! (only-admin)) (map-set m-paused { m: m } { v: false }) (ok true))
)

(define-public (set-max-trade (m uint) (limit uint))
  (begin (try! (only-admin)) (map-set m-max-trade { m: m } { v: limit }) (ok true))
)

;; -------------------------- create and liquidity ---------------------
(define-public (create-market (m uint) (initial-liquidity uint))
  (begin
    (try! (only-admin))
    (asserts! (is-eq (get-initialized-bool m) false) (err u700))
    (asserts! (> initial-liquidity u0) (err u701))

    (as-contract (var-set SELF tx-sender))

    ;; ADMIN -> CONTRACT
    (try! (contract-call? .sbtc-v3 transfer initial-liquidity tx-sender (var-get SELF)))

    ;; set state
    (map-set m-status      { m: m } { s: "open" })
    (map-set m-outcome     { m: m } { o: "" })
    (map-set m-initialized { m: m } { v: true })
    (map-set m-paused      { m: m } { v: false })
    (map-set m-max-trade   { m: m } { v: u0 })
    (map-set m-q-yes       { m: m } { q: u0 })
    (map-set m-q-no        { m: m } { q: u0 })
    (map-set m-pool        { m: m } { p: initial-liquidity })
    (map-set yes-supply    { m: m } { s: u0 })
    (map-set no-supply     { m: m } { s: u0 })

    ;; fixed b (derived from seed); never changed later
    (init-b m initial-liquidity)

    (ok (get-b-or0 m))
  )
)

(define-public (add-liquidity (m uint) (amount uint))
  (begin
    (try! (only-admin))
    (asserts! (is-eq (get-initialized-bool m) true) ERR-NOT-INIT)
    (asserts! (> amount u0) (err u702))
    ;; disabled when resolved, but allowed while paused
    (asserts! (is-eq (get-status-str m) "open") ERR-NOT-OPEN)

    ;; ADMIN -> CONTRACT
    (try! (contract-call? .sbtc-v3 transfer amount tx-sender (var-get SELF)))
    (let ((p (+ (get-pool-or0 m) amount)))
      (map-set m-pool { m: m } { p: p })
      (ok (get-b-or0 m))
    )
  )
)

;; --------------------------- BUY helpers -----------------------------
(define-private (do-buy (m uint) (amount uint) (yes? bool))
  (begin
    (try! (ensure-open m))
    (try! (check-trade-limit m amount))
    (asserts! (> (get-b-or0 m) u0) ERR-B-ZERO)
    (asserts! (> amount u0) ERR-AMOUNT)

    (let (
      (b   (get-b-or0 m))
      (qy  (get-qy-or0 m))
      (qn  (get-qn-or0 m))
      (c0  (calculate-cost b qy qn amount yes?))
      (pB  (var-get protocol-fee-bps))
      (lB  (var-get lp-fee-bps))
    )
      (let (
        (base (if (> c0 u0) c0 u1))
        (feeP (ceil-bps base pB))
        (feeL (ceil-bps base lB))
        (drip (/ (* feeP (var-get pct-drip)) u100))
        (brc  (/ (* feeP (var-get pct-brc))  u100))
        (team (- feeP (+ drip brc)))
        (total (+ base (+ feeP feeL)))
      )
        (print { ev: "pre-buy", m: m, side: (if yes? "YES" "NO"), amount: amount, base: base, feeP: feeP, feeL: feeL, total: total })
        (try! (ensure-user-balance total))

        (let (
          (cap   (default-to u0 (get cap (map-get? user-caps { m: m, user: tx-sender })) ))
          (spent (default-to u0 (get spent (map-get? user-spent { m: m, user: tx-sender })) ))
        )
          (asserts! (> cap u0) (err u730))
          (asserts! (<= (+ spent total) cap) (err u731))

          ;; USER -> CONTRACT (base only)
          (try! (contract-call? .sbtc-v3 transfer base tx-sender (var-get SELF)))

          ;; protocol fees: USER -> recipients
          (if (> feeP u0)
            (begin
              (if (> drip u0) (try! (contract-call? .sbtc-v3 transfer drip tx-sender (var-get DRIP_VAULT))) true)
              (if (> brc  u0) (try! (contract-call? .sbtc-v3 transfer brc  tx-sender (var-get BRC20_VAULT))) true)
              (if (> team u0) (try! (contract-call? .sbtc-v3 transfer team tx-sender (var-get TEAM_WALLET))) true)
              true
            )
            true
          )

          ;; LP fee
          (if (> feeL u0)
            (try! (contract-call? .sbtc-v3 transfer feeL tx-sender (var-get LP_WALLET)))
            true
          )

          ;; mint
          (if yes?
            (begin
              (mint-yes m tx-sender amount)
              (map-set m-q-yes { m: m } { q: (+ qy amount) })
            )
            (begin
              (mint-no m tx-sender amount)
              (map-set m-q-no { m: m } { q: (+ qn amount) })
            )
          )

          ;; update pool (base enters the pool)
          (map-set m-pool { m: m } { p: (+ (get-pool-or0 m) base) })

          ;; track spent (base + fees)
          (add-spent m tx-sender total)
          (ok amount)
        )
      )
    )
  )
)

(define-public (buy-yes (m uint) (amount uint))
  (do-buy m amount true)
)

(define-public (buy-no (m uint) (amount uint))
  (do-buy m amount false)
)

(define-public (buy-yes-auto (m uint) (amount uint) (target-cap uint) (max-cost uint))
  (begin
    (try! (ensure-open m))
    (try! (check-trade-limit m amount))
    (asserts! (> (get-b-or0 m) u0) ERR-B-ZERO)
    (asserts! (> amount u0) ERR-AMOUNT)
    (asserts! (> max-cost u0) ERR-SLIPPAGE)
    (bump-cap-if-needed m tx-sender target-cap)

    (let (
      (b   (get-b-or0 m))
      (qy  (get-qy-or0 m))
      (qn  (get-qn-or0 m))
      (c0  (calculate-cost b qy qn amount true))
      (pB  (var-get protocol-fee-bps))
      (lB  (var-get lp-fee-bps))
    )
      (let (
        (base (if (> c0 u0) c0 u1))
        (feeP (ceil-bps base pB))
        (feeL (ceil-bps base lB))
        (drip (/ (* feeP (var-get pct-drip)) u100))
        (brc  (/ (* feeP (var-get pct-brc))  u100))
        (team (- feeP (+ drip brc)))
        (total (+ base (+ feeP feeL)))
      )
        (asserts! (<= total max-cost) ERR-SLIPPAGE)

        (print { ev: "pre-buy-auto", m: m, side: "YES", amount: amount, base: base, feeP: feeP, feeL: feeL, total: total, maxCost: max-cost })
        (try! (ensure-user-balance total))

        (let (
          (cap   (default-to u0 (get cap (map-get? user-caps { m: m, user: tx-sender })) ))
          (spent (default-to u0 (get spent (map-get? user-spent { m: m, user: tx-sender })) ))
        )
          (asserts! (> cap u0) (err u730))
          (asserts! (<= (+ spent total) cap) (err u731))

          ;; USER -> CONTRACT
          (try! (contract-call? .sbtc-v3 transfer base tx-sender (var-get SELF)))

          ;; protocol fees
          (if (> feeP u0)
            (begin
              (if (> drip u0) (try! (contract-call? .sbtc-v3 transfer drip tx-sender (var-get DRIP_VAULT))) true)
              (if (> brc  u0) (try! (contract-call? .sbtc-v3 transfer brc  tx-sender (var-get BRC20_VAULT))) true)
              (if (> team u0) (try! (contract-call? .sbtc-v3 transfer team tx-sender (var-get TEAM_WALLET))) true)
              true
            )
            true
          )

          ;; LP fee
          (if (> feeL u0)
            (try! (contract-call? .sbtc-v3 transfer feeL tx-sender (var-get LP_WALLET)))
            true
          )

          ;; mint YES
          (mint-yes m tx-sender amount)
          (map-set m-q-yes { m: m } { q: (+ (get-qy-or0 m) amount) })

          ;; update pool
          (map-set m-pool { m: m } { p: (+ (get-pool-or0 m) base) })

          ;; track spent
          (add-spent m tx-sender total)
          (ok amount)
        )
      )
    )
  )
)

(define-public (buy-no-auto (m uint) (amount uint) (target-cap uint) (max-cost uint))
  (begin
    (try! (ensure-open m))
    (try! (check-trade-limit m amount))
    (asserts! (> (get-b-or0 m) u0) ERR-B-ZERO)
    (asserts! (> amount u0) ERR-AMOUNT)
    (asserts! (> max-cost u0) ERR-SLIPPAGE)
    (bump-cap-if-needed m tx-sender target-cap)

    (let (
      (b   (get-b-or0 m))
      (qy  (get-qy-or0 m))
      (qn  (get-qn-or0 m))
      (c0  (calculate-cost b qy qn amount false))
      (pB  (var-get protocol-fee-bps))
      (lB  (var-get lp-fee-bps))
    )
      (let (
        (base (if (> c0 u0) c0 u1))
        (feeP (ceil-bps base pB))
        (feeL (ceil-bps base lB))
        (drip (/ (* feeP (var-get pct-drip)) u100))
        (brc  (/ (* feeP (var-get pct-brc))  u100))
        (team (- feeP (+ drip brc)))
        (total (+ base (+ feeP feeL)))
      )
        (asserts! (<= total max-cost) ERR-SLIPPAGE)

        (print { ev: "pre-buy-auto", m: m, side: "NO", amount: amount, base: base, feeP: feeP, feeL: feeL, total: total, maxCost: max-cost })
        (try! (ensure-user-balance total))

        (let (
          (cap   (default-to u0 (get cap (map-get? user-caps { m: m, user: tx-sender })) ))
          (spent (default-to u0 (get spent (map-get? user-spent { m: m, user: tx-sender })) ))
        )
          (asserts! (> cap u0) (err u730))
          (asserts! (<= (+ spent total) cap) (err u731))

          ;; USER -> CONTRACT
          (try! (contract-call? .sbtc-v3 transfer base tx-sender (var-get SELF)))

          ;; protocol fees
          (if (> feeP u0)
            (begin
              (if (> drip u0) (try! (contract-call? .sbtc-v3 transfer drip tx-sender (var-get DRIP_VAULT))) true)
              (if (> brc  u0) (try! (contract-call? .sbtc-v3 transfer brc  tx-sender (var-get BRC20_VAULT))) true)
              (if (> team u0) (try! (contract-call? .sbtc-v3 transfer team tx-sender (var-get TEAM_WALLET))) true)
              true
            )
            true
          )

          ;; LP fee
          (if (> feeL u0)
            (try! (contract-call? .sbtc-v3 transfer feeL tx-sender (var-get LP_WALLET)))
            true
          )

          ;; mint NO
          (mint-no m tx-sender amount)
          (map-set m-q-no { m: m } { q: (+ (get-qn-or0 m) amount) })

          ;; update pool
          (map-set m-pool { m: m } { p: (+ (get-pool-or0 m) base) })

          ;; track spent
          (add-spent m tx-sender total)
          (ok amount)
        )
      )
    )
  )
)

;; --------------------------- SELL helpers ----------------------------
(define-private (do-sell (m uint) (amount uint) (yes? bool))
  (begin
    (try! (ensure-open m))
    (try! (check-trade-limit m amount))
    (asserts! (> (get-b-or0 m) u0) ERR-B-ZERO)
    (asserts! (> amount u0) ERR-AMOUNT)

    (let (
      (b    (get-b-or0 m))
      (qy   (get-qy-or0 m))
      (qn   (get-qn-or0 m))
      (pool (get-pool-or0 m))
      (user tx-sender) ;;  capturamos el usuario original
    )
      (let (
        (user-bal (if yes?
                      (default-to u0 (get bal (map-get? yes-holdings { m: m, user: user })))
                      (default-to u0 (get bal (map-get? no-holdings  { m: m, user: user })))))
        (curQ (if yes? qy qn))
      )
        (asserts! (>= user-bal amount) ERR-NO-SHARES)
        (asserts! (>= curQ amount) ERR-NO-SHARES)

        (let (
          (newQY (if yes? (- qy amount) qy))
          (newQN (if yes? qn (- qn amount)))
        )
          (let (
            (c0   (cost-fn b qy qn))
            (c1   (cost-fn b newQY newQN))
            (diff (- c0 c1))
          )
            (asserts! (> diff 0) ERR-BAD-REFUND)
            (let (
              (base (to-uint diff))
              (pB   (var-get protocol-fee-bps))
              (lB   (var-get lp-fee-bps))
              (feeP (ceil-bps base pB))
              (feeL (ceil-bps base lB))
              (drip (/ (* feeP (var-get pct-drip)) u100))
              (brc  (/ (* feeP (var-get pct-brc))  u100))
              (team (- feeP (+ drip brc)))
              (totalFees (+ feeP feeL))
            )
              (asserts! (>= pool base) ERR-POOL-LIQUIDITY)

              ;; fees: USER -> recipients / LP
              (if (> totalFees u0)
                (begin
                  (print { ev: "pre-sell", m: m, side: (if yes? "YES" "NO"), amount: amount, base: base, feeP: feeP, feeL: feeL })
                  (try! (ensure-user-balance totalFees))

                  ;; protocol fees
                  (if (> feeP u0)
                    (begin
                      (if (> drip u0) (try! (contract-call? .sbtc-v3 transfer drip user (var-get DRIP_VAULT))) true)
                      (if (> brc  u0) (try! (contract-call? .sbtc-v3 transfer brc  user (var-get BRC20_VAULT))) true)
                      (if (> team u0) (try! (contract-call? .sbtc-v3 transfer team user (var-get TEAM_WALLET))) true)
                      true
                    )
                    true
                  )

                  ;; LP fee
                  (if (> feeL u0)
                    (try! (contract-call? .sbtc-v3 transfer feeL user (var-get LP_WALLET)))
                    true
                  )
                )
                true
              )

              ;; burn partial YES/NO + update supplies and q's
              (if yes?
                (let (
                  (sup (default-to u0 (get s (map-get? yes-supply { m: m }))))
                )
                  (asserts! (>= sup amount) ERR-POOL-LIQUIDITY)
                  (map-set yes-holdings { m: m, user: user } { bal: (- user-bal amount) })
                  (map-set yes-supply   { m: m } { s: (- sup amount) })
                  (map-set m-q-yes      { m: m } { q: newQY })
                  true
                )
                (let (
                  (sup (default-to u0 (get s (map-get? no-supply { m: m }))))
                )
                  (asserts! (>= sup amount) ERR-POOL-LIQUIDITY)
                  (map-set no-holdings { m: m, user: user } { bal: (- user-bal amount) })
                  (map-set no-supply   { m: m } { s: (- sup amount) })
                  (map-set m-q-no      { m: m } { q: newQN })
                  true
                )
              )

              ;; pool -> USER (base)
              ;; ahora SELF -> user, no SELF -> SELF
              (as-contract
                (try! (contract-call? .sbtc-v3 transfer base (var-get SELF) user)))
              (map-set m-pool { m: m } { p: (- pool base) })

              ;; Nota: no tocamos user-spent: las ventas no incrementan "spent"
              (ok amount)
            )
          )
        )
      )
    )
  )
)

;; AUTO SELL with slippage protection on net proceeds (base - fees)
(define-private (do-sell-auto (m uint) (amount uint) (yes? bool) (min-proceeds uint))
  (begin
    (try! (ensure-open m))
    (try! (check-trade-limit m amount))
    (asserts! (> (get-b-or0 m) u0) ERR-B-ZERO)
    (asserts! (> amount u0) ERR-AMOUNT)
    (asserts! (> min-proceeds u0) ERR-SLIPPAGE)

    (let (
      (b    (get-b-or0 m))
      (qy   (get-qy-or0 m))
      (qn   (get-qn-or0 m))
      (pool (get-pool-or0 m))
      (user tx-sender) ;; capturamos usuario original
    )
      (let (
        (user-bal (if yes?
                      (default-to u0 (get bal (map-get? yes-holdings { m: m, user: user })))
                      (default-to u0 (get bal (map-get? no-holdings  { m: m, user: user })))))
        (curQ (if yes? qy qn))
      )
        (asserts! (>= user-bal amount) ERR-NO-SHARES)
        (asserts! (>= curQ amount) ERR-NO-SHARES)

        (let (
          (newQY (if yes? (- qy amount) qy))
          (newQN (if yes? qn (- qn amount)))
        )
          (let (
            (c0   (cost-fn b qy qn))
            (c1   (cost-fn b newQY newQN))
            (diff (- c0 c1))
          )
            (asserts! (> diff 0) ERR-BAD-REFUND)
            (let (
              (base (to-uint diff))
              (pB   (var-get protocol-fee-bps))
              (lB   (var-get lp-fee-bps))
              (feeP (ceil-bps base pB))
              (feeL (ceil-bps base lB))
              (drip (/ (* feeP (var-get pct-drip)) u100))
              (brc  (/ (* feeP (var-get pct-brc))  u100))
              (team (- feeP (+ drip brc)))
              (totalFees (+ feeP feeL))
              (net (if (> base totalFees) (- base totalFees) u0))
            )
              (asserts! (>= pool base) ERR-POOL-LIQUIDITY)
              ;; slippage guard on net proceeds to user
              (asserts! (>= net min-proceeds) ERR-SLIPPAGE)

              ;; fees: USER -> recipients / LP
              (if (> totalFees u0)
                (begin
                  (print { ev: "pre-sell-auto", m: m, side: (if yes? "YES" "NO"), amount: amount, base: base, feeP: feeP, feeL: feeL, net: net, minProceeds: min-proceeds })
                  (try! (ensure-user-balance totalFees))

                  ;; protocol fees
                  (if (> feeP u0)
                    (begin
                      (if (> drip u0) (try! (contract-call? .sbtc-v3 transfer drip user (var-get DRIP_VAULT))) true)
                      (if (> brc  u0) (try! (contract-call? .sbtc-v3 transfer brc  user (var-get BRC20_VAULT))) true)
                      (if (> team u0) (try! (contract-call? .sbtc-v3 transfer team user (var-get TEAM_WALLET))) true)
                      true
                    )
                    true
                  )

                  ;; LP fee
                  (if (> feeL u0)
                    (try! (contract-call? .sbtc-v3 transfer feeL user (var-get LP_WALLET)))
                    true
                  )
                )
                true
              )

              ;; burn partial YES/NO + update supplies and q's
              (if yes?
                (let (
                  (sup (default-to u0 (get s (map-get? yes-supply { m: m }))))
                )
                  (asserts! (>= sup amount) ERR-POOL-LIQUIDITY)
                  (map-set yes-holdings { m: m, user: user } { bal: (- user-bal amount) })
                  (map-set yes-supply   { m: m } { s: (- sup amount) })
                  (map-set m-q-yes      { m: m } { q: newQY })
                  true
                )
                (let (
                  (sup (default-to u0 (get s (map-get? no-supply { m: m }))))
                )
                  (asserts! (>= sup amount) ERR-POOL-LIQUIDITY)
                  (map-set no-holdings { m: m, user: user } { bal: (- user-bal amount) })
                  (map-set no-supply   { m: m } { s: (- sup amount) })
                  (map-set m-q-no      { m: m } { q: newQN })
                  true
                )
              )

              ;; pool -> USER (base)
              (as-contract
                (try! (contract-call? .sbtc-v3 transfer base (var-get SELF) user)))
              (map-set m-pool { m: m } { p: (- pool base) })

              ;; igual que en do-sell, no tocamos user-spent
              (ok amount)
            )
          )
        )
      )
    )
  )
)

(define-public (sell-yes (m uint) (amount uint))
  (do-sell m amount true)
)

(define-public (sell-no (m uint) (amount uint))
  (do-sell m amount false)
)

(define-public (sell-yes-auto (m uint) (amount uint) (min-proceeds uint))
  (do-sell-auto m amount true min-proceeds)
)

(define-public (sell-no-auto (m uint) (amount uint) (min-proceeds uint))
  (do-sell-auto m amount false min-proceeds)
)

;; --------------------------- resolve & redeem ------------------------
(define-public (resolve (m uint) (result (string-ascii 3)))
  (begin
    (try! (only-admin))
    (asserts! (is-eq (get-status-str m) "open") (err u102))
    (asserts! (or (is-eq result "YES") (is-eq result "NO")) (err u103))

    ;; On-chain solvency check: pool >= totalWinningShares * UNIT
    (let (
      (ys (default-to u0 (get s (map-get? yes-supply { m: m })) ))
      (ns (default-to u0 (get s (map-get? no-supply  { m: m }))  ))
      (p  (get-pool-or0 m))
      (req (if (is-eq result "YES") (* ys UNIT) (* ns UNIT)))
    )
      (asserts! (>= p req) ERR-INSOLVENT-RESOLVE)
      (map-set m-outcome { m: m } { o: result })
      (map-set m-status  { m: m } { s: "resolved" })
      (ok true)
    )
  )
)

;; REDEEM fixed-per-share (UNIT per share)
(define-public (redeem (m uint))
  (begin
    (asserts! (is-eq (get-status-str m) "resolved") (err u104))
    (let ((out (default-to "" (get o (map-get? m-outcome { m: m })))) )
      (if (is-eq out "YES") (redeem-yes m) (redeem-no m))
    )
  )
)

(define-private (redeem-yes (m uint))
  (let (
    (balance (default-to u0 (get bal (map-get? yes-holdings { m: m, user: tx-sender })) ))
    (payout  (* balance UNIT))
    (p       (get-pool-or0 m))
    (rcpt    tx-sender)
  )
    (asserts! (> balance u0) (err u105))
    (asserts! (>= p payout) (err u2))
    (try! (burn-yes-all m tx-sender))
    (as-contract (try! (contract-call? .sbtc-v3 transfer payout tx-sender rcpt)))
    (map-set m-pool { m: m } { p: (- p payout) })
    (ok payout)
  )
)

(define-private (redeem-no (m uint))
  (let (
    (balance (default-to u0 (get bal (map-get? no-holdings { m: m, user: tx-sender })) ))
    (payout  (* balance UNIT))
    (p       (get-pool-or0 m))
    (rcpt    tx-sender)
  )
    (asserts! (> balance u0) (err u105))
    (asserts! (>= p payout) (err u2))
    (try! (burn-no-all m tx-sender))
    (as-contract (try! (contract-call? .sbtc-v3 transfer payout tx-sender rcpt)))
    (map-set m-pool { m: m } { p: (- p payout) })
    (ok payout)
  )
)

;; --------------------------- withdraw surplus -----------------------
(define-public (withdraw-surplus (m uint))
  (let (
    (ys (default-to u0 (get s (map-get? yes-supply { m: m })) ))
    (ns (default-to u0 (get s (map-get? no-supply  { m: m }))  ))
    (p  (get-pool-or0 m))
    (out (default-to "" (get o (map-get? m-outcome { m: m }))  ))
  )
    (begin
      (try! (only-admin))
      (asserts! (is-eq (get-status-str m) "resolved") (err u707))
      (if (is-eq out "YES")
          (asserts! (is-eq ys u0) (err u708))
          (asserts! (is-eq ns u0) (err u709)))
      (asserts! (> p u0) (err u710))
      (as-contract (try! (contract-call? .sbtc-v3 transfer p tx-sender ADMIN)))
      (map-set m-pool { m: m } { p: u0 })
      (ok true)
    )
  )
)

;; ------------------------------ BUY quotes --------------------------
(define-read-only (quote-buy-yes (m uint) (amount uint))
  (let (
    (b  (get-b-or0 m))
    (qy (get-qy-or0 m))
    (qn (get-qn-or0 m))
    (c0 (calculate-cost b qy qn amount true))
    (c  (if (> c0 u0) c0 u1))
    (pB (var-get protocol-fee-bps))
    (lB (var-get lp-fee-bps))
    (fP (ceil-bps c pB))
    (fL (ceil-bps c lB))
    (dr (/ (* fP (var-get pct-drip)) u100))
    (br (/ (* fP (var-get pct-brc))  u100))
    (tm (- fP (+ dr br)))
    (tot (+ c (+ fP fL)))
  )
    (ok { cost: c, feeProtocol: fP, feeLP: fL, total: tot, drip: dr, brc20: br, team: tm })
  )
)

(define-read-only (quote-buy-no (m uint) (amount uint))
  (let (
    (b  (get-b-or0 m))
    (qy (get-qy-or0 m))
    (qn (get-qn-or0 m))
    (c0 (calculate-cost b qy qn amount false))
    (c  (if (> c0 u0) c0 u1))
    (pB (var-get protocol-fee-bps))
    (lB (var-get lp-fee-bps))
    (fP (ceil-bps c pB))
    (fL (ceil-bps c lB))
    (dr (/ (* fP (var-get pct-drip)) u100))
    (br (/ (* fP (var-get pct-brc))  u100))
    (tm (- fP (+ dr br)))
    (tot (+ c (+ fP fL)))
  )
    (ok { cost: c, feeProtocol: fP, feeLP: fL, total: tot, drip: dr, brc20: br, team: tm })
  )
)

;; ------------------------------ SELL quotes -------------------------
;; For SELL, "proceeds" = AC = C(q) - C(q'), and user receives:
;;   total = max(proceeds - fees, 0)
;; Fees se calculan igual que en BUY (sobre "proceeds") y los paga el trader.

(define-read-only (quote-sell-yes (m uint) (amount uint))
  (let (
    (b  (get-b-or0 m))
    (qy (get-qy-or0 m))
    (qn (get-qn-or0 m))
  )
    (if (or (is-eq b u0) (is-eq amount u0) (> amount qy))
        (ok { proceeds: u0, feeProtocol: u0, feeLP: u0, total: u0, drip: u0, brc20: u0, team: u0 })
        (let (
          (c0 (cost-fn b qy qn))
          (c1 (cost-fn b (- qy amount) qn))
          (diff (- c0 c1))
        )
          (if (<= diff 0)
            (ok { proceeds: u0, feeProtocol: u0, feeLP: u0, total: u0, drip: u0, brc20: u0, team: u0 })
            (let (
              (c  (to-uint diff))
              (pB (var-get protocol-fee-bps))
              (lB (var-get lp-fee-bps))
              (fP (ceil-bps c pB))
              (fL (ceil-bps c lB))
              (dr (/ (* fP (var-get pct-drip)) u100))
              (br (/ (* fP (var-get pct-brc))  u100))
              (tm (- fP (+ dr br)))
              (tot (if (> c (+ fP fL)) (- c (+ fP fL)) u0))
            )
              (ok { proceeds: c, feeProtocol: fP, feeLP: fL, total: tot, drip: dr, brc20: br, team: tm })
            )
          )
        )
    )
  )
)

(define-read-only (quote-sell-no (m uint) (amount uint))
  (let (
    (b  (get-b-or0 m))
    (qy (get-qy-or0 m))
    (qn (get-qn-or0 m))
  )
    (if (or (is-eq b u0) (is-eq amount u0) (> amount qn))
        (ok { proceeds: u0, feeProtocol: u0, feeLP: u0, total: u0, drip: u0, brc20: u0, team: u0 })
        (let (
          (c0 (cost-fn b qy qn))
          (c1 (cost-fn b qy (- qn amount)))
          (diff (- c0 c1))
        )
          (if (<= diff 0)
            (ok { proceeds: u0, feeProtocol: u0, feeLP: u0, total: u0, drip: u0, brc20: u0, team: u0 })
            (let (
              (c  (to-uint diff))
              (pB (var-get protocol-fee-bps))
              (lB (var-get lp-fee-bps))
              (fP (ceil-bps c pB))
              (fL (ceil-bps c lB))
              (dr (/ (* fP (var-get pct-drip)) u100))
              (br (/ (* fP (var-get pct-brc))  u100))
              (tm (- fP (+ dr br)))
              (tot (if (> c (+ fP fL)) (- c (+ fP fL)) u0))
            )
              (ok { proceeds: c, feeProtocol: fP, feeLP: fL, total: tot, drip: dr, brc20: br, team: tm })
            )
          )
        )
    )
  )
)

;; --------------------------- extra getters --------------------------
(define-read-only (get-pool (m uint))        (get-pool-or0 m))
(define-read-only (get-b (m uint))           (get-b-or0 m))
(define-read-only (get-status (m uint))      (get-status-str m))
(define-read-only (get-outcome (m uint))     (default-to "" (get o (map-get? m-outcome { m: m } ))))
(define-read-only (get-initialized (m uint)) (get-initialized-bool m))
(define-read-only (get-admin)                (some ADMIN))
(define-read-only (get-fee-params)
  {
    protocolBps: (var-get protocol-fee-bps),
    lpBps:       (var-get lp-fee-bps),
    pctDrip:     (var-get pct-drip),
    pctBrc:      (var-get pct-brc),
    pctTeam:     (var-get pct-team)
  }
)
(define-read-only (get-fee-recipients)
  {
    drip:   (var-get DRIP_VAULT),
    brc20:  (var-get BRC20_VAULT),
    team:   (var-get TEAM_WALLET),
    lp:     (var-get LP_WALLET),
    locked: (var-get fees-locked)
  }
)
(define-read-only (get-self) (var-get SELF))
