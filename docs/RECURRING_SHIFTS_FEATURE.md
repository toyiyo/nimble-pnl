# Recurring Shift Pattern Feature

## Overview
This feature adds support for recurring shift patterns to the scheduling system, similar to Google Calendar's recurrence functionality. Users can create shifts that repeat on a schedule (daily, weekly, monthly, yearly) with customizable end conditions.

## User Interface

### Recurrence Options
When creating a new shift, users can select from the following repeat patterns:

#### Preset Options (Dynamic based on shift date)
- **Does not repeat** - Creates a single, one-time shift
- **Daily** - Repeats every day
- **Weekly on [Day]** - Repeats every week on the same day (e.g., "Weekly on Monday")
- **Monthly on the [nth Day]** - Repeats monthly on the same week and day (e.g., "Monthly on the third Sunday")
- **Annually on [Month Day]** - Repeats yearly on the same date (e.g., "Annually on November 16")
- **Every weekday (Monday to Friday)** - Repeats every weekday, skipping weekends
- **Custom...** - Opens advanced recurrence dialog

#### Custom Recurrence Dialog
The custom recurrence dialog provides fine-grained control:

**Repeat Every:**
- Interval selector: 1-999
- Unit selector: day(s), week(s), month(s), year(s)

**Repeat On:** (for weekly patterns)
- Checkboxes for each day of the week (S M T W T F S)
- Multiple days can be selected

**Ends:**
- **Never** - Continues indefinitely (limited to 365 occurrences for safety)
- **On [date]** - Ends on a specific date
- **After [N] occurrences** - Ends after a specific number of occurrences

## Technical Implementation

### Database Schema
The `shifts` table includes three new columns:

```sql
recurrence_pattern JSONB      -- Stores the recurrence configuration
recurrence_parent_id UUID     -- References the parent shift (first occurrence)
is_recurring BOOLEAN          -- Quick flag for filtering recurring shifts
```

### Recurrence Pattern Structure
```typescript
{
  type: 'daily' | 'weekly' | 'monthly' | 'yearly' | 'weekday' | 'custom',
  interval?: number,           // e.g., 1 for every week, 2 for every 2 weeks
  daysOfWeek?: number[],       // 0=Sunday, 6=Saturday (for weekly/custom)
  dayOfMonth?: number,         // 1-31 (for monthly)
  weekOfMonth?: number,        // 1-5 (for monthly "third Sunday" pattern)
  monthOfYear?: number,        // 1-12 (for yearly)
  endType: 'never' | 'on' | 'after',
  endDate?: string,            // ISO date string (when endType is "on")
  occurrences?: number         // (when endType is "after")
}
```

### Shift Generation
When a recurring shift is created:

1. **Parent Shift** - The first occurrence is created with `recurrence_parent_id = null`
2. **Child Shifts** - All subsequent occurrences reference the parent via `recurrence_parent_id`
3. **Time Preservation** - Each occurrence maintains the exact start/end times of the original shift
4. **Relationship Tracking** - All shifts in a series are linked for potential future bulk operations

### Key Functions

#### `generateRecurringDates(startDate, pattern, maxOccurrences)`
Generates an array of Date objects representing all occurrences based on the recurrence pattern.

**Features:**
- Handles all recurrence types (daily, weekly, monthly, yearly, weekday, custom)
- Respects end conditions (never, on date, after N occurrences)
- Safety limit of 365 occurrences to prevent infinite generation
- Properly handles edge cases (e.g., month overflow for monthly patterns)

#### `getRecurrenceDescription(pattern)`
Generates human-readable descriptions of recurrence patterns.

**Examples:**
- "Daily"
- "Weekly on Monday"
- "Monthly on the third Sunday"
- "Annually on November 16"
- "Every weekday (Monday to Friday)"
- "Daily, until Dec 31, 2024"
- "Weekly on Monday, 10 times"

#### `getRecurrencePresetsForDate(date)`
Generates dynamic preset options based on the selected shift date.

**Dynamic Behavior:**
- "Weekly on X" adjusts based on day of week
- "Monthly on the Nth X" calculates week of month
- "Annually on Month Day" uses the actual date

## Usage Examples

