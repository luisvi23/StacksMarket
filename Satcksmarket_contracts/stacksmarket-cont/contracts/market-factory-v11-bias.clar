;; ===========================================================
;; market-factory-v8-bias (Fixed-b LMSR + bias/virtual liquidity)
;;
;; UPDATE: "buy by sats" without binary search.
;; Adds:
;;  - exp-fixed (general exp for +/- in 1e6 fixed)
;;  - invert-buy-shares (closed-form inversion for binary LMSR)
;;  - refine-shares-updown (bounded 2-step correction)
;;  - quote-buy-yes-by-sats / quote-buy-no-by-sats (1 read-only call)
;;
;; Bias (rY/rN) is pricing-only (adds to q in pricing), redeem uses real shares only.
;; ===========================================================

(define-constant ADMIN 'ST1PSHE32YTEE21FGYEVTA24N681KRGSQM4VF9XZP)
(define-constant EMPTY-BUY-QUOTE
  { cost: u0, feeProtocol: u0, feeLP: u0, total: u0, drip: u0, brc20: u0, team: u0 }
)

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

;; --------------------------- per-market state ------------------------
(define-map m-status      { m: uint } { s: (string-ascii 10) })  ;; "open" | "resolved"
(define-map m-outcome     { m: uint } { o: (string-ascii 3) })   ;; "" | "YES" | "NO"
(define-map m-initialized { m: uint } { v: bool })
(define-map m-paused      { m: uint } { v: bool })
(define-map m-max-trade   { m: uint } { v: uint })

;; LMSR REAL state (shares reales)
(define-map m-q-yes { m: uint } { q: uint })
(define-map m-q-no  { m: uint } { q: uint })
(define-map m-pool  { m: uint } { p: uint })
(define-map m-b     { m: uint } { b: uint })

;; BIAS (virtual liquidity) - pricing only
(define-map m-r-yes { m: uint } { r: uint })
(define-map m-r-no  { m: uint } { r: uint })
(define-map m-bias-locked { m: uint } { v: bool })

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
(define-constant ERR-NO-WALLET-BAL (err u760))
(define-constant ERR-TOKEN-READ    (err u761))

;; SELL-specific errors
(define-constant ERR-NO-SHARES        (err u770))
(define-constant ERR-POOL-LIQUIDITY   (err u771))
(define-constant ERR-BAD-REFUND       (err u772))

;; bias errors
(define-constant ERR-BIAS-LOCKED       (err u780))
(define-constant ERR-BIAS-NONZERO-Q    (err u781))
(define-constant ERR-BIAS_PCT          (err u782))

;; With UNIT=1, you must guard per-trade solvency; otherwise LMSR can mint claims
;; that exceed pool by a small rounding margin. This error prevents that.
(define-constant ERR-TRADE-INSOLVENT   (err u783))

;; -------------------------- math constants --------------------------
(define-constant SCALE u1000000)
(define-constant SCALE-INT (to-int SCALE))
(define-constant LN2-SCALED (to-int u693147))     ;; ln(2) * 1e6

(define-constant i1  (to-int u1))
(define-constant i2  (to-int u2))
(define-constant i3  (to-int u3))
(define-constant i5  (to-int u5))
(define-constant i7  (to-int u7))
(define-constant i9  (to-int u9))
(define-constant i6  (to-int u6))
(define-constant i24 (to-int u24))
(define-constant i120 (to-int u120))
(define-constant i720 (to-int u720))

(define-constant UNIT u1) ;; 1 share = 1 sat redemption

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

(define-private (minu (a uint) (b uint))
  (if (< a b) a b)
)

(define-private (ensure-user-balance (need uint))
  (let ((bal (unwrap! (contract-call? .sbtc-v4 get-balance tx-sender) ERR-TOKEN-READ)))
    (asserts! (>= bal need) ERR-NO-WALLET-BAL)
    (ok true)
  )
)

(define-private (abs-int (x int))
  (if (< x 0) (- 0 x) x)
)

;; floor division for int with positive denom (fixes trunc-towards-0)
(define-private (floor-div-pos (a int) (b int))
  (let ((q (/ a b)))
    (if (and (< a 0) (not (is-eq (* q b) a)))
        (- q i1)
        q)
  )
)

;; ------------------------------------------------------------
;;  Contract principal helper + transfers
;;
;; IMPORTANT: These return (response bool uint) ALWAYS
;; so they never cause "two execution paths different types".
;; ------------------------------------------------------------
(define-private (self-principal)
  (as-contract tx-sender)
)

;; user -> contract (ONE transfer)
(define-private (xfer-in (amt uint))
  (if (> amt u0)
      (contract-call? .sbtc-v4 transfer amt tx-sender (self-principal))
      (ok true))
)

;; contract -> recipient
(define-private (xfer-out (amt uint) (to principal))
  (if (or (is-eq amt u0) (is-eq to (self-principal)))
      (ok true)
      (as-contract (contract-call? .sbtc-v4 transfer amt tx-sender to)))
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

(define-private (get-ry-or0 (m uint))
  (default-to u0 (get r (map-get? m-r-yes { m: m })))
)

(define-private (get-rn-or0 (m uint))
  (default-to u0 (get r (map-get? m-r-no { m: m })))
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

(define-private (get-bias-locked (m uint))
  (default-to false (get v (map-get? m-bias-locked { m: m })))
)

;; ---------------------------- fixed-point ---------------------------
(define-private (exp-taylor (x int))
  (let (
    (x2 (/ (* x x) SCALE-INT))
    (x3 (/ (* x2 x) SCALE-INT))
    (x4 (/ (* x3 x) SCALE-INT))
    (x5 (/ (* x4 x) SCALE-INT))
    (x6 (/ (* x5 x) SCALE-INT))
  )
    (+ SCALE-INT
      (+ x
        (+ (/ x2 i2)
          (+ (/ x3 i6)
            (+ (/ x4 i24)
              (+ (/ x5 i120)
                (/ x6 i720)))))))
  )
)

;; Original helper kept (used elsewhere)
(define-private (exp-neg-fixed (x int))
  (let ((negx (- 0 x)))
    (if (<= x 0)
        (let (
          (k-int (/ negx LN2-SCALED))
          (k (to-uint k-int))
          (r (- negx (* k-int LN2-SCALED)))
          (er (exp-taylor (- 0 r)))
        )
          (if (>= k u20)
              0
              (let ((den (to-int (bit-shift-left u1 k))))
                (/ er den)))
        )
        SCALE-INT))
)

;; NEW: exp-fixed (general exp for +/- x), x is 1e6-fixed, returns 1e6-fixed
(define-private (exp-fixed (x int))
  (let (
    ;; normalize with k = floor(x/ln2)
    (k (floor-div-pos x LN2-SCALED))
    (r (- x (* k LN2-SCALED))) ;; r in [-ln2, ln2)
    (er (exp-taylor r))
    (ku (to-uint (abs-int k)))
  )
    ;; cap to avoid huge shifts/mults
    (if (>= ku u20)
        (if (< k 0) 0 (to-int u2147483647))
        (if (< k 0)
            (/ er (to-int (bit-shift-left u1 ku)))
            (* er (to-int (bit-shift-left u1 ku))))
  ))
)

(define-private (ln-atanh (y int))
  (let (
    (num (- y SCALE-INT))
    (den (+ y SCALE-INT))
    (t   (/ (* num SCALE-INT) den))
    (t2  (/ (* t t) SCALE-INT))
    (t3  (/ (* t2 t) SCALE-INT))
    (t5  (/ (* t3 t2) SCALE-INT))
    (t7  (/ (* t5 t2) SCALE-INT))
    (t9  (/ (* t7 t2) SCALE-INT))
    (s (+ t (+ (/ t3 i3) (+ (/ t5 i5) (+ (/ t7 i7) (/ t9 i9))))))

  )
    (* s (to-int u2))
  )
)

(define-private (ln-norm-step (st { y: int, k: int }))
  (let (
    (yy (get y st))
    (kk (get k st))
    (two (* SCALE-INT (to-int u2)))
    (half (/ SCALE-INT (to-int u2)))
  )
    (if (>= yy two)
        { y: (/ yy (to-int u2)), k: (+ kk i1) }
        (if (< yy half)
            { y: (* yy (to-int u2)), k: (- kk i1) }
            st))
  )
)

(define-private (ln-general (y int))
  (let (
    (s0 { y: y, k: 0 })
    (s1 (ln-norm-step s0))
    (s2 (ln-norm-step s1))
    (s3 (ln-norm-step s2))
    (s4 (ln-norm-step s3))
    (s5 (ln-norm-step s4))
    (s6 (ln-norm-step s5))
    (s7 (ln-norm-step s6))
    (s8 (ln-norm-step s7))
    (yn (get y s8))
    (k  (get k s8))
  )
    (+ (ln-atanh yn) (* k LN2-SCALED))
  )
)

(define-private (ln-sum-exp (a int) (b int))
  (let (
    (m (if (> a b) a b))
    (n (if (> a b) b a))
    (delta (- n m))
    (ed (exp-neg-fixed delta))
    (one-plus (+ SCALE-INT ed))
    (ln1p (ln-atanh one-plus))
  )
    (+ m ln1p)
  )
)

(define-private (cost-unbiased (b uint) (qY uint) (qN uint))
  (let (
    (B (to-int b))
    (bpos  (> b u0))
    (a (if bpos (/ (* (to-int qY) SCALE-INT) B) 0))
    (c (if bpos (/ (* (to-int qN) SCALE-INT) B) 0))
    (lnsum (ln-sum-exp a c))
  )
    (if bpos (/ (* B lnsum) SCALE-INT) 0)
  )
)

(define-private (cost-tilde (b uint) (qY uint) (qN uint) (rY uint) (rN uint))
  (let (
    (c1 (cost-unbiased b (+ qY rY) (+ qN rN)))
    (c0 (cost-unbiased b rY rN))
  )
    (- c1 c0)
  )
)

(define-private (calculate-cost (b uint) (qY uint) (qN uint) (rY uint) (rN uint) (amt uint) (yes? bool))
  (let (
    (base (cost-tilde b qY qN rY rN))
    (new  (if yes?
              (cost-tilde b (+ qY amt) qN rY rN)
              (cost-tilde b qY (+ qN amt) rY rN)))
    (diff (- new base))
  )
    (if (> (to-int amt) 0)
        (if (> diff 0)
            (let ((u (to-uint diff))) (if (> u u0) u u1))
            u1)
        u0)
  )
)

;; --------------------- NEW: closed-form inversion -------------------
;; invert baseCost (no fees) -> shares for YES/NO
;; Using:
;;  E = exp(baseCost/b)
;;  D = exp((qOther' - qSelf')/b)
;;  exp(x/b) = E(1+D) - D
;;  x = b * ln( E(1+D) - D )
(define-private (invert-buy-shares (b uint) (qSelfP uint) (qOtherP uint) (baseCost uint))
  (let (
    (B (to-int b))
    (deltaShares (- (to-int qOtherP) (to-int qSelfP)))
    (deltaFixed (if (> b u0) (/ (* deltaShares SCALE-INT) B) 0))
    (D (exp-fixed deltaFixed)) ;; 1e6 fixed
    (cFixed (if (> b u0) (/ (* (to-int baseCost) SCALE-INT) B) 0))
    (E (exp-fixed cFixed))     ;; 1e6 fixed
    (onePlusD (+ SCALE-INT D))
    (tmp (/ (* E onePlusD) SCALE-INT)) ;; E(1+D)
    (y (- tmp D)) ;; exp(x/b) in 1e6 fixed
  )
    (if (<= y 0)
        u0
        (let (
          (lnY (ln-general y))
          (xInt (if (> b u0) (/ (* B lnY) SCALE-INT) 0))
        )
          (if (<= xInt 0) u0 (to-uint xInt))
        )
    )
  )
)

;; bounded refinement: ensure cost(shares) <= baseBudget and try +1 if possible
(define-private (refine-shares-updown (b uint) (qy uint) (qn uint) (rY uint) (rN uint) (baseBudget uint) (yes? bool) (s0 uint))
  (let (
    (c0 (calculate-cost b qy qn rY rN s0 yes?))
    (s1 (if (> c0 baseBudget) (if (> s0 u0) (- s0 u1) u0) s0))
    (c1p (calculate-cost b qy qn rY rN (+ s1 u1) yes?))
    (s2 (if (<= c1p baseBudget) (+ s1 u1) s1))
  )
    s2
  )
)

;; ---------------------- fixed b: init once --------------------------
(define-private (init-b (m uint) (initial-liquidity uint))
  (begin
    (let (
      (num (* (to-int initial-liquidity) SCALE-INT))
      (den LN2-SCALED)
    )
      (map-set m-b { m: m } { b: (to-uint (/ num den)) })
    )
    true
  )
)

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
  (let (
    (cur (default-to u0 (get spent (map-get? user-spent { m: m, user: who })) ))
    (nw  (+ cur delta))
  )
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

;; ---------------------- set-market-bias (p=1..99) --------------------
(define-public (set-market-bias (m uint) (p-yes uint))
  (begin
    (try! (only-admin))
    (asserts! (is-eq (get-initialized-bool m) true) ERR-NOT-INIT)
    (asserts! (is-eq (get-status-str m) "open") ERR-NOT-OPEN)
    (asserts! (is-eq (get-bias-locked m) false) ERR-BIAS-LOCKED)

    (asserts! (and (>= p-yes u1) (<= p-yes u99)) ERR-BIAS_PCT)

    (let (
      (ys (default-to u0 (get s (map-get? yes-supply { m: m })) ))
      (ns (default-to u0 (get s (map-get? no-supply  { m: m })) ))
    )
      (asserts! (is-eq ys u0) ERR-BIAS-NONZERO-Q)
      (asserts! (is-eq ns u0) ERR-BIAS-NONZERO-Q)
    )

    (let ((b (get-b-or0 m)))
      (asserts! (> b u0) ERR-B-ZERO)

      (let (
        (den (- u100 p-yes))
        (ratio (/ (* (to-int p-yes) SCALE-INT) (to-int den)))
        (lnr (ln-general ratio))
        (rdiff-int (/ (* (to-int b) lnr) SCALE-INT))
        (rdiff (to-uint (abs-int rdiff-int)))
      )
        (if (>= p-yes u50)
            (begin
              (map-set m-r-yes { m: m } { r: rdiff })
              (map-set m-r-no  { m: m } { r: u0  })
              true)
            (begin
              (map-set m-r-yes { m: m } { r: u0  })
              (map-set m-r-no  { m: m } { r: rdiff })
              true))

        (map-set m-bias-locked { m: m } { v: true })
        (ok { pYes: p-yes, rYes: (get-ry-or0 m), rNo: (get-rn-or0 m) })
      )
    )
  )
)

;; -------------------------- create and liquidity ---------------------
(define-public (create-market (m uint) (initial-liquidity uint))
  (begin
    (try! (only-admin))
    (asserts! (is-eq (get-initialized-bool m) false) (err u700))
    (asserts! (> initial-liquidity u0) (err u701))

    ;;  ONE transfer: ADMIN -> CONTRACT
    (try! (xfer-in initial-liquidity))

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

    (map-set m-r-yes { m: m } { r: u0 })
    (map-set m-r-no  { m: m } { r: u0 })
    (map-set m-bias-locked { m: m } { v: false })

    (init-b m initial-liquidity)
    (ok (get-b-or0 m))
  )
)

(define-public (add-liquidity (m uint) (amount uint))
  (begin
    (try! (only-admin))
    (asserts! (is-eq (get-initialized-bool m) true) ERR-NOT-INIT)
    (asserts! (> amount u0) (err u702))
    (asserts! (is-eq (get-status-str m) "open") ERR-NOT-OPEN)

    ;;  ONE transfer: ADMIN -> CONTRACT
    (try! (xfer-in amount))

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
      (rY  (get-ry-or0 m))
      (rN  (get-rn-or0 m))
      (c0  (calculate-cost b qy qn rY rN amount yes?))
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
        (try! (ensure-user-balance total))

        (let (
          (cap   (default-to u0 (get cap (map-get? user-caps { m: m, user: tx-sender })) ))
          (spent (default-to u0 (get spent (map-get? user-spent { m: m, user: tx-sender })) ))
        )
          (asserts! (> cap u0) (err u730))
          (asserts! (<= (+ spent total) cap) (err u731))

          ;; Per-trade solvency guard (UNIT=1):
          (let (
            (pool0 (get-pool-or0 m))
            (pool1 (+ pool0 base))
            (ys0 (default-to u0 (get s (map-get? yes-supply { m: m })) ))
            (ns0 (default-to u0 (get s (map-get? no-supply  { m: m })) ))
            (ys1 (if yes? (+ ys0 amount) ys0))
            (ns1 (if yes? ns0 (+ ns0 amount)))
          )
            (asserts! (and (>= pool1 ys1) (>= pool1 ns1)) ERR-TRADE-INSOLVENT)
          )

          ;;  ONE transfer: USER -> CONTRACT (total)
          (try! (xfer-in total))

          ;;  fees paid by CONTRACT -> recipients
          (try! (xfer-out drip (var-get DRIP_VAULT)))
          (try! (xfer-out brc  (var-get BRC20_VAULT)))
          (try! (xfer-out team (var-get TEAM_WALLET)))
          (try! (xfer-out feeL (var-get LP_WALLET)))

          ;; mint real shares + update real q
          (if yes?
            (begin
              (mint-yes m tx-sender amount)
              (map-set m-q-yes { m: m } { q: (+ (get-qy-or0 m) amount) }))
            (begin
              (mint-no m tx-sender amount)
              (map-set m-q-no { m: m } { q: (+ (get-qn-or0 m) amount) })))

          ;; pool increases by base (fees already paid out)
          (map-set m-pool { m: m } { p: (+ (get-pool-or0 m) base) })

          ;; spent increases by total
          (add-spent m tx-sender total)

          (ok amount)
        )
      )
    )
  )
)

(define-public (buy-yes (m uint) (amount uint)) (do-buy m amount true))
(define-public (buy-no  (m uint) (amount uint)) (do-buy m amount false))

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
      (rY  (get-ry-or0 m))
      (rN  (get-rn-or0 m))
      (c0  (calculate-cost b qy qn rY rN amount true))
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
        (try! (ensure-user-balance total))

        (let (
          (cap   (default-to u0 (get cap (map-get? user-caps { m: m, user: tx-sender })) ))
          (spent (default-to u0 (get spent (map-get? user-spent { m: m, user: tx-sender })) ))
        )
          (asserts! (> cap u0) (err u730))
          (asserts! (<= (+ spent total) cap) (err u731))

          (let (
            (pool0 (get-pool-or0 m))
            (pool1 (+ pool0 base))
            (ys0 (default-to u0 (get s (map-get? yes-supply { m: m })) ))
            (ns0 (default-to u0 (get s (map-get? no-supply  { m: m })) ))
            (ys1 (+ ys0 amount))
          )
            (asserts! (and (>= pool1 ys1) (>= pool1 ns0)) ERR-TRADE-INSOLVENT)
          )

          ;;  ONE transfer: USER -> CONTRACT (total)
          (try! (xfer-in total))

          ;;  fees paid by CONTRACT
          (try! (xfer-out drip (var-get DRIP_VAULT)))
          (try! (xfer-out brc  (var-get BRC20_VAULT)))
          (try! (xfer-out team (var-get TEAM_WALLET)))
          (try! (xfer-out feeL (var-get LP_WALLET)))

          (mint-yes m tx-sender amount)
          (map-set m-q-yes { m: m } { q: (+ (get-qy-or0 m) amount) })

          (map-set m-pool { m: m } { p: (+ (get-pool-or0 m) base) })
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
      (rY  (get-ry-or0 m))
      (rN  (get-rn-or0 m))
      (c0  (calculate-cost b qy qn rY rN amount false))
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
        (try! (ensure-user-balance total))

        (let (
          (cap   (default-to u0 (get cap (map-get? user-caps { m: m, user: tx-sender })) ))
          (spent (default-to u0 (get spent (map-get? user-spent { m: m, user: tx-sender })) ))
        )
          (asserts! (> cap u0) (err u730))
          (asserts! (<= (+ spent total) cap) (err u731))

          (let (
            (pool0 (get-pool-or0 m))
            (pool1 (+ pool0 base))
            (ys0 (default-to u0 (get s (map-get? yes-supply { m: m })) ))
            (ns0 (default-to u0 (get s (map-get? no-supply  { m: m })) ))
            (ns1 (+ ns0 amount))
          )
            (asserts! (and (>= pool1 ys0) (>= pool1 ns1)) ERR-TRADE-INSOLVENT)
          )

          ;;  ONE transfer: USER -> CONTRACT (total)
          (try! (xfer-in total))

          ;;  fees paid by CONTRACT
          (try! (xfer-out drip (var-get DRIP_VAULT)))
          (try! (xfer-out brc  (var-get BRC20_VAULT)))
          (try! (xfer-out team (var-get TEAM_WALLET)))
          (try! (xfer-out feeL (var-get LP_WALLET)))

          (mint-no m tx-sender amount)
          (map-set m-q-no { m: m } { q: (+ (get-qn-or0 m) amount) })

          (map-set m-pool { m: m } { p: (+ (get-pool-or0 m) base) })
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
      (pool (get-pool-or0 m))
      (user tx-sender)
      (qyR  (get-qy-or0 m))
      (qnR  (get-qn-or0 m))
      (rY   (get-ry-or0 m))
      (rN   (get-rn-or0 m))
    )
      (let (
        (user-bal (if yes?
                      (default-to u0 (get bal (map-get? yes-holdings { m: m, user: user })))
                      (default-to u0 (get bal (map-get? no-holdings  { m: m, user: user })))))
        (curQreal (if yes? qyR qnR))
      )
        (asserts! (>= user-bal amount) ERR-NO-SHARES)
        (asserts! (>= curQreal amount) ERR-NO-SHARES)

        ;; compute proceeds (gross)
        (let (
          (c0 (cost-tilde b qyR qnR rY rN))
          (c1 (if yes?
                  (cost-tilde b (- qyR amount) qnR rY rN)
                  (cost-tilde b qyR (- qnR amount) rY rN)))
          (diff (- c0 c1))
        )
          (asserts! (> diff 0) ERR-BAD-REFUND)

          (let (
            (base (to-uint diff))

            (pB   (var-get protocol-fee-bps))
            (lB   (var-get lp-fee-bps))

            ;; clamp fees so never exceed base
            (feeP0 (ceil-bps base pB))
            (feeP  (minu feeP0 base))
            (rem   (- base feeP))
            (feeL0 (ceil-bps base lB))
            (feeL  (minu feeL0 rem))

            (drip (/ (* feeP (var-get pct-drip)) u100))
            (brc  (/ (* feeP (var-get pct-brc))  u100))
            (team (- feeP (+ drip brc)))

            (totalFees (+ feeP feeL))
            (net (- base totalFees))
          )
            (asserts! (>= pool base) ERR-POOL-LIQUIDITY)

            ;; burn REAL shares + update REAL q
            (if yes?
              (let ((sup (default-to u0 (get s (map-get? yes-supply { m: m })))))
                (asserts! (>= sup amount) ERR-POOL-LIQUIDITY)
                (map-set yes-holdings { m: m, user: user } { bal: (- user-bal amount) })
                (map-set yes-supply   { m: m } { s: (- sup amount) })
                (map-set m-q-yes      { m: m } { q: (- qyR amount) })
                true
              )
              (let ((sup (default-to u0 (get s (map-get? no-supply { m: m })))))
                (asserts! (>= sup amount) ERR-POOL-LIQUIDITY)
                (map-set no-holdings { m: m, user: user } { bal: (- user-bal amount) })
                (map-set no-supply   { m: m } { s: (- sup amount) })
                (map-set m-q-no      { m: m } { q: (- qnR amount) })
                true
              )
            )

            ;; payouts from contract
            (try! (xfer-out net user))
            (try! (xfer-out drip (var-get DRIP_VAULT)))
            (try! (xfer-out brc  (var-get BRC20_VAULT)))
            (try! (xfer-out team (var-get TEAM_WALLET)))
            (try! (xfer-out feeL (var-get LP_WALLET)))

            ;; pool decreases by gross base
            (map-set m-pool { m: m } { p: (- pool base) })

            (ok amount)
          )
        )
      )
    )
  )
)

