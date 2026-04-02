# sBTC-Backed Binary Markets (LMSR) — Clarity Contracts

A production-ready set of Clarity smart contracts for **binary YES/NO prediction markets** collateralized in **sBTC**, powered by an **LMSR** market maker. It includes **fee routing**, **per-user spend caps**, **slippage-protected auto-buys**, and **admin safety controls**.

> ⚠️ These contracts are not audited yet. Use at your own risk.

---

## Highlights

- **On-chain LMSR** pricing (YES/NO).
- **sBTC collateral**; pool updates on every trade (base cost only).
- **Slippage-protected buys**: `buy-*-auto(amount, targetCap, maxCost)`.
- **Per-user budgets** (caps) and **trade size limit**.
- **Protocol & LP fees** with configurable **recipients** and **splits**; optional **config lock**.
- **Admin safety**: `pause/unpause`, `only-admin`, `ensure-open`.
- **Deterministic redemption**: pro-rata payouts; **last redeemer sweeps residue** to avoid dust.
- **Extensive test suite** (Vitest + Clarinet simnet wasm).

---

## Project layout

```
contracts/
  market.clar        # LMSR market (YES/NO), fees, caps, auto-buys, resolve/redeem
  sbtc.clar          # Minimal SIP-010-compatible FT used as collateral
  sip010-ft.clar     # SIP-010 trait (+ burn) for compile-time checks
deployments/
settings/            # Clarinet network configs (devnet/testnet/mainnet)
tests/               # Vitest smart-contract tests (simnet)
types/, scripts/, docs/, frontend/  # (optional project scaffolding)
Clarinet.toml        # Contracts, dependencies, and network settings
vitest.config.js
```

---

## Contracts

### `sip010-ft.clar`
SIP-010 trait (plus `burn`) for compile-time conformance checks.

### `sbtc.clar`
Minimal SIP-010-compatible FT representing sBTC:
- `transfer(amount, sender, recipient)` requires **`sender == tx-sender`**.
- `mint`, `burn`, `get-balance`, `get-supply`.

> The stricter transfer rule is intentional so the **market** orchestrates payments: users pay **base cost to the market** and **fees to recipients** in a single transaction.

### `market.clar`
LMSR market with fee routing and safety controls.

**State & parameters**
- `pool`: sBTC collateral held by the market.
- `b`: liquidity parameter; recomputed as `b = floor(pool / ln(2))` (scaled).
- `status`: `"open"` / `"resolved"`.
- `outcome`: `"YES"` / `"NO"`.
- `protocol-fee-bps`, `lp-fee-bps`.
- Protocol split: `pct-drip`, `pct-brc`, `pct-team` (**sum = 100**).
- Recipients: `DRIP_VAULT`, `BRC20_VAULT`, `TEAM_WALLET`, `LP_WALLET`.
- Fee config can be **locked**.

**Tokens**
- Internal fungible tokens: `yes-token`, `no-token` (minted on buy, burned on redeem).

**Admin & lifecycle**
- `create(initial-liquidity)` — seeds the pool and initializes `b`.
- `add-liquidity(amount)` — adds collateral (admin only).
- `pause()` / `unpause()`.
- `resolve(result)` — sets final outcome (`"YES"`/`"NO"`).
- `withdraw-surplus()` — allowed **only if resolved** and **winning supply == 0** and **pool > 0**.

**Trading**
- **Quotes** (read-only):  
  `quote-buy-yes(amount)` / `quote-buy-no(amount)` → `{ cost, feeProtocol, feeLP, total, drip, brc20, team }`
- **Buys**
  - Normal: `buy-yes(amount)`, `buy-no(amount)` (requires user cap to be set).
  - **Auto**: `buy-yes-auto(amount, target-cap, max-cost)`, `buy-no-auto(...)`
    - Raises caller’s cap to `target-cap` in the same tx if needed.
    - Aborts if `total > max-cost` (slippage guard).
- **Caps & limits**
  - Per-user **budget cap** (`user-caps` / `user-spent`).
  - Optional **max trade size** (`set-max-trade`).

**Resolution & redemption**
- `redeem()` — pro-rata payout from `pool` to winners; **last redeemer takes exact remainder** (sweeps rounding dust).
- `withdraw-surplus()` — admin can withdraw leftover `pool` only when **no winning supply remains** (e.g., nobody bought the winning side).

**Fees & routing**
- Fees are computed in BPS on **base cost** (`ceil-bps` rounding):
  - `protocol-fee-bps` → split into `drip/brc/team`.
  - `lp-fee-bps` → to `LP_WALLET`.
- `lock-fees-config()` to freeze parameters and recipients after setup.

**Numerics**
- Fixed-point scale `SCALE = 1e6`, cubic approximations for `exp/ln`.
- LMSR **incremental cost** uses `max(1, diff)` for `amount > 0` (1-unit floor).

---

## Public interface (cheat-sheet)

