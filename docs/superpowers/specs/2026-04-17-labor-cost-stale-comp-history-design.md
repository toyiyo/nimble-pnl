# Labor Cost: Stale Compensation History Snapshot Fix

**Date:** 2026-04-17
**Type:** Bug fix
**Area:** Scheduling / Labor cost calculations

## Problem

On the Scheduling page, the Labor Cost card total is inconsistent with the Top Earners list underneath it. For a week with two scheduled shifts (Jose 7h @ $10 = $70, Alejandra 6h @ $10 = $60) the card displays `$70 (7h)` while Top Earners correctly lists both employees totalling $130.

## Root Cause

`resolveCompensationForDate` (`src/utils/compensationCalculations.ts:72`) picks the most recent `employee_compensation_history` entry with `effective_date <= targetDate` **regardless of the entry's `compensation_type`**. When an employee's history contains a stale entry from a prior comp-type era — e.g. a `salary` entry left over from before the switch to hourly — the resolver returns `compensation_type = 'salary'` for a shift dated after that stale entry.

In `calculateScheduledLaborCost` (`src/services/laborCalculations.ts:400`), the branch selection is driven by the snapshot's `compensation_type`. A salary-typed snapshot skips the hourly branch, falls through the salary branch (zero because `pay_period_type` on the current row is unset), and the shift contributes **neither cost nor hours** to the aggregate. Meanwhile `useEmployeeLaborCosts` reads `emp.compensation_type` directly from the current row, so Top Earners stays correct.

### Evidence (production data)

Alejandra's `employee_compensation_history` for her current record:
| effective_date | hist_comp_type | amount_cents |
|----------------|----------------|--------------|
| 2026-03-01     | hourly         | 3000         |
| 2026-03-15     | hourly         | 1500         |
| 2026-04-01     | hourly         | 1000         |
| 2026-04-11     | **salary**     | 60000        |

Current `employees.compensation_type = 'hourly'`, `hourly_rate = 1000`.

For her shift on **2026-04-13**, the resolver returns the 2026-04-11 salary entry, and the shift is dropped from the aggregate.

## Fix

In `resolveCompensationForDate`, prefer history entries whose `compensation_type` matches the employee's current `compensation_type`. Only fall back to a mismatched entry if no matching entry exists for the date.

```ts
const matching = history.find(
  h => h.effective_date <= dateStr && h.compensation_type === employee.compensation_type
);
const entry = matching ?? history.find(h => h.effective_date <= dateStr);
```

### Why this shape

- **Targeted:** a single narrow change to the resolver fixes every downstream caller (`calculateScheduledLaborCost`, `calculateEmployeePeriodCost`, `calculateEmployeeDailyCostForDate`, `getEmployeeSnapshotForDate`).
- **Respects historical rate changes** within the same comp type — Alejandra's 2026-03-15 $15 → 2026-04-01 $10 transition still resolves correctly by date.
- **Respects legitimate comp-type transitions** — if no entry of the current type exists yet for the date, the fallback still returns the older-type entry, preserving historical-reality payroll math for past periods.
- **Aligns with `useEmployeeLaborCosts`** which already treats the employee's current `compensation_type` as the source of truth.

## Out of Scope

- The `employee.status !== 'active'` guard in `calculateScheduledLaborCost:385` is inconsistent with `useEmployeeLaborCosts` and the hook's own "count inactive employees" comment, but it does not cause this bug (Alejandra is active). Separate PR.
- Data hygiene: cleaning up the stale 2026-04-11 `salary` history entries on Jose's and Alejandra's records. Separate task.

## Testing

1. Unit test for `resolveCompensationForDate`: history containing a stale entry of a different `compensation_type` is skipped in favor of the most-recent matching-type entry.
2. Unit test for `resolveCompensationForDate`: fallback path — when no matching-type entry exists for the date, mismatched entry is returned (legitimate historical comp-type transition).
3. Integration test for `calculateScheduledLaborCost`: exactly reproduces the Alejandra bug — hourly employee with a stale salary entry before the shift date is still counted in the aggregate.

All three tests must fail before the fix and pass after.

## Risks

- **Legitimate salary→hourly transition with past shifts**: unchanged behavior — when no matching-type entry exists yet, we fall back to the older entry. Covered by Test 2.
- **Multiple comp-type switches**: covered by the `find` semantics — the resolver walks DESC-sorted history and picks the first match of the current type, which is always the most recent.
