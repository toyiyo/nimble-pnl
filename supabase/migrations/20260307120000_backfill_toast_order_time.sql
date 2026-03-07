-- Backfill order_time in toast_orders from raw_json.closedDate
-- The parseOrderDateTime function was returning orderTime: null when businessDate
-- existed, so all Toast orders synced with businessDate have NULL order_time.
-- This extracts the time from closedDate in the raw JSON, converted to the
-- restaurant's local timezone.

UPDATE public.toast_orders too
SET order_time = (
  (too.raw_json->>'closedDate')::timestamptz
  AT TIME ZONE COALESCE(r.timezone, 'America/Chicago')
)::time
FROM public.restaurants r
WHERE r.id = too.restaurant_id
  AND too.order_time IS NULL
  AND too.raw_json->>'closedDate' IS NOT NULL;

-- Also backfill sale_time in unified_sales for toast records
UPDATE public.unified_sales us
SET sale_time = too.order_time
FROM public.toast_orders too
WHERE us.pos_system = 'toast'
  AND us.external_order_id = too.toast_order_guid
  AND us.restaurant_id = too.restaurant_id
  AND us.sale_time IS NULL
  AND too.order_time IS NOT NULL;
