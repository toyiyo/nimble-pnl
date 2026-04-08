# Overtime Management Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add configurable overtime rules (weekly + daily thresholds), employee exempt classification, tip exclusion from OT rate, and manager OT classification overrides to the payroll system.

**Architecture:** Restaurant-level `overtime_rules` table stores thresholds/multipliers. Employees get `is_exempt` flag. `overtime_adjustments` table stores manager overrides. Pure calculation logic in `src/lib/overtimeCalculations.ts` (new file, no DB deps). Existing `payrollCalculations.ts` calls into it.

**Tech Stack:** TypeScript, Vitest (TDD), PostgreSQL migrations, Supabase RLS

---

### Task 1: Create OvertimeRules Types and Default Constants

**Files:**
- Create: `src/lib/overtimeCalculations.ts`
- Test: `tests/unit/overtimeCalculations.test.ts`

**Step 1: Write the failing test**

Create `tests/unit/overtimeCalculations.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_OVERTIME_RULES,
  type OvertimeRules,
} from '@/lib/overtimeCalculations';

describe('overtimeCalculations', () => {
  describe('DEFAULT_OVERTIME_RULES', () => {
    it('has federal FLSA defaults', () => {
      expect(DEFAULT_OVERTIME_RULES).toEqual({
        weeklyThresholdHours: 40,
        weeklyOtMultiplier: 1.5,
        dailyThresholdHours: null,
        dailyOtMultiplier: 1.5,
        dailyDoubleThresholdHours: null,
        dailyDoubleMultiplier: 2.0,
        excludeTipsFromOtRate: true,
      });
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test -- tests/unit/overtimeCalculations.test.ts`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

Create `src/lib/overtimeCalculations.ts`:

```typescript
/**
 * Overtime calculation engine.
 *
 * Pure functions — no database or Supabase dependencies.
 * The payroll hook fetches OvertimeRules from the DB and passes them here.
 */

export interface OvertimeRules {
  weeklyThresholdHours: number;
  weeklyOtMultiplier: number;
  dailyThresholdHours: number | null;
  dailyOtMultiplier: number;
  dailyDoubleThresholdHours: number | null;
  dailyDoubleMultiplier: number;
  excludeTipsFromOtRate: boolean;
}

export interface OvertimeAdjustment {
  employeeId: string;
  punchDate: string; // YYYY-MM-DD
  adjustmentType: 'regular_to_overtime' | 'overtime_to_regular';
  hours: number;
  reason: string;
}

export interface OvertimeResult {
  regularHours: number;
  weeklyOvertimeHours: number;
  dailyOvertimeHours: number;
  doubleTimeHours: number;
}

export const DEFAULT_OVERTIME_RULES: OvertimeRules = {
  weeklyThresholdHours: 40,
  weeklyOtMultiplier: 1.5,
  dailyThresholdHours: null,
  dailyOtMultiplier: 1.5,
  dailyDoubleThresholdHours: null,
  dailyDoubleMultiplier: 2.0,
  excludeTipsFromOtRate: true,
};
```

**Step 4: Run test to verify it passes**

Run: `npm run test -- tests/unit/overtimeCalculations.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/lib/overtimeCalculations.ts tests/unit/overtimeCalculations.test.ts
git commit -m "feat(payroll): add OvertimeRules types and federal defaults"
```

---

### Task 2: Implement Daily Overtime Calculation

**Files:**
- Modify: `src/lib/overtimeCalculations.ts`
- Modify: `tests/unit/overtimeCalculations.test.ts`

**Step 1: Write the failing tests**

Append to `tests/unit/overtimeCalculations.test.ts` inside the top-level `describe`:

```typescript
import {
  DEFAULT_OVERTIME_RULES,
  calculateDailyOvertime,
  type OvertimeRules,
} from '@/lib/overtimeCalculations';

describe('calculateDailyOvertime', () => {
  it('returns all regular hours when no daily threshold is set', () => {
    const result = calculateDailyOvertime(10, null, null);
    expect(result).toEqual({
      regularHours: 10,
      dailyOvertimeHours: 0,
      doubleTimeHours: 0,
    });
  });

  it('returns all regular hours when under daily threshold', () => {
    const result = calculateDailyOvertime(7, 8, null);
    expect(result).toEqual({
      regularHours: 7,
      dailyOvertimeHours: 0,
      doubleTimeHours: 0,
    });
  });

  it('returns daily OT hours when over daily threshold', () => {
    // 10 hours with 8-hour threshold → 8 regular + 2 OT
    const result = calculateDailyOvertime(10, 8, null);
    expect(result).toEqual({
      regularHours: 8,
      dailyOvertimeHours: 2,
      doubleTimeHours: 0,
    });
  });

  it('returns double-time hours when over double threshold', () => {
    // 13 hours with 8-hour threshold and 12-hour double threshold
    // → 8 regular + 4 daily OT + 1 double-time
    const result = calculateDailyOvertime(13, 8, 12);
    expect(result).toEqual({
      regularHours: 8,
      dailyOvertimeHours: 4,
      doubleTimeHours: 1,
    });
  });

  it('handles exactly at daily threshold (no OT)', () => {
    const result = calculateDailyOvertime(8, 8, null);
    expect(result).toEqual({
      regularHours: 8,
      dailyOvertimeHours: 0,
      doubleTimeHours: 0,
    });
  });

  it('handles exactly at double-time threshold', () => {
    // 12 hours with 8/12 thresholds → 8 regular + 4 OT + 0 double
    const result = calculateDailyOvertime(12, 8, 12);
    expect(result).toEqual({
      regularHours: 8,
      dailyOvertimeHours: 4,
      doubleTimeHours: 0,
    });
  });

  it('handles zero hours', () => {
    const result = calculateDailyOvertime(0, 8, 12);
    expect(result).toEqual({
      regularHours: 0,
      dailyOvertimeHours: 0,
      doubleTimeHours: 0,
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test -- tests/unit/overtimeCalculations.test.ts`
Expected: FAIL — `calculateDailyOvertime` is not exported

**Step 3: Write minimal implementation**

Add to `src/lib/overtimeCalculations.ts`:

```typescript
/**
 * Calculate daily overtime for a single day's hours.
 *
 * @param hoursWorked - Total hours worked that day
 * @param dailyThreshold - Hours before daily OT kicks in (null = disabled)
 * @param doubleTimeThreshold - Hours before double-time kicks in (null = disabled)
 */
export function calculateDailyOvertime(
  hoursWorked: number,
  dailyThreshold: number | null,
  doubleTimeThreshold: number | null
): { regularHours: number; dailyOvertimeHours: number; doubleTimeHours: number } {
  if (dailyThreshold === null || hoursWorked <= dailyThreshold) {
    return { regularHours: hoursWorked, dailyOvertimeHours: 0, doubleTimeHours: 0 };
  }

  const regularHours = dailyThreshold;
  const overtimeTotal = hoursWorked - dailyThreshold;

  if (doubleTimeThreshold === null || hoursWorked <= doubleTimeThreshold) {
    return { regularHours, dailyOvertimeHours: overtimeTotal, doubleTimeHours: 0 };
  }

  const dailyOvertimeHours = doubleTimeThreshold - dailyThreshold;
  const doubleTimeHours = hoursWorked - doubleTimeThreshold;

  return { regularHours, dailyOvertimeHours, doubleTimeHours };
}
```

