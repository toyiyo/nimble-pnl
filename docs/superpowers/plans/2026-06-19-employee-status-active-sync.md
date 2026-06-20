# Employee `status`/`is_active` Sync Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the client from writing `is_active` out of sync with `status`, which violates the `employees_status_active_sync` check constraint (Postgres 23514) and blocks managers from deactivating employees in the UI.

**Architecture:** Make `is_active` derivable from `status` via a single tested helper (`isActiveForStatus`), use it in `EmployeeDialog`, and delete the two buggy silent RPC fallbacks in `useEmployees` (surface RPC errors instead). Client-only; no DB migration; no production data changes.

**Tech Stack:** React 18 + TypeScript, React Query, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-06-19-employee-status-active-sync-design.md`

---

## File structure

- `src/types/scheduling.ts` — add `export type EmployeeStatus`; use it for `Employee.status`.
- `src/utils/employeeFilters.ts` — add `isActiveForStatus(status)` helper (single source of truth for the invariant).
- `src/components/EmployeeDialog.tsx` — derive `is_active` from `status` via the helper; type `status` state as `EmployeeStatus`.
- `src/hooks/useEmployees.tsx` — remove both RPC fallbacks in `useDeactivateEmployee` / `useReactivateEmployee`.
- `tests/unit/employeeActivation.test.ts` — add helper unit tests + two hook tests (RPC error → reject, no `.from().update()`).
- `tests/unit/EmployeeDialog.statusSync.test.tsx` — NEW; prop-driven component tests proving the saved `is_active` is derived from `status`.

---

### Task 1: Canonical `EmployeeStatus` type + `isActiveForStatus` helper

**Files:**
- Modify: `src/types/scheduling.ts`
- Modify: `src/utils/employeeFilters.ts`
- Test: `tests/unit/employeeActivation.test.ts`

- [ ] **Step 1: Write the failing test**

Add to the top imports of `tests/unit/employeeActivation.test.ts`:

```ts
import {
  filterActiveEmployees,
  filterInactiveEmployees,
  getLastActiveDate,
  canReactivate,
  isActiveForStatus,
} from '@/utils/employeeFilters';
```

Add this describe block at the end of the file (before the final closing `});` of the top-level `describe`, or as a new top-level describe — either is fine):

```ts
describe('isActiveForStatus', () => {
  it('returns true only for active status', () => {
    expect(isActiveForStatus('active')).toBe(true);
  });

  it('returns false for inactive and terminated', () => {
    expect(isActiveForStatus('inactive')).toBe(false);
    expect(isActiveForStatus('terminated')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/employeeActivation.test.ts -t "isActiveForStatus"`
Expected: FAIL — `isActiveForStatus` is not exported from `@/utils/employeeFilters`.

- [ ] **Step 3: Add the type and the helper**

In `src/types/scheduling.ts`, add near the other type exports (after line 6, `EmploymentType`):

```ts
export type EmployeeStatus = 'active' | 'inactive' | 'terminated';
```

Then change the `Employee` interface's status field (currently `status: 'active' | 'inactive' | 'terminated';`) to:

```ts
  status: EmployeeStatus;
```

In `src/utils/employeeFilters.ts`, add at the top (after the file header comment):

```ts
import type { EmployeeStatus } from '@/types/scheduling';
```

And add the helper (e.g. after `canReactivate`):

```ts
/**
 * Single source of truth for the is_active <-> status invariant enforced by the
 * DB check constraint `employees_status_active_sync`
 * (active => is_active true; inactive/terminated => is_active false).
 */
export function isActiveForStatus(status: EmployeeStatus): boolean {
  return status === 'active';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/employeeActivation.test.ts`
Expected: PASS (20 tests total).

- [ ] **Step 5: Typecheck (the `Employee.status` change is type-only)**

Run: `npm run typecheck`
Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add src/types/scheduling.ts src/utils/employeeFilters.ts tests/unit/employeeActivation.test.ts
git commit -m "feat(employees): add EmployeeStatus type and isActiveForStatus helper"
```

---

### Task 2: Derive `is_active` from `status` in EmployeeDialog

**Files:**
- Modify: `src/components/EmployeeDialog.tsx`
- Test: `tests/unit/EmployeeDialog.statusSync.test.tsx` (create)

- [ ] **Step 1: Write the failing component test**

Create `tests/unit/EmployeeDialog.statusSync.test.tsx`:

```tsx
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { EmployeeDialog } from '@/components/EmployeeDialog';

const updateMock = vi.fn().mockResolvedValue({ id: 'emp-1' });
const createMock = vi.fn().mockResolvedValue({ id: 'emp-1' });

vi.mock('@/hooks/useEmployees', () => ({
  useCreateEmployee: () => ({ mutateAsync: createMock, isPending: false }),
  useUpdateEmployee: () => ({ mutateAsync: updateMock, isPending: false }),
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

vi.mock('@/integrations/supabase/client', () => {
  function makeChain(): any {
    const chain: any = {};
    chain.select = () => makeChain();
    chain.eq = () => makeChain();
    chain.not = () => makeChain();
    chain.order = () => Promise.resolve({ data: [], error: null });
    chain.is = () => makeChain();
    chain.single = () => Promise.resolve({ data: null, error: null });
    chain.upsert = () => Promise.resolve({ data: null, error: null });
    chain.insert = () => makeChain();
    chain.update = () => makeChain();
    chain.then = (resolve: (v: { data: any[]; error: null }) => any) =>
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

type EmpOverrides = Partial<{ status: string; is_active: boolean }>;
const makeEmployee = (overrides: EmpOverrides) => ({
  id: 'emp-1',
  restaurant_id: 'r1',
  name: 'Alex Valdez',
  position: 'Server',
  status: 'active',
  is_active: true,
  compensation_type: 'hourly',
  hourly_rate: 1500,
  employment_type: 'full_time',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  ...overrides,
});

function renderEdit(employee: ReturnType<typeof makeEmployee>) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, staleTime: Infinity } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <EmployeeDialog open onOpenChange={vi.fn()} restaurantId="r1" employee={employee as any} />
    </QueryClientProvider>,
  );
}

describe('EmployeeDialog — is_active is derived from status on save', () => {
  beforeEach(() => {
    updateMock.mockClear();
    createMock.mockClear();
  });

  it('sends is_active=false when status is inactive (even if the row was is_active=true)', async () => {
    renderEdit(makeEmployee({ status: 'inactive', is_active: true }));
    await userEvent.click(screen.getByRole('button', { name: /update employee/i }));
    await waitFor(() => expect(updateMock).toHaveBeenCalled());
    expect(updateMock.mock.calls[0][0]).toEqual(
      expect.objectContaining({ id: 'emp-1', status: 'inactive', is_active: false }),
    );
  });

  it('sends is_active=true when status is active (even if the row was is_active=false)', async () => {
    renderEdit(makeEmployee({ status: 'active', is_active: false }));
    await userEvent.click(screen.getByRole('button', { name: /update employee/i }));
    await waitFor(() => expect(updateMock).toHaveBeenCalled());
    expect(updateMock.mock.calls[0][0]).toEqual(
      expect.objectContaining({ id: 'emp-1', status: 'active', is_active: true }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/EmployeeDialog.statusSync.test.tsx`
Expected: FAIL — with the current code, the inactive case sends `is_active: true` (echoes the row), so the `objectContaining({ is_active: false })` assertion fails.

- [ ] **Step 3: Wire the helper into EmployeeDialog**

In `src/components/EmployeeDialog.tsx`:

a. Add `EmployeeStatus` to the scheduling-types import (line 9):

```ts
import { Employee, EmployeeStatus, CompensationType, PayPeriodType, ContractorPaymentInterval, EmploymentType } from '@/types/scheduling';
```

b. Add the helper import (after the scheduling-types import):

```ts
import { isActiveForStatus } from '@/utils/employeeFilters';
```

c. Type the `status` state with the alias (line 60):

```ts
  const [status, setStatus] = useState<EmployeeStatus>('active');
```

d. In `proceedWithSubmit`, change the `is_active` line in `employeeData` (currently `is_active: employee?.is_active ?? true,`) to:

```ts
      is_active: isActiveForStatus(status),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/EmployeeDialog.statusSync.test.tsx`
Expected: PASS (both cases).

- [ ] **Step 5: Commit**

```bash
git add src/components/EmployeeDialog.tsx tests/unit/EmployeeDialog.statusSync.test.tsx
git commit -m "fix(employees): derive is_active from status in EmployeeDialog (constraint 23514)"
```

---

### Task 3: Remove the silent fallback in `useDeactivateEmployee`

**Files:**
- Modify: `src/hooks/useEmployees.tsx`
- Test: `tests/unit/employeeActivation.test.ts`

- [ ] **Step 1: Write the failing test**

Add inside the `describe('useDeactivateEmployee', ...)` block in `tests/unit/employeeActivation.test.ts`:

```ts
it('surfaces the RPC error and does NOT fall back to a direct update', async () => {
  mockSupabase.rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'rpc unavailable' } });
  mockSupabase.from = vi.fn(); // must never be called
  mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'user-123' } }, error: null });

  const { useDeactivateEmployee } = await import('@/hooks/useEmployees');
  const { result } = renderHook(() => useDeactivateEmployee(), { wrapper: createWrapper() });
  await waitFor(() => expect(result.current).toBeDefined());

  await expect(
    result.current.mutateAsync({ employeeId: 'emp-1', removeFromSchedules: true, terminationDate: '2026-06-19' }),
  ).rejects.toBeTruthy();

  expect(mockSupabase.from).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/employeeActivation.test.ts -t "does NOT fall back"`
Expected: FAIL — current code calls `supabase.from('employees').update(...)` after the RPC error, so `mockSupabase.from` IS called (and the mutation may resolve).

- [ ] **Step 3: Remove the fallback**

In `src/hooks/useEmployees.tsx`, `useDeactivateEmployee.mutationFn`, replace the block that currently reads:

```ts
      if (!error && data) return data;

      // Fallback: direct update when RPC is unavailable in test/preview environments
      const { data: fallbackData, error: fallbackError } = await supabase
        .from('employees')
        .update({
          is_active: false,
          deactivated_at: terminationDate,
          deactivation_reason: reason || null,
        })
        .eq('id', employeeId)
        .select('restaurant_id')
        .single();

      if (fallbackError) throw fallbackError;
      return fallbackData;
```

with:

```ts
      if (error) throw error;
      return data;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/employeeActivation.test.ts`
Expected: PASS (new test + the existing happy-path deactivate tests still pass — they mock the RPC to resolve with data).

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useEmployees.tsx tests/unit/employeeActivation.test.ts
git commit -m "fix(employees): remove silent deactivate fallback; surface RPC errors"
```

---

### Task 4: Remove the silent fallback in `useReactivateEmployee`

**Files:**
- Modify: `src/hooks/useEmployees.tsx`
- Test: `tests/unit/employeeActivation.test.ts`

- [ ] **Step 1: Write the failing test**

Add inside the `describe('useReactivateEmployee', ...)` block:

```ts
it('surfaces the RPC error and does NOT fall back to a direct update', async () => {
  mockSupabase.rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'rpc unavailable' } });
  mockSupabase.from = vi.fn(); // must never be called
  mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'user-123' } }, error: null });

  const { useReactivateEmployee } = await import('@/hooks/useEmployees');
  const { result } = renderHook(() => useReactivateEmployee(), { wrapper: createWrapper() });
  await waitFor(() => expect(result.current).toBeDefined());

  await expect(
    result.current.mutateAsync({ employeeId: 'emp-1' }),
  ).rejects.toBeTruthy();

  expect(mockSupabase.from).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/employeeActivation.test.ts -t "does NOT fall back"`
Expected: FAIL for the reactivate case — current code calls `supabase.from('employees').update(...)` after the RPC error.

- [ ] **Step 3: Remove the fallback**

In `src/hooks/useEmployees.tsx`, `useReactivateEmployee.mutationFn`, replace the block that currently reads:

```ts
      if (!error && data) return data;

      // Fallback: direct update to mark active when RPC is unavailable
      const { data: fallbackData, error: fallbackError } = await supabase
        .from('employees')
        .update({
          is_active: true,
          deactivated_at: null,
          deactivation_reason: null,
          hourly_rate: hourlyRate ?? undefined,
        })
        .eq('id', employeeId)
        .select('restaurant_id')
        .single();

      if (fallbackError) throw fallbackError;
      return fallbackData;
```

with:

```ts
      if (error) throw error;
      return data;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/employeeActivation.test.ts`
Expected: PASS (new test + existing happy-path reactivate tests).

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useEmployees.tsx tests/unit/employeeActivation.test.ts
git commit -m "fix(employees): remove silent reactivate fallback; surface RPC errors"
```

---

## Coverage notes (read before review)

- The three `EmployeeDialog` save paths (direct update, deferred comp-change `pendingCompChange.updatePayload`, and `createEmployeeWithHistory`) all spread the **same** `employeeData` object, so fixing the single `is_active` line covers all three. Task 2 tests the direct-update path explicitly; the others carry the identical derived `is_active` by construction.
- `terminated => is_active false` is covered by the `isActiveForStatus` unit test (Task 1); the component tests cover `active`/`inactive` wiring through the real submit path.
- Component tests are **prop-driven** (no Radix `Select` interaction) to stay robust in jsdom: an employee whose `is_active` contradicts its `status` is submitted, proving the saved value is derived from `status`, not echoed from the row.

## Out of scope (deferred follow-ups)

Missing `DialogDescription` on `EmployeeDialog`; raw colors in `DeactivateEmployeeDialog`; RPC `SECURITY DEFINER` `search_path` pinning; `canReactivate` vs `terminated` tension; inline UX hint on the status dropdown. None are required to fix constraint 23514.
