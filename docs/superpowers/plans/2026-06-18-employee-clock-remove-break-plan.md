# Remove self-service breaks from employee Time Clock — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/employee/clock` a pure Clock In / Clock Out screen by removing the self-service "Start Break"/"End Break" buttons and the "On Break" status badge.

**Architecture:** Single-file UI change to `src/pages/EmployeeClock.tsx` plus a new behavioral render test. No data, schema, RLS, edge-function, payroll, or import logic changes — break punches from Sling/CSV/managers and the read-only "Today's Activity" history are untouched.

**Tech Stack:** React 18 + TypeScript, Vitest + @testing-library/react, shadcn/ui, Lucide icons.

**Spec:** `docs/superpowers/specs/2026-06-18-employee-clock-remove-break-design.md`

---

## File Structure

- **Create:** `tests/unit/EmployeeClock.test.tsx` — behavioral render test locking the requirement (no break buttons/badge; correct Clock In/Out per state).
- **Modify:** `src/pages/EmployeeClock.tsx` — remove break buttons + badge, narrow punch-type union, collapse the action grid to one full-width button, simplify the camera-dialog confirm label.

---

## Task 1: Behavioral test for break removal (RED)

**Files:**
- Create: `tests/unit/EmployeeClock.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/EmployeeClock.test.tsx` with this exact content (mocking pattern mirrors `tests/unit/EmployeePin.test.tsx`):

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import EmployeeClock from '@/pages/EmployeeClock';

const {
  useCurrentEmployeeMock,
  useEmployeePunchStatusMock,
  useTimePunchesMock,
  createPunchMutateMock,
  checkLocationMock,
} = vi.hoisted(() => ({
  useCurrentEmployeeMock: vi.fn(),
  useEmployeePunchStatusMock: vi.fn(),
  useTimePunchesMock: vi.fn(),
  createPunchMutateMock: vi.fn(),
  checkLocationMock: vi.fn(),
}));

vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => ({
    selectedRestaurant: { restaurant_id: 'r1', restaurant: { name: 'Test Cafe' } },
  }),
}));

vi.mock('@/hooks/useTimePunches', () => ({
  useCurrentEmployee: (...args: unknown[]) => useCurrentEmployeeMock(...args),
  useEmployeePunchStatus: (...args: unknown[]) => useEmployeePunchStatusMock(...args),
  useCreateTimePunch: () => ({ mutate: createPunchMutateMock, isPending: false }),
  useTimePunches: (...args: unknown[]) => useTimePunchesMock(...args),
}));

