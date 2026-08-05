# Employee self-service pages must be self-scoped (design)

- **Date:** 2026-08-05
- **Branch:** `fix/employee-self-scoped-data`
- **Origin:** security follow-up filed from PR #701 (`fix/collaborator-work-view`). This is a
  live issue on `main`; PR #701 surfaced it but did not introduce it.
- **Related:** `docs/superpowers/specs/2026-08-02-collaborator-work-view-design.md`

---

## 1. Problem

Employee self-service pages fetch **restaurant-wide** data and filter it to the current
employee **in the browser**. The RLS policies behind those tables are membership-only, so the
filtering is cosmetic — every coworker's row genuinely arrives over the wire.

`staffAllowedPaths` has included these routes since before PR #701
([src/App.tsx:333](../../../src/App.tsx#L333), building on `EMPLOYEE_SELF_SERVICE_PATHS` at
[src/App.tsx:186-196](../../../src/App.tsx#L186)), so the exposure applies to every user
holding the `staff` role today.

### 1.1 Leak sites (client)

Three pages, not two. The third was found during this design's caller sweep.

| Page | Call | Client-side filter |
|---|---|---|
| `EmployeeSchedule` | `useShifts(restaurantId, currentWeekStart, weekEnd)` — [src/pages/EmployeeSchedule.tsx:70-73](../../../src/pages/EmployeeSchedule.tsx#L70) | `shifts.filter(s => s.employee_id === currentEmployee.id)` — [:76-79](../../../src/pages/EmployeeSchedule.tsx#L76) |
| `AvailableShiftsPage` | `useShifts(restaurantId, weekStart, weekEnd)` — [src/pages/AvailableShiftsPage.tsx:250](../../../src/pages/AvailableShiftsPage.tsx#L250) | `myShifts.filter(s => s.employee_id === currentEmployee.id && s.status !== 'cancelled')` — [:251-254](../../../src/pages/AvailableShiftsPage.tsx#L251) |
| `EmployeePay` | `usePayroll(restaurantId, startDate, endDate)` — [src/pages/EmployeePay.tsx:58](../../../src/pages/EmployeePay.tsx#L58) | `payrollPeriod.employees.find(e => e.employeeId === currentEmployee.id)` — [:61-64](../../../src/pages/EmployeePay.tsx#L61) |

`useShifts` also embeds the employee record: `.select('*, employee:employees(*)')`
([src/hooks/useShifts.tsx:59-61](../../../src/hooks/useShifts.tsx#L59)), so the schedule page
ships every coworker's full `employees` row too, not just their shift times.

### 1.2 The payroll leak is nine tables, not one

The brief named `useEmployees` + `employee_compensation_history`. The `usePayroll` `queryFn`
actually issues restaurant-wide reads against **eight** more tables, all keyed on
`restaurant_id` + a date range with no employee predicate:

| Table | Line | Selected |
|---|---|---|
| `employees` (+ `employee_compensation_history(*)`) | [usePayroll.tsx:116](../../../src/hooks/usePayroll.tsx#L116) → [useEmployees.tsx](../../../src/hooks/useEmployees.tsx) | `*` plus embedded compensation history |
| `time_punches` | [:150-160](../../../src/hooks/usePayroll.tsx#L150) | `*` (paginated via `fetchAllRows`) |
| `tip_splits` | [:171-177](../../../src/hooks/usePayroll.tsx#L171) | `id, total_amount` |
| `tip_split_items` | [:184-189](../../../src/hooks/usePayroll.tsx#L184) | `employee_id, amount, tip_split_id` |
| `daily_labor_allocations` | [:194-200](../../../src/hooks/usePayroll.tsx#L194) | `*` where `source = 'per-job'` |
| `employee_tips` | [:221-226](../../../src/hooks/usePayroll.tsx#L221) | `employee_id, tip_amount, tip_date` |
| `tip_payouts` | [:231-236](../../../src/hooks/usePayroll.tsx#L231) | `employee_id, amount` |
| `overtime_rules` | [:281-285](../../../src/hooks/usePayroll.tsx#L281) | restaurant config — **not** per-employee |
| `overtime_adjustments` | [:292-297](../../../src/hooks/usePayroll.tsx#L292) | `employee_id, punch_date, adjustment_type, hours, reason` |

Every one of these except `overtime_rules` carries an `employee_id` column, so all are
mechanically self-scopable.

### 1.3 RLS state (verified against production `pg_policies`, read-only)

Four of the six target tables have **exactly one** SELECT policy, and it is membership-only:

| Table | Policy | `qual` |
|---|---|---|
| `shifts` | Users can view shifts for their restaurants | `EXISTS (SELECT 1 FROM user_restaurants WHERE restaurant_id = shifts.restaurant_id AND user_id = auth.uid())` |
| `employee_compensation_history` | Users can view compensation history for their restaurants | same shape |
| `overtime_adjustments` | Users can view their restaurant overtime adjustments | same shape |
| `daily_labor_allocations` | Users can view allocations for their restaurants | same shape |

`time_punches` and `employee_tips` each carry **four** SELECT policies: an own-row policy
(`employee_id IN (SELECT id FROM employees WHERE user_id = auth.uid())`), two duplicate
manager policies whose predicate is the **legacy role string** `role = ANY (ARRAY['owner','manager'])`,
and the same membership-only policy. Because permissive policies are ORed, the membership
policy defeats the other three.

> **Consequence for the fix:** the manager policies on those two tables are role-string based
> and cover only `owner`/`manager`. Simply *dropping* the redundant membership policy would
> revoke `operations_manager`, `chef`, and `collaborator_operations_manager` — so the
> membership policy must be **replaced**, not deleted.

Prerequisite already in place: `employees` carries `Employees can view their own record` with
`qual = (user_id = auth.uid())`, added by
[supabase/migrations/20260220000000_add_staff_tip_read_policies.sql:13-16](../../../supabase/migrations/20260220000000_add_staff_tip_read_policies.sql#L13).
That migration's header ([:6-12](../../../supabase/migrations/20260220000000_add_staff_tip_read_policies.sql#L6))
documents why it matters: Postgres evaluates an RLS subquery against `employees` under the
*caller's* RLS permissions, so every `EXISTS (… FROM employees WHERE user_id = auth.uid())`
clause in this design depends on it.

### 1.4 The correct pattern already exists in-repo

`tip_payouts` and `tip_split_items` already use **own-row OR capability**:
`tip_payouts` has `Employees can view their own tip payouts` (own row via `employees.user_id`)
ORed with a `user_has_capability(restaurant_id, 'view:tips')` manager policy. This design
copies that shape.

---

## 2. Goals / non-goals

**Goals**
1. Employee self-service pages must request only the signed-in employee's rows.
2. RLS must stop restaurant-wide reads for roles that have no scheduling/payroll capability,
   so the boundary holds even against a hand-rolled `supabase-js` call from devtools.
3. No behaviour change for any role that legitimately reads restaurant-wide data today.

**Non-goals**
- Tightening `employees` (§6 — deferred with evidence).
- Changing which routes `staff` may reach; `staffAllowedPaths` is unchanged.
- Any write-path/RPC change.

---

## 3. Design — client layer

### 3.1 The `undefined` footgun (why an optional param is not enough)

`useCurrentEmployee` is itself an async React Query
([src/hooks/useCurrentEmployee.tsx:10-40](../../../src/hooks/useCurrentEmployee.tsx#L10)), so
`currentEmployee` is `null` on first render and stays null until the query settles. An
*optional* `{ employeeId }` filter that falls back to "no filter" when the value is missing
would therefore issue a full restaurant-wide fetch on **every page load** — re-opening the
exact hole this change closes.

**Rule:** the self-scoped entry point is a separate exported hook whose `enabled` gate
requires the id. There is no code path in which "self-scoped" degrades to "everything".

### 3.2 Shared implementation, two public entry points

Both hook families keep one internal implementation so the employee's own numbers cannot
drift from what the admin page shows for the same employee.

**`src/hooks/useShifts.tsx`**

```ts
// internal
function useShiftsQuery(restaurantId, startDate, endDate, employeeId?: string | null)
//   queryKey: ['shifts', restaurantId, start, end, employeeId ?? 'all']
//   applies .eq('employee_id', employeeId) when employeeId is set

// public — unchanged signature, admin callers untouched
export function useShifts(restaurantId, startDate?, endDate?)

// public — self-scoped; enabled: !!restaurantId && !!employeeId
export function useMyShifts(restaurantId, employeeId: string | null, startDate?, endDate?)
```

`useShifts`'s current signature and behaviour ([src/hooks/useShifts.tsx:48-90](../../../src/hooks/useShifts.tsx#L48))
are preserved verbatim for its admin callers: [src/hooks/useShiftPlanner.ts:539](../../../src/hooks/useShiftPlanner.ts#L539)
and [src/pages/Scheduling.tsx:291](../../../src/pages/Scheduling.tsx#L291).

**`src/hooks/useEmployees.tsx`** — add `employeeId?: string` to `UseEmployeesOptions`,
applying `.eq('id', employeeId)` and joining it into the query key. Note the existing
module-level `EMPTY_EMPLOYEES` stable reference must be preserved — it deliberately guards an
infinite render loop in [src/pages/Tips.tsx](../../../src/pages/Tips.tsx).

**`src/hooks/usePayroll.tsx`** — internal implementation takes `employeeId?: string` and
threads `.eq('employee_id', employeeId)` into the seven per-employee queries listed in §1.2
(`time_punches`, `tip_split_items`, `daily_labor_allocations`, `employee_tips`, `tip_payouts`,
`overtime_adjustments`, plus `useEmployees({ status: 'all', employeeId })`). `tip_splits` and
`overtime_rules` stay restaurant-scoped: `tip_splits` is only read for `id, total_amount` to
resolve child items ([:171-181](../../../src/hooks/usePayroll.tsx#L171)) and `overtime_rules`
is restaurant configuration, not per-employee data.

```ts
export function usePayroll(restaurantId, startDate, endDate)                       // admin
export function useMyPayroll(restaurantId, employeeId: string | null, startDate, endDate)
```

The `enabled` gate at [usePayroll.tsx:342](../../../src/hooks/usePayroll.tsx#L342) is
`!!restaurantId && !!employees.length`; the self-scoped variant additionally requires
`!!employeeId`. The query key must include `employeeId` so an employee's cache entry can
never be served to the admin page (or vice versa).

Downstream aggregation is unchanged: `calculatePayrollPeriod`
([:329-340](../../../src/hooks/usePayroll.tsx#L329)) simply receives a one-element
`eligibleEmployees` array, and `EmployeePay`'s existing `.find(...)` still resolves.

### 3.3 Page changes

- [EmployeeSchedule.tsx:70-79](../../../src/pages/EmployeeSchedule.tsx#L70) → `useMyShifts(restaurantId, currentEmployee?.id ?? null, currentWeekStart, weekEnd)`; the `myShifts` `useMemo` filter is removed (`shifts` is already the employee's).
- [AvailableShiftsPage.tsx:250-254](../../../src/pages/AvailableShiftsPage.tsx#L250) → `useMyShifts(...)`; the `employee_id` predicate is dropped from the `useMemo` but **`status !== 'cancelled'` is kept** — it is a display rule, not a scoping rule.
- [EmployeePay.tsx:58](../../../src/pages/EmployeePay.tsx#L58) → `useMyPayroll(restaurantId, currentEmployee?.id ?? null, startDate, endDate)`.

Loading states already gate on `employeeLoading` on all three pages, so the extra
"disabled until `currentEmployee` resolves" tick renders as the existing skeleton rather than
an empty state.

---

## 4. Design — RLS layer (defense in depth)

### 4.1 The uniform predicate

For each of the six tables, the single membership-only policy is **replaced** by two
permissive policies:

```sql
-- own row
USING (EXISTS (
  SELECT 1 FROM employees e
  WHERE e.id = <table>.employee_id
    AND e.user_id = auth.uid()
    AND e.restaurant_id = <table>.restaurant_id
))

-- privileged restaurant-wide
USING (
  user_has_capability(restaurant_id, 'view:scheduling')
  OR user_has_capability(restaurant_id, 'view:payroll')
)
```

**Why `view:scheduling OR view:payroll`, and not `view:payroll` alone.** The legacy-role
capability sets are declared in [src/lib/permissions/definitions.ts](../../../src/lib/permissions/definitions.ts):
`chef` holds `view:scheduling` and `view:dashboard` but **not** `view:payroll`
([:182-205](../../../src/lib/permissions/definitions.ts#L182)), and `staff` holds only
`view:settings` ([:207-210](../../../src/lib/permissions/definitions.ts#L207)). A
`view:payroll`-only predicate would silently zero out chef's labor-cost figures on the
scheduling and dashboard surfaces fed by
[useScheduledLaborCosts](../../../src/hooks/useScheduledLaborCosts.tsx) and
[useLaborCostsFromTimeTracking](../../../src/hooks/useLaborCostsFromTimeTracking.tsx) — the
same silent-zero failure mode the tips migration was written to repair. The OR'd predicate
admits exactly `owner`, `manager`, `operations_manager`, `chef`, `collaborator_accountant`,
`collaborator_operations_manager`, and excludes `staff`, `kiosk`, `collaborator_inventory`,
`collaborator_chef`.

`user_has_capability(uuid, text)` is `SECURITY DEFINER`, `STABLE`, `SET search_path TO 'public'`,
and resolves either the legacy `user_restaurants.role` string or `role_areas`/`role_flags`
keyed on `role_id`. `view:costs` / `view:pay_rates` / `view:employee_pii` are **not** usable
here: they resolve only from `role_flags` and do not appear in the legacy role CASE, so they
would evaluate false for legacy roles including `owner`.

Tightening chef's access to pay rates further is a **product decision, not a security fix**,
and is deliberately out of scope.

### 4.2 Per-table notes

| Table | Policy replaced | Notes |
|---|---|---|
| `employee_compensation_history` | Users can view compensation history for their restaurants | Own row joins via `employee_id`; also read as the embedded `compensation_history:` join in `useEmployees`. |
| `time_punches` | Users can view time punches for their restaurants | Own-row policy already exists — the new own-row policy is redundant but harmless; the two legacy `owner`/`manager` policies are left untouched (out of scope to consolidate). |
| `employee_tips` | Users can view tips for their restaurants | Same as above. |
| `overtime_adjustments` | Users can view their restaurant overtime adjustments | Sole SELECT policy today. |
| `daily_labor_allocations` | Users can view allocations for their restaurants | Sole SELECT policy today. |
| `shifts` | Users can view shifts for their restaurants | Needs a third clause — see §4.3. |

### 4.3 `shifts` needs a shift-trade clause

`shifts.employee_id` is `NOT NULL` in production, so there are no unassigned rows to
special-case. But the shift-trade marketplace reads **other** employees' shift rows through an
embedded PostgREST join — `offered_shift:shifts!offered_shift_id(...)` at
[src/hooks/useShiftTrades.ts:139](../../../src/hooks/useShiftTrades.ts#L139),
[:245](../../../src/hooks/useShiftTrades.ts#L245),
[:317](../../../src/hooks/useShiftTrades.ts#L317) and
[:580](../../../src/hooks/useShiftTrades.ts#L580) — and the app deliberately shows
marketplace trades to employees who are not the target
([:600-603](../../../src/hooks/useShiftTrades.ts#L600)). An own-row-only policy would break
accepting a trade.

Third permissive policy on `shifts`:

```sql
USING (EXISTS (
  SELECT 1 FROM shift_trades st
  WHERE st.restaurant_id = shifts.restaurant_id
    AND (st.offered_shift_id = shifts.id OR st.requested_shift_id = shifts.id)
))
```

`shift_trades` columns confirmed in production: `restaurant_id`, `offered_shift_id`,
`requested_shift_id`, `offered_by_employee_id`, `target_employee_id`, `status`. This subquery
is itself evaluated under the caller's RLS on `shift_trades`; the pgTAP suite must assert that
a staff user actually reaches an offered shift through it rather than assuming it.

Note that `useShiftTrades`'s own conflict-detection read of `shifts` is already self-scoped
(`.eq('employee_id', currentEmployeeId)` at [:616-620](../../../src/hooks/useShiftTrades.ts#L616))
and is unaffected.

### 4.4 Migration mechanics

- One migration file, `supabase/migrations/2026080512xxxx_self_scope_employee_reads.sql`.
- `DROP POLICY IF EXISTS` by exact name, then `CREATE POLICY`. Permissive policies OR, so the
  membership policy **must** be dropped — adding a narrower policy alongside it changes nothing.
- Policy bodies are transcribed from the production `pg_policies` output quoted in §1.3, not
  re-derived from an assumed schema.
- Because a `SELECT` predicate changes on tables that also have `INSERT/UPDATE/DELETE`
  policies with `USING`/`WITH CHECK` clauses, the plan must re-run the full pgTAP suite after
  a `db:reset` (editing a migration and running `test:db` without a reset tests the *old* state).

---

## 5. Testing

### 5.1 Unit (Vitest)

New `tests/unit/useMyShifts.test.ts` and `tests/unit/useMyPayroll.test.ts` asserting, against a
mocked `supabase` client, that:

1. `useMyShifts` issues `.eq('employee_id', <id>)` — the assertion inspects the recorded
   query-builder calls, not the returned rows, so it cannot pass vacuously via client filtering.
2. `useMyShifts` issues **no query at all** when `employeeId` is `null` (the §3.1 footgun).
3. `useMyPayroll` applies `.eq('employee_id', <id>)` to each of the seven per-employee tables
   and `.eq('id', <id>)` to `employees`.
4. `useShifts` / `usePayroll` (admin) still issue exactly the query they issue today — a
   regression guard for the shared implementation.

Existing suites that must stay green: [tests/unit/usePayroll.pagination.test.ts](../../../tests/unit/usePayroll.pagination.test.ts)
and [tests/unit/usePayroll.fetchRange.test.ts](../../../tests/unit/usePayroll.fetchRange.test.ts).

### 5.2 pgTAP

New `supabase/tests/rls_employee_self_scope.sql`. For each of the six tables, with fixtures for
one `staff` employee, one coworker, and one `manager`:

- staff sees own row; staff does **not** see the coworker's row (the actual fix);
- manager/`view:payroll` holder sees both;
- a `chef` sees both — the §4.1 regression guard, and the clause only `view:scheduling` grants;
- for `shifts`, a staff user reaches a coworker's shift **only** when it is referenced by a
  `shift_trades` row — exercising §4.3's clause with a row no other clause grants, so the test
  is not vacuous.

Every existing pgTAP test touching these tables must be re-checked: narrowing a SELECT
predicate can make an unrelated assertion vacuous rather than failing it. The plan budgets a
`grep -rln` sweep of `supabase/tests/` for each table name.

### 5.3 Manual / E2E

Not adding E2E here. The observable behaviour of all three pages is unchanged by design; the
change is what crosses the wire, which the unit tests assert directly and Playwright cannot.

---

## 6. Deferred: `employees`

`employees` carries the membership-only `Team members can view coworkers in their restaurant`
(`restaurant_id IN (SELECT ur.restaurant_id FROM user_restaurants ur WHERE ur.user_id = auth.uid())`),
which ORs open the narrower `user_has_capability(restaurant_id, 'view:employees')` policy that
sits beside it. It is **not** tightened in this change, for two evidenced reasons:

1. **A staff-facing surface legitimately needs coworker rows.** The shift-trade dialog calls
   `useEmployees(restaurantId)` to list coworkers as trade targets —
   [src/components/schedule/TradeRequestDialog.tsx:53](../../../src/components/schedule/TradeRequestDialog.tsx#L53).
   Own-row-only would empty that picker and break staff-initiated trades.
2. **The right fix is column-level, which RLS cannot express.** Staff need a coworker's `id`
   and `name`; they do not need the rest of the row. That requires a restricted view or an
   RPC, i.e. its own design.

Blast radius also argues for separating it: `useEmployees` has roughly twenty call sites,
including [EmployeeList.tsx:42](../../../src/components/EmployeeList.tsx#L42),
[ShiftDialog.tsx:69](../../../src/components/ShiftDialog.tsx#L69),
[Payroll.tsx:177](../../../src/pages/Payroll.tsx#L177), and
[useSplhCore.ts:37](../../../src/hooks/useSplhCore.ts#L37).

**Residual risk, stated plainly:** after this change a `staff` user can still enumerate
coworker `employees` rows. Their shifts, punches, tips, pay rates, labor allocations, and
overtime adjustments are closed at both layers; their employee record is not. A follow-up
issue will be filed.

---

## 7. Risks

| Risk | Mitigation |
|---|---|
| Silent-zero regression for `chef`/`operations_manager` on labor-cost surfaces | `view:scheduling OR view:payroll` predicate (§4.1) + an explicit chef pgTAP case (§5.2) |
| Self-scoped hook degrades to restaurant-wide while `currentEmployee` loads | Separate hook with a mandatory `employeeId` in `enabled` (§3.1) + a unit test asserting zero queries when null (§5.1) |
| React Query cache collision between admin and self views | `employeeId` in the query key (§3.2) |
| Shift-trade marketplace breaks under the new `shifts` policy | Dedicated trade clause (§4.3) + non-vacuous pgTAP case (§5.2) |
| Existing pgTAP assertions become vacuous rather than failing | `grep -rln` sweep of `supabase/tests/` per table; full `db:reset` before `test:db` (§4.4) |
| Employee pay figure drifts from the admin Payroll page | One shared implementation, two entry points — not a duplicate calculation (§3.2) |
