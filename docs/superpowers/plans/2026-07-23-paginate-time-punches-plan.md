# Plan: Paginate the `time_punches` fetches (1000-row cap fix)

Design: `docs/superpowers/specs/2026-07-23-paginate-time-punches-design.md`
Branch: `fix/paginate-time-punches`

Each task is TDD: RED (failing test) → GREEN (minimal code) → REFACTOR → COMMIT.

## Task 1 — Shared `fetchAllRows` helper (RED→GREEN)
- **Test:** `tests/unit/fetchAllRows.test.ts`
  - offsets advance across pages: `[0,999]`, `[1000,1999]`, `[2000,2999]`
  - all rows returned, in order, no duplicates across page boundaries
  - a short final page (`< pageSize`) terminates with `capped: false`
  - full pages up to `maxPages` → `capped: true`
  - `error` from any page throws (propagates)
  - custom `pageSize`/`maxPages` respected
- **Code:** `src/utils/fetchAllRows.ts` — export `SUPABASE_MAX_ROWS`,
  `DEFAULT_MAX_PAGES`, `PagedResult<T>`, `fetchAllRows<T>(buildPage, opts?)`.
- **Commit:** `feat(utils): add fetchAllRows paginated fetch helper`
- Depends on: none.

## Task 2 — Apply to `useLaborCostsFromTimeTracking` + surface `capped` (RED→GREEN)
- **Test:** `tests/unit/useLaborCostsFromTimeTracking.pagination.test.ts`
  - mock `supabase` so `time_punches` returns 1,039 punches across 2 pages
    (page0 = 1,000 rows incl. only old days; page1 = 39 rows incl. the newest
    day). Assert: the newest day's labor is **non-zero** (bug fixed), and
    `.range` was called with advancing offsets. Mock `useEmployees`.
- **Code:** `src/hooks/useLaborCostsFromTimeTracking.tsx`
  - replace the unpaginated query with `fetchAllRows<DBTimePunch>(...)`, add
    `.order('id')` tiebreaker
  - add `capped` to the query return + `LaborCostsFromTimeTrackingResult`
- **Code:** `src/hooks/useLaborPnlCore.ts` — OR the labor `capped` into the
  exposed `capped` (`capped: (data?.capped ?? false) || laborCapped`)
- **Commit:** `fix(labor): paginate time_punches fetch in useLaborCostsFromTimeTracking (#labor $0 bug)`
- Depends on: Task 1.

## Task 3 — Apply to `usePayroll` (GREEN; covered by Task 1 helper test)
- **Code:** `src/hooks/usePayroll.tsx` — replace unpaginated query with
  `fetchAllRows<DBTimePunch>(...)`, add `.order('id')`, `if (capped) console.warn`.
- **Commit:** `fix(payroll): paginate time_punches fetch (1000-row cap)`
- Depends on: Task 1.

## Task 4 — Apply to `useMonthlyMetrics` (GREEN; covered by Task 1 helper test)
- **Code:** `src/hooks/useMonthlyMetrics.tsx` — replace unpaginated query with
  `fetchAllRows<DBTimePunch>(...)`, add `.order('id')`, `if (capped) console.warn`.
  Preserve existing non-fatal `console.warn` on error (this call warns, not throws).
- **Commit:** `fix(monthly): paginate time_punches fetch (1000-row cap)`
- Depends on: Task 1.

## Task 5 — Keep the calc-level regression test
- `tests/unit/laborPunchPaginationRepro.test.ts` already present in the worktree
  (proves truncation → $0, full → $586.72). Verify it still passes; commit if
  not already committed.
- **Commit:** `test(labor): calc-level regression for 1000-row truncation → $0`
- Depends on: none.

## Verification (Phase 8)
- `npm run test` (targeted: the three new/kept tests, plus existing
  `useLaborCostsFromTimeTracking`/`usePayroll`/`useMonthlyMetrics`/`useSplhData`
  suites), then full `npm run test`
- `npm run typecheck`, `npm run lint`, `npm run build`

## Notes / dependencies
- Tasks 2–4 all depend only on Task 1 (the helper). They touch different files,
  so they can be built in sequence with no cross-conflicts.
- No migration, RLS, or edge-function change (design-reviewed).
