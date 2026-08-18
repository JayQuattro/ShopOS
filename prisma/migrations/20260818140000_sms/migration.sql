-- Two-way customer texting (ADR 0008 connector family): conversations are
-- threads between the shop's landline/number and a customer phone, linked to
-- the customer record; messages carry direction and delivery state. A work
-- order context column lets texts attach to the job being discussed.

CREATE TABLE "sms_conversations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "customer_id" UUID NOT NULL,
  "customer_phone" VARCHAR(40) NOT NULL,
  "last_message_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "sms_conversations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "sms_conversations_org_id_unique" ON "sms_conversations"("organization_id", "id");
CREATE UNIQUE INDEX "sms_conversations_org_customer_phone_unique"
  ON "sms_conversations"("organization_id", "customer_id", "customer_phone");
CREATE INDEX "sms_conversations_org_last_message_idx"
  ON "sms_conversations"("organization_id", "last_message_at" DESC);

ALTER TABLE "sms_conversations"
  ADD CONSTRAINT "sms_conversations_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "sms_conversations"
  ADD CONSTRAINT "sms_conversations_org_customer_fk"
  FOREIGN KEY ("organization_id", "customer_id") REFERENCES "customers"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "sms_messages" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "conversation_id" UUID NOT NULL,
  "direction" VARCHAR(16) NOT NULL,
  "body" TEXT NOT NULL,
  "status" VARCHAR(32) NOT NULL DEFAULT 'sent',
  "provider_message_id" VARCHAR(180),
  "work_order_id" UUID,
  "sent_by_user_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "sms_messages_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sms_messages_direction_check" CHECK ("direction" IN ('outbound', 'inbound')),
  CONSTRAINT "sms_messages_body_length_check" CHECK (char_length("body") <= 1600)
);

CREATE INDEX "sms_messages_org_conversation_idx"
  ON "sms_messages"("organization_id", "conversation_id", "created_at");

ALTER TABLE "sms_messages"
  ADD CONSTRAINT "sms_messages_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "sms_messages"
  ADD CONSTRAINT "sms_messages_org_conversation_fk"
  FOREIGN KEY ("organization_id", "conversation_id") REFERENCES "sms_conversations"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "sms_messages"
  ADD CONSTRAINT "sms_messages_work_order_id_fkey"
  FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE SET NULL;
