-- Platform control-plane records are deliberately global and do not carry
-- organization_id as an authorization boundary. Tenant-owned entitlements and
-- outbox events remain organization-scoped.

CREATE TYPE "organization_status" AS ENUM (
  'provisioning',
  'active',
  'suspended',
  'closed'
);

CREATE TYPE "subscription_state" AS ENUM (
  'unmanaged',
  'trialing',
  'active',
  'past_due',
  'canceled'
);

CREATE TYPE "platform_operator_role" AS ENUM (
  'viewer',
  'operator',
  'admin'
);

CREATE TYPE "provisioning_actor_kind" AS ENUM (
  'self_service',
  'platform_operator',
  'system'
);

-- Preserve existing lifecycle values while replacing unconstrained strings.
ALTER TABLE "organizations"
  ALTER COLUMN "status" DROP DEFAULT,
  ALTER COLUMN "status" TYPE "organization_status"
    USING ("status"::text::"organization_status"),
  ALTER COLUMN "status" SET DEFAULT 'active',
  ALTER COLUMN "subscription_state" DROP DEFAULT,
  ALTER COLUMN "subscription_state" TYPE "subscription_state"
    USING ("subscription_state"::text::"subscription_state"),
  ALTER COLUMN "subscription_state" SET DEFAULT 'unmanaged';

CREATE TABLE "platform_operator_grants" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "role" "platform_operator_role" NOT NULL,
  "reason" VARCHAR(500) NOT NULL,
  "granted_by_user_id" UUID,
  "expires_at" TIMESTAMPTZ(6),
  "revoked_at" TIMESTAMPTZ(6),
  "revoked_by_user_id" UUID,
  "revocation_reason" VARCHAR(500),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "platform_operator_grants_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "platform_operator_grants_expiry_check"
    CHECK ("expires_at" IS NULL OR "expires_at" > "created_at"),
  CONSTRAINT "platform_operator_grants_revocation_check"
    CHECK (
      ("revoked_at" IS NULL AND "revoked_by_user_id" IS NULL AND "revocation_reason" IS NULL)
      OR
      ("revoked_at" IS NOT NULL AND "revocation_reason" IS NOT NULL)
    ),
  CONSTRAINT "platform_operator_grants_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "platform_operator_grants_granted_by_user_id_fkey"
    FOREIGN KEY ("granted_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "platform_operator_grants_revoked_by_user_id_fkey"
    FOREIGN KEY ("revoked_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "platform_operator_grants_one_current_per_user"
  ON "platform_operator_grants" ("user_id")
  WHERE "revoked_at" IS NULL;

CREATE INDEX "platform_operator_grants_active_idx"
  ON "platform_operator_grants" ("user_id", "revoked_at", "expires_at");

CREATE TABLE "platform_audit_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "actor_user_id" UUID,
  "target_organization_id" UUID,
  "action" VARCHAR(120) NOT NULL,
  "target_type" VARCHAR(80) NOT NULL,
  "target_id" VARCHAR(160) NOT NULL,
  "request_id" VARCHAR(120),
  "reason" VARCHAR(500),
  "metadata" JSONB,
  "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "platform_audit_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "platform_audit_events_actor_user_id_fkey"
    FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "platform_audit_events_target_organization_id_fkey"
    FOREIGN KEY ("target_organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "platform_audit_org_time_idx"
  ON "platform_audit_events" ("target_organization_id", "occurred_at");

CREATE INDEX "platform_audit_actor_time_idx"
  ON "platform_audit_events" ("actor_user_id", "occurred_at");

CREATE TABLE "organization_provisioning_requests" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "actor_user_id" UUID NOT NULL,
  "actor_kind" "provisioning_actor_kind" NOT NULL,
  "idempotency_key" VARCHAR(160) NOT NULL,
  "input_hash" CHAR(64) NOT NULL,
  "organization_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "organization_provisioning_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "organization_provisioning_requests_hash_check"
    CHECK ("input_hash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "organization_provisioning_requests_actor_user_id_fkey"
    FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "organization_provisioning_requests_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "provisioning_requests_org_unique"
  ON "organization_provisioning_requests" ("organization_id");

CREATE UNIQUE INDEX "provisioning_requests_actor_key_unique"
  ON "organization_provisioning_requests" ("actor_user_id", "idempotency_key");

CREATE TABLE "organization_entitlements" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "key" VARCHAR(120) NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "limit_value" BIGINT,
  "configuration" JSONB,
  "source" VARCHAR(80) NOT NULL DEFAULT 'platform',
  "effective_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMPTZ(6),
  "updated_by_user_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "organization_entitlements_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "organization_entitlements_limit_check"
    CHECK ("limit_value" IS NULL OR "limit_value" >= 0),
  CONSTRAINT "organization_entitlements_expiry_check"
    CHECK ("expires_at" IS NULL OR "expires_at" > "effective_at"),
  CONSTRAINT "organization_entitlements_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "organization_entitlements_updated_by_user_id_fkey"
    FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "organization_entitlements_org_key_unique"
  ON "organization_entitlements" ("organization_id", "key");

CREATE INDEX "organization_entitlements_org_enabled_idx"
  ON "organization_entitlements" ("organization_id", "enabled");

CREATE TABLE "outbox_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "event_type" VARCHAR(120) NOT NULL,
  "aggregate_type" VARCHAR(80) NOT NULL,
  "aggregate_id" UUID NOT NULL,
  "payload" JSONB NOT NULL,
  "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "available_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "published_at" TIMESTAMPTZ(6),
  "attempts" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "outbox_events_attempts_check" CHECK ("attempts" >= 0),
  CONSTRAINT "outbox_events_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "outbox_unpublished_available_idx"
  ON "outbox_events" ("available_at")
  WHERE "published_at" IS NULL;

CREATE INDEX "outbox_org_time_idx"
  ON "outbox_events" ("organization_id", "occurred_at");
