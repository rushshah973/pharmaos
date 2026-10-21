-- 002: no purchase budget. Spend is controlled per purchase order instead: a PO whose grand total is
-- above app_state.po_approval_limit (default ₹4,00,000) needs Owner approval before it can be sent.
-- Sending is simulated: status 'sent' + timestamp; nothing leaves the app.

-- Plans no longer carry a budget (dropping budget_limit also drops the proposed_total <= budget_limit check).
alter table purchase_plans
  drop column budget_limit,
  drop column budget_remaining;

alter table app_state
  drop column default_budget,
  add column po_approval_limit numeric(14,2) not null default 400000 check (po_approval_limit > 0);

-- PO lifecycle. Seeded external POs: open | received | cancelled.
-- PharmaOS POs: ready (≤ limit) | pending_approval (> limit) → approved → sent; or rejected.
alter table purchase_orders drop constraint purchase_orders_status_check;
alter table purchase_orders add constraint purchase_orders_status_check
  check (status in ('open', 'received', 'cancelled', 'ready', 'pending_approval', 'approved', 'sent', 'rejected'));
alter table purchase_orders
  add column sent_at timestamptz,
  add column sent_by text;

-- The budget-cut scenario has no meaning without a budget; seasonal surge shows the approval gate instead.
insert into scenarios (id, name, description, params) values
  ('seasonal_surge', 'Seasonal surge',
   'Monsoon fever season: demand for analgesic, antibiotic and respiratory SKUs rises, so some supplier POs cross the ₹4,00,000 approval limit.',
   '{"categories": ["analgesic", "antibiotic", "respiratory"], "multiplier": 4, "days": 10}');
update app_state set active_scenario_id = 'baseline' where active_scenario_id = 'budget_cut';
update purchase_plans set scenario_id = 'baseline' where scenario_id = 'budget_cut';
delete from scenarios where id = 'budget_cut';
