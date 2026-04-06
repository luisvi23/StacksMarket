;; ------------------------------------------------------------
;; Minimal SIP-010-like trait for local testing
;; ------------------------------------------------------------

(define-constant err-owner-only (err u100))
(define-constant contract-owner tx-sender)          ;; deployer = owner

(define-trait sip010-ft
  (
    (get-balance (principal)                 (response uint uint))
    (get-supply  ()                          (response uint uint))
    (transfer    (uint principal principal)  (response bool uint))
    (mint        (uint principal)            (response bool uint))
    (burn        (uint)                      (response bool uint))
  )
)
