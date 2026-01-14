# Daily Rate Compensation Enhancement Plan

> **Context**: Add support for "Per Day Worked" compensation - a fixed daily rate derived from a weekly reference amount, where employees only earn pay for days they actually work.

## 📋 Executive Summary

**What the Owner Calls It**: "Salary"  
**What It Actually Is**: **Fixed Daily Rate, derived from a Weekly Reference**

This is NOT a traditional salary (fixed payment regardless of days worked). It's a day-rated compensation model where:
- Reference amount: $1,000/week
- Standard work days: 6 days
- **Derived daily rate: $166.67 per day**
- Pay earned: **Only for days actually worked**
- Hours are **irrelevant** (even if they work 60 hours)

### Key Properties
- ✅ No guaranteed minimum payout
- ✅ Zero days worked = $0 pay
- ✅ Seven days worked = $1,166.67 (more than reference)
- ✅ Hours don't affect pay
- ✅ Day is the unit of work and pay

---

## 🎯 Design Principles

### 1. DRY (Don't Repeat Yourself)
- Reuse existing `CompensationType` infrastructure
- Extend `calculateDailyLaborCost()` pattern
- Leverage compensation history system
- Use existing payroll calculation flows

### 2. Truth in Modeling
```typescript
// ❌ WRONG - Misleading name
compensation_type: 'salary_prorated'

// ✅ CORRECT - Honest name
compensation_type: 'daily_rate'
```

### 3. Atomic Unit = Day
The invariant: **Pay = Days Worked × Daily Rate**

No proration, no smoothing, no hour-based calculation.

---

## 🗄️ Database Changes

### Migration: Add `daily_rate` Compensation Type

```sql
-- File: supabase/migrations/YYYYMMDD_add_daily_rate_compensation.sql

BEGIN;

-- STEP 1: Add new compensation type to constraint
ALTER TABLE employees
  DROP CONSTRAINT IF EXISTS employees_compensation_type_check,
  ADD CONSTRAINT employees_compensation_type_check
    CHECK (compensation_type IN ('hourly', 'salary', 'contractor', 'daily_rate'));

-- STEP 2: Add daily_rate-specific fields
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS daily_rate_amount INTEGER DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS daily_rate_reference_weekly INTEGER DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS daily_rate_reference_days INTEGER DEFAULT NULL;

-- Add documentation
COMMENT ON COLUMN employees.daily_rate_amount IS 
  'Derived daily rate in cents (e.g., $1000/6 days = 16667 cents)';
COMMENT ON COLUMN employees.daily_rate_reference_weekly IS 
  'Weekly reference amount in cents (e.g., $1000 = 100000 cents) - for display/audit';
COMMENT ON COLUMN employees.daily_rate_reference_days IS 
  'Standard work days per week (e.g., 6) - for display/audit';

-- STEP 3: Update compensation_history to support daily_rate
-- (Already supports amount_cents, just need to handle the new type)

COMMIT;
```

### Why This Schema?

1. **`daily_rate_amount`** - The source of truth for pay calculations
2. **`daily_rate_reference_weekly`** - Shows manager intent ("I think of this as $1000/week")
3. **`daily_rate_reference_days`** - Shows the divisor (6 days)

**Critical**: The daily rate is **snapshotted** when set, not recalculated each payroll. If the manager changes from $1000/6 to $1200/6, that's a **new compensation history entry** ($200 raise).

---

## 📝 TypeScript Changes

### 1. Update Types (`src/types/scheduling.ts`)

```typescript
// Add new type to union
export type CompensationType = 
  | 'hourly' 
  | 'salary' 
  | 'contractor' 
  | 'daily_rate'; // NEW

// Add fields to Employee interface
export interface Employee {
  // ... existing fields ...
  
  // Daily rate compensation (NEW)
  daily_rate_amount?: number; // In cents (the derived rate)
  daily_rate_reference_weekly?: number; // In cents (the "mental model" amount)
  daily_rate_reference_days?: number; // Standard days (usually 6)
}
```

### 2. Update Compensation Calculations (`src/utils/compensationCalculations.ts`)

