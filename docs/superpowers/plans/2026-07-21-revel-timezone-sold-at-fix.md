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

## T4 — Backfill migration
- New migration: recompute `revel_orders.sold_at` from `raw_json` `created_date` via `::timestamp AT TIME ZONE COALESCE(r.timezone,'America/Chicago')`; propagate to `unified_sales.sold_at` (join `external_order_id = revel_order_id`, `pos_system='revel'`). Idempotent (`IS DISTINCT FROM` guards). Emit pre/post affected-row report; flag null-tz restaurants.
- **Depends on:** none (reads `raw_json`); run after T2/T3 deploy per sequencing.

## T5 — pgTAP reconciliation test
- `supabase/tests/revel_sold_at_backfill.sql`: after backfill, for all Revel rows `(sold_at AT TIME ZONE r.timezone)::time` equals `sale_time` (± 1s); `mismatches = 0`. Seed a naive-local revel order fixture.
- **Depends on:** T4.

## T6 — Regression guard: Toast unaffected
- Unit assertion that Toast `sold_at`/hour attribution is unchanged (Toast stores a correct instant from `closedDate`; must not regress). Confirm no shared read-path change.
- **Depends on:** T2.

## Verification (Phase 8 + post-deploy)
- Unit + pgTAP + typecheck + lint + build green.
- Post-deploy (manual, documented in PR): Labor view for Rush Bowls Kallison Ranch shows earliest sales **7 AM**, no "staff 1–6 AM"/"Peak 3 AM"; daily `sum(total_price)` by `sale_date` reconciles to Revel Sales Summary; hourly distribution matches Revel Hourly Sales.

## Sequencing
Deploy source fix (T1–T3) → run backfill (T4) → verify (T5, post-deploy checks). T4 before-or-with deploy is fine (reads raw_json), but running it right after deploy avoids a re-corruption window.
