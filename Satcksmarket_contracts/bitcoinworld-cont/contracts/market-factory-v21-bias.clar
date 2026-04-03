;; ===========================================================
;; market-factory-v21-bias
;;
;; v21 extends v20 with LADDER MARKET support (scalar/range markets).
;; Binary markets: Fixed-b LMSR + bias/virtual liquidity (unchanged from v20).
;; Ladder markets: a "ladder group" groups multiple binary market rungs sharing
;;   one question but with different thresholds (e.g. "Will BTC reach $X by date?").
;;   Each rung is a standard binary market internally; the group is resolved in one
;;   admin call, then each rung is resolved individually via resolve-rung.
;;
;; UPDATE (v20): 1 share = 1 STX (math in STX, transfers in uSTX)
;; UPDATE (v20): fees calculated in uSTX (precise % for small tickets)
;; - LMSR math, shares, and b are in STX units (integers)
;; - Transfers, pools, caps, and fees are in uSTX (UNIT=1_000_000)
;; - Quotes return uSTX for UI/backward compatibility
;;
;; UPDATE (v20): "buy by sats" without binary search.
;; Adds:
;;  - exp-fixed (general exp for +/- in 1e6 fixed)
;;  - invert-buy-shares (closed-form inversion for binary LMSR)
;;  - refine-shares-updown (bounded 4-step correction: 2 down + 2 up)
;;  - quote-buy-yes-by-sats / quote-buy-no-by-sats (1 read-only call)
;;
;; Bias (rY/rN) is pricing-only (adds to q in pricing), redeem uses real shares only.
;;
;; Clarity v4, Epoch 3.3
;; ===========================================================

