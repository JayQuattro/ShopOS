#!/bin/sh
# Demo/self-host boot: apply migrations, optionally seed the deterministic
# demo data, then exec the container command. Safe to re-run — migrations
# are incremental and the seed is idempotent upserts.
set -e

if [ "${SKIP_MIGRATIONS:-false}" != "true" ]; then
  echo "[shopos] applying database migrations…"
  pnpm exec prisma migrate deploy
fi

if [ "${SEED_DEMO:-false}" = "true" ]; then
  echo "[shopos] seeding demo data (idempotent)…"
  pnpm exec prisma db seed || echo "[shopos] seed did not run; continuing."
fi

exec "$@"
