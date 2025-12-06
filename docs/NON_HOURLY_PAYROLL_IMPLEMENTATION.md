# Non-Hourly Employee Payroll Implementation Plan

> Implementation plan for supporting **salaried employees** and **contractors** in EasyShiftHQ's payroll system.

## 📋 Executive Summary

Currently, EasyShiftHQ's payroll calculation assumes **hourly wages × time punches**. This implementation adds support for:

| Compensation Type | Payment Basis | Time Punches | Daily P&L Allocation |
|------------------|---------------|--------------|----------------------|
| **Hourly** | hours × rate | Required | From actual punches |
| **Salary** | Fixed per period | Optional | Auto-distributed daily |
| **Contractor** | Fixed per period/job | Not required | Auto-distributed or per-job |

---

## 🎯 Goals

1. **Unified Payroll Engine** - One calculation system for all wage types
2. **Real-time Daily P&L** - Daily labor allocation for accurate prime cost %
3. **Zero Manual Spreadsheets** - Operators don't manually calculate salary/contractor costs
4. **POS Independent** - Works even if POS doesn't have salary/contractor data

---

## 📊 Current State Analysis

### Existing Tables & Types

```
employees table:
- id, restaurant_id, name, email, phone
- position, hourly_rate (cents), status
- hire_date, notes, created_at, updated_at

daily_labor_costs table:
- id, restaurant_id, date
- hourly_wages, salary_wages, benefits
- total_labor_cost (computed), total_hours
```

### Current Payroll Flow

```
1. usePayroll fetches time_punches + employee_tips
2. payrollCalculations.ts processes hourly employees:
   - parseWorkPeriods() → work hours
   - calculateRegularAndOvertimeHours() → regular/OT split
   - calculateEmployeePay() → wages
3. Daily P&L uses daily_labor_costs table
```

**Key Finding**: `salary_wages` column exists but is unused! We can leverage this.

---

## 🗄️ Database Changes

### Migration 1: Add Compensation Fields to `employees`

```sql
-- Add compensation type and related fields
ALTER TABLE employees
  ADD COLUMN compensation_type TEXT NOT NULL DEFAULT 'hourly'
    CHECK (compensation_type IN ('hourly', 'salary', 'contractor')),
  ADD COLUMN salary_amount INTEGER DEFAULT NULL, -- Per period, in cents
  ADD COLUMN pay_period_type TEXT DEFAULT NULL
    CHECK (pay_period_type IN ('weekly', 'bi-weekly', 'semi-monthly', 'monthly')),
  ADD COLUMN contractor_payment_amount INTEGER DEFAULT NULL, -- Per period/job, in cents
  ADD COLUMN contractor_payment_interval TEXT DEFAULT NULL
    CHECK (contractor_payment_interval IN ('weekly', 'bi-weekly', 'monthly', 'per-job')),
  ADD COLUMN allocate_daily BOOLEAN DEFAULT TRUE, -- Auto-allocate to daily P&L
  ADD COLUMN tip_eligible BOOLEAN DEFAULT TRUE,
  ADD COLUMN requires_time_punch BOOLEAN DEFAULT TRUE;

-- Add comment for documentation
COMMENT ON COLUMN employees.compensation_type IS 
  'hourly: wages from time punches, salary: fixed periodic, contractor: fixed amount';
COMMENT ON COLUMN employees.salary_amount IS 
  'For salary employees: amount per pay period in cents';
COMMENT ON COLUMN employees.allocate_daily IS 
  'If true, salary/contractor costs are distributed daily for P&L';
```

### Migration 2: Create `daily_labor_allocations` Table

```sql
-- Store daily cost allocations for salary/contractor employees
CREATE TABLE daily_labor_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  allocated_cost INTEGER NOT NULL DEFAULT 0, -- In cents
  compensation_type TEXT NOT NULL, -- Denormalized for faster queries
  source TEXT DEFAULT 'auto', -- 'auto' | 'manual' | 'per-job'
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  CONSTRAINT unique_employee_date UNIQUE (employee_id, date)
);

-- Indexes for efficient queries
CREATE INDEX idx_daily_labor_allocations_restaurant_date 
  ON daily_labor_allocations(restaurant_id, date);
CREATE INDEX idx_daily_labor_allocations_employee 
  ON daily_labor_allocations(employee_id);

-- RLS
ALTER TABLE daily_labor_allocations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view allocations for their restaurants"
  ON daily_labor_allocations FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_restaurants
      WHERE user_restaurants.restaurant_id = daily_labor_allocations.restaurant_id
      AND user_restaurants.user_id = auth.uid()
    )
  );

-- Similar policies for INSERT, UPDATE, DELETE...
```