**Step 4: Run test to verify it passes**

Run: `npm run test -- tests/unit/overtimeCalculations.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/lib/overtimeCalculations.ts tests/unit/overtimeCalculations.test.ts
git commit -m "feat(payroll): add daily overtime calculation with double-time"
```

---

### Task 3: Implement Weekly Overtime Calculation with Daily OT Deduction

**Files:**
- Modify: `src/lib/overtimeCalculations.ts`
- Modify: `tests/unit/overtimeCalculations.test.ts`

**Step 1: Write the failing tests**

Add to `tests/unit/overtimeCalculations.test.ts`:

```typescript
import {
  DEFAULT_OVERTIME_RULES,
  calculateDailyOvertime,
  calculateWeeklyOvertime,
  type OvertimeRules,
} from '@/lib/overtimeCalculations';

describe('calculateWeeklyOvertime', () => {
  it('calculates weekly OT with federal defaults (40hr/1.5x, no daily)', () => {
    // 5 days x 9 hours = 45 total → 40 regular + 5 weekly OT
    const dailyHours: Record<string, number> = {
      '2026-02-16': 9, '2026-02-17': 9, '2026-02-18': 9,
      '2026-02-19': 9, '2026-02-20': 9,
    };
    const result = calculateWeeklyOvertime(dailyHours, DEFAULT_OVERTIME_RULES);
    expect(result.regularHours).toBe(40);
    expect(result.weeklyOvertimeHours).toBe(5);
    expect(result.dailyOvertimeHours).toBe(0);
    expect(result.doubleTimeHours).toBe(0);
  });

  it('calculates with custom weekly threshold', () => {
    // 35-hour threshold, 38 hours worked → 35 regular + 3 OT
    const rules: OvertimeRules = { ...DEFAULT_OVERTIME_RULES, weeklyThresholdHours: 35 };
    const dailyHours: Record<string, number> = {
      '2026-02-16': 8, '2026-02-17': 8, '2026-02-18': 8,
      '2026-02-19': 7, '2026-02-20': 7,
    };
    const result = calculateWeeklyOvertime(dailyHours, rules);
    expect(result.regularHours).toBe(35);
    expect(result.weeklyOvertimeHours).toBe(3);
  });

  it('no OT when under weekly threshold', () => {
    const dailyHours: Record<string, number> = {
      '2026-02-16': 8, '2026-02-17': 8, '2026-02-18': 8,
      '2026-02-19': 8, '2026-02-20': 7,
    };
    const result = calculateWeeklyOvertime(dailyHours, DEFAULT_OVERTIME_RULES);
    expect(result.regularHours).toBe(39);
    expect(result.weeklyOvertimeHours).toBe(0);
  });

  it('no OT when exactly at weekly threshold', () => {
    const dailyHours: Record<string, number> = {
      '2026-02-16': 8, '2026-02-17': 8, '2026-02-18': 8,
      '2026-02-19': 8, '2026-02-20': 8,
    };
    const result = calculateWeeklyOvertime(dailyHours, DEFAULT_OVERTIME_RULES);
    expect(result.regularHours).toBe(40);
    expect(result.weeklyOvertimeHours).toBe(0);
  });

  it('daily OT hours do NOT double-count toward weekly threshold', () => {
    // CA rules: 8hr daily, 40hr weekly
    // Mon-Fri: 10hr/day = 50 total
    // Daily pass: 5 days x 2hr daily OT = 10 daily OT hours
    // Remaining regular per day: 8hr x 5 = 40hr
    // Weekly pass: 40hr remaining = exactly at 40hr threshold → 0 weekly OT
    const rules: OvertimeRules = {
      ...DEFAULT_OVERTIME_RULES,
      dailyThresholdHours: 8,
    };
    const dailyHours: Record<string, number> = {
      '2026-02-16': 10, '2026-02-17': 10, '2026-02-18': 10,
      '2026-02-19': 10, '2026-02-20': 10,
    };
    const result = calculateWeeklyOvertime(dailyHours, rules);
    expect(result.regularHours).toBe(40);
    expect(result.dailyOvertimeHours).toBe(10);
    expect(result.weeklyOvertimeHours).toBe(0);
  });

  it('combined daily + weekly OT when both thresholds exceeded', () => {
    // CA rules: 8hr daily, 40hr weekly
    // Mon-Sat: 9hr Mon-Fri + 6hr Sat = 51 total
    // Daily pass: 5 days x 1hr daily OT = 5 daily OT, Sat = 0
    // Remaining regular: 8+8+8+8+8+6 = 46
    // Weekly pass: 46 - 40 = 6 weekly OT
    const rules: OvertimeRules = {
      ...DEFAULT_OVERTIME_RULES,
      dailyThresholdHours: 8,
    };
    const dailyHours: Record<string, number> = {
      '2026-02-16': 9, '2026-02-17': 9, '2026-02-18': 9,
      '2026-02-19': 9, '2026-02-20': 9, '2026-02-21': 6,
    };
    const result = calculateWeeklyOvertime(dailyHours, rules);
    expect(result.dailyOvertimeHours).toBe(5);
    expect(result.regularHours).toBe(40);
    expect(result.weeklyOvertimeHours).toBe(6);
  });

  it('handles double-time combined with weekly OT', () => {
    // CA rules: 8hr daily, 12hr double, 40hr weekly
    // Mon: 14hr → 8 regular + 4 daily OT + 2 double-time
    // Tue-Fri: 8hr each = 32hr regular
    // Total regular after daily pass: 8 + 32 = 40 → 0 weekly OT
    const rules: OvertimeRules = {
      ...DEFAULT_OVERTIME_RULES,
      dailyThresholdHours: 8,
      dailyDoubleThresholdHours: 12,
    };
    const dailyHours: Record<string, number> = {
      '2026-02-16': 14, '2026-02-17': 8, '2026-02-18': 8,
      '2026-02-19': 8, '2026-02-20': 8,
    };
    const result = calculateWeeklyOvertime(dailyHours, rules);
    expect(result.regularHours).toBe(40);
    expect(result.dailyOvertimeHours).toBe(4);
    expect(result.doubleTimeHours).toBe(2);
    expect(result.weeklyOvertimeHours).toBe(0);
  });

  it('handles empty daily hours', () => {
    const result = calculateWeeklyOvertime({}, DEFAULT_OVERTIME_RULES);
    expect(result.regularHours).toBe(0);
    expect(result.weeklyOvertimeHours).toBe(0);
    expect(result.dailyOvertimeHours).toBe(0);
    expect(result.doubleTimeHours).toBe(0);
  });

  it('handles custom 2.0x weekly multiplier (just verifies hours, not pay)', () => {
    const rules: OvertimeRules = { ...DEFAULT_OVERTIME_RULES, weeklyOtMultiplier: 2.0 };
    const dailyHours: Record<string, number> = {
      '2026-02-16': 10, '2026-02-17': 10, '2026-02-18': 10,
      '2026-02-19': 10, '2026-02-20': 10,
    };
    const result = calculateWeeklyOvertime(dailyHours, rules);
    // Hours are the same regardless of multiplier
    expect(result.regularHours).toBe(40);
    expect(result.weeklyOvertimeHours).toBe(10);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test -- tests/unit/overtimeCalculations.test.ts`
