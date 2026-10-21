-- 003: the ML demand model (implementationplan.md §6.2a) and the agent pipeline's run trace (§9.5).

-- Trained demand models. The latest row (by trained_at) is the one in use.
create table forecast_models (
  id             uuid primary key default gen_random_uuid(),
  trained_at     timestamptz not null default now(),
  as_of_date     date not null,
  feature_names  jsonb not null,
  means          jsonb not null,
  stds           jsonb not null,
  coefficients   jsonb not null,
  intercept      double precision not null,
  lambda         double precision not null check (lambda > 0),
  train_rows     integer not null check (train_rows > 0),
  holdout_days   integer not null check (holdout_days > 0),
  metrics        jsonb not null default '{}'::jsonb,   -- { mlWape, baselineWape, skusUsingMl, validation: {...} }
  data_source    text not null default 'synthetic_demo' check (data_source in ('synthetic_demo', 'public_reference', 'unverified_sample', 'verified_customer_data'))
);
create index forecast_models_trained_idx on forecast_models(trained_at desc);

-- Per-SKU backtest on the holdout days, and the default method that follows from it.
create table sku_forecast_metrics (
  model_id        uuid not null references forecast_models(id) on delete cascade,
  product_id      uuid not null references products(id) on delete cascade,
  ml_wape         double precision,          -- null when the holdout sold nothing
  baseline_wape   double precision,
  default_method  text not null check (default_method in ('ml', 'baseline')),
  primary key (model_id, product_id)
);

-- One run of the Demand → Supplier → Order agent pipeline.
create table agent_runs (
  id           uuid primary key default gen_random_uuid(),
  plan_id      uuid not null references purchase_plans(id) on delete cascade,
  status       text not null default 'running' check (status in ('running', 'succeeded', 'failed', 'fallback')),
  max_skus     integer not null check (max_skus between 1 and 30),
  skus         jsonb not null default '[]'::jsonb,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  summary      text,
  error        text
);
-- At most one running run per plan.
create unique index agent_runs_one_running on agent_runs(plan_id) where status = 'running';

-- Every tool call and decision of a run (replayable trace). Append-only, like audit_logs.
create table agent_steps (
  id          bigserial primary key,
  run_id      uuid not null references agent_runs(id) on delete cascade,
  agent       text not null check (agent in ('demand', 'supplier', 'order')),
  seq         integer not null,
  kind        text not null check (kind in ('tool_call', 'decision', 'rejected_decision', 'message', 'fallback')),
  tool_name   text,
  input       jsonb,
  output      jsonb,
  ok          boolean not null default true,
  ms          integer,
  created_at  timestamptz not null default now(),
  unique (run_id, seq)
);

create function agent_steps_append_only() returns trigger language plpgsql as $$
begin
  raise exception 'agent_steps is append-only';
end;
$$;

create trigger agent_steps_no_update before update on agent_steps
  for each row execute function agent_steps_append_only();
