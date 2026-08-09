# Sensitive-data UI gating Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gate the Employee dialog inputs and fix the Role editor copy so the UI matches the SQL enforcement that PR #727 shipped.

**Architecture:** Client-side gating only. Reuse the existing `usePermissions()` hook and the live `disabled={!canSeePayRates}` pattern. Add one derived value `canSeePii`, disable the three PII inputs and the four pay-schedule controls, and rewrite one RoleEditor paragraph plus its code comment. No SQL, no masked view, no column REVOKE.

**Tech Stack:** React 18 + TypeScript + Vite, shadcn/ui (Radix `Select`, `Checkbox`, `Input`), Vitest + React Testing Library.

## Global Constraints

- Client-side gating only. Do NOT change SQL, the masked view `employees_secure`, or the column REVOKE.
- ASD-STE100 for all prose and copy (chat, plan, commits, code comments).
- Never commit to `main`. Work on branch `fix/sensitive-data-ui-gating` in worktree `.claude/worktrees/sensitive-data-ui-gating`.
- Stage explicit paths with `git add <path>`. Never `git add -A`, `git add .`, or `git commit -a`.
- Never stage `progress.md` (gitignored).
- Commit messages end with: `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- Out of scope: the IncomeStatement "Payroll Expense (unposted)" residual (separate later PR).
- Design doc: `docs/superpowers/specs/2026-08-09-sensitive-data-ui-gating-design.md`.

---

### Task 1: RoleEditor copy and comment (Fix 1)

**Files:**
- Modify: `src/components/roles/RoleEditor.tsx:656-665`
- Test: `tests/unit/RoleEditor.test.tsx`

**Interfaces:**
- Consumes: nothing new. The paragraph is static text inside the "Sensitive data" band, above the `SENSITIVE_FLAGS.map(...)` (`src/components/roles/RoleEditor.tsx:667`). It renders for any role, including a blank draft (`role={null}`).
- Produces: new user-visible copy. Later tasks do not depend on it.

- [ ] **Step 1: Write the failing test**

Add this test inside the `describe('RoleEditor', ...)` block in `tests/unit/RoleEditor.test.tsx` (for example, after the test at line 296 that counts the three switches):

```tsx
it('states which sensitive-data flags are enforced and which is not', () => {
  render(<RoleEditor {...editorProps} restaurantId="rest-1" role={null} onBack={vi.fn()} />, { wrapper });

  // The enforced flags are named as enforced.
  expect(screen.getByText(/pay rates and contact details now gate real reads/i)).toBeInTheDocument();
  // The deferred flag is named as not yet in force.
  expect(screen.getByText(/costs switch has no effect yet/i)).toBeInTheDocument();

  // The stale "not enforced yet" framing is gone.
  expect(screen.queryByText(/not enforced yet/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/per-field gating ships/i)).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/RoleEditor.test.tsx -t "states which sensitive-data flags"`
Expected: FAIL. The old paragraph still says "not enforced yet" and "per-field gating ships", so the two `queryByText(...).not.toBeInTheDocument()` assertions fail and the two positive `getByText` assertions throw "Unable to find an element".

- [ ] **Step 3: Rewrite the comment and the paragraph**

In `src/components/roles/RoleEditor.tsx`, replace the comment at lines 656-661:

```tsx
                {/* State plainly what these switches do now. Pay rates and
                    contact details gate real reads. PR #727 enforces them
                    through employees_secure and the column REVOKE. A role
                    without the switch cannot see those fields. view:costs is
                    not gated yet. No screen and no RLS policy reads it, so its
                    switch changes nothing. The copy below keeps that caveat. */}
```

Replace the paragraph at lines 662-665:

```tsx
                <p className="text-[12px] text-muted-foreground pb-2">
                  Pay rates and contact details now gate real reads. A role without the switch
                  cannot see those fields. Item costs still follow area access. The costs switch
                  has no effect yet.
                </p>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/RoleEditor.test.tsx -t "states which sensitive-data flags"`
Expected: PASS.

- [ ] **Step 5: Run the whole RoleEditor suite to confirm no regression**

Run: `npx vitest run tests/unit/RoleEditor.test.tsx`
Expected: PASS (all tests, including the pre-existing copy assertions).

- [ ] **Step 6: Commit**

```bash
git add src/components/roles/RoleEditor.tsx tests/unit/RoleEditor.test.tsx
git commit -m "$(cat <<'EOF'
fix(roles): correct the sensitive-data copy for the enforced flags

PR #727 made view:pay_rates and view:employee_pii real in SQL. The
RoleEditor paragraph still said the flags are "not enforced yet". State
the split: pay rates and contact details gate real reads now; item costs
still follow area access.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Gate the PII inputs in EmployeeDialog (Fix 2)

**Files:**
- Modify: `src/components/EmployeeDialog.tsx:119` (add `canSeePii`), `:1248` (email), `:1261` (phone), `:1358` (dateOfBirth)
- Create: `tests/unit/EmployeeDialog.sensitiveGating.test.tsx`
- Modify: `tests/unit/EmployeeDialog.maskedDob.test.tsx` (make the two premises honest under the new gate)

**Interfaces:**
- Consumes: `usePermissions()` → `{ hasCapability, isResolved }`, already imported (`src/components/EmployeeDialog.tsx:12`) and destructured (`:118`). Existing derived value `canSeePayRates` (`:119`).
- Produces: `const canSeePii = isPermissionsResolved && hasCapability('view:employee_pii');`. Used by Task 2 only (the PII inputs). Task 3 uses the pre-existing `canSeePayRates`.

- [ ] **Step 1: Write the failing test file**

Create `tests/unit/EmployeeDialog.sensitiveGating.test.tsx`:

```tsx
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { EmployeeDialog } from '@/components/EmployeeDialog';

// Per-test control of the capability check: some tests grant view:employee_pii,
// some grant view:pay_rates, some grant nothing. vi.hoisted lets the factory
// below close over one shared mock function.
const { mockHasCapability } = vi.hoisted(() => ({ mockHasCapability: vi.fn() }));

vi.mock('@/hooks/useEmployees', () => ({
  useCreateEmployee: () => ({ mutateAsync: vi.fn().mockResolvedValue({ id: 'emp-1' }), isPending: false }),
  useUpdateEmployee: () => ({ mutateAsync: vi.fn().mockResolvedValue({ id: 'emp-1' }), isPending: false }),
}));

vi.mock('@/hooks/useBulkSetAvailability', () => ({
  useBulkSetAvailability: () => ({ mutateAsync: vi.fn().mockResolvedValue({}), isPending: false }),
}));

vi.mock('@/hooks/useShiftTemplates', () => {
  const STABLE_TEMPLATES: never[] = [];
  return {
    useShiftTemplates: () => ({
      templates: STABLE_TEMPLATES,
      loading: false,
      error: null,
      createTemplate: () => Promise.resolve(),
      updateTemplate: () => Promise.resolve(),
      deleteTemplate: () => Promise.resolve(),
    }),
  };
});

vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => ({ selectedRestaurant: { restaurant: { id: 'r1', timezone: 'UTC' } } }),
}));

// EmployeeAppAccessRow (mounted by every EmployeeDialog render) calls useAuth,
// which throws without an AuthProvider by design. Nothing here asserts on app
// access — this just keeps the dialog mountable.
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'caller-1' } }) }));

vi.mock('@/hooks/usePermissions', () => ({
  usePermissions: () => ({ hasCapability: mockHasCapability, isResolved: true }),
}));

vi.mock('@/integrations/supabase/client', () => {
  // Recursive fluent-builder mock — must be `any` because the chain can call
  // any subset of methods in any order; a typed interface would require an
  // exhaustive intersection of all Supabase builder return types.
  function makeChain(): any { // eslint-disable-line @typescript-eslint/no-explicit-any
    const chain: any = {}; // eslint-disable-line @typescript-eslint/no-explicit-any
    chain.select = () => makeChain();
    chain.eq = () => makeChain();
    chain.not = () => makeChain();
    chain.order = () => Promise.resolve({ data: [], error: null });
    chain.is = () => makeChain();
    chain.single = () => Promise.resolve({ data: null, error: null });
    chain.upsert = () => Promise.resolve({ data: null, error: null });
    chain.insert = () => makeChain();
    chain.update = () => makeChain();
    chain.then = (resolve: (v: { data: any[]; error: null }) => any) => // eslint-disable-line @typescript-eslint/no-explicit-any
      Promise.resolve({ data: [], error: null }).then(resolve);
    chain.catch = () => Promise.resolve({ data: [], error: null });
    return chain;
  }
  return {
    supabase: {
      functions: { invoke: () => Promise.resolve({ data: null, error: null }) },
      from: () => makeChain(),
    },
  };
});

const BASE_EMPLOYEE = {
  id: 'emp-1',
  restaurant_id: 'r1',
  name: 'Alex Valdez',
  position: 'Server',
  status: 'active' as const,
  is_active: true,
  employment_type: 'full_time' as const,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

// One fixture per compensation type — the pay-schedule controls each render
// only under their type: salary → Pay Period + Allocate Daily; contractor →
// Payment Interval; daily_rate → Standard Work Days.
const HOURLY_EMPLOYEE = { ...BASE_EMPLOYEE, compensation_type: 'hourly' as const, hourly_rate: 2000 };
const SALARY_EMPLOYEE = { ...BASE_EMPLOYEE, compensation_type: 'salary' as const };
const CONTRACTOR_EMPLOYEE = { ...BASE_EMPLOYEE, compensation_type: 'contractor' as const };
const DAILY_RATE_EMPLOYEE = { ...BASE_EMPLOYEE, compensation_type: 'daily_rate' as const };

function renderEdit(employee: typeof BASE_EMPLOYEE) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, staleTime: Infinity } },
  });
  return render(
    <QueryClientProvider client={qc}>
      {/* cast: test fixture omits optional Employee fields */}
      <EmployeeDialog open onOpenChange={vi.fn()} restaurantId="r1" employee={employee as any} /> {/* eslint-disable-line @typescript-eslint/no-explicit-any */}
    </QueryClientProvider>,
  );
}

describe('EmployeeDialog — sensitive-data input gating', () => {
  beforeEach(() => {
    mockHasCapability.mockReset();
  });

  it('disables email, phone, and date of birth when the caller lacks view:employee_pii', () => {
    mockHasCapability.mockReturnValue(false);
    renderEdit(HOURLY_EMPLOYEE);

    expect(screen.getByLabelText(/employee email/i)).toBeDisabled();
    expect(screen.getByLabelText(/employee phone number/i)).toBeDisabled();
    expect(screen.getByLabelText(/date of birth/i)).toBeDisabled();
  });

  it('enables email, phone, and date of birth when the caller holds view:employee_pii', () => {
    mockHasCapability.mockImplementation((c: string) => c === 'view:employee_pii');
    renderEdit(HOURLY_EMPLOYEE);

    expect(screen.getByLabelText(/employee email/i)).not.toBeDisabled();
    expect(screen.getByLabelText(/employee phone number/i)).not.toBeDisabled();
    expect(screen.getByLabelText(/date of birth/i)).not.toBeDisabled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/EmployeeDialog.sensitiveGating.test.tsx -t "disables email"`
Expected: FAIL. The three inputs have no `disabled` prop yet, so `toBeDisabled()` fails.

- [ ] **Step 3: Add the `canSeePii` derived value**

In `src/components/EmployeeDialog.tsx`, after the `canSeePayRates` line (`:119`), add:

```tsx
  // Contact details (email, phone, date of birth) gate on view:employee_pii,
  // the same way pay amounts gate on view:pay_rates. The write path already
  // strips these keys for a caller without the flag, so this gate makes the
  // disabled state honest and stops a masked blank box from reading as a clear.
  const canSeePii = isPermissionsResolved && hasCapability('view:employee_pii');
```

- [ ] **Step 4: Gate the three PII inputs**

In `src/components/EmployeeDialog.tsx`, add `disabled={!canSeePii}` to each input.

Email (`:1247-1255`):

```tsx
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => handleEmailChange(e.target.value)}
                    placeholder="john@example.com"
                    aria-label="Employee email"
                    disabled={!canSeePii}
                    className="h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg focus-visible:ring-1 focus-visible:ring-border"
                  />
```

Phone (`:1260-1268`):

```tsx
                  <Input
                    id="phone"
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="(555) 123-4567"
                    aria-label="Employee phone number"
                    disabled={!canSeePii}
                    className="h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg focus-visible:ring-1 focus-visible:ring-border"
                  />
```

Date of birth (`:1357-1364`):

```tsx
                  <Input
                    id="dateOfBirth"
                    type="date"
                    value={dateOfBirth}
                    onChange={(e) => setDateOfBirth(e.target.value)}
                    aria-label="Date of birth"
                    disabled={!canSeePii}
                    className="h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg focus-visible:ring-1 focus-visible:ring-border"
                  />
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/unit/EmployeeDialog.sensitiveGating.test.tsx`
Expected: PASS (both PII tests).

- [ ] **Step 6: Fix the two premises in `EmployeeDialog.maskedDob.test.tsx`**

Fix 2 disables the date-of-birth input for a caller without `view:employee_pii`. The two tests in `tests/unit/EmployeeDialog.maskedDob.test.tsx` have opposite permission premises but no `usePermissions` mock, so both fall through to a null-role branch and the second test only stays green because `fireEvent.change` bypasses `disabled`. Make each premise honest and assert the gate.

Add the hoisted mock. At the top of the file, after the imports (line 5) and before `const updateMock` (line 12), insert:

```tsx
const { mockHasCapability } = vi.hoisted(() => ({ mockHasCapability: vi.fn() }));
```

Add the `usePermissions` mock next to the other `vi.mock(...)` calls (for example after the `useAuth` mock at line 47):

```tsx
vi.mock('@/hooks/usePermissions', () => ({
  usePermissions: () => ({ hasCapability: mockHasCapability, isResolved: true }),
}));
```

In test 1 (`never sends date_of_birth: null for a masked (blank) date box on save`, line 119), set the no-PII premise and assert the box is disabled. Replace the body from `renderEdit();` (line 120) down to the `expect(dobInput.value).toBe('');` line (line 124) with:

```tsx
    // A masked (no-PII) caller: the date box is gated and blank.
    mockHasCapability.mockImplementation((c: string) => c !== 'view:employee_pii');
    renderEdit();

    const dobInput = screen.getByLabelText(/date of birth/i) as HTMLInputElement;
    expect(dobInput.value).toBe('');
    expect(dobInput).toBeDisabled();
```

In test 2 (`sends date_of_birth: null when a caller who can see the date clears it`, line 138), set the has-PII premise and assert the box is enabled. Replace the body from `renderEdit(VISIBLE_DOB_EMPLOYEE);` (line 139) down to the `expect(dobInput.value).toBe('2000-01-01');` line (line 142) with:

```tsx
    // A caller who holds view:employee_pii: the date box is editable and shows
    // the real date of birth.
    mockHasCapability.mockReturnValue(true);
    renderEdit(VISIBLE_DOB_EMPLOYEE);

    const dobInput = screen.getByLabelText(/date of birth/i) as HTMLInputElement;
    expect(dobInput.value).toBe('2000-01-01');
    expect(dobInput).not.toBeDisabled();
```

- [ ] **Step 7: Run both EmployeeDialog suites to verify they pass**

Run: `npx vitest run tests/unit/EmployeeDialog.maskedDob.test.tsx tests/unit/EmployeeDialog.sensitiveGating.test.tsx`
Expected: PASS (four tests total).

- [ ] **Step 8: Commit**

```bash
git add src/components/EmployeeDialog.tsx tests/unit/EmployeeDialog.sensitiveGating.test.tsx tests/unit/EmployeeDialog.maskedDob.test.tsx
git commit -m "$(cat <<'EOF'
fix(employees): gate the PII inputs on view:employee_pii

Disable email, phone, and date of birth for a caller without
view:employee_pii. The write path already strips these keys, so the gate
makes the disabled state honest and stops a masked blank box from reading
as an intent to clear. Also fix the two maskedDob test premises, which the
new gate would otherwise make misleading.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Gate the pay-schedule controls in EmployeeDialog (Fix 3)

**Files:**
- Modify: `src/components/EmployeeDialog.tsx:1038` (Pay Period), `:1055` (Allocate Daily), `:1120` (Payment Interval), `:1186` (Standard Work Days)
- Test: `tests/unit/EmployeeDialog.sensitiveGating.test.tsx` (extend)

**Interfaces:**
- Consumes: the pre-existing `canSeePayRates` (`src/components/EmployeeDialog.tsx:119`). No new value.
- Produces: nothing new. These are the last four unguarded pay controls.

- [ ] **Step 1: Write the failing tests**

Append these tests inside the `describe('EmployeeDialog — sensitive-data input gating', ...)` block in `tests/unit/EmployeeDialog.sensitiveGating.test.tsx` (after the two PII tests, before the closing `});`):

```tsx
  it('disables the salary pay-schedule controls when the caller lacks view:pay_rates', () => {
    mockHasCapability.mockReturnValue(false);
    renderEdit(SALARY_EMPLOYEE);

    expect(screen.getByRole('combobox', { name: /pay period/i })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: /allocate to daily/i })).toBeDisabled();
  });

  it('disables the contractor payment interval when the caller lacks view:pay_rates', () => {
    mockHasCapability.mockReturnValue(false);
    renderEdit(CONTRACTOR_EMPLOYEE);

    expect(screen.getByRole('combobox', { name: /payment interval/i })).toBeDisabled();
  });

  it('disables the daily-rate standard work days when the caller lacks view:pay_rates', () => {
    mockHasCapability.mockReturnValue(false);
    renderEdit(DAILY_RATE_EMPLOYEE);

    expect(screen.getByRole('combobox', { name: /standard work days/i })).toBeDisabled();
  });

  it('enables the salary pay-schedule controls when the caller holds view:pay_rates', () => {
    mockHasCapability.mockImplementation((c: string) => c === 'view:pay_rates');
    renderEdit(SALARY_EMPLOYEE);

    expect(screen.getByRole('combobox', { name: /pay period/i })).not.toBeDisabled();
    expect(screen.getByRole('checkbox', { name: /allocate to daily/i })).not.toBeDisabled();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/EmployeeDialog.sensitiveGating.test.tsx -t "pay-schedule"`
Expected: FAIL for the three "disables ..." tests. The four controls have no `disabled` prop yet, so `toBeDisabled()` fails. (The "enables ..." test may pass early since the controls are enabled by default — that is expected; it locks the enabled path.)

- [ ] **Step 3: Gate the four pay-schedule controls**

In `src/components/EmployeeDialog.tsx`, add `disabled={!canSeePayRates}` to each control.

Pay Period `Select` root (`:1038-1041`):

```tsx
                    <Select
                      value={payPeriodType}
                      onValueChange={(value) => setPayPeriodType(value as PayPeriodType)}
                      disabled={!canSeePayRates}
                    >
```

Allocate Daily `Checkbox` (`:1055-1060`):

```tsx
                      <Checkbox
                        id="allocateDaily"
                        checked={allocateDaily}
                        onCheckedChange={(checked) => setAllocateDaily(checked === true)}
                        aria-label="Allocate to Daily P&L"
                        disabled={!canSeePayRates}
                      />
```

Payment Interval `Select` root (`:1120-1123`):

```tsx
                    <Select
                      value={contractorPaymentInterval}
                      onValueChange={(value) => setContractorPaymentInterval(value as ContractorPaymentInterval)}
                      disabled={!canSeePayRates}
                    >
```

Standard Work Days `Select` root (`:1186-1189`):

```tsx
                    <Select
                      value={dailyRateStandardDays}
                      onValueChange={setDailyRateStandardDays}
                      disabled={!canSeePayRates}
                    >
```

- [ ] **Step 4: Run the full sensitiveGating suite to verify it passes**

Run: `npx vitest run tests/unit/EmployeeDialog.sensitiveGating.test.tsx`
Expected: PASS (six tests: two PII, four pay-schedule).

- [ ] **Step 5: Commit**

```bash
git add src/components/EmployeeDialog.tsx tests/unit/EmployeeDialog.sensitiveGating.test.tsx
git commit -m "$(cat <<'EOF'
fix(employees): gate the pay-schedule controls on view:pay_rates

Disable Pay Period, Allocate to Daily, Payment Interval, and Standard Work
Days for a caller without view:pay_rates. These set pay cadence next to the
already-gated pay amounts; a role without pay-rate access must not change
pay configuration.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Run the three touched suites together**

Run: `npx vitest run tests/unit/RoleEditor.test.tsx tests/unit/EmployeeDialog.sensitiveGating.test.tsx tests/unit/EmployeeDialog.maskedDob.test.tsx tests/unit/EmployeeDialog.maskedRate.test.tsx`
Expected: PASS.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Lint the changed files**

Run: `npx eslint src/components/EmployeeDialog.tsx src/components/roles/RoleEditor.tsx tests/unit/EmployeeDialog.sensitiveGating.test.tsx tests/unit/EmployeeDialog.maskedDob.test.tsx`
Expected: no errors.

- [ ] **Step 4: Run the whole unit suite once**

Run: `npm run test`
Expected: PASS.

---

## Self-Review

**Spec coverage:**
- Fix 1 (RoleEditor copy + comment) → Task 1.
- Fix 2 (PII inputs gated + `canSeePii`, email gated per the approved decision) → Task 2.
- Fix 3 (four pay-schedule controls gated) → Task 3.
- Test — new unit file `EmployeeDialog.sensitiveGating.test.tsx` → Task 2 (create) + Task 3 (extend).
- Test — the maskedDob per-test premise fix → Task 2, Step 6.
- No self-row exception → mirrored: `canSeePii` copies `canSeePayRates`, which has none.
- E2E — design justified skipping; not a task. No route, RPC, or record-authorization seam changes.
- Out of scope (IncomeStatement residual) → not a task. Correct.

**Placeholder scan:** none. Every code step shows the exact code; every run step shows the exact command and expected result.

**Type consistency:** `canSeePii` and `canSeePayRates` are `boolean`. `mockHasCapability` is `vi.fn()` returning `boolean`, called as `hasCapability(cap: string)`. `disabled` takes `boolean`. Radix `Select` root and `Checkbox` both accept `disabled` (verified in Phase 2.5). Selectors match the live `aria-label` values: "Employee email", "Employee phone number", "Date of birth", "Pay period", "Allocate to Daily P&L", "Payment interval", "Standard work days per week".
