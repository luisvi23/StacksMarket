# Dev/Testnet Deployment Guide

Entorno de desarrollo compartido para que el equipo pueda testear. Separado del entorno de producción (que sigue en AWS sin cambios).

## Arquitectura

| Componente | Servicio | Coste | URL |
|------------|----------|-------|-----|
| Frontend (React) | Vercel | Gratis | `https://<proyecto>.vercel.app` |
| Backend (Node/Express) | Render.com | Gratis (free tier) | `https://<servicio>.onrender.com` |
| Base de datos | MongoDB Atlas | Gratis (M0, 512MB) | `mongodb+srv://...` |
| Red Stacks | Testnet | Gratis | — |

**Limitación del free tier de Render:** el servicio se "duerme" tras 15 minutos sin tráfico. El primer request después tarda ~30s en arrancar. No afecta a testing compartido.

---

## Paso 1 — MongoDB Atlas

1. Ve a https://www.mongodb.com/cloud/atlas/register y crea una cuenta gratis.
2. Crea un **Cluster M0** (free tier, 512MB).
3. En **Database Access** crea un usuario:
   - Username: `stacksmarket-dev`
   - Password: genera una aleatoria y guárdala
4. En **Network Access** añade: `0.0.0.0/0` (permite conexiones desde cualquier IP — necesario porque Render no da IP fija en free tier).
5. En **Connect** copia el connection string. Te dará algo como:
   ```
   mongodb+srv://stacksmarket-dev:<password>@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority
   ```
   Añádele la DB: `/stacksmarket-dev` antes del `?`:
   ```
   mongodb+srv://stacksmarket-dev:<password>@cluster0.xxxxx.mongodb.net/stacksmarket-dev?retryWrites=true&w=majority
   ```

---

## Paso 2 — Backend en Render.com

1. Ve a https://dashboard.render.com y crea una cuenta (puedes conectar con GitHub).
2. En el dashboard, **New > Blueprint**.
3. Conecta este repositorio de GitHub.
4. Render detectará automáticamente el archivo `StacksMarket_web/server/render.yaml`.
5. Haz clic en **Apply**.
6. El servicio se creará con nombre `stacksmarket-api-dev`.
7. Configura las **environment variables** marcadas como `sync: false` (ver [.env.dev.example](StacksMarket_web/server/.env.dev.example)):
   - `MONGODB_URI` → el connection string del paso 1
   - `JWT_SECRET` → genera uno random: `openssl rand -hex 64` (en cmd/powershell usa un generador online)
   - `CLIENT_URL` → **lo rellenas después del paso 3** con la URL de Vercel
   - `HIRO_API_KEY` → opcional, obtén una gratis en https://platform.hiro.so/
   - `CLOUDINARY_*` → opcional, solo si se van a subir imágenes
8. Haz **Manual Deploy** o espera a que autodeploy detecte el push.
9. Espera a que el estado sea "Live". Copia la URL (ej. `https://stacksmarket-api-dev.onrender.com`).
10. Verifica: `curl https://stacksmarket-api-dev.onrender.com/health` → debe devolver `ok`.

---

## Paso 3 — Frontend en Vercel

1. Ve a https://vercel.com y crea una cuenta (conecta GitHub).
2. **Add New > Project**.
3. Importa este repo.
4. Configura:
   - **Root Directory**: `StacksMarket_web/client`
   - **Framework Preset**: Create React App (detecta automático por `vercel.json`)
   - Build Command, Output Directory, Install Command: ya definidos en `vercel.json`
5. En **Environment Variables** añade todas las de [.env.dev.example](StacksMarket_web/client/.env.dev.example):
   - `REACT_APP_API_URL` → la URL de Render del paso 2
   - `REACT_APP_SOCKET_URL` → misma URL de Render
   - `REACT_APP_STACKS_NETWORK=testnet`
   - `REACT_APP_CONTRACT_ADDRESS=ST1PSHE32YTEE21FGYEVTA24N681KRGSQM4VF9XZP`
   - `REACT_APP_CONTRACT_NAME=market-factory-v21-testnet-bias`
   - Resto de variables `REACT_APP_*` del `.env.dev.example`
6. Haz **Deploy**.
7. Cuando termine, copia la URL (ej. `https://stacksmarket-dev.vercel.app`).

---

## Paso 4 — Conectar frontend ↔ backend (CORS)

1. Vuelve a **Render dashboard > stacksmarket-api-dev > Environment**.
2. Añade/actualiza `CLIENT_URL` con la URL de Vercel del paso 3.
   - Si quieres permitir múltiples orígenes: `https://stacksmarket-dev.vercel.app,https://stacksmarket-dev-preview.vercel.app`
3. Render redeploya automáticamente.

---

## Paso 5 — Verificar

1. Abre la URL de Vercel.
2. Abre la consola del navegador.
3. Comprueba que las peticiones a `/api/...` van al backend de Render y devuelven 200.
4. Conecta una wallet de testnet (Leather/Xverse) con STX de testnet.
5. Navega a los mercados ladder y verifica que cargan.

---

## Workflow de actualización

Cada push a `master` dispara:
- **Vercel**: nuevo deploy del frontend automáticamente.
- **Render**: nuevo deploy del backend automáticamente (autoDeploy está habilitado en `render.yaml`).

Para desactivar auto-deploy temporalmente, desactívalo en los respectivos dashboards.

---

## Qué NO se toca

- `StacksMarket_web/server_redeployment.txt` / `client_redeployment.txt` — scripts de producción (AWS). Sin cambios.
- `StacksMarket_web/.env.production` — config de mainnet. Sin cambios.
- `Dockerfile`, `docker-compose*.yml` — producción AWS Fargate. Sin cambios.
- Contratos mainnet. Este entorno usa **testnet únicamente**.

---

## Troubleshooting

**Backend tarda mucho la primera petición:**
Es el cold start del free tier de Render (~30s). Normal.

**Error de CORS:**
Verifica que `CLIENT_URL` en Render coincide exactamente con la URL de Vercel (sin `/` final).

**MongoDB connection error:**
Comprueba que en Atlas tienes `0.0.0.0/0` en Network Access.

**Mercados no cargan datos on-chain:**
El backend sin `HIRO_API_KEY` se rate-limita. Obtén una key gratis en https://platform.hiro.so/.

**Socket.io no conecta:**
Render soporta WebSockets en free tier, pero verifica que `REACT_APP_SOCKET_URL` usa `https://` (no `wss://`; socket.io lo upgrada solo).
