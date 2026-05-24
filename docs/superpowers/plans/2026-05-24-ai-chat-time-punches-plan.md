# AI Chat: Time-Punch Access — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-05-24-ai-chat-time-punches-design.md`
**Branch:** `feature/ai-chat-time-punches`
**Goal:** Let the AI chat answer "who worked X hours?" and "show the punches" without falling back to inventory tools. Reuses existing `parseWorkPeriods` / `calculateActualLaborCost` math; closes a pre-existing per-employee name leak in `executeGetLaborCosts`; adds a composite index to keep the new query patterns fast.

**Architecture:**
- A new shared helper `calculateHoursPerEmployee` in `supabase/functions/_shared/laborCalculations.ts` extracts the per-employee per-day hours rollup that `calculateActualLaborCost` already computes internally.
- `executeGetLaborCosts` is enhanced to (a) populate per-employee `total_hours` / `total_cost_cents` / `days_worked` / `hours_per_day` when role ≥ manager, (b) return `employee_breakdown: null` for every lower role (closes the pre-existing name leak), and (c) narrow the `employees` projection from `select('*')` to explicit columns.
- A new tool `get_time_punches` returns parsed work periods (one row per clock-in/clock-out pair, breaks deducted, joined to employee name/position) for the manager/owner roles only.
- A new SQL migration adds `idx_time_punches_restaurant_punch_time` (composite on `restaurant_id, punch_time`) so both new code paths hit an index.
- Dispatcher-level (`canUseTool`) and handler-level role rejections are unified on a single `TOOL_PERMISSION_DENIED` response shape.
- The `ai-chat-stream` system prompt gets three new bullets pointing the LLM at the right tool and warning it off `get_inventory_transactions` for labor questions.

**Tech Stack:** TypeScript, Deno (Supabase Edge Functions), Vitest, PostgreSQL.

---

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/20260524120000_idx_time_punches_restaurant_punch_time.sql` | **NEW.** Adds composite index `idx_time_punches_restaurant_punch_time ON public.time_punches (restaurant_id, punch_time)`. |
| `supabase/functions/_shared/laborCalculations.ts` | **MODIFY.** Add `EmployeeHoursSummary` type and `calculateHoursPerEmployee(employees, timePunches, startDate, endDate)`. Refactor `calculateActualLaborCost` to call it (no behaviour change to aggregate output). |
| `supabase/functions/_shared/tools-registry.ts` | **MODIFY.** Update `get_labor_costs` description, add `get_time_punches` tool definition (manager+owner only), add `get_time_punches` to `canUseTool` allow-list. |
| `supabase/functions/ai-execute-tool/index.ts` | **MODIFY.** Narrow `employees` projection; thread `userRole` into `executeGetLaborCosts`; populate per-employee fields when role ≥ manager and force `employee_breakdown: null` otherwise. Add `executeGetTimePunches` and wire into switch. Replace bare `throw` permission rejection with structured `TOOL_PERMISSION_DENIED` response. |
| `supabase/functions/ai-chat-stream/index.ts` | **MODIFY.** Append three bullets to the system prompt directing the LLM to the new capability. |
| `tests/unit/laborCalculations.calculateHoursPerEmployee.test.ts` | **NEW.** Pure-function unit tests for the new helper (UTC fixtures, 3 employees / 5 days, break handling, UTC-boundary case, no-punches case). |
| `tests/unit/ai-tools-date-resolution.test.ts` | **MODIFY.** Add `get_time_punches` to the period-resolution coverage. |
| `tests/unit/permissions.test.ts` | **MODIFY.** Add `get_time_punches` per-role table including all three collaborator roles; assert unified `TOOL_PERMISSION_DENIED` shape. |

---

## Task 1: Add the composite index migration

**Spec section:** "File map" → migration row, "Architecture" → composite index note.

**Files:**
- Create: `supabase/migrations/20260524120000_idx_time_punches_restaurant_punch_time.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Composite index on (restaurant_id, punch_time) to support the
-- AI chat get_labor_costs / get_time_punches query pattern.
-- The existing schema has separate idx_time_punches_restaurant and
-- idx_time_punches_time, but both new code paths filter on
-- restaurant_id AND a punch_time range, so a composite is meaningfully faster.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_time_punches_restaurant_punch_time
  ON public.time_punches (restaurant_id, punch_time);