### Creating a Daily Shift
1. Open "Create New Shift" dialog
2. Fill in employee, position, date/time
3. Select "Repeat: Daily"
4. Choose end condition (e.g., "After 30 occurrences")
5. Click "Create Shift"
6. System creates 30 shift instances

### Creating a Weekly Shift on Multiple Days
1. Open "Create New Shift" dialog
2. Fill in basic shift information
3. Select "Repeat: Custom..."
4. Set "Repeat every 1 week"
5. Check boxes for Monday, Wednesday, Friday
6. Set "Ends: After 12 occurrences"
7. Click "Done" then "Create Shift"
8. System creates 12 shifts across the selected days

### Creating a Monthly "Third Sunday" Pattern
1. Create a shift on the third Sunday of a month
2. Select "Repeat: Monthly on the third Sunday"
3. Set end condition
4. System automatically creates shifts on the third Sunday of each month

## Edge Cases Handled

### Month Overflow
When a monthly pattern is set for day 31, but a month has fewer days:
- System uses the last day of that month instead
- Example: Jan 31 → Feb 28 (or 29 in leap year)

### Weekday Patterns
- Automatically skips Saturday and Sunday
- Continues to next Monday after Friday

### Custom Multi-Day Weekly Patterns
- Generates dates in chronological order
- Handles wrap-around from week to week
- Example: Selecting Mon, Wed, Fri generates all three in order

### Safety Limits
- Maximum 365 occurrences when "Never" is selected
- Prevents accidental generation of thousands of shifts
- Can be adjusted if needed for specific use cases

## Future Enhancements

Potential future improvements:
1. **Bulk Edit** - Modify all shifts in a recurring series
2. **Exception Handling** - Skip specific dates (e.g., holidays)
3. **Shift Templates** - Save recurring patterns as templates
4. **Copy Patterns** - Apply a recurring pattern to multiple employees
5. **Visual Preview** - Show generated dates before creating

## Files Modified/Created

### New Files
- `src/utils/recurrenceUtils.ts` - Core recurrence logic
- `src/components/CustomRecurrenceDialog.tsx` - Advanced recurrence UI
- `supabase/migrations/20251116_add_shift_recurrence.sql` - Database migration

### Modified Files
- `src/types/scheduling.ts` - Added RecurrencePattern types
- `src/components/ShiftDialog.tsx` - Added recurrence UI
- `src/hooks/useShifts.tsx` - Added shift generation logic

## Testing

### Manual Testing Checklist
- [ ] Create daily shift with "After 5 occurrences" - verify 5 shifts created
- [ ] Create weekly shift on Monday - verify correct day of week
- [ ] Create weekday shift - verify no weekend shifts
- [ ] Create monthly shift on 15th - verify same day each month
- [ ] Create yearly shift - verify same date each year
- [ ] Create custom weekly shift (Mon/Wed/Fri) - verify correct days
- [ ] Create shift with end date - verify stops at correct date
- [ ] Edit existing shift - verify no recurrence options shown
- [ ] Verify all shifts maintain original start/end times
- [ ] Verify recurrence descriptions are accurate

### Unit Tests
The file `tests/unit/recurrenceUtils.spec.ts` contains comprehensive tests for:
- Daily, weekly, monthly, yearly recurrence generation
- Weekday pattern (skipping weekends)
- Custom patterns with multiple days
- Description generation
- Dynamic preset generation

## Security Considerations

### Row Level Security
- All generated shifts inherit the parent shift's restaurant_id
- RLS policies ensure users can only create shifts for their restaurants
- Parent/child relationships maintain data integrity

### Data Validation
- Input validation prevents invalid recurrence patterns
- Safety limits prevent accidental bulk creation
- End dates are validated to be in the future

## Performance

### Optimization Strategies
1. **Batch Insert** - All recurring shifts inserted in single database operation
2. **Limited Generation** - Safety limit prevents excessive record creation
3. **Indexed Columns** - `recurrence_parent_id` and `is_recurring` indexed for fast queries

### Scalability
- Typical use case: 10-50 shifts per recurring pattern
- Maximum practical limit: 365 occurrences
- Database can handle thousands of recurring shift series efficiently
