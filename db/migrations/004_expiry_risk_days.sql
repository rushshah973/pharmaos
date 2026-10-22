-- Expiry-risk scenario: PHX-0178's largest batch expires 92 days after as-of (was: the first demo SKU at 60).
-- A batch must sell 90 days before it expires (ENGINE_CONFIG.expiryRiskWindowDays). At 60 days none of it could
-- sell, so that SKU turned stockout risk and the plan ordered more; at 130 days the demo SKUs stayed excess with
-- nothing to order. Just past the window, part of the batch still sells, the rest is at risk, the SKU falls below
-- its reorder point and the order is capped (EXPIRY_REDUCED_QTY), as §12 expects.
update scenarios
set params = jsonb_build_object('sku', 'PHX-0178', 'days_to_expiry', 92),
    description = 'A large batch is moved close to expiry: a little still sells before the 90-day sell-by window, the rest is at risk and the reorder is capped.'
where id = 'expiry_risk';
