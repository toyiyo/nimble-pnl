# Labor Cost Stale Compensation History Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the Scheduling page's Labor Cost aggregate dropping shifts when an employee's compensation history contains a stale entry of a different `compensation_type`.

**Architecture:** Single narrow change to `resolveCompensationForDate` so it prefers history entries whose `compensation_type` matches the employee's current value, with a fallback to the previous behavior for legitimate past comp-type transitions. All downstream labor-cost calculators inherit the fix.

**Tech Stack:** TypeScript, Vitest (unit tests), React Query (consumer, unaffected).

**Spec:** `docs/superpowers/specs/2026-04-17-labor-cost-stale-comp-history-design.md`

---

### Task 1: Reproduce the bug in a failing unit test for `resolveCompensationForDate`

**Files:**
- Test: `tests/unit/resolveCompensationForDate.test.ts` (new)

- [ ] **Step 1: Check if a test file already exists for the resolver**

Run: `ls tests/unit/ | grep -i compensation`
If a file exists that already tests `resolveCompensationForDate`, add the new cases to it and adjust paths below. Otherwise create the new file.

- [ ] **Step 2: Write two failing tests covering the bug and the fallback guarantee**

Contents of `tests/unit/resolveCompensationForDate.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { resolveCompensationForDate } from '@/utils/compensationCalculations';
import type { Employee, CompensationHistoryEntry } from '@/types/scheduling';

function makeEmployee(overrides: Partial<Employee>): Employee {
  return {
    id: 'emp-1',
    restaurant_id: 'rest-1',
    name: 'Test Employee',
    position: 'Server',
    status: 'active',
    is_active: true,
    compensation_type: 'hourly',
    hourly_rate: 1000,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  } as Employee;
}

function historyEntry(
  effective_date: string,
  compensation_type: CompensationHistoryEntry['compensation_type'],
  amount_cents: number,
  extra: Partial<CompensationHistoryEntry> = {},
): CompensationHistoryEntry {
  return {
    id: `hist-${effective_date}-${compensation_type}`,
    employee_id: 'emp-1',
    restaurant_id: 'rest-1',
    effective_date,
    compensation_type,
    amount_cents,
    created_at: `${effective_date}T00:00:00Z`,
    ...extra,
  };
}

describe('resolveCompensationForDate', () => {
  it('skips a stale history entry of a different compensation_type and uses the most recent matching-type entry', () => {
    // Reproduces the Alejandra bug: current comp_type is 'hourly' but a stale
    // 'salary' entry sits between the shift date and the most recent hourly entry.
    const employee = makeEmployee({
      compensation_type: 'hourly',
      hourly_rate: 1000,
      compensation_history: [
        historyEntry('2026-03-01', 'hourly', 3000),
        historyEntry('2026-03-15', 'hourly', 1500),
        historyEntry('2026-04-01', 'hourly', 1000),
        historyEntry('2026-04-11', 'salary', 60000),
      ],
    });

    const snapshot = resolveCompensationForDate(employee, '2026-04-13');

    expect(snapshot.compensation_type).toBe('hourly');
    expect(snapshot.hourly_rate).toBe(1000);
  });

  it('falls back to a mismatched-type entry when no matching-type entry exists on or before the date (legitimate comp-type transition)', () => {
    // Employee started on salary in Jan, switched to hourly in April. A Feb shift
    // still correctly resolves to the salary rate in effect at that time.
    const employee = makeEmployee({
      compensation_type: 'hourly',
      hourly_rate: 1500,
      salary_amount: 200000,
      pay_period_type: 'bi-weekly',
      compensation_history: [
        historyEntry('2026-01-01', 'salary', 200000, { pay_period_type: 'bi-weekly' }),
        historyEntry('2026-04-01', 'hourly', 1500),
      ],
    });

    const snapshot = resolveCompensationForDate(employee, '2026-02-15');

    expect(snapshot.compensation_type).toBe('salary');
    expect(snapshot.salary_amount).toBe(200000);
    expect(snapshot.pay_period_type).toBe('bi-weekly');
  });
});
```

- [ ] **Step 3: Run the tests and confirm they fail**

Run: `npm run test -- tests/unit/resolveCompensationForDate.test.ts`
Expected: first test FAILS with `compensation_type` being `'salary'` instead of `'hourly'`. Second test passes (fallback path already exists).

- [ ] **Step 4: Commit the failing test**

```bash
git add tests/unit/resolveCompensationForDate.test.ts
git commit -m "test: add failing coverage for stale comp-type history entries"
```

---

### Task 2: Implement the resolver fix

