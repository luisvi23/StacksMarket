FROM public.ecr.aws/docker/library/node:20-alpine

# Install MongoDB Database Tools (mongodump)
RUN apk add --no-cache mongodb-tools

WORKDIR /app

RUN addgroup -S backupgrp && adduser -S backupuser -G backupgrp

COPY package*.json ./
RUN npm ci --omit=dev

COPY src/ ./src/

RUN mkdir -p /app/tmp && chown backupuser:backupgrp /app/tmp

USER backupuser

CMD ["node", "src/cli.js", "backup"]
