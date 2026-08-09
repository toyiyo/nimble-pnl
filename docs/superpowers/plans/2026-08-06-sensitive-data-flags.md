# Sensitive Data Flags Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `view:pay_rates` and `view:employee_pii` gate the eight sensitive columns of `public.employees` in Postgres.

**Architecture:** Revoke `SELECT` on the eight columns from `authenticated`. Add an owner-rights view `public.employees_secure` that returns `NULL` for a column the caller has no flag for. Point every client reader at the view. Seed the two flags onto the five builtin roles that already hold `view:employees`, so no user loses access on deploy day.

**Tech Stack:** Postgres 15 (Supabase), PostgREST, React 18 + TypeScript, React Query, Vitest, pgTAP, Playwright.

**Design doc:** `docs/superpowers/specs/2026-08-06-sensitive-data-flags-design.md`

## Global Constraints

- Write every comment, commit message, and PR body in ASD-STE100. See `docs/STE100_STYLE.md`.
- Never commit to `main`. All work lands on `fix/sensitive-data-flags`.
- Stage explicit paths. Never run `git add -A`, `git add .`, or `git commit -a`.
- Never edit `test_expected_capabilities` in `roles_seed_test.sql` to make a test pass, unless `ROLE_CAPABILITIES` moves in the same commit.
- Semantic color tokens only. No `bg-white`, no `text-black`.
- Every `hasCapability(...)` call in the UI pairs with `isResolved`. The idiom is at `src/pages/Expenses.tsx:94`.
- Migration timestamps must not collide with `main`. The latest migration on `origin/main` is `20260805160000_template_cascade_undo_restores_template.sql`. This plan uses `20260806100000` and `20260806110000`.
- One local Supabase instance serves about 28 worktrees. Before `npm run db:reset`, confirm no other worktree runs a test.
- Vitest takes `--reporter=dot`. `--reporter=line` is a Playwright reporter and crashes Vitest.
- In zsh, quote a glob argument: `grep -rn x --include='*.ts'`.

## File Structure

**Create**

| File | Responsibility |
|---|---|
| `supabase/migrations/20260806100000_seed_employee_sensitive_flags.sql` | Seed the two flags onto five builtin roles |
| `supabase/migrations/20260806110000_employee_column_gating.sql` | REVOKE/GRANT, the `employees_secure` view, the compensation-history policy |
| `supabase/tests/employee_column_gating_test.sql` | pgTAP for the grant posture and the view |
| `src/lib/employeeMaskedFields.ts` | The masked-field lists and the payload strip |
| `tests/unit/employeeMaskedFields.test.ts` | Vitest for the strip |
| `tests/e2e/sensitive-data-flags.spec.ts` | Playwright end-to-end proof |

**Modify**

| File | Responsibility |
|---|---|
| `src/lib/permissions/definitions.ts` | Add both flags to five roles |
| `src/lib/permissions/areas.ts` | Correct the `view:employee_pii` label and hint |
| `supabase/tests/roles_seed_test.sql` | Feed `role_flags` into the round trip |
| `src/integrations/supabase/types.ts` | Declare the `employees_secure` view |
| `src/types/scheduling.ts` | Add `is_minor` to `Employee` |
| `src/hooks/useEmployees.tsx` | Read the view, strip masked keys on write |
| `src/hooks/useCurrentEmployee.tsx` | Read the view |
| `src/hooks/useMonthlyMetrics.tsx` | Read the view |
| `src/hooks/useTimePunches.tsx` | Read the view |
| `src/hooks/useShifts.tsx` | Narrow the embed to granted columns |
| `src/hooks/useTimeOffRequests.tsx` | Narrow the embed to granted columns |
| `src/hooks/useScheduleChangeLogs.tsx` | Narrow the embed to granted columns |
| `src/components/EmployeeDialog.tsx` | Hide the eight fields, stop the erase |
| `src/components/EmployeeList.tsx` | Stop rendering a masked rate as `$0.00/hr`, read `is_minor` |
| `src/components/ReactivateEmployeeDialog.tsx` | Stop reporting a masked rate as "Not set" |
| `src/components/scheduling/WeekScheduleMobile.tsx` | Read `is_minor` |
| `src/components/scheduling/ShiftPlanner/EmployeeSidebar.tsx` | Read `is_minor` |
| `src/pages/Scheduling.tsx` | Read `is_minor` |
| `src/hooks/useEmployeeLaborCosts.tsx` | Stop understating labor cost on a masked rate |
| `src/components/scheduling/LaborCostBreakdown.tsx` | Render a masked cost as `—` |
| `src/components/scheduling/ScheduleMetricsRibbon.tsx` | Say when a total leaves rows out |

---

## Task 1: Seed the flags onto the builtin roles

**Warning: this task must land first.** Every builtin role holds zero `role_flags` rows today. A gate added before the seed locks out 72 production owners.

**Files:**
- Modify: `src/lib/permissions/definitions.ts`
- Create: `supabase/migrations/20260806100000_seed_employee_sensitive_flags.sql`
- Modify: `supabase/tests/roles_seed_test.sql:397-403`, `:439-449`, and the `test_expected_capabilities` fixture

**Interfaces:**
- Consumes: nothing.
- Produces: `user_has_capability(rid, 'view:pay_rates')` returns `TRUE` for a member whose role is Owner, Manager, Operations Manager, Accountant, or Operations Manager (Collaborator). Same for `view:employee_pii`.

**Why these five roles.** Each one already holds `view:employees`. Accountant and Operations Manager (Collaborator) also hold `view:payroll`. A three-role seed takes pay data away from the Accountant, who runs payroll today.

- [ ] **Step 1: Extend the round trip to read `role_flags`**

`derived_capabilities` at `supabase/tests/roles_seed_test.sql:397-403` reads `role_areas` only. A seeded flag is invisible to it, so the round trip would report every new flag as an under-grant. Replace the whole `CREATE TEMP TABLE` statement:

```sql
CREATE TEMP TABLE derived_capabilities AS
SELECT r.name AS role_name, acal.capability
FROM public.roles r
JOIN public.role_areas ra ON ra.role_id = r.id
JOIN test_area_capability_at_level acal
  ON acal.area_key = ra.area_key AND acal.level = ra.level
WHERE r.builtin = true AND r.restaurant_id IS NULL
UNION ALL
-- A sensitive flag is a capability with no area behind it. user_has_capability
-- resolves it straight off role_flags (20260805120000_page_areas.sql:322-327),
-- so the round trip must read the same source.
SELECT r.name AS role_name, rf.flag AS capability
FROM public.roles r
JOIN public.role_flags rf ON rf.role_id = r.id
WHERE r.builtin = true AND r.restaurant_id IS NULL;
```

- [ ] **Step 2: Replace the zero-rows assertion with the exact expected set**

