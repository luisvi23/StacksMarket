# Arquitectura propuesta (económica y escalable)

## Objetivo

- Hacer backup diario de MongoDB Atlas (`M0`) a `S3`
- Mantener registro/auditoría de accesos y cambios
- Poder restaurar manualmente y validar restauración de forma periódica
- Mantener todo el código fuera de `server/` y `client/`

## Estructura de carpetas

```text
ops/
  backup-service/
    .env.example
    package.json
    ARCHITECTURE.md
    README.md
    src/
      cli.js
      config.js
      logger.js
      utils.js
      s3.js
      backup.js
      restore.js
      verify.js
      doctor.js
    infra/
      aws/
        iam-policy-backup-runner.json
        s3-lifecycle-rule-example.json
        s3-bucket-hardening-checklist.md
    scripts/
      cron.example
      docker-compose.verify-mongo.yml
      run-backup.ps1
      run-verify.ps1
```

## Flujo (backup)

1. `mongodump` genera un archivo `.archive.gz` del DB configurado.
2. Se calcula `sha256`.
3. Se sube el archivo a `S3` (`STANDARD` al inicio).
4. Se sube `manifest.json` con metadatos y checksum.
5. Se actualiza `latest.json`.
6. `S3 Lifecycle` mueve backups antiguos a `GLACIER_IR` y luego a `DEEP_ARCHIVE`.

## Flujo (verificación de restauración)

1. Busca el backup más reciente en S3.
2. Lo descarga temporalmente.
3. Ejecuta `mongorestore` contra una base destino de validación (`backup_verify`).
4. Registra logs estructurados (JSON) para auditoría operativa.

## Despliegue recomendado (más barato)

- Ejecutar en el mismo servidor donde ya corre backend (si existe) con `cron`.
- Si no existe servidor persistente, usar una `EC2 t4g.nano` / `t3.nano` o un runner ya existente.
- Mantener el servicio como scripts one-shot (`npm run backup` y `npm run verify`) llamados por `cron`.

## Auditoría total

- `S3 Versioning` + `Object Lock`
- `CloudTrail Data Events` para el bucket de backups
- `CloudWatch Logs` / logs del sistema del runner

## Configurabilidad futura

- Cambiar horarios en `cron` (sin tocar código)
- Cambiar retención en `S3 Lifecycle`
- Migrar luego a `M10+` sin perder la lógica de backup externo
