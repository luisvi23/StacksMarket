# Backup diario MongoDB Atlas (M0) -> S3 (económico)

Este módulo implementa backups diarios de MongoDB Atlas (`M0` incluido) hacia `Amazon S3`, con:

- `mongodump` comprimido (`.archive.gz`)
- subida a S3
- `manifest.json` con `sha256`
- `latest.json` para localizar el último backup
- script de restauración manual
- script de verificación de restauración (opcional)

Todo está aislado en `ops/backup-service` para no tocar `server/` ni `client/`.

## Requisitos

1. `Node.js 18+`
2. `MongoDB Database Tools` (`mongodump`, `mongorestore`)
3. Credenciales AWS en el runner (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, opcional `AWS_SESSION_TOKEN`)
4. Acceso de red al cluster Atlas y allowlist IP del runner

## Instalación local (desarrollo/pruebas)

1. Instala dependencias:

```bash
cd ops/backup-service
npm install
```

2. Copia configuración:

```bash
cp .env.example .env
```

3. Rellena variables mínimas en `.env`:

- `AWS_REGION`
- `S3_BUCKET`
- `MONGODB_URI`
- `MONGODB_DATABASE`

4. Si `mongodump` no está en el `PATH`, configura:

- `MONGO_TOOLS_BIN_DIR=/ruta/al/bin`

## Paso a paso exacto (producción barata)

### 1) Crear bucket de backups en S3

- Nombre sugerido: `bitcoinworld-backups-prod`
- Región: la misma donde operes AWS (`us-east-1` si no tienes preferencia)
- Activar desde el inicio:
  - `Versioning`
  - `Object Lock` (si quieres inmutabilidad fuerte; requiere bucket nuevo)
  - `Block Public Access` completo
  - `Default encryption` (`SSE-KMS` preferido)

### 2) Configurar Lifecycle (barato)

Aplicar la regla del archivo `infra/aws/s3-lifecycle-rule-example.json`:

- Día `0-30`: `S3 Standard`
- Día `30-180`: `Glacier Instant Retrieval`
- Día `180+`: `Deep Archive`

CLI ejemplo:

```bash
aws s3api put-bucket-lifecycle-configuration \
  --bucket bitcoinworld-backups-prod \
  --lifecycle-configuration file://infra/aws/s3-lifecycle-rule-example.json
```

### 3) Crear IAM user/role para el runner

- Usa `infra/aws/iam-policy-backup-runner.json`
- Reemplaza:
  - `REPLACE_BUCKET_NAME`
  - `REGION`
  - `ACCOUNT_ID`
  - `REPLACE_KMS_KEY_ID` (si usas KMS)

Recomendación:
- Si corre en EC2, usa `IAM Role` (mejor que access keys).

### 4) Habilitar auditoría de objetos (muy importante)

En `CloudTrail`:

- Crear o usar un trail
- Habilitar `Data events`
- Tipo: `S3`
- Scope: solo el bucket `bitcoinworld-backups-prod`

Esto registra `PutObject`, `GetObject`, `DeleteObject`, etc. a nivel de objeto.

### 5) Configurar el servicio de backup

Editar `ops/backup-service/.env`:

```env
APP_NAME=bitcoinworld
BACKUP_ENV=prod
AWS_REGION=us-east-1
S3_BUCKET=bitcoinworld-backups-prod
S3_PREFIX=mongodb
S3_STORAGE_CLASS=STANDARD

MONGODB_URI=...
MONGODB_DATABASE=bitcoinworld

LOCAL_TMP_DIR=./tmp
KEEP_LOCAL_ARCHIVE=false
UPLOAD_MANIFEST=true
UPLOAD_LATEST_POINTER=true

VERIFY_RESTORE_ENABLED=true
VERIFY_RESTORE_MONGODB_URI=mongodb://127.0.0.1:27017
VERIFY_RESTORE_DATABASE=backup_verify
VERIFY_RESTORE_DROP_BEFORE=true
```

Nota:
- Para verificación diaria barata, lo ideal es restaurar en un Mongo local del servidor (contenedor/servicio local), no en el cluster productivo.

Si no tienes Mongo local, puedes levantar uno solo para verificación:

```bash
docker compose -f scripts/docker-compose.verify-mongo.yml up -d
```

### 6) Probar binarios y configuración

```bash
cd ops/backup-service
npm run doctor
```

### 7) Ejecutar un backup manual

```bash
npm run backup
```

Verifica que se crean:

- `s3://<bucket>/mongodb/prod/<db>/YYYY/MM/DD/*.archive.gz`
- `*.manifest.json`
- `latest.json`

### 8) Probar restauración manual (último backup)

Configura:

- `RESTORE_MONGODB_URI`
- `RESTORE_DATABASE` (recomendado: una DB de prueba)

Luego ejecuta:

```bash
npm run restore
```

### 9) Activar verificación diaria de restauración (opcional pero recomendado)

Configura en `.env`:

- `VERIFY_RESTORE_ENABLED=true`
- `VERIFY_RESTORE_MONGODB_URI`
- `VERIFY_RESTORE_DATABASE`

Ejecución:

```bash
npm run verify
```

### 10) Programar tareas diarias

En Linux (cron), usa `scripts/cron.example` como base:

- Backup diario `02:00 UTC`
- Verificación de restore `03:00 UTC`

Puedes cambiar la frecuencia más adelante sin tocar código (solo `crontab`).

## Restaurar un backup específico

```bash
npm run restore -- mongodb/prod/bitcoinworld/2026/02/24/bitcoinworld-prod-bitcoinworld-20260224T020000Z.archive.gz
```

## Qué se puede configurar más adelante sin rehacer nada

- Frecuencia (cron)
- Retención/ciclo (S3 Lifecycle)
- Storage class inicial (`S3_STORAGE_CLASS`)
- DB de verificación
- Migración de runner local a EC2/Lambda/otro host
- Migración de Atlas `M0` a `M10+`

## Limitaciones actuales (intencionales, para mantenerlo barato y simple)

- El backup es por `database` (`MONGODB_DATABASE`) y no “todo el cluster”
- La verificación comprueba restauración por éxito de `mongorestore` (sin tests funcionales de aplicación)
- No incluye despliegue automático de AWS (Terraform/CloudFormation), solo plantillas y pasos exactos
