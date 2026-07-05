# Plan: BUG-002 null.toFixed() crash on /employee/tips

Design: docs/superpowers/specs/2026-07-04-employee-tips-null-hours-design.md

All tasks are sequential (each ~2–5 min). Single file under change:
`src/pages/EmployeeTips.tsx` + one new test file.

## Task 1 — RED: failing unit test for the History-tab crash

Create `tests/unit/EmployeeTips.nullHours.test.tsx`:

- Mock `@/contexts/RestaurantContext` (`useRestaurantContext` → selected
  restaurant with `restaurant_id: 'r1'`), `@/hooks/useCurrentEmployee`
  (employee `{ id: 'emp1', name: 'Test Employee' }`, `loading: false`),
  `@/hooks/useTipPayouts` (`payouts: []`), `@/hooks/usePeriodNavigation`
  (fixed start/end dates), `@/integrations/supabase/client` (server-earnings
  query returns no rows), and `@/hooks/useTipSplits`.
- `useTipSplits` returns one approved split with
  `items: [{ employee_id: 'emp1', amount: 1500, hours_worked: null, role: 'Server' }]`
  (manual split, no hours) — follow the real `TipSplit`/item shape from
  `src/hooks/useTipSplits.tsx`.
- Render inside `MemoryRouter` + `QueryClientProvider` (pattern:
  `tests/unit/EmployeeMore.test.tsx`).
- Case A (the bug): click the "History" tab → expect render **not to throw**
  and no text matching `/hours/i` inside the history row.
- Case B: same but `hours_worked: 5.25` → History tab shows `5.3 hours`
  (also asserts Breakdown tab still shows the guarded hours line).
- Case C (aggregate): two items for two employees, `hours_worked: null` and
  `4`; current employee is the null one → period summary "Hours worked"
  renders `0.0` (reduce treats null as 0) and no crash anywhere.

Run: `npx vitest run tests/unit/EmployeeTips.nullHours.test.tsx` — Case A must
FAIL with `Cannot read properties of null (reading 'toFixed')` (RED confirmed).

## Task 2 — GREEN: fix EmployeeTips.tsx

- Type: change `hours: number` → `hours: number | null` in the `myTips`
  inline type (line ~122).
- History tab (line ~377): wrap the hours `<p>` in the same guard the
  Breakdown tab uses — render only when `Boolean(tip.hours)`.
- `periodHours` reduce (line ~151): `sum + (tip.hours || 0)` (explicitness
  only — not a bug fix, see design doc).
- Re-run the test file — all three cases GREEN.

## Task 3 — REFACTOR + full local suite sanity

- Confirm no other `tip.hours` consumer needs adjustment
  (`grep -n "tip.hours\|\.hours\b" src/pages/EmployeeTips.tsx`).
- `npm run typecheck` — the `number | null` change must not surface errors
  elsewhere (TipTransparency already accepts `hours?: number | null`).
- Commit: `fix(tips): guard null hours in employee tips history tab (BUG-002)`.

## Notes for downstream phases

- Phase 5 (UI review): change introduces no new classNames; verify only.
- Phase 7a reviewers: diff is one page + one test file.
- No DB/edge-function surface — skip supabase-specific checks.
- E2E not required: crash is deterministic at unit level; no new user flow.
