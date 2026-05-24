# AI Chat: Time-Punch Access

**Date:** 2026-05-24
**Branch:** `feature/ai-chat-time-punches`
**Status:** Design

## Problem

A user asked the in-app AI chat: "Who worked the 2.09 labor hours logged this month?" The AI returned the correct aggregate total but could not name specific employees. It then fell back to an unrelated tool (`get_inventory_transactions`) and surfaced an inventory event by employee UUID, confusing the conversation further. Verbatim quote from the chat transcript:

> "However, this is related to inventory usage, not labor hours. It seems I'm unable to directly link specific time punches to employee names with the current tools."

## Root cause

The `get_labor_costs` tool (`supabase/functions/ai-execute-tool/index.ts` `executeGetLaborCosts`) already fetches `time_punches` and `employees` and computes per-employee hours per day *internally* via `calculateActualLaborCost` in `supabase/functions/_shared/laborCalculations.ts`. But the tool response only returns:

- Aggregate `breakdown` per compensation type (hourly / salary / contractor / daily_rate)
- `daily_costs` per day across all employees
- `employee_breakdown` populated with just the *config* of active employees (id, name, position, compensation_type) — **no hours, no costs per employee**

So the AI sees totals and a roster but cannot map punches → employees. There is also no tool that returns individual time-punch records joined to employee names.

## Goals

1. Let the AI answer "who worked X hours this period?" without hallucinating or falling back to wrong tools.
2. Let the AI drill into individual shifts: "show me the actual punches on May 16–17."
3. Restrict per-employee labor data to manager + owner roles (matches the existing `view:time_punches` capability gate).
4. Reuse existing `parseWorkPeriods` / `calculateActualLaborCost` math — do not duplicate punch-parsing logic.
5. Keep the fix small enough to ship in one PR.

## Non-goals

- An MCP server (Model Context Protocol). See **Decided trade-offs** below.
- AI-driven punch editing / creation (write surface deferred).
- Per-employee tip allocation (already lives in `get_tip_summary`).
- Per-employee manual payments allocation (already in `get_payroll_summary`).
- Raw-punch debug output (one row per `clock_in`/`clock_out`/`break_*`). The tool returns parsed work periods.

## Approach

Two small, composable changes:

1. **Enhance `get_labor_costs.employee_breakdown`** — populate it with `total_hours`, `total_cost`, `days_worked`, `hours_per_day` per employee (manager+owner only). The aggregate response shape stays identical so existing tests are not broken at the top level.
2. **Add `get_time_punches` tool** — returns parsed work periods (clock-in/clock-out pairs with computed hours and breaks deducted) joined to employee name/position, filterable by employee, position, date range, and minimum hours.

Both rely on a new shared helper `calculateHoursPerEmployee` extracted from the existing `calculateActualLaborCost` logic. This keeps a single source of truth for punch parsing and per-day cost math.

## Architecture

### File map

| File | Change |
|---|---|
| `supabase/migrations/<ts>_idx_time_punches_restaurant_punch_time.sql` | **New.** `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_time_punches_restaurant_punch_time ON public.time_punches (restaurant_id, punch_time);` The existing schema has separate `idx_time_punches_restaurant` and `idx_time_punches_time` indexes but no composite, and both new code paths (`get_labor_costs` and `get_time_punches`) filter by `restaurant_id` + a `punch_time` range. Ship the index with the query that needs it. |
| `supabase/functions/_shared/laborCalculations.ts` | Export `calculateHoursPerEmployee(employees, timePunches, startDate, endDate)`. Refactor `calculateActualLaborCost` to call it instead of inlining the per-employee map. |
| `supabase/functions/_shared/tools-registry.ts` | Update `get_labor_costs` description; add `get_time_punches` tool definition (manager+owner only); add `get_time_punches` to `canUseTool` allow-list. |
| `supabase/functions/ai-execute-tool/index.ts` | Populate per-employee fields in `executeGetLaborCosts` (role-gated — closes a pre-existing leak; see below). Add `executeGetTimePunches`. Wire into switch. Narrow the `employees` projection from `select('*')` to the explicit columns the helper needs. |
| `supabase/functions/ai-chat-stream/index.ts` | Append two bullet lines to the system prompt — point the LLM at the new capability so it stops falling back to inventory tools. |
| `tests/unit/laborCalculations.calculateHoursPerEmployee.test.ts` | New unit test (UTC fixtures) covering mixed hourly/salary/break punches across 3 employees / 5 days, plus a UTC-boundary case (`2026-05-16T00:30:00Z` buckets to `2026-05-16`). |
| `tests/unit/ai-tools-date-resolution.test.ts` | Extend with `get_time_punches` period values. |
| `tests/unit/permissions.test.ts` | Gate test for `get_time_punches` covering kiosk / staff / chef / collaborator_accountant / collaborator_inventory / collaborator_chef → false, and manager / owner → true. |