```typescript
/**
 * Calculate the daily labor cost for an employee based on their compensation type
 */
export function calculateDailyLaborCost(
  employee: Employee,
  hoursWorked?: number
): number {
  switch (employee.compensation_type) {
    case 'hourly':
      if (hoursWorked === undefined) {
        throw new Error('Hours worked required for hourly employees');
      }
      return Math.round(employee.hourly_rate * hoursWorked);

    case 'salary':
      if (!employee.salary_amount || !employee.pay_period_type) {
        throw new Error('Salary amount and pay period required');
      }
      if (employee.allocate_daily === false) return 0;
      return calculateDailySalaryAllocation(
        employee.salary_amount,
        employee.pay_period_type
      );

    case 'contractor':
      if (!employee.contractor_payment_amount || !employee.contractor_payment_interval) {
        throw new Error('Payment amount and interval required');
      }
      if (employee.allocate_daily === false) return 0;
      return calculateDailyContractorAllocation(
        employee.contractor_payment_amount,
        employee.contractor_payment_interval
      );

    case 'daily_rate': // NEW
      if (!employee.daily_rate_amount) {
        throw new Error('Daily rate amount required for daily rate employees');
      }
      // Simple: return the rate. Hours don't matter.
      return employee.daily_rate_amount;

    default:
      return 0;
  }
}
```

### 3. Add Daily Rate Calculation Helpers

```typescript
/**
 * Calculate daily rate from weekly reference amount and days
 * 
 * @param weeklyAmountCents - Weekly reference amount in cents
 * @param standardDays - Standard work days per week
 * @returns Daily rate in cents (rounded to nearest cent)
 * 
 * @example
 * calculateDailyRateFromWeekly(100000, 6) // $1000 / 6 = 16667 cents ($166.67)
 */
export function calculateDailyRateFromWeekly(
  weeklyAmountCents: number,
  standardDays: number
): number {
  if (standardDays <= 0) {
    throw new Error('Standard days must be greater than 0');
  }
  return Math.round(weeklyAmountCents / standardDays);
}

/**
 * Calculate pay for a daily rate employee for a given period
 * 
 * @param employee - The daily rate employee
 * @param workedDays - Number of days actually worked
 * @returns Total pay in cents
 * 
 * @example
 * // Employee with $166.67/day rate, worked 4 days
 * calculateDailyRatePay(employee, 4) // Returns 66668 cents ($666.68)
 */
export function calculateDailyRatePay(
  employee: Employee,
  workedDays: number
): number {
  if (!employee.daily_rate_amount) {
    throw new Error('Daily rate amount required');
  }
  return Math.round(employee.daily_rate_amount * workedDays);
}

/**
 * Validation: Ensure daily_rate employees have required fields
 */
export function validateCompensationFields(
  employee: Partial<Employee>
): string[] {
  const errors: string[] = [];

  if (!employee.compensation_type) {
    errors.push('Compensation type is required');
    return errors;
  }

  switch (employee.compensation_type) {
    // ... existing cases ...

    case 'daily_rate':
      if (!employee.daily_rate_amount || employee.daily_rate_amount <= 0) {
        errors.push('Daily rate amount must be greater than 0');
      }
      if (!employee.daily_rate_reference_weekly || employee.daily_rate_reference_weekly <= 0) {
        errors.push('Weekly reference amount must be greater than 0');
      }
      if (!employee.daily_rate_reference_days || employee.daily_rate_reference_days <= 0) {
        errors.push('Standard work days must be greater than 0');
      }
      break;
  }

  return errors;
}

/**
 * Format compensation type for display
 */
export function formatCompensationType(type: CompensationType): string {
  const labels: Record<CompensationType, string> = {
    hourly: 'Hourly',
    salary: 'Salaried',
    contractor: 'Contractor',
    daily_rate: 'Per Day Worked', // NEW - User-friendly label
  };
  return labels[type];
}
```

### 4. Update Payroll Calculations (`src/utils/payrollCalculations.ts`)

