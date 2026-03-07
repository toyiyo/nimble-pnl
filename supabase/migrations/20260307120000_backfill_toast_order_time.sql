-- Backfill sale_time in unified_sales for Toast records.
--
-- Context: commit 1678ca27 ("Fix Toast date timezone") intentionally set
-- orderTime to null when businessDate exists, because closedDate is UTC
-- and mixing UTC time with the restaurant's business date is incorrect.
-- This was the right call for date accuracy, but left sale_time empty
-- for all Toast orders, breaking hourly analysis (e.g. staffing suggestions).
--
-- Fix: derive sale_time from the raw JSON closedDate, converted to the
-- restaurant's local timezone. This gives us the correct local time while
-- preserving the businessDate-based sale_date.

-- Step 1: Backfill sale_time in unified_sales directly from toast_orders raw JSON
UPDATE public.unified_sales us
SET sale_time = (
  (too.raw_json->>'closedDate')::timestamptz
  AT TIME ZONE COALESCE(r.timezone, 'America/Chicago')
)::time
FROM public.toast_orders too
JOIN public.restaurants r ON r.id = too.restaurant_id
WHERE us.pos_system = 'toast'
  AND us.external_order_id = too.toast_order_guid
  AND us.restaurant_id = too.restaurant_id
  AND us.sale_time IS NULL
  AND too.raw_json->>'closedDate' IS NOT NULL;