```

- [ ] **Step 2: Verify against local Supabase**

```bash
npm run db:reset   # applies migrations from a clean slate
psql "$LOCAL_DB_URL" -c "\\d public.time_punches" | grep idx_time_punches_restaurant_punch_time
```

The grep must return a row. If the index name differs from the expected one, fix the migration before continuing.

**Acceptance:** Migration applies cleanly on a reset DB, the index is present, the index name matches the expected one, and `npm run typecheck` still passes (no codegen drift).

---

## Task 2: Add `EmployeeHoursSummary` type + `calculateHoursPerEmployee` helper

**Spec section:** "Shared helper: `calculateHoursPerEmployee`".

**Files:**
- Modify: `supabase/functions/_shared/laborCalculations.ts`

- [ ] **Step 1: Add the type**

Add near the existing `WorkPeriod` interface:

```ts
export interface EmployeeHoursSummary {
  employee_id: string;
  employee_name: string;
  position: string | null;
  compensation_type: CompensationType;
  /** Sum of hours across the period, breaks excluded. */
  total_hours: number;
  /** Per-period total cost in cents.
   *  Hourly: hourly_rate × hours per day (snapshot-aware via getEmployeeSnapshotForDate).
   *  Salary / contractor / daily_rate: total for the period using existing distribution rules. */
  total_cost_cents: number;
  /** Distinct dates with hours > 0. */
  days_worked: number;
  /** 'YYYY-MM-DD' → hours that day (host-TZ formatDateLocal). */
  hours_per_day: Record<string, number>;
  /** Raw parseWorkPeriods output, breaks already split. */
  work_periods: WorkPeriod[];
}
```

- [ ] **Step 2: Add the function**

Extract the per-employee rollup logic from `calculateActualLaborCost` into a pure helper. The function must:

1. Iterate `employees`, building `EmployeeHoursSummary` rows whether or not the employee has punches (a zero-hour row preserves the "everyone shows up" guarantee the tests rely on).
2. For each employee, group their punches and call `parseWorkPeriods(punches)` exactly once.
3. For each non-break period, bucket hours under `formatDateLocal(new Date(period.startTime))` (same convention as the existing daily-cost map — critical for key alignment).
4. Compute `total_cost_cents` per employee:
   - Hourly: sum of `calculateEmployeeDailyCostForDate(employee, dateStr, hoursWorked)` per day.
   - Daily rate: sum of `calculateEmployeeDailyCost(snapshot)` for each day with hours > 0.
   - Salary / contractor: reuse the existing per-period distribution from `calculateSalaryForPeriod` / `calculateContractorPayForPeriod` (the same functions `distributeFixedCosts` calls), then divide by the number of active employees of that type so each row gets a meaningful per-employee number that sums back to the aggregate.

```ts
export function calculateHoursPerEmployee(
  employees: Employee[],
  timePunches: TimePunch[],
  startDate: Date,
  endDate: Date,
): EmployeeHoursSummary[];
```

- [ ] **Step 3: Refactor `calculateActualLaborCost` to call the new helper**

Replace the inline `punchesByEmployee` / `hoursPerEmployeePerDay` / `employeesActivePerDay` bookkeeping with a single `calculateHoursPerEmployee` call, then aggregate the daily totals from the helper's `hours_per_day` maps. The exposed return shape (`{ breakdown, dailyCosts }`) must remain byte-identical for the existing tests.

- [ ] **Step 4: Sanity check**

```bash
npm run typecheck
npm run test -- laborCalculations
```

Existing tests must still pass without modification.

**Acceptance:** New helper exported, `calculateActualLaborCost` returns identical output for its existing test fixtures, `npm run typecheck` clean.

---

## Task 3: Unit-test `calculateHoursPerEmployee`

**Spec section:** "Testing strategy" → tests/unit/laborCalculations.calculateHoursPerEmployee.test.ts.

**Files:**
- Create: `tests/unit/laborCalculations.calculateHoursPerEmployee.test.ts`

- [ ] **Step 1: Write the test file**

Use UTC fixtures (`new Date(Date.UTC(...))`) so CI (UTC) and local (PT) agree. Cover:

| Case | Setup | Assertion |
|---|---|---|
| Hourly with breaks | 1 employee, clock_in → break_start → break_end → clock_out, breaks total 30 min | `total_hours` = work span minus 30 min; `hours_per_day` bucket equals `total_hours` |
| Multiple days | 1 employee, 3 distinct dates of punches | `days_worked` = 3; sum of `hours_per_day` values equals `total_hours` |
| Multiple employees | 3 employees, 5-day window | one summary row per employee, including any with zero punches |
| UTC boundary | Punch `2026-05-16T00:30:00Z` → `2026-05-16T01:00:00Z` | `hours_per_day` key is `'2026-05-16'` (matches `formatDateLocal` daily-cost convention) |
| Salary + contractor coexist with hourly | mixed comp types, all with punches | `total_cost_cents` for salary/contractor matches the aggregate's `breakdown.salary.cost` / `breakdown.contractor.cost` divided across active members |
| No punches | 1 employee, empty punches array | row exists, `total_hours = 0`, `days_worked = 0`, `hours_per_day = {}` |

- [ ] **Step 2: Run the tests**

```bash
npm run test -- laborCalculations.calculateHoursPerEmployee
```

**Acceptance:** All new tests pass; `npm run typecheck` clean.

---

## Task 4: Register the `get_time_punches` tool

**Spec section:** "Tool: `get_time_punches`" + "Role gating".

**Files:**
- Modify: `supabase/functions/_shared/tools-registry.ts`

- [ ] **Step 1: Add the tool definition**

In the same place that `get_labor_costs` is declared, add the new tool object using the exact schema from the design doc (period enum without `quarter` / `year`, optional employee_id / position / min_hours / limit). Description verbatim:

> List individual work periods (clock-in/clock-out pairs with computed hours) for a date range. Use this to answer 'who worked when' and to drill into specific shifts. Returns parsed work periods, not raw punch events. Manager+owner only.

- [ ] **Step 2: Gate visibility**

`getTools(projectRef, userRole)` must include `get_time_punches` **only** when `userRole` is `'manager'` or `'owner'`. All other roles (kiosk, staff, chef, collaborator_accountant, collaborator_inventory, collaborator_chef) must not see it in the LLM-facing tool list.

- [ ] **Step 3: Update `canUseTool`**

`canUseTool('get_time_punches', userRole)` returns `true` only for `'manager'` and `'owner'`, `false` for everything else.

- [ ] **Step 4: Update `get_labor_costs` description**

Append to the existing `get_labor_costs.description`: "Set `include_employee_breakdown: true` to get per-employee `total_hours`, `total_cost_cents`, `days_worked`, and `hours_per_day` (manager+owner only)."

**Acceptance:** `npm run typecheck` clean; `getTools` includes the tool for manager/owner only; `canUseTool` table matches the spec.

---

## Task 5: Update `permissions.test.ts` for the new gate

**Spec section:** "Testing strategy" → permissions.test.ts.

**Files:**
- Modify: `tests/unit/permissions.test.ts`

- [ ] **Step 1: Extend the existing per-role allow/deny table** with `get_time_punches`:

| Role | `get_time_punches` |
|---|---|
| `kiosk` | deny |
| `staff` | deny |
| `chef` | deny |
| `collaborator_accountant` | deny |
| `collaborator_inventory` | deny |
| `collaborator_chef` | deny |
| `manager` | allow |
| `owner` | allow |

- [ ] **Step 2: Add a unified-error-shape assertion**

A separate test that invokes a `canUseTool` rejection and the in-handler rejection (mocked) and asserts both produce `{ code: 'TOOL_PERMISSION_DENIED', tool, required_role, message }`. If the handler-level path is not exercisable by a pure unit test (because it requires the dispatcher), assert the shape from a tiny in-file helper that builds the error object both paths share.

- [ ] **Step 3: Run**

```bash
npm run test -- permissions
```

**Acceptance:** New rows pass; the unified shape assertion passes.

---

## Task 6: Implement `executeGetTimePunches`

**Spec section:** "Tool: `get_time_punches`" → Response shape, "Data flow" → drill-down path.

**Files:**
- Modify: `supabase/functions/ai-execute-tool/index.ts`

- [ ] **Step 1: Add the handler**

```ts
async function executeGetTimePunches(
  args: any,
  restaurantId: string,
  supabase: any,
  userRole: string,
): Promise<any> {
  // Defense-in-depth gate (dispatcher should already block, but never trust it):
  if (userRole !== 'manager' && userRole !== 'owner') {
    return {
      ok: false,
      error: {
        code: 'TOOL_PERMISSION_DENIED',
        message: 'get_time_punches requires manager or owner role',
        tool: 'get_time_punches',
        required_role: 'manager',
      },
    };
  }

  const { period, start_date, end_date, employee_id, position, min_hours = 0, limit = 50 } = args;
  const effectiveLimit = Math.min(Math.max(1, Number(limit) || 50), 200);

  const { calculateHoursPerEmployee } = await import('../_shared/laborCalculations.ts');
  const { startDate, endDate, startDateStr, endDateStr } = calculateDateRange(period, start_date, end_date);

  const [punchesResult, employeesResult] = await Promise.all([
    supabase
      .from('time_punches')
      .select('id, employee_id, restaurant_id, punch_time, punch_type')
      .eq('restaurant_id', restaurantId)
      .gte('punch_time', startDate.toISOString())
      .lte('punch_time', endDate.toISOString())
      .order('punch_time', { ascending: true }),
    supabase
      .from('employees')
      .select('id, name, position, compensation_type, hourly_rate, salary_cents, contractor_rate_cents, daily_rate_cents, is_active')
      .eq('restaurant_id', restaurantId),
  ]);

  if (punchesResult.error) throw new Error(`Failed to fetch time punches: ${punchesResult.error.message}`);
  if (employeesResult.error) throw new Error(`Failed to fetch employees: ${employeesResult.error.message}`);

  const allEmployees = employeesResult.data ?? [];
  const filteredEmployees = allEmployees.filter((e: any) =>
    (!employee_id || e.id === employee_id) &&
    (!position   || e.position === position)
  );

  const summaries = calculateHoursPerEmployee(
    filteredEmployees,
    punchesResult.data ?? [],
    startDate,
    endDate,
  );

  // Flatten work_periods → one row per period, joined to employee fields.
  const rows = summaries.flatMap((s) =>
    s.work_periods
      .filter((p) => !p.isBreak && p.hours >= min_hours)
      .map((p) => ({
        employee_id:   s.employee_id,
        employee_name: s.employee_name,
        position:      s.position,
        date:          formatDateLocal(new Date(p.startTime)),
        start_time:    p.startTime.toISOString(),
        end_time:      p.endTime.toISOString(),
        hours:         Number(p.hours.toFixed(2)),
        cost_cents:    s.compensation_type === 'hourly'
          ? Math.round((p.hours / s.total_hours) * s.total_cost_cents) || 0
          : null,
      })),
  );

  rows.sort((a, b) => b.start_time.localeCompare(a.start_time));
  const sliced = rows.slice(0, effectiveLimit);
  const totalHours = Number(sliced.reduce((sum, r) => sum + r.hours, 0).toFixed(2));

  return {
    ok: true,
    data: {
      period,
      start_date: startDateStr,
      end_date:   endDateStr,
      total_periods: sliced.length,
      total_hours:   totalHours,
      work_periods:  sliced,
    },
    evidence: [
      {
        table: 'time_punches',
        summary: `${punchesResult.data?.length ?? 0} punches parsed into ${rows.length} work periods from ${startDateStr} to ${endDateStr}`,
      },
    ],
  };
}
```

Notes for the implementer:
- The `cost_cents` math above prorates the per-employee total back to each period by hours-share. If `total_hours` is 0, `cost_cents` is 0 (won't happen for `hourly` once we filter out break-only periods, but defensive). For non-hourly rows it's explicitly `null` per the spec.
- `formatDateLocal` is imported from `_shared/laborCalculations.ts`. If it isn't already exported, export it.

- [ ] **Step 2: Wire into the switch**

In the dispatch `switch (tool_name)` block, add:

```ts
case 'get_time_punches':
  result = await executeGetTimePunches(args, restaurant_id, supabase, userRestaurant.role);
  break;
