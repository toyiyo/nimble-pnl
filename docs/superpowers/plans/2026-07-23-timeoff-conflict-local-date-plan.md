# Plan — scheduling conflict dates in the restaurant-local frame

**Design:** `docs/superpowers/specs/2026-07-23-timeoff-conflict-local-date-design.md`
**Branch:** `fix/timeoff-conflict-local-date` (worktree `.claude/worktrees/timeoff-conflict-local-date`)
**Base:** `origin/main` @ `87d7df91`

## Step 1 — pgTAP first (RED)

Write `supabase/tests/timeoff_conflict_local_tz.sql` with the 10 cases from the
design doc, modelled on `supabase/tests/availability_conflict_local_tz.sql`
(RLS disabled on fixtures, delete-before-insert, fixed absolute dates, offsets
derived via SQL so DST is correct whenever CI runs).

Run `npm run test:db` and confirm cases 1, 2 and 3 **fail** against the current
UTC-frame function. If case 2 (the false negative) passes before the fix, the
fixture is wrong, not the function.

## Step 2 — the migration (GREEN)

`supabase/migrations/20260723180000_timeoff_conflict_local_tz.sql`:

- Plain `CREATE OR REPLACE FUNCTION check_timeoff_conflict` — identical
  signature and `RETURNS TABLE` shape, so no `DROP`, no client change.
- Resolve `v_tz` via `employees e JOIN restaurants r ON r.id = e.restaurant_id`;
  `COALESCE(NULLIF(v_tz,''),'UTC')` then validate against `pg_timezone_names`,
  falling back to `UTC`.
- `v_start_date := (p_start_time AT TIME ZONE v_tz)::date`; same for end, with
  the local-midnight pullback (D3).
- Predicate becomes `tor.start_date <= v_end_date AND tor.end_date >= v_start_date`,
  keeping `status IN ('approved','pending')` and the `employee_id` filter.
- Keep `STABLE`, keep `SECURITY INVOKER` (default), add
  `SET search_path = public, pg_catalog`.
- Header comment explaining the frame mismatch and pointing at the sibling
  precedent, matching the house style of the 20260712120000 migration.

`npm run test:db` → all 10 green.

## Step 3 — the day label

`src/lib/conflictFormatUtils.ts`: `extractDayLabel` uses
`formatDateOnly(dateStr, 'EEE, MMM d')` from `src/lib/dateOnly.ts`; drop its
`timezone` parameter and the argument at both call sites (lines 71, 78), since a
calendar date has no timezone.

Add day-label assertions to `tests/unit/conflictFormatUtils.test.ts` — the
existing tests assert only the time range, which is exactly why this shipped.
Assert the failing case directly: `2026-07-31` in `America/Chicago` must render
`Fri, Jul 31`, not `Thu, Jul 30`.

## Step 4 — delete the dead client check

Remove `checkTimeOffConflicts`, `ValidateOptions.timeOffRequests`, the
`TimeOffRequest` import, and the `if (options?.timeOffRequests)` branch from
`src/lib/shiftValidator.ts`; remove the `TIME_OFF` block from
`tests/unit/shiftValidator.test.ts`. `npm run typecheck` proves no caller
breaks.

## Step 5 — verify

- `npm run test` — full unit suite
- **`TZ=UTC npm run test`** — non-negotiable per the 2026-07-21 lesson; this is
  the run that reproduces CI-vs-dev timezone divergence. The remaining
  overlap/clopen tests in `shiftValidator.test.ts` seed naive date strings.
- `npm run typecheck && npm run lint`
- `npm run test:db`
- `npm run test:e2e -- scheduling-conflicts.spec.ts` — known-flaky; a *varying*
  failure set is flakiness, a *stable* one is a real regression.

## Step 6 — Phases 6–9

code-simplify → parallel reviewers → CodeRabbit → PR → CI to green.

## Not in this PR

PostHog instrumentation on the conflict dialog. The dialog emits no events
today, so we cannot confirm from telemetry that spurious warnings dropped.
Separate PR, per the approved bundling.

## Rollback

Single `CREATE OR REPLACE` — reverting is re-applying the previous body. No
data migration, no schema change, no client contract change.
