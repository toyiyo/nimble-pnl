-- Fix Toast payment dates: use paidBusinessDate (restaurant business day) instead of UTC date
--
-- Toast provides paidBusinessDate as a YYYYMMDD integer representing the restaurant's
-- actual business day. The sync was using the UTC date from paidDate/closedDate, causing
-- late-night payments to appear on the next calendar day.

-- Step 1: Fix toast_payments.payment_date from raw_json->>'paidBusinessDate'
UPDATE toast_payments
SET payment_date = CONCAT(
  SUBSTRING(CAST((raw_json->>'paidBusinessDate')::BIGINT AS TEXT), 1, 4), '-',
  SUBSTRING(CAST((raw_json->>'paidBusinessDate')::BIGINT AS TEXT), 5, 2), '-',
  SUBSTRING(CAST((raw_json->>'paidBusinessDate')::BIGINT AS TEXT), 7, 2)
)::DATE
WHERE raw_json->>'paidBusinessDate' IS NOT NULL
  AND LENGTH(CAST((raw_json->>'paidBusinessDate')::BIGINT AS TEXT)) = 8
  AND payment_date != CONCAT(
    SUBSTRING(CAST((raw_json->>'paidBusinessDate')::BIGINT AS TEXT), 1, 4), '-',
    SUBSTRING(CAST((raw_json->>'paidBusinessDate')::BIGINT AS TEXT), 5, 2), '-',
    SUBSTRING(CAST((raw_json->>'paidBusinessDate')::BIGINT AS TEXT), 7, 2)
  )::DATE;

-- Step 2: Fix unified_sales.sale_date for Toast tip entries
-- These have external_item_id ending in '_tip' and reference toast_payments via external_order_id
UPDATE unified_sales us
SET sale_date = tp.payment_date
FROM toast_payments tp
WHERE us.pos_system = 'toast'
  AND us.external_order_id = tp.toast_order_guid
  AND us.external_item_id = tp.toast_payment_guid || '_tip'
  AND us.sale_date != tp.payment_date;

-- Step 3: Fix toast_orders.order_date from raw_json->>'businessDate'
-- (order_date was also derived from UTC closedDate)
UPDATE toast_orders
SET order_date = CONCAT(
  SUBSTRING(CAST((raw_json->>'businessDate')::BIGINT AS TEXT), 1, 4), '-',
  SUBSTRING(CAST((raw_json->>'businessDate')::BIGINT AS TEXT), 5, 2), '-',
  SUBSTRING(CAST((raw_json->>'businessDate')::BIGINT AS TEXT), 7, 2)
)::DATE
WHERE raw_json->>'businessDate' IS NOT NULL
  AND LENGTH(CAST((raw_json->>'businessDate')::BIGINT AS TEXT)) = 8
  AND order_date != CONCAT(
    SUBSTRING(CAST((raw_json->>'businessDate')::BIGINT AS TEXT), 1, 4), '-',
    SUBSTRING(CAST((raw_json->>'businessDate')::BIGINT AS TEXT), 5, 2), '-',
    SUBSTRING(CAST((raw_json->>'businessDate')::BIGINT AS TEXT), 7, 2)
  )::DATE;

-- Step 4: Fix unified_sales.sale_date for regular Toast items using (now-corrected) toast_orders
UPDATE unified_sales us
SET sale_date = to_ord.order_date
FROM toast_orders to_ord
WHERE us.pos_system = 'toast'
  AND us.external_order_id = to_ord.toast_order_guid
  AND us.restaurant_id = to_ord.restaurant_id
  AND us.item_type IS DISTINCT FROM 'tip'
  AND us.adjustment_type IS DISTINCT FROM 'tip'
  AND to_ord.raw_json->>'businessDate' IS NOT NULL
  AND LENGTH(CAST((to_ord.raw_json->>'businessDate')::BIGINT AS TEXT)) = 8
  AND us.sale_date != to_ord.order_date;