```

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```

**Acceptance:** Compiles; new case present; the dispatcher passes `userRestaurant.role` through.

---

## Task 7: Enhance `executeGetLaborCosts` + close the pre-existing leak

**Spec section:** "Tool: `get_labor_costs`", "Pre-existing leak being closed in this PR", "`employees` query projection".

**Files:**
- Modify: `supabase/functions/ai-execute-tool/index.ts`

- [ ] **Step 1: Thread `userRole` into the handler**

Change the signature to:

```ts
async function executeGetLaborCosts(
  args: any,
  restaurantId: string,
  supabase: any,
  userRole: string,
): Promise<any>
```

Update the dispatcher case:

```ts
case 'get_labor_costs':
  result = await executeGetLaborCosts(args, restaurant_id, supabase, userRestaurant.role);
  break;
```

- [ ] **Step 2: Narrow the `employees` projection**

Replace `.select('*')` with:

```ts
.select('id, name, position, compensation_type, hourly_rate, salary_cents, contractor_rate_cents, daily_rate_cents, is_active, status')
```

(`status` is still needed for the existing active-filter on the breakdown.)

- [ ] **Step 3: Populate per-employee fields for manager/owner**

Replace the existing `employeeBreakdown` block:

```ts
const isManagerOrOwner = userRole === 'manager' || userRole === 'owner';
const wantBreakdown = include_employee_breakdown && isManagerOrOwner;

let employeeBreakdown: any[] | null;
if (wantBreakdown) {
  const { calculateHoursPerEmployee } = await import('../_shared/laborCalculations.ts');
  const activeEmployees = employees.filter((e: any) => e.status === 'active');
  const summaries = calculateHoursPerEmployee(activeEmployees, timePunches, startDate, endDate);
  employeeBreakdown = summaries.map((s) => ({
    employee_id:       s.employee_id,
    employee_name:     s.employee_name,
    position:          s.position,
    compensation_type: s.compensation_type,
    total_hours:       Number(s.total_hours.toFixed(2)),
    total_cost_cents:  s.total_cost_cents,
    days_worked:       s.days_worked,
    hours_per_day:     s.hours_per_day,
  }));
} else {
  employeeBreakdown = null;
}
```

