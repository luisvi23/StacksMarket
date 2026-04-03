# CLAUDE.md — Stacks Market Monorepo

## Qué es este proyecto

Plataforma de mercados de predicción on-chain construida sobre la red Stacks (Bitcoin L2). Los usuarios compran y venden posiciones (YES/NO) en mercados binarios usando STX. La liquidez sigue el modelo LMSR (Logarithmic Market Scoring Rule) con liquidez virtual (bias). La resolución y el pago son on-chain e irreversibles.

## Estructura del monorepo

```
STACKS_MARKET_UNIFIED/
├── Satcksmarket_contracts/     # Contratos Clarity + tests + deployments
│   └── bitcoinworld-cont/
└── StacksMarket_web/           # Backend Node.js + Frontend React + Ops
    ├── client/
    ├── server/
    └── ops/backup-service/
```

Los dos subproyectos son independientes pero acoplados por el contrato desplegado:

| Red | Contrato activo |
|-----|----------------|
| **Mainnet** | `SP3N5CN0PE7YRRP29X7K9XG22BT861BRS5BN8HFFA.market-factory-v20-bias` |
| **Testnet** | `ST1PSHE32YTEE21FGYEVTA24N681KRGSQM4VF9XZP.market-factory-v20-6-bias` |

El backend indexa las transacciones del contrato vía Hiro API. El frontend llama al contrato directamente desde el navegador (Leather/Xverse/WalletConnect) y usa el backend solo para estado off-chain, autenticación y datos de usuario.

## Reglas de aprobación — OBLIGATORIO LEER

### Ningún deploy a producción sin aprobación explícita

Antes de ejecutar cualquier acción irreversible o visible para usuarios reales, hay que:

1. Presentar un **resumen de los cambios** (qué ficheros, qué funciones, qué comportamiento cambia)
2. Confirmar que la **demo local funciona** (testnet o simnet según corresponda)
3. Esperar **aprobación explícita** del usuario palabra por palabra

Esto aplica a:
- Cualquier ejecución de `client_redeployment.txt` o `server_redeployment.txt`
- Cualquier `docker push` / `aws ecs update-service`
- Cualquier `aws s3 sync` apuntando a `stacksmarket.app`
- Cualquier `aws cloudfront create-invalidation`
- Cualquier interacción con el contrato en mainnet (ver abajo)

### Mainnet es producción — las pruebas van a testnet

**Mainnet = dinero real de usuarios reales. No se hacen pruebas en mainnet.**

Toda validación de contratos, configuración de fees, bias, pause/unpause, resolve, o cualquier otro cambio on-chain se hace primero en **testnet** (o simnet local). Solo se pasa a mainnet tras aprobación explícita y con la certeza de que el cambio ya ha sido validado.

### Los scripts de deploy aprobados son los únicos caminos válidos

- **Frontend:** `StacksMarket_web/client_redeployment.txt`
- **Backend:** `StacksMarket_web/server_redeployment.txt`

No improvisar comandos de deploy fuera de estos scripts sin aprobación.

## Convenciones generales

- **Moneda interna:** µSTX (microstacks). 1 STX = 1.000.000 µSTX. Todas las cantidades on-chain van en µSTX.
- **Scripts de deploy:** PowerShell (`.txt` con comandos PS, no `.sh`)
- **Node.js:** versión 20
- **Contratos:** Clarity v4, Epoch 3.3
- **Tests de contratos:** Vitest + Clarinet SDK sobre simnet embebido (`npm run test:all` en `Satcksmarket_contracts/bitcoinworld-cont/`)
- **Tests de backend:** no hay suite automatizada actualmente — validar manualmente contra testnet
- **Secrets:** nunca en Git. En producción van en AWS Secrets Manager. Localmente en `.env` (ignorado por `.gitignore`).
- **Ficheros sensibles ignorados:** `settings/Mainnet.toml`, `settings/Testnet.toml`, `.env`, `.env.*`, `*_redeployment.txt`, `deploy_actual.txt`, `taskdef*.json`, `AWS_users.txt`, `**/.claude/`
