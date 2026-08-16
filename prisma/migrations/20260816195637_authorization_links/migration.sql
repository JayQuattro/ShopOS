-- Authorization links: expiring, revocable tokens for customer approval.
CREATE TABLE "authorization_links" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "estimate_revision_id" UUID NOT NULL,
    "token" VARCHAR(128) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "used_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "authorization_links_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "authorization_links_token_key" ON "authorization_links"("token");
CREATE INDEX "auth_links_org_revision_idx" ON "authorization_links"("organization_id", "estimate_revision_id");
CREATE INDEX "auth_links_token_expiry_idx" ON "authorization_links"("token", "expires_at");

ALTER TABLE "authorization_links"
  ADD CONSTRAINT "authorization_links_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "authorization_links"
  ADD CONSTRAINT "authorization_links_organization_id_estimate_revision_id_fkey"
  FOREIGN KEY ("organization_id", "estimate_revision_id") REFERENCES "estimate_revisions"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
