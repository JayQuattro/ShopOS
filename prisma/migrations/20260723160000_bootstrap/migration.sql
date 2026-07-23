create extension if not exists pgcrypto;

create type customer_kind as enum ('individual', 'business');
create type asset_status as enum ('active', 'inactive', 'sold', 'archived');
create type work_type as enum ('repair', 'maintenance', 'project');
create type work_order_status as enum (
  'draft',
  'estimating',
  'awaiting_authorization',
  'authorized',
  'in_progress',
  'blocked',
  'completed',
  'invoiced',
  'closed',
  'cancelled'
);
create type estimate_revision_status as enum ('draft', 'presented', 'superseded', 'expired');
create type priced_line_kind as enum ('labor', 'part', 'fee');
create type authorization_decision as enum ('approved', 'declined');
create type authorization_method as enum ('customer_link', 'phone', 'in_person', 'email', 'other');
create type invoice_status as enum ('draft', 'issued', 'partially_paid', 'paid', 'void');
create type payment_method as enum ('cash', 'card_external', 'check', 'bank_transfer', 'other');

create table users (
  id uuid primary key default gen_random_uuid(),
  email varchar(320) not null constraint users_email_unique unique,
  display_name varchar(160) not null,
  disabled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table organizations (
  id uuid primary key default gen_random_uuid(),
  slug varchar(80) not null unique,
  name varchar(180) not null,
  status varchar(24) not null default 'active',
  default_currency varchar(3) not null default 'USD',
  subscription_state varchar(32) not null default 'unmanaged',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organizations_currency_check check (default_currency ~ '^[A-Z]{3}$')
);

create table locations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  code varchar(32) not null,
  name varchar(180) not null,
  time_zone varchar(80) not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint locations_org_code_unique unique (organization_id, code),
  constraint locations_org_id_unique unique (organization_id, id)
);

create index locations_org_idx on locations (organization_id);

create table organization_memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  user_id uuid not null references users (id) on delete cascade,
  organization_wide_location_access boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint memberships_org_user_unique unique (organization_id, user_id),
  constraint memberships_org_id_unique unique (organization_id, id)
);

create index memberships_user_idx on organization_memberships (user_id);

create table roles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  key varchar(64) not null,
  name varchar(120) not null,
  permissions jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint roles_permissions_array_check check (jsonb_typeof(permissions) = 'array'),
  constraint roles_org_key_unique unique (organization_id, key),
  constraint roles_org_id_unique unique (organization_id, id)
);

create table membership_roles (
  organization_id uuid not null references organizations (id) on delete cascade,
  membership_id uuid not null,
  role_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (membership_id, role_id),
  constraint membership_roles_membership_tenant_fk
    foreign key (organization_id, membership_id)
    references organization_memberships (organization_id, id)
    on delete cascade,
  constraint membership_roles_role_tenant_fk
    foreign key (organization_id, role_id)
    references roles (organization_id, id)
    on delete cascade
);

create table location_access (
  organization_id uuid not null references organizations (id) on delete cascade,
  membership_id uuid not null,
  location_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (membership_id, location_id),
  constraint location_access_membership_tenant_fk
    foreign key (organization_id, membership_id)
    references organization_memberships (organization_id, id)
    on delete cascade,
  constraint location_access_location_tenant_fk
    foreign key (organization_id, location_id)
    references locations (organization_id, id)
    on delete cascade
);

create table customers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete restrict,
  kind customer_kind not null,
  display_name varchar(220) not null,
  organization_reference varchar(64),
  primary_email varchar(320),
  primary_phone varchar(40),
  internal_notes text,
  customer_facing_notes text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customers_org_id_unique unique (organization_id, id)
);

create index customers_org_name_idx on customers (organization_id, display_name);
create unique index customers_org_reference_unique
  on customers (organization_id, organization_reference)
  where organization_reference is not null;

