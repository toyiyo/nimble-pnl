# Overtime Management Design

## Overview

Extend the existing payroll system with configurable overtime rules, employee exemptions, tip exclusion from OT rate, and manager OT classification overrides. Test-first approach.

## Requirements

1. **Configurable Overtime Rules** — Per-restaurant weekly and daily OT thresholds with custom multipliers
2. **Tip Exclusion** — Configure whether tips are excluded from the regular rate used for OT calculation
3. **Employee Exemptions** — Mark employees as FLSA exempt (skip OT calculations). Warning if salary below $35,568/year but not blocking
4. **OT Classification Override** — Managers can reclassify specific hours between regular and overtime

## Architecture: Restaurant-Level Rules + Employee-Level Overrides

### Database Schema

#### New Table: `overtime_rules`

Per-restaurant overtime configuration. One row per restaurant, created with defaults when first needed.

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| id | uuid | gen_random_uuid() | PK |
| restaurant_id | uuid | FK | Unique per restaurant |
| weekly_threshold_hours | numeric(5,2) | 40.00 | Hours before weekly OT |
| weekly_ot_multiplier | numeric(3,2) | 1.50 | Weekly OT pay multiplier |
| daily_threshold_hours | numeric(5,2) | NULL | Daily OT threshold (NULL = disabled) |
| daily_ot_multiplier | numeric(3,2) | 1.50 | Daily OT pay multiplier |
| daily_double_threshold_hours | numeric(5,2) | NULL | Double-time threshold (e.g., CA 12hrs) |
| daily_double_multiplier | numeric(3,2) | 2.00 | Double-time multiplier |
| exclude_tips_from_ot_rate | boolean | true | Exclude tips from OT rate calc |
| created_at | timestamptz | now() | |
| updated_at | timestamptz | now() | |

Constraints: multipliers > 0, thresholds >= 0, unique on restaurant_id.

#### New Table: `overtime_adjustments`

Manager overrides for OT classification on specific time entries.

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | PK |
| restaurant_id | uuid | FK |
| employee_id | uuid | FK to employees |
| punch_date | date | The day being adjusted |
| adjustment_type | text | 'regular_to_overtime' or 'overtime_to_regular' |
| hours | numeric(5,2) | Hours to reclassify |
| reason | text | Manager's reason |
| adjusted_by | uuid | FK to auth.users |
| created_at | timestamptz | |

#### Employee Table Changes

Add columns to `employees`:
- `is_exempt` boolean DEFAULT false
- `exempt_changed_at` timestamptz
- `exempt_changed_by` uuid

## Calculation Logic

### Flow (order matters)

1. **Load rules** — Fetch `overtime_rules` for restaurant, fallback to federal defaults (40hr/1.5x, no daily)
2. **Skip exempt** — If `employee.is_exempt === true`, all hours are regular
3. **Daily OT pass** (if daily threshold configured):
   - Per work day: hours > daily_threshold → daily OT at daily_ot_multiplier
   - Hours > daily_double_threshold → double-time at daily_double_multiplier
   - Daily OT hours are "consumed" and excluded from weekly calculation
4. **Weekly OT pass**:
   - Sum remaining non-OT hours per week
   - Hours > weekly_threshold → weekly OT at weekly_ot_multiplier
5. **Apply adjustments** — Reclassify hours per `overtime_adjustments` entries
6. **Calculate pay**:
   - Regular pay = regular_hours x hourly_rate
   - OT pay = ot_hours x hourly_rate x ot_multiplier
   - Double-time pay = dt_hours x hourly_rate x dt_multiplier
   - When `exclude_tips_from_ot_rate` is true, tips not added to base rate

### Key Types

```typescript
interface OvertimeRules {
  weeklyThresholdHours: number;
  weeklyOtMultiplier: number;
  dailyThresholdHours: number | null;
  dailyOtMultiplier: number;
  dailyDoubleThresholdHours: number | null;
  dailyDoubleMultiplier: number;
  excludeTipsFromOtRate: boolean;
}

interface OvertimeAdjustment {
  employeeId: string;
  punchDate: Date;
  adjustmentType: 'regular_to_overtime' | 'overtime_to_regular';
  hours: number;
  reason: string;
}

interface EmployeePayroll {
  regularHours: number;
  overtimeHours: number;
  doubleTimeHours: number;
  regularPay: number;
  overtimePay: number;
  doubleTimePay: number;
  grossPay: number;
  totalTips: number;
  tipsOwed: number;
  totalPay: number;
  // Breakdown
  dailyOvertimeHours: number;
  weeklyOvertimeHours: number;
  adjustedHours: OvertimeAdjustment[];
}
```

## Testing Strategy (TDD)

### Unit Tests (`tests/unit/overtimeCalculations.test.ts`)

**OT Rules Engine:**
1. Weekly-only OT: 45 hours/week → 40 regular + 5 OT at 1.5x
2. Custom weekly threshold: 35-hour threshold, 38 hours → 35 regular + 3 OT
3. Daily OT: 10-hour day with 8-hour threshold → 8 regular + 2 daily OT
4. Daily double-time: 13-hour day with 8hr/12hr thresholds → 8 regular + 4 OT + 1 double-time
5. Combined daily + weekly: daily OT hours don't double-count toward weekly threshold
6. Exempt employee: all hours regular regardless of total
7. Default rules: no config → federal defaults (40hr/1.5x, no daily)
8. Custom multipliers: 2.0x weekly OT works correctly

**OT Adjustments:**
9. Regular-to-overtime override
10. Overtime-to-regular override
11. Multiple adjustments on same day
12. Adjustment exceeding available hours: capped (no negative)

**Tip Exclusion:**
13. Tips excluded from OT rate: OT rate based on hourly_rate only
14. Tips included in OT rate: OT rate = (hourly_rate + tip_rate) x multiplier

**Edge Cases:**
15. Zero hours: no OT
16. Exactly at threshold: no OT (boundary)
17. Multiple weeks in pay period: each week independent
18. Employee with no punches: zero hours

### Database Tests (`supabase/tests/overtime_rules.test.sql`)
- RLS policies: users only access their restaurant's rules
- Default values on insert
- Constraint enforcement (multipliers > 0, thresholds >= 0)

## UI Changes

### Settings Page
- Overtime rules configuration form (weekly/daily thresholds, multipliers, tip exclusion toggle)
- Employee detail: exempt toggle with FLSA salary warning

### Payroll Page
- Daily OT and double-time breakdown in payroll rows
- "Adjust OT" action per employee → dialog to reclassify hours
- Visual indicator for adjusted entries

No new pages — integrates into existing settings and payroll views.
