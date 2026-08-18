-- Organization settings foundation (settings overhaul): shop contact/profile
-- fields, configurable authorization-link TTL, document number prefixes,
-- communication cadence, and per-family notification toggles. All additive
-- with safe defaults matching today's hardcoded behavior.

ALTER TABLE "organizations"
  ADD COLUMN "contact_phone" VARCHAR(40),
  ADD COLUMN "contact_email" VARCHAR(320),
  ADD COLUMN "website" VARCHAR(2048),
  ADD COLUMN "address_line1" VARCHAR(220),
  ADD COLUMN "address_line2" VARCHAR(220),
  ADD COLUMN "city" VARCHAR(120),
  ADD COLUMN "state_province" VARCHAR(120),
  ADD COLUMN "postal_code" VARCHAR(20),
  ADD COLUMN "country" VARCHAR(2),
  ADD COLUMN "authorization_link_ttl_hours" INTEGER NOT NULL DEFAULT 72,
  ADD COLUMN "work_order_number_prefix" VARCHAR(12) NOT NULL DEFAULT 'RO-',
  ADD COLUMN "invoice_number_prefix" VARCHAR(12) NOT NULL DEFAULT 'INV-',
  ADD COLUMN "appointment_reminder_lead_hours" INTEGER NOT NULL DEFAULT 24,
  ADD COLUMN "no_show_cutoff_hours" INTEGER NOT NULL DEFAULT 2,
  ADD COLUMN "pm_reminder_cooldown_days" INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN "notify_estimate_email" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "notify_decision_receipt_email" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "notify_invoice_email" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "notify_payment_receipt_email" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "notify_appointment_reminders" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "notify_pm_reminders" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "notify_review_requests" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "organizations"
  ADD CONSTRAINT "org_link_ttl_check" CHECK ("authorization_link_ttl_hours" BETWEEN 1 AND 720),
  ADD CONSTRAINT "org_reminder_lead_check" CHECK ("appointment_reminder_lead_hours" BETWEEN 1 AND 168),
  ADD CONSTRAINT "org_no_show_cutoff_check" CHECK ("no_show_cutoff_hours" BETWEEN 1 AND 48),
  ADD CONSTRAINT "org_pm_cooldown_check" CHECK ("pm_reminder_cooldown_days" BETWEEN 1 AND 365);