**Files:**
- Modify: `src/utils/compensationCalculations.ts:72-100`

- [ ] **Step 1: Read the current implementation to confirm location**

```bash
sed -n '70,100p' src/utils/compensationCalculations.ts
```

Expected: `resolveCompensationForDate` function starting at line 72.

- [ ] **Step 2: Apply the fix**

Replace the single-line lookup:
```ts
const entry = history.find(h => h.effective_date <= dateStr);
```

With the current-type-preferring version:
```ts
// Prefer the most recent entry whose compensation_type matches the employee's
// current compensation_type; fall back to any most-recent entry for legitimate
// historical comp-type transitions (e.g. salary→hourly).
const matchingEntry = history.find(
  h => h.effective_date <= dateStr && h.compensation_type === employee.compensation_type
);
const entry = matchingEntry ?? history.find(h => h.effective_date <= dateStr);
```

- [ ] **Step 3: Run the unit tests and confirm both pass**

Run: `npm run test -- tests/unit/resolveCompensationForDate.test.ts`
Expected: both tests PASS.

- [ ] **Step 4: Run the full existing compensation/labor test suites to catch regressions**

Run:
```bash
npm run test -- tests/unit/laborCalculations.test.ts tests/unit/useScheduledLaborCosts.test.ts tests/unit/laborCalculations-clockInOut.test.ts tests/unit/laborCalculations-dailyRate.test.ts tests/unit/dashboardLaborCosts.test.ts tests/unit/pnlLaborCosts.test.ts
```
Expected: all PASS. If any fail, the failure reveals an assumption that conflicts with the new preference and must be analyzed — do NOT mass-update tests to hide the failure.

- [ ] **Step 5: Commit**

```bash
git add src/utils/compensationCalculations.ts
git commit -m "fix(labor-cost): prefer current comp_type when resolving history snapshot"
```

---

### Task 3: Add integration test at the `calculateScheduledLaborCost` level

**Files:**
- Modify: `tests/unit/useScheduledLaborCosts.test.ts` (add one test; do not remove existing cases)

- [ ] **Step 1: Read the existing test file to find a good insertion point and mock helpers**

```bash
sed -n '1,60p' tests/unit/useScheduledLaborCosts.test.ts
```

Identify how mock employees and shifts are constructed and where `describe` blocks group related assertions. Add the new test inside the same `describe` block that contains "ignores inactive employees" (nearby thematic fit).

- [ ] **Step 2: Add a new `it(...)` test immediately after the existing "ignores inactive employees" test**

The test must mirror the Alejandra data pattern: an hourly employee whose compensation_history contains a stale salary entry *after* all the hourly entries but *before* the shift date. Use the existing mock utilities in the file rather than creating new ones — follow whatever shape is already in use.

Test contract (shape, not literal code since helper names vary by file):
- Mock employee: `compensation_type: 'hourly'`, `hourly_rate: 1000`, plus `compensation_history` containing:
  - `{ effective_date: '2026-04-01', compensation_type: 'hourly', amount_cents: 1000 }`
  - `{ effective_date: '2026-04-11', compensation_type: 'salary', amount_cents: 60000 }`
- Mock shift: `start_time: '2026-04-13T15:00:00Z'`, `end_time: '2026-04-13T21:30:00Z'`, `break_duration: 30` → 6 net hours.
- Period: a week containing 2026-04-13.
- Expected: `breakdown.hourly.hours` is ~6 and `breakdown.hourly.cost` is ~60 (not 0).

- [ ] **Step 3: Run the new test plus the full file**

Run: `npm run test -- tests/unit/useScheduledLaborCosts.test.ts`
Expected: all tests PASS (the new one validates the end-to-end fix).

- [ ] **Step 4: Commit**

```bash
git add tests/unit/useScheduledLaborCosts.test.ts
git commit -m "test: cover stale salary history regression in scheduled labor cost aggregate"
```

---

### Task 4: Full verification

- [ ] **Step 1: Type check**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: no new warnings on touched files.

- [ ] **Step 3: Full test suite**

Run: `npm run test`
Expected: all PASS.

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: success.

---

## Self-Review Checklist

- [x] Spec coverage: every spec section maps to a task (resolver fix → Task 2, unit tests → Task 1, integration test → Task 3).
- [x] No placeholders: all test and code blocks contain concrete content.
- [x] Type consistency: `CompensationHistoryEntry`, `Employee`, and `resolveCompensationForDate` names match their source-of-truth definitions.
- [x] Out-of-scope items from spec are explicitly not present in any task.
