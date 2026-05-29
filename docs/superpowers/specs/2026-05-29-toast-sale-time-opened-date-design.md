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

- The **primary** consumer of `sale_time` is hourly staffing analysis. Secondary
  consumers (`useAutomaticInventoryDeduction` / `useInventoryDeduction`) pass/read
  it only as an optional/informational RPC parameter and are unaffected by changing
  its *derivation source*. P&L uses `sale_date` (= Toast `businessDate`), so this
  change does **not** affect P&L or daily aggregates. (A plan task re-greps to
  confirm no consumer depends on closedDate semantics specifically.)
- **Toast only.** Clover already converts to local at sync; Square/Shift4 use their
  own service timestamps. Out of scope here (a plan task notes whether they share
  the same closed-vs-served pitfall as a follow-up).

## Architecture

New migration **`supabase/migrations/20260529130000_toast_sale_time_from_opened_date.sql`**
(timestamp strictly greater than the latest on `main`, `20260529120000`; append-only —
must NOT edit `20260307130000`).

1. **Redefine both overloads** of `sync_toast_to_unified_sales` —
   `(UUID)` and `(UUID, DATE, DATE)` — changing every `sale_time` expression from
   `closedDate` to an `openedDate`-first chain. Only two arms; the old `order_time`
   fallback is **dropped** — the processor stores `order_time` as UTC (and NULL
   whenever `businessDate` exists), so it is not a valid local-time source. A regex
   guard prevents a malformed timestamp from aborting the whole sync:

   ```sql
   sale_time =
     COALESCE(
       CASE WHEN too.raw_json->>'openedDate' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}'
            THEN ((too.raw_json->>'openedDate')::timestamptz AT TIME ZONE v_tz)::time END,
       CASE WHEN too.raw_json->>'closedDate' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}'
            THEN ((too.raw_json->>'closedDate')::timestamptz AT TIME ZONE v_tz)::time END
     )
   ```

   Applied identically to the REVENUE, DISCOUNT, VOID, and TAX inserts (the four
   places that currently use `closedDate`). TIP/REFUND rows keep `sale_time = NULL`
   (unchanged). Both `ON CONFLICT … DO UPDATE SET sale_time = EXCLUDED.sale_time`
   clauses stay, so re-sync re-derives.

2. **Backfill existing rows — BOUNDED to recent data.** The staffing view only
   reads `lookback_weeks` (≤ a few weeks), so we correct only the last **90 days**
   rather than locking the full multi-tenant table. Wrap in a `DO` block with a
   raised local timeout; older rows self-correct on their next sync (the upsert
   re-derives). Same regex guard; exclude tip/refund:

   ```sql
   DO $$
   BEGIN
     SET LOCAL statement_timeout = '300s';
     UPDATE public.unified_sales us
     SET sale_time = ((too.raw_json->>'openedDate')::timestamptz AT TIME ZONE
                      COALESCE(r.timezone, 'America/Chicago'))::time
     FROM public.toast_orders too
     JOIN public.restaurants r ON r.id = too.restaurant_id
     WHERE us.pos_system = 'toast'
       AND us.external_order_id = too.toast_order_guid
       AND us.restaurant_id = too.restaurant_id
       AND us.item_type NOT IN ('tip','refund')
       AND us.sale_date > (CURRENT_DATE - INTERVAL '90 days')
       AND too.raw_json->>'openedDate' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}';
   END $$;
   ```

   (No `sale_time IS NULL` guard — we intentionally *correct* existing non-null
   closedDate-based values. If a full-history backfill is later needed, do it as a
   batched one-shot job, not in this migration.)

3. **Update both `COMMENT ON FUNCTION` strings** to say "Derives sale_time from
   raw_json openedDate (service time) in restaurant timezone, falling back to
   closedDate." Everything else in the RPC (auth check, GUC trigger-skip, dedup
   deletes, `sale_date = too.order_date`, categorization, daily aggregation,
   `SECURITY DEFINER`, `SET search_path`, `statement_timeout`) is unchanged.

> A partial index `unified_sales(restaurant_id, external_order_id) WHERE
> pos_system='toast'` would speed the upsert/backfill, but `CREATE INDEX
> CONCURRENTLY` can't run inside a migration transaction and the bounded backfill
> doesn't need it — deferred as a perf follow-up.

## Edge cases

- **`openedDate` null** → COALESCE falls back to `closedDate` (local), then
  `order_time`. (Coverage is high — openedDate present for ~all recent sale rows.)
- **Post-midnight opens** (e.g. order opened 12:30 AM) → rare for this venue;
  `sale_date` still uses `businessDate` so day-of-week grouping stays correct;
  `sale_time` hour reflects the true open hour.
- **Idempotency** — both overloads upsert via `ON CONFLICT … DO UPDATE SET
  sale_time = EXCLUDED.sale_time`, so re-sync re-derives cleanly.

## Testing (per CLAUDE.md)

- **pgTAP** (`supabase/tests/<n>_toast_sale_time_opened_date.sql`):
  1. Seed a `toast_orders` row whose `raw_json.openedDate` and `closedDate` are in
     different hours; run `sync_toast_to_unified_sales(restaurant, range)`; assert
     the resulting `unified_sales.sale_time` hour equals the **openedDate** local
     hour, not the closedDate hour.
  2. `openedDate` absent → falls back to `closedDate` (local).
  3. `openedDate` malformed/garbage → does not throw; falls back to `closedDate`.
  4. **DST boundary:** an order opened 01:30 local on the `America/Chicago`
     fall-back date converts to the correct local time (regression guard for the
     `AT TIME ZONE` conversion).
- **Manual verification** (Phase 8 evidence): re-run the hour-distribution query
  after a re-sync on a test/seed restaurant and confirm the 4 AM blob is gone.

## Out of scope (follow-ups)

- Square/Clover/Shift4 closed-vs-served parity review.
- Any UI change — the display layer (`aggregateHourlySales`) is correct once
  `sale_time` reflects service time.