(define-constant ADMIN 'SP3N5CN0PE7YRRP29X7K9XG22BT861BRS5BN8HFFA)
(define-constant EMPTY-BUY-QUOTE
  { cost: u0, feeProtocol: u0, feeLP: u0, total: u0, walletA: u0, walletB: u0 }
)

;; ------------------------- global fee config -------------------------
(define-data-var protocol-fee-bps uint u0)
(define-data-var lp-fee-bps       uint u0)

;; protocol split must sum to 100 (pct-a + pct-b = 100)
(define-data-var pct-a uint u50)
(define-data-var pct-b uint u50)

;; fee recipients (default ADMIN until configured)
(define-data-var PROTOCOL_WALLET_A principal ADMIN)
(define-data-var PROTOCOL_WALLET_B principal ADMIN)
(define-data-var LP_WALLET         principal ADMIN)

(define-data-var fees-locked bool false)

;; --------------------------- per-market state ------------------------
(define-map m-status      { m: uint } { s: (string-ascii 10) })  ;; "open" | "resolved"
(define-map m-outcome     { m: uint } { o: (string-ascii 3) })   ;; "" | "YES" | "NO"
(define-map m-initialized { m: uint } { v: bool })
(define-map m-paused      { m: uint } { v: bool })
(define-map m-max-trade   { m: uint } { v: uint }) ;; max total per trade (uSTX)
(define-map m-close-time { m: uint } { v: uint }) ;; 0 = no auto-close, else trading closes at this unix timestamp (UTC)

;; LMSR REAL state (shares reales) - STX units
(define-map m-q-yes { m: uint } { q: uint })
(define-map m-q-no  { m: uint } { q: uint })
(define-map m-pool  { m: uint } { p: uint }) ;; uSTX
(define-map m-b     { m: uint } { b: uint }) ;; STX

;; BIAS (virtual liquidity) - pricing only (STX)
(define-map m-r-yes { m: uint } { r: uint })
(define-map m-r-no  { m: uint } { r: uint })
(define-map m-bias-locked { m: uint } { v: bool })

;; legacy caps/spent storage (kept for ABI/state backward compatibility) - uSTX
(define-map user-caps  { m: uint, user: principal } { cap: uint })
(define-map user-spent { m: uint, user: principal } { spent: uint })

;; YES/NO ledgers (per market) - STX shares
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

;; wallet errors
(define-constant ERR-NO-WALLET-BAL (err u760))

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
(define-constant ERR-MARKET-CLOSED-BY-TIME (err u784))

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

(define-constant UNIT u1000000) ;; 1 share = 1 STX (1_000_000 uSTX)

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

(define-private (stx->ustx (amt-stx uint))
  (* amt-stx UNIT)
)

(define-private (ustx->stx (amt-ustx uint))
  (/ amt-ustx UNIT)
)

(define-private (ensure-user-balance (need-ustx uint))
  (let ((bal (stx-get-balance tx-sender)))
    (asserts! (>= bal need-ustx) ERR-NO-WALLET-BAL)
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
  current-contract
)

;; user -> contract (ONE transfer)
(define-private (xfer-in (amt uint))
  (if (> amt u0)
      (stx-transfer? amt tx-sender current-contract)
      (ok true))
)

;; contract -> recipient
(define-private (xfer-out (amt uint) (to principal))
  (if (or (is-eq amt u0) (is-eq to current-contract))
      (ok true)
      (match (as-contract? ((with-stx amt))
               (match (stx-transfer? amt tx-sender to)
                 okv u0
                 errv errv)
               u0)
        code (if (is-eq code u0) (ok true) (err code))
        allowance-idx (err allowance-idx)))
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

(define-private (get-close-time-or0 (m uint))
  (default-to u0 (get v (map-get? m-close-time { m: m })))
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
    (s0  { y: y, k: 0 })
    (s1  (ln-norm-step s0))
    (s2  (ln-norm-step s1))
    (s3  (ln-norm-step s2))
    (s4  (ln-norm-step s3))
    (s5  (ln-norm-step s4))
    (s6  (ln-norm-step s5))
    (s7  (ln-norm-step s6))
    (s8  (ln-norm-step s7))
    (s9  (ln-norm-step s8))
    (s10 (ln-norm-step s9))
    (s11 (ln-norm-step s10))
    (s12 (ln-norm-step s11))
    (s13 (ln-norm-step s12))
    (s14 (ln-norm-step s13))
    (yn  (get y s14))
    (k   (get k s14))
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

;; bounded refinement: ensure cost(shares) <= baseBudget, up to 2 steps down + 2 steps up
(define-private (refine-shares-updown (b uint) (qy uint) (qn uint) (rY uint) (rN uint) (baseBudget uint) (yes? bool) (s0 uint))
  (let (
    ;; --- step down: find largest s <= s0 with cost(s) <= baseBudget ---
    (c0 (calculate-cost b qy qn rY rN s0 yes?))
    (s1 (if (> c0 baseBudget) (if (> s0 u0) (- s0 u1) u0) s0))
    (c1 (calculate-cost b qy qn rY rN s1 yes?))
    (s2 (if (> c1 baseBudget) (if (> s1 u0) (- s1 u1) u0) s1))
    ;; --- step up: squeeze 1 or 2 more shares if budget allows ---
    (cup1 (calculate-cost b qy qn rY rN (+ s2 u1) yes?))
    (s3 (if (<= cup1 baseBudget) (+ s2 u1) s2))
    (cup2 (calculate-cost b qy qn rY rN (+ s3 u1) yes?))
    (s4 (if (<= cup2 baseBudget) (+ s3 u1) s3))
  )
    s4
  )
)

;; ---------------------- fixed b: init once --------------------------
(define-private (init-b (m uint) (initial-liquidity-stx uint))
  (begin
    (let (
      (num (* (to-int initial-liquidity-stx) SCALE-INT))
      (den LN2-SCALED)
    )
      (map-set m-b { m: m } { b: (to-uint (/ num den)) })
    )
    true
  )
)

;; ------------------------ caps and spent helpers --------------------
(define-read-only (get-cap (m uint) (who principal))
  (default-to u0 (get cap (map-get? user-caps { m: m, user: who })))
)

(define-read-only (get-spent (m uint) (who principal))
  (default-to u0 (get spent (map-get? user-spent { m: m, user: who })))
)

;; ----------------------------- guards --------------------------------
(define-private (ensure-open (m uint))
  (begin
    (asserts! (is-eq (get-status-str m) "open") (err u100))
    (asserts! (is-eq (get-paused m) false) ERR-PAUSED)
    (asserts! (is-eq (get-initialized-bool m) true) ERR-NOT-INIT)
    (let ((closeTs (get-close-time-or0 m)))
      (if (> closeTs u0)
          (asserts! (< stacks-block-time closeTs) ERR-MARKET-CLOSED-BY-TIME)
          true))
    (ok true)
  )
)

(define-private (check-trade-limit (m uint) (total-ustx uint))
  (let ((mt (get-max-trade-or0 m)))
    (if (and (> mt u0) (> total-ustx mt)) (err u722) (ok true))
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

(define-public (set-fee-recipients (walletA principal) (walletB principal) (lp principal))
  (begin
    (try! (only-admin))
    (try! (guard-not-locked))
    (var-set PROTOCOL_WALLET_A walletA)
    (var-set PROTOCOL_WALLET_B walletB)
    (var-set LP_WALLET         lp)
    (ok true)
  )
)

(define-public (set-protocol-split (pa uint) (pb uint))
  (begin
    (try! (only-admin))
    (try! (guard-not-locked))
    (asserts! (is-eq (+ pa pb) u100) (err u742))
    (var-set pct-a pa)
    (var-set pct-b pb)
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

(define-public (set-market-close-time (m uint) (close-time uint))
  (begin
    (try! (only-admin))
    (asserts! (is-eq (get-initialized-bool m) true) ERR-NOT-INIT)
    ;; allow u0 to clear; otherwise require a future timestamp
    (if (is-eq close-time u0)
        true
        (asserts! (> close-time stacks-block-time) (err u785)))
    (map-set m-close-time { m: m } { v: close-time })
    (ok true)
  )
)

;; ---------------------- reset-market-bias ----------------------------
;; Clears bias and unlocks so set-market-bias can be called again.
;; Only allowed when no real shares have been issued (ys == 0 && ns == 0).
(define-public (reset-market-bias (m uint))
  (begin
    (try! (only-admin))
    (asserts! (is-eq (get-initialized-bool m) true) ERR-NOT-INIT)
    (asserts! (is-eq (get-status-str m) "open") ERR-NOT-OPEN)
    (let (
      (ys (default-to u0 (get s (map-get? yes-supply { m: m }))))
      (ns (default-to u0 (get s (map-get? no-supply  { m: m }))))
    )
      (asserts! (is-eq ys u0) ERR-BIAS-NONZERO-Q)
      (asserts! (is-eq ns u0) ERR-BIAS-NONZERO-Q)
    )
    (map-set m-r-yes      { m: m } { r: u0 })
    (map-set m-r-no       { m: m } { r: u0 })
    (map-set m-bias-locked { m: m } { v: false })
    (ok true)
  )
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

    (let ((liq-stx (ustx->stx initial-liquidity)))
      (asserts! (> liq-stx u0) (err u701))
      (map-set m-status      { m: m } { s: "open" })
      (map-set m-outcome     { m: m } { o: "" })
      (map-set m-initialized { m: m } { v: true })
      (map-set m-paused      { m: m } { v: false })
      (map-set m-max-trade   { m: m } { v: u0 })
      (map-set m-close-time { m: m } { v: u0 })
      (map-set m-q-yes       { m: m } { q: u0 })
      (map-set m-q-no        { m: m } { q: u0 })
      (map-set m-pool        { m: m } { p: initial-liquidity })
      (map-set yes-supply    { m: m } { s: u0 })
      (map-set no-supply     { m: m } { s: u0 })

      (map-set m-r-yes { m: m } { r: u0 })
      (map-set m-r-no  { m: m } { r: u0 })
      (map-set m-bias-locked { m: m } { v: false })

      (init-b m liq-stx)
      (ok (get-b-or0 m))
    )
  )
)

(define-public (buy-yes-auto (m uint) (amount uint) (target-cap uint) (max-cost uint))
  (begin
    (try! (ensure-open m))
    (asserts! (> (get-b-or0 m) u0) ERR-B-ZERO)
    (asserts! (> amount u0) ERR-AMOUNT)
    (asserts! (> max-cost u0) ERR-SLIPPAGE)
    ;; target-cap kept only for ABI/UI compatibility; ignored by contract.
    target-cap

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
        (baseStx (if (> c0 u0) c0 u1))
        (baseUstx (stx->ustx baseStx))

        (feeP (ceil-bps baseUstx pB))
        (feeL (ceil-bps baseUstx lB))

        (walletA (/ (* feeP (var-get pct-a)) u100))
        (walletB (- feeP walletA))

        (total (+ baseUstx (+ feeP feeL)))
      )
        (try! (check-trade-limit m total))
        (asserts! (<= total max-cost) ERR-SLIPPAGE)
        (try! (ensure-user-balance total))

        (let (
          (pool0 (get-pool-or0 m))
          (pool1 (+ pool0 baseUstx))
          (ys0 (default-to u0 (get s (map-get? yes-supply { m: m })) ))
          (ns0 (default-to u0 (get s (map-get? no-supply  { m: m })) ))
          (ys1 (+ ys0 amount))
        )
          (asserts! (and (>= pool1 (* ys1 UNIT)) (>= pool1 (* ns0 UNIT))) ERR-TRADE-INSOLVENT)
        )

        ;;  ONE transfer: USER -> CONTRACT (total)
        (try! (xfer-in total))

        ;;  fees paid by CONTRACT
        (try! (xfer-out walletA (var-get PROTOCOL_WALLET_A)))
        (try! (xfer-out walletB (var-get PROTOCOL_WALLET_B)))
        (try! (xfer-out feeL (var-get LP_WALLET)))

        (mint-yes m tx-sender amount)
        (map-set m-q-yes { m: m } { q: (+ (get-qy-or0 m) amount) })

        (map-set m-pool { m: m } { p: (+ (get-pool-or0 m) baseUstx) })
        (ok amount)
      )
    )
  )
)

(define-public (buy-no-auto (m uint) (amount uint) (target-cap uint) (max-cost uint))
  (begin
    (try! (ensure-open m))
    (asserts! (> (get-b-or0 m) u0) ERR-B-ZERO)
    (asserts! (> amount u0) ERR-AMOUNT)
    (asserts! (> max-cost u0) ERR-SLIPPAGE)
    ;; target-cap kept only for ABI/UI compatibility; ignored by contract.
    target-cap

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
        (baseStx (if (> c0 u0) c0 u1))
        (baseUstx (stx->ustx baseStx))

        (feeP (ceil-bps baseUstx pB))
        (feeL (ceil-bps baseUstx lB))

        (walletA (/ (* feeP (var-get pct-a)) u100))
        (walletB (- feeP walletA))

        (total (+ baseUstx (+ feeP feeL)))
      )
        (try! (check-trade-limit m total))
        (asserts! (<= total max-cost) ERR-SLIPPAGE)
        (try! (ensure-user-balance total))

        (let (
          (pool0 (get-pool-or0 m))
          (pool1 (+ pool0 baseUstx))
          (ys0 (default-to u0 (get s (map-get? yes-supply { m: m })) ))
          (ns0 (default-to u0 (get s (map-get? no-supply  { m: m })) ))
          (ns1 (+ ns0 amount))
        )
          (asserts! (and (>= pool1 (* ys0 UNIT)) (>= pool1 (* ns1 UNIT))) ERR-TRADE-INSOLVENT)
        )

        ;;  ONE transfer: USER -> CONTRACT (total)
        (try! (xfer-in total))

        ;;  fees paid by CONTRACT
        (try! (xfer-out walletA (var-get PROTOCOL_WALLET_A)))
        (try! (xfer-out walletB (var-get PROTOCOL_WALLET_B)))
        (try! (xfer-out feeL (var-get LP_WALLET)))

        (mint-no m tx-sender amount)
        (map-set m-q-no { m: m } { q: (+ (get-qn-or0 m) amount) })

        (map-set m-pool { m: m } { p: (+ (get-pool-or0 m) baseUstx) })
        (ok amount)
      )
    )
  )
)

;; --------------------------- SELL helpers ----------------------------
(define-private (do-sell-auto (m uint) (amount uint) (yes? bool) (min-proceeds uint))
  (begin
    (try! (ensure-open m))
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
            (baseStx (to-uint diff))
            (baseUstx (stx->ustx baseStx))

            (pB   (var-get protocol-fee-bps))
            (lB   (var-get lp-fee-bps))

            (feeP0 (ceil-bps baseUstx pB))
            (feeP  (minu feeP0 baseUstx))
            (rem   (- baseUstx feeP))
            (feeL0 (ceil-bps baseUstx lB))
            (feeL  (minu feeL0 rem))

            (walletA (/ (* feeP (var-get pct-a)) u100))
            (walletB (- feeP walletA))

            (totalFees (+ feeP feeL))
            (net (- baseUstx totalFees))
          )
            (try! (check-trade-limit m baseUstx))
            (asserts! (>= pool baseUstx) ERR-POOL-LIQUIDITY)
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
            (try! (xfer-out walletA (var-get PROTOCOL_WALLET_A)))
            (try! (xfer-out walletB (var-get PROTOCOL_WALLET_B)))
            (try! (xfer-out feeL (var-get LP_WALLET)))

            (map-set m-pool { m: m } { p: (- pool baseUstx) })
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
    (asserts! (is-eq (get-initialized-bool m) true) ERR-NOT-INIT)
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
(define-read-only (get-withdrawable-surplus (m uint))
  (let (
    (ys (default-to u0 (get s (map-get? yes-supply { m: m })) ))
    (ns (default-to u0 (get s (map-get? no-supply  { m: m })) ))
    (p  (get-pool-or0 m))
    (out (default-to "" (get o (map-get? m-outcome { m: m } ))))
    (reserve
      (if (is-eq out "YES")
          (* ys UNIT)
          (if (is-eq out "NO") (* ns UNIT) u0)))
    (withdrawable (if (> p reserve) (- p reserve) u0))
  )
    {
      outcome: out,
      pool: p,
      winningSupplyPending: (if (is-eq out "YES") ys (if (is-eq out "NO") ns u0)),
      reserve: reserve,
      withdrawable: withdrawable
    }
  )
)

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
      (let (
        (reserve (if (is-eq out "YES") (* ys UNIT) (* ns UNIT)))
        (surplus (if (> p reserve) (- p reserve) u0))
      )
        (asserts! (> surplus u0) (err u710))
        (try! (xfer-out surplus ADMIN))
        (map-set m-pool { m: m } { p: (- p surplus) })
      )
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
    (baseU (stx->ustx c))
    (fP (ceil-bps baseU pB))
    (fL (ceil-bps baseU lB))
    (wA (/ (* fP (var-get pct-a)) u100))
    (wB (- fP wA))
    (tot (+ baseU (+ fP fL)))
    )
    (ok { cost: baseU, feeProtocol: fP, feeLP: fL, total: tot, walletA: wA, walletB: wB })
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
    (baseU (stx->ustx c))
    (fP (ceil-bps baseU pB))
    (fL (ceil-bps baseU lB))
    (wA (/ (* fP (var-get pct-a)) u100))
    (wB (- fP wA))
    (tot (+ baseU (+ fP fL)))
    )
    (ok { cost: baseU, feeProtocol: fP, feeLP: fL, total: tot, walletA: wA, walletB: wB })
  )
)

