;; ------------------------------------------------------------
;; sBTC SIP-010 (minimal) + burn
;; ------------------------------------------------------------
(use-trait sip010-ft .sip010-ft.sip010-ft)
(impl-trait .sip010-ft.sip010-ft)

(define-constant err-owner-only (err u100))
(define-constant contract-owner tx-sender) ;; deployer = owner

(define-fungible-token sbtc)

(define-public (transfer (amount uint) (sender principal) (recipient principal))
  (begin
    (asserts! (is-eq sender tx-sender) err-owner-only)
    (ft-transfer? sbtc amount sender recipient)
  )
)

(define-public (mint (amount uint) (recipient principal))
  (begin
    (asserts! (is-eq tx-sender contract-owner) err-owner-only)
    (ft-mint? sbtc amount recipient)
  )
)

(define-public (burn (amount uint))
  (ft-burn? sbtc amount tx-sender)
)

(define-read-only (get-balance (who principal))
  (ok (ft-get-balance sbtc who))
)

(define-read-only (get-supply)
  (ok (ft-get-supply sbtc))
)
