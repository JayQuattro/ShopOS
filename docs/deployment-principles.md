# Deployment principles

ShopOS must run as a conventional containerized Node.js application with PostgreSQL. A proprietary
platform runtime, serverless execution model, or paid external service must not be mandatory.

For the full deployment architecture — including IaC tool selection, environment definitions,
provisioning details, database lifecycle, and secret management — see
[Deployment architecture](deployment-architecture.md).

## Configuration

- Environment variables provide deploy-time configuration.
- Secrets are never committed.
- Startup validates required configuration and reports actionable errors.
- Development can use local PostgreSQL, filesystem storage, and log-based email delivery.
- Production can replace those providers with managed equivalents.

## Processes

The target deployment contains a web process, a background worker using the same codebase, PostgreSQL,
and optional object storage. Migrations run as an explicit release step, not opportunistically from every
web replica.

## Operations

Production guidance must eventually cover TLS, reverse proxying, backups and restore tests, encryption,
secret rotation, log retention, health probes, rolling deployment, migration rollback strategy, and
tenant-aware disaster recovery. Kubernetes and advanced automated deployment are intentionally outside
the bootstrap.

## Portability

The community product remains functional without platform billing, commercial vehicle data, parts
catalogs, labor guides, SMS, payment processing, or cloud storage. Managed hosting may make these easier
without creating a separate core edition.