(define-private (total-from-base (base uint) (pB uint) (lB uint))
  (let (
    (feeP (ceil-bps base pB))
    (feeL (ceil-bps base lB))
  )
    (+ base (+ feeP feeL))
  )
)

(define-private (tighten-base-budget (budget uint) (pB uint) (lB uint))
  (let (
    (den (+ u10000 (+ pB lB)))
    (base0 (/ (* budget u10000) den))
  )
    (let (
      (t0 (total-from-base base0 pB lB))

      (b1 (if (> base0 u0) (- base0 u1) u0))
      (t1 (total-from-base b1 pB lB))

      (b2 (if (> base0 u1) (- base0 u2) u0))
      (t2 (total-from-base b2 pB lB))

      (b3 (if (> base0 u2) (- base0 u3) u0))
      (t3 (total-from-base b3 pB lB))

      (b4 (if (> base0 u3) (- base0 u4) u0))
      (t4 (total-from-base b4 pB lB))
    )
      (let (
        (baseDown
          (if (<= t0 budget) base0
            (if (<= t1 budget) b1
              (if (<= t2 budget) b2
                (if (<= t3 budget) b3
                  (if (<= t4 budget) b4 u0))))))
      )
        (let (
          (up1 (+ baseDown u1))
          (tup1 (total-from-base up1 pB lB))

          (up2 (+ baseDown u2))
          (tup2 (total-from-base up2 pB lB))

          (up3 (+ baseDown u3))
          (tup3 (total-from-base up3 pB lB))

          (up4 (+ baseDown u4))
          (tup4 (total-from-base up4 pB lB))
        )
          (if (<= tup4 budget) up4
            (if (<= tup3 budget) up3
              (if (<= tup2 budget) up2
                (if (<= tup1 budget) up1
                  baseDown))))
        )
      )
    )
  )
)