### Migration 3: Function to Generate Daily Allocations

```sql
-- Generate daily labor allocations for a restaurant and date range
CREATE OR REPLACE FUNCTION generate_daily_labor_allocations(
  p_restaurant_id UUID,
  p_start_date DATE,
  p_end_date DATE
) RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_employee RECORD;
  v_date DATE;
  v_daily_amount INTEGER;
  v_days_in_period INTEGER;
  v_count INTEGER := 0;
BEGIN
  -- Process each active salary/contractor employee
  FOR v_employee IN 
    SELECT * FROM employees 
    WHERE restaurant_id = p_restaurant_id 
    AND status = 'active'
    AND compensation_type IN ('salary', 'contractor')
    AND allocate_daily = true
  LOOP
    -- Calculate daily amount based on pay period
    v_days_in_period := CASE v_employee.pay_period_type
      WHEN 'weekly' THEN 7
      WHEN 'bi-weekly' THEN 14
      WHEN 'semi-monthly' THEN 15
      WHEN 'monthly' THEN 30
      ELSE 30
    END;
    
    IF v_employee.compensation_type = 'salary' THEN
      v_daily_amount := COALESCE(v_employee.salary_amount, 0) / v_days_in_period;
    ELSE
      v_daily_amount := COALESCE(v_employee.contractor_payment_amount, 0) / v_days_in_period;
    END IF;
    
    -- Generate allocation for each day
    v_date := p_start_date;
    WHILE v_date <= p_end_date LOOP
      INSERT INTO daily_labor_allocations (
        restaurant_id, employee_id, date, allocated_cost, compensation_type, source
      ) VALUES (
        p_restaurant_id, v_employee.id, v_date, v_daily_amount, 
        v_employee.compensation_type, 'auto'
      )
      ON CONFLICT (employee_id, date) DO UPDATE SET
        allocated_cost = EXCLUDED.allocated_cost,
        compensation_type = EXCLUDED.compensation_type,
        updated_at = NOW();
      
      v_count := v_count + 1;
      v_date := v_date + 1;
    END LOOP;
  END LOOP;
  
  RETURN v_count;
END;
$$;
```

---

## 📝 TypeScript Changes

### Update `src/types/scheduling.ts`

```typescript
export type CompensationType = 'hourly' | 'salary' | 'contractor';
export type PayPeriodType = 'weekly' | 'bi-weekly' | 'semi-monthly' | 'monthly';
export type ContractorPaymentInterval = 'weekly' | 'bi-weekly' | 'monthly' | 'per-job';

export interface Employee {
  id: string;
  restaurant_id: string;
  name: string;
  email?: string;
  phone?: string;
  position: string;
  status: 'active' | 'inactive' | 'terminated';
  hire_date?: string;
  notes?: string;
  created_at: string;
  updated_at: string;
  
  // Compensation fields
  compensation_type: CompensationType;
  
  // Hourly-specific
  hourly_rate: number; // In cents (for hourly employees)
  
  // Salary-specific
  salary_amount?: number; // Per period, in cents
  pay_period_type?: PayPeriodType;
  
  // Contractor-specific
  contractor_payment_amount?: number; // Per period/job, in cents
  contractor_payment_interval?: ContractorPaymentInterval;
  
  // Common options
  allocate_daily: boolean;
  tip_eligible: boolean;
  requires_time_punch: boolean;
}

export interface DailyLaborAllocation {
  id: string;
  restaurant_id: string;
  employee_id: string;
  date: string;
  allocated_cost: number; // In cents
  compensation_type: CompensationType;
  source: 'auto' | 'manual' | 'per-job';
  notes?: string;
}
```

### New `src/utils/compensationCalculations.ts`

