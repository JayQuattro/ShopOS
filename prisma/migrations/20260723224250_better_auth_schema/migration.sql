-- Extend the existing ShopOS identity and tenant graph with Better Auth-owned fields.
ALTER TABLE "users"
  ADD COLUMN "email_verified" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "image" VARCHAR(2048),
  ADD COLUMN "two_factor_enabled" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "organizations"
  ADD COLUMN "auth_metadata" TEXT,
  ADD COLUMN "logo_url" VARCHAR(2048);

ALTER TABLE "organization_memberships"
  ADD COLUMN "auth_role" VARCHAR(255) NOT NULL DEFAULT 'member';

-- Better Auth core schema.
CREATE TABLE "auth_sessions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "active_organization_id" UUID,
  "token" VARCHAR(255) NOT NULL,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "ip_address" VARCHAR(64),
  "user_agent" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "auth_accounts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "account_id" VARCHAR(255) NOT NULL,
  "provider_id" VARCHAR(255) NOT NULL,
  "access_token" TEXT,
  "refresh_token" TEXT,
  "id_token" TEXT,
  "access_token_expires_at" TIMESTAMPTZ(6),
  "refresh_token_expires_at" TIMESTAMPTZ(6),
  "scope" TEXT,
  "password" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "auth_accounts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "auth_verifications" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "identifier" VARCHAR(255) NOT NULL,
  "value" TEXT NOT NULL,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "auth_verifications_pkey" PRIMARY KEY ("id")
);

-- Better Auth organization invitations share the existing ShopOS organization and membership graph.
CREATE TABLE "organization_invitations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "inviter_id" UUID NOT NULL,
  "email" VARCHAR(320) NOT NULL,
  "role" VARCHAR(255),
  "status" VARCHAR(32) NOT NULL DEFAULT 'pending',
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "organization_invitations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "organization_invitations_status_check"
    CHECK ("status" IN ('pending', 'accepted', 'rejected', 'canceled'))
);

-- Better Auth two-factor and passkey plugins.
CREATE TABLE "auth_two_factors" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "secret" TEXT NOT NULL,
  "backup_codes" TEXT NOT NULL,
  "verified" BOOLEAN NOT NULL DEFAULT true,
  "failed_verification_count" INTEGER NOT NULL DEFAULT 0,
  "locked_until" TIMESTAMPTZ(6),
  CONSTRAINT "auth_two_factors_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "auth_two_factors_failure_count_check" CHECK ("failed_verification_count" >= 0)
);

CREATE TABLE "auth_passkeys" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "name" VARCHAR(160),
  "public_key" TEXT NOT NULL,
  "credential_id" TEXT NOT NULL,
  "counter" INTEGER NOT NULL,
  "device_type" VARCHAR(32) NOT NULL,
  "backed_up" BOOLEAN NOT NULL,
  "transports" TEXT,
  "aaguid" VARCHAR(64),
  "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "auth_passkeys_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "auth_passkeys_counter_check" CHECK ("counter" >= 0)
);

-- SSO providers are always bound to one ShopOS organization. Automatic SSO membership
-- provisioning remains disabled in application configuration.
CREATE TABLE "organization_sso_providers" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "provider_id" VARCHAR(191) NOT NULL,
  "issuer" VARCHAR(2048) NOT NULL,
  "domain" VARCHAR(2048) NOT NULL,
  "domain_verified" BOOLEAN NOT NULL DEFAULT false,
  "oidc_config" TEXT,
  "saml_config" TEXT,
  CONSTRAINT "organization_sso_providers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "auth_sessions_token_unique" ON "auth_sessions" ("token");
CREATE INDEX "auth_sessions_user_idx" ON "auth_sessions" ("user_id");
CREATE INDEX "auth_sessions_active_org_idx" ON "auth_sessions" ("active_organization_id");

CREATE UNIQUE INDEX "auth_accounts_provider_account_unique"
  ON "auth_accounts" ("provider_id", "account_id");
CREATE INDEX "auth_accounts_user_idx" ON "auth_accounts" ("user_id");

CREATE INDEX "auth_verifications_identifier_idx" ON "auth_verifications" ("identifier");
CREATE INDEX "auth_verifications_expires_idx" ON "auth_verifications" ("expires_at");

CREATE INDEX "org_invitations_org_status_idx"
  ON "organization_invitations" ("organization_id", "status");
CREATE INDEX "org_invitations_email_idx" ON "organization_invitations" ("email");
CREATE INDEX "org_invitations_expires_idx" ON "organization_invitations" ("expires_at");

CREATE INDEX "two_factors_secret_idx" ON "auth_two_factors" ("secret");
CREATE INDEX "two_factors_user_idx" ON "auth_two_factors" ("user_id");

CREATE UNIQUE INDEX "passkeys_credential_id_unique" ON "auth_passkeys" ("credential_id");
CREATE INDEX "passkeys_user_idx" ON "auth_passkeys" ("user_id");

CREATE UNIQUE INDEX "sso_providers_provider_id_unique"
  ON "organization_sso_providers" ("provider_id");
CREATE INDEX "sso_providers_org_idx" ON "organization_sso_providers" ("organization_id");
CREATE INDEX "sso_providers_user_idx" ON "organization_sso_providers" ("user_id");
CREATE INDEX "sso_providers_domain_idx" ON "organization_sso_providers" ("domain");

ALTER TABLE "auth_sessions"
  ADD CONSTRAINT "auth_sessions_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "auth_sessions_active_organization_id_fkey"
  FOREIGN KEY ("active_organization_id") REFERENCES "organizations" ("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "auth_accounts"
  ADD CONSTRAINT "auth_accounts_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "organization_invitations"
  ADD CONSTRAINT "organization_invitations_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "organization_invitations_inviter_id_fkey"
  FOREIGN KEY ("inviter_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "auth_two_factors"
  ADD CONSTRAINT "auth_two_factors_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "auth_passkeys"
  ADD CONSTRAINT "auth_passkeys_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "organization_sso_providers"
  ADD CONSTRAINT "organization_sso_providers_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "organization_sso_providers_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
