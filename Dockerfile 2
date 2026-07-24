# ShopOS production image.
#
# Multi-stage build producing a minimal non-root container running the Next.js
# standalone server. PostgreSQL migrations run as a separate explicit release
# step, not opportunistically from the web replica (docs/deployment-principles.md).
#
# Build:  docker build -t shopos .
# Run:    docker run -p 3000:3000 -e DATABASE_URL=... -e BETTER_AUTH_SECRET=... shopos

# ---- Dependencies ----
FROM node:24-slim AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY prisma ./prisma/
RUN pnpm install --frozen-lockfile

# ---- Build ----
FROM node:24-slim AS builder
WORKDIR /app
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
ENV DATABASE_URL=postgres://placeholder:placeholder@localhost:5432/placeholder
RUN pnpm db:generate
RUN pnpm build

# ---- Runtime ----
FROM node:24-slim AS runner
WORKDIR /app

# Run as a non-root user (uid 1001).
RUN groupadd --system --gid 1001 shopos && \
    useradd --system --uid 1001 --gid shopos --no-create-home --home-dir /app shopos

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Copy the standalone build output, static assets, and the Prisma migration
# files (the entrypoint runs migrations if ENABLE_MIGRATIONS is set).
COPY --from=builder --chown=shopos:shopos /app/.next/standalone ./
COPY --from=builder --chown=shopos:shopos /app/.next/static ./.next/static
COPY --from=builder --chown=shopos:shopos /app/public ./public
COPY --from=builder --chown=shopos:shopos /app/prisma ./prisma
COPY --from=builder --chown=shopos:shopos /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder --chown=shopos:shopos /app/src/generated ./src/generated

USER shopos

EXPOSE 3000

# Health check against the documented health endpoint.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>{process.exit(r.ok?0:1)}).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
