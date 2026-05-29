# Remove cosmetic "Enable kiosk PIN" checkbox — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the dead `confirmPin` checkbox and the dropped `confirmPin` param from the employee-reactivation flow so the UI stops implying a PIN-disable capability that does not exist.

**Architecture:** PIN usability is derived purely from `employees.is_active`; reactivation already re-enables any existing PIN. So this is a pure removal — delete the checkbox + state + param, clarify the existing info alert to carry the (now static) PIN signal, and add a11y/regression tests. No DB, RPC, or edge-function change.

**Tech Stack:** React 18 + TypeScript, React Query mutation hook, shadcn/ui Dialog + Alert + Checkbox, Vitest + @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-05-29-reactivate-pin-checkbox-design.md`

---

## File Structure

- **Modify** `src/components/ReactivateEmployeeDialog.tsx` — remove all six `confirmPin` sites, clarify the top info alert, add `aria-hidden` to the two decorative Alert icons.
- **Modify** `src/hooks/useEmployees.tsx` — remove `confirmPin?: boolean` from `ReactivateEmployeeParams`.
- **Create** `tests/unit/ReactivateEmployeeDialog.test.tsx` — regression guard (no kiosk-PIN checkbox; mutate called without `confirmPin`; alert mentions kiosk PIN).
- **Modify** `tests/unit/employeeActivation.test.ts` — drop `confirmPin: true` from the two reactivate tests.

**Task order keeps every commit green:** Task 1 removes the dialog's use of `confirmPin` (the interface still has the optional field, so nothing breaks). Task 2 then removes the field and the two test references together.

---

## Task 1: Dialog — remove checkbox, clarify alert, add regression test

**Files:**
- Create: `tests/unit/ReactivateEmployeeDialog.test.tsx`
- Modify: `src/components/ReactivateEmployeeDialog.tsx`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/ReactivateEmployeeDialog.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ReactivateEmployeeDialog } from '@/components/ReactivateEmployeeDialog';
import type { Employee } from '@/types/scheduling';

const mockMutate = vi.fn();

vi.mock('@/hooks/useEmployees', () => ({
  useReactivateEmployee: () => ({
    mutate: mockMutate,
    isPending: false,
  }),
}));

const employee = {
  id: 'emp-1',
  name: 'Bob Johnson',
  position: 'Server',
  hourly_rate: 1500,
  is_active: false,
  status: 'inactive',
  deactivation_reason: 'seasonal',
} as unknown as Employee;

const renderDialog = () =>
  render(
    <ReactivateEmployeeDialog open onOpenChange={() => {}} employee={employee} />
  );

describe('ReactivateEmployeeDialog', () => {
  beforeEach(() => {
    mockMutate.mockClear();
  });

  it('does not render an "Enable kiosk PIN" checkbox', () => {
    renderDialog();
    expect(screen.queryByRole('checkbox', { name: /kiosk PIN/i })).toBeNull();
    expect(screen.queryByText(/Enable kiosk PIN/i)).toBeNull();
  });

  it('reactivates with only employeeId and hourlyRate (no confirmPin)', () => {
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: /Reactivate Employee/i }));

    expect(mockMutate).toHaveBeenCalledTimes(1);
    const [vars] = mockMutate.mock.calls[0];
    expect(vars).not.toHaveProperty('confirmPin');
    expect(vars.employeeId).toBe('emp-1');
    // updateRate defaults to false, so no rate override is sent.
    expect(vars.hourlyRate).toBeUndefined();
  });

  it('top info alert mentions the existing kiosk PIN', () => {
    renderDialog();
    expect(screen.getByText(/kiosk PIN/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/ReactivateEmployeeDialog.test.tsx`
Expected: FAIL — the kiosk-PIN checkbox/label still renders, `mutate` is still called with a `confirmPin` key, and the alert does not yet mention "kiosk PIN".

- [ ] **Step 3: Remove the `confirmPin` state (initialization)**

In `src/components/ReactivateEmployeeDialog.tsx`, delete this line (~line 32):

```tsx
  const [confirmPin, setConfirmPin] = useState(true);
```

- [ ] **Step 4: Remove the three `setConfirmPin(true)` resets**

In the `useEffect` initializer, delete (~line 45):

```tsx
      setConfirmPin(true);
```

In the `.mutate(...)` `onSuccess` callback, delete (~line 68):

```tsx
          setConfirmPin(true);
```

In `handleCancel`, delete (~line 78):

```tsx
    setConfirmPin(true);
```

- [ ] **Step 5: Remove `confirmPin` from the mutate call**

Change (~lines 56–61) from:

```tsx
    reactivateMutation.mutate(
      {
        employeeId: employee.id,
        hourlyRate: newRate,
        confirmPin,
      },
```

to:

```tsx
    reactivateMutation.mutate(
      {
        employeeId: employee.id,
        hourlyRate: newRate,
      },
```

- [ ] **Step 6: Delete the entire "PIN Confirmation" checkbox block**

Remove this block (~lines 175–195):

```tsx
          {/* PIN Confirmation */}
          <div className="space-y-3 pt-2 border-t">
            <div className="flex items-start space-x-3">
              <Checkbox
                id="confirm-pin"
                checked={confirmPin}
                onCheckedChange={(checked) => setConfirmPin(checked as boolean)}
              />
              <div className="grid gap-1.5 leading-none">
                <Label
                  htmlFor="confirm-pin"
                  className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                >
                  Enable kiosk PIN
                </Label>
                <p className="text-sm text-muted-foreground">
                  Allow employee to punch in/out using their existing PIN
                </p>
              </div>
            </div>
          </div>
```