Expected: FAIL — `calculateWeeklyOvertime` is not exported

**Step 3: Write minimal implementation**

Add to `src/lib/overtimeCalculations.ts`:

```typescript
/**
 * Calculate overtime for a single week given daily hours.
 *
 * Two-pass algorithm:
 * 1. Daily pass — consume daily OT / double-time per day
 * 2. Weekly pass — sum remaining regular hours, apply weekly threshold
 *
 * @param dailyHours - Map of date string (YYYY-MM-DD) → hours worked that day
 * @param rules - Overtime configuration
 */
export function calculateWeeklyOvertime(
  dailyHours: Record<string, number>,
  rules: OvertimeRules
): OvertimeResult {
  let totalRegular = 0;
  let totalDailyOt = 0;
  let totalDoubleTime = 0;

  // Pass 1: Daily overtime
  for (const hours of Object.values(dailyHours)) {
    const daily = calculateDailyOvertime(
      hours,
      rules.dailyThresholdHours,
      rules.dailyDoubleThresholdHours
    );
    totalRegular += daily.regularHours;
    totalDailyOt += daily.dailyOvertimeHours;
    totalDoubleTime += daily.doubleTimeHours;
  }

  // Pass 2: Weekly overtime on remaining regular hours
  let weeklyOt = 0;
  if (totalRegular > rules.weeklyThresholdHours) {
    weeklyOt = totalRegular - rules.weeklyThresholdHours;
    totalRegular = rules.weeklyThresholdHours;
  }

  return {
    regularHours: Math.round(totalRegular * 100) / 100,
    weeklyOvertimeHours: Math.round(weeklyOt * 100) / 100,
    dailyOvertimeHours: Math.round(totalDailyOt * 100) / 100,
    doubleTimeHours: Math.round(totalDoubleTime * 100) / 100,
  };
}
```

**Step 4: Run test to verify it passes**

Run: `npm run test -- tests/unit/overtimeCalculations.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/lib/overtimeCalculations.ts tests/unit/overtimeCalculations.test.ts
git commit -m "feat(payroll): add weekly overtime with daily OT deduction"
```

---

### Task 4: Implement OT Adjustments (Manager Overrides)

**Files:**
- Modify: `src/lib/overtimeCalculations.ts`
- Modify: `tests/unit/overtimeCalculations.test.ts`

**Step 1: Write the failing tests**

Add to `tests/unit/overtimeCalculations.test.ts`:

```typescript
import {
  DEFAULT_OVERTIME_RULES,
  calculateDailyOvertime,
  calculateWeeklyOvertime,
  applyOvertimeAdjustments,
  type OvertimeRules,
  type OvertimeResult,
  type OvertimeAdjustment,
} from '@/lib/overtimeCalculations';

describe('applyOvertimeAdjustments', () => {
  it('moves hours from regular to overtime', () => {
    const base: OvertimeResult = {
      regularHours: 40, weeklyOvertimeHours: 0,
      dailyOvertimeHours: 0, doubleTimeHours: 0,
    };
    const adjustments: OvertimeAdjustment[] = [{
      employeeId: 'emp-1', punchDate: '2026-02-16',
      adjustmentType: 'regular_to_overtime', hours: 3,
      reason: 'Missed clock-out correction',
    }];
    const result = applyOvertimeAdjustments(base, adjustments);
    expect(result.regularHours).toBe(37);
    expect(result.weeklyOvertimeHours).toBe(3);
  });

  it('moves hours from overtime to regular', () => {
    const base: OvertimeResult = {
      regularHours: 40, weeklyOvertimeHours: 5,
      dailyOvertimeHours: 0, doubleTimeHours: 0,
    };
    const adjustments: OvertimeAdjustment[] = [{
      employeeId: 'emp-1', punchDate: '2026-02-16',
      adjustmentType: 'overtime_to_regular', hours: 2,
      reason: 'Hours were lunch, not work',
    }];
    const result = applyOvertimeAdjustments(base, adjustments);
    expect(result.regularHours).toBe(42);
    expect(result.weeklyOvertimeHours).toBe(3);
  });

  it('caps regular_to_overtime at available regular hours', () => {
    const base: OvertimeResult = {
      regularHours: 5, weeklyOvertimeHours: 0,
      dailyOvertimeHours: 0, doubleTimeHours: 0,
    };
    const adjustments: OvertimeAdjustment[] = [{
      employeeId: 'emp-1', punchDate: '2026-02-16',
      adjustmentType: 'regular_to_overtime', hours: 10,
      reason: 'Test cap',
    }];
    const result = applyOvertimeAdjustments(base, adjustments);
    expect(result.regularHours).toBe(0);
    expect(result.weeklyOvertimeHours).toBe(5); // capped at 5
  });

  it('caps overtime_to_regular at available weekly OT hours', () => {
    const base: OvertimeResult = {
      regularHours: 40, weeklyOvertimeHours: 3,
      dailyOvertimeHours: 0, doubleTimeHours: 0,
    };
    const adjustments: OvertimeAdjustment[] = [{
      employeeId: 'emp-1', punchDate: '2026-02-16',
      adjustmentType: 'overtime_to_regular', hours: 10,
      reason: 'Test cap',
    }];
    const result = applyOvertimeAdjustments(base, adjustments);
    expect(result.regularHours).toBe(43);
    expect(result.weeklyOvertimeHours).toBe(0); // capped at 3
  });

  it('applies multiple adjustments sequentially', () => {
    const base: OvertimeResult = {
      regularHours: 40, weeklyOvertimeHours: 5,
      dailyOvertimeHours: 0, doubleTimeHours: 0,
    };
    const adjustments: OvertimeAdjustment[] = [
      { employeeId: 'emp-1', punchDate: '2026-02-16',
        adjustmentType: 'overtime_to_regular', hours: 2, reason: 'a' },
      { employeeId: 'emp-1', punchDate: '2026-02-17',
        adjustmentType: 'regular_to_overtime', hours: 1, reason: 'b' },
    ];
    const result = applyOvertimeAdjustments(base, adjustments);
    // Start: 40 reg, 5 OT
    // After adj 1: 42 reg, 3 OT
    // After adj 2: 41 reg, 4 OT
    expect(result.regularHours).toBe(41);
    expect(result.weeklyOvertimeHours).toBe(4);
  });

  it('returns unchanged result when no adjustments', () => {
    const base: OvertimeResult = {
      regularHours: 40, weeklyOvertimeHours: 5,
      dailyOvertimeHours: 2, doubleTimeHours: 1,
    };
    const result = applyOvertimeAdjustments(base, []);
    expect(result).toEqual(base);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test -- tests/unit/overtimeCalculations.test.ts`