create table assets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete restrict,
  customer_id uuid not null,
  home_location_id uuid,
  display_name varchar(220) not null,
  category varchar(80) not null,
  subtype varchar(80),
  manufacturer varchar(120),
  model varchar(120),
  model_year integer,
  serial_number varchar(160),
  status asset_status not null default 'active',
  usage_type varchar(48),
  usage_value_milli bigint,
  usage_unit varchar(24),
  description text,
  tags jsonb not null default '[]'::jsonb,
  custom_attributes jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint assets_customer_tenant_fk
    foreign key (organization_id, customer_id)
    references customers (organization_id, id)
    on delete restrict,
  constraint assets_home_location_tenant_fk
    foreign key (organization_id, home_location_id)
    references locations (organization_id, id)
    on delete restrict,
  constraint assets_org_id_unique unique (organization_id, id),
  constraint assets_model_year_check check (model_year is null or model_year between 1800 and 3000),
  constraint assets_usage_value_check check (usage_value_milli is null or usage_value_milli >= 0),
  constraint assets_tags_array_check check (jsonb_typeof(tags) = 'array'),
  constraint assets_custom_attributes_object_check check (jsonb_typeof(custom_attributes) = 'object')
);

create index assets_org_customer_idx on assets (organization_id, customer_id);
create index assets_org_name_idx on assets (organization_id, display_name);

create table automotive_asset_profiles (
  asset_id uuid primary key references assets (id) on delete cascade,
  vin varchar(32),
  license_plate varchar(32),
  plate_jurisdiction varchar(32),
  trim varchar(120),
  engine varchar(160),
  transmission varchar(120),
  drivetrain varchar(80)
);

create table equipment_asset_profiles (
  asset_id uuid primary key references assets (id) on delete cascade,
  engine_model varchar(160),
  fuel_type varchar(80),
  equipment_category varchar(120)
);

create table work_orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete restrict,
  location_id uuid not null,
  customer_id uuid not null,
  asset_id uuid not null,
  number varchar(40) not null,
  work_type work_type not null default 'repair',
  status work_order_status not null default 'draft',
  customer_concern text not null,
  promised_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint work_orders_location_tenant_fk
    foreign key (organization_id, location_id)
    references locations (organization_id, id)
    on delete restrict,
  constraint work_orders_customer_tenant_fk
    foreign key (organization_id, customer_id)
    references customers (organization_id, id)
    on delete restrict,
  constraint work_orders_asset_tenant_fk
    foreign key (organization_id, asset_id)
    references assets (organization_id, id)
    on delete restrict,
  constraint work_orders_org_number_unique unique (organization_id, number),
  constraint work_orders_org_location_id_unique unique (organization_id, location_id, id),
  constraint work_orders_org_id_unique unique (organization_id, id)
);

create index work_orders_org_location_status_idx
  on work_orders (organization_id, location_id, status);

create table estimate_revisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete restrict,
  location_id uuid not null,
  work_order_id uuid not null,
  revision_number integer not null,
  status estimate_revision_status not null default 'draft',
  currency varchar(3) not null,
  subtotal_minor bigint not null,
  discount_minor bigint not null,
  tax_minor bigint not null,
  total_minor bigint not null,
  presented_at timestamptz,
  expires_at timestamptz,
  supersedes_revision_id uuid,
  created_by_user_id uuid references users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint estimate_revisions_work_order_tenant_fk
    foreign key (organization_id, location_id, work_order_id)
    references work_orders (organization_id, location_id, id)
    on delete restrict,
  constraint estimate_revisions_supersedes_fk
    foreign key (supersedes_revision_id)
    references estimate_revisions (id)
    on delete restrict,
  constraint estimate_revision_number_unique unique (work_order_id, revision_number),
  constraint estimate_revisions_org_id_unique unique (organization_id, id),
  constraint estimate_revisions_revision_number_check check (revision_number > 0),
  constraint estimate_revisions_currency_check check (currency ~ '^[A-Z]{3}$'),
  constraint estimate_revisions_amounts_check check (
    subtotal_minor >= 0
    and discount_minor >= 0
    and discount_minor <= subtotal_minor
    and tax_minor >= 0
    and total_minor = subtotal_minor - discount_minor + tax_minor
  ),
  constraint estimate_revisions_presentation_check check (
    (status = 'draft' and presented_at is null)
    or (status <> 'draft' and presented_at is not null)
  )
);