(define-public (sell-yes (m uint) (amount uint)) (do-sell m amount true))
(define-public (sell-no  (m uint) (amount uint)) (do-sell m amount false))

(define-private (do-sell-auto (m uint) (amount uint) (yes? bool) (min-proceeds uint))
  (begin
    (try! (ensure-open m))
    (try! (check-trade-limit m amount))
    (asserts! (> (get-b-or0 m) u0) ERR-B-ZERO)
    (asserts! (> amount u0) ERR-AMOUNT)
    (asserts! (> min-proceeds u0) ERR-SLIPPAGE)

    (let (
      (b    (get-b-or0 m))
      (pool (get-pool-or0 m))
      (user tx-sender)
      (qyR  (get-qy-or0 m))
      (qnR  (get-qn-or0 m))
      (rY   (get-ry-or0 m))
      (rN   (get-rn-or0 m))
    )
      (let (
        (user-bal (if yes?
                      (default-to u0 (get bal (map-get? yes-holdings { m: m, user: user })))
                      (default-to u0 (get bal (map-get? no-holdings  { m: m, user: user })))))
        (curQreal (if yes? qyR qnR))
      )
        (asserts! (>= user-bal amount) ERR-NO-SHARES)
        (asserts! (>= curQreal amount) ERR-NO-SHARES)

        (let (
          (c0 (cost-tilde b qyR qnR rY rN))
          (c1 (if yes?
                  (cost-tilde b (- qyR amount) qnR rY rN)
                  (cost-tilde b qyR (- qnR amount) rY rN)))
          (diff (- c0 c1))
        )
          (asserts! (> diff 0) ERR-BAD-REFUND)

          (let (
            (base (to-uint diff))

            (pB   (var-get protocol-fee-bps))
            (lB   (var-get lp-fee-bps))

            (feeP0 (ceil-bps base pB))
            (feeP  (minu feeP0 base))
            (rem   (- base feeP))
            (feeL0 (ceil-bps base lB))
            (feeL  (minu feeL0 rem))

            (drip (/ (* feeP (var-get pct-drip)) u100))
            (brc  (/ (* feeP (var-get pct-brc))  u100))
            (team (- feeP (+ drip brc)))

            (totalFees (+ feeP feeL))
            (net (- base totalFees))
          )
            (asserts! (>= pool base) ERR-POOL-LIQUIDITY)
            (asserts! (>= net min-proceeds) ERR-SLIPPAGE)

            (if yes?
              (let ((sup (default-to u0 (get s (map-get? yes-supply { m: m })))))
                (asserts! (>= sup amount) ERR-POOL-LIQUIDITY)
                (map-set yes-holdings { m: m, user: user } { bal: (- user-bal amount) })
                (map-set yes-supply   { m: m } { s: (- sup amount) })
                (map-set m-q-yes      { m: m } { q: (- qyR amount) })
                true
              )
              (let ((sup (default-to u0 (get s (map-get? no-supply { m: m })))))
                (asserts! (>= sup amount) ERR-POOL-LIQUIDITY)
                (map-set no-holdings { m: m, user: user } { bal: (- user-bal amount) })
                (map-set no-supply   { m: m } { s: (- sup amount) })
                (map-set m-q-no      { m: m } { q: (- qnR amount) })
                true
              )
            )

            (try! (xfer-out net user))
            (try! (xfer-out drip (var-get DRIP_VAULT)))
            (try! (xfer-out brc  (var-get BRC20_VAULT)))
            (try! (xfer-out team (var-get TEAM_WALLET)))
            (try! (xfer-out feeL (var-get LP_WALLET)))

            (map-set m-pool { m: m } { p: (- pool base) })
            (ok amount)
          )
        )
      )
    )
  )
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

    (let (
      (ys (default-to u0 (get s (map-get? yes-supply { m: m })) ))
      (ns (default-to u0 (get s (map-get? no-supply  { m: m })) ))
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
    (try! (xfer-out payout rcpt))
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
    (try! (xfer-out payout rcpt))
    (map-set m-pool { m: m } { p: (- p payout) })
    (ok payout)
  )
)

;; --------------------------- withdraw surplus -----------------------
(define-public (withdraw-surplus (m uint))
  (let (
    (ys (default-to u0 (get s (map-get? yes-supply { m: m })) ))
    (ns (default-to u0 (get s (map-get? no-supply  { m: m })) ))
    (p  (get-pool-or0 m))
    (out (default-to "" (get o (map-get? m-outcome { m: m } ))))
  )
    (begin
      (try! (only-admin))
      (asserts! (is-eq (get-status-str m) "resolved") (err u707))
      (if (is-eq out "YES")
          (asserts! (is-eq ys u0) (err u708))
          (asserts! (is-eq ns u0) (err u709)))
      (asserts! (> p u0) (err u710))
      (try! (xfer-out p ADMIN))
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
    (rY (get-ry-or0 m))
    (rN (get-rn-or0 m))
    (c0 (calculate-cost b qy qn rY rN amount true))
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
    ;; force determinate (response ... uint) type
    (if true
        (ok { cost: c, feeProtocol: fP, feeLP: fL, total: tot, drip: dr, brc20: br, team: tm })
        (err u0))
  )
)



(define-read-only (quote-buy-no (m uint) (amount uint))
  (let (
    (b  (get-b-or0 m))
    (qy (get-qy-or0 m))
    (qn (get-qn-or0 m))
    (rY (get-ry-or0 m))
    (rN (get-rn-or0 m))
    (c0 (calculate-cost b qy qn rY rN amount false))
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
    ;; force determinate (response ... uint) type
    (if true
        (ok { cost: c, feeProtocol: fP, feeLP: fL, total: tot, drip: dr, brc20: br, team: tm })
        (err u0))
  )
)



;; ------------------------ NEW: BUY quotes by sats -------------------
;; budget is TOTAL (base + fees). We compute a conservative baseBudget, invert, refine,
;; then return final quote for those shares. (1 read-only call in frontend)
(define-read-only (quote-buy-yes-by-sats (m uint) (budget uint))
  (let (
    (b  (get-b-or0 m))
    (qy (get-qy-or0 m))
    (qn (get-qn-or0 m))
    (rY (get-ry-or0 m))
    (rN (get-rn-or0 m))
    (pB (var-get protocol-fee-bps))
    (lB (var-get lp-fee-bps))
  )
    (if (or (is-eq b u0) (is-eq budget u0))
        (ok { shares: u0, budget: budget, baseBudget: u0, quote: EMPTY-BUY-QUOTE })
        (let (
          (den (+ u10000 (+ pB lB)))
          (base0 (/ (* budget u10000) den))
          ;; subtract small safety for ceil rounding
          (baseBudget (if (> base0 u2) (- base0 u2) u0))

          (qSelfP (+ qy rY))
          (qOtherP (+ qn rN))

          (s0 (invert-buy-shares b qSelfP qOtherP baseBudget))
          (s  (refine-shares-updown b qy qn rY rN baseBudget true s0))
        )
          (match (quote-buy-yes m s)
            q
            (let ((tot (get total q)))
              ;; final tiny safety: if total > budget, step down once
              (if (and (> s u0) (> tot budget))
                  (let ((s2 (- s u1)))
                    (match (quote-buy-yes m s2)
                      q2 (ok { shares: s2, budget: budget, baseBudget: baseBudget, quote: q2 })
                      e2 (ok { shares: s2, budget: budget, baseBudget: baseBudget, quote: EMPTY-BUY-QUOTE })
                    )
                  )
                  (ok { shares: s, budget: budget, baseBudget: baseBudget, quote: q })
              )
            )
            e
            (ok { shares: u0, budget: budget, baseBudget: baseBudget, quote: EMPTY-BUY-QUOTE })
          )
        )
    )
  )
)


(define-read-only (quote-buy-no-by-sats (m uint) (budget uint))
  (let (
    (b  (get-b-or0 m))
    (qy (get-qy-or0 m))
    (qn (get-qn-or0 m))
    (rY (get-ry-or0 m))
    (rN (get-rn-or0 m))
    (pB (var-get protocol-fee-bps))
    (lB (var-get lp-fee-bps))
  )
    (if (or (is-eq b u0) (is-eq budget u0))
        (ok { shares: u0, budget: budget, baseBudget: u0, quote: EMPTY-BUY-QUOTE })
        (let (
          (den (+ u10000 (+ pB lB)))
          (base0 (/ (* budget u10000) den))
          (baseBudget (if (> base0 u2) (- base0 u2) u0))

          ;; for NO, self is qN', other is qY'
          (qSelfP (+ qn rN))
          (qOtherP (+ qy rY))

          (s0 (invert-buy-shares b qSelfP qOtherP baseBudget))
          (s  (refine-shares-updown b qy qn rY rN baseBudget false s0))
        )
          (match (quote-buy-no m s)
            q
            (let ((tot (get total q)))
              (if (and (> s u0) (> tot budget))
                  (let ((s2 (- s u1)))
                    (match (quote-buy-no m s2)
                      q2 (ok { shares: s2, budget: budget, baseBudget: baseBudget, quote: q2 })
                      e2 (ok { shares: s2, budget: budget, baseBudget: baseBudget, quote: EMPTY-BUY-QUOTE })
                    )
                  )
                  (ok { shares: s, budget: budget, baseBudget: baseBudget, quote: q })
              )
            )
            e
            (ok { shares: u0, budget: budget, baseBudget: baseBudget, quote: EMPTY-BUY-QUOTE })
          )
        )
    )
  )
)


;; ------------------------------ SELL quotes -------------------------
(define-read-only (quote-sell-yes (m uint) (amount uint))
  (let (
    (b  (get-b-or0 m))
    (qy (get-qy-or0 m))
    (qn (get-qn-or0 m))
    (rY (get-ry-or0 m))
    (rN (get-rn-or0 m))
  )
    (if (or (is-eq b u0) (is-eq amount u0) (> amount qy))
        (ok { proceeds: u0, feeProtocol: u0, feeLP: u0, total: u0, drip: u0, brc20: u0, team: u0 })
        (let (
          (c0 (cost-tilde b qy qn rY rN))
          (c1 (cost-tilde b (- qy amount) qn rY rN))
          (diff (- c0 c1))
        )
          (if (<= diff 0)
            (ok { proceeds: u0, feeProtocol: u0, feeLP: u0, total: u0, drip: u0, brc20: u0, team: u0 })
            (let (
              (c  (to-uint diff))
              (pB (var-get protocol-fee-bps))
              (lB (var-get lp-fee-bps))
              (fP0 (ceil-bps c pB))
              (fP  (minu fP0 c))
              (rem (- c fP))
              (fL0 (ceil-bps c lB))
              (fL  (minu fL0 rem))
              (dr (/ (* fP (var-get pct-drip)) u100))
              (br (/ (* fP (var-get pct-brc))  u100))
              (tm (- fP (+ dr br)))
              (net (- c (+ fP fL)))
            )
              (ok { proceeds: c, feeProtocol: fP, feeLP: fL, total: net, drip: dr, brc20: br, team: tm })
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
    (rY (get-ry-or0 m))
    (rN (get-rn-or0 m))
  )
    (if (or (is-eq b u0) (is-eq amount u0) (> amount qn))
        (ok { proceeds: u0, feeProtocol: u0, feeLP: u0, total: u0, drip: u0, brc20: u0, team: u0 })
        (let (
          (c0 (cost-tilde b qy qn rY rN))
          (c1 (cost-tilde b qy (- qn amount) rY rN))
          (diff (- c0 c1))
        )
          (if (<= diff 0)
            (ok { proceeds: u0, feeProtocol: u0, feeLP: u0, total: u0, drip: u0, brc20: u0, team: u0 })
            (let (
              (c  (to-uint diff))
              (pB (var-get protocol-fee-bps))
              (lB (var-get lp-fee-bps))
              (fP0 (ceil-bps c pB))
              (fP  (minu fP0 c))
              (rem (- c fP))
              (fL0 (ceil-bps c lB))
              (fL  (minu fL0 rem))
              (dr (/ (* fP (var-get pct-drip)) u100))
              (br (/ (* fP (var-get pct-brc))  u100))
              (tm (- fP (+ dr br)))
              (net (- c (+ fP fL)))
            )
              (ok { proceeds: c, feeProtocol: fP, feeLP: fL, total: net, drip: dr, brc20: br, team: tm })
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

(define-read-only (get-r-yes (m uint)) (get-ry-or0 m))
(define-read-only (get-r-no  (m uint)) (get-rn-or0 m))
(define-read-only (get-bias-locked-ro (m uint)) (get-bias-locked m))

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

(define-read-only (get-self)
  (self-principal)
)
