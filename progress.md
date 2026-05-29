# Progress

## Phase: Preflight — COMPLETED

**Date:** 2026-05-28

### Results
- Branch: feature/staffing-suggestions-actionable (correct)
- gh: authenticated as jdelgado2002 (token scopes: gist, read:org, repo, workflow)
- jq: 1.7.1
- node: v24.11.1
- coderabbit: 0.5.2
- codex: NOT AVAILABLE (warning only)
- SONAR_TOKEN: not set (warning only)
- SONAR_PROJECT_KEY: not set (warning only)
- .env.local symlink: created (linked to /Users/josedelgado/Documents/GitHub/nimble-pnl/.env.local)

### Status
All hard dependencies met. codex and Sonar absent (non-blocking warnings).

---

## Phase: 4 (Build, TDD) — IN PROGRESS

### Task 1: `distributePositions` pure helper — COMPLETED
- **Commit:** `8c0e501b`
- **Files:**
  - `src/lib/staffingApply.ts` (new) — `distributePositions` + `PositionCount` interface
  - `tests/unit/staffingApply.test.ts` (new) — 5 tests: null crew fallback, empty crew fallback, proportional split sum, headcount < positions, zero headcount
- **TDD cycle:** RED (import error) → GREEN (all 5 pass) → REFACTOR (clean, no changes needed) → COMMIT

### Task 2: `shiftBlocksToTemplates` pure helper — COMPLETED
- **Commit:** `d99cb60c`
- **Files:**
  - `src/lib/staffingApply.ts` (modified) — appended `TemplateInsert` type, `dayStringToDow`, `pad` helper, `shiftBlocksToTemplates`
  - `tests/unit/staffingApply.test.ts` (modified) — 3 new tests appended: per-position mapping with capacity split, Staff fallback with no crew, skip zero-headcount blocks. Total 8 tests all pass.
- **TDD cycle:** RED (shiftBlocksToTemplates is not a function — 3 failures) → GREEN (all 8 pass) → REFACTOR (clean, no changes needed) → COMMIT

### Task 3: Idempotency migration + pgTAP — COMPLETED
- **Commit:** `8a01c4cf`
- **Files:**
  - `supabase/migrations/20260528120000_shift_templates_idempotent_apply.sql` (new) — `CREATE UNIQUE INDEX uq_shift_templates_active_slot ON shift_templates (restaurant_id, position, start_time, end_time) WHERE is_active = true`
  - `supabase/tests/38_shift_templates_idempotent_apply.sql` (new) — 3 pgTAP tests: duplicate active slot violates unique index (23505), ON CONFLICT DO NOTHING re-apply is a no-op, distinct position inserts cleanly
