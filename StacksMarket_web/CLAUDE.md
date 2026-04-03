# CLAUDE.md — StacksMarket Web

## Stack técnico

| Capa | Tecnología |
|------|-----------|
| Frontend | React 18, Tailwind CSS, `@stacks/connect`, Socket.io client |
| Backend | Node.js 20, Express, MongoDB (Mongoose), Socket.io |
| Blockchain | Stacks mainnet vía Hiro API, wallets Leather / Xverse / WalletConnect |
| Infra prod | AWS ECS Fargate (API), S3 + CloudFront (frontend), ECR, Secrets Manager |
| Ops | Backup MongoDB → S3 (`ops/backup-service/`) |

---

## Estructura del proyecto

```
StacksMarket_web/
├── client/                  # React SPA
│   ├── src/
│   │   ├── components/ladder/        # LadderGroupView.js, LadderGroupCard.js
│   │   ├── contexts/stacks/ladderClient.js  # Contrato v21 — funciones escalera
│   │   ├── pages/LadderGroupDetail.js
│   │   ├── App.js           # Rutas y layout principal
│   │   ├── pages/           # Una página por vista
│   │   ├── components/      # Componentes reutilizables
│   │   ├── contexts/        # Estado global (auth, tema, constantes)
│   │   │   └── stacks/      # Integración blockchain
│   │   │       ├── marketClient.js   # Llama al contrato
│   │   │       └── staticPayload.js  # Payloads preconstruidos
│   │   └── utils/
│   │       ├── stacksConnect.js  # Conexión de wallets
│   │       └── stx.js            # Conversión STX ↔ µSTX
│   └── public/
├── server/                  # API REST + Socket.io
│   ├── index.js             # Entry point, Express + Socket.io
│   ├── routes/              # Rutas por módulo
│   ├── models/              # Schemas Mongoose
│   ├── middleware/          # auth.js (JWT)
│   ├── jobs/                # Background jobs
│   └── utils/               # marketState.js, onChainOddsSync.js
└── ops/
    └── backup-service/      # Backup MongoDB → S3
```

---

## API del backend (todas las rutas)

### Auth — `/api/auth`
| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/wallet-login` | Login con wallet Stacks (crea usuario si es nuevo) |
| POST | `/register` | Registro email/wallet con password opcional |
| POST | `/admin-login` | Login admin (verifica flag `isAdmin`) |
| POST | `/login` | Login email + password |
| GET | `/me` | Usuario autenticado actual |
| PUT | `/profile` | Actualizar perfil (username, avatar, email, walletAddress) |
| POST | `/logout` | Logout (limpieza client-side) |
| POST | `/refresh` | Refrescar JWT |

### Polls — `/api/polls`
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/` | Listar polls (paginación, filtro por categoría/búsqueda) |
| GET | `/trending` | Trending polls (caché 15s TTL) |
| GET | `/categories` | Categorías disponibles |
| GET | `/user/saved` | Polls guardados por el usuario |
| GET | `/:id` | Detalle de un poll |
| GET | `/:id/holders` | Usuarios con posición en un poll |
| POST | `/` | Crear poll (requiere auth) |
| POST | `/pending` | Crear poll en estado pendiente (pre-blockchain) |
| POST | `/pending/:id/txid` | Adjuntar txid de blockchain al poll pendiente |
| POST | `/pending/:id/reconcile` | Reconciliar tras confirmación on-chain |
| POST | `/confirm` | Confirmar que el poll está on-chain |
| PUT | `/:id` | Actualizar poll (solo creador) |
| DELETE | `/:id` | Eliminar poll (solo creador) |
| POST | `/:id/save` | Guardar/marcar poll como favorito |
| POST | `/:id/redeem` | Canjear ganancias en poll resuelto |
| PATCH | `/:id/odds` | Actualizar odds/bias (admin, solo binarios) |

