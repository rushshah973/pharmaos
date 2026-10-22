-- Mid-size stockist scale (≈ ₹15–20 Cr purchases a year): the Owner approval limit becomes ₹10,00,000, so only the
-- largest supplier POs wait for the Owner. The seasonal surge still pushes some above it.
alter table app_state alter column po_approval_limit set default 1000000;
update app_state set po_approval_limit = 1000000 where po_approval_limit = 400000;
update scenarios
set description = 'Monsoon fever season: demand for analgesic, antibiotic and respiratory SKUs rises, so some supplier POs cross the Owner approval limit.'
where id = 'seasonal_surge';
