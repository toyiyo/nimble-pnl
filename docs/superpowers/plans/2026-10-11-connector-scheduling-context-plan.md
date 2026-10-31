# Connector Scheduling Context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the MCP connector the scheduling data that the Scheduling page shows: conflict flags on shifts, and a new `get_scheduling_context` tool with roster, availability, time off, coverage, pending items, publish state, and labor items.

**Architecture:** A new SECURITY INVOKER RPC `get_shift_conflicts` calls the two existing conflict functions for each shift in a window. Pure builders in `supabase/functions/_shared/` produce each section. The page labor code moves to `supabase/functions/_shared/labor/`, and `src/` imports it from there, so one copy of each rule exists. `ai-execute-tool` wires the tool. `mcpHandler.ts` gets the title and the instructions.

**Tech Stack:** Postgres (pgTAP), Deno edge functions, TypeScript, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-11-connector-scheduling-context-design.md` (commits 90ac52f7, f9354200). Read it with this plan.

## Global Constraints

- Write every comment, commit message, and PR text in STE-aligned English (`docs/STE100_STYLE.md`).
- Run all commands in `/Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/connector-scheduling-context`.
- Stage explicit paths only. Never `git add -A`. Never commit `progress.md`. Never commit to `main`.
- No RLS change. No new table. New SQL functions are SECURITY INVOKER with `SET search_path = public, pg_catalog`.
- `REVOKE ALL ... FROM PUBLIC, anon; GRANT EXECUTE ... TO authenticated;` for each new function.
- Every query selects explicit columns. No `select('*')` in new code.
- Every query filters by `restaurant_id` and the period in SQL, not in JavaScript.
- Tool text stays below `MAX_TOOL_TEXT_CHARS = 40_000` (`mcpHandler.ts:40`).
- A failed gate gives `{ hidden: true, reason }`. A failed load gives `{ unavailable: true, reason }`. Never return a masked `$0` as a real value.
- Gates: `view:pay_rates` for pay; `view:pos_sales` for sales; `edit:scheduling` for the full trade and claim lists.
- Code that `src/` and Deno share lives in `supabase/functions/_shared/` and uses relative imports with a `.ts` suffix. `src/` imports it as `src/hooks/useScheduledLaborCosts.tsx:11` does.
- Production database: SELECT only. No writes.

## Review Focus

1. A user without `view:pos_sales` calls `get_scheduling_context`. Expect: no sales RPC runs, and every sales item is `hidden`. (Task 7 tests that the RPC mock gets no call.)
2. A chef without `edit:scheduling` calls the tool. Expect: `pending.trades` and `pending.claims` are `hidden`, not an empty list. (Task 6.)
3. A restaurant with 40 employees and a 31-day period, with a different window on each weekday. Expect: valid JSON below 40,000 chars, and `roster`, `availability`, `time_off`, `conflicts` are never deleted. (Task 6 and Task 8.)
4. A shift that ends at local midnight on the day before an approved day off. Expect: no time-off conflict. (Task 1 pgTAP.)
5. A week with zero POS sales and a percent labor entry. Expect: the budget uses the break-even fallback, or `hasBudget: false`, the same as the page. (Task 5.)

---

### Task 1: SQL RPC `get_shift_conflicts`

**Files:**
- Create: `supabase/migrations/20261011120000_get_shift_conflicts.sql`
- Test: `supabase/tests/get_shift_conflicts.sql`

**Interfaces:**
- Produces: `public.get_shift_conflicts(p_restaurant_id uuid, p_start timestamptz, p_end timestamptz) RETURNS TABLE (shift_id uuid, conflict_type text, source text, status text, message text)`. `conflict_type` is `time_off` or `availability`. `source` is `exception` or `recurring` for availability, else NULL. `status` is the time-off status, else NULL.

- [ ] **Step 1: Write the failing pgTAP test.** Copy the fixture style of `supabase/tests/timeoff_conflict_local_tz.sql` (fixed UUIDs, delete-before-insert, `America/Chicago`). Use `SELECT plan(14);` and these checks:
  1. `has_function('public','get_shift_conflicts', ARRAY['uuid','timestamp with time zone','timestamp with time zone'])`.
  2. An approved time-off day with a shift on it gives one `time_off` row with `status = 'approved'`.
  3. A pending request gives one `time_off` row with `status = 'pending'`.
  4. A denied request gives no row.
  5. Two overlapping requests give two `time_off` rows for the shift.
  6. A shift that ends at 00:00 local time on the day before an approved day off gives no row.
  7. An `availability_exceptions` row with `is_available = false` gives `conflict_type = 'availability'`, `source = 'exception'`.
  8. A recurring `employee_availability` window that excludes the shift gives `source = 'recurring'`.
  9. An exception that makes the day available overrides a recurring unavailable row: no row.
  10. A `cancelled` shift gives no row. 11. A `completed` shift gives no row.
  12. An open shift (`employee_id IS NULL`) gives no row.
  13. A window of 40 days returns zero rows.
  14. `ok(NOT has_function_privilege('anon', 'public.get_shift_conflicts(uuid,timestamptz,timestamptz)', 'EXECUTE'))`.
  Add a second block with RLS on: `SET LOCAL role authenticated;` and `set_config('request.jwt.claims', ...)` for a member of restaurant A. Call with restaurant B id: expect zero rows. Copy the JWT setup from an existing RLS pgTAP test (`grep -l "request.jwt.claims" supabase/tests | head -1`). Raise the plan count to 15.

- [ ] **Step 2: Run it and see it fail.** Run: `npm run test:db -- supabase/tests/get_shift_conflicts.sql`. Expected: FAIL, function does not exist.

- [ ] **Step 3: Write the migration.**

```sql
-- get_shift_conflicts: time-off and availability conflicts for every live
-- shift of one restaurant in one window. The rules stay in
-- check_timeoff_conflict and check_availability_conflict. SECURITY INVOKER,
-- so RLS on shifts and on the source tables applies to the caller.
CREATE OR REPLACE FUNCTION public.get_shift_conflicts(
  p_restaurant_id uuid, p_start timestamptz, p_end timestamptz)