Replace `supabase/tests/roles_seed_test.sql:439-449` — the comment block and the `SELECT is(...)` under it — with:

```sql
-- ============================================================================
-- 2. The two employee flags are seeded onto exactly the five builtin roles
--    that hold view:employees. view:costs stays unseeded: its gate is not
--    built yet, so seeding it would grant a capability nothing reads.
-- ============================================================================
SELECT set_eq(
  $$SELECT r.name || '|' || rf.flag
    FROM public.role_flags rf
    JOIN public.roles r ON r.id = rf.role_id
    WHERE r.builtin = true AND r.restaurant_id IS NULL$$,
  ARRAY[
    'Owner|view:pay_rates',
    'Owner|view:employee_pii',
    'Manager|view:pay_rates',
    'Manager|view:employee_pii',
    'Operations Manager|view:pay_rates',
    'Operations Manager|view:employee_pii',
    'Accountant|view:pay_rates',
    'Accountant|view:employee_pii',
    'Operations Manager (Collaborator)|view:pay_rates',
    'Operations Manager (Collaborator)|view:employee_pii'
  ],
  'the two employee flags are seeded onto exactly the five view:employees roles'
);
```

- [ ] **Step 3: Add the ten fixture rows**

`test_expected_capabilities` transcribes `ROLE_CAPABILITIES`. Add two rows for each of the five roles. Put each pair directly after that role's last existing row in the `INSERT INTO test_expected_capabilities ... VALUES` list. For Owner, the last row is `('Owner', 'manage:reviews'),` — insert after it:

```sql
  ('Owner', 'view:pay_rates'),
  ('Owner', 'view:employee_pii'),
```

Repeat for `'Manager'`, `'Operations Manager'`, `'Accountant'`, and `'Operations Manager (Collaborator)'`, each with its own role name. Find each role's last row with:

```bash
grep -n "^  ('Accountant'," supabase/tests/roles_seed_test.sql | tail -1
```

- [ ] **Step 4: Run the test to verify it fails**

```bash
npm run test:db
```

Expected: FAIL. `roles_seed_test.sql` reports the `set_eq` mismatch (zero rows found, ten expected) and ten under-grants across the five roles.

- [ ] **Step 5: Add the flags to `ROLE_CAPABILITIES`**

In `src/lib/permissions/definitions.ts`, append the two capability strings to five role arrays. Each of the five arrays ends with `'view:reviews',` then `'manage:reviews',`. Insert after `'manage:reviews',` in the `owner`, `manager`, `operations_manager`, `collaborator_accountant`, and `collaborator_operations_manager` blocks:

```typescript
    // Sensitive-data flags. These five roles hold view:employees, so the
    // Employees page and the Payroll page are already open to them. Without
    // the flags, 20260806110000 masks pay and contact data for every user.
    'view:pay_rates',
    'view:employee_pii',
```

Confirm the five blocks with:

```bash
grep -n "^  owner:\|^  manager:\|^  operations_manager:\|^  collaborator_accountant:\|^  collaborator_operations_manager:" src/lib/permissions/definitions.ts
```

- [ ] **Step 6: Write the seed migration**

Create `supabase/migrations/20260806100000_seed_employee_sensitive_flags.sql`:

```sql
-- Seed view:pay_rates and view:employee_pii onto the five builtin roles that
-- hold view:employees.
--
-- Every builtin role holds zero role_flags rows today, and every membership in
-- production carries a non-null role_id. So user_has_capability takes the flag
-- branch (20260805120000_page_areas.sql:322-327) and returns FALSE for every
-- caller. The column gate in 20260806110000 would therefore mask pay and
-- contact data for every user, including the restaurant owner.
--
-- This migration must run before that gate.
--
-- view:costs stays unseeded on purpose. Nothing reads it yet, so a grant would
-- express an intent no code enforces.
--
-- The list below matches ROLE_CAPABILITIES in src/lib/permissions/definitions.ts.
-- supabase/tests/roles_seed_test.sql asserts both sides byte-for-byte.

INSERT INTO public.role_flags (role_id, flag)
SELECT r.id, f.flag
FROM public.roles r
CROSS JOIN LATERAL (VALUES ('view:pay_rates'), ('view:employee_pii')) AS f(flag)
WHERE r.builtin = true
  AND r.restaurant_id IS NULL
  AND r.name IN (
    'Owner',
    'Manager',
    'Operations Manager',
    'Accountant',
    'Operations Manager (Collaborator)'
  )
ON CONFLICT (role_id, flag) DO NOTHING;
```

- [ ] **Step 7: Confirm no trigger blocks the insert**

`role_flags_block_builtin_mutation` at `20260730100000_roles_and_areas_tables.sql:467` fires `BEFORE UPDATE OR DELETE`, not `BEFORE INSERT`. So the seed passes with no `DISABLE TRIGGER`. Do not add one — `20260802100000_roles_legacy_role.sql:35` and `20260805120000_page_areas.sql:15` disable their triggers because they run `UPDATE`.

`role_flags` carries `PRIMARY KEY (role_id, flag)`, so the `ON CONFLICT (role_id, flag)` clause resolves. Confirm both facts before you continue:

```bash
grep -n -A 3 "CREATE TRIGGER role_flags_block_builtin_mutation" supabase/migrations/20260730100000_roles_and_areas_tables.sql
```

Expected: `BEFORE UPDATE OR DELETE ON public.role_flags`.

- [ ] **Step 8: Reset the local database and run both suites**

```bash
npm run db:reset && npm run test:db
```

Expected: PASS. `roles_seed_test.sql` reports 25 of 25.

```bash
npx vitest run tests/unit/routeAreas.test.ts --reporter=dot
```

Expected: PASS. The four collaborator allow-lists in that test are area-derived and must not move.

- [ ] **Step 9: Run the full unit suite**

```bash
npm run test -- --reporter=dot
```

Expected: PASS. If a test asserts an exact `ROLE_CAPABILITIES` length or set, update it to include the two new strings.

- [ ] **Step 10: Commit**

```bash
git add src/lib/permissions/definitions.ts supabase/migrations/20260806100000_seed_employee_sensitive_flags.sql supabase/tests/roles_seed_test.sql
git commit -m "feat(permissions): seed the employee flags onto the five view:employees roles"
```

---

## Task 2: Stop the write path from erasing masked data

**Warning: a masked column arrives as `NULL`, and the save path writes it back.** This task lands before the gate, so no deploy order can lose data.

**Files:**
- Create: `src/lib/employeeMaskedFields.ts`
- Create: `tests/unit/employeeMaskedFields.test.ts`
- Modify: `src/hooks/useEmployees.tsx:71-101` and `:103-134`
- Modify: `src/components/EmployeeDialog.tsx:551-553`, `:623`, `:872`, `:937`, `:1034`

