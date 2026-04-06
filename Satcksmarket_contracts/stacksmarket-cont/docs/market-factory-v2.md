# Market Factory v2 — Fixed-b LMSR + 1:1 Redemption

This document describes the final design and key invariants of the smart contracts  
**`market-factory-v2.clar`** and **`sbtc-v2.clar`** as implemented in the latest build.

---

## 🧭 Overview

- **Creation** — `create-market(m, initial-liquidity)` transfers sBTC from **admin → contract**,  
  sets `pool = initial-liquidity`, and computes `b` **once**:

  ```
  b = initial-liquidity / ln(2)
  ```

  (scaled using the fixed-point constant `SCALE = 1_000_000`).

- **Pricing** — Uses a **true LMSR** (Logarithmic Market Scoring Rule) cost function.  
  Buys compute `ΔC = C(q_after) − C(q_before)` using `exp/ln` with  
  a numerically stable **log-sum-exp** implementation.  
  There are **no linear approximations** or “price × qty” shortcuts.

- **Accounting**  
  - Only the **base cost (ΔC)** is added to the pool.  
  - Protocol fees go to **DRIP / BRC / TEAM** wallets.  
  - LP fees go to the **LP wallet**.  
  - None of these fees are mixed into the pool.

- **Resolution** — `resolve(m, "YES"|"NO")` is **admin-only**.  
  When resolved, the market is locked; trading and further liquidity are blocked.

- **Redemption (1:1 fixed payout)**  
  - Winners can redeem their YES/NO shares at a fixed rate:  
    ```
    payout = balance * UNIT
    ```
    (default: 1 sBTC per share).  
  - Before paying, the contract asserts `pool ≥ payout`.  
  - The shares are **burned**, the pool decreases by `payout`,  
    and the payout is transferred from the contract to the user.

- **Withdraw surplus** — Once the winning supply == 0,  
  the admin can recover any remaining pool balance.

---

## ⚙️ Public Interface

### Admin functions
| Function | Description |
|-----------|-------------|
| `set-fees(protocol-bps, lp-bps)` | Define protocol and LP fee rates |
| `set-fee-recipients(drip, brc20, team, lp)` | Define recipient wallets |
| `set-protocol-split(pctDrip, pctBrc, pctTeam)` | Split protocol fees among vaults (sum = 100) |
| `lock-fees-config()` | Permanently lock fee config (one-time action) |
| `pause(m)` / `unpause(m)` | Temporarily pause trading |
| `set-max-trade(m, limit)` | Cap per-user trade size |

---

### Market functions
| Function | Description |
|-----------|-------------|
| `create-market(m, initial-liquidity)` | Deploy a new market; compute `b` once |
| `buy-yes(m, amount)` / `buy-no(m, amount)` | Regular buy entrypoints |
| `buy-yes-auto(m, amount, target-cap, max-cost)` / `buy-no-auto(...)` | Auto-buy with slippage protection |
| `resolve(m, "YES"|"NO")` | Resolve outcome (admin only) |
| `redeem(m)` | Winners redeem their shares at fixed `UNIT` |
| `withdraw-surplus(m)` | Admin withdraws leftover pool post-redemption |

---

### Quote (read-only)
| Function | Description |
|-----------|-------------|
| `quote-buy-yes(m, amount)` | Returns `{ cost, feeProtocol, feeLP, total, drip, brc20, team }` |
| `quote-buy-no(m, amount)` | Same for NO side |

---

### Read-only getters
| Function | Description |
|-----------|-------------|
| `get-pool(m)` | Current pool balance |
| `get-b(m)` | Market constant `b` |
| `get-status(m)` | `open`, `resolved`, `paused`, etc. |
| `get-outcome(m)` | Resolved outcome |
| `get-initialized(m)` | Initialization flag |
| `get-yes-supply(m)`, `get-no-supply(m)` | Total shares outstanding |
| `get-yes-balance(m, who)`, `get-no-balance(m, who)` | User share balances |
| `get-fee-params()` | Current fee rates |
| `get-fee-recipients()` | Current fee recipient addresses |
| `get-self()` | Contract principal address |

---

## 🧩 Key Invariants

