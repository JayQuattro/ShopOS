-- Customer repair tracker links: a revocable, rotating signed URL per work
-- order that opens the public live-status page (/track/{token}). One link row
-- per work order; regenerating rotates the token (the old URL dies instantly).

CREATE TABLE "repair_tracker_links" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "work_order_id" UUID NOT NULL,
  "token" VARCHAR(128) NOT NULL,
  "revoked_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "repair_tracker_links_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "repair_tracker_links_token_key" ON "repair_tracker_links"("token");
CREATE UNIQUE INDEX "repair_tracker_links_org_wo_unique"
  ON "repair_tracker_links"("organization_id", "work_order_id");
CREATE INDEX "repair_tracker_links_token_idx"
  ON "repair_tracker_links"("token", "revoked_at");

ALTER TABLE "repair_tracker_links"
  ADD CONSTRAINT "repair_tracker_links_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "repair_tracker_links"
  ADD CONSTRAINT "repair_tracker_links_org_work_order_fk"
  FOREIGN KEY ("organization_id", "work_order_id") REFERENCES "work_orders"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