```typescript
// Add new interface for daily rate payroll
export interface DailyRatePayroll {
  employeeId: string;
  employeeName: string;
  position: string;
  compensationType: 'daily_rate';
  dailyRate: number; // In cents
  daysWorked: number;
  totalPay: number; // daysWorked × dailyRate
  weeklyReference?: number; // For display
}

// Update EmployeePayroll interface
export interface EmployeePayroll {
  // ... existing fields ...
  
  // Add daily_rate fields
  dailyRatePay: number; // In cents (for daily_rate employees)
  daysWorked?: number; // Number of days worked (for daily_rate)
}

/**
 * Calculate pay for an employee
 * NOW SUPPORTS: hourly, salary, contractor, daily_rate
 */
export function calculateEmployeePay(
  employee: Employee,
  punches: TimePunch[],
  tips: number,
  periodStartDate?: Date,
  periodEndDate?: Date,
  manualPayments: ManualPayment[] = []
): EmployeePayroll {
  const compensationType = employee.compensation_type || 'hourly';
  
  let totalRegularHours = 0;
  let totalOvertimeHours = 0;
  let regularPay = 0;
  let overtimePay = 0;
  let salaryPay = 0;
  let contractorPay = 0;
  let dailyRatePay = 0; // NEW
  let daysWorked = 0; // NEW
  const allIncompleteShifts: IncompleteShift[] = [];
  
  // Calculate based on compensation type
  if (compensationType === 'hourly') {
    // ... existing hourly logic ...
    
  } else if (compensationType === 'salary' && periodStartDate && periodEndDate) {
    salaryPay = calculateSalaryForPeriod(employee, periodStartDate, periodEndDate);
    
  } else if (compensationType === 'contractor' && periodStartDate && periodEndDate) {
    contractorPay = calculateContractorPayForPeriod(employee, periodStartDate, periodEndDate);
    
  } else if (compensationType === 'daily_rate' && periodStartDate && periodEndDate) {
    // NEW: Daily rate calculation
    // Count unique days with punches OR use schedule data
    const uniqueDays = new Set<string>();
    
    punches.forEach(punch => {
      const dateKey = format(new Date(punch.punch_time), 'yyyy-MM-dd');
      const punchDate = new Date(dateKey);
      
      // Only count days within the pay period
      if (punchDate >= periodStartDate && punchDate <= periodEndDate) {
        uniqueDays.add(dateKey);
      }
    });
    
    daysWorked = uniqueDays.size;
    dailyRatePay = calculateDailyRatePay(employee, daysWorked);
  }

  const manualPaymentsTotal = manualPayments.reduce((sum, p) => sum + p.amount, 0);
  const grossPay = regularPay + overtimePay + salaryPay + contractorPay + dailyRatePay + manualPaymentsTotal;
  const totalPay = grossPay + tips;

  return {
    employeeId: employee.id,
    employeeName: employee.name,
    position: employee.position,
    compensationType,
    hourlyRate: employee.hourly_rate,
    regularHours: Math.round(totalRegularHours * 100) / 100,
    overtimeHours: Math.round(totalOvertimeHours * 100) / 100,
    regularPay,
    overtimePay,
    salaryPay,
    contractorPay,
    dailyRatePay, // NEW
    daysWorked: daysWorked > 0 ? daysWorked : undefined, // NEW
    manualPayments,
    manualPaymentsTotal,
    grossPay,
    totalTips: tips,
    totalPay,
    incompleteShifts: allIncompleteShifts.length > 0 ? allIncompleteShifts : undefined,
  };
}
```

---

## 🎨 UI Changes

### 1. Update EmployeeDialog (`src/components/EmployeeDialog.tsx`)