### Pre-existing leak being closed in this PR

The current `executeGetLaborCosts` returns `employee_breakdown` (id, name, position, compensation_type — no hours) to **every** role when `include_employee_breakdown:true` is requested. That leaks employee names to staff / kiosk / chef and to all three collaborator roles. The reviewer flagged this as a live bug that must be patched in the same PR as the original gap fix; we are no longer relying on "role< manager → empty hours but config rows still visible." The new behaviour is `employee_breakdown: null` for any role below manager — config rows included.

### Tool: `get_labor_costs` (existing — minimal change)

Top-level response shape unchanged. When `include_employee_breakdown=true` AND the user role is manager or owner, each row in `employee_breakdown` gets four new fields:

```jsonc
{
  "employee_id": "uuid",
  "employee_name": "Jose Delgado",
  "position": "Manager",
  "compensation_type": "salary",

  // new fields:
  "total_hours": 1.05,                  // sum of punch-derived hours in the period
  "total_cost_cents": 1047,             // hourly: rate × hours; salary/contractor: pro-rated for days worked
  "days_worked": 2,                     // count of distinct dates with hours > 0
  "hours_per_day": { "2026-05-16": 0.55, "2026-05-17": 0.50 }
}
```

For staff / kiosk / chef / collaborator_accountant / collaborator_inventory / collaborator_chef, `employee_breakdown` is `null` even when requested (current behaviour leaks config rows; we tighten it to null — see "Pre-existing leak being closed in this PR" above). The evidence array always carries exactly one row for this tool; when the role caused per-employee fields to be stripped, the row's `summary` includes the phrase `per-employee breakdown role-restricted`. We do not conditionally append a second row.

### Tool: `get_time_punches` (new)

**Definition (manager+owner only):**

```jsonc
{
  "name": "get_time_punches",
  "description": "List individual work periods (clock-in/clock-out pairs with computed hours) for a date range. Use this to answer 'who worked when' and to drill into specific shifts. Returns parsed work periods, not raw punch events. Manager+owner only.",
  "parameters": {
    "type": "object",
    "properties": {
      "period": {
        "type": "string",
        "enum": ["today", "yesterday", "week", "last_week", "month", "last_month", "custom"]
      },
      "start_date": { "type": "string", "format": "date" },
      "end_date":   { "type": "string", "format": "date" },
      "employee_id": { "type": "string", "description": "Filter to one employee" },
      "position":    { "type": "string", "description": "Filter to one position (e.g., 'Server')" },
      "min_hours":   { "type": "number", "description": "Drop periods shorter than this (default 0)" },
      "limit":       { "type": "integer", "description": "Max rows (default 50, max 200)", "default": 50 }
    },
    "required": ["period"]
  }
}
```

**Response shape:**

