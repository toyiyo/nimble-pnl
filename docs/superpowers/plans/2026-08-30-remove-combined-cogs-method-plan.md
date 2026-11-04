# Plan: Delete the 'combined' COGS method

Date: 2026-08-30
Design: docs/superpowers/specs/2026-08-30-remove-combined-cogs-method-design.md
Branch: `claude/angry-shirley-1fe1ad`
Worktree: `.claude/worktrees/elastic-sinoussi-c3d042`

Follow the design doc for all details. This plan orders the work for
TDD. Each task states: the test first, then the change, then the check.

## Task 1: normalization helper

1. Write `tests/unit/cogsMethod.test.ts`. Cases for
   `normalizeCOGSMethod`: `'inventory'` → `'inventory'`;
   `'financials'` → `'financials'`; `'combined'` → `'inventory'`;
   `null` → `'inventory'`; `undefined` → `'inventory'`;
   `'garbage'` → `'inventory'`. Run the test; it must fail (module
   absent).
2. Create `src/lib/cogsMethod.ts`:
   ```typescript
   export type COGSMethod = 'inventory' | 'financials';
   export function normalizeCOGSMethod(
     value: string | null | undefined,
   ): COGSMethod {
     return value === 'financials' ? 'financials' : 'inventory';
   }
   ```
3. Run the test; it must pass.

## Task 2: `useFinancialSettings`

1. Update `tests/unit/useFinancialSettings.test.ts`:
   - Replace the `combined` fixtures (lines 118, 130, 135, 232) with
     `financials`.
   - Add one test: a settings row with
     `cogs_calculation_method = 'combined'` yields
     `cogsMethod === 'inventory'`.
   Run; the new test must fail.
2. Update `src/hooks/useFinancialSettings.tsx`:
   - Import and re-export `COGSMethod` from `@/lib/cogsMethod` (replace
     the local three-value type at line 7).
   - Return `normalizeCOGSMethod(settings?.cogs_calculation_method)`
     (line 121).
3. Run; all tests must pass.

## Task 3: `useUnifiedCOGS`

1. Update `tests/unit/useUnifiedCOGS.test.ts`:
   - Delete the standalone `it()` blocks at lines 132, 148, and 352.
   - In the shared test at lines 170-212, delete only the `combined`
     sub-case (lines 199-211). Keep the `inventory` and `financials`
     assertions.
   - Add one test: for both methods, `totalCOGS` equals exactly one
     source total, never the sum (250 or 200, never 450).
2. Update `src/hooks/useUnifiedCOGS.tsx`:
   - Delete the `case 'combined'` block (lines 62-78).
   - `financials` selects the financial source; every other value
     selects inventory.
   - Update the top JSDoc (lines 16-26): remove the "both (combined)"
     clause.
   - Keep `breakdown` unchanged.
3. Run; all tests must pass.

## Task 4: `useMonthlyMetrics`

1. Update `src/hooks/useMonthlyMetrics.tsx`:
   - Normalize the raw setting with `normalizeCOGSMethod` (line 260).
   - Delete the four `|| cogsMethod === 'combined'` branches (lines
     264, 280, 508, 517). Each guard becomes one equality test.
2. Run `npm run typecheck` and the full unit suite.

## Task 5: settings UI

1. Update `src/components/settings/COGSPreferenceSettings.tsx`:
   - Delete the `combined` entry from `COGS_OPTIONS` (lines 34-39).
   - New copy (from the design doc):
     - `inventory`: label "Inventory (consumption)", description
       "Computes COGS from inventory usage: the cost of ingredients
       that your recipes consume."
     - `financials`: label "Financials (purchases)", description
       "Computes COGS from purchases: bank transactions, splits, and
       pending outflows in COGS categories."
   - Reduce the skeleton placeholders from three to two (lines 79-81).
2. Run `npm run typecheck` and `npm run lint`.

## Task 6: database migration + pgTAP

1. Update `supabase/tests/restaurant_financial_settings.test.sql`:
   - Line 162 (Test 13 INSERT): `'combined'` → `'financials'`.
   - Line 174 (Test 14 owner UPDATE): `'combined'` → `'financials'`.
   - Line 205 (Test 16 staff UPDATE attempt): `'financials'` →
     `'inventory'`. The owner value and the staff value must differ, or
     the RLS assertion cannot fail.
   - Line 216 (Test 16 assertion): `'combined'` → `'financials'`.
   - Update the comments at lines 203-208 to match the new values.
   - Add one test: `throws_ok` with SQLSTATE `23514` for an INSERT with
     `'combined'`. Place it after Test 8. Update `plan(16)` to
     `plan(17)` and renumber comments if needed.
2. Create
   `supabase/migrations/20260830120000_remove_combined_cogs_method.sql`
   with the exact SQL from the design doc (UPDATE rows first, then
   drop and re-add the CHECK constraint).
   Warning: use this exact timestamp. A parallel PR (pending-outflow
   auto-link) claims 20260830100000, 20260830100100, and
   20260830100200. The test
   `tests/unit/migrationVersionUniqueness.test.ts` fails on a
   duplicate prefix.
3. Run `npm run db:reset`, then `npm run test:db`. All pgTAP tests must
   pass.

## Task 7: E2E test

1. Create `tests/e2e/cogs-settings.spec.ts`:
   - Import helpers from `'../helpers/e2e-supabase'`; use
     `generateTestUser()`.
   - Sign in, open restaurant settings, find the COGS card.
   - Check: exactly two radio options; no "Combined" text.
   - Select "Financials (purchases)"; reload; check the selection
     persists.
   - Use `page.getByRole()` / `page.getByLabel()` selectors.
2. Run the spec locally against the dev stack.

## Task 8: full verification

1. `npm run typecheck`
2. `npm run lint`
3. `npm run test`
4. `npm run test:db`
5. `grep -rn "combined"` over `src/` — the only remaining hit must be
   the unrelated tips union in `src/hooks/usePOSTips.tsx:10`.

## Commit strategy

One commit per task, explicit paths only. Never stage `progress.md`.
Suggested messages:
- `feat(cogs): add the COGSMethod normalization helper`
- `fix(cogs): narrow useFinancialSettings to two COGS methods`
- `fix(cogs): remove the combined case from useUnifiedCOGS`
- `fix(cogs): remove the combined branches from useMonthlyMetrics`
- `fix(settings): show two COGS options with exact copy`
- `feat(db): migrate combined COGS rows and tighten the constraint`
- `test(e2e): cover the two-option COGS settings card`

## Out of scope

See "Reviewer concerns declined" in the design doc. Do not restructure
the radio group, add an error field to `useFinancialSettings`, or add
component unit tests for `COGSPreferenceSettings`.
