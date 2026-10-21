-- PharmaOS schema v1
-- Units: every quantity is an integer number of PACKS (the primary unit per SKU).
-- Money: numeric. Unit prices numeric(12,4); totals numeric(14,2).
-- Provenance: every row carries data_source, using the labels from the
-- data acquisition plan. Hackathon rows are 'synthetic_demo': generated with a
-- fixed seed, using patterns learned from the reference datasets listed in
-- data_sources (never copied from them). The other values are reserved for
-- later phases (e.g. an anonymised stockist export = 'verified_customer_data').

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Master data
-- ---------------------------------------------------------------------------

create table products (
  id               uuid primary key default gen_random_uuid(),
  sku              text not null unique,
  brand_name       text not null,
  generic_name     text not null,
  strength         text not null,
  dosage_form      text not null,
  pack_size        integer not null check (pack_size > 0),          -- units (tablets, ml...) per pack
  manufacturer     text not null,
  category         text not null,
  storage_class    text not null default 'ambient'
                   check (storage_class in ('ambient', 'cool', 'cold_chain')),
  criticality      text not null default 'acute'
                   check (criticality in ('life_saving', 'chronic', 'acute', 'otc')),
  ptr              numeric(12,4) check (ptr is null or ptr >= 0),     -- selling price to retailer, per pack
  unit_margin      numeric(12,4) not null default 0 check (unit_margin >= 0), -- margin per pack
  shelf_life_days  integer not null default 730 check (shelf_life_days > 0),
  gst_rate         numeric(5,2) not null default 12 check (gst_rate >= 0),
  is_active        boolean not null default true,
  data_source      text not null default 'synthetic_demo' check (data_source in ('synthetic_demo', 'public_reference', 'unverified_sample', 'verified_customer_data')),
  created_at       timestamptz not null default now()
);

create table suppliers (
  id                      uuid primary key default gen_random_uuid(),
  name                    text not null,
  supplier_code           text not null unique,
  approved_status         text not null default 'approved'
                          check (approved_status in ('approved', 'pending', 'blocked')),
  default_lead_time_days  integer not null check (default_lead_time_days >= 0),
  reliability_score       numeric(5,2) check (reliability_score between 0 and 100), -- null = unknown (scores 0)
  payment_terms_days      integer check (payment_terms_days >= 0),                  -- null = unknown (scores 0)
  data_source             text not null default 'synthetic_demo' check (data_source in ('synthetic_demo', 'public_reference', 'unverified_sample', 'verified_customer_data')),
  created_at              timestamptz not null default now()
);

create table supplier_offers (
  id                uuid primary key default gen_random_uuid(),
  supplier_id       uuid not null references suppliers(id),
  product_id        uuid not null references products(id),
  unit_price        numeric(12,4) not null check (unit_price > 0),   -- per pack, before GST
  moq               integer not null default 1 check (moq > 0),     -- packs
  pack_multiple     integer not null default 1 check (pack_multiple > 0), -- order in multiples of N packs
  available_qty     integer not null check (available_qty >= 0),    -- packs
  lead_time_days    integer not null check (lead_time_days >= 0),
  freight_per_pack  numeric(12,4) not null default 0 check (freight_per_pack >= 0),
  tax_rate          numeric(5,2) not null default 12 check (tax_rate >= 0),
  scheme_paid_qty   integer check (scheme_paid_qty > 0),            -- "10+1": paid = 10
  scheme_free_qty   integer check (scheme_free_qty > 0),            -- "10+1": free = 1
  quoted_at         timestamptz not null,
  valid_until       timestamptz not null,
  source_type       text not null default 'synthetic'
                    check (source_type in ('synthetic', 'price_list', 'manual')),
  price_type        text not null default 'supplier_quote'
                    check (price_type in ('supplier_quote', 'purchase_invoice_price')), -- never MRP / ceiling price
  is_active         boolean not null default true,
  data_source       text not null default 'synthetic_demo' check (data_source in ('synthetic_demo', 'public_reference', 'unverified_sample', 'verified_customer_data')),
  created_at        timestamptz not null default now(),
  check ((scheme_paid_qty is null) = (scheme_free_qty is null)),
  check (valid_until >= quoted_at)
);
create index supplier_offers_product_idx on supplier_offers(product_id);

create table sales_history (
  id           bigserial primary key,
  product_id   uuid not null references products(id),
  sale_date    date not null,
  units_sold   integer not null check (units_sold >= 0),            -- packs
  data_source  text not null default 'synthetic_demo' check (data_source in ('synthetic_demo', 'public_reference', 'unverified_sample', 'verified_customer_data')),
  unique (product_id, sale_date)
);

