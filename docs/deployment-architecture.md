# Deployment architecture

ShopOS deployment infrastructure is intentionally separate from the runtime application. Cloud
infrastructure-as-code uses separate packages or a dedicated repository with isolated deployment
identities and credentials. The application must remain deployable without any ShopOS-operated
service.

## Infrastructure-as-code tool

**Terraform** is the selected IaC tool. Rationale:

- Open-source, cloud-agnostic, widely understood
- Strong state management for multi-environment deployment
- Supports modules for reusable, reviewed provisioning
- No proprietary runtime or paid plan required for the community product

### Repository boundary

IaC lives in a **separate package or repository** from the application code:

```
shopos/                    # Application code (this repository)
shopos-infra/              # Infrastructure-as-code (separate repository or monorepo package)
  environments/
    dev/                   # Development environment Terraform
    staging/               # Staging environment Terraform
    production/            # Production environment Terraform
  modules/                 # Reusable Terraform modules
    app-service/           # Container deployment (web + worker)
    postgresql/            # Managed PostgreSQL
    secrets/               # Secret management
    object-storage/        # S3-compatible bucket
    networking/            # VPC, load balancer, TLS
    observability/         # Logging, metrics, alerting
```

Application code in this repository never contains cloud credentials, Terraform configurations, or
deployment-identity secrets.

## Environments

Three isolated environments with least-privilege CI identities:

| Environment     | Purpose                                      | Database                                     | CI identity                      |
| --------------- | -------------------------------------------- | -------------------------------------------- | -------------------------------- |
| **Development** | Feature development, integration tests       | PostgreSQL 17 (container)                    | Read-only deploy token           |
| **Staging**     | Pre-production validation, migration testing | Managed PostgreSQL (daily restore from prod) | Deploy token (scoped)            |
| **Production**  | Live customer data                           | Managed PostgreSQL (HA, automated backups)   | Deploy token (scoped, MFA-gated) |

Each environment has:

- A dedicated PostgreSQL instance (not shared)
- Separate secret stores (infra bootstrap secrets never cross environments)
- Independent TLS certificates
- Isolated networking (no cross-environment traffic)

## Provisioning

### Application runtime

The production container (see `Dockerfile`) runs as non-root (uid 1001) on Node.js 24 LTS with
the Next.js standalone server. It is deployed as a containerized service behind a reverse proxy
that terminates TLS.

### Worker process

The outbox dispatcher worker (`pnpm worker`) runs as a separate process using the same container
image. It connects to the same PostgreSQL database. Multiple worker replicas are safe (the
`FOR UPDATE SKIP LOCKED` drain query prevents double-dispatch). The worker should auto-restart on
failure and emit health metrics.

### PostgreSQL

- **Production**: Managed PostgreSQL 17 with automated daily backups, point-in-time recovery, and
  high availability (read replica for failover).
- **Self-hosted**: PostgreSQL 17 container with a named volume for persistence and a documented
  backup strategy (`pg_dump` or `pg_basebackup` on a schedule).
- **Migrations**: Run as an explicit release step (`pnpm db:migrate`), never opportunistically from
  web replicas. Migration rollout is documented below.

### Secret management

Two categories of secrets, managed separately:

1. **Infrastructure bootstrap secrets** — managed by the IaC tooling and the platform secret store
   (e.g. AWS Secrets Manager, HashiCorp Vault, Doppler). These include: database connection strings,
   `BETTER_AUTH_SECRET`, object-storage credentials, TLS private keys. The application reads them
   via environment variables injected at deploy time.

2. **Platform-managed integration secrets** — managed inside the application database through the
   connector-instance and secret-reference model (ADR 0008). These include: organization-scoped
   email/SMS/payment provider credentials. They are never environment variables and never visible to
   infrastructure tooling.

### Object storage

Optional. Used for file attachments, customer documents, and theme logo assets. Provisioned as
S3-compatible storage. The application accesses it through the `FileStorageProvider` interface
(ADR 0008), so the specific provider is replaceable.

### Networking

- TLS terminates at the load balancer or reverse proxy.
- The application container listens on port 3000 (`0.0.0.0`).
- PostgreSQL is not exposed to the public internet.
- Health checks hit `/api/health` (HTTP 200).

### Observability

- **Logging**: structured JSON logs to stdout; collected by the platform log aggregator.
- **Metrics**: application exposes health status; platform collects CPU/memory/request metrics.
- **Alerting**: health-check failures, error-rate spikes, worker-lag alerts.
- **No customer data in logs**: secrets, tokens, passwords, and PII are never logged (AGENTS.md).

## Database lifecycle

### Backup

- **Automated daily backups** (managed PostgreSQL) with a retention policy (minimum 30 days).
- **Point-in-time recovery** to any second within the backup window.
- Self-hosted deployments document a `pg_dump`-based backup cron and recommend off-site copies.

### Restore testing

- Staging environment restores from the latest production backup daily, verifying restore integrity.
- Restore tests are part of the release checklist, not an ad-hoc activity.

### Migration rollout

1. **Review**: every generated migration is inspected before applying (AGENTS.md). Compound tenant
   FKs, check constraints, partial indexes, and immutable-history protections must be preserved.
2. **Apply**: migrations run as an explicit release step (`pnpm db:migrate` against the target
   environment), not from web replicas.
3. **Verify**: the health endpoint and smoke tests confirm the application is functional after
   migration.
4. **Rollback**: migrations are forward-only (no destructive down-migrations in production). If a
   migration is bad, the database is restored from backup and the previous application version is
   redeployed. A migration rollback strategy is documented per-release.

### Disaster recovery

- **RPO (Recovery Point Objective)**: ≤ 24 hours (daily backups) or ≤ 5 minutes (point-in-time
  recovery on managed PostgreSQL).
- **RTO (Recovery Time Objective)**: ≤ 4 hours for full environment restoration.
- **DR testing**: quarterly restore-from-backup exercises to a clean environment.

## Self-hosted deployment

ShopOS is fully functional without any ShopOS-operated service. A self-hosted deployment requires:

1. **PostgreSQL 17** — via `docker compose up` (see `compose.yaml`) or a managed/external instance.
2. **The ShopOS container** — built from the `Dockerfile`, run behind a TLS-terminating reverse
   proxy (nginx, Caddy, Traefik, or a cloud load balancer).
3. **The worker process** — the same container, run with `pnpm worker` (or `node server.js` for
   web + a separate worker sidecar).
4. **Environment variables** — `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, and
   optionally `AUTH_EMAIL_DELIVERY`, `OUTBOX_POLL_INTERVAL_MS`, `OUTBOX_BATCH_SIZE`.
5. **Migrations** — `pnpm db:migrate` as a release step.
6. **Backups** — a documented `pg_dump` schedule.

See `compose.production.yaml` for a reproducible single-host deployment example. No external service,
proprietary runtime, or ShopOS-operated API is required to read existing tenant data.

## Boundary enforcement

- Organization onboarding is a **product transaction** (`provisionOrganization`) — it creates
  database records and audit events. It never receives infrastructure deployment authority.
- Platform operators manage the control plane through the application UI and API. They do not have
  infrastructure access unless explicitly granted through the IaC identity system.
- The application never reads infrastructure credentials. The IaC system never reads application
  integration secrets.
