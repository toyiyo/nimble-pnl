# Make the three sensitive-data flags real

**Date:** 2026-08-06
**Branch:** `fix/sensitive-data-flags`
**Base:** `main` at `6d648062`

## Problem

The role editor shows three sensitive-data switches. All three are decorative.
A role can hold none of them and the holder still reads the data.

| Toggle | Flag | Enforced in the client | Enforced in SQL |
|---|---|---|---|
| Item costs & margins | `view:costs` | no | no |
| Employee pay rates | `view:pay_rates` | no | no |
| Contact details & tax IDs | `view:employee_pii` | no | no |

### Evidence

1. The catalog defines the three flags at
   [`src/lib/permissions/areas.ts:78`](../../../src/lib/permissions/areas.ts) and
   `areas.ts:87-111`.
2. The flags reach the capability list correctly.
   `membershipCapabilities.ts:57-64` expands `role_flags` into capabilities, and
   `usePermissions.ts:141` passes `includeSensitiveFlags`. The plumbing works.
3. No consumer asks. A repository grep for the three flag names finds hits only
   in `src/lib/permissions/`, in the migrations that define them, and in tests.
   No component and no RLS policy reads any of the three.
4. `products` SELECT gates on `user_has_capability(restaurant_id,'view:inventory')`.
   `recipes` SELECT gates on `view:recipes`. Page access equals cost access.
5. `employee_compensation_history` SELECT is `EXISTS (SELECT 1 FROM
   user_restaurants WHERE restaurant_id = ... AND user_id = auth.uid())` —
   plain membership, no capability predicate. This table holds the full pay
   history. `useEmployees.tsx:35-38` pulls it with
   `select('*, compensation_history:employee_compensation_history(*)')`.
6. The third toggle's hint at `areas.ts:108` promises "Phone, address, last 4 of
   SSN". Schema `public` has no `ssn` column, no `tax_id` column, and no
   employee address column. Employee PII is `email`, `phone`, `date_of_birth`.

### Live proof

User `josema92@hotmail.com` at "Wetzel's - Cold Stone - Alamo Ranch" holds the
custom collaborator role "Operations lead"
(`d9cf6461-b1d3-4a5a-bb85-6e27b3f10b05`). The role holds seven areas. It does
**not** hold `employees`. Its only flag is `view:costs`. That user reads every
employee row in full, which includes one minor's `date_of_birth` and every
`hourly_rate`.

### Why a client-side gate is not a fix

"Operations lead" is collaborator-flavored. A collaborator is an external
person who can call PostgREST directly with their own token. Enforcement must
be in Postgres. The client gate is a second, separate requirement — see
"The client gate prevents data loss" below.

## What this design does NOT change

`supabase/migrations/20260411100000_staff_can_view_coworkers.sql:1-10` states
why every restaurant member reads every employee row: staff must see coworker
names for shift trades and scheduling. That is a deliberate product decision
from April. This design keeps broad **row** access and gates **columns**.

A line cook keeps seeing the roster. A line cook stops seeing pay and dates of
birth.

## Architecture

Postgres RLS filters rows. It cannot mask a column. So the mechanism is a
column privilege plus a masking view.

```
authenticated ──X── employees.hourly_rate        (REVOKE SELECT on the column)
authenticated ──✓── employees.name               (GRANT SELECT on the column)
authenticated ──✓── employees_secure             (view, owner rights)
                       └─ CASE WHEN user_has_capability(restaurant_id,
                                'view:pay_rates') THEN hourly_rate END
```

The column REVOKE is the control. The view is the accessor. A caller who goes
around the view hits the column ACL and gets `permission denied for column
hourly_rate`. The ACL cannot be bypassed by PostgREST, by a raw REST call, or
by a crafted embed.

### Three tables, three treatments

| Table | Sensitive columns | Treatment |
|---|---|---|
| `employees` | `hourly_rate`, `salary_amount`, `daily_rate_amount`, `contractor_payment_amount`, `email`, `phone`, `date_of_birth` | column REVOKE + `employees_secure` view |
| `employee_compensation_history` | every row is pay | row policy — add `user_has_capability(restaurant_id,'view:pay_rates')` |
| `products`, `recipes` | `products.cost_per_unit`, `recipes.estimated_cost` | column REVOKE + `products_secure`, `recipes_secure` views |

`employee_compensation_history` needs no view. The whole table is pay data, so
a row policy expresses the rule exactly. This is the cheaper mechanism and it
applies wherever the table is single-purpose.

### View definition shape

```sql
CREATE VIEW public.employees_secure
WITH (security_barrier = true) AS
SELECT
  e.id, e.restaurant_id, e.name, e.position, ...,
  CASE WHEN public.user_has_capability(e.restaurant_id, 'view:pay_rates')
       THEN e.hourly_rate END AS hourly_rate,
  ...
  CASE WHEN public.user_has_capability(e.restaurant_id, 'view:employee_pii')
       THEN e.email END AS email,
  ...
FROM public.employees e
WHERE e.restaurant_id IN (
        SELECT ur.restaurant_id FROM public.user_restaurants ur
        WHERE ur.user_id = auth.uid())
   OR e.user_id = auth.uid();
```