**Interfaces:**
- Produces:
  - `PAY_RATE_FIELDS: readonly MaskedEmployeeField[]`
  - `EMPLOYEE_PII_FIELDS: readonly MaskedEmployeeField[]`
  - `type MaskedEmployeeField`
  - `maskedEmployeeFields(held: { payRates: boolean; employeePii: boolean }): MaskedEmployeeField[]`
  - `stripMaskedEmployeeFields<T extends object>(payload: T, masked: readonly MaskedEmployeeField[]): T`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/employeeMaskedFields.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import {
  EMPLOYEE_PII_FIELDS,
  PAY_RATE_FIELDS,
  maskedEmployeeFields,
  stripMaskedEmployeeFields,
} from '@/lib/employeeMaskedFields';

describe('maskedEmployeeFields', () => {
  it('masks nothing when the caller holds both flags', () => {
    expect(maskedEmployeeFields({ payRates: true, employeePii: true })).toEqual([]);
  });

  it('masks the pay fields when the caller lacks view:pay_rates', () => {
    expect(maskedEmployeeFields({ payRates: false, employeePii: true }))
      .toEqual([...PAY_RATE_FIELDS]);
  });

  it('masks the contact fields when the caller lacks view:employee_pii', () => {
    expect(maskedEmployeeFields({ payRates: true, employeePii: false }))
      .toEqual([...EMPLOYEE_PII_FIELDS]);
  });

  it('masks all eight fields when the caller holds neither flag', () => {
    expect(maskedEmployeeFields({ payRates: false, employeePii: false }))
      .toHaveLength(8);
  });
});

