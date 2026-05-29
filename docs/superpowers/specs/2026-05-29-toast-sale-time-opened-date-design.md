# Design: Additive `sold_at timestamptz` for Toast service-time (fix staffing hours, non-breaking)

**Date:** 2026-05-29
**Status:** Approved (design phase) — revised to additive approach after consumer audit
**Branch:** `fix/toast-sale-time-opened-date`
**Area:** Toast → `unified_sales` sync; consumed by Staffing Suggestions + `generate-schedule`

## Problem

Staffing Suggestions recommends staff at **4 AM** (and overstates 9–11 PM) for a
restaurant open ~11 AM–11 PM. Confirmed on prod data: it is **not** a timezone bug
(6050/6060 rows match local hour, 0 match UTC). The cause is that
`unified_sales.sale_time` is derived from Toast **`closedDate`** (check
*settle/close* time — piles up at end-of-night close and Toast's ~4 AM overnight
auto-settle), not when the order was **served** (`openedDate`). `openedDate` yields
a clean lunch+dinner curve.

## Why additive (not an in-place `sale_time` change)

A consumer audit found `sale_time` is read by **two** hourly consumers
(`useHourlySalesPattern`/StaffingOverlay and the `generate-schedule` edge function)
and *displayed* in sales lists (`useUnifiedSales`, POS adapters). Inventory
deduction uses `sale_date` (not `sale_time`); P&L/daily aggregates use `sale_date`.
No index/constraint/JOIN keys on `sale_time`. To guarantee **zero breakage** to
display/reconciliation and other POS, we do **not** mutate `sale_time`.

## Decision

Add a nullable **`sold_at timestamptz`** — the absolute sale **instant** — populated
from Toast `openedDate`. Hourly consumers read `sold_at` and convert to the
restaurant timezone **at read time** (`AT TIME ZONE`), falling back to today's
`sale_time` when `sold_at` is null (non-Toast / un-backfilled rows). `sale_time`
and `sale_date` are untouched.

This is intentionally the **first brick** of the larger architecture (store the
absolute instant; keep an explicit business day) — the full `sold_at` +
`business_date` migration across all consumers/POS is a **separate tracked design**.

## Architecture

### 1. Schema (new migration `20260529130000_unified_sales_sold_at.sql`)

```sql
ALTER TABLE public.unified_sales ADD COLUMN IF NOT EXISTS sold_at timestamptz;
COMMENT ON COLUMN public.unified_sales.sold_at IS
  'Absolute instant the sale was served (UTC). Source of truth for time-of-day/hour; convert with AT TIME ZONE <restaurant_tz>. Nullable; consumers fall back to sale_time. Populated from Toast openedDate.';
```

No index needed: the staffing/scheduler queries filter by `restaurant_id` +
`sale_date` range and merely *select* `sold_at`.

### 2. Populate in `sync_toast_to_unified_sales` (both overloads)

At the 4 insert sites (REVENUE/DISCOUNT/VOID/TAX), add `sold_at` = the **instant**
(stored as-is, UTC — no `AT TIME ZONE` at write), `openedDate`-first with a regex
guard so malformed values don't abort the sync:

```sql
sold_at = COALESCE(
  CASE WHEN too.raw_json->>'openedDate' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}'
       THEN (too.raw_json->>'openedDate')::timestamptz END,
  CASE WHEN too.raw_json->>'closedDate' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}'
       THEN (too.raw_json->>'closedDate')::timestamptz END
)
```

Add `sold_at` to each `INSERT ... (cols)`, each `SELECT`, and each
`ON CONFLICT ... DO UPDATE SET sold_at = EXCLUDED.sold_at`. `sale_time`/`sale_date`
lines stay exactly as they are. TIP/REFUND rows leave `sold_at` NULL (not demand).

### 3. Bounded backfill (recent rows only)

```sql
DO $$
BEGIN
  SET LOCAL statement_timeout = '300s';
  UPDATE public.unified_sales us
  SET sold_at = (too.raw_json->>'openedDate')::timestamptz
  FROM public.toast_orders too
  WHERE us.pos_system = 'toast'
    AND us.external_order_id = too.toast_order_guid
    AND us.restaurant_id = too.restaurant_id
    AND us.item_type NOT IN ('tip','refund')
    AND us.sale_date > (CURRENT_DATE - INTERVAL '90 days')
    AND too.raw_json->>'openedDate' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}';
END $$;
```

Older rows populate on their next sync (upsert sets `sold_at`).

### 4. Consumers — convert at read (fallback to `sale_time`)

- **`aggregateHourlySales(rawSales, timeZone)`** (`useHourlySalesPattern.ts`): new
  `timeZone` param. Per row, the hour =
  - if `sold_at` present → hour of `sold_at` in `timeZone` (via
    `Intl.DateTimeFormat(timeZone, {hour:'2-digit', hour12:false})`), else
  - if `sale_time` present → `parseInt(sale_time.split(':')[0])` (legacy path —
    other POS `sale_time` is already local). No-data fallback unchanged.
- **`StaffingOverlay` / `useHourlySalesPattern` query**: select `sold_at` too; pass
  the restaurant timezone (from `useRestaurantContext().selectedRestaurant.timezone`,
  default `America/Chicago`) into `aggregateHourlySales`.
- **`generate-schedule` edge function**: select `sold_at`; compute the hour from
  `sold_at` in the restaurant timezone (already loads the restaurant; read its
  `timezone`), fallback to `sale_time`.

Non-Toast rows (`sold_at` NULL) and all display/reconciliation paths are **unchanged**.

## Testing (per CLAUDE.md)

- **Unit** (`aggregateHourlySales`): buckets by `sold_at`'s local hour given a tz;
  DST-boundary instant maps to correct local hour; falls back to `sale_time` when
  `sold_at` null; existing no-data spread unchanged.
- **pgTAP**: `sync_toast_to_unified_sales` sets `sold_at` from `openedDate`
  (fallback `closedDate`); malformed `openedDate` does not throw; backfill populates
  recent rows. `sale_time`/`sale_date` outputs unchanged.
- **Non-regression**: P&L/daily-aggregate and inventory tests unaffected (they read
  `sale_date`).

## Out of scope (tracked separately)

- Full migration to `sold_at` + explicit `business_date` across P&L, inventory,
  reports, and all four POS writers (separate design doc / initiative).
- Square/Clover/Shift4 also populating `sold_at` (they can later; until then their
  rows use the `sale_time` fallback, which is already local for those POS).
