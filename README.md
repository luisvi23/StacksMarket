# Stacks Market — Monorepo

On-chain prediction market platform built on the [Stacks](https://stacks.co) blockchain (Bitcoin Layer 2). Users buy and sell YES/NO positions in binary markets using STX. Liquidity follows the **LMSR (Logarithmic Market Scoring Rule)** model with configurable virtual liquidity (bias). Resolution and settlement are fully on-chain and irreversible.

---

## Table of Contents

1. [Repository Structure](#repository-structure)
2. [How It Works](#how-it-works)
3. [Market Types](#market-types)
4. [Smart Contracts](#smart-contracts)
5. [Backend](#backend)
6. [Frontend](#frontend)
7. [Background Jobs](#background-jobs)
8. [Wallet Integration](#wallet-integration)
9. [Data Models](#data-models)
10. [API Reference](#api-reference)
11. [Environment Variables](#environment-variables)
12. [Local Development](#local-development)
13. [Testing Contracts](#testing-contracts)
14. [Deployment](#deployment)
15. [Infrastructure (Production)](#infrastructure-production)
16. [Security Notes](#security-notes)

---

## Repository Structure

```
STACKS_MARKET_UNIFIED/
├── Satcksmarket_contracts/
│   └── stacksmarket-cont/          # Clarity smart contracts + tests
│       ├── contracts/              # All contract versions (v6 → v21)
│       ├── tests/                  # Vitest + Clarinet SDK (simnet)
│       ├── deployments/            # Clarinet deployment plans per network
│       ├── settings/               # Network configs (Mainnet/Testnet.toml — gitignored)
│       └── Clarinet.toml           # Project manifest
│
└── StacksMarket_web/
    ├── client/                     # React 18 SPA
    │   └── src/
    │       ├── pages/              # One file per route/view
    │       ├── components/         # Reusable UI components
    │       ├── contexts/           # Global state (auth, theme)
    │       │   └── stacks/         # Blockchain integration
    │       │       ├── marketClient.js   # Binary market contract calls
    │       │       └── ladderClient.js   # Ladder/scalar contract calls (v21)
    │       └── utils/
    │           ├── stx.js              # STX ↔ µSTX conversion helpers
    │           └── stacksConnect.js    # Wallet connection management
    ├── server/                     # Node.js 20 / Express API + Socket.io
    │   ├── index.js                # Entry point
    │   ├── routes/                 # REST routes by domain
    │   ├── models/                 # Mongoose schemas
    │   ├── jobs/                   # Background blockchain jobs
    │   └── utils/                  # onChainOddsSync, marketState
    └── ops/
        └── backup-service/         # Nightly MongoDB → S3 backup container
```

The two sub-projects are **independently deployable** but coupled by the deployed contract address. The backend never submits transactions to the chain — it only reads state and indexes events. All write transactions originate from the user's browser wallet.

---

## How It Works

### End-to-end trade flow

```
User (browser)
  │
  ├─ 1. Wallet connects (Leather / Xverse / WalletConnect)
  │
  ├─ 2. GET /api/stacks/call-read  ──► Hiro API (read-only quote)
  │       quote-buy-yes-by-sats(m, budget)
  │       ← { shares, quote.total, quote.perShare }
  │
  ├─ 3. Signs + submits tx directly to Stacks node via wallet
  │       buy-yes-auto(m, amount, cap, max-cost)
  │
  ├─ 4. POST /api/trades  ──► Backend creates Trade intent (status: "pending")
  │
  └─ 5. [Background] onChainTradeReconciler polls Hiro every N seconds
             tx confirmed → Trade.status = "completed"
                          → syncPollOddsFromOnChainSnapshot()
                          → repairTradePricesForPoll()
                          → Socket.io "trade-updated" broadcast
```

### Unit system

All on-chain amounts are in **µSTX (microstacks)**. `1 STX = 1,000,000 µSTX`.

The LMSR contract defines: **1 share = 1 STX payout on resolution**. This means:
- `quote-buy-yes-by-sats(m, budget_ustx)` returns `shares` (raw count) and `quote.total` (µSTX spent)
- "To win" display: `shares × 1,000,000 µSTX` → `ustxToStxString(...)` → `shares STX`
- The ×1e6 / ÷1e6 round-trip is intentional — it encodes the 1-share-per-STX invariant explicitly

The helper `ustxToStxString(ustx, opts)` in `client/src/utils/stx.js` uses integer division (no float drift) and returns `"-"` for null/NaN inputs.

### Probability calculation (LMSR)

Given the on-chain market state `{ b, qYes, qNo, rYes, rNo }`:

```
pYes = 1 / (1 + exp((qNo + rNo - qYes - rYes) / b))
```

Where:
- `b` — fixed liquidity parameter, set at market creation: `b = initial_liquidity / ln(2)`
- `qYes`, `qNo` — cumulative shares issued (real trades)
- `rYes`, `rNo` — virtual bias shares (affect price, not real supply)

The backend fetches this via `get-market-snapshot` and stores it as `poll.options[0].percentage` (integer, 0–100).

---

## Market Types

### Binary Markets

Standard YES/NO prediction market. A single `marketId` (uint) maps to one market on-chain. Users buy YES or NO shares; the winning side redeems 1 STX per share.

**Routes:** `/poll/:id` (frontend), `/api/polls` (backend)

### Ladder / Scalar Markets (v21)

A **ladder group** bundles multiple binary markets under a single question with different price thresholds. Example: "What will BTC price be?" with rungs at $60k, $70k, $80k, $100k.

Each rung is an independent LMSR binary market internally. The group resolves in two steps:
1. `resolve-ladder-group(g, final-value)` — admin stores the final observed value
2. `resolve-rung(m)` — admin resolves each rung (contract auto-derives YES/NO from `final-value` vs `threshold`)

**Routes:** `/ladder/:groupId` (frontend), `/api/ladder` (backend)

#### Ladder admin workflow

```
1. Admin UI → createLadderGroup()         on-chain (ladderClient.js)
2. Admin UI → POST /api/ladder/groups     register in MongoDB
3. Admin UI → addRung() × N              on-chain (one per threshold)
4. Admin UI → POST /api/ladder/groups/:id/rungs  register each rung
5. [at resolution]
   Admin UI → resolveLadderGroup(g, val)  on-chain
   Admin UI → POST /api/ladder/groups/:id/resolve  update MongoDB
   Admin UI → resolveRung(m) × N         on-chain (per rung)
   Users    → redeem(m)                  on-chain (per rung they hold)
```

---

## Smart Contracts

### Active contracts

| Contract | Network | Status |
|----------|---------|--------|
| `market-factory-v20-bias` | Mainnet (`SP3N5CN0PE7YRRP29X7K9XG22BT861BRS5BN8HFFA`) | **Production** |
| `market-factory-v21-testnet-bias` | Testnet (`ST1PSHE32YTEE21FGYEVTA24N681KRGSQM4VF9XZP`) | Active development |
| v6 → v19 | — | Historical, do not redeploy |

### Key contract functions

#### Admin

| Function | Parameters | Description |
|----------|-----------|-------------|
| `create-market` | `m, initial-liquidity` | Creates market, seeds liquidity, calculates `b` |
| `resolve` | `m, result` | Resolves to `"YES"` or `"NO"` — **irreversible** |
| `set-market-bias` | `m, p-yes` | Sets initial YES probability (1–99%). Locked after first trade |
| `set-max-trade` | `m, limit` | Cap per trade in µSTX |
| `pause` / `unpause` | `m` | Halts / resumes trading |
| `withdraw-surplus` | `m` | Admin withdraws residual pool (only if no winners remain) |
| `create-ladder-group` | `g, title, source, close-time` | Creates a scalar group |
| `add-rung` | `g, m, threshold, operator, label, liquidity` | Adds a rung market to a group |
| `resolve-ladder-group` | `g, final-value` | Stores the observed final value |
| `resolve-rung` | `m` | Resolves one rung based on stored final value |

#### User

| Function | Parameters | Description |
|----------|-----------|-------------|
| `buy-yes-auto` | `m, amount, target-cap, max-cost` | Buy YES shares with slippage protection |
| `buy-no-auto` | `m, amount, target-cap, max-cost` | Buy NO shares with slippage protection |
| `sell-yes-auto` | `m, amount, min-proceeds` | Sell YES shares |
| `sell-no-auto` | `m, amount, min-proceeds` | Sell NO shares |
| `redeem` | `m` | Claim 1 STX per winning share after resolution |

#### Read-only

| Function | Description |
|----------|-------------|
| `quote-buy-yes-by-sats` / `quote-buy-no-by-sats` | Quote given a µSTX budget |
| `quote-sell-yes` / `quote-sell-no` | Proceeds from selling N shares |
| `get-market-snapshot` | Full state: `b, qYes, qNo, rYes, rNo, paused, closeTime` |
| `get-user-claimable` | Claimable amount + `canRedeem` flag for a given user |
| `get-ladder-group-info` | Group resolution state and final value |
| `get-rung-info` | Threshold, operator, label for a rung market |

### Fee model

Three configurable fee wallets receive a basis-point split from every trade:
- `PROTOCOL_WALLET_A`, `PROTOCOL_WALLET_B` (split by `set-protocol-split`)
- `LP_WALLET`

Fee config can be permanently locked with `lock-fees-config` — irreversible.

---

## Backend

**Stack:** Node.js 20, Express 4, MongoDB 7 (Mongoose 8), Socket.io 4

### Entry point: `server/index.js`

- Connects to MongoDB
- Mounts all route modules
- Starts Socket.io server (rooms keyed by `poll-{pollId}`)
- Starts background jobs on boot: `onChainTradeReconciler`, `onChainTransactionIndexer`
- Runs `syncAllActiveMarkets()` on startup to repair odds

### Routes

| Module | Prefix | Description |
|--------|--------|-------------|
| `auth.js` | `/api/auth` | Wallet login, JWT, profile |
| `polls.js` | `/api/polls` | Market CRUD, trade history, holders |
| `trades.js` | `/api/trades` | Trade intents, finalization, order book |
| `users.js` | `/api/users` | Dashboard, portfolio, stats |
| `comments.js` | `/api/comments` | Threaded comments per poll |
| `ladder.js` | `/api/ladder` | Ladder group CRUD + rungs |
| `admin.js` | `/api/admin` | Admin-only operations |
| `stacks.js` | `/api/stacks` | Hiro API proxy (avoids CORS from browser) |
| `market.js` | `/api/market` | Global pause/unpause |
| `uploads.js` | `/api/uploads` | Image upload to S3 |

### Key design decisions

- **Backend never submits transactions.** All on-chain writes come from the user's wallet.
- **Dual indexing:** trades are tracked via two paths:
  1. *Intent path* — frontend creates a `Trade` (pending) before sending the tx; reconciler confirms it later
  2. *Indexer path* — `onChainTransactionIndexer` catches any tx the intent path missed (e.g., trades from other apps)
- **Price repair:** after every reconciliation tick, `repairTradePricesForPoll()` back-calculates implied prices from the current on-chain snapshot, working backwards through confirmed trades. This feeds the probability history chart.
- **Sentinel Poll pattern (ladder comments):** each `LadderGroup` has a companion `Poll` document (`marketType: "ladder-comment"`) that serves purely as a comment thread anchor, reusing the existing `CommentsSection` component without modification.

---

## Frontend

**Stack:** React 18, React Query 3, React Router 7, Tailwind CSS 3, Recharts, Socket.io client, `@stacks/connect`

### Pages

| Route | Component | Description |
|-------|-----------|-------------|
| `/` | `Home.js` | Market listings (binary + ladder) |
| `/poll/:id` | `PollDetail.js` | Binary market detail, trading, chart, comments |
| `/ladder/:groupId` | `LadderGroupDetail.js` | Scalar market detail, rung table, chart, comments |
| `/profile` | `Profile.js` | User dashboard, trade history, saved markets |
| `/admin` | `Admin.js` | Admin panel (markets, users, ladder groups) |
| `/closed` | `ClosedMarkets.js` | Resolved markets archive |
| `/learn` | `Learn.js` | How the platform works |
| `/faq` | `FAQ.js` | Frequently asked questions |

### State management

- **Server state:** React Query (`useQuery`, `useQueryClient`) — all API calls with configurable `staleTime` and `refetchInterval`
- **Auth state:** `AuthContext` (JWT stored in localStorage, wallet address in session)
- **Theme:** `ThemeContext` (dark/light, persisted to localStorage)
- **Real-time updates:** Socket.io rooms — `PollDetail` joins `poll-{id}` room on mount; `trade-updated` events trigger probability and chart re-renders

### Probability chart

Built with Recharts `LineChart`. Data source: `GET /api/ladder/groups/:groupId/trades` (ladder) or live trade state (binary). Features:
- Time range tabs: Day / Week / Month / Year / All
- Forward-fill: each rung's last known value is carried forward to "now" so lines always reach the chart's right edge (Polymarket behavior)
- One `Line` per rung, colored from `RUNG_COLORS` palette

### Blockchain calls

All contract interactions go through two client files:

**`marketClient.js`** — binary markets
- Read-only (proxied via `/api/stacks/call-read` to avoid CORS): `getQuoteYesBySats`, `getQuoteNoBySats`, `getQuoteSellYes`, `getQuoteSellNo`, `getMarketSnapshot`, `getUserClaimable`
- Transactions (direct from wallet): `buyYesBySatsAuto`, `buyNoBySatsAuto`, `sellYesAuto`, `sellNoAuto`, `redeemAuto`

**`ladderClient.js`** — ladder/scalar markets (v21)
- `createLadderGroup`, `addRung`, `resolveLadderGroup`, `resolveRung`

Clarity response parsing uses three helpers (`unwrapClarity`, `normalizeUInt`, `getNestedField`) that handle the nested `{ value: { type, value } }` shape returned by `cvToJSON`.

---

## Background Jobs

### `onChainTradeReconciler`

Polls Hiro API for pending transactions and finalizes them.

```
Every TRADE_RECONCILER_INTERVAL_MS (default: 120s prod / 5s dev):
  Find trades: { isOnChain: true, status: "pending", chainSyncStatus: "tx_submitted" }
  For each:
    GET /extended/v1/tx/:txid  →  tx_status
    "success"  → status = "completed"
               → updateOptionVolume()
               → trySyncOnChainOdds()       ← updates poll.options[].percentage
               → repairTradePricesForPoll() ← back-calculates price for chart
               → emit Socket.io trade-updated
    "abort_*"  → status = "failed"
```

### `onChainTransactionIndexer`

Indexes all contract transactions from Hiro API, maintaining a cursor in `MarketConfig` (`lastProcessedBlock` + `lastProcessedTxIndex`).

```
Every ONCHAIN_INDEXER_INTERVAL_MS (default: 15s):
  GET /extended/v1/address/{contractId}/transactions?offset=cursor
  For each new tx:
    Parse function name (buy-yes-auto, sell-no-auto, redeem, resolve, ...)
    Extract amount from tx events (actual STX transferred, not slippage bound)
    Upsert Trade (match pending intent by txid → update; else create new)
    Sync odds + repair prices for each touched poll
  Advance cursor
```

### `onChainOddsSync` (utility, not a standalone job)

Called by both jobs. Fetches `get-market-snapshot` via Hiro and applies LMSR math to compute `pYes`. Updates `poll.options[0].percentage` and `poll.options[1].percentage` atomically. Also called once at server startup for all active markets.

---

## Wallet Integration

Supported wallets:

| Wallet | Desktop | Mobile |
|--------|---------|--------|
| Leather | `@stacks/connect` | WalletConnect deep link |
| Xverse | `@stacks/connect` | WalletConnect deep link |

**Mobile flow:** the standard `openContractCall()` from `@stacks/connect` fails on mobile Leather. The app detects the user agent and falls back to WalletConnect (`REACT_APP_MOBILE_CONNECT_MODE=inapp-only`).

**Security:** before every transaction, `ensureWalletSigner(expectedAddress)` compares the currently connected wallet with the session address. If they differ (e.g., user switched accounts in the wallet app), the session is invalidated and the user is logged out automatically.

---

## Data Models

### `Poll`

Core entity representing one binary market (or a ladder rung with `marketType: "ladder"`).

| Field | Type | Description |
|-------|------|-------------|
| `marketId` | String | On-chain market ID (uint, stringified) |
| `title` | String | Market question |
| `category` / `subCategory` | String | Taxonomy |
| `options[]` | Array | `[{ text, percentage, totalVolume, totalTrades }]` — always 2 for binary |
| `isResolved` | Boolean | True after `resolve()` |
| `winningOption` | Number | 0 = YES, 1 = NO |
| `creationStatus` | String | `pending` → `confirmed` (on-chain lifecycle) |
| `isPaused` | Boolean | Trading halted |
| `marketType` | Enum | `"binary"` / `"ladder"` / `"ladder-comment"` |
| `ladderGroupId` | Number | Parent group ID (for rungs) |
| `ladderThreshold` | Number | Price threshold (for rungs) |
| `endDate` | Date | Close time |
| `totalVolume` / `totalTrades` / `uniqueTraders` | Number | Aggregate stats |

### `Trade`

Records every buy/sell intent and its on-chain status.

| Field | Type | Description |
|-------|------|-------------|
| `poll` | ObjectId | Reference to Poll |
| `user` | ObjectId | Reference to User |
| `type` | Enum | `"buy"` / `"sell"` |
| `optionIndex` | Number | 0 = YES, 1 = NO |
| `amount` | Number | Shares |
| `price` | Number | Implied probability at execution (0–1), repaired post-confirmation |
| `priceSource` | String | `indexed_onchain_snapshot` / `indexed_exact_from_events` / etc. |
| `totalValue` | Number | µSTX spent or received |
| `status` | Enum | `"pending"` → `"completed"` / `"failed"` |
| `isOnChain` | Boolean | Originated from a real wallet tx |
| `transactionHash` | String | Stacks txid (0x-prefixed) |
| `chainSyncStatus` | String | `tx_submitted` → `confirmed` / `failed` |

### `LadderGroup`

| Field | Type | Description |
|-------|------|-------------|
| `groupId` | Number | On-chain group ID |
| `title` | String | Group question |
| `resolutionSource` | String | Data source (e.g., "Binance BTCUSDT") |
| `closeTime` | Number | Unix timestamp |
| `status` | Enum | `active` / `resolving` / `resolved` |
| `finalValue` | Number | Observed value at resolution |
| `polls[]` | Array | `[{ marketId, label, threshold, operator }]` |
| `isPublic` | Boolean | Shown on homepage (default: false) |
| `commentPollRef` | ObjectId | Sentinel Poll used as comment thread anchor |

### `Transaction`

Deduplicated index of on-chain contract calls, keyed by `txid`. Stores raw args, block height, and cursor info. Used by the indexer to avoid double-processing.

### `MarketConfig`

Singleton document. Stores:
- `paused` — global trading halt flag
- `lastProcessedBlock` + `lastProcessedTxIndex` — indexer cursor (do not reset without understanding consequences)

### `User`

| Field | Type | Description |
|-------|------|-------------|
| `walletAddress` | String | Stacks principal (unique) |
| `email` | String | Optional, for email-based login |
| `username` | String | Display name |
| `isAdmin` | Boolean | Admin access flag |
| `savedPolls[]` | ObjectId[] | Watchlist |
| `totalTrades` | Number | Lifetime trade count |

---

## API Reference

### Auth — `/api/auth`

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| POST | `/wallet-login` | — | Sign in with Stacks wallet (creates user on first login) |
| POST | `/login` | — | Email + password login |
| POST | `/admin-login` | — | Admin login (checks `isAdmin` flag) |
| GET | `/me` | JWT | Current authenticated user |
| PUT | `/profile` | JWT | Update username, avatar, email |
| POST | `/logout` | JWT | Invalidate session |
| POST | `/refresh` | JWT | Refresh access token |

### Polls — `/api/polls`

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| GET | `/` | optional | List markets (paginated, filter by category/search) |
| GET | `/trending` | optional | Trending markets (15s cache) |
| GET | `/:id` | optional | Single market detail + trade history |
| GET | `/:id/holders` | — | Top YES/NO holders |
| POST | `/pending` | JWT | Create market intent (before on-chain tx) |
| POST | `/pending/:id/txid` | JWT | Attach blockchain txid |
| POST | `/confirm` | JWT | Confirm market is live on-chain |
| PUT | `/:id` | JWT | Update market (creator only) |
| POST | `/:id/save` | JWT | Toggle watchlist |
| PATCH | `/:id/odds` | Admin | Update bias percentage |

### Trades — `/api/trades`

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| POST | `/intents` | JWT | Create trade intent with quote |
| POST | `/intents/:id/attach-tx` | JWT | Attach txid to intent |
| POST | `/intents/:id/finalize` | JWT | Finalize after on-chain confirmation |
| GET | `/poll/:pollId` | — | All trades for a market |
| GET | `/me` | JWT | Authenticated user's trade history |
| GET | `/orderbook/:pollId/:optionIndex` | — | Order book snapshot |
| POST | `/redeem` | JWT | Claim winnings |

### Ladder — `/api/ladder`

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| GET | `/public/groups` | — | Public ladder groups (supports `?status=all&limit=N`) |
| GET | `/groups/:groupId` | — | Group detail + rungs + `commentPollId` |
| GET | `/groups/:groupId/trades` | — | Trade history for chart + transactions tab |
| GET | `/groups/:groupId/holders` | — | Top YES/NO holders across all rungs |
| POST | `/groups` | Admin | Create ladder group (also creates sentinel Poll) |
| POST | `/groups/:groupId/rungs` | Admin | Add a rung to a group |
| POST | `/groups/:groupId/resolve` | Admin | Resolve group + all rungs in MongoDB |
| PATCH | `/groups/:groupId/visibility` | Admin | Toggle `isPublic` |

### Admin — `/api/admin`

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/dashboard` | Global platform stats |
| GET/PUT/DELETE | `/polls/:id` | Poll management |
| POST | `/polls/:id/resolve` | Resolve with winning option |
| GET/PUT/DELETE | `/users/:id` | User management |
| POST | `/market/:marketId/pause` | Pause a market |
| POST | `/market/:marketId/set-bias` | Set YES bias |
| POST | `/uploads/image` | Upload image to S3 (max 2MB) |

---

## Environment Variables

### Backend (`server/.env`)

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `MONGODB_URI` | ✓ | MongoDB connection string | `mongodb+srv://user:pass@cluster/db` |
| `JWT_SECRET` | ✓ | JWT signing secret (long random string) | |
| `PORT` | ✓ | HTTP server port | `5000` |
| `NODE_ENV` | ✓ | Environment | `development` / `production` |
| `CLIENT_URL` | ✓ | Frontend origin for CORS | `http://localhost:3000` |
| `STACKS_NETWORK` | ✓ | Network target | `mainnet` / `testnet` |
| `CONTRACT_ADDRESS` | ✓ | Deployed contract principal | `SP3N5CN0...` |
| `CONTRACT_NAME` | ✓ | Deployed contract name | `market-factory-v20-bias` |
| `ONCHAIN_INDEXER_CONTRACT_ADDRESS` | — | Override indexer contract address | |
| `ONCHAIN_INDEXER_CONTRACT_NAME` | — | Override indexer contract name | |
| `HIRO_API_KEY` | — | Hiro API key (improves rate limits) | |
| `S3_IMAGES_BUCKET` | — | S3 bucket for image uploads | `stacksmarket-images` |
| `S3_IMAGES_REGION` | — | AWS region | `eu-west-1` |
| `TRADE_RECONCILER_ENABLED` | — | Enable reconciler job | `true` |
| `TRADE_RECONCILER_INTERVAL_MS` | — | Reconciler poll interval | `120000` |
| `TRADE_RECONCILER_BATCH_SIZE` | — | Trades per reconciler batch | `5` |
| `TRADE_RECONCILER_MIN_AGE_MS` | — | Min age before reconciling | `15000` |
| `ONCHAIN_INDEXER_ENABLED` | — | Enable indexer job | `true` |
| `ONCHAIN_INDEXER_INTERVAL_MS` | — | Indexer poll interval | `15000` |
| `ONCHAIN_INDEXER_PAGE_SIZE` | — | Transactions per Hiro page | `25` |
| `ONCHAIN_INDEXER_MAX_PAGES` | — | Max pages per indexer tick | `8` |

### Frontend (`client/.env`)

| Variable | Description |
|----------|-------------|
| `REACT_APP_BACKEND_URL` | Backend API base URL |
| `REACT_APP_STACKS_NETWORK` | `mainnet` / `testnet` |
| `REACT_APP_CONTRACT_ADDRESS` | Contract principal |
| `REACT_APP_CONTRACT_NAME` | Contract name |
| `REACT_APP_WALLETCONNECT_PROJECT_ID` | WalletConnect Cloud project ID |
| `REACT_APP_WC_XVERSE_ID` | Xverse wallet ID in WalletConnect |
| `REACT_APP_WC_LEATHER_ID` | Leather wallet ID in WalletConnect |
| `REACT_APP_MOBILE_CONNECT_MODE` | `inapp-only` in production |
| `REACT_APP_MOBILE_PREFERRED_WALLET` | `xverse` / `leather` |
| `REACT_APP_CONNECT_APP_NAME` | App name shown in wallet prompts |
| `REACT_APP_CONNECT_ICON_PATH` | App icon URL for wallet prompts |

---

## Local Development

### Prerequisites

- Node.js 20+
- MongoDB (local or Atlas free tier)
- [Clarinet](https://github.com/hirosystems/clarinet) (for contract development)

### Backend

```bash
cd StacksMarket_web/server
cp .env.example .env        # fill in MONGODB_URI, JWT_SECRET, etc.
npm install
npm run dev                 # nodemon with hot reload
```

The API will be available at `http://localhost:5000`.

### Frontend

```bash
cd StacksMarket_web/client
cp .env.example .env        # set REACT_APP_BACKEND_URL=http://localhost:5000
npm install
npm start                   # CRA dev server with hot reload
```

The frontend will be available at `http://localhost:3000`.

### Database utilities

```bash
cd StacksMarket_web/server
npm run db:clear            # drop all collections
npm run db:clear:keep-admin # drop all except admin users
npm run odds:backfill       # sync on-chain odds for all markets
```

---

## Testing Contracts

Tests run on **embedded simnet** — no external Stacks node required.

```bash
cd Satcksmarket_contracts/stacksmarket-cont
npm install

# Verify Clarity syntax
npm run check

# Run all tests (simnet, no cost)
npm run test:all

# Watch mode (re-runs on file changes)
npm run test:watch

# With coverage report
npm run test:cov
```

### Test suite

| File | Coverage |
|------|----------|
| `01_create_market.test.ts` | Market creation, initial state |
| `02_quotes_and_buys.test.ts` | Quotes, buy routing, fee distribution |
| `03_slippage_and_limits.test.ts` | Slippage protection, max-trade limits |
| `04_resolve_redeem_surplus.test.ts` | Resolution, redemption, surplus withdrawal |
| `05_pause_add_liquidity_b_fixed.test.ts` | Pause/unpause, fixed-b invariant |
| `06_fees_recipients_lock_complex.test.ts` | Fee splitting, lock permanence |
| `07_invariants_stress_multi_markets.test.ts` | Multi-market stress, LMSR invariants |
| `market_settlement.test.ts` | End-to-end settlement |

**Rule: testnet for any on-chain validation, simnet for unit tests. Never test on mainnet.**

---

## Deployment

### Frontend

Defined in `StacksMarket_web/client_redeployment.txt`. Requires explicit approval before running.

```
1. Set production environment variables (mainnet contract, wallet IDs)
2. npm run build
3. aws s3 sync ./build s3://stacksmarket.app --delete
4. aws cloudfront create-invalidation --paths "/*"
5. curl -I https://www.stacksmarket.app/    ← verify
```

### Backend

Defined in `StacksMarket_web/server_redeployment.txt`. Requires explicit approval before running.

```
1. docker build --platform linux/amd64 -t bw-stg-api .
2. aws ecr get-login-password | docker login ...
3. docker push <account>.dkr.ecr.<region>.amazonaws.com/bw-stg-api:<tag>
4. aws ecs register-task-definition ...   (new revision with new image)
5. aws ecs update-service --force-new-deployment
6. aws ecs wait services-stable
7. curl -I https://api.stacksmarket.app/health  ← verify
```

**Both scripts require AWS SSO profile `staging` and explicit user approval.**

### Contract deployment

Via Clarinet deployment plans in `Satcksmarket_contracts/stacksmarket-cont/deployments/`.

```bash
# Testnet
clarinet deployments apply --manifest Clarinet.toml \
  --deployment-plan-path deployments/default.testnet-plan.yaml

# Mainnet — requires explicit approval
clarinet deployments apply --manifest Clarinet.toml \
  --deployment-plan-path deployments/default.mainnet-plan.yaml
```

The deployer mnemonic lives in `settings/Mainnet.toml` and `settings/Testnet.toml` — both gitignored. Never commit them.

---

## Infrastructure (Production)

| Service | Purpose |
|---------|---------|
| **AWS ECS Fargate** | Runs the backend container (`bw-stg` cluster, `bw-stg-api-service`) |
| **AWS ECR** | Docker image registry (`bw-stg-api`) |
| **AWS S3 + CloudFront** | Frontend hosting (`stacksmarket.app`) with CDN invalidation on deploy |
| **AWS Secrets Manager** | `MONGODB_URI`, `HIRO_API_KEY` — never in plaintext env vars in prod |
| **AWS S3 (backups)** | Nightly MongoDB backup (`stacksmarket-backups`), lifecycle to Glacier |

The backup service (`ops/backup-service/`) runs as a separate container on a cron schedule, dumps MongoDB with `mongodump`, and uploads compressed archives to S3.

---

## Security Notes

- **`JWT_SECRET` and `MONGODB_URI`** must never be hardcoded or committed. In production they come from AWS Secrets Manager.
- **Mainnet is production.** Any on-chain interaction (even "test" reads that trigger writes) requires explicit approval. All validation uses testnet or simnet first.
- **The deployer mnemonic** (`settings/Mainnet.toml`) controls real funds. Treat it as a critical credential — same security as a private key.
- **`resolve()` is irreversible on-chain.** Once called, the market is permanently closed. There is no upgrade path — bugs on mainnet require migrating to a new contract.
- **`lock-fees-config` is irreversible.** Do not call on mainnet without explicit approval.
- **`withdraw-surplus`** is only valid when `winning_supply == 0`. Calling it while winners have not yet redeemed is a critical error that would drain their payout.
- **The `MarketConfig` indexer cursor** (`lastProcessedBlock`, `lastProcessedTxIndex`) must not be reset without understanding the consequences — doing so would trigger a full re-indexation of all contract transactions.
- **Image uploads** are admin-only and capped at 2MB. Uploaded to S3, never served from the backend process.
- **CORS** is restricted to `CLIENT_URL`. The `/api/stacks/call-read` proxy exists specifically to avoid exposing the Hiro API key to the browser.
- **Sensitive files gitignored:** `settings/Mainnet.toml`, `settings/Testnet.toml`, `.env`, `.env.*`, `*_redeployment.txt`, `deploy_actual.txt`, `taskdef*.json`, `AWS_users.txt`, `**/.claude/`