create index estimate_revisions_org_work_order_idx
  on estimate_revisions (organization_id, work_order_id);

create table estimate_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete restrict,
  estimate_revision_id uuid not null,
  service_group_key varchar(80) not null,
  kind priced_line_kind not null,
  description text not null,
  quantity_milli integer not null,
  unit_price_minor bigint not null,
  gross_minor bigint not null,
  discount_minor bigint not null,
  taxable boolean not null,
  tax_rate_basis_points integer not null,
  tax_minor bigint not null,
  total_minor bigint not null,
  authorization_required boolean not null default true,
  position integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint estimate_lines_revision_tenant_fk
    foreign key (organization_id, estimate_revision_id)
    references estimate_revisions (organization_id, id)
    on delete restrict,
  constraint estimate_lines_revision_position_unique unique (estimate_revision_id, position),
  constraint estimate_lines_org_id_unique unique (organization_id, id),
  constraint estimate_lines_values_check check (
    quantity_milli >= 0
    and unit_price_minor >= 0
    and gross_minor >= 0
    and discount_minor >= 0
    and discount_minor <= gross_minor
    and tax_rate_basis_points >= 0
    and tax_minor >= 0
    and total_minor = gross_minor - discount_minor + tax_minor
    and position > 0
  )
);

create index estimate_lines_org_revision_idx
  on estimate_lines (organization_id, estimate_revision_id);

create table authorizations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete restrict,
  estimate_revision_id uuid not null,
  method authorization_method not null,
  recorded_by_user_id uuid references users (id) on delete restrict,
  provided_by_name varchar(180) not null,
  note text,
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint authorizations_revision_tenant_fk
    foreign key (organization_id, estimate_revision_id)
    references estimate_revisions (organization_id, id)
    on delete restrict,
  constraint authorizations_org_id_unique unique (organization_id, id)
);

create index authorizations_org_revision_idx
  on authorizations (organization_id, estimate_revision_id);

create table authorization_decisions (
  organization_id uuid not null references organizations (id) on delete restrict,
  authorization_id uuid not null,
  estimate_line_id uuid not null,
  decision authorization_decision not null,
  created_at timestamptz not null default now(),
  primary key (authorization_id, estimate_line_id),
  constraint authorization_decisions_authorization_tenant_fk
    foreign key (organization_id, authorization_id)
    references authorizations (organization_id, id)
    on delete restrict,
  constraint authorization_decisions_line_tenant_fk
    foreign key (organization_id, estimate_line_id)
    references estimate_lines (organization_id, id)
    on delete restrict
);

create table invoices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete restrict,
  location_id uuid not null,
  work_order_id uuid not null,
  number varchar(40) not null,
  status invoice_status not null default 'draft',
  currency varchar(3) not null,
  subtotal_minor bigint not null,
  discount_minor bigint not null,
  tax_minor bigint not null,
  total_minor bigint not null,
  paid_minor bigint not null default 0,
  issued_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint invoices_work_order_tenant_fk
    foreign key (organization_id, location_id, work_order_id)
    references work_orders (organization_id, location_id, id)
    on delete restrict,
  constraint invoices_org_number_unique unique (organization_id, number),
  constraint invoices_org_location_work_order_unique
    unique (organization_id, location_id, work_order_id),
  constraint invoices_org_id_unique unique (organization_id, id),
  constraint invoices_currency_check check (currency ~ '^[A-Z]{3}$'),
  constraint invoices_amounts_check check (
    subtotal_minor >= 0
    and discount_minor >= 0
    and discount_minor <= subtotal_minor
    and tax_minor >= 0
    and total_minor = subtotal_minor - discount_minor + tax_minor
    and paid_minor >= 0
    and paid_minor <= total_minor
  ),
  constraint invoices_issue_check check (
    (status = 'draft' and issued_at is null)
    or (status <> 'draft' and issued_at is not null)
  )
);