;; ------------------------ NEW: BUY quotes by sats -------------------
;; budget is TOTAL (base + fees) in uSTX. We compute a conservative baseBudget in uSTX,
;; convert to STX, invert, refine, then return final quote for those shares.
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
          (baseBudgetU (tighten-base-budget budget pB lB))
          (baseBudgetS (ustx->stx baseBudgetU))

          (qSelfP (+ qy rY))
          (qOtherP (+ qn rN))

          (s0 (invert-buy-shares b qSelfP qOtherP baseBudgetS))
          (s  (refine-shares-updown b qy qn rY rN baseBudgetS true s0))
        )
          (let ((q (unwrap-panic (quote-buy-yes m s))))
            (let ((tot (get total q)))
              ;; safety: if total > budget, step down once
              (if (and (> s u0) (> tot budget))
                  (let ((s2 (- s u1))
                        (q2 (unwrap-panic (quote-buy-yes m s2))))
                    (ok { shares: s2, budget: budget, baseBudget: baseBudgetU, quote: q2 })
                  )
                  (ok { shares: s, budget: budget, baseBudget: baseBudgetU, quote: q })
              )
            )
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
          (baseBudgetU (tighten-base-budget budget pB lB))
          (baseBudgetS (ustx->stx baseBudgetU))

          ;; for NO, self is qN', other is qY'
          (qSelfP (+ qn rN))
          (qOtherP (+ qy rY))

          (s0 (invert-buy-shares b qSelfP qOtherP baseBudgetS))
          (s  (refine-shares-updown b qy qn rY rN baseBudgetS false s0))
        )
          (let ((q (unwrap-panic (quote-buy-no m s))))
            (let ((tot (get total q)))
              (if (and (> s u0) (> tot budget))
                  (let ((s2 (- s u1))
                        (q2 (unwrap-panic (quote-buy-no m s2))))
                    (ok { shares: s2, budget: budget, baseBudget: baseBudgetU, quote: q2 })
                  )
                  (ok { shares: s, budget: budget, baseBudget: baseBudgetU, quote: q })
              )
            )
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
        (ok { proceeds: u0, feeProtocol: u0, feeLP: u0, total: u0, walletA: u0, walletB: u0 })
        (let (
          (c0 (cost-tilde b qy qn rY rN))
          (c1 (cost-tilde b (- qy amount) qn rY rN))
          (diff (- c0 c1))
        )
          (if (<= diff 0)
            (ok { proceeds: u0, feeProtocol: u0, feeLP: u0, total: u0, walletA: u0, walletB: u0 })
            (let (
              (c  (to-uint diff))
              (baseU (stx->ustx c))
              (pB (var-get protocol-fee-bps))
              (lB (var-get lp-fee-bps))
              (fP0 (ceil-bps baseU pB))
              (fP  (minu fP0 baseU))
              (rem (- baseU fP))
              (fL0 (ceil-bps baseU lB))
              (fL  (minu fL0 rem))
              (wA (/ (* fP (var-get pct-a)) u100))
              (wB (- fP wA))
              (net (- baseU (+ fP fL)))
            )
              (ok { proceeds: baseU, feeProtocol: fP, feeLP: fL, total: net, walletA: wA, walletB: wB })
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
        (ok { proceeds: u0, feeProtocol: u0, feeLP: u0, total: u0, walletA: u0, walletB: u0 })
        (let (
          (c0 (cost-tilde b qy qn rY rN))
          (c1 (cost-tilde b qy (- qn amount) rY rN))
          (diff (- c0 c1))
        )
          (if (<= diff 0)
            (ok { proceeds: u0, feeProtocol: u0, feeLP: u0, total: u0, walletA: u0, walletB: u0 })
            (let (
              (c  (to-uint diff))
              (baseU (stx->ustx c))
              (pB (var-get protocol-fee-bps))
              (lB (var-get lp-fee-bps))
              (fP0 (ceil-bps baseU pB))
              (fP  (minu fP0 baseU))
              (rem (- baseU fP))
              (fL0 (ceil-bps baseU lB))
              (fL  (minu fL0 rem))
              (wA (/ (* fP (var-get pct-a)) u100))
              (wB (- fP wA))
              (net (- baseU (+ fP fL)))
            )
              (ok { proceeds: baseU, feeProtocol: fP, feeLP: fL, total: net, walletA: wA, walletB: wB })
            )
          )
        )
    )
  )
)

;; --------------------------- market snapshot -------------------------
(define-read-only (get-market-snapshot (m uint))
  (let (
    (status (get-status-str m))
    (outcome (default-to "" (get o (map-get? m-outcome { m: m }))))
    (initialized (get-initialized-bool m))
    (paused (get-paused m))
    (maxTrade (get-max-trade-or0 m)) ;; uSTX
    (closeTime (get-close-time-or0 m))
    (tradingOpenNow
      (let ((closeTs (get-close-time-or0 m)))
        (and (is-eq status "open")
             (is-eq paused false)
             (is-eq initialized true)
             (if (> closeTs u0) (< stacks-block-time closeTs) true))))

    (pool (get-pool-or0 m)) ;; uSTX
    (b (get-b-or0 m))       ;; STX

    (qYes (get-qy-or0 m))
    (qNo  (get-qn-or0 m))

    (rYes (get-ry-or0 m))
    (rNo  (get-rn-or0 m))

    (yesSupply (default-to u0 (get s (map-get? yes-supply { m: m }))))
    (noSupply  (default-to u0 (get s (map-get? no-supply  { m: m }))))
  )
    (ok {
      status: status,
      outcome: outcome,
      initialized: initialized,
      paused: paused,
      maxTrade: maxTrade,
      closeTime: closeTime,
      closeHeight: closeTime, ;; legacy alias (value is unix timestamp)
      tradingOpenNow: tradingOpenNow,

      pool: pool,
      b: b,

      qYes: qYes,
      qNo: qNo,

      rYes: rYes,
      rNo: rNo,

      yesSupply: yesSupply,
      noSupply: noSupply
    })
  )
)

;; ---------------------- user financial snapshot ---------------------
(define-read-only (get-user-claimable (m uint) (who principal))
  (let (
    (status (get-status-str m))
    (outcome (default-to "" (get o (map-get? m-outcome { m: m }))))
    (yesBalance (default-to u0 (get bal (map-get? yes-holdings { m: m, user: who }))))
    (noBalance  (default-to u0 (get bal (map-get? no-holdings  { m: m, user: who }))))
    (winningShares
      (if (is-eq status "resolved")
          (if (is-eq outcome "YES")
              yesBalance
              (if (is-eq outcome "NO") noBalance u0))
          u0))
    (claimable (* winningShares UNIT))
  )
    {
      status: status,
      outcome: outcome,
      yesBalance: yesBalance,
      noBalance: noBalance,
      winningShares: winningShares,
      claimable: claimable,
      canRedeem: (and (is-eq status "resolved") (> winningShares u0))
    }
  )
)


;; --------------------------- extra getters --------------------------
(define-read-only (get-pool (m uint))        (get-pool-or0 m))
(define-read-only (get-b (m uint))           (get-b-or0 m))
(define-read-only (get-status (m uint))      (get-status-str m))
(define-read-only (get-close-time (m uint)) (get-close-time-or0 m))
(define-read-only (is-trading-open-now (m uint))
  (let (
    (status (get-status-str m))
    (paused (get-paused m))
    (closeTs (get-close-time-or0 m))
  )
    (and (is-eq status "open")
         (is-eq paused false)
         (is-eq (get-initialized-bool m) true)
         (if (> closeTs u0) (< stacks-block-time closeTs) true))
  )
)
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
    pctA:        (var-get pct-a),
    pctB:        (var-get pct-b)
  }
)

