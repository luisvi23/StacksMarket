# S3 bucket (seguridad + auditoría)

Configura el bucket de backups con estas opciones:

1. `Versioning: Enabled`
2. `Object Lock: Enabled` (crear bucket nuevo con esta opción)
3. `Default encryption: SSE-S3` o `SSE-KMS` (preferido)
4. `Block Public Access: ON` en todas las opciones
5. `CloudTrail Data Events` habilitado solo para este bucket
6. `Lifecycle` con transición a `GLACIER_IR` y `DEEP_ARCHIVE`
7. `Bucket policy` que niegue tráfico sin TLS (`aws:SecureTransport=false`)
8. Opcional: denegar `s3:DeleteObject` al rol de backup si quieres política WORM fuerte

Ejemplo policy TLS (añadir junto a tus permisos):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "DenyInsecureTransport",
      "Effect": "Deny",
      "Principal": "*",
      "Action": "s3:*",
      "Resource": [
        "arn:aws:s3:::REPLACE_BUCKET_NAME",
        "arn:aws:s3:::REPLACE_BUCKET_NAME/*"
      ],
      "Condition": {
        "Bool": {
          "aws:SecureTransport": "false"
        }
      }
    }
  ]
}
```
