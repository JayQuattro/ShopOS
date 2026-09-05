# Deploying a demo (Coolify or any Docker host)

This is the fastest path to a running ShopOS with seeded demo data — built
for showing the product and collecting feedback, not for production traffic.

## What you get

- **PostgreSQL 17** with a persistent volume
- **The app** — applies all migrations at boot, then seeds the deterministic
  demo org (idempotent: safe on every restart)
- **The worker** — outbox dispatcher for background email/jobs
- **Mailpit** — a web email inbox on port 8025 for testing outbound mail

Demo sign-in: `owner@example.test` / `demo-password-123` (also
`driver@example.test` for the customer portal view).

## Coolify steps

1. **New Resource → Docker Compose**, pointing at this repository
   (Coolify can connect your GitHub account and pick it directly). The
   compose file is `docker-compose.yml` at the repo root.
2. Set the environment variables (Coolify's env editor or a `.env`):
   - `BETTER_AUTH_URL` — the public URL Coolify assigns
     (e.g. `https://shopos-demo.example.com`)
   - `BETTER_AUTH_SECRET` — 32+ random chars: `openssl rand -base64 32`
   - `CONNECTOR_ENCRYPTION_KEY` — 32-byte base64 key (`openssl rand -base64 32`)
     used to envelope-encrypt integration credentials (email/SMS/storage keys).
     Required whenever you configure your own connectors.
   - Optional: `POSTGRES_PASSWORD` (change this for anything internet-facing),
     `APP_PORT` (default 3000), `MAILPIT_PORT` (default 8025),
     `SEED_DEMO` (default `true`)
3. Deploy. First boot builds the image, migrates, and seeds — watch the app
   container logs for `[shopos] applying database migrations…` and
   `[shopos] seeding demo data…`.
4. Open the app URL and sign in with the demo credentials above.

## Notes

- **Email in the demo**: password sign-in works out of the box. Magic links
  and customer authorization emails need an email connector — the platform
  plane (`/platform`) is a separate admin surface that requires its own
  operator bootstrap (`pnpm platform:bootstrap-operator`), so for quick demos
  prefer password sign-in and staff-recorded authorization decisions.
- **Updating**: redeploying pulls the latest commit, rebuilds, and applies
  any new migrations at boot. The seed only upserts the fixed demo rows —
  data you create yourself is untouched.
- **Resetting the demo**: delete the `shopos-db` volume (or `docker compose
down -v`) and redeploy.
- The compose uses the Dockerfile's `demo` target, which keeps the full
  toolchain in the image so boot can migrate and seed. The default
  (production) target stays lean — see `docs/deployment-architecture.md`.

## Try the demo flow

1. Sign in as the owner → **Work board** (drag RO-1042 through stages)
2. Open **RO-1042** → Parts tab → Stock holds → hold two sets of brake pads
3. Jobs & estimate → add a part line linked to stock → present the estimate
4. Reports → money over time, work mix, parts margin by job
5. **Vehicles** → the Subaru → warranty coverage + maintenance schedule
6. **Keys** and **Roadside** — tablet-friendly boards