(define-read-only (get-fee-recipients)
  {
    walletA: (var-get PROTOCOL_WALLET_A),
    walletB: (var-get PROTOCOL_WALLET_B),
    lp:      (var-get LP_WALLET),
    locked:  (var-get fees-locked)
  }
)

(define-read-only (get-self)
  (self-principal)
)

;; ===========================================================
;; v21 LADDER MARKET EXTENSION
;; ===========================================================
;;
;; A "ladder group" is a set of binary markets (rungs) sharing one
;; question but with different numeric thresholds.  The group is
;; resolved in a single admin call (resolve-ladder-group) that
;; records the final observed value on-chain.  Individual rungs are
;; then resolved one-by-one via resolve-rung, which computes the
;; binary YES/NO outcome automatically from the stored final value
;; and the rung's threshold + operator, then delegates to the same
;; internal resolve logic as the existing `resolve` function.
;;
;; All threshold / final-value inputs are multiplied by 100 by the
;; caller so that 2 decimal places of precision are preserved while
;; staying in uint (e.g. $100.50 = 10050).
;;
;; New error codes start at u800 to avoid collisions with v20 codes.
;; ===========================================================

;; ------------------------- ladder error constants --------------------
(define-constant ERR-LADDER-ALREADY-EXISTS  (err u800))
(define-constant ERR-LADDER-NOT-FOUND       (err u801))
(define-constant ERR-LADDER-NOT-RESOLVED    (err u802))
(define-constant ERR-RUNG-NOT-FOUND         (err u803))
(define-constant ERR-RUNG-BAD-OPERATOR      (err u804))
(define-constant ERR-RUNG-ALREADY-EXISTS    (err u805))

