# Etapa 1: dependencias de producción
FROM public.ecr.aws/docker/library/node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

# Etapa 2: runtime mínimo
FROM public.ecr.aws/docker/library/node:20-alpine
WORKDIR /app
ENV NODE_ENV=production \
    PORT=80
# usuario no root por seguridad
RUN addgroup -S nodegrp && adduser -S nodeuser -G nodegrp
COPY --from=deps /app/node_modules ./node_modules
COPY . .
EXPOSE 80
USER nodeuser
HEALTHCHECK --interval=30s --timeout=3s --retries=3 CMD wget -qO- http://127.0.0.1:${PORT}/health || exit 1
CMD ["node","index.js"]