```typescript
import { Employee, PayPeriodType } from '@/types/scheduling';

/**
 * Get number of days in a pay period
 */
export function getDaysInPayPeriod(periodType: PayPeriodType): number {
  switch (periodType) {
    case 'weekly': return 7;
    case 'bi-weekly': return 14;
    case 'semi-monthly': return 15; // Approximate
    case 'monthly': return 30; // Approximate
    default: return 30;
  }
}

/**
 * Calculate daily allocation for a salary/contractor employee
 */
export function calculateDailyAllocation(employee: Employee): number {
  if (employee.compensation_type === 'hourly') {
    return 0; // Hourly employees don't get daily allocations
  }
  
  const amount = employee.compensation_type === 'salary' 
    ? employee.salary_amount 
    : employee.contractor_payment_amount;
    
  const periodType = employee.compensation_type === 'salary'
    ? employee.pay_period_type
    : employee.contractor_payment_interval;
  
  if (!amount || !periodType) return 0;
  
  // Per-job contractors don't get daily allocation by default
  if (periodType === 'per-job') return 0;
  
  const daysInPeriod = getDaysInPayPeriod(periodType as PayPeriodType);
  return Math.round(amount / daysInPeriod);
}

/**
 * Calculate total pay for a salary employee in a period
 */
export function calculateSalaryPay(
  employee: Employee,
  periodStartDate: Date,
  periodEndDate: Date,
  isProrated: boolean = false
): number {
  if (!employee.salary_amount || !employee.pay_period_type) {
    return 0;
  }
  
  if (!isProrated) {
    return employee.salary_amount;
  }
  
  // Prorate based on days worked in period
  const totalDays = getDaysInPayPeriod(employee.pay_period_type);
  const msPerDay = 1000 * 60 * 60 * 24;
  const daysInRange = Math.ceil((periodEndDate.getTime() - periodStartDate.getTime()) / msPerDay) + 1;
  
  return Math.round(employee.salary_amount * (daysInRange / totalDays));
}

/**
 * Calculate total pay for a contractor in a period
 */
export function calculateContractorPay(
  employee: Employee,
  _periodStartDate: Date,
  _periodEndDate: Date
): number {
  if (!employee.contractor_payment_amount) {
    return 0;
  }
  
  // For 'per-job' contractors, this would need job-specific data
  // For periodic contractors, return the full amount
  return employee.contractor_payment_amount;
}
```

### Update `src/utils/payrollCalculations.ts`

```typescript
// Add new interfaces
export interface SalaryPayroll {
  employeeId: string;
  employeeName: string;
  position: string;
  compensationType: 'salary';
  salaryAmount: number; // Full period salary in cents
  proratedAmount: number; // Actual amount for this period in cents
  isProrated: boolean;
}

export interface ContractorPayroll {
  employeeId: string;
  employeeName: string;
  position: string;
  compensationType: 'contractor';
  paymentAmount: number; // In cents
  paymentInterval: string;
}

export interface UnifiedPayrollPeriod {
  startDate: Date;
  endDate: Date;
  
  // Hourly employees
  hourlyEmployees: EmployeePayroll[];
  totalHourlyPay: number;
  
  // Salary employees
  salaryEmployees: SalaryPayroll[];
  totalSalaryPay: number;
  
  // Contractors
  contractors: ContractorPayroll[];
  totalContractorPay: number;
  
  // Aggregates
  totalGrossPay: number;
  totalTips: number;
  totalHours: number;
}

/**
 * Unified payroll calculation for all compensation types
 */
export function calculateUnifiedPayrollPeriod(
  startDate: Date,
  endDate: Date,
  employees: Employee[],
  punchesPerEmployee: Map<string, TimePunch[]>,
  tipsPerEmployee: Map<string, number>
): UnifiedPayrollPeriod {
  const hourlyEmployees: EmployeePayroll[] = [];
  const salaryEmployees: SalaryPayroll[] = [];
  const contractors: ContractorPayroll[] = [];
  
  employees.forEach(employee => {
    if (employee.compensation_type === 'hourly') {
      const punches = punchesPerEmployee.get(employee.id) || [];
      const tips = tipsPerEmployee.get(employee.id) || 0;
      hourlyEmployees.push(calculateEmployeePay(employee, punches, tips));
    } else if (employee.compensation_type === 'salary') {
      salaryEmployees.push({
        employeeId: employee.id,
        employeeName: employee.name,
        position: employee.position,
        compensationType: 'salary',
        salaryAmount: employee.salary_amount || 0,
        proratedAmount: calculateSalaryPay(employee, startDate, endDate),
        isProrated: false, // TODO: Check hire/termination dates
      });
    } else if (employee.compensation_type === 'contractor') {
      contractors.push({
        employeeId: employee.id,
        employeeName: employee.name,
        position: employee.position,
        compensationType: 'contractor',
        paymentAmount: employee.contractor_payment_amount || 0,
        paymentInterval: employee.contractor_payment_interval || 'monthly',
      });
    }
  });
  
  const totalHourlyPay = hourlyEmployees.reduce((sum, ep) => sum + ep.grossPay, 0);
  const totalSalaryPay = salaryEmployees.reduce((sum, sp) => sum + sp.proratedAmount, 0);
  const totalContractorPay = contractors.reduce((sum, cp) => sum + cp.paymentAmount, 0);
  const totalTips = hourlyEmployees.reduce((sum, ep) => sum + ep.totalTips, 0);
  const totalHours = hourlyEmployees.reduce((sum, ep) => sum + ep.regularHours + ep.overtimeHours, 0);
  
  return {
    startDate,
    endDate,
    hourlyEmployees,
    salaryEmployees,
    contractors,
    totalHourlyPay,
    totalSalaryPay,
    totalContractorPay,
    totalGrossPay: totalHourlyPay + totalSalaryPay + totalContractorPay,
    totalTips,
    totalHours,
  };
}
```