Expected: FAIL — `applyOvertimeAdjustments` is not exported

**Step 3: Write minimal implementation**

Add to `src/lib/overtimeCalculations.ts`:

```typescript
/**
 * Apply manager overrides to an OvertimeResult.
 *
 * Adjustments move hours between regular and weekly overtime.
 * Capped so neither bucket goes negative.
 */
export function applyOvertimeAdjustments(
  base: OvertimeResult,
  adjustments: OvertimeAdjustment[]
): OvertimeResult {
  if (adjustments.length === 0) return base;

  let { regularHours, weeklyOvertimeHours } = base;

  for (const adj of adjustments) {
    if (adj.adjustmentType === 'regular_to_overtime') {
      const moved = Math.min(adj.hours, regularHours);
      regularHours -= moved;
      weeklyOvertimeHours += moved;
    } else {
      const moved = Math.min(adj.hours, weeklyOvertimeHours);
      weeklyOvertimeHours -= moved;
      regularHours += moved;
    }
  }

  return {
    regularHours: Math.round(regularHours * 100) / 100,
    weeklyOvertimeHours: Math.round(weeklyOvertimeHours * 100) / 100,
    dailyOvertimeHours: base.dailyOvertimeHours,
    doubleTimeHours: base.doubleTimeHours,
  };
}
```

**Step 4: Run test to verify it passes**

Run: `npm run test -- tests/unit/overtimeCalculations.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/lib/overtimeCalculations.ts tests/unit/overtimeCalculations.test.ts
git commit -m "feat(payroll): add OT adjustment (manager override) logic"
```

---

### Task 5: Implement OT Pay Calculation (with Tip Exclusion)

**Files:**
- Modify: `src/lib/overtimeCalculations.ts`
- Modify: `tests/unit/overtimeCalculations.test.ts`

**Step 1: Write the failing tests**

Add to `tests/unit/overtimeCalculations.test.ts`:

```typescript
import {
  DEFAULT_OVERTIME_RULES,
  calculateDailyOvertime,
  calculateWeeklyOvertime,
  applyOvertimeAdjustments,
  calculateOvertimePay,
  type OvertimeRules,
  type OvertimeResult,
  type OvertimeAdjustment,
  type OvertimePayResult,
} from '@/lib/overtimeCalculations';

describe('calculateOvertimePay', () => {
  it('calculates pay with weekly OT only (tips excluded)', () => {
    const hours: OvertimeResult = {
      regularHours: 40, weeklyOvertimeHours: 5,
      dailyOvertimeHours: 0, doubleTimeHours: 0,
    };
    // $15/hr = 1500 cents, tips = 5000 cents, exclude tips
    const result = calculateOvertimePay(hours, 1500, 5000, DEFAULT_OVERTIME_RULES);
    expect(result.regularPay).toBe(40 * 1500); // 60000
    expect(result.overtimePay).toBe(5 * 1500 * 1.5); // 11250
    expect(result.doubleTimePay).toBe(0);
    expect(result.totalGrossPay).toBe(60000 + 11250);
  });

  it('calculates pay with daily OT (tips excluded)', () => {
    const hours: OvertimeResult = {
      regularHours: 40, weeklyOvertimeHours: 0,
      dailyOvertimeHours: 5, doubleTimeHours: 0,
    };
    const rules: OvertimeRules = { ...DEFAULT_OVERTIME_RULES, dailyOtMultiplier: 1.5 };
    const result = calculateOvertimePay(hours, 2000, 0, rules);
    expect(result.regularPay).toBe(40 * 2000);
    expect(result.overtimePay).toBe(5 * 2000 * 1.5);
    expect(result.doubleTimePay).toBe(0);
  });

  it('calculates pay with double-time', () => {
    const hours: OvertimeResult = {
      regularHours: 8, weeklyOvertimeHours: 0,
      dailyOvertimeHours: 4, doubleTimeHours: 2,
    };
    const rules: OvertimeRules = {
      ...DEFAULT_OVERTIME_RULES,
      dailyThresholdHours: 8,
      dailyDoubleThresholdHours: 12,
    };
    const result = calculateOvertimePay(hours, 1500, 0, rules);
    expect(result.regularPay).toBe(8 * 1500);
    expect(result.overtimePay).toBe(4 * 1500 * 1.5);
    expect(result.doubleTimePay).toBe(2 * 1500 * 2.0);
  });

  it('includes tips in OT rate when excludeTipsFromOtRate is false', () => {
    const hours: OvertimeResult = {
      regularHours: 40, weeklyOvertimeHours: 5,
      dailyOvertimeHours: 0, doubleTimeHours: 0,
    };
    const rules: OvertimeRules = { ...DEFAULT_OVERTIME_RULES, excludeTipsFromOtRate: false };
    // $15/hr = 1500c, tips = 45000c for 45 hours → tip rate = 1000c/hr
    // Effective rate = 1500 + 1000 = 2500
    const result = calculateOvertimePay(hours, 1500, 45000, rules);
    const totalHours = 40 + 5;
    const tipRatePerHour = Math.round(45000 / totalHours);
    const effectiveRate = 1500 + tipRatePerHour;
    expect(result.regularPay).toBe(40 * 1500); // Regular pay uses base rate
    expect(result.overtimePay).toBe(5 * effectiveRate * 1.5);
  });

  it('handles zero hours', () => {
    const hours: OvertimeResult = {
      regularHours: 0, weeklyOvertimeHours: 0,
      dailyOvertimeHours: 0, doubleTimeHours: 0,
    };
    const result = calculateOvertimePay(hours, 1500, 0, DEFAULT_OVERTIME_RULES);
    expect(result.regularPay).toBe(0);
    expect(result.overtimePay).toBe(0);
    expect(result.doubleTimePay).toBe(0);
    expect(result.totalGrossPay).toBe(0);
  });

  it('uses weekly multiplier for weekly OT and daily multiplier for daily OT', () => {
    const hours: OvertimeResult = {
      regularHours: 35, weeklyOvertimeHours: 3,
      dailyOvertimeHours: 5, doubleTimeHours: 0,
    };
    const rules: OvertimeRules = {
      ...DEFAULT_OVERTIME_RULES,
      weeklyThresholdHours: 35,
      weeklyOtMultiplier: 2.0,
      dailyThresholdHours: 8,
      dailyOtMultiplier: 1.5,
    };
    const result = calculateOvertimePay(hours, 1000, 0, rules);
    expect(result.regularPay).toBe(35 * 1000);
    // OT pay = weekly OT + daily OT
    // Weekly: 3 * 1000 * 2.0 = 6000
    // Daily: 5 * 1000 * 1.5 = 7500
    expect(result.overtimePay).toBe(6000 + 7500);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test -- tests/unit/overtimeCalculations.test.ts`