### Trades — `/api/trades`
| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/` | Crear intent de trade on-chain |
| POST | `/intents` | Crear intent con quote |
| POST | `/intents/:id/attach-tx` | Adjuntar txid al intent |
| POST | `/intents/:id/finalize` | Finalizar trade tras confirmación |
| GET | `/poll/:pollId` | Todos los trades de un poll |
| GET | `/me` | Trades del usuario autenticado |
| GET | `/user` | Alias de `/me` |
| GET | `/orderbook/:pollId/:optionIndex` | Order book de una opción |
| DELETE | `/:id` | Cancelar trade |
| POST | `/redeem` | Reclamar ganancias |
| GET | `/claimed/:pollId` | Trades reclamados del usuario en un poll |

### Users — `/api/users`
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/me/dashboard` | Dashboard: polls guardados + trades canjeables + historial |
| GET | `/profile` | Perfil del usuario autenticado |
| PUT | `/profile` | Actualizar perfil |
| GET | `/trades` | Historial de trades (paginado, filtrable) |
| GET | `/portfolio` | Posiciones activas |
| GET | `/created-polls` | Polls creados por el usuario |
| GET | `/saved-polls` | Polls guardados |
| GET | `/stats` | Estadísticas (trades, win rate, polls creados) |
| GET | `/:id` | Perfil público de un usuario |

### Comments — `/api/comments`
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/poll/:pollId` | Comentarios de un poll (paginados) |
| POST | `/` | Crear comentario (requiere auth) |
| PUT | `/:id` | Editar comentario (solo autor) |
| DELETE | `/:id` | Borrar comentario (soft delete, autor o admin) |
| POST | `/:id/like` | Dar like |
| POST | `/:id/dislike` | Dar dislike |
| POST | `/:id/flag` | Reportar comentario |
| GET | `/user` | Comentarios del usuario autenticado |

### Admin — `/api/admin`
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/dashboard` | Stats globales |
| GET/PUT/DELETE | `/polls/:id` | Gestión de polls |
| POST | `/polls/:id/resolve` | Resolver poll con opción ganadora |
| POST | `/polls/:id/withdraw-surplus` | Marcar surplus como retirado |
| GET/PUT/DELETE | `/users/:id` | Gestión de usuarios |
| GET | `/trades` | Todos los trades |
| GET/POST | `/comments/:id/moderate` | Moderación de comentarios |
| POST | `/market/:marketId/pause` | Pausar mercado |
| POST | `/market/:marketId/unpause` | Reanudar mercado |
| POST | `/market/:marketId/set-max-trade` | Límite por trade |
| POST | `/market/:marketId/set-bias` | Bias inicial YES/NO (solo binarios) |

### Otros
| Módulo | Ruta | Descripción |
|--------|------|-------------|
| Stacks | `GET /api/stacks/tx/:txId` | Proxy a Hiro API para estado de tx |
| Stacks | `POST /api/stacks/call-read` | Proxy para read-only calls (evita CORS) |
| Stacks | `GET /api/stacks/chain-tip` | Bloque actual de Stacks |
| Market | `GET /api/market/status` | Estado de pausa global |
| Market | `POST /api/market/admin/pause` | Pausar todo el mercado (admin) |
| Uploads | `POST /api/uploads/image` | Subir imagen a S3 (admin, máx 2MB) |

---

## Mercados escalera (v21)

Los mercados escalera son grupos de mercados binarios con distintos umbrales. Flujo completo:

1. **Admin crea el grupo on-chain** → `createLadderGroup()` en `ladderClient.js`
2. **Admin registra grupo en MongoDB** → `POST /api/ladder/groups`
3. **Admin añade peldaños on-chain** → `addRung()` por cada umbral
4. **Admin registra peldaños en MongoDB** → `POST /api/ladder/groups/:id/rungs`
5. **Resolución:** admin llama `resolveLadderGroup(g, finalValue)` on-chain → luego `POST /api/ladder/groups/:id/resolve` → luego `resolveRung(m)` por cada peldaño

Ficheros clave:
- `server/models/LadderGroup.js` — modelo MongoDB del grupo
- `server/routes/ladder.js` — todas las rutas `/api/ladder/*`
- `client/src/contexts/stacks/ladderClient.js` — llamadas al contrato v21
- `client/src/components/ladder/LadderGroupView.js` — tabla estilo Polymarket
- `client/src/components/ladder/LadderGroupCard.js` — card para listados
- `client/src/pages/LadderGroupDetail.js` — página de detalle, ruta `/ladder/:groupId`

---

## Modelos de datos