**Admin & state**
- `create(initial-liquidity)` → `(ok b)`; `add-liquidity(amount)` → `(ok b)`
- `pause()` / `unpause()`
- `resolve("YES"|"NO")`
- `withdraw-surplus()`
- `set-max-trade(limit)`
- `set-fees(protocolBps, lpBps)` (≤ 10000 each)
- `set-protocol-split(pDrip, pBrc, pTeam)` (sum = 100)
- `set-fee-recipients(drip, brc, team, lp)`
- `lock-fees-config()`

**Trading**
- `buy-yes(amount)`, `buy-no(amount)`
- `buy-yes-auto(amount, target-cap, max-cost)`, `buy-no-auto(...)`

**Redeem**
- `redeem()` — chooses YES/NO path according to `outcome`

**Read-only**
- Quotes: `quote-buy-yes(amount)`, `quote-buy-no(amount)`
- Getters: `get-pool`, `get-b`, `get-q-yes`, `get-q-no`, `get-status`, `get-outcome`, `get-initialized`
- Fee config: `get-fee-params`, `get-fee-recipients`
- Supplies & balances: `get-yes-supply`, `get-no-supply`, `get-yes-balance(principal)`
- Caps: `get-cap(principal)`, `get-spent(principal)`

---

## Error codes (selected)

- Lifecycle: `u700` (double create), `u701` (initial-liquidity=0), `u702` (add-liquidity=0), `u703/u704` (b==0 or amount==0), `u720` (paused), `u721` (not initialized), `u100/u102/u103/u104` (status/outcome guards).
- Limits: `u722` (trade > max-trade), `u730` (cap=0), `u731` (cap exceeded), `u732` (slippage).
- Fees: `u740/u741` (bps invalid), `u742` (split ≠ 100), `u743` (fees locked).
- Withdraw gating: `u707/u708/u709/u710` (resolved/supply/pool gates).
- Redeem: `u105` (supply 0), `u2` (payout=0).

---

## How it works (economics, short)

- LMSR cost: `C(q) = b * ln(exp(qYES/b) + exp(qNO/b))`.  
- Here `b` is tied to the market **pool** (`b ≈ pool / ln(2)`), so the **worst-case loss** is ~`pool`.  
- **Base cost** increases `pool`; **fees** are routed to recipients; **redeem** pays winners from `pool`.  
- With **no winning supply** (e.g., nobody bought the resolved side), the admin may **withdraw surplus**.

---

## Getting started

### Prerequisites
- Node.js 18+
- Yarn or npm
- Clarinet (latest)

### Install & compile
```bash
npm install
clarinet check
```

### Run the tests (simnet)
```bash
# Run all tests
npx vitest run

# Or run a single file
npx vitest run tests/fees-routing.test.ts
```

The test suite exercises:
- Fee routing, splits, and **config lock**
- **Max-trade** and pre-checks
- **Add-liquidity** & `b` dynamics
- **Ceil-bps** rounding and residue to `team`
- `resolve` → `redeem` flows (YES/NO), **last redeemer sweep**, and `withdraw-surplus` gating
- “No winners” path (admin withdraws pool)
- Slippage on **normal buy** vs **auto-buy**
- Multi-user sequences with **pause/unpause** and invariants

> Logs print **balance deltas per principal** at each step for auditability.

### Clarinet simnet accounts (default)
Common labels used in tests: `deployer`, `wallet_1` … `wallet_8`.  
Each comes funded in `settings/*` and `deployments/*` plans.

---

## Integration notes

- **Always quote before buy** (`quote-buy-*`) and show the full breakdown (`cost`, `fees`, `total`).
- Prefer **auto-buy** in the UI: set `target-cap` to at least `quote.total`, and pass `max-cost` (e.g., `total * 1.01`).
- After `resolve`, disable buys; show `redeem` for the winning side until `supply → 0`.
- Only allow `withdraw-surplus` once **winning supply is 0** (UI can check via getters).

---

## Security & safety

- `pause/unpause`: stops buys without mutating economic state.
- `lock-fees-config`: freezes fee params and recipients after setup.
- Gated admin withdraw to avoid draining active winner funds.
- **Tests include** multi-user stress and invariants over pool/supplies/fees.

> Suggested future hardening: bigger-order `exp/ln` approximations; gas profiling; event logs for indexing; optional transfer of YES/NO; allow burn-with-payout-0 to avoid edge dust holders blocking surplus withdraw.

---

## Roadmap (optional ideas)

- On-chain **registry** of markets (id → address).
- Decentralized resolver (oracle / committee).
- Event logs for subgraph-style indexing.
- “Permit”/meta-transactions if switching to `transfer-from` flows.
- Hybrid **order book + AMM** router.

---

## Acknowledgements

- Built with **Clarinet** (simnet) and **Vitest**.  
- SIP-010 trait used for compile-time checks; `sbtc.clar` is a minimal SIP-010 FT tailored for orchestrated transfers.

---

If you have questions, open an issue or start a discussion. Contributions welcome!
