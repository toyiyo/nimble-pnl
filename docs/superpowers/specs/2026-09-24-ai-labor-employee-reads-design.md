# AI labor tools and AI schedule: read employees through `employees_secure`

## Problem

Two edge functions read pay or contact columns from `public.employees` as the
caller. The caller cannot read these columns, so the reads fail.

- Migration `supabase/migrations/20260806110000_employee_column_gating.sql:126`
  revokes `SELECT` on `public.employees` from `authenticated`. Lines `:128-135`
  grant back only the columns without pay or contact data. `hourly_rate`,
  `salary_amount`, `contractor_payment_amount`, `daily_rate_amount`,
  `daily_rate_reference_weekly`, `email`, `phone` and `date_of_birth` are not
  in that list.
- PostgREST rejects a select or an embed that names a revoked column, with
  `permission denied for column hourly_rate`
  (`tests/unit/employeeEmbedsNarrowed.test.ts:6-9`).

### `ai-execute-tool`

It runs as the caller: the anon key plus the caller's `Authorization` header
(`supabase/functions/ai-execute-tool/index.ts:3484-3488`). These reads ask for
revoked columns:

| Line | Tool | Read |
|---|---|---|
| `index.ts:188-191` | `get_kpis` (labor block) | `.from('employees').select('*')` |
| `index.ts:1944-1947` | `get_labor_costs`, `get_time_punches` (`fetchLaborData`) | `.from('employees').select(EMPLOYEE_LABOR_COLUMNS)` |
| `index.ts:2199` | `get_schedule_overview` | embed `employee:employees(id, name, position, compensation_type, hourly_rate)` |
| `index.ts:2204-2208` | `get_schedule_overview` | `.from('employees').select('*')` |
| `index.ts:2288-2291` | `get_payroll_summary` | `.from('employees').select('*')` |

`EMPLOYEE_LABOR_COLUMNS` (`supabase/functions/_shared/employeeLaborColumns.ts:8-13`)
names `hourly_rate`, `salary_amount`, `contractor_payment_amount` and
`daily_rate_amount`. Each tool throws on the read error (for example
`index.ts:193-195`), and the chat gets an error, not a figure.

### `generate-schedule`

It runs as the caller too (`supabase/functions/generate-schedule/index.ts:71-75`).
It reads `hourly_rate`, `salary_amount` and `date_of_birth` from `employees`
(`:146-150`). So the AI schedule generator also fails.

### Sweep of the other edge functions

These files read `employees` and name `email` or `*`:
`broadcast-open-shifts`, `notify-schedule-published`, `notify-shift-changed`,
`send-shift-notification`, `notify-pin-changed`, `send-team-invitation`,
`send-shift-trade-notification`, `notify-schedule-unpublished`,
`send-time-off-notification`, `_shared/notificationHelpers.ts`,
`_shared/availabilityReminderHandler.ts`. Each read uses a service-role client
(for example `broadcast-open-shifts/index.ts:154-155`,
`notify-schedule-published/index.ts:103-104`). The migration keeps the full
table for `service_role`. So these reads work.

Sweep command (both quote styles):
`grep -rlnE "from\([\"']employees[\"']\)|employees\(" supabase/functions --include=*.ts`,
then a check of the client and the column list of each read.

### User impact

If production has the migration, the five AI labor tools fail for every user,
and the AI schedule generator fails. The AI chat cannot answer a labor,
payroll or schedule question, and `get_kpis` fails. This session has no
production database access (only the local `supabase` MCP, which does not
connect). A check in production is:
`SELECT has_column_privilege('authenticated', 'public.employees', 'hourly_rate', 'SELECT');`
The expected result is `false`.

## Design

### Employee reads

- Add `EMPLOYEE_LABOR_SOURCE = 'employees_secure'` to
  `_shared/employeeLaborColumns.ts`. Change the file comment: every bare token
  must be a column of `employees_secure`. The view has every column in
  `EMPLOYEE_LABOR_COLUMNS` (`20260806110000_employee_column_gating.sql:57-99`).
- The embed `compensation_history:employee_compensation_history(...)` resolves
  on the view: the FK is `employee_compensation_history.employee_id →
  employees(id)` (`20251216093000_add_employee_compensation_history.sql:9`),
  the view exposes `e.id` (`20260806110000:60`), and
  `src/hooks/useEmployees.tsx:40-45` uses the same embed on the view at
  runtime.
- Add `fetchLaborEmployees(supabase, restaurantId, { employeeId?, position?,
  activeOnly? })` to `ai-execute-tool/index.ts`. It reads
  `EMPLOYEE_LABOR_SOURCE` with `EMPLOYEE_LABOR_COLUMNS`. All five reads use it.
  `activeOnly` keeps the `.eq('status', 'active')` filter of
  `get_schedule_overview` (`index.ts:2208`).
- The `select('*')` sites need no other column. The Deno engine reads only the
  fields of its `Employee` type (`_shared/laborCalculations.ts:36-52`), and
  these are in `EMPLOYEE_LABOR_COLUMNS`. `get_payroll_summary` reads `id`,
  `name`, `position`, `compensation_type` and `status` (`index.ts:2338`,
  `:2342-2350`).
- The shift embed changes to `employee:employees(id, name, position)`. The tool
  reads only `name` and `position` from it (`index.ts:2240-2241`).
- `generate-schedule` reads `employees_secure` with its current column list
  plus `is_minor` (`20260806110000:99`). When `date_of_birth` is `NULL` and
  `is_minor` is true, the hour budget is the strictest minor budget
  (`{ is_minor: true, max_weekly_hours: 18 }`,
  `_shared/schedule-prompt-builder.ts:173-177`). The function allows only
  owners and managers (`generate-schedule/index.ts:116`), and both hold
  `view:pay_rates` and `view:employee_pii`. So the fallback is for safety only.

