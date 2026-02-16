# Toast Incremental Sync — Design

## Problem

The `sync_all_toast_to_unified_sales()` cron (runs every 5 minutes) calls the single-argument `sync_toast_to_unified_sales(restaurant_id)` for each restaurant. This overload processes **every** toast order regardless of when it was last synced — DELETE+re-INSERT for all orders, every run. For a restaurant with 10,000 orders, this means 10,000 deletes and ~40,000 inserts every 5 minutes, even if nothing changed.

The 3-argument date-range overload already scopes operations to a date window, but the cron doesn't use it.

## Solution

### Change 1: Cron uses date-range overload with `last_sync_time`

Modify `sync_all_toast_to_unified_sales()` to:
1. Read each connection's `last_sync_time` from `toast_connections`
2. Call the date-range overload: `sync_toast_to_unified_sales(restaurant_id, last_sync_time - interval '25 hours', CURRENT_DATE)`
3. The 25-hour buffer matches the existing incremental sync window in `toast-bulk-sync`

**Why 25 hours?** Toast API data can be delayed or corrected within a 24-hour window. The 1-hour buffer prevents edge cases around midnight boundaries. This matches the existing `toast-bulk-sync` edge function pattern.

**Reasoning:** The single-arg overload remains available for manual full re-sync (admin tooling, data repair). The cron simply switches to the scoped version — no structural changes to either overload.

### Change 2: No DELETE changes needed

The date-range overload already scopes its DELETEs to the date window:
```sql
DELETE FROM unified_sales
WHERE restaurant_id = p_restaurant_id
  AND pos_system = 'toast'
  AND sale_date BETWEEN p_start_date AND p_end_date;
```

Switching the cron to use this overload automatically eliminates the full-table DELETE.

### Change 3: Add missing `toast_payments` index

```sql
CREATE INDEX IF NOT EXISTS idx_toast_payments_restaurant_date
  ON toast_payments (restaurant_id, payment_date);
```

The sync function joins `toast_payments` on `(restaurant_id)` and filters by `payment_date BETWEEN`. Without this index, every sync does a sequential scan on the payments table.

**Why not a partial index?** Unlike categorization rules (where we filter `is_active = true AND auto_apply = true`), payment queries don't have stable boolean filters — all payments participate in the join.

### Change 4: Single-query batch aggregation

After syncing, call `aggregate_unified_sales_to_daily()` once for the date range instead of relying on per-row triggers (already disabled via GUC from the timeout fix).

Current: Triggers fire per-row (disabled during sync, batch-categorize after).
New: After batch categorization, run a single aggregation query for all affected dates.

```sql
PERFORM public.aggregate_unified_sales_to_daily(p_restaurant_id, d)
FROM generate_series(p_start_date, p_end_date, '1 day'::interval) d;
```

### Change 5: Keep single-arg overload for full re-sync

The single-arg version remains unchanged — it's the "nuclear option" for data repair when a restaurant needs a complete re-sync. It should NOT be called from automated processes.

## Files Changed

- Migration: `supabase/migrations/YYYYMMDD_toast_incremental_sync.sql`
  - Redefine `sync_all_toast_to_unified_sales()` to use date-range overload
  - Add `idx_toast_payments_restaurant_date` index
  - Update date-range overload to include batch aggregation
- Test: `supabase/tests/31_toast_incremental_sync.sql`
  - Verify cron entry point uses date-range logic
  - Verify payments index exists
  - Verify aggregation runs after sync

## Risks

- **First run after migration**: The first cron run will use `last_sync_time` which may be stale (up to 6 hours old from bulk-sync). The 25-hour buffer covers this.
- **NULL `last_sync_time`**: New connections that haven't synced yet. Handle by falling back to `CURRENT_DATE - interval '90 days'` (matches initial sync window).
- **Manual full re-sync**: Still available via single-arg overload. No automated process should call it.
