# CLAUDE.md — Contratos Clarity (bitcoinworld-cont)

## Contratos activos

| Contrato | Red | Estado |
|----------|-----|--------|
| `market-factory-v21-bias` | Testnet / próximo mainnet | **Actual — binario + escalera** |
| `market-factory-v20-bias` | Mainnet | Producción actual |
| `market-factory-v20-6-bias` | Testnet (legacy) | Reemplazado por v21 |

## Arquitectura del contrato

`market-factory-v21-bias` gestiona **todos los mercados** de la plataforma — tanto mercados binarios (YES/NO) como mercados escalera (múltiples umbrales). Cada mercado se identifica con un `uint` (market ID). No hay un contrato por mercado.

### Mercados escalera (v21)

Un **ladder group** agrupa varios mercados binarios bajo una misma pregunta con distintos umbrales de precio (ej: "¿Llegará BTC a $X?"). Cada umbral ("rung") es un mercado binario LMSR independiente internamente. La resolución se hace en dos pasos:

1. `resolve-ladder-group(g, final-value)` — el admin registra el valor final on-chain
2. `resolve-rung(m)` — resuelve cada peldaño individualmente (automático: compara final-value con threshold y operator)

Esto evita loops y mantiene el gas predecible.

**Nuevos maps:**
- `ladder-group-title/source/resolved/final-value/close-time` — estado del grupo
- `rung-group/threshold/operator/label` — vincula un market-id a su grupo

**Nuevas funciones públicas:**
- `create-ladder-group (g, title, source, close-time)` — admin
- `add-rung (g, m, threshold, operator, label, initial-liquidity)` — admin, crea el mercado LMSR subyacente
- `resolve-ladder-group (g, final-value)` — admin, registra valor final
- `resolve-rung (m)` — admin, resuelve peldaño basándose en valor final almacenado

**Nuevas funciones read-only:**
- `get-ladder-group-info (g)` — estado completo del grupo
- `get-rung-info (m)` — threshold, operator, label, group
- `is-rung (m)` — ¿es este market un peldaño de escalera?
- `get-rung-outcome-preview (m, final-value)` — previsualiza el outcome sin ejecutar nada

### Modelo matemático: Fixed-b LMSR con bias

- **b** se calcula una sola vez al crear el mercado: `b = initial_liquidity / ln(2)`
- **b es fijo** — no cambia durante la vida del mercado
- **Bias (liquidez virtual):** `r_yes` y `r_no` afectan solo al precio (quotes), no a las shares reales. Se puede configurar antes del primer trade y queda bloqueado tras el primero.
- **Unidad:** 1 share = 1 STX = 1.000.000 µSTX
- **Redención fija 1:1:** cada share ganadora se canjea por exactamente 1 STX, sin importar la evolución del precio

### Estructura de datos clave

- Estado por mercado: `m-status`, `m-pool`, `m-b`, `m-q-yes`, `m-q-no`, `m-r-yes`, `m-r-no`, `m-paused`, `m-close-time`, `m-max-trade`
- Balances por usuario: `yes-holdings`, `no-holdings`, `user-spent`, `user-caps`
- Fees globales: `protocol-fee-bps`, `lp-fee-bps`, `PROTOCOL_WALLET_A/B`, `LP_WALLET`

---

## Flujo de vida de un mercado

```
create-market(m, initial_liquidity)
  └── (opcional) set-market-bias(m, p_yes)   ← solo antes del 1er trade
  └── (opcional) set-max-trade(m, limit)
  └── (opcional) set-market-close-time(m, ts)
        ↓
    Trading abierto
    buy-yes-auto / buy-no-auto / sell-yes-auto / sell-no-auto
        ↓
    (opcional) pause(m) / unpause(m)
        ↓
    resolve(m, "YES" | "NO")   ← IRREVERSIBLE
        ↓
    redeem(m)                  ← ganadores reclaman 1 STX por share
    withdraw-surplus(m)        ← admin retira sobrante si winning_supply == 0
```

---

## API pública completa

### Funciones de administrador

| Función | Parámetros | Descripción |
|---------|-----------|-------------|
| `create-market` | `m: uint, initial-liquidity: uint` | Crea mercado, transfiere seed desde ADMIN, calcula b |
| `resolve` | `m: uint, result: string-ascii 3` | Resuelve a "YES" o "NO" — **IRREVERSIBLE** |
| `withdraw-surplus` | `m: uint` | Retira sobrante si no hay shares ganadoras pendientes |
| `pause` | `m: uint` | Bloquea el trading |
| `unpause` | `m: uint` | Reanuda el trading |
| `set-max-trade` | `m: uint, limit: uint` | Límite máximo por trade en µSTX |
| `set-market-close-time` | `m: uint, close-time: uint` | Cierre automático por timestamp Unix |
| `set-market-bias` | `m: uint, p-yes: uint` | Bias inicial (1–99% YES). Se bloquea tras el 1er trade |
| `reset-market-bias` | `m: uint` | Resetea bias si no hay shares emitidas |
| `set-fees` | `protocol-bps: uint, lp-bps: uint` | Configura tasas (máx 10000 bps cada una) |
| `set-fee-recipients` | `walletA, walletB, lp: principal` | Direcciones de cobro de fees |
| `set-protocol-split` | `pa: uint, pb: uint` | Reparto entre walletA y walletB (suma = 100) |
| `lock-fees-config` | — | Bloquea config de fees **de forma permanente e irreversible** |

