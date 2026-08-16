-- Work order attachments: file metadata linked to the storage connector.
CREATE TABLE "work_order_attachments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "work_order_id" UUID NOT NULL,
    "object_key" VARCHAR(512) NOT NULL,
    "file_name" VARCHAR(255) NOT NULL,
    "content_type" VARCHAR(127) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "uploaded_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_order_attachments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "work_order_attachments_org_id_unique"
  ON "work_order_attachments" ("organization_id", "id");

CREATE INDEX "work_order_attachments_org_wo_idx"
  ON "work_order_attachments" ("organization_id", "work_order_id");

ALTER TABLE "work_order_attachments"
  ADD CONSTRAINT "work_order_attachments_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "work_order_attachments"
  ADD CONSTRAINT "work_order_attachments_organization_id_work_order_id_fkey"
  FOREIGN KEY ("organization_id", "work_order_id") REFERENCES "work_orders"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "work_order_attachments"
  ADD CONSTRAINT "work_order_attachments_uploaded_by_user_id_fkey"
  FOREIGN KEY ("uploaded_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
