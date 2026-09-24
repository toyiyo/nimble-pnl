# AI labor tools: read employees through `employees_secure`

## Problem

The AI labor tools read pay columns from `public.employees`. The caller cannot
read these columns, so the reads fail.

- Migration `supabase/migrations/20260806110000_employee_column_gating.sql:126`
  revokes `SELECT` on `public.employees` from `authenticated`. Lines `:128-135`
  grant back only the columns without pay or contact data. `hourly_rate`,
  `salary_amount`, `contractor_payment_amount` and `daily_rate_amount` are not
  in that list.
- `ai-execute-tool` runs as the caller: the anon key plus the caller's
  `Authorization` header (`supabase/functions/ai-execute-tool/index.ts:3484-3488`).
- These reads ask for revoked columns:

| Line | Tool | Read |
|---|---|---|
| `index.ts:188-191` | `get_kpis` (labor block) | `.from('employees').select('*')` |
| `index.ts:1944-1947` | `get_labor_costs`, `get_time_punches` (`fetchLaborData`) | `.from('employees').select(EMPLOYEE_LABOR_COLUMNS)` |
| `index.ts:2199` | `get_schedule_overview` | embed `employee:employees(id, name, position, compensation_type, hourly_rate)` |
| `index.ts:2204-2208` | `get_schedule_overview` | `.from('employees').select('*')` |
| `index.ts:2288-2291` | `get_payroll_summary` | `.from('employees').select('*')` |

- `EMPLOYEE_LABOR_COLUMNS` (`supabase/functions/_shared/employeeLaborColumns.ts:8-13`)
  names `hourly_rate`, `salary_amount`, `contractor_payment_amount` and
  `daily_rate_amount`.
- PostgREST rejects a select or an embed that names a revoked column, with
  `permission denied for column hourly_rate`
  (`tests/unit/employeeEmbedsNarrowed.test.ts:6-9`). Each tool then throws
  (for example `index.ts:193-195`), and the chat gets an error, not a figure.

No other edge function that runs as the caller reads these columns from
`employees`.

### User impact

If production has the migration, each of the five labor tools fails for every
user. The AI chat cannot answer a labor, payroll or schedule question, and the
`get_kpis` call fails, so the chat cannot give the KPI summary either. This
change cannot confirm the production state, because the prod database is not
reachable from this session.

## Design

### Employee reads

- Add `EMPLOYEE_LABOR_SOURCE = 'employees_secure'` to
  `_shared/employeeLaborColumns.ts`. The view has every column in
  `EMPLOYEE_LABOR_COLUMNS` (`20260806110000_employee_column_gating.sql:57-99`).
  `src/hooks/useEmployees.tsx:40-45` reads the view with the same
  `compensation_history:employee_compensation_history(...)` embed, so the
  embed resolves on the view.
- Add a helper in `ai-execute-tool/index.ts`:
  `fetchLaborEmployees(supabase, restaurantId, { employeeId?, position?, activeOnly? })`.
  It reads `EMPLOYEE_LABOR_SOURCE` with `EMPLOYEE_LABOR_COLUMNS`. All five reads
  use it. `activeOnly` keeps the `.eq('status', 'active')` filter of
  `get_schedule_overview` (`index.ts:2208`).
- The `select('*')` sites need no other column. The Deno engine reads only
  fields in `EMPLOYEE_LABOR_COLUMNS` (`tests/unit/employeeLaborColumns.test.ts`).
  `get_payroll_summary` reads `id`, `name`, `position`, `compensation_type` and
  `status` (`index.ts:2342-2349`).
- The shift embed changes to `employee:employees(id, name, position)`. The tool
  reads only `name` and `position` from it (`index.ts:2239-2240`).

### Masked pay

`employees_secure` returns `NULL` pay unless the caller holds
`view:pay_rates` or the row is the caller's own record
(`20260806110000_employee_column_gating.sql:90-94`, `:103-107`). The
compensation history rows also need `view:pay_rates` (`:158-167`). The
engine then computes $0 for a masked employee. The AI must not show that $0
as a real figure.

- Add `hasPayRatesCapability(restaurantId, supabase)` to
  `_shared/tools-registry.ts`. It calls `user_has_capability` with
  `view:pay_rates`, as `hasSchedulingOrPayrollCapability` does
  (`tools-registry.ts:943-987`). It fails closed and logs an RPC error.
- The builtin Owner, Manager, Operations Manager, Accountant and Operations
  Manager (Collaborator) roles hold the flag
  (`20260806100000_seed_employee_sensitive_flags.sql:18-30`). So the masked case
  applies to custom roles only.
- Without the flag:
  - `get_kpis`: omit labor, prime cost and profitability through
    `redactLaborFields` (`_shared/periodMetrics.ts:358`), with a pay-rates
    reason.
  - `get_labor_costs`, `get_payroll_summary`, `get_schedule_overview`: keep
    hours and counts. Set every money field to `null`. Add
    `pay_hidden: { reason }`.
  - `get_time_punches`: `cost_cents` is `null` on every shift (the field is
    already nullable, `index.ts:2101`). Add `pay_hidden: { reason }`.
- The reason text: "Pay rates are hidden for your role, so labor cost figures
  are not available."

## Tests

- `tests/unit/employeeLaborColumns.test.ts`: `EMPLOYEE_LABOR_SOURCE` is
  `employees_secure`.
- New `tests/unit/aiLaborEmployeeReads.test.ts` (source contract on
  `ai-execute-tool/index.ts`):
  - no `.from('employees')` read;
  - no `employees(` embed that names a column in `PAY_RATE_FIELDS` or
    `EMPLOYEE_PII_FIELDS` (`src/lib/employeeMaskedFields.ts:29`, `:39`), and no
    `employees(*)`;
  - `fetchLaborEmployees` reads `EMPLOYEE_LABOR_SOURCE`.
- `tests/unit/tools-registry.test.ts`: `hasPayRatesCapability` returns true or
  false from the RPC, and false (with a log) on an RPC error or a rejection.
- Pay-hidden shape: the pure helper that nulls the money fields
  (`redactPayFields`) has a unit test for each tool shape.

## E2E

Justified exception: the AI chat calls OpenRouter, and CI cannot drive a model
conversation to a deterministic tool call. The source-contract test covers the
reads. The pgTAP tests of `20260806110000` cover the view.

## Out of scope

The single-engine work (`docs/superpowers/specs/2026-09-24-single-labor-engine-design.md`
on branch `claude/sleepy-albattani-gsv9yg`) replaces these tools' engine
later. This hotfix changes only the reads and the masked-pay behavior.