---

## 🎨 UI Changes

### Update `EmployeeDialog.tsx`

Add a **Compensation Type** selector that shows different fields based on selection:

```tsx
// New state
const [compensationType, setCompensationType] = useState<CompensationType>('hourly');
const [salaryAmount, setSalaryAmount] = useState('');
const [payPeriodType, setPayPeriodType] = useState<PayPeriodType>('bi-weekly');
const [contractorAmount, setContractorAmount] = useState('');
const [contractorInterval, setContractorInterval] = useState<ContractorPaymentInterval>('monthly');
const [allocateDaily, setAllocateDaily] = useState(true);
const [tipEligible, setTipEligible] = useState(true);

// Render compensation type selector
<div className="space-y-2">
  <Label>Compensation Type</Label>
  <Select value={compensationType} onValueChange={setCompensationType}>
    <SelectTrigger>
      <SelectValue />
    </SelectTrigger>
    <SelectContent>
      <SelectItem value="hourly">Hourly</SelectItem>
      <SelectItem value="salary">Salary</SelectItem>
      <SelectItem value="contractor">Contractor</SelectItem>
    </SelectContent>
  </Select>
</div>

{/* Conditional fields */}
{compensationType === 'hourly' && (
  <div className="space-y-2">
    <Label>Hourly Rate ($)</Label>
    <Input type="number" step="0.01" value={hourlyRate} onChange={...} />
  </div>
)}

{compensationType === 'salary' && (
  <>
    <div className="space-y-2">
      <Label>Salary Amount (per period) ($)</Label>
      <Input type="number" step="0.01" value={salaryAmount} onChange={...} />
    </div>
    <div className="space-y-2">
      <Label>Pay Period</Label>
      <Select value={payPeriodType} onValueChange={setPayPeriodType}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="weekly">Weekly</SelectItem>
          <SelectItem value="bi-weekly">Bi-Weekly</SelectItem>
          <SelectItem value="semi-monthly">Semi-Monthly</SelectItem>
          <SelectItem value="monthly">Monthly</SelectItem>
        </SelectContent>
      </Select>
    </div>
  </>
)}

{compensationType === 'contractor' && (
  <>
    <div className="space-y-2">
      <Label>Payment Amount ($)</Label>
      <Input type="number" step="0.01" value={contractorAmount} onChange={...} />
    </div>
    <div className="space-y-2">
      <Label>Payment Interval</Label>
      <Select value={contractorInterval} onValueChange={setContractorInterval}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="weekly">Weekly</SelectItem>
          <SelectItem value="bi-weekly">Bi-Weekly</SelectItem>
          <SelectItem value="monthly">Monthly</SelectItem>
          <SelectItem value="per-job">Per Job</SelectItem>
        </SelectContent>
      </Select>
    </div>
  </>
)}

{/* Common options for salary/contractor */}
{compensationType !== 'hourly' && (
  <div className="flex items-center space-x-2">
    <Checkbox checked={allocateDaily} onCheckedChange={setAllocateDaily} />
    <Label>Allocate cost to Daily P&L</Label>
  </div>
)}
```