create table inventory_locations (
  id              uuid primary key default gen_random_uuid(),
  warehouse_id    text not null default 'WH-01',
  zone            text not null,
  aisle           text not null,
  rack            text not null,
  shelf           integer not null check (shelf >= 1),
  bin_code        text not null unique,
  x               numeric(8,2) not null,
  y               numeric(8,2) not null,
  z               numeric(8,2) not null,
  width           numeric(6,2) not null default 1,
  depth           numeric(6,2) not null default 1,
  height          numeric(6,2) not null default 0.6,
  capacity_units  integer not null check (capacity_units > 0),      -- demo capacity proxy, in packs
  storage_class   text not null default 'ambient'
                  check (storage_class in ('ambient', 'cool', 'cold_chain')),
  status          text not null default 'active' check (status in ('active', 'inactive', 'blocked'))
);

create table batches (
  id                    uuid primary key default gen_random_uuid(),
  product_id            uuid not null references products(id),
  batch_number          text not null,
  expiry_date           date not null,
  received_date         date not null,
  supplier_id           uuid references suppliers(id),
  unit_cost             numeric(12,4) not null check (unit_cost >= 0), -- purchase cost per pack
  quality_status        text not null default 'released'
                        check (quality_status in ('released', 'quarantine', 'rejected', 'recalled')),
  return_policy_status  text not null default 'unknown'
                        check (return_policy_status in ('returnable', 'non_returnable', 'unknown')),
  data_source           text not null default 'synthetic_demo' check (data_source in ('synthetic_demo', 'public_reference', 'unverified_sample', 'verified_customer_data')),
  unique (product_id, batch_number),
  check (expiry_date > received_date)
);