RETURNS TABLE (shift_id uuid, conflict_type text, source text,
               status text, message text)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_catalog
AS $$
  WITH s AS (
    SELECT id, employee_id, restaurant_id, start_time, end_time
    FROM shifts
    WHERE restaurant_id = p_restaurant_id
      AND start_time >= p_start AND start_time < p_end
      AND employee_id IS NOT NULL
      AND status NOT IN ('cancelled', 'completed')
      AND p_end - p_start <= interval '32 days'
  )
  SELECT s.id, 'time_off'::text, NULL::text, t.status,
         format('Time off %s (%s to %s)', t.status, t.start_date, t.end_date)
  FROM s CROSS JOIN LATERAL
       check_timeoff_conflict(s.employee_id, s.start_time, s.end_time) t
  WHERE t.has_conflict
  UNION ALL
  SELECT s.id, 'availability'::text, a.conflict_type, NULL::text, a.message
  FROM s CROSS JOIN LATERAL
       check_availability_conflict(s.employee_id, s.restaurant_id,
                                   s.start_time, s.end_time) a
  WHERE a.has_conflict;
$$;

REVOKE ALL ON FUNCTION public.get_shift_conflicts(uuid, timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_shift_conflicts(uuid, timestamptz, timestamptz) TO authenticated;
```

- [ ] **Step 4: Run the test and see it pass.** Run: `npm run db:reset && npm run test:db -- supabase/tests/get_shift_conflicts.sql`. Expected: all pass. Also run `npm run test:db -- supabase/tests/timeoff_conflict_local_tz.sql` and the `availability_conflict_*.sql` files. Expected: pass with no change.

- [ ] **Step 5: Commit.**

```bash
git add supabase/migrations/20261011120000_get_shift_conflicts.sql supabase/tests/get_shift_conflicts.sql
git commit -m "feat(db): add get_shift_conflicts for the connector"
```

### Task 2: Shared shift warnings (overlap and clopen)

**Files:**
- Create: `supabase/functions/_shared/shiftWarnings.ts`
- Modify: `src/lib/shiftValidator.ts:32-92`
- Test: `tests/unit/shiftWarnings.test.ts`; existing `tests/unit/shiftValidator.test.ts` must pass with no change.

**Interfaces:**
- Produces:

```ts
export const MIN_REST_HOURS = 8;
export interface WarnShift { id: string; employee_id: string | null; start_time: string; end_time: string; status: string }
export interface ShiftWarning { shift_id: string; type: 'overlap' | 'clopen'; rule: 'editor'; other_shift_id: string; rest_hours?: number }
export function intervalsOverlap(aStartMs: number, aEndMs: number, bStartMs: number, bEndMs: number): boolean; // a.start < b.end && b.start < a.end
export function restHoursBetween(endMs: number, nextStartMs: number): number; // 0 when gap <= 0
export function findShiftWarnings(shifts: WarnShift[]): ShiftWarning[];
```

- [ ] **Step 1: Write the failing test** `tests/unit/shiftWarnings.test.ts`. Import from `../../supabase/functions/_shared/shiftWarnings`. Cases:
  - Two shifts of one employee, 09:00–17:00 and 16:00–22:00: one `overlap` warning on each shift.
  - 15:00–23:00 then 06:54–14:00 next day (7.9 h): `clopen` with `rest_hours` 7.9.
  - 15:00–23:00 then 07:00–15:00 next day (8.0 h): no warning.
  - A cancelled shift in either role: no warning.
  - Shifts of two different employees that overlap: no warning.
  - A shift that ends at 00:00 and a shift at 06:00 the same morning: `clopen`, 6.0 h.
  - `employee_id: null`: skipped.

- [ ] **Step 2: Run it.** `npx vitest run tests/unit/shiftWarnings.test.ts`. Expected: FAIL, module not found.

- [ ] **Step 3: Implement.** `findShiftWarnings` groups non-cancelled shifts with an `employee_id` by employee, sorts by `start_time`, and checks each pair (i < j) with `intervalsOverlap`. For a pair that does not overlap, it computes `restHoursBetween(earlier.end, later.start)` and adds `clopen` to the later shift when `0 < rest < MIN_REST_HOURS`. Round `rest_hours` to one decimal. Then change `src/lib/shiftValidator.ts`: delete the local `MIN_REST_HOURS` and import `MIN_REST_HOURS` from `'../../supabase/functions/_shared/shiftWarnings'`. Keep `validateShift` output the same.

- [ ] **Step 4: Run tests.** `npx vitest run tests/unit/shiftWarnings.test.ts tests/unit/shiftValidator.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add supabase/functions/_shared/shiftWarnings.ts src/lib/shiftValidator.ts tests/unit/shiftWarnings.test.ts
git commit -m "feat(connector): share the overlap and clopen rules"
```

### Task 3: `hasPosSalesCapability` and `hasCapability` helpers

**Files:**
- Modify: `supabase/functions/_shared/tools-registry.ts` (next to `hasPayRatesCapability`, L1148)
- Test: `tests/unit/toolsRegistryCapabilities.test.ts` (create)

**Interfaces:**
- Produces: `export async function hasPosSalesCapability(restaurantId: string, supabase: CapabilityCheckClient): Promise<boolean>` and `export async function hasEditSchedulingCapability(restaurantId: string, supabase: CapabilityCheckClient): Promise<boolean>`. Both call `callCapabilityRpc` with the exact strings `'view:pos_sales'` and `'edit:scheduling'`. Both log with `console.error` and return false on an RPC error.

- [ ] **Step 1: Write the failing test.** Mock `supabase.rpc`. Cases for each function: returns true when `data: true`; false when `data: false`; false and one `console.error` call when `error` is set; false when `rpc` throws; `rpc` gets `{ p_restaurant_id, p_capability: 'view:pos_sales' }` (or `'edit:scheduling'`).
- [ ] **Step 2: Run.** `npx vitest run tests/unit/toolsRegistryCapabilities.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Copy the body of `hasPayRatesCapability`, change the capability string and the log label.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit.**

```bash
git add supabase/functions/_shared/tools-registry.ts tests/unit/toolsRegistryCapabilities.test.ts
git commit -m "feat(connector): add pos_sales and edit:scheduling checks"
```

### Task 4: Conflict flags in `get_schedule_overview`

**Files:**
- Create: `supabase/functions/_shared/shiftConflictFlags.ts`
- Modify: `supabase/functions/ai-execute-tool/index.ts:2264-2335` (`executeGetScheduleOverview`)
- Modify: `supabase/functions/_shared/tools-registry.ts:280-310` (description only)
- Test: `tests/unit/shiftConflictFlags.test.ts`

**Interfaces:**
- Consumes: `get_shift_conflicts` (Task 1), `findShiftWarnings` (Task 2).
- Produces:

```ts
export interface ConflictRow { shift_id: string; conflict_type: 'time_off' | 'availability'; source: string | null; status: string | null; message: string }
export interface ShiftConflict { type: 'time_off' | 'availability' | 'overlap' | 'clopen'; rule: 'grid' | 'editor'; source?: string; status?: string; message: string }
export function buildConflictIndex(rows: ConflictRow[], warnings: ShiftWarning[]): Map<string, ShiftConflict[]>;
export function attachConflicts<T extends { id: string }>(shifts: T[], index: Map<string, ShiftConflict[]>): { shifts: (T & { conflicts?: ShiftConflict[] })[]; conflictedShiftCount: number };
export async function loadShiftConflicts(supabase: any, restaurantId: string, startIso: string, endIso: string): Promise<ConflictRow[]>; // throws on RPC error
```

- [ ] **Step 1: Write the failing test.** Cases: RPC rows and warnings merge into one list for each shift; RPC rows get `rule: 'grid'`; warnings get `rule: 'editor'` and a message such as `Only 6.5 h of rest after the previous shift`; a shift without conflicts has no `conflicts` key; `conflictedShiftCount` counts shifts, not rows; `loadShiftConflicts` calls `rpc('get_shift_conflicts', { p_restaurant_id, p_start, p_end })` and throws `Failed to fetch shift conflicts: <msg>` on error. Add a size test: 31 days, 25 employees, 2 shifts each per day, conflicts on 20% of shifts; `JSON.stringify` of the overview data stays below 40,000 chars. If it does not, drop `notes` and `employee.position` from the shift rows in the overview and assert again.
- [ ] **Step 2: Run.** `npx vitest run tests/unit/shiftConflictFlags.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the helper. In `executeGetScheduleOverview`:
  - Change the select to explicit columns: `'id, employee_id, start_time, end_time, break_duration, position, status, is_published, locked, shift_template_id, employee:employees(id, name, position)'`.
  - Add `loadShiftConflicts(supabase, restaurantId, bounds.start.toISOString(), new Date(bounds.end.getTime() + 1).toISOString())` to the `Promise.all`.
  - Exclude `status === 'cancelled'` shifts from `scheduledCostInputs`, as `costedShifts` in `Scheduling.tsx` does.
  - Run `findShiftWarnings(shifts)`, `buildConflictIndex`, `attachConflicts`, then `groupShiftsByRestaurantDay`.
  - Add `conflicted_shift_count` to `data`, and add `{ table: 'shifts', summary: 'N shifts with conflicts' }` to `evidence`.
  - Change the registry description: "Each shift lists its conflicts: time off and availability (shown on the schedule grid), and overlap and short rest (checked in the shift editor)."
- [ ] **Step 4: Run.** `npx vitest run tests/unit/shiftConflictFlags.test.ts tests/unit/scheduleOverview.test.ts tests/unit/aiExecuteToolRestaurantDayWiring.test.ts`. Expected: PASS. Run `npm run typecheck`.
- [ ] **Step 5: Commit.**

```bash
git add supabase/functions/_shared/shiftConflictFlags.ts supabase/functions/ai-execute-tool/index.ts supabase/functions/_shared/tools-registry.ts tests/unit/shiftConflictFlags.test.ts
git commit -m "feat(connector): show conflict flags in the schedule overview"
```

### Task 5: Move the page labor rules to `_shared/labor/`

**Files:**
- Create: `supabase/functions/_shared/labor/breakEven.ts`, `laborBudget.ts`, `dailyLaborPercent.ts`, `staffingGuardrail.ts`
- Modify: `src/lib/breakEvenCalculator.ts`, `src/lib/monthlyBreakEvenProgress.ts`, `src/lib/parseLocalDate.ts`, `src/lib/dailyLaborPercent.ts`, `src/lib/staffingCalculator.ts`, `src/hooks/useScheduleLaborBudget.ts`
- Test: existing `tests/unit/breakEvenCalculator*.test.ts`, `monthlyBreakEvenProgress.test.ts`, `dailyLaborPercent.test.ts`, `staffingCalculator.test.ts`, `useScheduleLaborBudget.test.ts`, `useBreakEvenAnalysis.test.ts` pass with no change. New: `tests/unit/laborEdgeCases.test.ts`.

**Interfaces:**
- Produces (same names and signatures as today):
  - `breakEven.ts`: `calculateBreakEven`, `calculateMonthlyProgress`, `formatMonthlyCurrency`, `parseLocalDate`, and the types they need (`OperatingCost`, `BreakEvenData`, `CostBreakdownItem`, copied from `src/types/operatingCosts.ts`; `src/types/operatingCosts.ts` re-exports them).
  - `laborBudget.ts`: `calculateLaborBudget(scheduledTotal, costs, breakEvenData)` and `LaborBudgetData`, `BudgetTier`, `BudgetSource`.
  - `dailyLaborPercent.ts`: `computeDailyLaborPercent`, `projectDailySales`, `formatDailyLaborPercent`, `describeDailyLaborPercent`, `dayStringToDow`, `MAX_SHOWN_LABOR_PERCENT = 999`.
  - `staffingGuardrail.ts`: `DEFAULT_HOURLY_RATE_CENTS = 1500`, `computeAvgHourlyRateCents`, `hasHourlyWageData`, `checkLaborGuardrail`, `impliedLabor`. Type the employee input as a minimal local interface `{ status?: string; compensation_type?: string; hourly_rate?: number | null; is_active?: boolean }` that matches the fields that the functions read.

- [ ] **Step 1: Write the failing edge-case test** `tests/unit/laborEdgeCases.test.ts`, which imports only from `../../supabase/functions/_shared/labor/*`. Cases: `projectDailySales` excludes today and weekdays with total ≤ 0; `computeDailyLaborPercent` gives null when projected sales are 0, caps the shown text at `>999%`, and sets over-target with `Math.round(percent) > target`; `calculateBreakEven` fills missing sales dates with 0 in the average; `calculateLaborBudget` with a percent entry and avgDailySales 0 uses the break-even fallback, and with both 0 gives `hasBudget: false`; tiers at 79.9, 80, 100, 100.1; `computeAvgHourlyRateCents` with no paid hourly employee gives 1500 and `hasHourlyWageData` false; `checkLaborGuardrail` is strict `>`.
- [ ] **Step 2: Run.** Expected: FAIL, modules not found.
- [ ] **Step 3: Move the code.** Cut each pure function into the new file. Change `@/` imports to relative `.ts` imports. Import `date-fns` by its bare name (Deno maps it in `supabase/functions/deno.json`). In each old `src/` file, keep the export names with `export { ... } from '../../supabase/functions/_shared/labor/<file>';`. Keep non-pure code (hooks, React) in `src/`.
- [ ] **Step 4: Run.** `npx vitest run tests/unit/laborEdgeCases.test.ts tests/unit/breakEvenCalculator.test.ts tests/unit/breakEvenCalculator.monthlyProgress.test.ts tests/unit/monthlyBreakEvenProgress.test.ts tests/unit/dailyLaborPercent.test.ts tests/unit/staffingCalculator.test.ts tests/unit/useScheduleLaborBudget.test.ts tests/unit/useBreakEvenAnalysis.test.ts tests/unit/useDailyLaborPercent.test.tsx`. Expected: PASS. Run `npm run typecheck` and `deno check supabase/functions/_shared/labor/*.ts`.
- [ ] **Step 5: Commit.**

```bash
git add supabase/functions/_shared/labor/breakEven.ts supabase/functions/_shared/labor/laborBudget.ts supabase/functions/_shared/labor/dailyLaborPercent.ts supabase/functions/_shared/labor/staffingGuardrail.ts src/lib/breakEvenCalculator.ts src/lib/monthlyBreakEvenProgress.ts src/lib/parseLocalDate.ts src/lib/dailyLaborPercent.ts src/lib/staffingCalculator.ts src/hooks/useScheduleLaborBudget.ts src/types/operatingCosts.ts tests/unit/laborEdgeCases.test.ts
git commit -m "refactor(labor): share the page labor rules with the edge functions"
```

### Task 6: Section builders for `get_scheduling_context`

**Files:**
- Create: `supabase/functions/_shared/schedulingContext.ts`
- Test: `tests/unit/schedulingContext.test.ts`

**Interfaces:**
- Consumes: `convertRecurringToLocal`, `convertExceptionsToLocal` (`_shared/availability-tz.ts`); `computeHourBudget` (`_shared/schedule-prompt-builder.ts:184`); `ShiftConflict` (Task 4).
- Produces (pure functions, no I/O):

```ts
export function buildRoster(employees, shifts, recurringByEmployee, period): RosterEntry[];
// RosterEntry: { id, name, position, area, employment_type, is_minor, scheduled_hours, shift_count, missing_availability, max_weekly_hours, max_weekly_hours_note: 'stored, not enforced' }
export function buildAvailability(employees, recurringRows, exceptionRows, tz): AvailabilityEntry[];
// AvailabilityEntry: { employee_id, weekly: { [dow 0-6]: { start, end } | 'unavailable' } | 'not_set', notes?, exceptions: { date, start?, end?, available, reason? }[] }
export function buildConflictList(shifts, index: Map<string, ShiftConflict[]>, tz): ConflictListEntry[];
export function buildTimeOff(requests): TimeOffEntry[]; // { employee_id, start_date, end_date, status, reason, blocks_scheduling }
export function buildCoverage(templates, shifts, settings, weekPublished: Record<string, boolean>, period): Coverage;
export function buildPending(trades | Hidden, claims | Hidden, pendingTimeOff): Pending;
export function buildPublishState(weeks, publishedShiftWeeks: Set<string>, publicationWeeks: Set<string>): { week_start: string; state: 'published' | 'draft' }[];
export function fitToLimit(ctx: SchedulingContext, limit: number): SchedulingContext & { truncated?: true; omitted_sections?: string[] };
export const DROPPABLE_SECTIONS = ['labor.staffing_suggestions', 'publish_state', 'coverage', 'pending'] as const;
```

- [ ] **Step 1: Write the failing test.** Cases:
  - Roster: `scheduled_hours` excludes cancelled shifts and subtracts `break_duration`; `missing_availability` is true for an active employee with only an exception, and false with one recurring row (the predicate of `src/hooks/useEmployeesMissingAvailability.ts`); a minor gets `max_weekly_hours` from `computeHourBudget`.
  - Availability: a recurring row appears once in `weekly`, not once for each date; an exception in the period appears in `exceptions`; an exception outside the period is not present; an employee with no rows has `weekly: 'not_set'`; an overnight recurring window keeps its local times.
  - Time off: `approved` and `pending` have `blocks_scheduling: true`; `denied` and `cancelled` are not returned.
  - Coverage: open spots = capacity minus assigned non-cancelled shifts for each template and date (`computeOpenShiftCount`, `src/pages/Scheduling.tsx:177`); `can_broadcast_open_shifts` is true only when the week is published AND `open_shifts_enabled`.
  - Pending: a `Hidden` input stays `{ hidden: true, reason: 'needs edit:scheduling' }`; time off has `scope: 'all pending requests, not only this period'`.
  - Publish state: published only when both sets contain the week.
  - `fitToLimit`: build a context with 40 employees, 31 days, a different window on each weekday, one exception for each employee each week, and large coverage and pending sections. Result: `JSON.stringify` length < 40,000, valid JSON, `roster`, `availability`, `time_off`, `conflicts` present, `omitted_sections` follows `DROPPABLE_SECTIONS` order, and `truncated: true` only when a section is deleted.
- [ ] **Step 2: Run.** `npx vitest run tests/unit/schedulingContext.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** each builder to pass its cases. Read the column names from the spec section 2 and from `src/hooks/useEmployeesMissingAvailability.ts` and `src/pages/Scheduling.tsx:177-196`.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit.**

```bash
git add supabase/functions/_shared/schedulingContext.ts tests/unit/schedulingContext.test.ts
git commit -m "feat(connector): build the scheduling context sections"
```

### Task 7: Labor section with gates

**Files:**
- Create: `supabase/functions/_shared/schedulingContextLabor.ts`
- Test: `tests/unit/schedulingContextGates.test.ts`

**Interfaces:**
- Consumes: Task 3 checks; Task 5 labor modules; `loadScheduledLaborCost` (`_shared/labor/scheduledLaborCost.ts:143`); `recommendForSlots`, `minStaffFromCrew` (`_shared/hourlyStaffing.ts`).
- Produces:

```ts
export interface LaborGates { payRates: boolean; posSales: boolean }
export async function loadLaborSection(supabase: any, restaurantId: string, period: { start: string; end: string; today: string; tz: string }, gates: LaborGates, settings: StaffingSettings | null): Promise<LaborSection>;
// LaborSection: { scheduled_labor, daily_labor_percent, labor_budget, staffing_suggestions } — each item is a value, { hidden: true, reason }, or { unavailable: true, reason }.
```

- Loads (each only when its gate passes):
  - Scheduled labor: `loadScheduledLaborCost`. Return `total`, `hidden_cost_count`, `is_average_high`, the same values as `ScheduleMetricsRibbon.tsx:55,186`.
  - Lookback sales: `get_hourly_sales_pattern` with `p_view: 'by_date'`, `p_interval_minutes: 60`, the lookback range of `lookbackSalesQueryOptions` (`src/hooks/useWeekStaffingSuggestions.ts:155`).
  - Break-even: `restaurant_operating_costs` (explicit columns), `get_daily_sales_totals` from `min(today − 13 days, start of month)` to today, and the utility query of `src/hooks/useBreakEvenAnalysis.ts:71-94`. Feed them to `calculateBreakEven`.
  - Hourly sales for staffing: `get_hourly_sales_pattern` at 60 minutes over `lookback_weeks`, then `recommendForSlots`.

- [ ] **Step 1: Write the failing test.** Use a mock `supabase` that records every `rpc` name and every `from` table. Cases:
  - `posSales: false`: no call to `get_hourly_sales_pattern` or `get_daily_sales_totals`; `daily_labor_percent`, `staffing_suggestions`, and a percent-entry `labor_budget` are `hidden`.
  - `payRates: false`: no call to `loadScheduledLaborCost`'s employee load; `scheduled_labor`, `daily_labor_percent`, `labor_budget`, and `staffing_suggestions.labor` are `hidden`; `staffing_suggestions.hours` (headcount only) is present when `posSales` is true.
  - Both true: values equal the outputs of the Task 5 functions for the same fixtures.
  - `settings: null`: `daily_labor_percent` and `staffing_suggestions` are `unavailable` with reason `no staffing settings`.
  - An RPC error on sales: that item is `unavailable`; the other items still load.
  - `has_wage_data: false`: `staffing_suggestions.labor.rate_note` says the rate is the 1500-cent default.
- [ ] **Step 2: Run.** `npx vitest run tests/unit/schedulingContextGates.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Check the gates before each load. Run the allowed loads in one `Promise.all`. Catch each load error into `{ unavailable: true, reason }`.
- [ ] **Step 4: Run.** Expected: PASS. Run `npm run typecheck`.
- [ ] **Step 5: Commit.**

```bash
git add supabase/functions/_shared/schedulingContextLabor.ts tests/unit/schedulingContextGates.test.ts
git commit -m "feat(connector): add gated labor items to the scheduling context"
```

### Task 8: Wire `get_scheduling_context` into `ai-execute-tool` and the registry

**Files:**
- Modify: `supabase/functions/_shared/tools-registry.ts` (new definition after L310; `CAPABILITY_GATED_TOOLS` at L1065)
- Modify: `supabase/functions/ai-execute-tool/index.ts` (new `executeGetSchedulingContext` after `executeGetScheduleOverview`; new case after L3901)
- Test: `tests/unit/getSchedulingContext.test.ts`

**Interfaces:**
- Consumes: Tasks 3, 4, 6, 7.
- Produces: tool `get_scheduling_context` with params `restaurant_id` (required), `start_date`, `end_date` (YYYY-MM-DD, optional). `CAPABILITY_GATED_TOOLS = ['get_labor_costs', 'get_schedule_overview', 'get_hourly_sales', 'get_scheduling_context']`.

- [ ] **Step 1: Write the failing test.** Export `executeGetSchedulingContext` for test, or test through the exported builder `buildSchedulingContextResult(raw, gates, tz, period)` if the file does not export handlers (check how `tests/unit/aiExecuteToolRestaurantDayWiring.test.ts` tests the handlers and follow it). Cases:
  - No dates: the period is the current restaurant week (Monday to Sunday, restaurant time zone).
  - 32 days: `{ ok: false, error: { code: 'INVALID_ARGUMENTS' } }`.
  - `end_date` before `start_date`: `INVALID_ARGUMENTS`.
  - Without `edit:scheduling`: no query to `shift_trades` or `open_shift_claims`; both are `hidden`.
  - Every `from(...)` call uses `.eq('restaurant_id', id)` and a `.select` string without `*`.
  - The result text is below 40,000 chars for the 40-employee fixture of Task 6.
  - `isCapabilityGatedTool('get_scheduling_context')` is true.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** In one `Promise.all`, load: the capability checks (pay_rates, pos_sales, edit:scheduling); employees (`id, name, position, area, employment_type, is_minor, date_of_birth, status, is_active`, active only, limit 500); shifts in the window (explicit columns); `loadShiftConflicts`; `employee_availability` (limit 2000); `availability_exceptions` with `date` in the period (limit 2000); `time_off_requests` that overlap the period with status in approved and pending (limit 1000); pending time-off count; `shift_templates` (active); `staffing_settings`; `schedule_publications` for the weeks; trades and claims with status `pending_approval` (only when edit:scheduling passes). Then call the Task 6 builders, `loadLaborSection`, and `fitToLimit(ctx, MAX_TOOL_TEXT_CHARS - 2000)`. Return `{ ok: true, data, evidence }`. Add the registry definition with a description in plain words: "Everything the Scheduling page shows for a period: roster, availability, time off, conflicts, coverage, pending requests, publish state, and labor targets. Call it before you propose or change a schedule."
- [ ] **Step 4: Run.** `npx vitest run tests/unit/getSchedulingContext.test.ts tests/unit/mcpHandler.test.ts`. Expected: PASS. `npm run typecheck`. `deno check supabase/functions/ai-execute-tool/index.ts`.
- [ ] **Step 5: Commit.**

```bash
git add supabase/functions/_shared/tools-registry.ts supabase/functions/ai-execute-tool/index.ts tests/unit/getSchedulingContext.test.ts
git commit -m "feat(connector): add the get_scheduling_context tool"
```

### Task 9: Connector text

**Files:**
- Modify: `supabase/functions/_shared/mcpHandler.ts:57` (`MCP_TOOL_TITLES`), `:92` (`INSTRUCTIONS`)
- Test: `tests/unit/mcpHandler.test.ts`

- [ ] **Step 1: Write the failing test.** Add: `tools/list` includes `get_scheduling_context` with title `Get scheduling context`; `instructions` match `/get_scheduling_context before you propose or change a schedule/`; `instructions` match `/editor/` (the text says the grid does not show overlap and short-rest flags). The existing directory-rule test (L114) must still pass, so keep model instructions out of tool descriptions.
- [ ] **Step 2: Run.** `npx vitest run tests/unit/mcpHandler.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Add `get_scheduling_context: 'Get scheduling context',` to `MCP_TOOL_TITLES`. Append to `INSTRUCTIONS`: `' Call get_scheduling_context before you propose or change a schedule. Time off and availability conflicts show on the schedule grid. Overlap and short-rest flags are editor rules: the grid does not show them.'`
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit.**

```bash
git add supabase/functions/_shared/mcpHandler.ts tests/unit/mcpHandler.test.ts
git commit -m "feat(connector): tell Claude to read the scheduling context first"
```

### E2E gate

No browser UI changes. The connector is an MCP endpoint, not a page. Exception: Task 1 (pgTAP, with RLS) and Tasks 2–9 (Vitest) cover the change. Phase 8 must also run `npm run test`, `npm run test:db`, `npm run typecheck`, `npm run lint`, and `npm run build`.