;; --------------------- ladder group state maps ----------------------
;; All values keyed by group-id g (uint).

;; Human-readable title for the ladder group (e.g. "Will BTC reach $X by Jan 2025?")
(define-map ladder-group-title     { g: uint } { title:  (string-ascii 200) })
;; Data source / oracle description
(define-map ladder-group-source    { g: uint } { source: (string-ascii 200) })
;; Has the group been resolved yet?
(define-map ladder-group-resolved  { g: uint } { v: bool })
;; Final observed value * 100 (2 decimal places). Set by resolve-ladder-group.
(define-map ladder-group-final-value { g: uint } { v: uint })
;; Unix timestamp after which the group is expected to close
(define-map ladder-group-close-time { g: uint } { v: uint })

;; ----------------------- rung state maps ----------------------------
;; Each rung links a binary market-id (m) to a ladder group + threshold.

;; Which group does this market belong to?
(define-map rung-group     { m: uint } { g: uint })
;; Threshold * 100 (2 decimal places) the rung tests against
(define-map rung-threshold { m: uint } { v: uint })
;; "gte": YES if final-value >= threshold; "lte": YES if final-value <= threshold
(define-map rung-operator  { m: uint } { op: (string-ascii 3) })
;; Human-readable label shown in the UI (e.g. "$100", "$110")
(define-map rung-label     { m: uint } { label: (string-ascii 50) })

