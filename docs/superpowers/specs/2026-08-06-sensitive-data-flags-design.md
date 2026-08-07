# Make the employee pay and PII flags real

**Date:** 2026-08-06
**Branch:** `fix/sensitive-data-flags`
**Base:** `main` at `6d648062`

## Problem

The role editor shows three sensitive-data switches. None of them gates
anything. This design makes two of them real on one table, `public.employees`:

| Toggle | Flag |
|---|---|
| Employee pay rates | `view:pay_rates` |
| Contact details & tax IDs | `view:employee_pii` |

`view:costs` needs 25 columns across 14 tables and two auto-write paths that
would zero stored costs. It gets its own PR.

A collaborator can call PostgREST directly with their own token. A client-only
check does not hold. The gate must be in Postgres.

### Evidence

1. No component and no RLS policy reads the three flag names. A repository grep
   finds hits only in `src/lib/permissions/`, in the migrations that define
   them, and in tests.
2. `employee_compensation_history` SELECT is plain membership, with no
   capability predicate. That table holds the full pay history.
   `useEmployees.tsx:35-38` pulls it with an embed.
3. The `view:employee_pii` label and hint at `areas.ts:107-108` name data the
   app does not store. Schema `public` has no `ssn` column, no `tax_id` column,
   and no employee address column. Employee PII is `email`, `phone`,
   `date_of_birth`.

### The flags are unheld, not only unread

Every builtin role holds zero rows in `role_flags`. Owner, Manager, Operations
Manager, and Accountant all hold none. Every one of the 157 memberships in
production carries a non-null `role_id`, so `user_has_capability` always takes
the flag branch at `20260805120000_page_areas.sql:322-327`:

```sql
IF p_capability IN ('view:costs','view:pay_rates','view:employee_pii') THEN
  RETURN EXISTS (SELECT 1 FROM role_flags rf
                 WHERE rf.role_id = v_role_id AND rf.flag = p_capability);
END IF;
```

`expandAreas` at `areas.ts:380` agrees. No area grant implies a flag.

**Warning: a gate on these flags locks out every owner today.** Seed the
builtin roles before you add the gate. See "Task order" below.

## Architecture

Postgres RLS filters rows. It cannot mask a column. A column `GRANT` is a
role-level privilege, so it cannot depend on `user_has_capability`. The
mechanism is therefore a column REVOKE plus an owner-rights view.

```
authenticated ──X── employees.hourly_rate        (REVOKE SELECT on the column)
authenticated ──✓── employees.name               (GRANT SELECT on the column)
authenticated ──✓── employees_secure             (view, owner rights)
```

The column REVOKE is the control. The view is the accessor. A caller who goes
around the view hits the column ACL and gets `permission denied for column
hourly_rate`. PostgREST cannot bypass the ACL.

### Masked columns

| Flag | Columns |
|---|---|
| `view:pay_rates` | `hourly_rate`, `salary_amount`, `contractor_payment_amount`, `daily_rate_amount`, `daily_rate_reference_weekly` |
| `view:employee_pii` | `email`, `phone`, `date_of_birth` |

The other 30 columns stay granted to `authenticated`.

### The view

```sql
CREATE VIEW public.employees_secure
WITH (security_barrier = true) AS
SELECT
  e.id, e.restaurant_id, e.name, e.position, /* ...30 plain columns... */
  CASE WHEN caps.pay THEN e.hourly_rate END                 AS hourly_rate,
  CASE WHEN caps.pay THEN e.salary_amount END               AS salary_amount,
  CASE WHEN caps.pay THEN e.contractor_payment_amount END   AS contractor_payment_amount,
  CASE WHEN caps.pay THEN e.daily_rate_amount END           AS daily_rate_amount,
  CASE WHEN caps.pay THEN e.daily_rate_reference_weekly END AS daily_rate_reference_weekly,
  CASE WHEN caps.pii THEN e.email END                       AS email,
  CASE WHEN caps.pii THEN e.phone END                       AS phone,
  CASE WHEN caps.pii THEN e.date_of_birth END               AS date_of_birth,
  (e.date_of_birth IS NOT NULL
   AND e.date_of_birth > (CURRENT_DATE - INTERVAL '18 years')) AS is_minor
FROM public.employees e
CROSS JOIN LATERAL (
  SELECT public.user_has_capability(e.restaurant_id, 'view:pay_rates')    AS pay,
         public.user_has_capability(e.restaurant_id, 'view:employee_pii') AS pii
) caps
WHERE e.restaurant_id IN (
        SELECT ur.restaurant_id FROM public.user_restaurants ur
        WHERE ur.user_id = auth.uid())
   OR e.user_id = auth.uid();
```