The view runs with owner rights (`security_invoker` stays off). Owner rights
are required: the caller no longer holds the column privilege, so an invoker
-rights view would fail for everyone. Because the view bypasses the base
table's RLS, the view carries its own row predicate. That predicate reproduces
today's broadest `employees` SELECT policy exactly, so no user loses a row.

`security_barrier = true` stops a leaky operator in a user-supplied `WHERE`
from reading a masked value before the CASE runs.

### Grants

Lessons [2026-08-02] and [2026-08-03] apply. Revoke from every role the stock
`ALTER DEFAULT PRIVILEGES` entry grants to, then grant back exactly what each
role needs.

```sql
REVOKE SELECT ON public.employees FROM PUBLIC, anon, authenticated, service_role;
GRANT  SELECT (id, restaurant_id, name, position, ... non-sensitive ...)
       ON public.employees TO authenticated;
GRANT  SELECT ON public.employees TO service_role;   -- payroll edge functions
GRANT  SELECT ON public.employees_secure TO authenticated;
REVOKE SELECT ON public.employees_secure FROM PUBLIC, anon;
```

`service_role` keeps the whole table. Payroll edge functions need pay, and
`rolbypassrls` means the table ACL is the only control standing behind that
role — so state the grant, do not inherit it.

## The client gate prevents data loss

This is not cosmetic. `EmployeeDialog.tsx:238-258` loads `employee.email`,
`employee.phone`, `employee.date_of_birth`, `employee.hourly_rate` and
`employee.salary_amount` into form state. The save path writes those state
values back.

**Warning: an unauthorized editor who opens and saves the dialog erases the
real values.** A masked column arrives as `NULL`, the form renders it empty,
and the save writes the empty value over the true one.

So the client must do two things when `hasCapability('view:pay_rates')` or
`hasCapability('view:employee_pii')` is false:

1. Hide the field.
2. Omit the field from the update payload. Do not send `NULL`.

## Files

### Migrations (create)

- `supabase/migrations/<ts>_sensitive_column_gating.sql` — the REVOKE/GRANT
  set, the three views, and the `employee_compensation_history` policy
  rewrite.

The timestamp must not collide with any migration on `main`. Lesson
[2026-08-05]: `tests/unit/migrationVersionUniqueness.test.ts` fails only on the
`pull_request` event, so a collision is invisible to every local run.

### Client (modify)

- `src/hooks/useEmployees.tsx:34` — read `employees_secure`, not `employees`.
- `src/hooks/useProducts.tsx`, `src/hooks/useRecipes.tsx` — same swap.
- `src/components/EmployeeDialog.tsx` — gate the five fields, omit them from
  the payload when masked.
- Every remaining `select('*')` on the three tables. Six sites on `employees`,
  eight on `products`, zero on `recipes`.
- `src/lib/permissions/areas.ts:108` — fix the hint to "Email, phone, date of
  birth".

### Tests (create)

- `supabase/tests/sensitive_column_gating_test.sql` — pgTAP. Assert the column
  ACL with `has_column_privilege`, not only with `throws_ok`. Lesson
  [2026-08-02]: a grant-posture assertion that passes locally has proven
  nothing.
- `tests/unit/employeeDialogMasking.test.tsx` — assert the payload omits a
  masked field.
- `tests/e2e/sensitive-data-flags.spec.ts` — a role without `view:pay_rates`
  opens the roster and sees no pay.

## Non-goals

- **Row access to `employees` stays broad.** See "What this design does NOT
  change".
- **The `employees` UPDATE mismatch.** The Edit Employee dialog offers an
  "Update Employee" button that RLS refuses for a custom collaborator:
  `UPDATE` needs `user_has_role(restaurant_id, ARRAY['owner','manager',
  'operations_manager'])`, and `user_has_role` matches the legacy
  `user_restaurants.role` string, which for this user is `collaborator_custom`.
  This is a separate defect. Fixing it here would mix a write-path
  authorization change into a read-path security patch.
- **The `view:costs` blast radius beyond `products` and `recipes`.** Derived
  cost appears in reports and P&L. Those pages are gated by their own areas.
  This design gates the two source columns.

## Risks

| Risk | Mitigation |
|---|---|
| A missed `select('*')` breaks a page at runtime | The failure is loud — `permission denied for column`. Grep is exhaustive; the e2e suite covers the main routes. |
| An edge function loses pay access | `service_role` keeps the whole table, stated explicitly in the migration. |
| The view's row predicate drifts from the table's policy | The predicate is copied from `20260411100000_staff_can_view_coworkers.sql:15-21`. A pgTAP test asserts the row counts match. |
| Local pgTAP passes, CI fails on grants | Read `pg_default_acl` before trusting a local green. Lesson [2026-08-02]. |