### Behavior change for the `select('*')` sites

`EMPLOYEE_LABOR_COLUMNS` includes the `compensation_history` embed. The three
`select('*')` sites did not load it. `resolveCompensationForDate`
(`_shared/laborCalculations.ts:189-215`) then applies the rate that was in
effect on each day. So `get_kpis` and `get_payroll_summary` can change for an
employee with a rate change in the period. This agrees with `get_labor_costs`
and the pages.

### Masked pay

`employees_secure` returns `NULL` pay unless the caller holds
`view:pay_rates` or the row is the caller's own record
(`20260806110000_employee_column_gating.sql:90-94`, `:103-107`). The
compensation history rows need `view:pay_rates` with no self exception
(`:158-167`). The engine then computes $0 for a masked employee. The AI must
not show that $0 as a real figure.

Who gets the masked case: the builtin Chef role holds `view:scheduling`
(`src/lib/permissions/definitions.ts:217`) but not `view:pay_rates`
(`20260806100000_seed_employee_sensitive_flags.sql:24-30`).
`get_labor_costs` and `get_schedule_overview` accept a `view:scheduling`
caller (`_shared/tools-registry.ts:926`, `:943-987`), and `get_kpis` computes
labor for that caller (`index.ts:113`, `:160`). So every Chef gets the masked
case in three tools. `get_time_punches` and `get_payroll_summary` are manager
and owner only (`tools-registry.ts:880-881`).

- Add `hasPayRatesCapability(restaurantId, supabase)` to
  `_shared/tools-registry.ts`. It calls `user_has_capability` with
  `view:pay_rates`, with the fail-closed pattern of
  `hasSchedulingOrPayrollCapability` (`tools-registry.ts:943-987`).
- The gate is per call. It nulls every figure, the caller's own row too. The
  AI tools do not use the self-row exception. This is intentional: a total
  from one unmasked row is not a restaurant figure.
- The reason text (`PAY_HIDDEN_REASON`): "Pay rates are hidden for your role,
  so labor cost figures are not available."

Fields without the flag:

| Tool | Set to `null` | Keep |
|---|---|---|
| `get_kpis` | labor, prime cost and profitability, through `redactLaborFields` (`_shared/periodMetrics.ts:358-381`) | food cost, sales |
| `get_labor_costs` | `breakdown.{hourly,salary,contractor,daily_rate}.cost`, `breakdown.total`, each `daily_costs[]` `*_cost` and `total_cost`, `employee_breakdown[].total_cost_cents` | hours, employee and day counts |
| `get_time_punches` | each `shifts[].cost_cents` | hours, times |
| `get_schedule_overview` | `projected_labor_costs` (the cost step does not run) | shifts |
| `get_payroll_summary` | `total_gross_pay`, `by_compensation_type.*.cost`, `total_manual_payments` (contractor pay), `total_payroll` | hours, counts, `total_tips`, per-employee `tips` |

Each of these tools adds `pay_hidden: { reason: PAY_HIDDEN_REASON }` when the
flag is missing. Tips stay: they come from `tip_splits`, not from pay rates.

`get_kpis` reason order: pay flag, then the capability, then the day
mismatch. `redactLaborFields` gets an optional `reason` argument. The line
`index.ts:253` picks the reason in that order, and `index.ts:160` also needs
the pay flag, so the labor fetch does not run.

The model must know what `pay_hidden` means. Add one sentence to the
descriptions of the five tools (`tools-registry.ts:58`, `:236`, `:273`,
`:364`, `:407`): "If the result has pay_hidden, tell the user that cost
figures are hidden for their role. Do not report them as $0."

## Tests

- `tests/unit/employeeLaborColumns.test.ts`: `EMPLOYEE_LABOR_SOURCE` is
  `employees_secure`.
- New `tests/unit/aiLaborEmployeeReads.test.ts` (source contract on
  `ai-execute-tool/index.ts` and `generate-schedule/index.ts`):
  - no `.from('employees')` or `.from("employees")` read;
  - no `employees(*)` and no `employees(` embed that names one of the eight
    revoked columns;
  - `fetchLaborEmployees` reads `EMPLOYEE_LABOR_SOURCE`;
  - each of the five labor executors calls `hasPayRatesCapability`.
- `tests/unit/tools-registry.test.ts`: `hasPayRatesCapability` returns the RPC
  result, and false (with a log) on an RPC error or a rejection. Each of the
  five tool descriptions mentions `pay_hidden`.
- New `tests/unit/payHidden.test.ts`: one test per row of the field table,
  for a Chef-shaped caller (scheduling true, pay rates false).
- `tests/unit/periodMetrics.test.ts`: `redactLaborFields` uses a given reason.
- `tests/unit/schedule-hour-budget.test.ts`: a `NULL` date of birth with
  `is_minor` true gives the strictest budget.

## E2E

Justified exception: the AI chat and the schedule generator call OpenRouter,
and CI cannot drive a model to a deterministic tool call. The source-contract
test covers the reads. The runtime evidence for the view embed is
`src/hooks/useEmployees.tsx:40-45`.

## Out of scope

- `daily_labor_allocations.allocated_cost` is readable by any
  `view:scheduling` holder
  (`20260805130000_self_scope_employee_reads.sql:150-157`). That is pay data
  with no `view:pay_rates` gate. A separate task covers it.
- The single-engine work (`docs/superpowers/specs/2026-09-24-single-labor-engine-design.md`
  on branch `claude/sleepy-albattani-gsv9yg`) replaces these tools' engine
  later.