```tsx
// Add state for daily rate fields
const [dailyRateWeekly, setDailyRateWeekly] = useState('');
const [dailyRateStandardDays, setDailyRateStandardDays] = useState('6');

// Calculate derived daily rate (preview)
const derivedDailyRate = useMemo(() => {
  const weekly = parseFloat(dailyRateWeekly) || 0;
  const days = parseInt(dailyRateStandardDays) || 1;
  return weekly / days;
}, [dailyRateWeekly, dailyRateStandardDays]);

// In the form JSX:
<div className="space-y-2">
  <Label>Compensation Type</Label>
  <Select value={compensationType} onValueChange={setCompensationType}>
    <SelectTrigger>
      <SelectValue />
    </SelectTrigger>
    <SelectContent>
      <SelectItem value="hourly">Hourly</SelectItem>
      <SelectItem value="salary">Fixed Salary (guaranteed)</SelectItem>
      <SelectItem value="daily_rate">Per Day Worked</SelectItem> {/* NEW */}
      <SelectItem value="contractor">Contractor</SelectItem>
    </SelectContent>
  </Select>
</div>

{/* NEW: Daily Rate Fields */}
{compensationType === 'daily_rate' && (
  <div className="space-y-4 p-4 bg-muted/50 rounded-lg">
    <div className="flex items-start gap-2">
      <Info className="h-4 w-4 text-muted-foreground mt-1" />
      <p className="text-sm text-muted-foreground">
        Employees are paid only for the days they work. Hours don't affect pay.
      </p>
    </div>
    
    <div className="space-y-2">
      <Label htmlFor="weekly-reference">
        Weekly Reference Amount
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <HelpCircle className="h-3 w-3 inline ml-1 text-muted-foreground" />
            </TooltipTrigger>
            <TooltipContent>
              <p>The "anchor" amount you think of (e.g., "$1000 per week").</p>
              <p className="text-xs mt-1">This is for reference only - actual pay is based on days worked.</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </Label>
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground">$</span>
        <Input
          id="weekly-reference"
          type="number"
          step="0.01"
          min="0"
          value={dailyRateWeekly}
          onChange={(e) => setDailyRateWeekly(e.target.value)}
          placeholder="1000.00"
        />
        <span className="text-sm text-muted-foreground">per week</span>
      </div>
    </div>

    <div className="space-y-2">
      <Label htmlFor="standard-days">Standard Work Days</Label>
      <Select 
        value={dailyRateStandardDays} 
        onValueChange={setDailyRateStandardDays}
      >
        <SelectTrigger id="standard-days">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="5">5 days (1 weekend day + 1 rest)</SelectItem>
          <SelectItem value="6">6 days (1 rest day)</SelectItem>
          <SelectItem value="7">7 days (no rest day)</SelectItem>
        </SelectContent>
      </Select>
    </div>

    {/* CRITICAL: Show the derived rate */}
    <div className="p-3 bg-primary/10 border border-primary/20 rounded-md">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Daily Rate</span>
        <span className="text-lg font-bold text-primary">
          ${derivedDailyRate.toFixed(2)} / day
        </span>
      </div>
      
      {/* Examples */}
      <div className="mt-3 space-y-1 text-xs text-muted-foreground border-t pt-2">
        <div className="flex justify-between">
          <span>3 days worked:</span>
          <span className="font-medium">${(derivedDailyRate * 3).toFixed(2)}</span>
        </div>
        <div className="flex justify-between">
          <span>{dailyRateStandardDays} days worked:</span>
          <span className="font-medium">${dailyRateWeekly}</span>
        </div>
        <div className="flex justify-between">
          <span>7 days worked:</span>
          <span className="font-medium text-orange-600">
            ${(derivedDailyRate * 7).toFixed(2)}
          </span>
        </div>
      </div>
    </div>

    {/* Warn about 7-day scenario */}
    {parseInt(dailyRateStandardDays) < 7 && (
      <div className="flex items-start gap-2 p-2 bg-orange-50 dark:bg-orange-950/20 border border-orange-200 dark:border-orange-800 rounded text-xs">
        <Info className="h-3 w-3 text-orange-600 mt-0.5 flex-shrink-0" />
        <p className="text-orange-800 dark:text-orange-300">
          If this employee works 7 days, they'll earn <strong>${(derivedDailyRate * 7).toFixed(2)}</strong>,
          which is more than the weekly reference amount.
        </p>
      </div>
    )}
  </div>
)}
```

**Why This UX Works**:
1. **Transparency** - Manager sees exactly what the daily rate is
2. **Examples** - Shows 3 days, standard days, and 7 days scenarios
3. **Warning** - Highlights the "7 days" edge case upfront
4. **Intent Preserved** - Stores both the "mental model" ($1000/week) and the calculated rate

### 2. Update Payroll Display (`src/pages/Payroll.tsx`)

```tsx
{/* For daily_rate employees in the payroll table */}
{employee.compensationType === 'daily_rate' && (
  <>
    <TableCell className="text-center">
      {employee.daysWorked || 0}
    </TableCell>
    <TableCell className="text-center">-</TableCell> {/* No hours */}
    <TableCell className="text-right">
      {formatCurrency(employee.dailyRatePay)}
    </TableCell>
    <TableCell className="text-right text-muted-foreground text-xs">
      {employee.daysWorked} days × $
      {((employee.dailyRatePay / (employee.daysWorked || 1)) / 100).toFixed(2)}
    </TableCell>
  </>
)}
```

### 3. Schedule → Payroll Connection

On the **Scheduling page** (`src/pages/Scheduling.tsx`):

```tsx
// When rendering shift cards for daily_rate employees
{shift.employee?.compensation_type === 'daily_rate' && (
  <div className="flex items-center gap-1 text-xs text-muted-foreground">
    <DollarSign className="h-3 w-3" />
    <span>
      ${((shift.employee.daily_rate_amount || 0) / 100).toFixed(2)}
    </span>
  </div>
)}
```

This gives managers **immediate visibility**: "Each day costs me $X"

---

## 🔄 Daily P&L Integration

### Update Labor Cost Hook (`src/hooks/useLaborCostsFromTimeTracking.tsx`)