create table inventory_balances (
  id            uuid primary key default gen_random_uuid(),
  product_id    uuid not null references products(id),
  batch_id      uuid not null references batches(id),
  location_id   uuid references inventory_locations(id),            -- null = unmapped stock (shown as unmapped)
  on_hand_qty   integer not null check (on_hand_qty >= 0),
  reserved_qty  integer not null default 0 check (reserved_qty >= 0),
  updated_at    timestamptz not null default now(),
  data_source   text not null default 'synthetic_demo' check (data_source in ('synthetic_demo', 'public_reference', 'unverified_sample', 'verified_customer_data')),
  check (reserved_qty <= on_hand_qty)
);
create unique index inventory_balances_batch_location_uq
  on inventory_balances (batch_id, coalesce(location_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index inventory_balances_product_idx on inventory_balances(product_id);

-- ---------------------------------------------------------------------------
-- Scenarios and app state
-- ---------------------------------------------------------------------------

create table scenarios (
  id           text primary key,            -- 'baseline', 'demand_spike', 'supplier_delay', 'budget_cut', 'expiry_risk'
  name         text not null,
  description  text not null,
  params       jsonb not null default '{}'::jsonb
);

-- Data dictionary: every reference dataset used to shape the synthetic data.
create table data_sources (
  id            text primary key,              -- e.g. 'indian_pharmacy_catalogue'
  name          text not null,
  url           text,
  source_type   text not null
                check (source_type in ('public_reference', 'unverified_sample', 'verified_customer_data', 'synthetic_demo')),
  used_for      text not null,                 -- which tables/fields it informed, and how
  licence_note  text,
  retrieved_at  date,
  notes         text
);

create table app_state (
  id                  integer primary key default 1 check (id = 1), -- singleton row
  active_scenario_id  text not null default 'baseline' references scenarios(id),
  default_budget      numeric(14,2) not null default 200000 check (default_budget > 0),
  as_of_date          date,                                          -- null = latest sale_date
  synthetic_seed      integer not null default 42,                   -- seed used by npm run seed
  seeded_at           timestamptz,
  updated_at          timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Planning
-- ---------------------------------------------------------------------------

create table purchase_plans (
  id                uuid primary key default gen_random_uuid(),
  budget_limit      numeric(14,2) not null check (budget_limit > 0),
  proposed_total    numeric(14,2) not null default 0 check (proposed_total >= 0),
  budget_remaining  numeric(14,2) not null default 0 check (budget_remaining >= 0),
  status            text not null default 'draft'
                    check (status in ('draft', 'partially_approved', 'approved', 'rejected')),
  scenario_id       text not null default 'baseline' references scenarios(id),
  as_of_date        date not null,
  assumptions_json  jsonb not null default '{}'::jsonb,
  impact_json       jsonb not null default '{}'::jsonb,
  reject_reason     text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check (proposed_total <= budget_limit)
);

create table purchase_recommendations (
  id                    uuid primary key default gen_random_uuid(),
  plan_id               uuid not null references purchase_plans(id) on delete cascade,
  product_id            uuid not null references products(id),
  selected_offer_id     uuid references supplier_offers(id),
  selected_supplier_id  uuid references suppliers(id),
  suggested_qty         integer not null check (suggested_qty >= 0), -- paid packs
  free_qty              integer not null default 0 check (free_qty >= 0),
  unit_price            numeric(12,4),
  line_subtotal         numeric(14,2) not null default 0,
  line_tax              numeric(14,2) not null default 0,
  line_freight          numeric(14,2) not null default 0,
  line_total            numeric(14,2) not null default 0,
  priority_score        numeric(14,6) not null default 0,
  rank                  integer not null,
  in_basket             boolean not null default false,
  reason_codes          text[] not null default '{}',
  warnings              jsonb not null default '[]'::jsonb,
  status                text not null default 'proposed'
                        check (status in ('proposed', 'edited', 'approved_for_po', 'rejected', 'deferred')),
  defer_reason          text,
  user_note             text,
  evidence_json         jsonb not null default '{}'::jsonb,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (plan_id, product_id)
);

-- ---------------------------------------------------------------------------
-- Purchase orders
-- status 'open'  = confirmed external PO seeded as incoming stock (counts in stock position)
-- status 'draft' = created by PharmaOS on approval (never counts as incoming, never sent)
-- ---------------------------------------------------------------------------

create sequence po_number_seq start 1001;

create table purchase_orders (
  id                      uuid primary key default gen_random_uuid(),
  po_number               text not null unique,
  supplier_id             uuid not null references suppliers(id),
  status                  text not null
                          check (status in ('open', 'received', 'cancelled', 'draft', 'approved_draft', 'exported')),
  subtotal                numeric(14,2) not null default 0,
  tax_total               numeric(14,2) not null default 0,
  freight_total           numeric(14,2) not null default 0,
  grand_total             numeric(14,2) not null default 0,
  expected_delivery_date  date,
  source_plan_id          uuid references purchase_plans(id),
  idempotency_key         text,
  approved_by             text,
  approved_at             timestamptz,
  data_source             text not null default 'synthetic_demo' check (data_source in ('synthetic_demo', 'public_reference', 'unverified_sample', 'verified_customer_data')),
  created_at              timestamptz not null default now(),
  unique (idempotency_key, supplier_id)
);

create table purchase_order_lines (
  id                 uuid primary key default gen_random_uuid(),
  po_id              uuid not null references purchase_orders(id) on delete cascade,
  product_id         uuid not null references products(id),
  supplier_offer_id  uuid references supplier_offers(id),
  recommendation_id  uuid unique references purchase_recommendations(id), -- one PO line per recommendation, ever
  quantity_packs     integer not null check (quantity_packs > 0),
  free_qty           integer not null default 0 check (free_qty >= 0),
  unit_price         numeric(12,4) not null check (unit_price >= 0),
  tax_rate           numeric(5,2) not null,
  line_subtotal      numeric(14,2) not null,
  line_tax           numeric(14,2) not null,
  line_freight       numeric(14,2) not null,
  line_total         numeric(14,2) not null
);

-- ---------------------------------------------------------------------------
-- Approvals, audit, movements
-- ---------------------------------------------------------------------------

create table approvals (
  id           uuid primary key default gen_random_uuid(),
  entity_type  text not null check (entity_type in ('plan', 'recommendation', 'purchase_order')),
  entity_id    uuid not null,
  decision     text not null check (decision in ('approved', 'rejected', 'deferred')),
  user_id      text not null,
  note         text,
  created_at   timestamptz not null default now()
);

create table audit_logs (
  id           bigserial primary key,
  created_at   timestamptz not null default now(),
  actor_type   text not null check (actor_type in ('user', 'system', 'agent', 'tool')),
  actor_id     text not null,
  action       text not null,
  entity_type  text not null,
  entity_id    text,
  before_json  jsonb,
  after_json   jsonb,
  reason       text
);
create index audit_logs_created_idx on audit_logs(created_at desc);

create function audit_logs_append_only() returns trigger language plpgsql as $$
begin
  raise exception 'audit_logs is append-only';
end;
$$;

create trigger audit_logs_no_update before update or delete on audit_logs
  for each row execute function audit_logs_append_only();

create table warehouse_movements (
  id                uuid primary key default gen_random_uuid(),
  product_id        uuid not null references products(id),
  batch_id          uuid references batches(id),
  from_location_id  uuid references inventory_locations(id),
  to_location_id    uuid references inventory_locations(id),
  qty               integer not null check (qty > 0),
  movement_type     text not null
                    check (movement_type in ('putaway_simulated', 'transfer_simulated', 'pick_simulated')),
  created_at        timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Default scenarios and app state
-- ---------------------------------------------------------------------------

insert into scenarios (id, name, description, params) values
  ('baseline',       'Baseline',            'Seeded data with no injected change.', '{}'),
  ('demand_spike',   'Demand spike',        'Demand for selected SKUs multiplied for the last 5 days.', '{"multiplier": 3, "days": 5, "sku_count": 3}'),
  ('supplier_delay', 'Supplier disruption', 'Preferred supplier lead time rises and price changes.', '{"lead_time_add_days": 5, "price_change_pct": 8}'),
  ('budget_cut',     'Budget reduction',    'Budget drops from 2,00,000 to 1,00,000.', '{"budget": 100000}'),
  ('expiry_risk',    'Expiry risk',         'A batch is moved close to expiry so it cannot sell through.', '{"days_to_expiry": 60}');

insert into app_state (id) values (1);
