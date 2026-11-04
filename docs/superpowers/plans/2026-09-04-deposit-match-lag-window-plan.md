# Plan: Deposit Match lag window in business days

Date: 2026-09-04
Branch: `fix/deposit-match-lag-window`
Design: `docs/superpowers/specs/2026-09-04-deposit-match-lag-window-design.md`

Follow the design doc for every detail. This plan gives the task order.
Write each test before the code it checks (TDD).

## Task 1: SQL migration and pgTAP tests

Files:
- `supabase/migrations/20260904150000_deposit_match_business_day_lag.sql` (new)
- `supabase/tests/deposit_match_lag_window_test.sql` (new)
- `supabase/tests/deposit_match_refresh_engine_test.sql` (adjust only
  where the new status ladder changes an expectation)

Steps:
1. Write the pgTAP test file first. Cover the nine cases in the
   design's Test plan. Pin every business date to a named weekday.
2. Write the migration:
   - Create `public.deposit_match_business_days_after(date, integer)`,
     `IMMUTABLE STRICT`, with the `REVOKE`/`GRANT` pair.
   - Add the three CHECK constraints on `deposit_match_rules`.
   - Add the column comments for `lag_days_min` and `lag_days_max`.
   - `CREATE OR REPLACE` only `refresh_deposit_matches`, full header
     restated (`SECURITY DEFINER`, `SET search_path = public, pg_temp`)
     plus the `REVOKE`/`GRANT` pair. Change the four lag sites per the
     design. **Warning:** do not replace `get_deposit_match_report`.
3. Run `npm run test:db`. The new file and all six existing
   `deposit_match_*` test files must pass. Fix late-path expectations
   in the engine test only where the design's ladder reorder changes
   the correct answer, and say so in the commit message.

## Task 2: Frontend copy

Files:
- `src/components/deposit-match/SetupDialog.tsx`
- `src/lib/depositMatchUi.ts`
- `tests/unit/depositMatchUi.test.ts` (only if an exported string
  changes)

Steps:
1. Change the two labels to "Lag business days, min" and
   "Lag business days, max" (`SetupDialog.tsx:520-522,532-534`). Keep
   the input ids. Add `min={0}` and `max={30}` to both inputs.
2. Add the helper line above the amber `note` paragraph, per the
   design's Frontend changes item 2.
3. Change the lag comment blocks in `depositMatchUi.ts` per the
   design's Frontend changes item 3. Do not change numeric defaults.
4. Run `npm run typecheck`, `npm run lint`, `npm run test`.

## Task 3: E2E seed fix

Files:
- `tests/e2e/deposit-match.spec.ts`

Steps:
1. Change `businessDate.setDate(businessDate.getDate() - 3)` to
   `- 7` (line 52). Update the comment block at lines 40-50: state
   that the lag counts business days and why `- 7` keeps `Late` true
   on every weekday.
2. Run the deposit-match E2E spec.

## Definition of done

- `npm run typecheck`, `npm run lint`, `npm run test`, `npm run test:db`
  pass.
- The deposit-match E2E spec passes.
- PR opens against `main` with the design and plan docs linked.
- CI is green.