1. **Pool growth and decay**
   ```
   pool_final = seed + Σ (ΔC) − Σ (payouts)
   ```
   - `ΔC` is the LMSR base cost (not including fees).
   - `payouts = q_winner_redeemed * UNIT`.

   → Pool increases only by `ΔC` (buys) and decreases by payouts (redemptions).

2. **Fee segregation**
   - Protocol + LP fees **never** enter the pool.  
   - They are routed directly to their vault addresses.

3. **1:1 redemption**
   - `payout = balance * UNIT`  
   - Requires `pool ≥ payout` before execution.  
   - Burns shares and transfers from pool.

4. **Surplus withdrawal**
   - Allowed only when **winner supply == 0**.  
   - Transfers remaining pool to the admin and resets pool to 0.

---

## 🧮 Units and Scaling

- `UNIT` — the payout per **winning share**.  
  - In this implementation: `1` = 1 satoshi per share.  
  - You can change it to any scalar (e.g., `100` or `1_000_000`)  
    to adjust the real payout magnitude.  
  - The system will **always resolve correctly**, since `b` is computed  
    from `initial-liquidity` and automatically scales with it.

- `SCALE` — fixed-point precision constant (`1_000_000`),  
  used internally for LMSR’s exponential/logarithmic math.  
  **Do not confuse SCALE with UNIT.**

---

## 🔁 Operational Flow

1. **Seed + Market Creation**
   ```clarity
   (create-market m initial-liquidity)
   ```
   → Transfers sBTC seed to contract and computes `b`.

2. **Optional Configuration**
   ```clarity
   (set-fees protocolBps lpBps)
   (set-fee-recipients drip brc team lp)
   (lock-fees-config)
   ```

3. **Trading**
   ```clarity
   (quote-buy-yes m amount)
   (buy-yes-auto m amount target-cap max-cost)
   ```
   → Pool increases only by ΔC.

4. **Resolution**
   ```clarity
   (resolve m "YES")
   ```
   → Locks trading, fixes the outcome.

5. **Redemption**
   ```clarity
   (redeem m)
   ```
   → Each winner gets `balance * UNIT`, shares are burned.

6. **Withdraw Surplus**
   ```clarity
   (withdraw-surplus m)
   ```
   → Only when winner supply == 0; sends remaining pool to admin.

---

## 🧠 Notes for Frontend Integration

- Always fetch **`quote-buy-yes/no`** before trading to show:  
  - Cost breakdown  
  - Protocol + LP fees  
  - Slippage-adjusted total  
- Use `buy-*-auto` for slippage protection (max-cost cap).  
- Display current `pool`, `YES` and `NO` supplies for transparency.  
- Show fee destinations (DRIP/BRC/TEAM/LP) so users understand routing.  
- After resolution, disable trading actions and allow redemption only for the winner.

---

## ✅ Audit & Design Summary (final checks passed)

| Check | Result |
|--------|---------|
| Admin-gated resolution | ✅ only-admin |
| Fixed `b` (one-time) | ✅ computed once from seed / ln(2) |
| True LMSR cost function | ✅ on-chain ΔC computation |
| Separate fee routing | ✅ DRIP/BRC/TEAM + LP |
| Redemption 1:1 | ✅ payout = balance * UNIT |
| Withdraw surplus | ✅ only if winner supply == 0 |
| Safety switches | ✅ pause/unpause, slippage, caps |
| Uses as-contract transfer | ✅ secure payout |
| Read-only quote endpoints | ✅ exposed |
| Final pool math invariant | ✅ holds after full redemption |

---

### 💡 Quick QA checklist

| Test | Expected |
|------|-----------|
| After all buys | `pool == seed + ΣΔC` |
| After full redemption | `sum(payouts) == q_win * UNIT` |
| Post-withdraw | `pool == 0` |
| Fee totals | Equal to sum of quoted fee splits |
| Slippage test | Fails gracefully with `u732` |
| Non-admin resolve | Fails with `u706` |

---

### 📎 Recommended placement

Save this file as:
```
docs/market-factory-v2.md
```

And link it from your main `README.md`, for example:

```markdown
### Documentation
- [Market Factory v2 Design](docs/market-factory-v2.md)
```