```jsonc
{
  "ok": true,
  "data": {
    "period": "month",
    "start_date": "2026-05-01",
    "end_date":   "2026-05-31",
    "total_periods": 2,
    "total_hours":   1.05,
    "work_periods": [
      {
        "employee_id":   "uuid",
        "employee_name": "Jose Delgado",
        "position":      "Manager",
        "date":          "2026-05-16",
        "start_time":    "2026-05-16T18:30:00.000Z",
        "end_time":      "2026-05-16T19:03:00.000Z",
        "hours":         0.55,
        "cost_cents":    548     // null for non-hourly compensation_types — see below
      }
      // … up to `limit` rows, sorted by start_time DESC
    ]
  },
  "evidence": [
    { "table": "time_punches", "summary": "N punches parsed into M work periods from <start> to <end>" }
  ]
}
```

**`cost_cents` semantics:** Only meaningful for hourly compensation (`hourly_rate × hours`). For `salary`, `contractor`, and `daily_rate`, the per-period cost is not well-defined (salary is monthly-prorated; daily_rate is a flat day total regardless of hours), so `cost_cents` is `null` in those rows. The LLM is told (in the system prompt) to cite `get_labor_costs` for compensation totals when a row has a null `cost_cents`.

### Shared helper: `calculateHoursPerEmployee`

```ts
export interface EmployeeHoursSummary {
  employee_id: string;
  employee_name: string;
  position: string | null;
  compensation_type: CompensationType;
  total_hours: number;            // sum across the period
  total_cost_cents: number;       // computed via existing per-day cost rules
  days_worked: number;            // distinct dates with hours > 0
  hours_per_day: Record<string, number>;  // 'YYYY-MM-DD' → hours
  work_periods: WorkPeriod[];     // parseWorkPeriods output for the period
}

export function calculateHoursPerEmployee(
  employees: Employee[],
  timePunches: TimePunch[],
  startDate: Date,
  endDate: Date,
): EmployeeHoursSummary[];
```

The existing `calculateActualLaborCost` is refactored to call this helper internally (single source of truth for `parseWorkPeriods` per employee and per-day hours aggregation). Aggregate output is unchanged.

### System prompt addition

Append to the existing prompt in `ai-chat-stream/index.ts` after the existing labor-related guidance:

```
LABOR / TIME PUNCH QUERIES (manager+owner):
- "Who worked X hours this period?" / "Who worked on date Y?" → call get_labor_costs with include_employee_breakdown:true. Cite each named employee's total_hours from the response.
- "Show me the punches on May 16" / "List shifts last week" → call get_time_punches with the date range. Each row is one work period (clock-in to clock-out, breaks deducted).
- Do NOT use get_inventory_transactions to answer questions about employee work — that table is about product movement, not labor.
```

### Role gating

| Tool / Field | kiosk | staff | chef | collab_accountant | collab_inventory | collab_chef | manager | owner |
|---|---|---|---|---|---|---|---|---|
| `get_labor_costs` aggregate | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `get_labor_costs.employee_breakdown` (per-employee hours) | ❌ (null) | ❌ (null) | ❌ (null) | ❌ (null) | ❌ (null) | ❌ (null) | ✅ | ✅ |
| `get_time_punches` | ❌ (not in tool list) | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |

Implementation: `getTools()` in `tools-registry.ts` only includes `get_time_punches` for manager/owner, so the LLM never sees it for lower roles. `canUseTool` mirrors that and is already invoked at the dispatch site (`ai-execute-tool/index.ts:3435`), so any call to `get_time_punches` from a lower role returns "Permission denied" before reaching the handler.

For `get_labor_costs` the tool itself stays open to all roles (aggregate totals are valuable to staff). The per-employee field stripping inside `executeGetLaborCosts` is a defense-in-depth second layer: the handler receives `userRestaurant.role` (a new parameter — already in scope at the dispatcher, just not currently plumbed into handlers) and returns `employee_breakdown: null` for any role below manager, even if `include_employee_breakdown:true` was requested.

**Unified permission-denied shape.** Today the dispatcher's `canUseTool` rejection returns one shape and an in-handler rejection returns another. We standardise both on the dispatcher's existing shape so the LLM can recognise the failure mode consistently:

```jsonc
{
  "ok": false,
  "error": {
    "code": "TOOL_PERMISSION_DENIED",
    "message": "<tool_name> requires manager or owner role",
    "tool": "<tool_name>",
    "required_role": "manager"
  }
}
```

This applies to both the dispatcher-level rejection of `get_time_punches` for a low-role user and any defense-in-depth rejection inside handlers.

### `employees` query projection

The current `executeGetLaborCosts` runs `supabase.from('employees').select('*')` and then only uses a handful of columns. We narrow to exactly what the helper needs:

```ts
select('id, name, position, compensation_type, hourly_rate, salary_cents, contractor_rate_cents, daily_rate_cents, is_active')
```

This stays in scope of this PR because the new helper requires a stable, documented input shape — adding columns implicitly via `*` makes the contract fragile.

## Data flow

```
User: "Who worked the 2.09 hours this month?"
  → ai-chat-stream
  → LLM emits tool_call: get_labor_costs(period: 'month', include_employee_breakdown: true)
  → ai-execute-tool
    → canUseTool('get_labor_costs', role)  // dispatcher gate — allows all roles
    → executeGetLaborCosts(args, ..., role)
      → fetch time_punches  (filter: restaurant_id + punch_time range
                            → hits new composite idx_time_punches_restaurant_punch_time)
      → fetch employees     (select 'id, name, position, compensation_type,
                            hourly_rate, salary_cents, contractor_rate_cents,
                            daily_rate_cents, is_active' — no SELECT *)
      → calculateActualLaborCost (existing aggregate)
      → calculateHoursPerEmployee (new: per-employee rollup)
      → if role < manager: employee_breakdown = null  // closes the pre-existing name leak
    → response with named hours (or null breakdown for low roles)
  → LLM: "Jose Delgado (Manager): 1.05h on May 16-17; Alejandra Perez (Manager): 1.04h on May 17. Total 2.09h."
```

Drill-down path:

```
User: "Show me the actual punches"
  → ai-chat-stream
  → LLM emits tool_call: get_time_punches(period: 'month')
  → executeGetTimePunches → calculateHoursPerEmployee → flatten work_periods → sort+limit
  → response with named work periods
```

## Error handling

Same patterns as existing handlers:
- Date-resolution mirrors `calculateDateRange` (already covered by `ai-tools-date-resolution.test.ts`).
- Empty result: `ok: true, data: { total_periods: 0, work_periods: [] }` — never invent rows.
- Supabase query error: throw with table name + message (existing handler convention).
- Role-gating violation: dispatcher and handler both return the unified `TOOL_PERMISSION_DENIED` shape described in **Role gating** above.

## Timezone discipline

Lesson [2026-05-03]: `startOfWeek` / `startOfDay` are host-TZ-dependent. The existing `calculateActualLaborCost` already uses `formatDateLocal` (host TZ) for the daily bucket. We adopt the same convention in `calculateHoursPerEmployee` so the per-employee `hours_per_day` keys match `daily_costs[].date` exactly. Both `get_labor_costs` and `get_time_punches` therefore inherit the existing (known) TZ behaviour — a separate audit/PR can move both to restaurant-TZ if desired, but that is explicitly out of scope for this fix.

Test fixtures use UTC anchors (`new Date(Date.UTC(...))`) so CI (UTC) and local (PT) agree.

## Testing strategy

### Unit tests (Vitest)

1. **`tests/unit/laborCalculations.calculateHoursPerEmployee.test.ts` (new)**
   - 3 employees, 5-day window, mixed compensation types (hourly, salary, contractor).
   - Includes break punches (verify breaks are NOT counted in `total_hours`).
   - Includes one employee with no punches (returns 0 hours, not omitted).
   - Verifies `hours_per_day` keys match daily-cost keys.
   - **UTC boundary case**: a punch with `punch_time = '2026-05-16T00:30:00Z'` and an early clock-out at `'2026-05-16T01:00:00Z'` must bucket to `'2026-05-16'` in `hours_per_day`, matching the existing daily-cost convention.
   - UTC fixtures (lesson 2026-05-03).