;; ----------------------- ladder group helpers -----------------------
(define-private (ladder-group-exists (g uint))
  (is-some (map-get? ladder-group-title { g: g }))
)

(define-private (get-ladder-resolved (g uint))
  (default-to false (get v (map-get? ladder-group-resolved { g: g })))
)

(define-private (get-ladder-final-value (g uint))
  (default-to u0 (get v (map-get? ladder-group-final-value { g: g })))
)

;; ----------------------- rung helpers --------------------------------
(define-private (rung-exists (m uint))
  (is-some (map-get? rung-group { m: m }))
)

;; Validate that operator is exactly "gte" or "lte"
(define-private (valid-operator (op (string-ascii 3)))
  (or (is-eq op "gte") (is-eq op "lte"))
)

;; Compute YES/NO given a final value, threshold, and operator string.
;; Returns "YES" or "NO" as (string-ascii 3).
(define-private (compute-rung-outcome
    (final-value uint)
    (threshold   uint)
    (op          (string-ascii 3)))
  (if (is-eq op "gte")
      (if (>= final-value threshold) "YES" "NO")
      ;; "lte"
      (if (<= final-value threshold) "YES" "NO"))
)

;; Internal resolve: same solvency checks + state transitions as `resolve`,
;; but accepts a pre-computed result string and does not re-check admin
;; (caller must have already done so).
(define-private (do-resolve (m uint) (result (string-ascii 3)))
  (begin
    (asserts! (is-eq (get-initialized-bool m) true) ERR-NOT-INIT)
    (asserts! (is-eq (get-status-str m) "open") (err u102))
    (asserts! (or (is-eq result "YES") (is-eq result "NO")) (err u103))
    (let (
      (ys  (default-to u0 (get s (map-get? yes-supply { m: m }))))
      (ns  (default-to u0 (get s (map-get? no-supply  { m: m }))))
      (p   (get-pool-or0 m))
      (req (if (is-eq result "YES") (* ys UNIT) (* ns UNIT)))
    )
      (asserts! (>= p req) ERR-INSOLVENT-RESOLVE)
      (map-set m-outcome { m: m } { o: result })
      (map-set m-status  { m: m } { s: "resolved" })
      (ok true)
    )
  )
)

;; ======================== PUBLIC: ladder group ========================

;; create-ladder-group
;; Admin registers a new ladder group.  g must not already exist.
(define-public (create-ladder-group
    (g          uint)
    (title      (string-ascii 200))
    (source     (string-ascii 200))
    (close-time uint))
  (begin
    (try! (only-admin))
    (asserts! (not (ladder-group-exists g)) ERR-LADDER-ALREADY-EXISTS)
    (map-set ladder-group-title     { g: g } { title:  title  })
    (map-set ladder-group-source    { g: g } { source: source })
    (map-set ladder-group-resolved  { g: g } { v: false })
    (map-set ladder-group-final-value { g: g } { v: u0 })
    (map-set ladder-group-close-time  { g: g } { v: close-time })
    (ok g)
  )
)