Three parts need a reason.

**Owner rights.** `security_invoker` stays off. The caller no longer holds the
column privilege, so an invoker-rights view fails for everyone. Note the
divergence: `active_employees` and `inactive_employees` both set
`security_invoker = true`. State the reason in the migration comment, so a
later reader does not "fix" this view to match its siblings.

**The row predicate.** An owner-rights view bypasses the base table's RLS, so
the view carries its own predicate. That predicate is the union of the two
active SELECT policies: membership from
`20260411100000_staff_can_view_coworkers.sql:15-21`, and self-view from
`20260220000000_add_staff_tip_read_policies.sql:14-16`. No user gains or loses
a row.

**The `LATERAL` join.** A separate `user_has_capability` call per masked column
runs 8 times per row. For a 200-employee roster that is 1,600 calls to answer
two questions. The `LATERAL` computes both booleans once per row.

**`is_minor`.** `isMinor(date_of_birth)` returns `false` for a null date, so a
masked date deletes the "Minor" badge from the roster. That badge is a labor
compliance cue. Five call sites read it: `EmployeeDialog.tsx:1287`,
`EmployeeList.tsx:294`, `WeekScheduleMobile.tsx:91`,
`EmployeeSidebar.tsx:159`, `Scheduling.tsx:1286`. The view computes the boolean
and shows it to every member. The raw date stays gated.

### Grants

Lessons [2026-08-02] and [2026-08-03] apply. Revoke from every role the stock
`ALTER DEFAULT PRIVILEGES` entry grants to. Then grant back what each role
needs.

```sql
REVOKE SELECT ON public.employees FROM PUBLIC, anon, authenticated, service_role;
GRANT  SELECT (id, restaurant_id, name, position, /* ...the 30 plain columns... */)
       ON public.employees TO authenticated;
GRANT  SELECT ON public.employees TO service_role;   -- payroll edge functions
GRANT  SELECT ON public.employees_secure TO authenticated;
REVOKE SELECT ON public.employees_secure FROM PUBLIC, anon;
```

`service_role` keeps the whole table. Payroll edge functions need pay, and
`rolbypassrls` makes the table ACL the only control behind that role. State the
grant. Do not inherit it.

### `employee_compensation_history`

Add one predicate to the existing SELECT policy:
`user_has_capability(restaurant_id,'view:pay_rates')`. No view, no column
grant. The whole table is pay data, so a row policy states the rule exactly.
PostgREST drops the embedded rows under RLS with no error to handle.

## The write path erases data

**Warning: a masked column arrives as `NULL`, and the save path writes it
back.** Seven paths turn the migration into data loss. Two need care.

`EmployeeDialog.tsx:551-553` sends `hourly_rate: 0`, not `undefined`.
`EmployeeDialog.tsx:623` sends `date_of_birth: dateOfBirth || null`, which
erases the date on any save. `EmployeeDialog.tsx:651-670` then compares the
fabricated `0` against the real rate and inserts a permanent `$0.00` row into
the compensation history.

Fix this once, in the hook, not per field in the dialog. `useUpdateEmployee`
strips every masked key from the payload before the write. `EmployeeDialog` is
not the only writer: `ShiftImportSheet.tsx`, `TimePunchUploadSheet.tsx`, and
`useSlingEmployeeMapping.ts:83-97` also create employees. A per-field gate in
one component protects one of four call sites.

The dialog still hides the fields, and drops the `required` attribute from the
`hourlyRate` input at `EmployeeDialog.tsx:864`. Pair every `hasCapability` call
with `isResolved`, the idiom at `Expenses.tsx:94` and
`PendingOutflowCard.tsx:179`. Without it the gate reads a false negative while
the membership resolves.