2. **`tests/unit/ai-tools-date-resolution.test.ts` (extend)**
   - Add period values for `get_time_punches`: today, yesterday, week, last_week, month, last_month, custom.

3. **`tests/unit/permissions.test.ts` (extend)**
   - Add `get_time_punches` to the per-role allow/deny table.
   - Cover the three collaborator roles (`collaborator_accountant`, `collaborator_inventory`, `collaborator_chef`) → all deny.
   - Cover the dispatcher-level and handler-level rejection paths returning the same `TOOL_PERMISSION_DENIED` shape.

### Manual smoke test (Phase 8)

Use the existing local Supabase + edge-function dev stack:
1. Sign in as manager (Russo's test restaurant).
2. Open AI chat, ask "Who worked this month?" → response cites named employees with hours.
3. Ask "Show me the punches on <date>" → response lists work periods with start/end times.
4. Sign in as staff → confirm `get_time_punches` is not exposed and `employee_breakdown` returns null.

### Out of scope for this PR

- E2E (Playwright) test for the AI chat tool round-trip — the OpenRouter dependency makes it flaky; existing chat tests are similarly scoped.
- pgTAP tests — no SQL schema changes.

## Decided trade-offs

### MCP server (rejected for this PR)

Considered exposing the new capability via an MCP (Model Context Protocol) server instead of bespoke tools. Rejected because:

- The in-app chat client (`ai-chat-stream`) calls OpenRouter, which speaks OpenAI function-calling schemas natively — not MCP. An MCP server in between would just be re-translated to the same JSON schema that `tools-registry.ts` already emits.
- The current tools share an auth boundary with the data (Supabase JWT → RLS). An MCP server adds a second auth surface (per-restaurant PATs or OAuth scopes), which is more code, not less.
- MCP's value is portability across LLM clients (Claude Desktop, Cursor, ChatGPT GPTs). For the embedded chat surface, that portability buys nothing.

**Forward-compatibility:** The shared helper `calculateHoursPerEmployee` extracts the logic from the tool router, so a future MCP server would be: a small Deno HTTP service that implements `tools/list` + `tools/call`, wraps the same helper, and accepts per-restaurant PAT auth. None of that work is undone by shipping this fix first. A separate spec will be filed when the MCP product is prioritized.

### Manager+owner gate (vs. all roles)

Per-employee labor data is treated as PII-adjacent (matches the existing `view:time_punches` capability). Aggregate labor totals stay available to all roles — a kiosk asking "how much labor today?" still gets a number, just not names.

### Work periods (vs. raw punches)

Raw punches would let the LLM debug missing/duplicate clock-outs but require it to do the parsing itself. We've already paid the cost of building `parseWorkPeriods`; surfacing its output directly is more useful for the 95% case ("who worked when"). A future `include_raw_punches:true` flag can be added without breaking the work-period shape.

### Two tools (vs. one big tool with flags)

One tool with both aggregate + raw output would have a more complex response schema and force the LLM to choose between modes via flag. Two tools keeps each schema small, lets the LLM pick by name, and keeps tool descriptions tight (a known driver of correct tool selection across the multi-model fallback list).

### Period enum: no `quarter` / `year` (yet)

The reviewer asked whether `get_time_punches` should accept `quarter` and `year`. Deferred: the same coverage is already reachable via `period: 'custom'` with explicit `start_date` / `end_date`, and the existing `get_labor_costs` enum doesn't carry those values either — adding them here without aligning the rest of the tool surface would create a one-off inconsistency. If a future workflow needs them often enough to justify the LLM hint, extend both tools together.

## Open questions

None blocking. Future considerations captured in **Decided trade-offs**.
