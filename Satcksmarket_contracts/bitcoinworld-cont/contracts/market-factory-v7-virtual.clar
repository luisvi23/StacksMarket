;; -----------------------------------------------------------
;; market-factory-v8-bias (Fixed-b LMSR + bias/virtual liquidity)
;; - NO virtual shares.
;; - Bias rY/rN affects pricing only (NOT redeemable).
;; - Normalized biased cost:
;;   C_tilde(q) = b*ln(exp((qY+rY)/b)+exp((qN+rN)/b)) - b*ln(exp(rY/b)+exp(rN/b))
;; -----------------------------------------------------------

(define-constant ADMIN 'ST1PSHE32YTEE21FGYEVTA24N681KRGSQM4VF9XZP)

;; ------------------------- global fee config -------------------------
(define-data-var protocol-fee-bps uint u0)
(define-data-var lp-fee-bps       uint u0)

(define-data-var pct-drip uint u50)
(define-data-var pct-brc  uint u30)
(define-data-var pct-team uint u20)

(define-data-var DRIP_VAULT principal ADMIN)
(define-data-var BRC20_VAULT principal ADMIN)
(define-data-var TEAM_WALLET principal ADMIN)
(define-data-var LP_WALLET   principal ADMIN)

(define-data-var fees-locked bool false)
(define-data-var SELF principal ADMIN)

;; --------------------------- per-market state ------------------------
(define-map m-status      { m: uint } { s: (string-ascii 10) })
(define-map m-outcome     { m: uint } { o: (string-ascii 3) })
(define-map m-initialized { m: uint } { v: bool })
(define-map m-paused      { m: uint } { v: bool })
(define-map m-max-trade   { m: uint } { v: uint })

;; REAL LMSR state (redeemable shares)
(define-map m-q-yes { m: uint } { q: uint })
(define-map m-q-no  { m: uint } { q: uint })
(define-map m-pool  { m: uint } { p: uint })
(define-map m-b     { m: uint } { b: uint })

;; BIAS (virtual liquidity) - pricing only
(define-map m-r-yes { m: uint } { r: uint })
(define-map m-r-no  { m: uint } { r: uint })
(define-map m-bias-locked { m: uint } { v: bool })

;; caps and spent
(define-map user-caps  { m: uint, user: principal } { cap: uint })
(define-map user-spent { m: uint, user: principal } { spent: uint })

;; ledgers
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

(define-constant ERR-NO-WALLET-BAL (err u760))
(define-constant ERR-TOKEN-READ    (err u761))

(define-constant ERR-NO-SHARES        (err u770))
(define-constant ERR-POOL-LIQUIDITY   (err u771))
(define-constant ERR-BAD-REFUND       (err u772))

(define-constant ERR-BIAS-LOCKED       (err u780))
(define-constant ERR-BIAS-NONZERO-Q    (err u781))
(define-constant ERR-BIAS-PCT          (err u782))

;; Optional but recommended to avoid "stuck insolvent" states with UNIT=1:
(define-constant ERR-TRADE-INSOLVENT   (err u783))

;; -------------------------- math constants --------------------------
(define-constant SCALE u1000000)
(define-constant SCALE-INT (to-int SCALE))
(define-constant LN2-SCALED (to-int u693147)) ;; ln(2)*1e6

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

(define-constant UNIT u1) ;; 1 share = 1 sat redeem

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

(define-private (ensure-user-balance (need uint))
  (let ((bal (unwrap! (contract-call? .sbtc-v3 get-balance tx-sender) ERR-TOKEN-READ)))
    (asserts! (>= bal need) ERR-NO-WALLET-BAL)
    (ok true)
  )
)

(define-private (abs-int (x int))
  (if (< x 0) (- 0 x) x)
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
;; exp_taylor(x) for x scaled 1e6, accurate when x in [-ln2, 0].
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

;; exp_neg_fixed(x): returns exp(x)*1e6 for x <= 0 (scaled).
;; Uses: x = -(k*ln2 + r), r in [0,ln2). exp(x) = exp(-r) / 2^k.
;; For k >= 20, exp(x)*1e6 < 1 so we return 0 (safe underflow).
(define-private (exp-neg-fixed (x int))
  (let ((negx (- 0 x)))
    (if (<= x 0)
        (let (
          (k-int (/ negx LN2-SCALED)) ;; >= 0
          (k (to-uint k-int))
          (r (- negx (* k-int LN2-SCALED))) ;; in [0,ln2)
          (er (exp-taylor (- 0 r))) ;; exp(-r) scaled
        )
          (if (>= k u20)
              0
              (let ((den (to-int (bit-shift-left u1 k))))
                (/ er den)))
        )
        ;; Should not happen if used correctly; fallback via reciprocal is not needed here.
        SCALE-INT))
)

;; ln(y) for y in [0.5,2]*SCALE (scaled) via atanh series:
;; ln(y) = 2*(t + t^3/3 + t^5/5 + t^7/7 + t^9/9), t=(y-1)/(y+1)
(define-private (ln-atanh (y int))
  (let (
    (num (- y SCALE-INT))
    (den (+ y SCALE-INT))
    (t   (/ (* num SCALE-INT) den)) ;; scaled
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

;; ln_general(y): y scaled 1e6, y > 0.
;; Normalizes by powers of 2 into [0.5,2]*SCALE using unrolled steps.
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

;; ln(exp(a)+exp(b)) (a,b scaled). Uses stable log-sum-exp.
;; Only needs exp(delta) where delta <= 0.
(define-private (ln-sum-exp (a int) (b int))
  (let (
    (m (if (> a b) a b))
    (n (if (> a b) b a))
    (delta (- n m)) ;; <= 0
    (ed (exp-neg-fixed delta)) ;; exp(delta) scaled in [0..SCALE]
    (one-plus (+ SCALE-INT ed)) ;; in [SCALE..2SCALE]
    (ln1p (ln-atanh one-plus))
  )
    (+ m ln1p)
  )
)

;; Unbiased LMSR cost: C(q)=b*ln(exp(qY/b)+exp(qN/b))
(define-private (cost-unbiased (b uint) (qY uint) (qN uint))
  (let (
    (B (to-int b))
    (bpos (> b u0))
    (a (if bpos (/ (* (to-int qY) SCALE-INT) B) 0))
    (c (if bpos (/ (* (to-int qN) SCALE-INT) B) 0))
    (lnsum (ln-sum-exp a c)) ;; scaled
  )
    (if bpos (/ (* B lnsum) SCALE-INT) 0)
  )
)

;; Biased normalized cost: C_tilde(q)=C(q+r)-C(r)
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
    (asserts! (and (>= p-yes u1) (<= p-yes u99)) ERR-BIAS-PCT)

    ;; only before any real shares exist
    (let (
      (ys (default-to u0 (get s (map-get? yes-supply { m: m })) ))
      (ns (default-to u0 (get s (map-get? no-supply  { m: m })) ))
    )
      (asserts! (is-eq ys u0) ERR-BIAS-NONZERO-Q)
      (asserts! (is-eq ns u0) ERR-BIAS-NONZERO-Q)
    )

    (let ((b (get-b-or0 m)))
      (asserts! (> b u0) ERR-B-ZERO)

      ;; ratio = p/(1-p) with p = p-yes/100. Use percent rational scaled 1e6:
      ;; ratio_scaled = (p-yes/(100-p-yes))*1e6
      (let (
        (den (- u100 p-yes))
        (ratio ( / (* (to-int p-yes) SCALE-INT) (to-int den) ))
        (lnr (ln-general ratio)) ;; ln(ratio) scaled 1e6 (can be negative)
        (rdiff-int (/ (* (to-int b) lnr) SCALE-INT))
        (rdiff (to-uint (abs-int rdiff-int)))
      )
        ;; unsigned equivalent: if p>=50 set rY=rdiff,rN=0 else rY=0,rN=rdiff
        (if (>= p-yes u50)
            (begin
              (map-set m-r-yes { m: m } { r: rdiff })
              (map-set m-r-no  { m: m } { r: u0 })
              true)
            (begin
              (map-set m-r-yes { m: m } { r: u0 })
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

    ;; bias defaults to 50/50 and unlocked
    (map-set m-r-yes { m: m } { r: u0 })
    (map-set m-r-no  { m: m } { r: u0 })
    (map-set m-bias-locked { m: m } { v: false })

    ;; fixed b
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

          ;; OPTIONAL: trade-solvency guard (recommended with UNIT=1)
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

          ;; USER -> CONTRACT (base only)
          (try! (contract-call? .sbtc-v3 transfer base tx-sender (var-get SELF)))

          ;; protocol fees
          (if (> feeP u0)
            (begin
              (if (> drip u0) (try! (contract-call? .sbtc-v3 transfer drip tx-sender (var-get DRIP_VAULT))) true)
              (if (> brc  u0) (try! (contract-call? .sbtc-v3 transfer brc  tx-sender (var-get BRC20_VAULT))) true)
              (if (> team u0) (try! (contract-call? .sbtc-v3 transfer team tx-sender (var-get TEAM_WALLET))) true)
              true)
            true)

          ;; LP fee
          (if (> feeL u0)
            (try! (contract-call? .sbtc-v3 transfer feeL tx-sender (var-get LP_WALLET)))
            true)

          ;; mint shares + update real q
          (if yes?
            (begin
              (mint-yes m tx-sender amount)
              (map-set m-q-yes { m: m } { q: (+ qy amount) }))
            (begin
              (mint-no m tx-sender amount)
              (map-set m-q-no { m: m } { q: (+ qn amount) })))

          ;; pool increases by base
          (map-set m-pool { m: m } { p: (+ (get-pool-or0 m) base) })

          (add-spent m tx-sender total)
          (ok amount)
        )
      )
    )
  )
)

(define-public (buy-yes (m uint) (amount uint)) (do-buy m amount true))
(define-public (buy-no  (m uint) (amount uint)) (do-buy m amount false))

;; AUTO BUY variants: keep same interface as v7
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

          (try! (contract-call? .sbtc-v3 transfer base tx-sender (var-get SELF)))

          (if (> feeP u0)
            (begin
              (if (> drip u0) (try! (contract-call? .sbtc-v3 transfer drip tx-sender (var-get DRIP_VAULT))) true)
              (if (> brc  u0) (try! (contract-call? .sbtc-v3 transfer brc  tx-sender (var-get BRC20_VAULT))) true)
              (if (> team u0) (try! (contract-call? .sbtc-v3 transfer team tx-sender (var-get TEAM_WALLET))) true)
              true)
            true)

          (if (> feeL u0)
            (try! (contract-call? .sbtc-v3 transfer feeL tx-sender (var-get LP_WALLET)))
            true)

          (mint-yes m tx-sender amount)
          (map-set m-q-yes { m: m } { q: (+ qy amount) })

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

          (try! (contract-call? .sbtc-v3 transfer base tx-sender (var-get SELF)))

          (if (> feeP u0)
            (begin
              (if (> drip u0) (try! (contract-call? .sbtc-v3 transfer drip tx-sender (var-get DRIP_VAULT))) true)
              (if (> brc  u0) (try! (contract-call? .sbtc-v3 transfer brc  tx-sender (var-get BRC20_VAULT))) true)
              (if (> team u0) (try! (contract-call? .sbtc-v3 transfer team tx-sender (var-get TEAM_WALLET))) true)
              true)
            true)

          (if (> feeL u0)
            (try! (contract-call? .sbtc-v3 transfer feeL tx-sender (var-get LP_WALLET)))
            true)

          (mint-no m tx-sender amount)
          (map-set m-q-no { m: m } { q: (+ qn amount) })

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
            (feeP (ceil-bps base pB))
            (feeL (ceil-bps base lB))
            (drip (/ (* feeP (var-get pct-drip)) u100))
            (brc  (/ (* feeP (var-get pct-brc))  u100))
            (team (- feeP (+ drip brc)))
            (totalFees (+ feeP feeL))
          )
            (asserts! (>= pool base) ERR-POOL-LIQUIDITY)

            ;; fees paid by user wallet (same as your v7)
            (if (> totalFees u0)
              (begin
                (try! (ensure-user-balance totalFees))

                (if (> feeP u0)
                  (begin
                    (if (> drip u0) (try! (contract-call? .sbtc-v3 transfer drip user (var-get DRIP_VAULT))) true)
                    (if (> brc  u0) (try! (contract-call? .sbtc-v3 transfer brc  user (var-get BRC20_VAULT))) true)
                    (if (> team u0) (try! (contract-call? .sbtc-v3 transfer team user (var-get TEAM_WALLET))) true)
                    true)
                  true)

                (if (> feeL u0)
                  (try! (contract-call? .sbtc-v3 transfer feeL user (var-get LP_WALLET)))
                  true)
              )
              true
            )

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

            ;; refund from pool
            (as-contract (try! (contract-call? .sbtc-v3 transfer base (var-get SELF) user)))
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

;; AUTO SELL with slippage on net proceeds (same interface as v7)
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
            (feeP (ceil-bps base pB))
            (feeL (ceil-bps base lB))
            (totalFees (+ feeP feeL))
            (net (if (> base totalFees) (- base totalFees) u0))
          )
            (asserts! (>= pool base) ERR-POOL-LIQUIDITY)
            (asserts! (>= net min-proceeds) ERR-SLIPPAGE)

            ;; fees paid by user wallet
            (if (> totalFees u0)
              (begin
                (try! (ensure-user-balance totalFees))
                (let (
                  (drip (/ (* feeP (var-get pct-drip)) u100))
                  (brc  (/ (* feeP (var-get pct-brc))  u100))
                  (team (- feeP (+ drip brc)))
                )
                  (if (> feeP u0)
                    (begin
                      (if (> drip u0) (try! (contract-call? .sbtc-v3 transfer drip user (var-get DRIP_VAULT))) true)
                      (if (> brc  u0) (try! (contract-call? .sbtc-v3 transfer brc  user (var-get BRC20_VAULT))) true)
                      (if (> team u0) (try! (contract-call? .sbtc-v3 transfer team user (var-get TEAM_WALLET))) true)
                      true)
                    true)
                  (if (> feeL u0)
                    (try! (contract-call? .sbtc-v3 transfer feeL user (var-get LP_WALLET)))
                    true)
                )
              )
              true)

            ;; burn + update q
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

            (as-contract (try! (contract-call? .sbtc-v3 transfer base (var-get SELF) user)))
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

    ;; solvency check uses REAL supply only
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
    (ok { cost: c, feeProtocol: fP, feeLP: fL, total: tot, drip: dr, brc20: br, team: tm })
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
    (ok { cost: c, feeProtocol: fP, feeLP: fL, total: tot, drip: dr, brc20: br, team: tm })
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
(define-read-only (get-r-yes (m uint))       (get-ry-or0 m))
(define-read-only (get-r-no  (m uint))       (get-rn-or0 m))
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

(define-read-only (get-self) (var-get SELF))