;; add-rung
;; Admin creates the underlying binary market (via create-market) and
;; registers the rung mapping.  g must already exist.
;; operator must be "gte" or "lte".
(define-public (add-rung
    (g               uint)
    (m               uint)
    (threshold       uint)
    (operator        (string-ascii 3))
    (label           (string-ascii 50))
    (initial-liquidity uint))
  (begin
    (try! (only-admin))
    ;; Group must exist
    (asserts! (ladder-group-exists g) ERR-LADDER-NOT-FOUND)
    ;; Market m must not already be a rung
    (asserts! (not (rung-exists m)) ERR-RUNG-ALREADY-EXISTS)
    ;; Operator must be valid
    (asserts! (valid-operator operator) ERR-RUNG-BAD-OPERATOR)
    ;; Create the underlying binary market
    (try! (create-market m initial-liquidity))
    ;; Register rung mappings
    (map-set rung-group     { m: m } { g:     g         })
    (map-set rung-threshold { m: m } { v:     threshold })
    (map-set rung-operator  { m: m } { op:    operator  })
    (map-set rung-label     { m: m } { label: label     })
    (ok m)
  )
)

;; resolve-ladder-group
;; Admin records the final observed value for a group and marks it as resolved.
;; This does NOT auto-resolve individual rungs. Call resolve-rung per rung.
(define-public (resolve-ladder-group (g uint) (final-value uint))
  (begin
    (try! (only-admin))
    (asserts! (ladder-group-exists g) ERR-LADDER-NOT-FOUND)
    ;; Idempotency guard: do not re-resolve an already-resolved group
    (asserts! (not (get-ladder-resolved g)) ERR-LADDER-ALREADY-EXISTS)
    (map-set ladder-group-resolved    { g: g } { v: true        })
    (map-set ladder-group-final-value { g: g } { v: final-value })
    (ok { group: g, finalValue: final-value })
  )
)

;; resolve-rung
;; Admin resolves a single rung market after its group has been resolved.
;; Outcome is computed automatically from the stored final value.
(define-public (resolve-rung (m uint))
  (begin
    (try! (only-admin))
    ;; Market must be a rung
    (asserts! (rung-exists m) ERR-RUNG-NOT-FOUND)
    (let (
      (g         (unwrap-panic (get g (map-get? rung-group     { m: m }))))
      (threshold (unwrap-panic (get v (map-get? rung-threshold { m: m }))))
      (operator  (unwrap-panic (get op (map-get? rung-operator { m: m }))))
    )
      ;; Group must be resolved first
      (asserts! (get-ladder-resolved g) ERR-LADDER-NOT-RESOLVED)
      (let (
        (final-value (get-ladder-final-value g))
        (result      (compute-rung-outcome final-value threshold operator))
      )
        (try! (do-resolve m result))
        (ok { market: m, group: g, finalValue: final-value, outcome: result })
      )
    )
  )
)

;; ======================== READ-ONLY: ladder ==========================

;; get-ladder-group-info
;; Returns all metadata for a ladder group.
(define-read-only (get-ladder-group-info (g uint))
  (let (
    (title-entry  (map-get? ladder-group-title      { g: g }))
    (source-entry (map-get? ladder-group-source     { g: g }))
    (res-entry    (map-get? ladder-group-resolved   { g: g }))
    (fv-entry     (map-get? ladder-group-final-value { g: g }))
    (ct-entry     (map-get? ladder-group-close-time  { g: g }))
  )
    {
      exists:     (is-some title-entry),
      title:      (default-to "" (get title  title-entry)),
      source:     (default-to "" (get source source-entry)),
      resolved:   (default-to false (get v res-entry)),
      finalValue: (default-to u0 (get v fv-entry)),
      closeTime:  (default-to u0 (get v ct-entry))
    }
  )
)

;; get-rung-info
;; Returns the rung metadata for market m.
(define-read-only (get-rung-info (m uint))
  (let (
    (g-entry   (map-get? rung-group     { m: m }))
    (thr-entry (map-get? rung-threshold { m: m }))
    (op-entry  (map-get? rung-operator  { m: m }))
    (lbl-entry (map-get? rung-label     { m: m }))
  )
    {
      isRung:    (is-some g-entry),
      group:     (default-to u0  (get g  g-entry)),
      threshold: (default-to u0  (get v  thr-entry)),
      operator:  (default-to ""  (get op op-entry)),
      label:     (default-to ""  (get label lbl-entry))
    }
  )
)

;; is-rung
;; Returns true if market m was created as a ladder rung.
(define-read-only (is-rung (m uint))
  (rung-exists m)
)

;; get-rung-outcome-preview
;; Returns the outcome that resolve-rung would produce if the group's
;; final value were final-value, without writing anything.
;; Returns "YES" or "NO", or "" if the market is not a rung.
(define-read-only (get-rung-outcome-preview (m uint) (final-value uint))
  (let (
    (thr-entry (map-get? rung-threshold { m: m }))
    (op-entry  (map-get? rung-operator  { m: m }))
  )
    (if (and (is-some thr-entry) (is-some op-entry))
        (let (
          (threshold (unwrap-panic (get v  thr-entry)))
          (operator  (unwrap-panic (get op op-entry)))
        )
          (compute-rung-outcome final-value threshold operator)
        )
        ""
    )
  )
)
