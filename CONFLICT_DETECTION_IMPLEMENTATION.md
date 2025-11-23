# Conflict Detection & Overtime Management - Implementation Summary

## Overview
This document describes the conflict detection and overtime management features added to the nimble-pnl scheduling system.

## Features

### 1. Database Schema Changes

#### Overtime Rules Table
A new `overtime_rules` table has been added to configure daily and weekly overtime thresholds per restaurant:

```sql
CREATE TABLE overtime_rules (
  id UUID PRIMARY KEY,
  restaurant_id UUID NOT NULL,
  daily_threshold_minutes INTEGER NOT NULL DEFAULT 480,  -- 8 hours
  weekly_threshold_minutes INTEGER NOT NULL DEFAULT 2400, -- 40 hours
  enabled BOOLEAN NOT NULL DEFAULT true,
  ...
)
```

**Default values:**
- Daily threshold: 480 minutes (8 hours)
- Weekly threshold: 2400 minutes (40 hours)
- Enabled by default for all restaurants

### 2. Conflict Detection

#### Types of Conflicts Detected

1. **Double-Booking**
   - Prevents scheduling an employee for the exact same time slot twice
   - Severity: ERROR (blocks submission)

2. **Overlapping Shifts**
   - Detects when a new shift overlaps with an existing shift
   - Back-to-back shifts (no gap) are allowed
   - Severity: ERROR (blocks submission)

3. **Time-Off Conflicts**
   - Validates against approved time-off requests
   - Checks if shift falls within any approved time-off period
   - Severity: ERROR (blocks submission)

#### Visual Indicators

- **Calendar View**: Red warning triangle icon on conflicting shifts
- **Shift Dialog**: Alert banners showing conflict details
- **Tooltips**: Hover over shifts to see detailed conflict information
- **Summary Card**: Weekly overview of all scheduling issues

### 3. Overtime Detection

#### Overtime Types

1. **Daily Overtime**
   - Triggers when daily hours exceed threshold (default: 8 hours)
   - Calculated per calendar day
   - Excludes break time from calculations

2. **Weekly Overtime**
   - Triggers when weekly hours exceed threshold (default: 40 hours)
   - Calculated from Sunday to Saturday
   - Shows approaching threshold warnings (within 2 hours)

#### Severity Levels

- **INFO** (Blue): Approaching threshold or minor overtime
  - Daily: <1 hour over threshold
  - Weekly: Within 2 hours of threshold
  
- **WARNING** (Orange): Moderate overtime
  - Daily: 1-2 hours over threshold
  - Weekly: 2-4 hours over threshold
  
- **ERROR** (Red): Significant overtime
  - Daily: >2 hours over threshold
  - Weekly: >4 hours over threshold

#### Visual Indicators

- **Calendar View**: Orange alert icon on shifts with overtime
- **Shift Dialog**: Alert banners with overtime calculations
- **Metrics Card**: Total weekly overtime hours across all employees
- **Summary Card**: List of employees with overtime warnings

### 4. Real-Time Validation

The shift validation happens in real-time as you fill out the shift dialog:

1. **As you select dates/times**: Preview shift is created
2. **Validation runs automatically**: Checks conflicts and overtime
3. **Warnings appear immediately**: See issues before saving
4. **Submit button behavior**:
   - Conflicts: Submission blocked with error toast
   - Overtime: Submission allowed with visible warning

### 5. Weekly Forecast

The scheduling page shows a weekly overtime forecast for all employees:

- Total overtime hours for the week
- Number of employees with overtime
- Projected overtime if new shifts are added
- Per-employee breakdown in summary card

## Usage Guide

### For Managers

#### Viewing Conflicts
1. Navigate to the Scheduling page
2. Look for warning icons (⚠️) on shifts in the calendar
3. Hover over shifts to see tooltip with conflict details
4. Check the "Scheduling Issues Detected" card for a full summary

#### Creating Shifts
1. Click "Create Shift" or "Add" on a specific day
2. Fill in shift details
3. Watch for real-time warnings as you enter data
4. Conflicts will prevent saving; overtime warnings are informational only
5. Review warnings and adjust times if needed

#### Managing Overtime
1. Check the "Overtime Hours" metric card for weekly totals
2. Review the scheduling issues card for employees approaching/exceeding thresholds
3. Adjust schedules to balance hours across employees
4. Consider configuring overtime thresholds if defaults don't fit your needs

### For Developers

#### Configuration

