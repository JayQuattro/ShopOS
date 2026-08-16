-- Connector instances: DB-backed integration adapter configuration (ADR 0008).
CREATE TABLE "connector_instances" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID,
    "scope" VARCHAR(32) NOT NULL,
    "capability" VARCHAR(64) NOT NULL,
    "adapter_key" VARCHAR(64) NOT NULL,
    "display_name" VARCHAR(180) NOT NULL,
    "configuration" JSONB NOT NULL DEFAULT '{}',
    "encrypted_secret" TEXT,
    "status" VARCHAR(32) NOT NULL DEFAULT 'active',
    "last_health_check_at" TIMESTAMPTZ(6),
    "last_health_status" VARCHAR(64),
    "last_health_detail" VARCHAR(500),
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "connector_instances_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "connector_scope_capability_status_idx"
  ON "connector_instances" ("scope", "capability", "status");

CREATE INDEX "connector_org_capability_idx"
  ON "connector_instances" ("organization_id", "capability");

ALTER TABLE "connector_instances"
  ADD CONSTRAINT "connector_instances_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "connector_instances"
  ADD CONSTRAINT "connector_instances_created_by_user_id_fkey"
  FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