```typescript
// When calculating daily labor costs, treat daily_rate same as hourly:
// - Count unique days with punches
// - Multiply by daily rate
// - No hour calculations needed

const dailyRateCosts = employees
  .filter(emp => emp.compensation_type === 'daily_rate')
  .reduce((total, emp) => {
    const empPunches = punches.filter(p => p.employee_id === emp.id);
    
    // Count unique days
    const uniqueDays = new Set(
      empPunches.map(p => format(new Date(p.punch_time), 'yyyy-MM-dd'))
    );
    
    const cost = (emp.daily_rate_amount || 0) * uniqueDays.size;
    return total + cost;
  }, 0);
```

### Daily P&L Display

```tsx
<Card>
  <CardHeader>
    <CardTitle>Labor Costs</CardTitle>
  </CardHeader>
  <CardContent>
    <div className="space-y-2">
      <div className="flex justify-between">
        <span className="text-sm text-muted-foreground">Hourly Wages</span>
        <span className="font-medium">{formatCurrency(hourlyWages)}</span>
      </div>
      <div className="flex justify-between">
        <span className="text-sm text-muted-foreground">Daily Rate</span>
        <span className="font-medium">{formatCurrency(dailyRateWages)}</span>
      </div>
      <div className="flex justify-between">
        <span className="text-sm text-muted-foreground">Salary</span>
        <span className="font-medium">{formatCurrency(salaryWages)}</span>
      </div>
      <Separator />
      <div className="flex justify-between font-bold">
        <span>Total Labor</span>
        <span>{formatCurrency(totalLabor)} ({laborPercent}%)</span>
      </div>
    </div>
  </CardContent>
</Card>
```

---

## ✅ Testing Strategy

### Unit Tests (`tests/unit/dailyRateCompensation.test.ts`)

```typescript
import { describe, it, expect } from 'vitest';
import {
  calculateDailyRateFromWeekly,
  calculateDailyRatePay,
  calculateDailyLaborCost,
} from '@/utils/compensationCalculations';

describe('Daily Rate Compensation', () => {
  describe('calculateDailyRateFromWeekly', () => {
    it('calculates correct daily rate from weekly amount', () => {
      // $1000 / 6 days = $166.67
      expect(calculateDailyRateFromWeekly(100000, 6)).toBe(16667);
    });

    it('handles 5-day week', () => {
      // $1000 / 5 days = $200.00
      expect(calculateDailyRateFromWeekly(100000, 5)).toBe(20000);
    });

    it('handles 7-day week', () => {
      // $1000 / 7 days = $142.86
      expect(calculateDailyRateFromWeekly(100000, 7)).toBe(14286);
    });

    it('throws error for zero days', () => {
      expect(() => calculateDailyRateFromWeekly(100000, 0)).toThrow();
    });

    it('rounds to nearest cent', () => {
      // $100 / 3 days = $33.33 (not $33.333...)
      expect(calculateDailyRateFromWeekly(10000, 3)).toBe(3333);
    });
  });

  describe('calculateDailyRatePay', () => {
    const employee = {
      id: 'test',
      compensation_type: 'daily_rate' as const,
      daily_rate_amount: 16667, // $166.67
      daily_rate_reference_weekly: 100000,
      daily_rate_reference_days: 6,
    };

    it('calculates pay for zero days', () => {
      expect(calculateDailyRatePay(employee, 0)).toBe(0);
    });

    it('calculates pay for 3 days', () => {
      // 3 × $166.67 = $500.01
      expect(calculateDailyRatePay(employee, 3)).toBe(50001);
    });

    it('calculates pay for 6 days (reference amount)', () => {
      // 6 × $166.67 = $1000.02
      expect(calculateDailyRatePay(employee, 6)).toBe(100002);
    });

    it('calculates pay for 7 days (more than reference)', () => {
      // 7 × $166.67 = $1166.69
      expect(calculateDailyRatePay(employee, 7)).toBe(116669);
    });

    it('throws error if daily_rate_amount is missing', () => {
      const invalidEmployee = { ...employee, daily_rate_amount: undefined };
      expect(() => calculateDailyRatePay(invalidEmployee as any, 3)).toThrow();
    });
  });

  describe('calculateDailyLaborCost', () => {
    it('returns daily rate amount (hours irrelevant)', () => {
      const employee = {
        compensation_type: 'daily_rate' as const,
        daily_rate_amount: 16667,
      };

      // Hours don't matter for daily rate
      expect(calculateDailyLaborCost(employee as any)).toBe(16667);
      expect(calculateDailyLaborCost(employee as any, 8)).toBe(16667);
      expect(calculateDailyLaborCost(employee as any, 12)).toBe(16667);
      expect(calculateDailyLaborCost(employee as any, 0)).toBe(16667);
    });
  });

  describe('Edge Cases', () => {
    it('CRITICAL: Zero days worked = $0 pay', () => {
      const employee = {
        compensation_type: 'daily_rate' as const,
        daily_rate_amount: 16667,
      };
      expect(calculateDailyRatePay(employee as any, 0)).toBe(0);
    });

    it('CRITICAL: 7 days worked exceeds weekly reference', () => {
      const employee = {
        compensation_type: 'daily_rate' as const,
        daily_rate_amount: 16667, // $1000/6 = $166.67
        daily_rate_reference_weekly: 100000, // $1000
      };
      
      const pay = calculateDailyRatePay(employee as any, 7);
      expect(pay).toBeGreaterThan(100000); // More than $1000
    });

    it('handles fractional cents correctly', () => {
      // $100.01 / 3 days = $33.34 (rounded)
      expect(calculateDailyRateFromWeekly(10001, 3)).toBe(3334);
    });
  });
});
```

