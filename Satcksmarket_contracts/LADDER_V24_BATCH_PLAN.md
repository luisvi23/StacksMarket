# Plan: contrato v24 — creación atómica de ladders (mejora futura)

## Problema que resuelve

Hoy un mercado categórico (ladder) se crea con **N+1 transacciones independientes**:
`create-ladder-group` + N × (`add-rung` [+ `set-market-bias`]).

Cada `add-rung` transfiere la liquidez inicial al contrato y es **final e
irreversible** una vez minada. Si una transacción intermedia falla (rechazo de
wallet, abort, timeout), los rungs ya creados quedan con su STX dentro del
contrato. En blockchain **no existe rollback atómico entre transacciones
separadas** — sólo dentro de una misma función de contrato.

## Mitigación ya implementada (v23, sin redesplegar)

- La creación **para al primer fallo** y registra los rungs creados en BD
  inmediatamente (el `marketId` nunca se pierde). Ver `client/src/pages/Admin.js`
  → `createLadderMutation`.
- Botón **"Recover funds"** en el admin: resuelve cada rung como NO y hace
  `withdraw-surplus`, devolviendo TODA la liquidez al admin, y marca el grupo
  `cancelled`. Ver `recoverLadderMutation` (cliente) y
  `POST /api/ladder/groups/:groupId/recover` (server).

Esto garantiza que **nunca quede STX muerto**, pero la recuperación es manual
(una firma por opción).

## Mejora de raíz: `add-rungs-batch` en v24

Añadir al contrato una función que cree el grupo y todos sus rungs en **una sola
transacción atómica**. Si cualquier rung falla, toda la transacción revierte y
no se transfiere ningún STX.

```clarity
;; Pseudocódigo — crea el grupo y hasta N rungs en una sola tx atómica.
(define-public (create-ladder-group-with-rungs
    (g           uint)
    (title       (string-ascii 200))
    (source      (string-ascii 200))
    (close-time  uint)
    (rungs (list 20 { m: uint, label: (string-utf8 64), liquidity: uint, bias: uint })))
  (begin
    (try! (only-admin))
    (asserts! (not (ladder-group-exists g)) ERR-LADDER-ALREADY-EXISTS)
    ;; crea el grupo
    (try! (create-ladder-group g title source close-time))
    ;; fold sobre los rungs: cada add-rung + set-bias dentro de la MISMA tx.
    ;; Si uno falla, `try!` propaga el error y TODO revierte (incluidos los
    ;; stx-transfer de los rungs anteriores). Cero STX atrapado.
    (fold add-rung-folder rungs (ok g))))
```

### Ventajas
- **Rollback verdadero**: un solo fallo revierte todo. Imposible quedar a medias.
- **Una sola firma** para el admin (mejor UX): crea el mercado completo de una vez.
- Elimina la cadena de esperas `pollTx` entre firmas.

### Coste / trabajo
- Escribir + testear la función en Clarinet (límite de lista, presupuesto de
  ejecución por bloque, tope de rungs por batch ~20).
- Redesplegar `market-factory-v24-testnet-bias` en testnet.
- Actualizar `CONTRACT_NAME` (server `.env`/`render.yaml`, client `.env*`) y los
  defaults en `ladderClient.js` / `marketClient.js`.
- Reescribir `createLadderMutation` para una sola llamada batch (mantener el
  flujo viejo como fallback no es necesario; v24 es retro-compatible en el resto).
- `set-market-bias` puede integrarse en el batch o seguir como paso aparte.

### Cuándo hacerlo
Tras validar el flujo actual en el servidor de desarrollo. La mitigación v23 es
suficiente para empezar a probar sin riesgo de fondos atrapados.