## Files

### Migration (create)

`supabase/migrations/<ts>_employee_column_gating.sql` — the builtin flag seed,
the REVOKE/GRANT set, the `employees_secure` view, and the
`employee_compensation_history` policy change.

The timestamp must not collide with any migration on `main`. Lesson
[2026-08-05]: `tests/unit/migrationVersionUniqueness.test.ts` fails only on the
`pull_request` event.

### Client (modify)

| File | Change |
|---|---|
| `useEmployees.tsx:35` | read `employees_secure` |
| `useEmployees.tsx:80,113` | read back through `employees_secure`, not a bare `.select()` |
| `useEmployees.tsx:103-134` | strip masked keys from the update payload |
| `useCurrentEmployee.tsx:22` | read `employees_secure` |
| `useMonthlyMetrics.tsx:408` | read `employees_secure` |
| `useTimePunches.tsx:599` | read `employees_secure` |
| `useShifts.tsx:60` | embed resolves to the base table — needs an explicit column list |
| `useTimeOffRequests.tsx:15-18` | same |
| `useScheduleChangeLogs.tsx:17` | same |
| `EmployeeDialog.tsx` | hide the 8 fields, drop `required` at line 864 |
| `EmployeeList.tsx:221-236` | a masked rate must not render as `$0.00/hr` |
| `useEmployeeLaborCosts.tsx:64` | a masked rate must not understate labor cost |
| `employeeUtils.ts` | read `is_minor` from the row, not `isMinor(date_of_birth)` |
| `areas.ts:107-108` | name → "Contact details", hint → "Email, phone, date of birth" |
| `definitions.ts` | add both flags to Owner, Manager, Operations Manager |

A post-mutation read-back goes through `employees_secure`, not a hand-written
column list. A hand-written list at 6 sites drifts the day a column is added.

### Tests

- `supabase/tests/employee_column_gating_test.sql` — pgTAP. Copy the idiom at
  `review_responses_rls_test.sql:98-110`: `SET LOCAL role TO postgres;` then
  `has_column_privilege(...)`. A normal test role cannot read another role's
  column grants. Assert the view's row count equals the base table's row count
  for one sample user.
- `roles_seed_test.sql:439-449` asserts zero `role_flags` rows for every
  builtin. Replace the count with the exact expected set. Do not delete the
  assertion.
- `tests/unit/employeeUpdatePayload.test.ts` — the hook drops a masked key.
- `tests/e2e/sensitive-data-flags.spec.ts` — a role without `view:pay_rates`
  opens the roster and sees no pay.

## Task order

The seed must land before the gate, or every owner loses access.

1. Add both flags to `ROLE_CAPABILITIES` for Owner, Manager, and Operations
   Manager in `definitions.ts`. Seed the matching `role_flags` rows. Change the
   `roles_seed_test.sql` assertion. The round-trip property in that test
   compares SQL-derived capabilities against `ROLE_CAPABILITIES`, so both sides
   must move together.
2. Strip masked keys in `useUpdateEmployee`, and fix the dialog's write path.
3. Add the view, the REVOKE/GRANT set, and the policy change.
4. Point every reader at `employees_secure`.

## Non-goals

- **Row access to `employees` stays broad.**
  `20260411100000_staff_can_view_coworkers.sql` states why: staff must see
  coworker names for shift trades and scheduling. This design gates columns,
  not rows. A collaborator with no people area still reads `position`,
  `hire_date`, `employment_type`, `status`, and `notes` for every coworker.
  That is a separate product decision.
- **`view:costs`.** 25 columns, 14 tables, and two paths that auto-write
  recomputed costs on page load. Its own PR.
- **The `employees` UPDATE mismatch.** `UPDATE` needs
  `user_has_role(restaurant_id, ARRAY['owner','manager','operations_manager'])`,
  and `user_has_role` matches the legacy `user_restaurants.role` string, which
  for a custom collaborator is `collaborator_custom`. So the "Update Employee"
  button fails for that user. A write-path authorization change does not belong
  in a read-path security patch.
