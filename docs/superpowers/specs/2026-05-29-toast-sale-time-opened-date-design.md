# Design: Derive Toast `sale_time` from `openedDate` (service time), not `closedDate`

**Date:** 2026-05-29
**Status:** Approved (design phase)
**Branch:** `fix/toast-sale-time-opened-date`
**Area:** Toast → `unified_sales` sync (`sync_toast_to_unified_sales`); consumed by Staffing Suggestions / hourly analysis

## Problem

The Planner → Staffing Suggestions hourly chart recommends staff at **4 AM** (and
overstates 9–11 PM) for a restaurant that operates ~11 AM–11 PM. Reported as a
suspected timezone bug.

## Root cause (confirmed with production data)

It is **not** a timezone bug. For the busiest Toast restaurant (`America/Chicago`,
last 35 days), **6050/6060** sale rows' `sale_time` hour matches the *local* hour
and **0** match UTC — the `AT TIME ZONE` conversion is correct.

The real cause: `unified_sales.sale_time` is derived from Toast **`closedDate`**
(when the check is *settled/closed*), not when the order was served. `closedDate`
clusters at end-of-night close and at Toast's **overnight auto-settle (~4 AM)**:

| Hour | `closedDate` (current `sale_time`) | `openedDate` (service time) |
|---|---|---|
| 4 AM | **155 orders / $3,454** | — |
| 12–2 PM | 63 / 95 / 155 | 508 / 489 / 475 |
| 6–7 PM | 242 / 266 | **854 / 833** (true dinner peak) |
| 10 PM | 1,250 | 47 |
| 11 PM | **1,402** | — |

`openedDate` yields a clean lunch+dinner curve peaking at 6–7 PM, tapering by 10 PM,
with **no 4 AM blob**. That is the real demand signal staffing needs.

## Goal

Derive `sale_time` from Toast **`openedDate`** (in the restaurant timezone), with a
safe fallback chain, and backfill existing rows. `sale_date` is unchanged.

## Scope / blast radius

- `sale_time` is consumed **only by hourly features** (Staffing Suggestions); P&L
  uses `sale_date` (= Toast `businessDate`). So this change does **not** affect P&L
  or daily aggregates. (Confirmed by the `20260307130000` migration's own note;
  a plan task re-greps `sale_time` consumers to confirm no other dependency.)
- **Toast only.** Clover already converts to local at sync; Square/Shift4 use their
  own service timestamps. Out of scope here (a plan task notes whether they share
  the same closed-vs-served pitfall as a follow-up).

## Architecture

New migration `supabase/migrations/<ts>_toast_sale_time_from_opened_date.sql`:

1. **Redefine both overloads** of `sync_toast_to_unified_sales` —
   `(UUID)` and `(UUID, DATE, DATE)` — changing every `sale_time` expression from
   `closedDate` to a fallback chain:

   ```sql
   sale_time =
     COALESCE(
       ((too.raw_json->>'openedDate')::timestamptz AT TIME ZONE v_tz)::time,
       ((too.raw_json->>'closedDate')::timestamptz AT TIME ZONE v_tz)::time,
       too.order_time
     )
   ```

   Applied identically to the REVENUE, DISCOUNT, VOID, and TAX inserts (the four
   places that currently use `closedDate`). TIP/REFUND rows keep `sale_time = NULL`
   (unchanged — payments have no order-open time and aren't part of demand).

2. **Backfill** existing Toast rows from `openedDate`:

   ```sql
   UPDATE public.unified_sales us
   SET sale_time = ((too.raw_json->>'openedDate')::timestamptz AT TIME ZONE
                    COALESCE(r.timezone, 'America/Chicago'))::time
   FROM public.toast_orders too
   JOIN public.restaurants r ON r.id = too.restaurant_id
   WHERE us.pos_system = 'toast'
     AND us.external_order_id = too.toast_order_guid
     AND us.restaurant_id = too.restaurant_id
     AND us.item_type NOT IN ('tip','refund')
     AND too.raw_json->>'openedDate' IS NOT NULL;
   ```

   (No `sale_time IS NULL` guard — we are intentionally *correcting* existing
   non-null closedDate-based values.)

3. Everything else in the RPC (auth check, GUC trigger-skip, dedup deletes,
   `sale_date = too.order_date`, categorization, daily aggregation) is unchanged.

## Edge cases

- **`openedDate` null** → COALESCE falls back to `closedDate` (local), then
  `order_time`. (Coverage is high — openedDate present for ~all recent sale rows.)
- **Post-midnight opens** (e.g. order opened 12:30 AM) → rare for this venue;
  `sale_date` still uses `businessDate` so day-of-week grouping stays correct;
  `sale_time` hour reflects the true open hour.
- **Idempotency** — both overloads upsert via `ON CONFLICT … DO UPDATE SET
  sale_time = EXCLUDED.sale_time`, so re-sync re-derives cleanly.

## Testing (per CLAUDE.md)

- **pgTAP** (`supabase/tests/<n>_toast_sale_time_opened_date.sql`): seed a
  `toast_orders` row whose `raw_json.openedDate` and `closedDate` are in different
  hours; run `sync_toast_to_unified_sales(restaurant, range)`; assert the resulting
  `unified_sales.sale_time` hour equals the **openedDate** local hour, not the
  closedDate hour. A second case: `openedDate` absent → falls back to `closedDate`.
- **Manual verification** (Phase 8 evidence): re-run the hour-distribution query
  after a re-sync on a test/seed restaurant and confirm the 4 AM blob is gone.

## Out of scope (follow-ups)

- Square/Clover/Shift4 closed-vs-served parity review.
- Any UI change — the display layer (`aggregateHourlySales`) is correct once
  `sale_time` reflects service time.