Expected: FAIL — `calculateOvertimePay` is not exported

**Step 3: Write minimal implementation**

Add to `src/lib/overtimeCalculations.ts`:

```typescript
export interface OvertimePayResult {
  regularPay: number;   // cents
  overtimePay: number;  // cents (weekly OT + daily OT combined)
  doubleTimePay: number; // cents
  totalGrossPay: number; // cents
}

/**
 * Calculate pay amounts from overtime hours.
 *
 * @param hours - OvertimeResult from calculateWeeklyOvertime
 * @param hourlyRateCents - Base hourly rate in cents
 * @param totalTipsCents - Total tips in cents for the period (used when tips included in OT rate)
 * @param rules - Overtime configuration
 */
export function calculateOvertimePay(
  hours: OvertimeResult,
  hourlyRateCents: number,
  totalTipsCents: number,
  rules: OvertimeRules
): OvertimePayResult {
  const totalHours = hours.regularHours + hours.weeklyOvertimeHours
    + hours.dailyOvertimeHours + hours.doubleTimeHours;

  // Determine OT base rate: include tips if configured
  let otBaseRate = hourlyRateCents;
  if (!rules.excludeTipsFromOtRate && totalHours > 0 && totalTipsCents > 0) {
    const tipRatePerHour = Math.round(totalTipsCents / totalHours);
    otBaseRate = hourlyRateCents + tipRatePerHour;
  }

  const regularPay = Math.round(hours.regularHours * hourlyRateCents);
  const weeklyOtPay = Math.round(hours.weeklyOvertimeHours * otBaseRate * rules.weeklyOtMultiplier);
  const dailyOtPay = Math.round(hours.dailyOvertimeHours * otBaseRate * rules.dailyOtMultiplier);
  const doubleTimePay = Math.round(hours.doubleTimeHours * otBaseRate * rules.dailyDoubleMultiplier);
  const overtimePay = weeklyOtPay + dailyOtPay;

  return {
    regularPay,
    overtimePay,
    doubleTimePay,
    totalGrossPay: regularPay + overtimePay + doubleTimePay,
  };
}
```

**Step 4: Run test to verify it passes**

Run: `npm run test -- tests/unit/overtimeCalculations.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/lib/overtimeCalculations.ts tests/unit/overtimeCalculations.test.ts
git commit -m "feat(payroll): add OT pay calculation with tip exclusion"
```

---

### Task 6: Implement Exempt Employee Handling

**Files:**
- Modify: `src/lib/overtimeCalculations.ts`
- Modify: `tests/unit/overtimeCalculations.test.ts`

**Step 1: Write the failing tests**

Add to `tests/unit/overtimeCalculations.test.ts`:

```typescript
import {
  DEFAULT_OVERTIME_RULES,
  calculateDailyOvertime,
  calculateWeeklyOvertime,
  applyOvertimeAdjustments,
  calculateOvertimePay,
  calculateEmployeeOvertime,
  type OvertimeRules,
  type OvertimeResult,
  type OvertimeAdjustment,
  type OvertimePayResult,
} from '@/lib/overtimeCalculations';

describe('calculateEmployeeOvertime', () => {
  it('skips OT calculation for exempt employees', () => {
    const dailyHours: Record<string, number> = {
      '2026-02-16': 10, '2026-02-17': 10, '2026-02-18': 10,
      '2026-02-19': 10, '2026-02-20': 10,
    };
    const result = calculateEmployeeOvertime({
      dailyHours,
      rules: DEFAULT_OVERTIME_RULES,
      isExempt: true,
      hourlyRateCents: 1500,
      totalTipsCents: 0,
      adjustments: [],
    });
    // All 50 hours are regular for exempt employees
    expect(result.hours.regularHours).toBe(50);
    expect(result.hours.weeklyOvertimeHours).toBe(0);
    expect(result.hours.dailyOvertimeHours).toBe(0);
    expect(result.hours.doubleTimeHours).toBe(0);
    expect(result.pay.overtimePay).toBe(0);
    expect(result.pay.regularPay).toBe(50 * 1500);
  });

  it('calculates full OT pipeline for non-exempt employees', () => {
    const dailyHours: Record<string, number> = {
      '2026-02-16': 9, '2026-02-17': 9, '2026-02-18': 9,
      '2026-02-19': 9, '2026-02-20': 9,
    };
    const result = calculateEmployeeOvertime({
      dailyHours,
      rules: DEFAULT_OVERTIME_RULES,
      isExempt: false,
      hourlyRateCents: 2000,
      totalTipsCents: 0,
      adjustments: [],
    });
    expect(result.hours.regularHours).toBe(40);
    expect(result.hours.weeklyOvertimeHours).toBe(5);
    expect(result.pay.regularPay).toBe(40 * 2000);
    expect(result.pay.overtimePay).toBe(5 * 2000 * 1.5);
  });

  it('applies adjustments after OT calculation for non-exempt', () => {
    const dailyHours: Record<string, number> = {
      '2026-02-16': 9, '2026-02-17': 9, '2026-02-18': 9,
      '2026-02-19': 9, '2026-02-20': 9,
    };
    const adjustments: OvertimeAdjustment[] = [{
      employeeId: 'emp-1', punchDate: '2026-02-16',
      adjustmentType: 'overtime_to_regular', hours: 2,
      reason: 'Correction',
    }];
    const result = calculateEmployeeOvertime({
      dailyHours,
      rules: DEFAULT_OVERTIME_RULES,
      isExempt: false,
      hourlyRateCents: 2000,
      totalTipsCents: 0,
      adjustments,
    });
    // 45 total → 40 reg + 5 OT, then adj moves 2 from OT to reg → 42 reg + 3 OT
    expect(result.hours.regularHours).toBe(42);
    expect(result.hours.weeklyOvertimeHours).toBe(3);
  });

  it('uses default rules when none provided', () => {
    const dailyHours: Record<string, number> = { '2026-02-16': 42 };
    const result = calculateEmployeeOvertime({
      dailyHours,
      isExempt: false,
      hourlyRateCents: 1000,
      totalTipsCents: 0,
      adjustments: [],
    });
    // Uses DEFAULT_OVERTIME_RULES: 40hr weekly threshold
    expect(result.hours.regularHours).toBe(40);
    expect(result.hours.weeklyOvertimeHours).toBe(2);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test -- tests/unit/overtimeCalculations.test.ts`
Expected: FAIL — `calculateEmployeeOvertime` is not exported

**Step 3: Write minimal implementation**

Add to `src/lib/overtimeCalculations.ts`:

```typescript
export interface CalculateEmployeeOvertimeInput {
  dailyHours: Record<string, number>;
  rules?: OvertimeRules;
  isExempt: boolean;
  hourlyRateCents: number;
  totalTipsCents: number;
  adjustments: OvertimeAdjustment[];
}

export interface EmployeeOvertimeResult {
  hours: OvertimeResult;
  pay: OvertimePayResult;
}

/**
 * Top-level orchestrator: daily OT → weekly OT → adjustments → pay.
 *
 * For exempt employees, all hours are regular (no OT calculated).
 */
export function calculateEmployeeOvertime(
  input: CalculateEmployeeOvertimeInput
): EmployeeOvertimeResult {
  const rules = input.rules ?? DEFAULT_OVERTIME_RULES;

  if (input.isExempt) {
    const totalHours = Object.values(input.dailyHours).reduce((s, h) => s + h, 0);
    const hours: OvertimeResult = {
      regularHours: totalHours,
      weeklyOvertimeHours: 0,
      dailyOvertimeHours: 0,
      doubleTimeHours: 0,
    };
    return {
      hours,
      pay: calculateOvertimePay(hours, input.hourlyRateCents, input.totalTipsCents, rules),
    };
  }

  const weeklyResult = calculateWeeklyOvertime(input.dailyHours, rules);
  const adjusted = applyOvertimeAdjustments(weeklyResult, input.adjustments);
  const pay = calculateOvertimePay(adjusted, input.hourlyRateCents, input.totalTipsCents, rules);

  return { hours: adjusted, pay };
}
```

**Step 4: Run test to verify it passes**

Run: `npm run test -- tests/unit/overtimeCalculations.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/lib/overtimeCalculations.ts tests/unit/overtimeCalculations.test.ts
git commit -m "feat(payroll): add exempt employee handling and top-level orchestrator"
```

---

### Task 7: Database Migration — overtime_rules Table

**Files:**
- Create: `supabase/migrations/<timestamp>_create_overtime_rules.sql`

**Step 1: Write the migration**

Create migration file (use next available timestamp):

```sql
-- Create overtime_rules table for per-restaurant overtime configuration
CREATE TABLE IF NOT EXISTS overtime_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  weekly_threshold_hours NUMERIC(5,2) NOT NULL DEFAULT 40.00,
  weekly_ot_multiplier NUMERIC(3,2) NOT NULL DEFAULT 1.50,
  daily_threshold_hours NUMERIC(5,2) DEFAULT NULL,
  daily_ot_multiplier NUMERIC(3,2) NOT NULL DEFAULT 1.50,
  daily_double_threshold_hours NUMERIC(5,2) DEFAULT NULL,
  daily_double_multiplier NUMERIC(3,2) NOT NULL DEFAULT 2.00,
  exclude_tips_from_ot_rate BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- One config per restaurant
  CONSTRAINT overtime_rules_restaurant_id_unique UNIQUE (restaurant_id),

  -- Multipliers must be positive
  CONSTRAINT overtime_rules_weekly_multiplier_positive CHECK (weekly_ot_multiplier > 0),
  CONSTRAINT overtime_rules_daily_multiplier_positive CHECK (daily_ot_multiplier > 0),
  CONSTRAINT overtime_rules_double_multiplier_positive CHECK (daily_double_multiplier > 0),

  -- Thresholds must be non-negative
  CONSTRAINT overtime_rules_weekly_threshold_gte_zero CHECK (weekly_threshold_hours >= 0),
  CONSTRAINT overtime_rules_daily_threshold_gte_zero CHECK (daily_threshold_hours IS NULL OR daily_threshold_hours >= 0),
  CONSTRAINT overtime_rules_double_threshold_gte_zero CHECK (daily_double_threshold_hours IS NULL OR daily_double_threshold_hours >= 0),

  -- Double-time threshold must be greater than daily threshold when both set
  CONSTRAINT overtime_rules_double_gt_daily CHECK (
    daily_double_threshold_hours IS NULL
    OR daily_threshold_hours IS NULL
    OR daily_double_threshold_hours > daily_threshold_hours
  )
);

-- RLS
ALTER TABLE overtime_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their restaurant overtime rules"
  ON overtime_rules FOR SELECT
  USING (
    restaurant_id IN (
      SELECT restaurant_id FROM restaurant_users WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Owners and managers can manage overtime rules"
  ON overtime_rules FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM restaurant_users
      WHERE restaurant_users.restaurant_id = overtime_rules.restaurant_id
      AND restaurant_users.user_id = auth.uid()
      AND restaurant_users.role IN ('owner', 'manager')
    )
  );

-- Updated_at trigger
CREATE TRIGGER update_overtime_rules_updated_at
  BEFORE UPDATE ON overtime_rules
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Index
CREATE INDEX idx_overtime_rules_restaurant_id ON overtime_rules(restaurant_id);
```

**Step 2: Apply migration**

Use the Supabase MCP `apply_migration` tool with name `create_overtime_rules` and the SQL above.

**Step 3: Verify**

Run: `npm run test:db` (if pgTAP tests exist for this table) or manually verify via `mcp__supabase__list_tables`.

**Step 4: Commit**

```bash
git add supabase/migrations/*_create_overtime_rules.sql
git commit -m "feat(payroll): add overtime_rules table with RLS"
```

---

### Task 8: Database Migration — overtime_adjustments Table

**Files:**
- Create: `supabase/migrations/<timestamp>_create_overtime_adjustments.sql`

**Step 1: Write the migration**

```sql
-- Create overtime_adjustments table for manager OT classification overrides
CREATE TABLE IF NOT EXISTS overtime_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  punch_date DATE NOT NULL,
  adjustment_type TEXT NOT NULL CHECK (adjustment_type IN ('regular_to_overtime', 'overtime_to_regular')),
  hours NUMERIC(5,2) NOT NULL CHECK (hours > 0),
  reason TEXT,
  adjusted_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Prevent duplicate adjustments for same employee/date/type
  CONSTRAINT overtime_adjustments_unique_per_date UNIQUE (restaurant_id, employee_id, punch_date, adjustment_type)
);

-- RLS
ALTER TABLE overtime_adjustments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their restaurant overtime adjustments"
  ON overtime_adjustments FOR SELECT
  USING (
    restaurant_id IN (
      SELECT restaurant_id FROM restaurant_users WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Owners and managers can manage overtime adjustments"
  ON overtime_adjustments FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM restaurant_users
      WHERE restaurant_users.restaurant_id = overtime_adjustments.restaurant_id
      AND restaurant_users.user_id = auth.uid()
      AND restaurant_users.role IN ('owner', 'manager')
    )
  );

-- Indexes
CREATE INDEX idx_overtime_adjustments_restaurant_id ON overtime_adjustments(restaurant_id);
CREATE INDEX idx_overtime_adjustments_employee_date ON overtime_adjustments(employee_id, punch_date);
```

**Step 2: Apply migration**

Use the Supabase MCP `apply_migration` tool.

**Step 3: Commit**

```bash
git add supabase/migrations/*_create_overtime_adjustments.sql
git commit -m "feat(payroll): add overtime_adjustments table with RLS"
```

---

### Task 9: Database Migration — Add is_exempt to employees

**Files:**
- Create: `supabase/migrations/<timestamp>_add_employee_exempt_status.sql`

**Step 1: Write the migration**