To update overtime rules for a restaurant:

```typescript
import { useUpdateOvertimeRules } from '@/hooks/useOvertimeRules';

const { mutate } = useUpdateOvertimeRules();

mutate({
  restaurant_id: 'restaurant-uuid',
  daily_threshold_minutes: 540,  // 9 hours
  weekly_threshold_minutes: 2700, // 45 hours
  enabled: true,
});
```

#### Using Validation in Code

```typescript
import { useShiftValidation } from '@/hooks/useShiftValidation';

const validation = useShiftValidation(
  previewShift,
  restaurantId,
  weekStart,
  weekEnd,
  existingShiftId // optional, to exclude when editing
);

if (validation) {
  console.log('Valid?', validation.isValid);
  console.log('Conflicts:', validation.conflicts);
  console.log('OT Warnings:', validation.overtimeWarnings);
}
```

#### Bulk Validation

```typescript
import { useBulkShiftValidation } from '@/hooks/useShiftValidation';

const validations = useBulkShiftValidation(
  restaurantId,
  weekStart,
  weekEnd
);

// validations is a Map<shiftId, validationResult>
validations.forEach((result, shiftId) => {
  if (!result.isValid) {
    console.log(`Shift ${shiftId} has issues`);
  }
});
```

## Technical Details

### Utility Functions

All validation logic is centralized in `src/utils/shiftValidation.ts`:

- `calculateShiftMinutes()`: Calculate net working time
- `shiftsOverlap()`: Check if two shifts overlap
- `shiftConflictsWithTimeOff()`: Check time-off conflicts
- `detectShiftConflicts()`: Run all conflict checks
- `calculateDailyOvertime()`: Calculate daily OT
- `calculateWeeklyOvertime()`: Calculate weekly OT
- `validateShift()`: Complete validation with conflicts and OT
- `bulkValidateShifts()`: Validate multiple shifts at once

### React Hooks

Custom hooks in `src/hooks/`:

- `useOvertimeRules()`: Get/update overtime configuration
- `useTimeOffRequests()`: Fetch time-off requests
- `useShiftValidation()`: Real-time validation for single shift
- `useBulkShiftValidation()`: Validate all shifts in schedule
- `useWeeklyOvertimeForecast()`: Calculate OT projections

### Type Definitions

New types in `src/types/scheduling.ts`:

```typescript
interface OvertimeRules {
  id: string;
  restaurant_id: string;
  daily_threshold_minutes: number;
  weekly_threshold_minutes: number;
  enabled: boolean;
}

interface ShiftConflict {
  type: 'double_booking' | 'overlapping_shift' | 'time_off_conflict';
  message: string;
  conflictingShift?: Shift;
  conflictingTimeOff?: TimeOffRequest;
  severity: 'warning' | 'error';
}

interface OvertimeWarning {
  type: 'daily' | 'weekly';
  currentMinutes: number;
  thresholdMinutes: number;
  overtimeMinutes: number;
  message: string;
  severity: 'info' | 'warning' | 'error';
}

interface ShiftValidationResult {
  isValid: boolean;
  conflicts: ShiftConflict[];
  overtimeWarnings: OvertimeWarning[];
}
```

## Testing

Unit tests are provided in `tests/unit/shiftValidation.spec.ts` covering:

- Shift duration calculations
- Overlap detection
- Double-booking detection
- Time-off conflict detection
- Daily overtime calculations
- Weekly overtime calculations
- Complete shift validation

## Security

All features respect existing Row Level Security (RLS) policies:

- Overtime rules are scoped to restaurants
- Users can only view/edit rules for their restaurants
- Managers and owners can configure rules
- All database operations respect user permissions

## Performance

- Validation runs in real-time but is memoized to prevent unnecessary recalculation
- React Query caches overtime rules (1 minute stale time)
- Bulk validation is optimized to run once per schedule view
- Calendar tooltips use lazy loading

## Future Enhancements

Potential improvements for future releases:

1. Customizable overtime multipliers (1.5x pay, 2x pay)
2. Department-specific overtime rules
3. Automatic shift splitting to avoid overtime
4. Notification system for approaching overtime
5. Overtime approval workflow
6. Historical overtime reports and analytics
7. Integration with payroll calculations

## Support

For questions or issues, please refer to:
- Repository issues: https://github.com/toyiyo/nimble-pnl/issues
- Documentation: See ARCHITECTURE.md and INTEGRATIONS.md