### E2E Test (`tests/e2e/daily-rate-payroll.spec.ts`)

```typescript
import { test, expect } from '@playwright/test';

test.describe('Daily Rate Compensation', () => {
  test('should calculate pay based on days worked, not hours', async ({ page }) => {
    // 1. Create employee with daily rate
    // 2. Create punches for 3 different days (varying hours)
    // 3. Run payroll
    // 4. Verify: 3 days × $166.67 = $500.01 (regardless of hours)
  });

  test('should show derived daily rate in employee form', async ({ page }) => {
    // 1. Open employee dialog
    // 2. Select "Per Day Worked"
    // 3. Enter $1000 weekly, 6 days
    // 4. Verify derived rate shows $166.67
    // 5. Verify examples show 3 days, 6 days, 7 days
  });

  test('should warn when 7 days exceeds reference', async ({ page }) => {
    // 1. Set up daily rate employee
    // 2. Schedule 7 days
    // 3. Verify warning appears in schedule view
  });
});
```

### SQL Tests (`supabase/tests/11_daily_rate_compensation.sql`)

```sql
BEGIN;
SELECT plan(5);

-- Setup: Create test employee
INSERT INTO employees (id, restaurant_id, name, position, compensation_type, 
  daily_rate_amount, daily_rate_reference_weekly, daily_rate_reference_days, status)
VALUES (
  'test-daily-rate-emp',
  'test-restaurant',
  'Test Daily Rate',
  'Manager',
  'daily_rate',
  16667, -- $166.67
  100000, -- $1000/week
  6,
  'active'
);

-- Test 1: Verify employee created with daily_rate type
SELECT is(
  (SELECT compensation_type FROM employees WHERE id = 'test-daily-rate-emp'),
  'daily_rate',
  'Employee has daily_rate compensation type'
);

-- Test 2: Verify daily rate amount
SELECT is(
  (SELECT daily_rate_amount FROM employees WHERE id = 'test-daily-rate-emp'),
  16667,
  'Daily rate amount is correct'
);

-- Test 3: Verify reference fields stored
SELECT is(
  (SELECT daily_rate_reference_weekly FROM employees WHERE id = 'test-daily-rate-emp'),
  100000,
  'Weekly reference amount stored'
);

SELECT is(
  (SELECT daily_rate_reference_days FROM employees WHERE id = 'test-daily-rate-emp'),
  6,
  'Standard days stored'
);

-- Test 4: Compensation history supports daily_rate
INSERT INTO employee_compensation_history (
  employee_id, restaurant_id, compensation_type, amount_cents, effective_date
) VALUES (
  'test-daily-rate-emp', 'test-restaurant', 'daily_rate', 16667, '2024-01-01'
);

SELECT is(
  (SELECT compensation_type FROM employee_compensation_history 
   WHERE employee_id = 'test-daily-rate-emp'),
  'daily_rate',
  'Compensation history supports daily_rate type'
);

SELECT * FROM finish();
ROLLBACK;
```

---

## 📅 Implementation Phases

### Phase 1: Database Foundation (2-3 hours)
- [ ] Create migration to add `daily_rate` type
- [ ] Add `daily_rate_amount`, `daily_rate_reference_weekly`, `daily_rate_reference_days` columns
- [ ] Update constraint to include `daily_rate`
- [ ] Write SQL tests
- [ ] Run tests: `cd supabase/tests && ./run_tests.sh`