- [ ] **Step 4: Adjust the evidence row**

Replace the current pair of evidence rows with exactly one row that adapts based on the gating decision:

```ts
const evidenceSummary =
  include_employee_breakdown && !isManagerOrOwner
    ? `${timePunches.length} time punches from ${startDateStr} to ${endDateStr}; per-employee breakdown role-restricted`
    : `${timePunches.length} time punches from ${startDateStr} to ${endDateStr}`;
// ...
evidence: [
  { table: 'time_punches', summary: evidenceSummary },
],
```

(The previous code returned two rows — one for `time_punches`, one for `employees`. Keeping just the `time_punches` row keeps the evidence array stable for the LLM. If a downstream consumer reads the `employees` row, we'll re-evaluate, but no current consumer does.)

- [ ] **Step 5: Confirm aggregate behaviour unchanged**

```bash
npm run typecheck
npm run test -- laborCalculations   # via the existing aggregate tests
```

**Acceptance:** Manager/owner sees the new fields; staff/kiosk/chef/collaborator_* gets `employee_breakdown: null`; aggregate `breakdown` / `daily_costs` unchanged.

---

## Task 8: Unify the dispatcher's `TOOL_PERMISSION_DENIED` shape

**Spec section:** "Role gating" → "Unified permission-denied shape".

**Files:**
- Modify: `supabase/functions/ai-execute-tool/index.ts`

- [ ] **Step 1: Build the shared error builder**

Add near the top of the dispatch handler:

```ts
function toolPermissionDeniedResponse(toolName: string, requiredRole: string) {
  return {
    ok: false,
    error: {
      code: 'TOOL_PERMISSION_DENIED',
      message: `${toolName} requires ${requiredRole} or higher role`,
      tool: toolName,
      required_role: requiredRole,
    },
  };
}
```

- [ ] **Step 2: Replace the dispatcher throw**

Replace:

```ts
if (!canUseTool(tool_name, userRestaurant.role)) {
  throw new Error(`Permission denied for tool: ${tool_name}`);
}
```

with:

```ts
if (!canUseTool(tool_name, userRestaurant.role)) {
  // Lookup the role required by this tool from the registry helper.
  const requiredRole = requiredRoleFor(tool_name);  // new helper in tools-registry.ts, see Task 4 follow-up
  return new Response(
    JSON.stringify(toolPermissionDeniedResponse(tool_name, requiredRole)),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );
}
```

The 200 status is intentional: the LLM is expected to read the JSON body, not the HTTP status. The pre-existing `TOOL_EXECUTION_ERROR` 500 fallback stays in place for real exceptions.

- [ ] **Step 3: Export `requiredRoleFor` from tools-registry**

Extend `_shared/tools-registry.ts` with a tiny helper that returns the lowest role that can use a given tool (`'manager'` for `get_time_punches`, `'staff'` for the broadly available ones, etc.). For tools that have no role requirement, return `'staff'` (the default minimum).

- [ ] **Step 4: Update `executeGetTimePunches`** (already in place from Task 6) and any other handler-level rejection to use `toolPermissionDeniedResponse(...)`.

**Acceptance:** Both rejection paths produce the same JSON shape; `permissions.test.ts` unified-shape assertion (Task 5) passes.

---

## Task 9: Update the AI system prompt

**Spec section:** "System prompt addition".

**Files:**
- Modify: `supabase/functions/ai-chat-stream/index.ts`

- [ ] **Step 1: Append the labor block**

Find the existing labor-related guidance in the system-prompt string (the long template literal around lines 522-647 per the spec). After the existing labor bullets, insert:

```
LABOR / TIME PUNCH QUERIES (manager+owner):
- "Who worked X hours this period?" / "Who worked on date Y?" → call get_labor_costs with include_employee_breakdown:true. Cite each named employee's total_hours from the response. If employee_breakdown is null, the user's role doesn't allow per-employee detail; answer with the aggregate only.
- "Show me the punches on May 16" / "List shifts last week" → call get_time_punches with the date range. Each row is one work period (clock-in to clock-out, breaks deducted). If a row has cost_cents:null, the employee is salary/contractor/daily_rate — cite the aggregate from get_labor_costs for their pay.
- Do NOT use get_inventory_transactions to answer questions about employee work — that table is about product movement, not labor.
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

**Acceptance:** New bullets present in the prompt; no syntax errors.

---

## Task 10: Extend `ai-tools-date-resolution.test.ts`

**Spec section:** "Testing strategy" → ai-tools-date-resolution.test.ts.

**Files:**
- Modify: `tests/unit/ai-tools-date-resolution.test.ts`

- [ ] **Step 1: Add `get_time_punches` to whatever existing matrix already covers `get_labor_costs`**

For each value in the period enum (`today`, `yesterday`, `week`, `last_week`, `month`, `last_month`, `custom`), assert that `calculateDateRange` resolves the same way `get_labor_costs` does. The point is to lock the two tools to the same date semantics so the LLM can hand off between them without surprises.

- [ ] **Step 2: Run**

```bash
npm run test -- ai-tools-date-resolution
```

**Acceptance:** New cases pass.

---

## Task 11: Phase 4 simplification pass

After Tasks 1-10 land green, run:

- [ ] `Agent` with `subagent_type: code-simplifier` on the worktree diff. Goal: remove duplication between `executeGetLaborCosts.employeeBreakdown` builder and `executeGetTimePunches.summaries` mapping if any emerged; fold any one-shot intermediate variables; confirm no comments contradict the code.
- [ ] Re-run `npm run test`, `npm run typecheck`, `npm run lint`. All green.

**Acceptance:** Simplifier returns either a clean diff or a small set of focused improvements; tests still pass.

---

## Task 12: Phase 7a parallel review

- [ ] Spawn the four Phase 7a reviewers (`security-reviewer`, `sound-logic-reviewer`, `performance-reviewer`, `maintainability-reviewer`) in a single message against the current branch diff.
- [ ] Spawn the codex adversarial reviewer in parallel via `dev-tools/codex-adversarial-review.sh`.
- [ ] Triage findings: fix `critical` / `major` items in this PR; defer `minor` / `nit` with one-line rationale in the PR body.

**Acceptance:** All five reviews complete; critical/major issues addressed or explicitly rejected with reasons.

---

## Task 13: Phase 7b CodeRabbit pre-PR review

- [ ] Push the branch (no PR yet) and trigger a CodeRabbit review against the branch via the existing `/dev` workflow integration.
- [ ] Address any blocking findings.

**Acceptance:** CodeRabbit report clean or any blockers fixed.

---

## Task 14: Phase 8 local verify

- [ ] `npm run typecheck`
- [ ] `npm run lint`
- [ ] `npm run test`
- [ ] `npm run build`
- [ ] Manual smoke: start `npm run dev:full`, sign in as manager in a test restaurant, open AI chat, ask:
  - "Who worked this month?" → response cites named employees with hours, not "I can't link punches".
  - "Show me the punches on <recent date with punches>" → response lists work periods with start/end times.
- [ ] Sign in as a staff/kiosk account → ask the same questions:
  - `get_time_punches` is not visible to the LLM (verify via the `tools-registry` debug or by absence of the call in network tab).
  - `get_labor_costs` with `include_employee_breakdown:true` returns `null` for `employee_breakdown`.

**Acceptance:** All four commands pass; manual smoke confirms the bug-report scenario is resolved and the leak is closed.

---

## Task 15: Phase 9 PR + CI loop + comment triage

- [ ] Push the branch and open a PR titled `feat(ai-chat): per-employee labor + get_time_punches tool`.
- [ ] PR body: link the spec, summarise the two surface changes (`get_labor_costs.employee_breakdown` enhancement; `get_time_punches` new tool), call out the index migration, call out the closed pre-existing name leak, and list the deferred minor reviewer notes with rationale.
- [ ] Wait for CI. If anything fails, fix and push (NEW commits, never `--amend`).
- [ ] **Mandatory Phase 9d:** Even if CI is green, run the inline-comments / issue-comments / PR-level-reviews fetches via `gh api repos/<owner>/<repo>/pulls/<n>/{comments,reviews,issue/comments}` and triage every item. CI green is not Done.

**Acceptance:** PR is green, all review threads addressed, ready for merge by a human reviewer.

---

## Out of scope (explicitly)

- E2E (Playwright) test for the AI chat tool round-trip.
- MCP server (deferred — see spec "Decided trade-offs").
- AI-driven punch editing / creation (write surface).
- Moving the daily-bucket convention from host-TZ `formatDateLocal` to restaurant-TZ.
- Adding `quarter` / `year` to the period enum.

## Risk notes

- **Per-employee cost math for salary / contractor.** The helper splits the period aggregate across active employees of that type. If the active-employee count differs from what `distributeFixedCosts` uses internally (e.g., status filter mismatch), the per-employee number won't exactly sum to the aggregate. Task 3's "Salary + contractor coexist" test must check this invariant explicitly. If it fails, the simpler fix is to expose `total_cost_cents: null` for salary/contractor on the breakdown (mirror the work-period rule) and have the LLM cite the aggregate instead.
- **`select(*)` callers.** The `employees` projection narrowing in Task 7 could break code paths that rely on a column we dropped. Mitigation: only this function changes; the broader `useEmployees` hook uses its own select list. `npm run typecheck` + the existing aggregate test catch most issues.
- **Index migration timing.** `CREATE INDEX CONCURRENTLY` cannot run inside a transaction. If the Supabase migration runner wraps each file in a transaction, switch to `CREATE INDEX IF NOT EXISTS` (non-concurrent). Worth a quick check with `supabase db push --dry-run` on Task 1.