| Modelo | Campos clave |
|--------|-------------|
| **User** | `walletAddress` (único), `email`, `username`, `isAdmin`, `balance`, `savedPolls[]` |
| **Poll** | `marketId` (ID on-chain), `title`, `category`, `options[]`, `isResolved`, `winningOption`, `creationStatus`, `isPaused` |
| **Trade** | `poll`, `user`, `type` (buy/sell), `optionIndex`, `amount`, `chainSyncStatus`, `transactionHash`, `isOnChain` |
| **Transaction** | `txid` (único), `functionName`, `kind` (buy/sell/redeem/resolve), `marketId`, `walletAddress`, `blockHeight` |
| **Comment** | `poll`, `user`, `content`, `parentComment`, `likes[]`, `isFlagged`, `isDeleted` |
| **MarketConfig** | Singleton: `paused`, cursor del indexer (`lastProcessedBlock`, `lastProcessedTxIndex`) |
| **LadderGroup** | `groupId` (on-chain), `title`, `resolutionSource`, `closeTime`, `status` (active/resolving/resolved), `finalValue`, `polls[]` |

---

## Integración con el contrato Stacks

El frontend **llama al contrato directamente desde el navegador**, sin pasar por el backend:

```
marketClient.js
  ├── Read-only (via proxy /api/stacks/call-read para evitar CORS):
  │   ├── quote-buy-yes-by-sats / quote-buy-no-by-sats  ← quote dado presupuesto
  │   ├── quote-buy-yes / quote-buy-no                  ← quote dado nº shares
  │   └── quote-sell-yes / quote-sell-no
  │
  └── Transacciones (directas al nodo Stacks vía wallet):
      ├── buy-yes-auto / buy-no-auto
      ├── sell-yes-auto / sell-no-auto
      ├── redeem
      ├── resolve (admin)
      └── pause / unpause / set-max-trade (admin)
```

`stacksConnect.js` gestiona la conexión de wallets:
- **Desktop:** Leather o Xverse via `@stacks/connect`
- **Mobile Leather:** WalletConnect (el `openContractCall()` estándar falla en mobile Leather)
- **Seguridad:** antes de cada transacción verifica que la wallet activa coincide con la sesión; si cambia, hace logout automático

---

## Jobs en background

### `onChainTradeReconciler`
Sincroniza el estado de transacciones pendientes consultando Hiro API. Cuando una tx se confirma, actualiza el Trade, emite evento Socket.io `trade-updated`, y actualiza los odds del poll.

- Variable de control: `TRADE_RECONCILER_ENABLED`
- Intervalo configurable: `TRADE_RECONCILER_INTERVAL_MS` (default 120s en prod)

### `onChainTransactionIndexer`
Indexa todas las transacciones del contrato desde Hiro API. Parsea `buy-yes/no`, `sell-yes/no`, `redeem`, `resolve`. Mantiene un cursor (`lastProcessedBlock` + `lastProcessedTxIndex`) en `MarketConfig`. Actualiza volúmenes y porcentajes de las opciones del poll.

- Variable de control: `ONCHAIN_INDEXER_ENABLED`
- Intervalo configurable: `ONCHAIN_INDEXER_INTERVAL_MS` (default 30s en prod)

Al arrancar el servidor también se ejecuta `syncAllActiveMarkets()` para sincronizar odds de todos los mercados activos.

---

## Variables de entorno

### Backend (`server/.env`)

