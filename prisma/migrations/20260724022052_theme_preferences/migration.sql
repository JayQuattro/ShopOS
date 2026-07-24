-- Add per-membership appearance preference columns.
ALTER TABLE "organization_memberships"
  ADD COLUMN "theme_preference" VARCHAR(12) NOT NULL DEFAULT 'system',
  ADD COLUMN "density_preference" VARCHAR(12) NOT NULL DEFAULT 'comfortable';

-- Versioned, immutable organization theme publications.
CREATE TABLE "organization_theme_publications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "preset" VARCHAR(24) NOT NULL,
    "accent_hue" INTEGER,
    "radius_scale" VARCHAR(12) NOT NULL DEFAULT 'standard',
    "density_default" VARCHAR(12) NOT NULL DEFAULT 'comfortable',
    "logo_url" VARCHAR(2048),
    "published_by_user_id" UUID NOT NULL,
    "published_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organization_theme_publications_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "theme_publications_org_version_idx"
  ON "organization_theme_publications" ("organization_id", "version");

CREATE UNIQUE INDEX "theme_publications_org_version_unique"
  ON "organization_theme_publications" ("organization_id", "version");

ALTER TABLE "organization_theme_publications"
  ADD CONSTRAINT "organization_theme_publications_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "organization_theme_publications"
  ADD CONSTRAINT "organization_theme_publications_published_by_user_id_fkey"
  FOREIGN KEY ("published_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