### Update Daily P&L Display

Show labor breakdown by type:

```tsx
<Card>
  <CardHeader>
    <CardTitle>Labor Costs</CardTitle>
  </CardHeader>
  <CardContent>
    <div className="space-y-2">
      <div className="flex justify-between">
        <span>Hourly Labor</span>
        <span>{formatCurrency(hourlyLabor)}</span>
      </div>
      <div className="flex justify-between">
        <span>Salary Labor</span>
        <span>{formatCurrency(salaryLabor)}</span>
      </div>
      <div className="flex justify-between">
        <span>Contractor Labor</span>
        <span>{formatCurrency(contractorLabor)}</span>
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

## 🔄 Data Flow

### New Daily P&L Calculation Flow

```
1. Nightly job (or on-demand) runs generate_daily_labor_allocations()
   → Creates/updates daily_labor_allocations for salary/contractor employees

2. useDailyLaborCosts hook queries:
   - Hourly labor: from daily_labor_costs (time punch calculations)
   - Salary/Contractor: from daily_labor_allocations

3. Combined labor cost feeds into:
   - Daily P&L calculations
   - Prime cost %
   - Labor cost breakdown charts

4. Payroll run queries:
   - Hourly: calculateEmployeePay() from time_punches
   - Salary: salary_amount (possibly prorated)
   - Contractor: contractor_payment_amount
```

---

## ✅ Testing Plan

### Unit Tests (`tests/unit/compensationCalculations.test.ts`)

```typescript
describe('compensationCalculations', () => {
  describe('getDaysInPayPeriod', () => {
    it('returns 7 for weekly', () => {
      expect(getDaysInPayPeriod('weekly')).toBe(7);
    });
    it('returns 14 for bi-weekly', () => {
      expect(getDaysInPayPeriod('bi-weekly')).toBe(14);
    });
    // ... more tests
  });

  describe('calculateDailyAllocation', () => {
    it('calculates correct daily amount for salary employee', () => {
      const employee = { 
        compensation_type: 'salary',
        salary_amount: 400000, // $4000/month in cents
        pay_period_type: 'monthly'
      };
      expect(calculateDailyAllocation(employee)).toBe(13333); // ~$133.33/day
    });
    
    it('returns 0 for per-job contractors', () => {
      const employee = {
        compensation_type: 'contractor',
        contractor_payment_amount: 50000,
        contractor_payment_interval: 'per-job'
      };
      expect(calculateDailyAllocation(employee)).toBe(0);
    });
  });

  describe('calculateSalaryPay', () => {
    it('returns full amount when not prorated', () => { ... });
    it('prorates correctly for partial periods', () => { ... });
  });
});
```

### SQL Tests (`supabase/tests/10_compensation_allocations.sql`)

```sql
-- Test: generate_daily_labor_allocations creates correct entries
BEGIN;
SELECT plan(5);

-- Insert test data
INSERT INTO employees (id, restaurant_id, name, position, compensation_type, salary_amount, pay_period_type, status, allocate_daily)
VALUES ('...', '...', 'Test Salary Employee', 'Manager', 'salary', 400000, 'monthly', 'active', true);

-- Run allocation
SELECT generate_daily_labor_allocations('restaurant-id', '2024-01-01', '2024-01-07');

-- Verify 7 allocations created
SELECT is(
  (SELECT COUNT(*) FROM daily_labor_allocations WHERE employee_id = '...')::integer,
  7,
  'Creates allocation for each day'
);

-- Verify daily amount
SELECT is(
  (SELECT allocated_cost FROM daily_labor_allocations WHERE employee_id = '...' AND date = '2024-01-01'),
  13333,
  'Daily amount is salary/30'
);