### Funciones de usuario

| Función | Parámetros | Descripción |
|---------|-----------|-------------|
| `buy-yes-auto` | `m, amount, target-cap, max-cost: uint` | Compra shares YES con protección de slippage |
| `buy-no-auto` | `m, amount, target-cap, max-cost: uint` | Compra shares NO con protección de slippage |
| `sell-yes-auto` | `m, amount, min-proceeds: uint` | Vende shares YES |
| `sell-no-auto` | `m, amount, min-proceeds: uint` | Vende shares NO |
| `redeem` | `m: uint` | Canjea shares ganadoras a 1 STX/share |

### Read-only principales

| Función | Descripción |
|---------|-------------|
| `quote-buy-yes-by-sats` / `quote-buy-no-by-sats` | Quote dado un presupuesto en µSTX |
| `quote-buy-yes` / `quote-buy-no` | Quote dado número de shares |
| `quote-sell-yes` / `quote-sell-no` | Proceeds de vender shares |
| `get-market-snapshot` | Estado completo del mercado en una llamada |
| `get-user-claimable` | Cantidad reclamable por usuario tras resolución |
| `get-yes-balance` / `get-no-balance` | Shares de un usuario |
| `is-trading-open-now` | ¿Está abierto el trading? (respeta close-time) |
| `get-fee-params` / `get-fee-recipients` | Config de fees actual |

---

## Cómo testear

**Nunca probar en mainnet. Testear en simnet (local) o testnet.**

```bash
cd Satcksmarket_contracts/bitcoinworld-cont

# Verificar sintaxis Clarity
npm run check

# Ejecutar todos los tests (simnet embebido, sin nodo externo, sin coste)
npm run test:all

# Watch mode durante desarrollo
npm run test:watch

# Con cobertura
npm run test:cov
```

Los tests corren sobre **simnet embebido** — no requieren nodo Stacks externo. Cada fichero de test tiene estado fresco (singleFork). Los wallets de test están en `bootstrap.ts` (deployer, wallet_1–8, faucet).

### Archivos de test

| Archivo | Qué cubre |
|---------|-----------|
| `01_create_market.test.ts` | Creación y estado inicial |
| `02_quotes_and_buys.test.ts` | Quotes, compras, routing de fees |
| `03_slippage_and_limits.test.ts` | Protección de slippage y límites |
| `04_resolve_redeem_surplus.test.ts` | Resolución, redención, surplus |
| `05_pause_add_liquidity_b_fixed.test.ts` | Pause/unpause, b fijo |
| `06_fees_recipients_lock_complex.test.ts` | Fee splitting y locking |
| `07_invariants_stress_multi_markets.test.ts` | Invariantes con múltiples mercados |
| `market_settlement.test.ts` | Settlement final |

---

## Cómo desplegar

Los deployments se hacen con Clarinet mediante los YAML de `deployments/`. **Nunca desplegar manualmente.**

| Red | Plan | Sender |
|-----|------|--------|
| Mainnet | `deployments/default.mainnet-plan.yaml` | `SP3N5CN0PE7YRRP29X7K9XG22BT861BRS5BN8HFFA` |
| Testnet | `deployments/default.testnet-plan.yaml` | `ST1PSHE32YTEE21FGYEVTA24N681KRGSQM4VF9XZP` |
| Local | `deployments/default.devnet-plan.yaml` | deployer local |

El mnemónico del deployer está en `settings/Mainnet.toml` y `settings/Testnet.toml` — **nunca en Git**.

---

## Contratos en el repositorio

`market-factory-v21-bias` es la versión activa en desarrollo. Cuando se despliegue a mainnet, actualizar `Clarinet.toml` para apuntarlo como contrato activo.

- **v20-6-bias** → activo en testnet (versión ligeramente anterior)
- **v6 a v19** → archivos históricos. No modificar, no redesplegar.
- **sip010-ft**, **sbtc-v3**, **sbtc-v4** → contratos de soporte para devnet local

---

## Advertencias críticas

- `resolve()` es **irreversible** — cierra el mercado permanentemente en blockchain
- `lock-fees-config` es **irreversible** — no ejecutar en mainnet sin aprobación explícita
- **Mainnet es producción** — cualquier llamada a mainnet (aunque sea read-write "de prueba") debe estar aprobada. Las pruebas van a testnet o simnet.
- El mnemónico de `settings/Mainnet.toml` controla fondos reales — tratarlo como credencial crítica
- El contrato no tiene función de upgrade — un bug en mainnet no se puede parchear, solo migrar a un nuevo contrato
- `withdraw-surplus` solo es válido si `winning_supply == 0` (nadie redimió). Ejecutarlo antes de que los ganadores rediman es un error grave.
