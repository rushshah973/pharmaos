-- Goods receipt: a sent PharmaOS PO (or a seeded in-transit PO) is received into the warehouse. Each line records
-- the packs that arrived (a short delivery is allowed and kept); the PO records when and by whom.
alter table purchase_orders
  add column received_at timestamptz,
  add column received_by text;
alter table purchase_order_lines
  add column received_qty integer check (received_qty >= 0);