describe('stripMaskedEmployeeFields', () => {
  it('drops every masked key from the payload', () => {
    const payload = {
      id: 'e1',
      name: 'Ada',
      hourly_rate: 0,
      salary_amount: undefined,
      email: undefined,
      date_of_birth: null,
    };

    const result = stripMaskedEmployeeFields(payload, [
      'hourly_rate',
      'salary_amount',
      'email',
      'date_of_birth',
    ]);

    expect(result).toEqual({ id: 'e1', name: 'Ada' });
  });

  it('keeps a key that is not masked, even when its value is null', () => {
    const result = stripMaskedEmployeeFields(
      { id: 'e1', notes: null, hourly_rate: 0 },
      ['hourly_rate']
    );

    expect(result).toEqual({ id: 'e1', notes: null });
  });

  it('returns a new object and does not change the input', () => {
    const payload = { id: 'e1', hourly_rate: 0 };
    const result = stripMaskedEmployeeFields(payload, ['hourly_rate']);

    expect(result).not.toBe(payload);
    expect(payload).toEqual({ id: 'e1', hourly_rate: 0 });
  });

  it('drops nothing when the masked list is empty', () => {
    const payload = { id: 'e1', hourly_rate: 1500 };
    expect(stripMaskedEmployeeFields(payload, [])).toEqual(payload);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run tests/unit/employeeMaskedFields.test.ts --reporter=dot
```

Expected: FAIL with `Failed to resolve import "@/lib/employeeMaskedFields"`.

- [ ] **Step 3: Write the module**

Create `src/lib/employeeMaskedFields.ts`:

```typescript
/**
 * The eight columns of public.employees that 20260806110000 masks.
 *
 * The masking view returns NULL for a column the caller has no flag for. The
 * Edit Employee form then loads that NULL into its state and writes it back on
 * save. The column keeps its UPDATE grant, so the write succeeds and the real
 * value is gone.
 *
 * The strip below is the fix. It runs in the mutation hooks, not in the form:
 * four call sites write employees (EmployeeDialog, ShiftImportSheet,
 * TimePunchUploadSheet, useSlingEmployeeMapping), and a per-field gate in one
 * component protects one of them.
 */

/** Masked by view:pay_rates. */
export const PAY_RATE_FIELDS = [
  'hourly_rate',
  'salary_amount',
  'contractor_payment_amount',
  'daily_rate_amount',
  'daily_rate_reference_weekly',
] as const;

/** Masked by view:employee_pii. */
export const EMPLOYEE_PII_FIELDS = [
  'email',
  'phone',
  'date_of_birth',
] as const;

export type MaskedEmployeeField =
  | (typeof PAY_RATE_FIELDS)[number]
  | (typeof EMPLOYEE_PII_FIELDS)[number];

/** Which fields the caller may not read, and therefore may not write. */
export function maskedEmployeeFields(held: {
  payRates: boolean;
  employeePii: boolean;
}): MaskedEmployeeField[] {
  const masked: MaskedEmployeeField[] = [];
  if (!held.payRates) masked.push(...PAY_RATE_FIELDS);
  if (!held.employeePii) masked.push(...EMPLOYEE_PII_FIELDS);
  return masked;
}

/** Remove every masked key. Returns a new object. */
export function stripMaskedEmployeeFields<T extends object>(
  payload: T,
  masked: readonly MaskedEmployeeField[]
): T {
  if (masked.length === 0) return { ...payload };

  const blocked = new Set<string>(masked);
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(payload)) {
    if (!blocked.has(key)) result[key] = value;
  }

  return result as T;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run tests/unit/employeeMaskedFields.test.ts --reporter=dot
```

Expected: PASS, 8 tests.

- [ ] **Step 5: Wire the strip into both mutation hooks**

In `src/hooks/useEmployees.tsx`, add to the import block after line 3:

```typescript
import { usePermissions } from '@/hooks/usePermissions';
import {
  maskedEmployeeFields,
  stripMaskedEmployeeFields,
} from '@/lib/employeeMaskedFields';
```

Replace `useCreateEmployee` (lines 71-101) with:

```typescript
export const useCreateEmployee = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { hasCapability, isResolved } = usePermissions();

  return useMutation({
    mutationFn: async (employee: Omit<Employee, 'id' | 'created_at' | 'updated_at'>) => {
      // A caller with no flag cannot read these columns, so the form holds
      // NULL for them. Writing that NULL back would erase the stored value.
      const masked = maskedEmployeeFields({
        payRates: isResolved && hasCapability('view:pay_rates'),
        employeePii: isResolved && hasCapability('view:employee_pii'),
      });

      const { data, error } = await supabase
        .from('employees')
        .insert(stripMaskedEmployeeFields(employee, masked))
        .select('id, restaurant_id, name')
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['employees', data.restaurant_id] });
      toast({
        title: 'Employee created',
        description: `${data.name} has been added to the team.`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error creating employee',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
};
```

Replace `useUpdateEmployee` (lines 103-134) with:

```typescript
export const useUpdateEmployee = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { hasCapability, isResolved } = usePermissions();

  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<Employee> & { id: string }) => {
      const masked = maskedEmployeeFields({
        payRates: isResolved && hasCapability('view:pay_rates'),
        employeePii: isResolved && hasCapability('view:employee_pii'),
      });

      const { data, error } = await supabase
        .from('employees')
        .update(stripMaskedEmployeeFields(updates, masked))
        .eq('id', id)
        .select('id, restaurant_id, name')
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['employees', data.restaurant_id] });
      toast({
        title: 'Employee updated',
        description: `${data.name}'s information has been updated.`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error updating employee',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
};
```

The bare `.select()` becomes `.select('id, restaurant_id, name')`. A bare `.select()` after a mutation sends `Prefer: return=representation`, which needs SELECT on every column of the row. Task 3 revokes eight of them, so the bare form starts to fail with `permission denied for column hourly_rate`. Only those three fields reach `onSuccess`.

- [ ] **Step 6: Stop the dialog from fabricating a zero rate**

In `src/components/EmployeeDialog.tsx`, replace lines 551-553:

```typescript
    const hourlyRateInCents = compensationType === 'hourly' 
      ? Math.round(Number.parseFloat(hourlyRate || '0') * 100)
      : 0;
```

with:

```typescript
    // An empty box is "unknown", not "zero". A fabricated 0 reaches
    // hasCompensationChanged below, compares unequal to the real rate, and
    // writes a permanent $0.00 row into the compensation history.
    const hourlyRateInCents = compensationType === 'hourly' && hourlyRate.trim() !== ''
      ? Math.round(Number.parseFloat(hourlyRate) * 100)
      : undefined;
```

- [ ] **Step 7: Fix the two call sites that assume a number**

Three declarations type the value as `number`. Change each to `number | undefined`:

- line 323 — the field on the `hasCompensationChanged` payload interface
- line 354 — the `buildHistoryPayload` parameter
- line 608 — the `proceedWithSubmit` parameter

```bash
grep -n "hourlyRateInCents" src/components/EmployeeDialog.tsx
```

Two sites then read the value. Line 336 compares `existing.hourly_rate !== payload.hourlyRateInCents`. Lines 360-361 test `hourlyRateInCents > 0` before they build a history row; `undefined > 0` is `false`, so that site already skips an unknown rate.

Inside `hasCompensationChanged`, add a first guard so an unknown rate never counts as a change:

```typescript
  if (next.compensationType === 'hourly' && next.hourlyRateInCents === undefined) {
    return false;
  }
```

`buildHistoryPayload` needs no new guard. Its `hourlyRateInCents > 0` test at line 360 already returns `undefined` for an unknown rate, because `undefined > 0` is `false`. Change the parameter type only.

- [ ] **Step 8: Stop the dialog from erasing the date of birth**

Replace `src/components/EmployeeDialog.tsx:623`:

```typescript
      date_of_birth: dateOfBirth || null,
```

with:

```typescript
      // undefined drops out of the JSON body. null would erase a stored date
      // whenever the box is empty — which it always is under a masked read.
      date_of_birth: dateOfBirth || undefined,
```

- [ ] **Step 9: Drop `required` from the three pay inputs**

Three pay inputs carry `required`: `hourlyRate` at line 872, `salaryAmount` at line 937, and `contractorPaymentAmount` at line 1034. A masked field renders empty, so `required` blocks every save. Delete all three lines.

```bash
grep -n "^                      required$" src/components/EmployeeDialog.tsx
```

Expected before the edit: lines 872, 937, 1034. Expected after: no output.

- [ ] **Step 10: Type-check and run the unit suite**

```bash
npm run typecheck && npm run test -- --reporter=dot
```

Expected: PASS both.

- [ ] **Step 11: Commit**

```bash
git add src/lib/employeeMaskedFields.ts tests/unit/employeeMaskedFields.test.ts src/hooks/useEmployees.tsx src/components/EmployeeDialog.tsx
git commit -m "fix(employees): stop the save path from erasing a field the caller cannot read"
```

---

## Task 3: Add the column gate

**Files:**
- Create: `supabase/migrations/20260806110000_employee_column_gating.sql`
- Create: `supabase/tests/employee_column_gating_test.sql`

**Interfaces:**
- Consumes: `public.user_has_capability(uuid, text)` from `20260805120000_page_areas.sql`. The five seeded roles from Task 1.
- Produces: `public.employees_secure`, a view with 38 columns plus `is_minor boolean`. `authenticated` holds SELECT on it and on 30 columns of `public.employees`.

- [ ] **Step 1: Write the failing pgTAP test**

Create `supabase/tests/employee_column_gating_test.sql`:

```sql
-- ============================================================================
-- employee_column_gating_test.sql
--
-- Coverage for 20260806110000: the eight sensitive columns of public.employees
-- are revoked from `authenticated`, and public.employees_secure is the only
-- path to them.
--
-- Warning: a normal test role cannot read another role's column grants.
-- has_column_privilege raises "permission denied" unless the session is a
-- superuser. `SET LOCAL role TO postgres` is required, not decorative. The
-- same idiom is at supabase/tests/review_responses_rls_test.sql:98-110.
--
-- Warning: a grant-posture assertion that passes on a bare local Postgres has
-- proven nothing. Production creates every public table under `ALTER DEFAULT
-- PRIVILEGES ... GRANT ALL ON TABLES TO service_role`, and a local instance
-- has no such default to revoke. Read pg_default_acl before you trust a green.
-- ============================================================================
BEGIN;

SELECT plan(14);

SET LOCAL role TO postgres;

-- ----------------------------------------------------------------------------
-- 1. The eight sensitive columns are closed to `authenticated`.
-- ----------------------------------------------------------------------------
SELECT is(
  has_column_privilege('authenticated', 'public.employees', 'hourly_rate', 'SELECT'),
  FALSE, 'authenticated cannot SELECT employees.hourly_rate'
);
SELECT is(
  has_column_privilege('authenticated', 'public.employees', 'salary_amount', 'SELECT'),
  FALSE, 'authenticated cannot SELECT employees.salary_amount'
);
SELECT is(
  has_column_privilege('authenticated', 'public.employees', 'contractor_payment_amount', 'SELECT'),
  FALSE, 'authenticated cannot SELECT employees.contractor_payment_amount'
);
SELECT is(
  has_column_privilege('authenticated', 'public.employees', 'daily_rate_amount', 'SELECT'),
  FALSE, 'authenticated cannot SELECT employees.daily_rate_amount'
);
SELECT is(
  has_column_privilege('authenticated', 'public.employees', 'daily_rate_reference_weekly', 'SELECT'),
  FALSE, 'authenticated cannot SELECT employees.daily_rate_reference_weekly'
);
SELECT is(
  has_column_privilege('authenticated', 'public.employees', 'email', 'SELECT'),
  FALSE, 'authenticated cannot SELECT employees.email'
);
SELECT is(
  has_column_privilege('authenticated', 'public.employees', 'phone', 'SELECT'),
  FALSE, 'authenticated cannot SELECT employees.phone'
);
SELECT is(
  has_column_privilege('authenticated', 'public.employees', 'date_of_birth', 'SELECT'),
  FALSE, 'authenticated cannot SELECT employees.date_of_birth'
);

-- ----------------------------------------------------------------------------
-- 2. The 30 plain columns stay open, and anon stays shut.
-- ----------------------------------------------------------------------------
SELECT is(
  has_column_privilege('authenticated', 'public.employees', 'name', 'SELECT'),
  TRUE, 'authenticated can still SELECT employees.name'
);
SELECT is(
  has_column_privilege('authenticated', 'public.employees', 'restaurant_id', 'SELECT'),
  TRUE, 'authenticated can still SELECT employees.restaurant_id'
);
SELECT is(
  has_table_privilege('anon', 'public.employees_secure', 'SELECT'),
  FALSE, 'anon cannot SELECT the masking view'
);
SELECT is(
  has_table_privilege('authenticated', 'public.employees_secure', 'SELECT'),
  TRUE, 'authenticated can SELECT the masking view'
);

-- ----------------------------------------------------------------------------
-- 3. The view runs with owner rights and carries its own row predicate.
--    security_invoker must stay off: the caller no longer holds the column
--    privilege, so an invoker-rights view fails for everyone.
-- ----------------------------------------------------------------------------
SELECT is(
  (SELECT COALESCE(
     (SELECT option FROM unnest(c.reloptions) AS option
      WHERE option LIKE 'security_invoker=%'), 'unset')
   FROM pg_class c
   JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'employees_secure'),
  'unset',
  'employees_secure does not set security_invoker'
);

SELECT ok(
  (SELECT pg_get_viewdef('public.employees_secure'::regclass) LIKE '%user_restaurants%'),
  'employees_secure carries its own row predicate against user_restaurants'
);

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm run test:db
```

Expected: FAIL. `employee_column_gating_test.sql` reports `relation "public.employees_secure" does not exist`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260806110000_employee_column_gating.sql`:

```sql
-- Gate the eight sensitive columns of public.employees behind view:pay_rates
-- and view:employee_pii.
--
-- RLS filters rows. It cannot mask a column. A column GRANT is a role-level
-- privilege, so it cannot depend on user_has_capability. The mechanism is
-- therefore a column REVOKE plus a view that applies the capability check per
-- row.
--
-- The REVOKE is the control. The view is the accessor. A caller who goes
-- around the view hits the column ACL and gets "permission denied for column
-- hourly_rate". PostgREST cannot bypass the ACL.
--
-- Prerequisite: 20260806100000 seeds the two flags onto the five builtin roles
-- that hold view:employees. Without that seed this migration masks pay and
-- contact data for every user, the owner included.

-- ============================================================================
-- Step 1: the masking view
-- ============================================================================
--
-- security_invoker stays OFF, unlike its siblings active_employees and
-- inactive_employees. Do not "fix" this view to match them. The caller no
-- longer holds SELECT on the eight columns, so an invoker-rights view would
-- fail for everyone, flag or no flag.
--
-- An owner-rights view bypasses the base table's RLS, so the view carries its
-- own row predicate. That predicate is the union of the SELECT-capable
-- policies on public.employees:
--   "Team members can view coworkers in their restaurant" (membership)
--   "Users can view employees for their restaurants"      (view:employees)
--   "Owners and managers can manage employees"            (user_has_role)
--   "Employees can view their own record"                 (self)
-- The first is the widest: user_has_capability and user_has_role both read
-- user_restaurants, so both are subsets of the membership test. No user gains
-- or loses a row.
--
-- security_barrier protects the ROW filter from a cheap user-supplied
-- function that leaks values before the predicate runs. It does not protect
-- the column mask: a CASE in a target list is not a qual, and Postgres does
-- not reorder target-list evaluation.
--
-- The CROSS JOIN LATERAL computes the two booleans once per row. Eight
-- separate user_has_capability calls would be eight distinct expression
-- nodes, each evaluated per row — 1,600 calls for a 200-employee roster to
-- answer two questions. STABLE does not memoize across rows.
--
-- is_minor goes to every member. isMinor(date_of_birth) returns false for a
-- null date, so a masked date would silently delete the "Minor" badge from the
-- roster. That badge is a labor-compliance cue. The raw date stays gated.
CREATE VIEW public.employees_secure
WITH (security_barrier = true) AS
SELECT
  e.id,
  e.restaurant_id,
  e.name,
  e.position,
  e.area,
  e.status,
  e.hire_date,
  e.termination_date,
  e.notes,
  e.created_at,
  e.updated_at,
  e.user_id,
  e.compensation_type,
  e.pay_period_type,
  e.contractor_payment_interval,
  e.allocate_daily,
  e.tip_eligible,
  e.requires_time_punch,
  e.is_active,
  e.deactivation_reason,
  e.deactivated_at,
  e.deactivated_by,
  e.reactivated_at,
  e.reactivated_by,
  e.last_active_date,
  e.daily_rate_reference_days,
  e.is_exempt,
  e.exempt_changed_at,
  e.exempt_changed_by,
  e.employment_type,
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
        SELECT ur.restaurant_id
        FROM public.user_restaurants ur
        WHERE ur.user_id = auth.uid())
   OR e.user_id = auth.uid();

COMMENT ON VIEW public.employees_secure IS
  'Read path for public.employees. Returns NULL for a pay or contact column '
  'the caller has no flag for. Owner rights on purpose: authenticated holds '
  'no SELECT on those columns, so an invoker-rights view would fail for all.';

-- ============================================================================
-- Step 2: the grant posture
-- ============================================================================
--
-- Revoke from every role the stock ALTER DEFAULT PRIVILEGES entry grants to.
-- REVOKE ... FROM PUBLIC cannot undo a direct grant to anon or to
-- service_role, so name each one.
REVOKE SELECT ON public.employees FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT (
  id, restaurant_id, name, position, area, status, hire_date,
  termination_date, notes, created_at, updated_at, user_id,
  compensation_type, pay_period_type, contractor_payment_interval,
  allocate_daily, tip_eligible, requires_time_punch, is_active,
  deactivation_reason, deactivated_at, deactivated_by, reactivated_at,
  reactivated_by, last_active_date, daily_rate_reference_days,
  is_exempt, exempt_changed_at, exempt_changed_by, employment_type
) ON public.employees TO authenticated;

-- service_role keeps the whole table. The payroll edge functions need pay, and
-- rolbypassrls makes the table ACL the only control behind that role. State
-- the grant. Do not inherit it.
GRANT SELECT ON public.employees TO service_role;

GRANT  SELECT ON public.employees_secure TO authenticated;
REVOKE SELECT ON public.employees_secure FROM PUBLIC, anon;

-- ============================================================================
-- Step 3: employee_compensation_history
-- ============================================================================
--
-- The whole table is pay data, so a row policy states the rule exactly. No
-- view and no column grant are needed. PostgREST drops the embedded rows
-- under RLS with no error for the client to handle.
DROP POLICY IF EXISTS "Users can view compensation history for their restaurants"
  ON public.employee_compensation_history;

CREATE POLICY "Users can view compensation history for their restaurants"
  ON public.employee_compensation_history
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_restaurants ur
      WHERE ur.restaurant_id = employee_compensation_history.restaurant_id
        AND ur.user_id = auth.uid()
    )
    AND public.user_has_capability(
      employee_compensation_history.restaurant_id, 'view:pay_rates')
  );
```

- [ ] **Step 4: Reset the database and run the pgTAP suite**

```bash
npm run db:reset && npm run test:db
```

Expected: PASS. `employee_column_gating_test.sql` reports 14 of 14.

- [ ] **Step 5: Verify PostgREST resolves the embed from the view**

The client embeds `employee_compensation_history` off the employee row. PostgREST infers a view-to-table relationship only when the view column traces to the base column through `pg_depend`. `employees_secure.id` is a plain `e.id`, so the trace holds. Confirm it before the client work depends on it:

```bash
curl -s "http://127.0.0.1:54321/rest/v1/employees_secure?select=id,name,compensation_history:employee_compensation_history(id)&limit=1" \
  -H "apikey: $(grep ANON .env.local | head -1 | cut -d= -f2)" | head -c 400
```

Expected: `[]` or a JSON array. A body containing `"code":"PGRST200"` means the embed does not resolve. In that case, change Task 4 Step 3 to fetch compensation history in a second query keyed by `employee_id`, and record the change in the plan.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260806110000_employee_column_gating.sql supabase/tests/employee_column_gating_test.sql
git commit -m "feat(employees): gate the pay and contact columns behind the two flags"
```

---

## Task 4: Point every reader at the view

**Files:**
- Modify: `src/integrations/supabase/types.ts`
- Modify: `src/types/scheduling.ts:27-80`
- Modify: `src/hooks/useEmployees.tsx:33-38`
- Modify: `src/hooks/useCurrentEmployee.tsx:20-27`
- Modify: `src/hooks/useMonthlyMetrics.tsx:406-409`
- Modify: `src/hooks/useTimePunches.tsx:597-602`
- Modify: `src/hooks/useShifts.tsx:58-61`
- Modify: `src/hooks/useTimeOffRequests.tsx:13-20`
- Modify: `src/hooks/useScheduleChangeLogs.tsx:12-14`
- Modify: `src/components/EmployeeList.tsx:221-236` and `:294`
- Modify: `src/components/scheduling/WeekScheduleMobile.tsx:91`
- Modify: `src/components/scheduling/ShiftPlanner/EmployeeSidebar.tsx:32`, `:159`, `:180`
- Modify: `src/pages/Scheduling.tsx:1286`
- Modify: `src/hooks/useEmployeeLaborCosts.tsx:5-22`, `:40-46`, `:56-120`, `:129-148`
- Modify: `src/components/scheduling/LaborCostBreakdown.tsx`
- Modify: `src/components/scheduling/ScheduleMetricsRibbon.tsx:175`, `:241`
- Modify: `src/components/ReactivateEmployeeDialog.tsx:73-75`
- Modify: `src/lib/permissions/areas.ts:105-110`
- Create: `tests/e2e/sensitive-data-flags.spec.ts`

**Interfaces:**
- Consumes: `public.employees_secure` from Task 3.
- Produces: `Employee.is_minor?: boolean`.

- [ ] **Step 1: Declare the view in the generated types**

The repository has no type-generation script, so hand-add the entry. In `src/integrations/supabase/types.ts`, insert a new key inside the `Views` block that starts at line 10276. Put it after the `active_employees` block ends (the `]` and `}` at lines 10379-10380) and before `inactive_employees:`:

```typescript
      employees_secure: {
        Row: {
          allocate_daily: boolean | null
          area: string | null
          compensation_type: string | null
          contractor_payment_amount: number | null
          contractor_payment_interval: string | null
          created_at: string | null
          daily_rate_amount: number | null
          daily_rate_reference_days: number | null
          daily_rate_reference_weekly: number | null
          date_of_birth: string | null
          deactivated_at: string | null
          deactivated_by: string | null
          deactivation_reason: string | null
          email: string | null
          employment_type: string | null
          exempt_changed_at: string | null
          exempt_changed_by: string | null
          hire_date: string | null
          hourly_rate: number | null
          id: string | null
          is_active: boolean | null
          is_exempt: boolean | null
          is_minor: boolean | null
          last_active_date: string | null
          name: string | null
          notes: string | null
          pay_period_type: string | null
          phone: string | null
          position: string | null
          reactivated_at: string | null
          reactivated_by: string | null
          requires_time_punch: boolean | null
          restaurant_id: string | null
          salary_amount: number | null
          status: string | null
          termination_date: string | null
          tip_eligible: boolean | null
          updated_at: string | null
          user_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "employees_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
```

Then add a fourth entry to the `Relationships` array of `employee_compensation_history`, next to the three that already name `active_employees`, `employees`, and `inactive_employees` (around line 2330). Copy the `employees` entry and change one field:

```typescript
          {
            foreignKeyName: "employee_compensation_history_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees_secure"
            referencedColumns: ["id"]
          },
```

- [ ] **Step 2: Add `is_minor` to the `Employee` type**

In `src/types/scheduling.ts`, add to the `Employee` interface after the `date_of_birth` field:

```typescript
  /**
   * Computed by public.employees_secure, not by the client.
   *
   * date_of_birth is masked behind view:employee_pii, and isMinor() returns
   * false for a null date. Reading the badge off the raw date would delete a
   * labor-compliance cue for every user without the flag. The view returns
   * the boolean to every member and keeps the date gated.
   */
  is_minor?: boolean;
```

If `date_of_birth` is absent from the interface, add both fields together:

```typescript
  date_of_birth?: string;
```

- [ ] **Step 3: Point the four direct readers at the view**

`src/hooks/useEmployees.tsx:34` — change `.from('employees')` to `.from('employees_secure')`. Leave the select string as it is.

`src/hooks/useCurrentEmployee.tsx:22` — change `.from('employees')` to `.from('employees_secure')`.

`src/hooks/useMonthlyMetrics.tsx:408` — change `.from('employees')` to `.from('employees_secure')`.

`src/hooks/useTimePunches.tsx:599` — change `.from('employees')` to `.from('employees_secure')`.

- [ ] **Step 4: Narrow the three embeds**

A PostgREST resource embed resolves against the base table, not the view. `employees(*)` would ask for eight revoked columns and fail with `permission denied for column hourly_rate`. Replace `employees(*)` with an explicit list of granted columns at each site.

`src/hooks/useShifts.tsx:60`:

```typescript
        .select('*, employee:employees(id, name, position, area, status, is_active, employment_type, user_id)')
```

`src/hooks/useTimeOffRequests.tsx:15-18` — replace `employee:employees(*)` inside the template string with:

```typescript
          employee:employees(id, name, position, area, status, is_active, employment_type, user_id)
```

`src/hooks/useScheduleChangeLogs.tsx:17` — same replacement.

The three consumers read `employee.id`, `employee.name`, `employee.position`, `employee.is_active`, and `employee.employment_type`. None reads a masked column off a shift. Confirm before you commit:

```bash
grep -rn "employee\?\?\.\|\.employee\?\.\|\.employee\." src/components/scheduling src/pages/Scheduling.tsx | grep -o "employee[?]\{0,1\}\.[a-z_]*" | sort -u
```

Expected output: only `employee.id`, `employee.name`, `employee.position`, `employee.is_active`, `employee.employment_type`, and `employee.date_of_birth`. Every `date_of_birth` hit comes from the employees list, not from a shift embed — Step 5 replaces those.

- [ ] **Step 5: Read `is_minor` from the row**

Four components call `isMinor(employee.date_of_birth)`. Replace each call with `employee.is_minor`.

`src/components/EmployeeList.tsx:294` — `{isMinor(employee.date_of_birth) && (` becomes `{employee.is_minor && (`. Delete `isMinor` from the import at line 13 if nothing else in the file uses it.

`src/components/scheduling/WeekScheduleMobile.tsx:91` — `const isMinorEmployee = isMinor(employee.date_of_birth);` becomes `const isMinorEmployee = employee.is_minor === true;`. Delete the import at line 6.

`src/pages/Scheduling.tsx:1286` — same replacement. Delete the import at line 80.

`src/components/scheduling/ShiftPlanner/EmployeeSidebar.tsx` — replace `date_of_birth?: string;` at line 32 with `is_minor?: boolean;`, replace the call at line 159 with `{employee.is_minor && (`, and replace the memo comparison at line 180:

```typescript
    prev.employee.is_minor === next.employee.is_minor &&
```

`src/components/EmployeeDialog.tsx:1287` keeps `isMinor(dateOfBirth)`. That call reads the form's own state, which holds the value the user just typed. Leave it, and leave `computeAge` in `src/lib/employeeUtils.ts`.

- [ ] **Step 6: Stop rendering a masked rate as money**

In `src/components/EmployeeList.tsx`, replace `getCompensationDisplay` at lines 225-236:

```typescript
  const getCompensationDisplay = () => {
    // A masked column arrives as null. `$0.00/hr` would read as a real rate.
    switch (employee.compensation_type) {
      case 'hourly':
        return employee.hourly_rate == null
          ? 'Hidden'
          : `${formatCurrency(employee.hourly_rate)}/hr`;
      case 'salary':
        return employee.salary_amount == null
          ? 'Hidden'
          : `${formatCurrency(employee.salary_amount)}/${employee.pay_period_type}`;
      case 'contractor':
        return employee.contractor_payment_amount == null
          ? 'Hidden'
          : `${formatCurrency(employee.contractor_payment_amount)}/${employee.contractor_payment_interval}`;
      default:
        return '';
    }
  };
```

In `src/components/ReactivateEmployeeDialog.tsx:73-75`, read the current text first. Change the fallback so a `null` rate reads `Hidden`, not `Not set`.

- [ ] **Step 7: Stop understating labor cost**

All four branches of the switch at `src/hooks/useEmployeeLaborCosts.tsx:61-100` produce `cost = 0` for a masked value. The `hourly` branch reads `(emp.hourly_rate || 0)`. The other three sit behind an `if (emp.<column> && …)` that a `null` fails. So the page reports a labor cost far below the real one, and the P&L follows it.

Mark the row instead. Add the two fields first — `src/hooks/useEmployeeLaborCosts.tsx:5-22`:

```typescript
export interface EmployeeLaborCost {
  id: string;
  name: string;
  position: string;
  hours: number;
  rate: number; // Effective hourly rate in dollars
  cost: number; // Total cost in dollars
  compensationType: string;
  isOutlier: boolean;
  outlierLevel: 'none' | 'warning' | 'critical';
  /** True when the caller has no view:pay_rates, so cost and rate are unknown. */
  costIsHidden: boolean;
}

export interface LaborCostSummary {
  totalCost: number;
  totalHours: number;
  averageHourlyRate: number;
  isAverageHigh: boolean;
  employeeCosts: EmployeeLaborCost[];
  /** How many employees the totals leave out because their pay is masked. */
  hiddenCostCount: number;
}
```

Add `hiddenCostCount: 0` to the early return at lines 40-46.

Insert the guard directly after `const hours = …` at line 56, before `let rate = 0;`:

```typescript
      // A masked pay column arrives as null. A $0 cost understates labor and
      // drives a wrong P&L, so mark the row unknown and leave it out of the
      // totals. The hours stay visible: they are not pay data.
      const payIsHidden =
        (emp.compensation_type === 'hourly' && emp.hourly_rate == null) ||
        (emp.compensation_type === 'salary' && emp.salary_amount == null) ||
        (emp.compensation_type === 'daily_rate' && emp.daily_rate_amount == null) ||
        (emp.compensation_type === 'contractor' && emp.contractor_payment_amount == null);
```

Guard the switch so a masked row never enters it. Replace `switch (emp.compensation_type) {` at line 61 with:

```typescript
      if (!payIsHidden) switch (emp.compensation_type) {
```

Add the field to the `employeeCostsMap.set` call at lines 110-120:

```typescript
        outlierLevel,
        costIsHidden: payIsHidden,
```

A masked row keeps `rate = 0`, so `outlierLevel` stays `'none'` and no false typo warning appears.

Exclude masked rows from every total. Replace lines 129-136:

```typescript
    // A masked row has no cost to add. Counting its 0 would drag the average
    // down and understate the total.
    const visibleCosts = employeeCosts.filter(e => !e.costIsHidden);
    const hiddenCostCount = employeeCosts.length - visibleCosts.length;

    // Calculate totals (only from hourly employees for meaningful average)
    const hourlyEmployees = visibleCosts.filter(e => e.compensationType === 'hourly');
    const totalHourlyCost = hourlyEmployees.reduce((sum, e) => sum + e.cost, 0);
    const totalHourlyHours = hourlyEmployees.reduce((sum, e) => sum + e.hours, 0);

    const totalCost = visibleCosts.reduce((sum, e) => sum + e.cost, 0);
    const totalHours = visibleCosts.reduce((sum, e) => sum + e.hours, 0);
```

Add `hiddenCostCount,` to the returned object at lines 142-148.

Then fix the two consumers.

`src/components/scheduling/LaborCostBreakdown.tsx` renders a row per `EmployeeLaborCost`. Find the line that prints the cost and show `—` when the row is masked:

```typescript
{employee.costIsHidden ? '—' : `$${employee.cost.toFixed(2)}`}
```

Give the dash an accessible name so a screen reader states the reason:

```typescript
<span aria-label={employee.costIsHidden ? 'Labor cost hidden' : undefined}>
```

`src/components/scheduling/ScheduleMetricsRibbon.tsx:175` and `:241` print `${laborCostSummary.averageHourlyRate.toFixed(2)}/hr`. A partial total must say so. Add next to each:

```typescript
{laborCostSummary.hiddenCostCount > 0 && (
  <span className="text-[11px] text-muted-foreground ml-1">
    ({laborCostSummary.hiddenCostCount} hidden)
  </span>
)}
```

- [ ] **Step 8: Correct the flag label and hint**

In `src/lib/permissions/areas.ts`, replace lines 107-108:

```typescript
    name: 'Contact details & tax IDs',
    hint: 'Phone, address, last 4 of SSN',
```

with:

```typescript
    name: 'Contact details',
    hint: 'Email, phone, date of birth',
```

Schema `public` has no `ssn` column, no `tax_id` column, and no employee address column. The old text named data the app does not store.

- [ ] **Step 9: Type-check, lint, and run the unit suite**

```bash
npm run typecheck && npm run lint && npm run test -- --reporter=dot
```

Expected: PASS all three.

- [ ] **Step 10: Write the end-to-end proof**

Create `tests/e2e/sensitive-data-flags.spec.ts`:

```typescript
import { expect, test } from '@playwright/test';
import { generateTestUser } from '../helpers/e2e-supabase';

// A role without view:pay_rates opens the roster and sees no pay.
//
// The gate is in Postgres, so the check that matters is the response body, not
// the rendered text. A client-only gate would still ship the rate over the
// wire, and this role is collaborator-flavored — an external person who can
// call PostgREST with their own token.
test('a role without view:pay_rates receives no rate from PostgREST', async ({ page }) => {
  const user = generateTestUser();

  // Fill in the project's own sign-in and seed helpers here. Read
  // tests/e2e/helpers/e2e-supabase.ts and copy the pattern an existing spec
  // uses to create a restaurant, a custom role with the scheduling area and no
  // sensitive flag, and a membership for `user`.

  const bodies: unknown[] = [];
  page.on('response', async (response) => {
    if (response.url().includes('/rest/v1/employees_secure')) {
      bodies.push(await response.json().catch(() => null));
    }
  });

  await page.goto('/scheduling');
  await expect(page.getByRole('heading', { name: /schedule/i })).toBeVisible();

  const rows = bodies.flat().filter(Boolean) as Array<Record<string, unknown>>;
  expect(rows.length).toBeGreaterThan(0);
  for (const row of rows) {
    expect(row.hourly_rate).toBeNull();
    expect(row.email).toBeNull();
  }
});
```

Read an existing spec in `tests/e2e/` first and copy its sign-in and seed helpers into the marked block. Do not invent a helper name.

- [ ] **Step 11: Run the end-to-end suite**

```bash
npm run test:e2e -- tests/e2e/sensitive-data-flags.spec.ts --reporter=line
```

Expected: PASS. The Bash tool's own `timeout` parameter bounds this run. Do not write a poll loop.

- [ ] **Step 12: Commit**

```bash
git add src/integrations/supabase/types.ts src/types/scheduling.ts src/hooks/useEmployees.tsx src/hooks/useCurrentEmployee.tsx src/hooks/useMonthlyMetrics.tsx src/hooks/useTimePunches.tsx src/hooks/useShifts.tsx src/hooks/useTimeOffRequests.tsx src/hooks/useScheduleChangeLogs.tsx src/hooks/useEmployeeLaborCosts.tsx src/components/EmployeeList.tsx src/components/ReactivateEmployeeDialog.tsx src/components/scheduling/WeekScheduleMobile.tsx src/components/scheduling/LaborCostBreakdown.tsx src/components/scheduling/ScheduleMetricsRibbon.tsx src/components/scheduling/ShiftPlanner/EmployeeSidebar.tsx src/pages/Scheduling.tsx src/lib/permissions/areas.ts tests/e2e/sensitive-data-flags.spec.ts
git commit -m "feat(employees): read pay and contact data through the masking view"
```

---

## Verification

- [ ] **Run every suite**

```bash
npm run typecheck && npm run lint && npm run test:all
```

- [ ] **Check the grant posture against production defaults**

A grant assertion that passes locally has proven nothing. A bare local Postgres has no default privileges to revoke. Read them:

```sql
SELECT defaclrole::regrole, defaclobjtype, defaclacl FROM pg_default_acl;
```

If a default grants `ALL ON TABLES` to `service_role`, the migration's `REVOKE` is load-bearing and the local green is not proof. Confirm the same posture in the CI run.

- [ ] **Check the migration version against `main`**

A version collision with `main` is invisible to every local run and to the `push` event. Only the `pull_request` event catches it.

```bash
git fetch origin main && git ls-tree --name-only origin/main supabase/migrations/ | tail -3
```

Expected: no file named `20260806100000_*` or `20260806110000_*`.

- [ ] **Confirm no reader still hits the base table**

```bash
grep -rn "from('employees')" src/ --include='*.ts' --include='*.tsx'
```

Expected: only the two mutation hooks in `src/hooks/useEmployees.tsx`, the writers in `ShiftImportSheet.tsx`, `TimePunchUploadSheet.tsx`, and `useSlingEmployeeMapping.ts`, and `useDeleteEmployee`. A view with `CASE` expressions is not writable, so every write stays on the base table.

## Known limits

- **Row access to `employees` stays broad.** `20260411100000_staff_can_view_coworkers.sql` states why: staff must see coworker names for shift trades. This plan gates columns, not rows.
- **`view:costs` is out of scope.** 25 columns across 14 tables, and two paths that auto-write recomputed costs on page load.
- **The `employees` UPDATE mismatch stays open.** `UPDATE` needs `user_has_role(restaurant_id, ARRAY['owner','manager','operations_manager'])`, and `user_has_role` matches the legacy `user_restaurants.role` string, which is `collaborator_custom` for a custom collaborator. So the "Update Employee" button fails for that user. A write-path authorization change does not belong in a read-path security patch.