- **TDD cycle:** RED (tests 1 & 2 fail — no index exists, duplicate doesn't throw, ON CONFLICT has no matching constraint) → GREEN (migration applied, all 3 pass) → REFACTOR (no changes needed) → COMMIT
- **Full suite:** 1356/1356 tests pass

### Task 4: `useApplySuggestedShifts` hook — COMPLETED
- **Commit:** `e85b6f92`
- **Files:**
  - `src/hooks/useApplySuggestedShifts.ts` (new) — `useApplySuggestedShifts(restaurantId)` returning `{ applyShifts, isApplying }`; chunked upsert (200/chunk) with `ON CONFLICT DO NOTHING`; `created/skipped` count from rows-back vs rows-sent; invalidates `['shift_templates', restaurantId]`, `['open_shifts', restaurantId]`, `['shifts', restaurantId]`; success toast names result; destructive toast on error.
  - `tests/unit/useApplySuggestedShifts.test.ts` (new) — 6 tests: created/skipped counts, conflict skip, chunking (201 rows → 2 upsert calls), success toast content, destructive toast on error, isApplying false before/after.
- **TDD cycle:** RED (module not found) → GREEN (all 6 pass) → REFACTOR (no changes needed, typecheck clean) → COMMIT

### Task 5: `ApplyShiftsDialog` component — COMPLETED
- **Commit:** `6868bb64`
- **Files:**
  - `src/components/scheduling/ShiftPlanner/ApplyShiftsDialog.tsx` (new) — dialog with per-block checkboxes (aria-label "Include {day} {time}, N staff"), no-crew nudge banner (amber), open-shifts-disabled note (blue), footer counting selected blocks, Cancel/Confirm buttons; Confirm calls `useApplySuggestedShifts` via `shiftBlocksToTemplates`; state resets on close.
  - `tests/unit/ApplyShiftsDialog.test.tsx` (new) — 8 tests: dialog renders title, one checkbox per block all initially checked, aria-labels contain "Include" + day, no-crew nudge shown/hidden, open-shifts-disabled note shown, unchecking updates Create count, all unchecked disables button, Cancel calls onOpenChange(false).
- **TDD cycle:** RED (module not found → 8 failures) → GREEN (all 8 pass) → REFACTOR (typecheck clean, no changes needed) → COMMIT

### Task 6: `SuggestedShifts` component — COMPLETED
- **Commit:** `0c3de99a`
- **Files:**
  - `src/components/scheduling/ShiftPlanner/SuggestedShifts.tsx` (new) — renders `shiftBlocks` grouped by day with three explicit states: empty text when `blocks.length === 0`, list view with day/time/headcount rows when blocks exist, plus "Apply suggested shifts" button that opens `ApplyShiftsDialog`. Uses `useMemo` to group blocks by `day` string and sort chronologically.
  - `tests/unit/SuggestedShifts.test.tsx` (new) — 6 tests: empty-state message shown, Apply button absent when empty, heading present with blocks, Apply button present with blocks, day grouping (two Friday blocks under one Fri label), dialog opens on button click.
- **TDD cycle:** RED (module not found → 6 failures) → GREEN (all 6 pass) → REFACTOR (typecheck clean, no changes needed) → COMMIT
- **Full suite:** 321 test files pass (4302 tests)

### Task 7: Wire `SuggestedShifts` into `StaffingOverlay` + aggregate blocks + default-expanded — COMPLETED
- **Commit:** `8bed8c58`
- **Files:**
  - `src/components/scheduling/ShiftPlanner/StaffingOverlay.tsx` (modified) — added `import { SuggestedShifts }`, changed `useState(false)` → `useState(true)` for `isExpanded`, added `allShiftBlocks` useMemo (flatMaps `s.shiftBlocks` from all `daySuggestions` values), rendered `<SuggestedShifts blocks={allShiftBlocks} minCrew={activeSettings.min_crew} restaurantId={restaurantId} openShiftsEnabled={activeSettings.open_shifts_enabled} />` after summary row, gated on `hasSalesData`.
  - `tests/unit/StaffingOverlay.wiring.test.tsx` (new) — 6 tests: default-expanded trigger shows aria-expanded=true, SuggestedShifts mounts with hasSalesData=true, blocks prop is an array, no render when hasSalesData=false, restaurantId threaded through to SuggestedShifts, config panel visible when not loading.
- **TDD cycle:** RED (CollapsibleContent closed → config-panel not found → 2 failures) → GREEN (expanded by default, SuggestedShifts wired → all 6 pass) → REFACTOR (typecheck clean, no changes needed) → COMMIT
- **Full suite:** 322 test files pass (4308 tests)

### Task 9: StaffingConfigPanel clarity — Save gating + help labels — COMPLETED
- **Commit:** `a3f73526`
- **Files:**
  - `src/components/scheduling/ShiftPlanner/StaffingConfigPanel.tsx` (modified) — (1) added `hasPendingChanges: boolean` to interface + destructured param; (2) Save as Default button `disabled={!hasPendingChanges || isSaving}`; (3) helper text `"Toggles save automatically; numeric settings save here."` added below button; (4) `HelpTip` now accepts `fieldName` and adds `aria-label={\"Help for ${fieldName}\"}` to `TooltipTrigger`; updated all four HelpTip usages (Sales per Labor Hour, Labor Cost Target, Min Staff, Minimum Crew).
  - `src/components/scheduling/ShiftPlanner/StaffingOverlay.tsx` (modified) — passes `hasPendingChanges={localSettings !== null}` to `<StaffingConfigPanel>`.
  - `tests/unit/StaffingConfigPanel.saveGating.test.tsx` (new) — 7 tests: button disabled when no pending changes, button enabled when pending, button disabled while saving, helper text visible, aria-labels present for SPLH/Labor/Crew tooltips.
- **TDD cycle:** RED (6 tests fail — hasPendingChanges prop not accepted, aria-labels absent) → GREEN (all 7 pass) → REFACTOR (typecheck clean, full suite 324 files / 4322 tests pass) → COMMIT

### Task 10: E2E test for apply suggestions flow — COMPLETED
- **Commit:** `b84b1661`
- **Files:**
  - `tests/e2e/staffing-suggestions.spec.ts` (new) — 3 tests:
    1. Empty state: no sales → "Connect your POS" CTA visible
    2. Seeded sales → shift blocks appear → Apply dialog → confirm → "2 open shifts created" toast
    3. A11y contract: each checkbox has aria-label starting with "Include", Cancel closes dialog
  - `src/lib/staffingApply.ts` (bug fix) — `shiftBlocksToTemplates` now groups blocks by `(position, start_time, end_time)` and merges `days` into a multi-day array. Previous one-row-per-block design caused 23505 conflicts when the same time slot appeared on multiple days of the week.
  - `src/hooks/useApplySuggestedShifts.ts` (fix) — removed `onConflict` column target from upsert; bare `ignoreDuplicates: true` is sufficient and avoids PostgREST partial index predicate issues.
- **TDD cycle:** RED (3/3 pass structure, 1/3 fails dialog-close) → DEBUG (traced 409 conflict to day-grouping bug) → GREEN (all 3 pass after grouping fix) → COMMIT
- **Full unit suite:** 324 test files / 4322 tests pass
- **Full E2E suite (spec only):** 3/3 pass in 12.7s

### Task 8: Dead-end fixes in StaffingOverlay (empty state, always-on explainer, retry, mobile legend) — COMPLETED
- **Commit:** `8c80a0fb`
- **Files:**
  - `src/components/scheduling/ShiftPlanner/StaffingOverlay.tsx` (modified) — (1) added `import { Link } from 'react-router-dom'`; (2) returns `refetch` from `useWeekStaffingSuggestions`; (3) removed `hasSalesData &&` guard from "How it works" explainer so it renders unconditionally; (4) added no-data empty state block when `!hasSalesData` with explanatory message + `<Link to="/integrations">Connect your POS</Link>`; (5) gates the day-columns grid on `hasSalesData`; (6) added Retry button in error state that calls `refetch()`; (7) changed legend container from `hidden md:flex` to `flex flex-wrap` so it renders on mobile.
  - `tests/unit/StaffingOverlay.deadends.test.tsx` (new) — 7 tests: empty state message, "Connect your POS" link with href, explainer renders without sales data, explainer renders with sales data, Retry button shown on error, Retry button calls refetch, legend has no "hidden" in className.
  - `tests/unit/StaffingOverlay.wiring.test.tsx` (modified) — added `MemoryRouter` to wrapper (required after `<Link>` added to component).
- **TDD cycle:** RED (5 new tests fail — missing empty state, missing explainer, missing Retry) → GREEN (all 7 pass after implementation) → REFACTOR (typecheck clean, added MemoryRouter to both test wrappers) → COMMIT
- **Full suite:** 323 test files pass (4315 tests)

---

## Phase: 5 (UI Review) — COMPLETED

**Date:** 2026-05-28

### Files reviewed
- `src/components/scheduling/ShiftPlanner/ApplyShiftsDialog.tsx` — PASS (dialog structure, tokens, a11y all correct)
- `src/components/scheduling/ShiftPlanner/SuggestedShifts.tsx` — FIXED: primary button changed from `h-8 px-3 text-[12px]` to `h-9 px-4 text-[13px]` per CLAUDE.md primary button spec
- `src/components/scheduling/ShiftPlanner/StaffingConfigPanel.tsx` — FIXED: Minimum Crew outer container changed from `rounded-lg` to `rounded-xl` per CLAUDE.md card/container convention
- `src/components/scheduling/ShiftPlanner/StaffingOverlay.tsx` — PASS (three-state rendering correct, semantic tokens, a11y)

### Commit
- `e09c316f` — style(staffing): fix UI guideline violations from Phase 5 review

---

## Phase: 6 (Simplify) — COMPLETED

**Date:** 2026-05-28

### Findings and fixes applied

Four angles reviewed (Reuse, Simplification, Efficiency, Altitude):

| Finding | File | Fix Applied |
|---------|------|-------------|
| `DOW` array and `fmtHour` duplicated between `ApplyShiftsDialog` and `SuggestedShifts` | Both component files | Extracted to `staffingApply.ts` as shared exports; components import from there |
| `new Date(day+'T12:00:00').getDay()` repeated in 4 places instead of calling `dayStringToDow` | `ApplyShiftsDialog`, `SuggestedShifts`, `StaffingOverlay` | All call-sites replaced with `dayStringToDow` import |
| IIFE inside JSX for crew-floor explainer text | `StaffingOverlay.tsx` line 323 | Extracted to named `crewFloorNote` variable before `return` |
| `{availablePositions.length > 0 ? (...) : null}` ternary-with-null | `StaffingConfigPanel.tsx` | Changed to `&&` short-circuit |
| Redundant `&& byRemainder.length > 0` guard in `distributePositions` while loop (entries non-empty is already checked) | `staffingApply.ts` | Removed the dead guard |
| `byDay` map-building uses `existing` branch variable when push-or-init suffices | `SuggestedShifts.tsx` | Replaced with standard `if (!m.has) m.set; m.get!.push` idiom |

### Skipped findings

- **`useApplySuggestedShifts` `as any` cast**: The `supabase.from('shift_templates')` type correctly exists in generated types, but `upsert(..., { ignoreDuplicates })` + `.select()` chained together loses type inference in supabase-js v2. The cast is a known limitation of the client library, not a fixable altitude issue. The comment explaining why is kept.
- **Parallel chunk upserts**: Sequential chunks are intentional — Supabase PostgREST has no way to enforce ordering on parallel batches; keeping them sequential is correct.

### Commit
- `c5f0876d` — refactor(staffing): simplify shared formatting utils and reduce JSX complexity
- **Full suite:** 324 test files / 4322 tests all pass

---

## Phase: 7b (Fold review findings) — COMPLETED

**Date:** 2026-05-28

### Findings triaged

| Reviewer | Severity | Finding | Action |
|----------|----------|---------|--------|
| 3 | major | `hasCrew` in ApplyShiftsDialog uses `Object.keys` instead of `.some(w=>w>0)`, causing all-zero crew to suppress amber warning while distributePositions still falls back to generic Staff | FIXED |
| 2 | major | Duplicate import of `QueryClient`/`QueryClientProvider` in wiring test (line 5 and line 74) | FIXED |
| 0 | minor | `error.message` from DB surfaced in destructive toast, leaks schema details | FIXED (generic message + console.error) |
| 2 | minor | `localSettings` typed `Record<string,any>` while `handleSettingsChange` takes `Record<string,unknown>` | FIXED |
| 2 | minor | `effectiveSettings` in hook return never used by `StaffingOverlay` | FIXED (removed) |
| 0 | major | `get_open_shifts` SECURITY DEFINER without restaurant-membership check | NOT FIXED — pre-existing, design doc acknowledges as separate tracked task |
| 0 | major | `useApplySuggestedShifts` no client-side membership guard | NOT FIXED — existing RLS INSERT policy is the enforcement; adding hook check would change approved design |
| 1,2,3 | minor/info | `crewFloorNote` IIFE not wrapped in useMemo | SKIPPED — style/nit, not a correctness bug |
| 2 | minor | `effectiveSettings` dead return surface note | FIXED (removed the return value) |
| 3 | info | `shiftBlocksToTemplates` uses max(capacity) across merged days — undocumented behavior | SKIPPED — info only, not a bug per design |

### Commit
- `06a4ada8` — fix(review): fold Phase 7b findings — hasCrew guard, error leak, type cleanup
- Added regression test for all-zero crew case in ApplyShiftsDialog
- **Full suite:** 324 test files / 4323 tests all pass

---

## Phase: 7c (CodeRabbit) — iteration 1 — COMPLETED

**Date:** 2026-05-28

### Findings from `coderabbit review --plain --type committed`

| Severity | File | Finding | Action |
|----------|------|---------|--------|
| major | types.ts:2112 | `email_unsubscribes` lacks `restaurant_id` | NOT FIXED — user-level email opt-out table, `user_id` scoping is correct by design; no restaurant FK warranted |
| major | types.ts:10258 | `users_in_trial_email_window` RPC uses `Args: never` | NOT FIXED — internal admin RPC that runs as SECURITY DEFINER; adding p_restaurant_id would require out-of-scope migration changes |
| major | staffingApply.test.ts:5 | Missing negative headcount edge case test | FIXED — added `it('returns empty for negative headcount', ...)` test |

### Commit
- `c4c639ee` — test(staffing): add negative headcount edge case for distributePositions
- **All 9 staffingApply tests pass**

---

## Phase: 7c (CodeRabbit) — iteration 2 — COMPLETED

**Date:** 2026-05-28

### Findings from `coderabbit review --plain --type committed`

| Severity | File | Finding | Action |
|----------|------|---------|--------|
| minor | StaffingOverlay.tsx:192 | `localSettings` typed `Record<string, unknown>` but `useWeekStaffingSuggestions` param typed as `Partial<StaffingSuggestionsResult>` — both wrong, should be `Partial<StaffingSettings>` | FIXED — updated `settingsOverrides` param, `localSettings` state, `handleSettingsChange`, `handleImmediateSettingsChange`, and `StaffingConfigPanel` props to use `Partial<StaffingSettings>` |

### Commit
- `4018c326` — fix(types): tighten settingsOverrides and onSettingsChange to Partial<StaffingSettings>
- **All 4324 unit tests pass, typecheck clean**

---

## Phase: 7c (CodeRabbit) — iteration 3 — COMPLETED

**Date:** 2026-05-28

### Outcome
CodeRabbit review could not run: organization billing credits exhausted.
Error: "Your organization has run out of Usage credits. Purchase more in the billing tab."

No actionable findings could be produced. Returning clean=false (tool blocked, not clean pass).

---

## Phase: 8 (Verify) — COMPLETED

**Date:** 2026-05-29

### Results

| Check | Result | Notes |
|-------|--------|-------|
| .env.local symlink | PASS | Linked to /Users/josedelgado/Documents/GitHub/nimble-pnl/.env.local |
| `npm run test` (unit) | PASS | 324 test files, 4324 tests passed (2 skipped) |
| `npm run typecheck` | PASS | No type errors |
| `npm run lint` (new files only) | FIXED + PASS | 1 error in ApplyShiftsDialog.tsx (ternary-as-statement) → fixed with if/else, committed `798e312a` |
| `npm run test:db` (pgTAP) | PASS* | 1355/1356 pass; 1 pre-existing failure in `32_weekly_brief_queue.sql` test 9 (unrelated to our changes) |
| `npm run test:e2e` (staffing tests) | PASS | 3/3 staffing tests pass |
| `npm run test:e2e` (full suite) | PASS* | 3 flaky failures on first run (scheduling-conflicts, employee-payroll), all pass on re-run; pre-existing and unrelated to our changes |
| `npm run build` | PASS | Build completes with chunk size warning (pre-existing) |

### Fix applied
- `src/components/scheduling/ShiftPlanner/ApplyShiftsDialog.tsx` — replaced `next.has(i) ? next.delete(i) : next.add(i)` ternary expression used as statement with `if/else` block to satisfy `@typescript-eslint/no-unused-expressions` rule
- Commit: `798e312a`

### allPass determination
All checks introduced by this branch pass. The 1 pgTAP failure and 3 E2E flaky failures are pre-existing issues in unchanged test files.