```sql
-- Add FLSA exempt status to employees table
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS is_exempt BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS exempt_changed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS exempt_changed_by UUID REFERENCES auth.users(id);

-- Comment for documentation
COMMENT ON COLUMN employees.is_exempt IS 'FLSA exempt status — exempt employees are excluded from overtime calculations';
COMMENT ON COLUMN employees.exempt_changed_at IS 'When exempt status was last changed';
COMMENT ON COLUMN employees.exempt_changed_by IS 'User who last changed exempt status';
```

**Step 2: Apply migration**

Use the Supabase MCP `apply_migration` tool.

**Step 3: Update Employee TypeScript type**

Modify `src/types/scheduling.ts` — add after line 64 (`tip_eligible`):

```typescript
  // FLSA exempt status
  is_exempt?: boolean; // Exempt employees skip OT calculations
```

**Step 4: Commit**

```bash
git add supabase/migrations/*_add_employee_exempt_status.sql src/types/scheduling.ts
git commit -m "feat(payroll): add is_exempt field to employees table and type"
```

---

### Task 10: Integrate Overtime Engine into payrollCalculations.ts

**Files:**
- Modify: `src/utils/payrollCalculations.ts`
- Modify: `tests/unit/overtimeCalculations.test.ts` (add integration test)

This is the critical task that connects the new overtime engine to the existing payroll system.

**Step 1: Write an integration test**

Add to `tests/unit/overtimeCalculations.test.ts`:

```typescript
describe('Integration: calculateEmployeeOvertime with realistic scenarios', () => {
  it('CA restaurant: daily 8hr + weekly 40hr + double-time 12hr', () => {
    const rules: OvertimeRules = {
      weeklyThresholdHours: 40,
      weeklyOtMultiplier: 1.5,
      dailyThresholdHours: 8,
      dailyOtMultiplier: 1.5,
      dailyDoubleThresholdHours: 12,
      dailyDoubleMultiplier: 2.0,
      excludeTipsFromOtRate: true,
    };
    // Mon: 14hr (8 reg + 4 daily OT + 2 double-time)
    // Tue-Fri: 8hr each (32 reg)
    // Sat: 4hr (4 reg)
    // Remaining regular = 8+32+4 = 44 → 40 reg + 4 weekly OT
    const dailyHours: Record<string, number> = {
      '2026-02-16': 14, '2026-02-17': 8, '2026-02-18': 8,
      '2026-02-19': 8, '2026-02-20': 8, '2026-02-21': 4,
    };
    const result = calculateEmployeeOvertime({
      dailyHours,
      rules,
      isExempt: false,
      hourlyRateCents: 2000, // $20/hr
      totalTipsCents: 10000,
      adjustments: [],
    });

    expect(result.hours.regularHours).toBe(40);
    expect(result.hours.dailyOvertimeHours).toBe(4);
    expect(result.hours.doubleTimeHours).toBe(2);
    expect(result.hours.weeklyOvertimeHours).toBe(4);

    // Pay: regular = 40 * 2000 = 80000
    // Daily OT = 4 * 2000 * 1.5 = 12000
    // Weekly OT = 4 * 2000 * 1.5 = 12000
    // Double = 2 * 2000 * 2.0 = 8000
    expect(result.pay.regularPay).toBe(80000);
    expect(result.pay.overtimePay).toBe(24000); // daily + weekly
    expect(result.pay.doubleTimePay).toBe(8000);
    expect(result.pay.totalGrossPay).toBe(112000);
  });

  it('federal-only restaurant: weekly 40hr, no daily OT', () => {
    const dailyHours: Record<string, number> = {
      '2026-02-16': 12, '2026-02-17': 12, '2026-02-18': 12,
      '2026-02-19': 12, '2026-02-20': 4,
    };
    // 52 total → 40 regular + 12 weekly OT, no daily OT
    const result = calculateEmployeeOvertime({
      dailyHours,
      rules: DEFAULT_OVERTIME_RULES,
      isExempt: false,
      hourlyRateCents: 1500,
      totalTipsCents: 0,
      adjustments: [],
    });

    expect(result.hours.regularHours).toBe(40);
    expect(result.hours.weeklyOvertimeHours).toBe(12);
    expect(result.hours.dailyOvertimeHours).toBe(0);
    expect(result.hours.doubleTimeHours).toBe(0);
    expect(result.pay.regularPay).toBe(60000);
    expect(result.pay.overtimePay).toBe(12 * 1500 * 1.5); // 27000
  });
});
```

**Step 2: Run test to verify it passes** (should already pass from prior tasks)

Run: `npm run test -- tests/unit/overtimeCalculations.test.ts`
Expected: PASS

**Step 3: Update EmployeePayroll interface in payrollCalculations.ts**

In `src/utils/payrollCalculations.ts`, update the `EmployeePayroll` interface (lines 40-62) to add:

```typescript
export interface EmployeePayroll {
  // ... existing fields ...
  doubleTimeHours: number;       // NEW
  doubleTimePay: number;         // NEW - in cents
  dailyOvertimeHours: number;    // NEW
  weeklyOvertimeHours: number;   // NEW
}
```

**Step 4: Update calculateEmployeePay to use the new overtime engine**

Replace the hourly calculation block in `calculateEmployeePay` (approximately lines 413-443) with:

```typescript
import {
  calculateEmployeeOvertime,
  DEFAULT_OVERTIME_RULES,
  type OvertimeRules as OTRules,
  type OvertimeAdjustment,
} from '@/lib/overtimeCalculations';
```

In the `if (compensationType === 'hourly')` block, replace the weekly totals + OT calculation with a call to `calculateEmployeeOvertime`. The function signature of `calculateEmployeePay` should gain two optional parameters:

```typescript
export function calculateEmployeePay(
  employee: Employee,
  punches: TimePunch[],
  tips: number,
  periodStartDate?: Date,
  periodEndDate?: Date,
  manualPayments: ManualPayment[] = [],
  tipsPaidOut: number = 0,
  overtimeRules?: OTRules,           // NEW
  overtimeAdjustments: OvertimeAdjustment[] = []  // NEW
): EmployeePayroll {
```

Then in the hourly block, build `dailyHours` from the parsed work periods (as is done already with `hoursByDate`), and call:

```typescript
const otResult = calculateEmployeeOvertime({
  dailyHours: Object.fromEntries(hoursByDate),
  rules: overtimeRules,
  isExempt: employee.is_exempt ?? false,
  hourlyRateCents: employee.hourly_rate,
  totalTipsCents: tips,
  adjustments: overtimeAdjustments.filter(a => a.employeeId === employee.id),
});

totalRegularHours = otResult.hours.regularHours;
totalOvertimeHours = otResult.hours.weeklyOvertimeHours + otResult.hours.dailyOvertimeHours + otResult.hours.doubleTimeHours;
regularPay = otResult.pay.regularPay;
overtimePay = otResult.pay.overtimePay;
doubleTimePay = otResult.pay.doubleTimePay;
dailyOvertimeHours = otResult.hours.dailyOvertimeHours;
weeklyOvertimeHours = otResult.hours.weeklyOvertimeHours;
doubleTimeHours = otResult.hours.doubleTimeHours;
```