vi.mock('@/hooks/useGeofenceCheck', () => ({
  useGeofenceCheck: () => ({ checkLocation: checkLocationMock, checking: false }),
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

describe('EmployeeClock — self-service breaks removed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useCurrentEmployeeMock.mockReturnValue({
      employee: { id: 'e1', name: 'Alice' },
      loading: false,
    });
    useTimePunchesMock.mockReturnValue({ punches: [] });
    checkLocationMock.mockResolvedValue({ action: 'allow', checked: false });
  });

  it('clocked OUT: shows Clock In, no break affordances', () => {
    useEmployeePunchStatusMock.mockReturnValue({
      status: { is_clocked_in: false, on_break: false, last_punch_time: null, last_punch_type: null },
      loading: false,
    });
    render(<EmployeeClock />);
    expect(screen.getByRole('button', { name: /clock in/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /start break/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /end break/i })).toBeNull();
    expect(screen.queryByText(/on break/i)).toBeNull();
  });

  it('clocked IN: shows Clock Out, no Start Break / On Break', () => {
    useEmployeePunchStatusMock.mockReturnValue({
      status: { is_clocked_in: true, on_break: false, last_punch_time: '2026-06-18T12:00:00Z', last_punch_type: 'clock_in' },
      loading: false,
    });
    render(<EmployeeClock />);
    expect(screen.getByRole('button', { name: /clock out/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /start break/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /end break/i })).toBeNull();
    expect(screen.queryByText(/on break/i)).toBeNull();
  });

  it('external break_start (on_break true → reads as clocked out): shows Clock In, no break affordances', () => {
    useEmployeePunchStatusMock.mockReturnValue({
      status: { is_clocked_in: false, on_break: true, last_punch_time: '2026-06-18T12:00:00Z', last_punch_type: 'break_start' },
      loading: false,
    });
    render(<EmployeeClock />);
    expect(screen.getByRole('button', { name: /clock in/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /start break/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /end break/i })).toBeNull();
    expect(screen.queryByText(/on break/i)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test, verify it FAILS**

Run: `npm run test -- tests/unit/EmployeeClock.test.tsx`
Expected: FAIL. The "clocked IN" case fails because current code renders a **Start Break** button (so `queryByRole('button', { name: /start break/i })` is non-null and `toBeNull()` fails). The other two cases pass on current code. A failing suite is the required RED.

---

## Task 2: Remove break UI from EmployeeClock (GREEN)

**Files:**
- Modify: `src/pages/EmployeeClock.tsx`

Apply all six edits below, then verify.

- [ ] **Step 1: Narrow the `pendingPunchType` state union (≈ line 24)**

Find:
```tsx
  const [pendingPunchType, setPendingPunchType] = useState<'clock_in' | 'clock_out' | 'break_start' | 'break_end' | null>(null);
```
Replace with:
```tsx
  const [pendingPunchType, setPendingPunchType] = useState<'clock_in' | 'clock_out' | null>(null);
```

- [ ] **Step 2: Narrow the `handleInitiatePunch` parameter (≈ line 110)**

Find:
```tsx
  const handleInitiatePunch = async (punchType: 'clock_in' | 'clock_out' | 'break_start' | 'break_end') => {
```
Replace with:
```tsx
  const handleInitiatePunch = async (punchType: 'clock_in' | 'clock_out') => {
```

- [ ] **Step 3: Remove the now-unused `onBreak` variable (≈ line 269-270)**

Find:
```tsx
  const isClockedIn = status?.is_clocked_in || false;
  const onBreak = status?.on_break || false;
```
Replace with:
```tsx
  const isClockedIn = status?.is_clocked_in || false;
```
(Deletion is mandatory — a leftover unused `onBreak` would fail ESLint `no-unused-vars`.)

- [ ] **Step 4: Simplify the status badge — remove the "On Break" branch (≈ lines 304-322)**

Find:
```tsx
              {statusLoading ? (
                <Skeleton className="h-8 w-32" />
              ) : isClockedIn ? (
                onBreak ? (
                  <Badge variant="outline" className="text-lg px-4 py-2 bg-yellow-500/10 text-yellow-700 border-yellow-500/20">
                    <Coffee className="w-4 h-4 mr-2" />
                    On Break
                  </Badge>
                ) : (
                  <Badge variant="default" className="text-lg px-4 py-2 bg-green-500/10 text-green-700 border-green-500/20">
                    <PlayCircle className="w-4 h-4 mr-2" />
                    Clocked In
                  </Badge>
                )
              ) : (
                <Badge variant="outline" className="text-lg px-4 py-2">
                  Clocked Out
                </Badge>
              )}
```
Replace with:
```tsx
              {statusLoading ? (
                <Skeleton className="h-8 w-32" />
              ) : isClockedIn ? (
                <Badge variant="default" className="text-lg px-4 py-2 bg-green-500/10 text-green-700 border-green-500/20">
                  <PlayCircle className="w-4 h-4 mr-2" />
                  Clocked In
                </Badge>
              ) : (
                <Badge variant="outline" className="text-lg px-4 py-2">
                  Clocked Out
                </Badge>
              )}
```

- [ ] **Step 5: Replace the action-button grid with a single full-width button (≈ lines 342-400)**

Find:
```tsx
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {!isClockedIn ? (
              <Button
                size="lg"
                className="h-24 text-xl"
                onClick={() => handleInitiatePunch('clock_in')}
                disabled={createPunch.isPending || geofenceChecking}
              >
                <LogIn className="mr-2 h-6 w-6" />
                Clock In
              </Button>
            ) : onBreak ? (
              <>
                <Button
                  size="lg"
                  variant="outline"
                  className="h-24 text-xl"
                  onClick={() => handleInitiatePunch('break_end')}
                  disabled={createPunch.isPending}
                >
                  <PlayCircle className="mr-2 h-6 w-6" />
                  End Break
                </Button>
                <Button
                  size="lg"
                  variant="destructive"
                  className="h-24 text-xl"
                  onClick={() => handleInitiatePunch('clock_out')}
                  disabled={createPunch.isPending}
                >
                  <LogOut className="mr-2 h-6 w-6" />
                  Clock Out
                </Button>
              </>
            ) : (
              <>
                <Button
                  size="lg"
                  variant="outline"
                  className="h-24 text-xl"
                  onClick={() => handleInitiatePunch('break_start')}
                  disabled={createPunch.isPending}
                >
                  <Coffee className="mr-2 h-6 w-6" />
                  Start Break
                </Button>
                <Button
                  size="lg"
                  variant="destructive"
                  className="h-24 text-xl"
                  onClick={() => handleInitiatePunch('clock_out')}
                  disabled={createPunch.isPending}
                >
                  <LogOut className="mr-2 h-6 w-6" />
                  Clock Out
                </Button>
              </>
            )}
          </div>
```
Replace with:
```tsx
          {!isClockedIn ? (
            <Button
              size="lg"
              className="h-24 text-xl w-full"
              onClick={() => handleInitiatePunch('clock_in')}
              disabled={createPunch.isPending || geofenceChecking}
            >
              <LogIn className="mr-2 h-6 w-6" />
              Clock In
            </Button>
          ) : (
            <Button
              size="lg"
              variant="destructive"
              className="h-24 text-xl w-full"
              onClick={() => handleInitiatePunch('clock_out')}
              disabled={createPunch.isPending}
            >
              <LogOut className="mr-2 h-6 w-6" />
              Clock Out
            </Button>
          )}
```

- [ ] **Step 6: Simplify the camera-dialog confirm-button label (≈ lines 556-558)**

Find:
```tsx
                    {pendingPunchType === 'clock_out' ? 'Confirm & Clock Out' : 
                     pendingPunchType === 'break_start' ? 'Confirm & Start Break' :
                     pendingPunchType === 'break_end' ? 'Confirm & End Break' : 'Confirm & Clock In'}
```
Replace with:
```tsx
                    {pendingPunchType === 'clock_out' ? 'Confirm & Clock Out' : 'Confirm & Clock In'}
```

- [ ] **Step 7: Run the test, verify it PASSES**

Run: `npm run test -- tests/unit/EmployeeClock.test.tsx`
Expected: PASS (3 passed).

- [ ] **Step 8: Typecheck**

Run: `npm run typecheck`
Expected: no errors. (Confirms the narrowed `pendingPunchType` union has no remaining `break_start`/`break_end` references.)

- [ ] **Step 9: Lint the two files**

Run: `npx eslint src/pages/EmployeeClock.tsx tests/unit/EmployeeClock.test.tsx`
Expected: no errors (in particular, no `no-unused-vars` for `onBreak`, and `Coffee`/`PlayCircle` imports remain used by the history list / Clocked-In badge).

- [ ] **Step 10: Commit**

```bash
git add src/pages/EmployeeClock.tsx tests/unit/EmployeeClock.test.tsx
git commit -m "fix(employee-clock): remove self-service break buttons and On Break badge

The Time Clock now offers only Clock In / Clock Out. The break buttons were
also effectively dead: get_employee_punch_status makes on_break and
is_clocked_in mutually exclusive, so a break_start made the UI read as
Clocked Out and the End Break path was unreachable. Break punch types,
payroll math, Sling/CSV imports, manager entry, and the read-only history
are unchanged."
```

---

## Self-Review

- **Spec coverage:** Buttons → single Clock In/Out (Task 2 S5 ✓); badge → two states (S4 ✓); `onBreak` deleted (S3 ✓); union narrowed (S1/S2 ✓); confirm label (S6 ✓); kept history/payroll/imports (no task touches them ✓); test across 3 states incl. positive on_break→Clock In assert (Task 1 ✓).
- **Placeholder scan:** None — every edit shows exact find/replace code.
- **Type consistency:** `pendingPunchType` union narrowed in both the state (S1) and the handler param (S2); no remaining producer of `break_start`/`break_end` after S5; the camera-dialog reads `pendingPunchType` only as `'clock_out'` vs else (S6) — consistent.
- **Icon imports:** `Coffee` (history break_start icon) and `PlayCircle` (Clocked-In badge + history break_end icon) remain referenced after edits — no import removal needed, no unused-import lint error.