SELECT * FROM finish();
ROLLBACK;
```

---

## 📅 Implementation Phases

### Phase 1: Database Foundation (Day 1-2)
- [ ] Create migration for employees table changes
- [ ] Create daily_labor_allocations table
- [ ] Create SQL function for generating allocations
- [ ] Add RLS policies
- [ ] Write pgTAP tests

### Phase 2: TypeScript Core (Day 3-4)
- [ ] Update Employee type
- [ ] Create compensationCalculations.ts
- [ ] Update payrollCalculations.ts with unified engine
- [ ] Update useEmployees hook
- [ ] Write unit tests

### Phase 3: UI Updates (Day 5-6)
- [ ] Update EmployeeDialog with compensation type
- [ ] Update Payroll page to show all types
- [ ] Update Daily P&L breakdown display
- [ ] Add labor allocation management UI

### Phase 4: Integration & Testing (Day 7)
- [ ] E2E test: Create salary employee → verify daily allocations
- [ ] E2E test: Payroll run with mixed employee types
- [ ] Performance testing with large datasets
- [ ] Documentation updates

---

## 🚨 Edge Cases to Handle

1. **Mid-period hire/termination** → Prorate salary
2. **Salary employee with overtime** → Allow hourly add-ons
3. **Multi-location salary manager** → Support % allocation per location
4. **Per-job contractor** → Manual allocation UI
5. **Retroactive adjustments** → Re-run allocation generation

---

## � Identified Holes (from Edge Case Testing)

The comprehensive test suite (`tests/unit/compensation-edge-cases.test.ts`) identified these areas that need future attention:

### Critical Holes
| # | Issue | Description |
|---|-------|-------------|
| 1 | **Per-job contractors** | Need a different allocation mechanism than daily spreading |
| 2 | **Mid-period hires** | Daily allocation should check hire_date before allocating |
| 3 | **Terminated employees** | Daily allocation should check employee status |
| 4 | **Non-daily salary allocation** | Need to record salary on payday when allocate_daily=false |

### Important Holes
| # | Issue | Description |
|---|-------|-------------|
| 5 | **Contractor work days** | Should consider actual work days vs calendar days |
| 6 | **Monthly allocation accuracy** | Should use actual month length, not 30.44 average |
| 7 | **Semi-monthly accuracy** | Should use actual period length, not 15.22 average |
| 8 | **Exempt/non-exempt flag** | Salaried employees may need OT if non-exempt |
| 9 | **Work schedule consideration** | Part-time salaried employees should allocate differently |

### Future Enhancements
| # | Issue | Description |
|---|-------|-------------|
| 10 | **Compensation type transitions** | Handle hourly→salary mid-period |
| 11 | **Contractor→employee transitions** | Handle classification changes |
| 12 | **Compensation history** | Track changes for audit trail |

### Timezone Issues (Major)
| # | Issue | Description |
|---|-------|-------------|
| 13 | **Restaurant timezone handling** | All calculations use UTC |
| 14 | **DST changes** | Overnight shifts across DST change |
| 15 | **Non-standard timezones** | Timezones with 30-minute offsets |
| 16 | **Pay period boundaries** | Different timezones affect period start/end |

---

## �📚 Related Files

### To Modify
- `src/types/scheduling.ts` - Add compensation types ✅
- `src/hooks/useEmployees.tsx` - Handle new fields
- `src/components/EmployeeDialog.tsx` - Compensation UI
- `src/utils/payrollCalculations.ts` - Unified engine
- `src/hooks/usePayroll.tsx` - Handle all types
- `src/hooks/useLaborCosts.tsx` - Include allocations
- `src/pages/Payroll.tsx` - Display all types

### To Create
- `src/utils/compensationCalculations.ts` - New utility ✅
- `src/hooks/useDailyLaborAllocations.tsx` - New hook
- `supabase/migrations/YYYYMMDD_add_compensation_types.sql` - Migration ✅
- `tests/unit/compensationCalculations.test.ts` - Unit tests ✅
- `tests/unit/compensation-edge-cases.test.ts` - Edge case tests ✅
- `supabase/tests/10_compensation_allocations.sql` - SQL tests