**Important:** The existing `calculateEmployeeDailyCostForDate` call handles compensation history (rate changes mid-period). For the initial integration, use the current `employee.hourly_rate` for the OT engine. If the employee has compensation history, the existing behavior already uses the correct rate per day. The OT engine receives hours per day, and we can compute pay separately per day using the historical rates — this is a refinement that can come later. For now, focus on getting the OT hour buckets correct, and use the average rate approach.

**Step 5: Run existing payroll tests to ensure no regression**

Run: `npm run test -- tests/unit/payrollCalculations.test.ts tests/unit/payrollCalculations-dailyRate.test.ts tests/unit/payrollTipsAllCompTypes.test.ts`
Expected: PASS (existing tests should still pass since federal defaults match current behavior)

**Step 6: Commit**

```bash
git add src/utils/payrollCalculations.ts src/lib/overtimeCalculations.ts tests/unit/overtimeCalculations.test.ts
git commit -m "feat(payroll): integrate overtime engine into payrollCalculations"
```

---

### Task 11: Update calculatePayrollPeriod and usePayroll Hook

**Files:**
- Modify: `src/utils/payrollCalculations.ts` (lines 556-592)
- Modify: `src/hooks/usePayroll.tsx`

**Step 1: Update PayrollPeriod interface**

In `src/utils/payrollCalculations.ts`, update `PayrollPeriod` to add:

```typescript
export interface PayrollPeriod {
  // ... existing fields ...
  totalDoubleTimeHours: number;  // NEW
}
```

**Step 2: Update calculatePayrollPeriod signature**

Add `overtimeRules` and `overtimeAdjustments` parameters to `calculatePayrollPeriod`:

```typescript
export function calculatePayrollPeriod(
  startDate: Date,
  endDate: Date,
  employees: Employee[],
  punchesPerEmployee: Map<string, TimePunch[]>,
  tipsPerEmployee: Map<string, number>,
  manualPaymentsPerEmployee: Map<string, ManualPayment[]> = new Map(),
  tipPayoutsPerEmployee: Map<string, number> = new Map(),
  overtimeRules?: OTRules,                              // NEW
  overtimeAdjustments: OvertimeAdjustment[] = []         // NEW
): PayrollPeriod {
```

Pass `overtimeRules` and the employee's adjustments to `calculateEmployeePay`.

**Step 3: Update usePayroll to fetch overtime_rules and overtime_adjustments**

In `src/hooks/usePayroll.tsx`, add two Supabase queries inside the existing `useQuery`:

```typescript
// Fetch overtime rules for restaurant
const { data: otRulesData } = await supabase
  .from('overtime_rules')
  .select('*')
  .eq('restaurant_id', restaurantId)
  .maybeSingle();

// Fetch overtime adjustments for the period
const { data: otAdjData } = await supabase
  .from('overtime_adjustments')
  .select('*')
  .eq('restaurant_id', restaurantId)
  .gte('punch_date', format(startDate, 'yyyy-MM-dd'))
  .lte('punch_date', format(endDate, 'yyyy-MM-dd'));
```

Map `otRulesData` to `OvertimeRules` type (or use `undefined` for defaults).
Map `otAdjData` to `OvertimeAdjustment[]`.
Pass both to `calculatePayrollPeriod`.

**Step 4: Run all payroll tests**

Run: `npm run test -- tests/unit/payrollCalculations.test.ts tests/unit/overtimeCalculations.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/utils/payrollCalculations.ts src/hooks/usePayroll.tsx
git commit -m "feat(payroll): wire overtime rules and adjustments into payroll hook"
```

---

### Task 12: Update PayrollPeriod Aggregation and CSV Export

**Files:**
- Modify: `src/utils/payrollCalculations.ts` (exportPayrollToCSV)

**Step 1: Update CSV export to include new columns**

Add "Double-Time Hours", "Double-Time Pay", "Daily OT Hours", "Weekly OT Hours" columns to the CSV export function (`exportPayrollToCSV`, line 597).

**Step 2: Update PayrollPeriod aggregation**

In `calculatePayrollPeriod`, add:
```typescript
const totalDoubleTimeHours = employeePayrolls.reduce((sum, ep) => sum + (ep.doubleTimeHours || 0), 0);
```

**Step 3: Run existing CSV test**

Run: `npm run test -- tests/unit/payrollCalculations.test.ts`
Expected: May need to update existing CSV test assertions to include new columns.

**Step 4: Commit**

```bash
git add src/utils/payrollCalculations.ts tests/unit/payrollCalculations.test.ts
git commit -m "feat(payroll): add double-time and OT breakdown to CSV export"
```

---

### Task 13: Database Tests (pgTAP)

**Files:**
- Create: `supabase/tests/overtime_rules.test.sql`

**Step 1: Write pgTAP tests**

```sql
BEGIN;
SELECT plan(10);

-- Table exists
SELECT has_table('public', 'overtime_rules', 'overtime_rules table exists');
SELECT has_table('public', 'overtime_adjustments', 'overtime_adjustments table exists');

-- overtime_rules columns
SELECT has_column('public', 'overtime_rules', 'restaurant_id', 'has restaurant_id');
SELECT has_column('public', 'overtime_rules', 'weekly_threshold_hours', 'has weekly_threshold_hours');
SELECT has_column('public', 'overtime_rules', 'daily_threshold_hours', 'has daily_threshold_hours');
SELECT has_column('public', 'overtime_rules', 'exclude_tips_from_ot_rate', 'has exclude_tips_from_ot_rate');

-- overtime_adjustments columns
SELECT has_column('public', 'overtime_adjustments', 'employee_id', 'has employee_id');
SELECT has_column('public', 'overtime_adjustments', 'adjustment_type', 'has adjustment_type');
SELECT has_column('public', 'overtime_adjustments', 'hours', 'has hours');

-- employees.is_exempt
SELECT has_column('public', 'employees', 'is_exempt', 'employees has is_exempt');

SELECT * FROM finish();
ROLLBACK;
```

**Step 2: Run pgTAP tests**

Run: `npm run test:db`
Expected: PASS

**Step 3: Commit**

```bash
git add supabase/tests/overtime_rules.test.sql
git commit -m "test(payroll): add pgTAP tests for overtime tables"
```

---

### Task 14: Run Full Test Suite and Fix Any Regressions

**Step 1: Run all unit tests**

Run: `npm run test`
Expected: All existing tests pass, no regressions

**Step 2: Fix any failing tests**

The most likely breakage is in existing `payrollCalculations.test.ts` tests that check the `EmployeePayroll` interface shape. Update them to include the new fields with default values (0 for `doubleTimeHours`, `doubleTimePay`, `dailyOvertimeHours`, `weeklyOvertimeHours`).

**Step 3: Run lint**

Run: `npm run lint`
Expected: No new lint errors from our changes

**Step 4: Commit fixes**

```bash
git add -A
git commit -m "fix(payroll): fix test regressions from overtime engine integration"
```