create index invoices_org_location_status_idx
  on invoices (organization_id, location_id, status);

create table invoice_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete restrict,
  invoice_id uuid not null,
  source_estimate_line_id uuid,
  kind priced_line_kind not null,
  description text not null,
  quantity_milli integer not null,
  unit_price_minor bigint not null,
  gross_minor bigint not null,
  discount_minor bigint not null,
  taxable boolean not null,
  tax_rate_basis_points integer not null,
  tax_minor bigint not null,
  total_minor bigint not null,
  position integer not null,
  created_at timestamptz not null default now(),
  constraint invoice_lines_invoice_tenant_fk
    foreign key (organization_id, invoice_id)
    references invoices (organization_id, id)
    on delete restrict,
  constraint invoice_lines_estimate_line_tenant_fk
    foreign key (organization_id, source_estimate_line_id)
    references estimate_lines (organization_id, id)
    on delete restrict,
  constraint invoice_lines_invoice_position_unique unique (invoice_id, position),
  constraint invoice_lines_values_check check (
    quantity_milli >= 0
    and unit_price_minor >= 0
    and gross_minor >= 0
    and discount_minor >= 0
    and discount_minor <= gross_minor
    and tax_rate_basis_points >= 0
    and tax_minor >= 0
    and total_minor = gross_minor - discount_minor + tax_minor
    and position > 0
  )
);

create index invoice_lines_org_invoice_idx on invoice_lines (organization_id, invoice_id);

create table payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete restrict,
  location_id uuid not null,
  invoice_id uuid not null,
  amount_minor bigint not null,
  currency varchar(3) not null,
  method payment_method not null,
  reference varchar(160),
  received_at timestamptz not null,
  recorded_by_user_id uuid not null references users (id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint payments_invoice_tenant_fk
    foreign key (organization_id, invoice_id)
    references invoices (organization_id, id)
    on delete restrict,
  constraint payments_location_tenant_fk
    foreign key (organization_id, location_id)
    references locations (organization_id, id)
    on delete restrict,
  constraint payments_amount_check check (amount_minor > 0),
  constraint payments_currency_check check (currency ~ '^[A-Z]{3}$')
);

create index payments_org_invoice_idx on payments (organization_id, invoice_id);

create table activity_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete restrict,
  location_id uuid not null,
  work_order_id uuid not null,
  actor_user_id uuid references users (id) on delete restrict,
  event_type varchar(100) not null,
  summary text not null,
  data jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  constraint activity_work_order_tenant_fk
    foreign key (organization_id, location_id, work_order_id)
    references work_orders (organization_id, location_id, id)
    on delete restrict,
  constraint activity_data_object_check check (jsonb_typeof(data) = 'object')
);

create index activity_org_work_order_time_idx
  on activity_events (organization_id, work_order_id, occurred_at);

create table audit_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete restrict,
  location_id uuid,
  actor_user_id uuid references users (id) on delete restrict,
  action varchar(100) not null,
  entity_type varchar(80) not null,
  entity_id uuid not null,
  request_id varchar(120),
  before jsonb,
  after jsonb,
  occurred_at timestamptz not null default now(),
  constraint audit_location_tenant_fk
    foreign key (organization_id, location_id)
    references locations (organization_id, id)
    on delete restrict,
  constraint audit_before_object_check check (before is null or jsonb_typeof(before) = 'object'),
  constraint audit_after_object_check check (after is null or jsonb_typeof(after) = 'object')
);

create index audit_org_entity_time_idx
  on audit_events (organization_id, entity_type, entity_id, occurred_at);