- [ ] **Step 7: Clarify the top info alert + add `aria-hidden` to both Alert icons**

Change the top alert (~lines 106–111) from:

```tsx
          <Alert>
            <CheckCircle className="h-4 w-4" />
            <AlertDescription className="text-sm">
              The employee will be able to log in, punch in/out, and be scheduled for shifts.
            </AlertDescription>
          </Alert>
```

to:

```tsx
          <Alert>
            <CheckCircle className="h-4 w-4" aria-hidden="true" />
            <AlertDescription className="text-sm">
              The employee will be able to log in, punch in/out (including with their existing kiosk PIN), and be scheduled for shifts.
            </AlertDescription>
          </Alert>
```

And change the bottom note alert (~lines 198–200) from:

```tsx
          <Alert variant="default">
            <Info className="h-4 w-4" />
```

to:

```tsx
          <Alert variant="default">
            <Info className="h-4 w-4" aria-hidden="true" />
```

> Leave the `Checkbox` import and the "Update hourly rate" checkbox (id `update-rate`) untouched — they are still used. Do NOT touch the pre-existing `space-y-*`/`space-x-*`/`border-t`/icon-box color nits (deferred in the spec).

- [ ] **Step 8: Run test to verify it passes**

Run: `npx vitest run tests/unit/ReactivateEmployeeDialog.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 9: Typecheck the dialog change**

Run: `npm run typecheck`
Expected: PASS. (`ReactivateEmployeeParams.confirmPin` is still declared as optional, so nothing references a removed symbol yet.)

- [ ] **Step 10: Commit**

```bash
git add src/components/ReactivateEmployeeDialog.tsx tests/unit/ReactivateEmployeeDialog.test.tsx
git commit -m "fix(reactivate): remove cosmetic kiosk-PIN checkbox from dialog

The checkbox implied a PIN-disable capability that does not exist: PIN
usability is gated solely on employees.is_active, which reactivation flips
to true. Replaces the dead toggle with an accurate static note in the info
alert and adds a regression test. Also adds aria-hidden to decorative Alert
icons (Phase 2.5 review).

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Hook — drop `confirmPin` from the contract + fix existing tests

**Files:**
- Modify: `src/hooks/useEmployees.tsx`
- Modify: `tests/unit/employeeActivation.test.ts`

- [ ] **Step 1: Update the existing reactivate tests (RED for typecheck)**

In `tests/unit/employeeActivation.test.ts`, the two `useReactivateEmployee` tests pass `confirmPin: true`. Remove that line from both `mutate({...})` calls.

First occurrence (~line 373–377), change from:

```tsx
      result.current.mutate({
        employeeId: 'emp-3',
        hourlyRate: 1500, // $15.00 in cents
        confirmPin: true,
      });
```

to:

```tsx
      result.current.mutate({
        employeeId: 'emp-3',
        hourlyRate: 1500, // $15.00 in cents
      });
```

Second occurrence (~line 422–426), change from:

```tsx
      result.current.mutate({
        employeeId: 'emp-4',
        hourlyRate: 1800,
        confirmPin: true,
      });
```

to:

```tsx
      result.current.mutate({
        employeeId: 'emp-4',
        hourlyRate: 1800,
      });
```

- [ ] **Step 2: Remove the field from the hook interface**

In `src/hooks/useEmployees.tsx`, delete the `confirmPin` line from `ReactivateEmployeeParams` (~line 223):

```tsx
  confirmPin?: boolean; // Whether PIN should remain active (for UI flow)
```

The interface becomes:

```tsx
export interface ReactivateEmployeeParams {
  employeeId: string;
  hourlyRate?: number; // Optional: update rate during reactivation
}
```

(The `mutationFn` already destructures only `{ employeeId, hourlyRate }`, so no change there.)

- [ ] **Step 3: Run the affected tests**

Run: `npx vitest run tests/unit/employeeActivation.test.ts tests/unit/ReactivateEmployeeDialog.test.tsx`
Expected: PASS (12 + 3 tests).

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: PASS — no remaining reference to `confirmPin` anywhere (verify with `grep -rn "confirmPin" src/ tests/ | grep -v PinChangeDialog` returning nothing).

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useEmployees.tsx tests/unit/employeeActivation.test.ts
git commit -m "fix(reactivate): drop unused confirmPin from ReactivateEmployeeParams

The mutationFn never read confirmPin; it was silently discarded. Remove it
from the public hook contract and from the two tests that passed it, so the
type reflects what is actually sent to reactivate_employee.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- Remove `confirmPin` from hook contract → Task 2 Step 2. ✓
- Remove all six dialog `confirmPin` sites → Task 1 Steps 3–6. ✓
- Clarify top alert copy → Task 1 Step 7. ✓
- `aria-hidden` on both Alert icons → Task 1 Step 7. ✓
- Update existing hook tests → Task 2 Step 1. ✓
- New dialog test: no checkbox / no confirmPin / alert mentions PIN → Task 1 Step 1 (3 assertions). ✓
- Deferred pre-existing style nits left untouched → noted in Task 1 Step 7. ✓

**Placeholder scan:** None — every code edit shows exact before/after.

**Type consistency:** `ReactivateEmployeeParams` ends as `{ employeeId: string; hourlyRate?: number }`; the dialog calls `mutate({ employeeId, hourlyRate })`; tests assert no `confirmPin` property. Consistent across tasks.