### Phase 2: TypeScript Core (3-4 hours)
- [ ] Update `CompensationType` in `src/types/scheduling.ts`
- [ ] Add daily rate fields to `Employee` interface
- [ ] Add `calculateDailyRateFromWeekly()` in `compensationCalculations.ts`
- [ ] Add `calculateDailyRatePay()` in `compensationCalculations.ts`
- [ ] Update `calculateDailyLaborCost()` to handle `daily_rate`
- [ ] Update `validateCompensationFields()` for `daily_rate`
- [ ] Update `formatCompensationType()` with "Per Day Worked" label
- [ ] Write unit tests: `tests/unit/dailyRateCompensation.test.ts`
- [ ] Run tests: `npm run test -- --run`

### Phase 3: Payroll Integration (3-4 hours)
- [ ] Add `dailyRatePay` and `daysWorked` to `EmployeePayroll` interface
- [ ] Update `calculateEmployeePay()` in `payrollCalculations.ts`
- [ ] Count unique days from punches for daily rate employees
- [ ] Update `useLaborCostsFromTimeTracking` hook
- [ ] Add daily rate to labor cost breakdown
- [ ] Write payroll calculation tests
- [ ] Run tests

### Phase 4: UI Implementation (4-5 hours)
- [ ] Update `EmployeeDialog.tsx` with daily rate fields
- [ ] Add "Per Day Worked" option to compensation type selector
- [ ] Add weekly reference amount input
- [ ] Add standard days selector (5, 6, 7)
- [ ] Add derived daily rate preview box
- [ ] Add examples (3 days, standard days, 7 days)
- [ ] Add warning for 7-day scenario
- [ ] Update save handler to store daily rate fields
- [ ] Update `Payroll.tsx` to display daily rate employees
- [ ] Show days worked and daily rate in payroll table
- [ ] Update `Scheduling.tsx` to show daily rate on shift cards
- [ ] Update Daily P&L to show daily rate labor breakdown

### Phase 5: Testing & Polish (3-4 hours)
- [ ] Write E2E test: Create daily rate employee
- [ ] Write E2E test: Calculate payroll for daily rate
- [ ] Write E2E test: Verify 7-day warning
- [ ] Test edge cases: 0 days, 7 days, mid-period
- [ ] Test compensation history changes
- [ ] Run full test suite: `npm run test -- --run && npm run test:e2e`
- [ ] Update documentation
- [ ] Code review

**Total Estimate**: 15-20 hours

---

## 🚨 Edge Cases & Considerations

### 1. Mid-Week Hire/Termination
```typescript
// Employee hired Wednesday, works Wed-Sun (5 days)
// Pay = 5 × $166.67 = $833.35
// NOT prorated based on "6 day standard"
```

### 2. Overtime Compliance
**Warning**: Even though this is "day rate", labor laws (like FLSA) may require overtime pay if hours > 40/week.

**Solution**: Add compliance check:
```typescript
if (compensationType === 'daily_rate' && totalHours > 40) {
  // Flag for review or auto-calculate OT
  warnings.push('Employee may be owed overtime - consult labor attorney');
}
```

### 3. Schedule vs. Actual
- **Pay based on**: Actual punches (verified shifts), NOT schedule
- **Projected cost**: Use schedule for forecasting
- **Final cost**: Use time punches for payroll

### 4. Compensation History
When daily rate changes:
```typescript
// Old rate: $1000/6 = $166.67
// New rate: $1200/6 = $200.00
// Create new compensation_history entry effective_date = '2024-02-01'
// Payroll respects historical rates for past pay periods
```

### 5. Per-Day Contractor vs. Daily Rate Employee
| Aspect | Daily Rate Employee | Per-Job Contractor |
|--------|---------------------|---------------------|
| W-2/1099 | W-2 (employee) | 1099 (contractor) |
| Benefits | Eligible | Not eligible |
| Overtime | May be required | Not applicable |
| Time Punches | Required (for day count) | Optional |
| Payment Trigger | Days worked | Job completion |

**Use Case**:
- **Daily Rate**: Kitchen manager paid $166.67/day for days worked
- **Per-Job Contractor**: Catering chef paid $500 per event

---

## 🎓 Manager Education

### Documentation to Add

**Help Article**: "Understanding 'Per Day Worked' Compensation"