| Variable | Descripción | Ejemplo |
|----------|-------------|---------|
| `MONGODB_URI` | URI de conexión MongoDB | `mongodb+srv://...` |
| `JWT_SECRET` | Secreto para firmar tokens JWT | string aleatorio largo |
| `PORT` | Puerto del servidor | `5000` |
| `NODE_ENV` | Entorno | `development` / `production` |
| `CLIENT_URL` | URL del frontend (CORS) | `http://localhost:3000` |
| `STACKS_NETWORK` | Red Stacks | `mainnet` / `testnet` |
| `CONTRACT_ADDRESS` | Dirección del contrato | `SP3N5CN0...` |
| `CONTRACT_NAME` | Nombre del contrato | `market-factory-v20-bias` |
| `HIRO_API_KEY` | API key de Hiro (opcional, mejora rate limits) | |
| `S3_IMAGES_BUCKET` | Bucket S3 para imágenes | `bitcoinworld-images` |
| `S3_IMAGES_REGION` | Región del bucket | `eu-west-1` |
| `TRADE_RECONCILER_ENABLED` | Activar reconciliador | `true` |
| `TRADE_RECONCILER_INTERVAL_MS` | Intervalo del reconciliador | `120000` |
| `TRADE_RECONCILER_BATCH_SIZE` | Batch del reconciliador | `5` |
| `ONCHAIN_INDEXER_ENABLED` | Activar indexer | `true` |
| `ONCHAIN_INDEXER_CONTRACT_ADDRESS` | Dirección a indexar | `SP3N5CN0...` |
| `ONCHAIN_INDEXER_CONTRACT_NAME` | Contrato a indexar | `market-factory-v20-bias` |
| `ONCHAIN_INDEXER_INTERVAL_MS` | Intervalo del indexer | `30000` |

### Frontend (`client/.env`)

| Variable | Descripción |
|----------|-------------|
| `REACT_APP_BACKEND_URL` | URL del backend |
| `REACT_APP_STACKS_NETWORK` | `mainnet` / `testnet` |
| `REACT_APP_CONTRACT_ADDRESS` | Dirección del contrato |
| `REACT_APP_CONTRACT_NAME` | Nombre del contrato |
| `REACT_APP_WALLETCONNECT_PROJECT_ID` | Project ID de WalletConnect |
| `REACT_APP_WC_XVERSE_ID` | ID de Xverse en WalletConnect |
| `REACT_APP_WC_LEATHER_ID` | ID de Leather en WalletConnect |
| `REACT_APP_MOBILE_CONNECT_MODE` | `inapp-only` en producción |
| `REACT_APP_MOBILE_PREFERRED_WALLET` | `xverse` / `leather` |
| `REACT_APP_CONNECT_APP_NAME` | Nombre mostrado en wallets |
| `REACT_APP_CONNECT_ICON_PATH` | URL del icono de la app |

---

## Servicios AWS en producción

| Servicio | Uso |
|----------|-----|
| **ECS Fargate** | Corre el contenedor del backend (`bw-stg` cluster, `bw-stg-api-service`) |
| **ECR** | Registro de imágenes Docker (`bw-stg-api`) |
| **S3 + CloudFront** | Hosting del frontend React (`stacksmarket.app`, distribución CloudFront) |
| **Secrets Manager** | `MONGODB_URI` y `HIRO_API_KEY` — nunca en variables de entorno planas en prod |
| **S3 (backups)** | Backup nightly de MongoDB (`bitcoinworld-backups`), con lifecycle a Glacier |

---

## Flujo de deploy

### Frontend
Script: `client_redeployment.txt`

1. Configurar variables de entorno de build (mainnet, contract address, wallet IDs)
2. `npm run build` en `client/`
3. `aws s3 sync ./build s3://stacksmarket.app --delete`
4. `aws cloudfront create-invalidation --paths "/*"`
5. Verificar con `curl -I https://www.stacksmarket.app/`

### Backend
Script: `server_redeployment.txt`

1. `docker build --platform linux/amd64` en `server/`
2. Login a ECR: `aws ecr get-login-password | docker login`
3. `docker push` con tag `<git-short-hash>-<timestamp>`
4. Describir la task definition actual de ECS
5. Registrar nueva revisión con la imagen nueva + env vars de runtime
6. `aws ecs update-service --force-new-deployment`
7. `aws ecs wait services-stable`
8. `curl -I https://api.stacksmarket.app/health`

**Ambos scripts requieren perfil AWS SSO `staging` y aprobación explícita antes de ejecutarse.**

---

## Advertencias

- `JWT_SECRET` y `MONGODB_URI` nunca deben hardcodearse — en producción van en AWS Secrets Manager
- El indexer escribe en `MarketConfig` como cursor — no borrar ni resetear ese documento sin entender las consecuencias (causaría re-indexación completa)
- Las task definitions de ECS (`taskdef*.json`) se regeneran automáticamente en cada deploy — no versionar en Git
- **Mainnet es producción.** Cualquier validación con el contrato real se hace en testnet primero.
