# Plan (tasks): Fix Revel `sold_at` timezone corruption

**Design:** [../specs/2026-07-21-revel-timezone-sold-at-design.md](../specs/2026-07-21-revel-timezone-sold-at-design.md)
**Branch:** `fix/revel-sold-at-timezone` · **Severity:** P1 (auditor exposure)

Bite-sized, dependency-ordered tasks. Each is one RED→GREEN→REFACTOR→COMMIT cycle.

## T1 — `zonedNaiveToUtc` helper + unit tests
- New `supabase/functions/_shared/timezone.ts`: `zonedNaiveToUtc(naive, tz)` + `safeTz()` probe + `tzOffsetMs()` (formatToParts).
- Tests `tests/unit/edgeTimezone.test.ts`:
  - `"2026-07-19T07:32:16" / America/Chicago → 2026-07-19T12:32:16Z` (CDT −5).
  - `"2026-01-15T07:32:16" / America/Chicago → 2026-01-15T13:32:16Z` (CST −6).
  - DST-transition day (2026-03-08) sanity.
  - Invalid tz (`""`, `"Bogus/Zone"`) → falls back to `America/Chicago`, no throw.
  - TZ-portable: assertions compare to explicit UTC ISO (independent of host TZ).
- **Depends on:** none.

## T2 — `parseDateTime` tz-aware + processor tests
- `revelOrderProcessor.ts`: `parseDateTime(order, timeZone)`; naive `created_date` → `zonedNaiveToUtc`; already-zoned (`Z`/`±hh:mm`) → `new Date`. `orderTime` = local `HH:MM:SS`; `orderDate` = business date computed in **local** space (naive − 2h → date).
- Thread `timeZone` through `normalizeOrder` → `processOrder`.
- Fix + expand `tests/unit/revelOrderProcessor.test.ts`: fixture → naive `"2026-07-19T07:32:16"`; assert `sold_at === 2026-07-19T12:32:16Z`, `order_time === "07:32:16"`, `order_date === "2026-07-19"`. Add a post-2 AM-boundary case.
- **Depends on:** T1.

## T3 — Callers resolve & pass tz
- `revel-webhook`, `revel-sync-data`, `revel-bulk-sync`: fetch `restaurants.timezone` once per run; pass into `processOrder`; fallback `America/Chicago`; warn-log if null.
- **Depends on:** T2.

## T4 — Backfill migration (hardened per design review)
- Add `IMMUTABLE` helper `revel_raw_created_date(jsonb)` mirroring `getOrderNode`/`parseDateTime` precedence (envelopes `Order/order/payload`; fields `created_date/createdDate/closed_date/finalized_date/date`).
- Per-restaurant `DO` loop:
  - validate tz against `pg_timezone_names` (fallback `America/Chicago`);
  - UPDATE `revel_orders.sold_at` (`IS DISTINCT FROM` guard);
  - suppress `app.skip_unified_sales_triggers` around the `unified_sales.sold_at` UPDATE, then re-aggregate once per distinct `(restaurant_id, sale_date)` via `aggregate_unified_sales_to_daily`.
- Pre/post report: affected rows + restaurants with invalid/null tz.
- **Depends on:** none (reads `raw_json`); run after T2/T3 deploy per sequencing.

## T5 — Revel RPC self-heal (durability)
- `revel_sync_financial_breakdown` + `sync_revel_to_unified_sales`: change `unified_sales` insert blocks' `ON CONFLICT … DO NOTHING` → `DO UPDATE SET sold_at = COALESCE(EXCLUDED.sold_at, unified_sales.sold_at)` (update **only** `sold_at`; preserve categorization). Mirrors Toast's RPC.
- **Depends on:** none (SQL migration alongside T4).

## T6 — pgTAP reconciliation test
- `supabase/tests/revel_sold_at_backfill.sql`: after backfill, for all Revel rows `(sold_at AT TIME ZONE r.timezone)::time` equals `sale_time` (± 1s); `mismatches = 0`. Seed a naive-local revel order fixture. Also assert an invalid-tz restaurant falls back (no throw) and the trigger-suppression path leaves `daily_*` aggregates consistent.
- **Depends on:** T4, T5.

## T7 — Regression guard: Toast unaffected
- Unit assertion that Toast `sold_at`/hour attribution is unchanged (Toast stores a correct instant from `closedDate`; must not regress). Confirm no shared read-path change.
- **Depends on:** T2.

## Verification (Phase 8 + post-deploy)
- Unit + pgTAP + typecheck + lint + build green.
- Post-deploy (manual, documented in PR): Labor view for Rush Bowls Kallison Ranch shows earliest sales **7 AM**, no "staff 1–6 AM"/"Peak 3 AM"; daily `sum(total_price)` by `sale_date` reconciles to Revel Sales Summary; hourly distribution matches Revel Hourly Sales; **`generate-schedule`** hourly weighting no longer clusters overnight; migration pre-flight report shows no invalid-tz surprises.

## Sequencing
Deploy source fix (T1–T3) → run backfill (T4) → verify (T5, post-deploy checks). T4 before-or-with deploy is fine (reads raw_json), but running it right after deploy avoids a re-corruption window.