> **When to Use Daily Rate**  
> Use this for employees who:
> - Work a predictable schedule (most days of the week)
> - Are paid the same amount per day regardless of hours
> - Don't qualify for true salary (guaranteed pay)
> 
> **Example**: A kitchen manager works 6 days per week. You agree to pay $1000/week, which equals $166.67/day. If they work:
> - 3 days (sick/vacation): $500.01
> - 6 days (normal): $1000.02
> - 7 days (busy week): $1166.69 ⚠️
> 
> **Important**: This is NOT a salary. If they don't work, they don't get paid. If they work 7 days, you pay more than the weekly reference.
> 
> **Legal Note**: Consult with an attorney to ensure this compensation structure complies with labor laws in your jurisdiction, especially regarding overtime requirements.

### In-App Tooltips

```tsx
<Tooltip>
  <TooltipTrigger>
    <HelpCircle className="h-4 w-4" />
  </TooltipTrigger>
  <TooltipContent>
    <p className="font-semibold">What is "Per Day Worked"?</p>
    <p className="text-xs mt-1">
      A fixed rate per day worked. Unlike salary (guaranteed pay), 
      employees only earn for days they actually work.
    </p>
    <p className="text-xs mt-2 text-orange-400">
      ⚠️ Working 7 days will exceed the weekly reference amount.
    </p>
  </TooltipContent>
</Tooltip>
```

---

## 📚 Related Files

### To Modify
- ✅ `src/types/scheduling.ts` - Add `daily_rate` type and fields
- ✅ `src/utils/compensationCalculations.ts` - Add daily rate calculations
- ✅ `src/utils/payrollCalculations.ts` - Update `calculateEmployeePay()`
- ✅ `src/components/EmployeeDialog.tsx` - Add daily rate UI
- ✅ `src/pages/Payroll.tsx` - Display daily rate payroll
- ✅ `src/pages/Scheduling.tsx` - Show daily rate on shifts
- ✅ `src/hooks/useLaborCostsFromTimeTracking.tsx` - Include daily rate in costs
- ✅ `supabase/migrations/YYYYMMDD_add_daily_rate_compensation.sql` - Database changes

### To Create
- ✅ `tests/unit/dailyRateCompensation.test.ts` - Unit tests
- ✅ `tests/e2e/daily-rate-payroll.spec.ts` - E2E tests
- ✅ `supabase/tests/11_daily_rate_compensation.sql` - SQL tests
- ✅ `docs/DAILY_RATE_COMPENSATION_PLAN.md` - This document

---

## 🎯 Success Criteria

- [ ] Manager can create "Per Day Worked" employee with $1000/6 days
- [ ] System calculates and displays derived daily rate ($166.67)
- [ ] Payroll correctly calculates: 4 days × $166.67 = $666.68
- [ ] Daily P&L shows daily rate labor costs on correct dates
- [ ] Schedule view shows daily rate per shift
- [ ] Compensation history tracks daily rate changes
- [ ] All tests pass (unit, E2E, SQL)
- [ ] No breaking changes to existing hourly/salary/contractor code

---

## 🔮 Future Enhancements

1. **Schedule-Based Projection**
   - Show projected cost: "6 days scheduled = $1000.02"
   - Compare to actual: "4 days worked = $666.68"

2. **Compliance Checks**
   - Auto-calculate overtime if hours > 40
   - Flag exempt vs. non-exempt status

3. **Multi-Location Allocation**
   - Split daily rate across locations for managers
   - e.g., $166.67 → 50% Location A, 50% Location B

4. **Variable Daily Rates**
   - Different rates for weekdays vs. weekends
   - e.g., $150/weekday, $200/weekend

5. **Advanced Scheduling Integration**
   - Auto-detect "scheduled but didn't work" scenarios
   - Flag missing punches for daily rate employees

---

## 💡 Key Takeaways

1. **Honest Naming**: "Per Day Worked" not "Salary" - it's day-rated compensation
2. **Rate × Units**: Pay = Days Worked × Daily Rate (simple, auditable)
3. **Snapshot Rates**: Store calculated daily rate, not recalculate each payroll
4. **Transparency**: Show manager the math upfront (3 days, 6 days, 7 days examples)
5. **DRY Principle**: Reuse existing compensation infrastructure, just extend it
6. **Daily P&L Perfect**: Each day = one atomic cost event (no smoothing, no averaging)

---

**Remember**: This system manages real restaurants with real people's paychecks. Accuracy and transparency are paramount. The math should be trivial to audit and explain.
