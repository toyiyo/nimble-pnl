# Availability Conflict Detection Fixes

## Issues Fixed

### 1. False Positive Conflicts
**Problem**: Shifts scheduled M-F 9am-5pm were being flagged as conflicts even though availability was set to 9am-5pm every day.

**Root Cause**: The SQL function was using timezone conversion (`AT TIME ZONE 'UTC'`) which could shift dates/times incorrectly depending on the server timezone.

**Solution**: Removed timezone conversion and used local time directly:
```sql
-- Before (incorrect):
v_date := DATE(p_start_time AT TIME ZONE 'UTC');
v_start_time := (p_start_time AT TIME ZONE 'UTC')::TIME;

-- After (correct):
v_date := DATE(p_start_time);
v_shift_start_time := (p_start_time)::TIME;
```

### 2. Missing Exception Detection
**Problem**: Availability exceptions (like Thanksgiving Nov 26) were not being detected for multi-day or recurring shifts.

**Root Cause**: The function only checked the start date, not each individual date in a multi-day shift.

**Solution**: Added loop to check each date in the shift range:
```sql
-- Loop through each date in the shift range
WHILE v_current_date <= v_end_date LOOP
  -- Check exception for THIS specific date
  -- Check recurring availability for THIS specific date
  v_current_date := v_current_date + INTERVAL '1 day';
END LOOP;
```

### 3. No Visual Indicators in Schedule
**Problem**: Managers couldn't see which shifts had conflicts without clicking into each one.

**Solution**: Added visual indicators to the schedule view:
- **Yellow background** on shift cards with conflicts
- **Warning icon** (AlertTriangle) in top-left corner
- **Tooltip on hover** showing conflict details
- Maintains existing shift functionality (edit, delete buttons)

## Files Changed

### Database Migration
**File**: `supabase/migrations/20251124_fix_availability_conflict_detection.sql`

**Changes**:
- Rewrote `check_availability_conflict()` function
- Fixed timezone handling
- Added multi-day shift support
- Improved exception checking
- Better error messages with dates

### Frontend - Schedule View
**File**: `src/pages/Scheduling.tsx`

**Changes**:
- Added `AlertTriangle` icon import
- Added `Tooltip` components import
- Added `useCheckConflicts` hook import
- Added `useMemo` for performance
- Created `ShiftCard` component with conflict detection
- Replaced inline shift rendering with `ShiftCard` component

**New ShiftCard Component**:
```tsx
const ShiftCard = ({ shift }: { shift: Shift }) => {
  // Check for conflicts using the hook
  const conflictParams = useMemo(() => ({
    employeeId: shift.employee_id,
    restaurantId: shift.restaurant_id,
    startTime: shift.start_time,
    endTime: shift.end_time,
  }), [shift]);

  const { conflicts, hasConflicts } = useCheckConflicts(conflictParams);

  return (
    <Tooltip>
      <TooltipTrigger>
        {/* Yellow background if conflicts */}
        <div className={hasConflicts ? 'bg-yellow-50 border-yellow-300' : 'bg-card'}>
          {/* Warning icon if conflicts */}
          {hasConflicts && <AlertTriangle className="h-3 w-3 text-yellow-600" />}
          {/* Shift details */}
        </div>
      </TooltipTrigger>
      {/* Show conflict messages in tooltip */}
      {hasConflicts && (
        <TooltipContent>
          <p>Conflicts:</p>
          {conflicts.map(c => <p>• {c.message}</p>)}
        </TooltipContent>
      )}
    </Tooltip>
  );
};
```

## Visual Changes

### Before
```
┌─────────────────────┐
│ 9:00 AM - 5:00 PM  │  ← No indication of conflicts
│ Server              │
│ [scheduled]         │
└─────────────────────┘
```

### After (with conflicts)
```
┌─────────────────────┐
│ ⚠ 9:00 AM - 5:00 PM│  ← Yellow background + warning icon
│ Server              │
│ [scheduled]         │
└─────────────────────┘
     ↓ (hover)
┌─────────────────────────────────────┐
│ Conflicts:                          │
│ • Employee is unavailable on        │
│   2025-11-26 (Thanksgiving)         │
└─────────────────────────────────────┘
```

## Testing Steps

1. **Apply Migration**:
   ```bash
   cd supabase
   supabase db push
   # Or if already applied:
   supabase db reset
   ```

2. **Test Recurring Availability**:
   - Set employee availability: Monday-Friday, 9am-5pm
   - Create shift: Monday-Friday, 9am-5pm
   - **Expected**: No conflicts (was showing false conflicts before)

3. **Test Availability Exceptions**:
   - Set exception: Nov 26, 2025 (Thanksgiving) - Unavailable
   - Create shift: Nov 25-27, 9am-5pm (spans Thanksgiving)
   - **Expected**: Yellow warning on Nov 26 with message about unavailability

4. **Test Multi-Day Shifts**:
   - Set availability: Mon-Fri 9am-5pm, Sat-Sun unavailable
   - Create shift: Friday 9am - Monday 5pm (spans weekend)
   - **Expected**: Conflict detected for Saturday and Sunday

5. **Test Visual Indicators**:
   - Go to Schedule tab
   - Look at shifts in calendar view
   - **Expected**: 
     - Yellow background on conflicted shifts
     - Warning icon visible
     - Hover shows conflict details
     - Non-conflicted shifts look normal

## Performance Considerations

- **Conflict checking**: Only runs for rendered shifts (not all shifts)
- **Memoization**: Uses `useMemo` to prevent unnecessary re-checks
- **Caching**: React Query caches conflict checks for 10 seconds
- **Tooltip**: Only renders when hovering over shift

## Edge Cases Handled

1. **Multi-day shifts**: Checks each date separately
2. **Overnight shifts**: Handles shifts that span midnight
3. **No availability set**: Doesn't flag as conflict (allows flexible scheduling)
4. **Partial availability**: Checks if shift is fully contained within available hours
5. **Exception overrides recurring**: Exception takes precedence over weekly availability

## Known Limitations

1. **Recurring shift performance**: Checking many recurring shifts may be slow (optimize if needed)
2. **Tooltip overflow**: Long conflict messages may overflow on small screens
3. **Color accessibility**: Yellow may not be visible enough for some users (consider adding icon-only mode)

## Future Enhancements

1. **Batch conflict checking**: Check all shifts at once instead of individually
2. **Conflict severity levels**: 
   - Red: Time-off conflict (blocking)
   - Yellow: Availability conflict (warning)
   - Blue: Preference conflict (info)
3. **Filter/sort by conflicts**: Show only conflicted shifts
4. **Auto-suggest times**: When conflict detected, suggest available times
5. **Bulk conflict resolution**: Fix multiple conflicts at once

## Migration Safety

- ✅ **Non-breaking**: Function signature unchanged
- ✅ **Backward compatible**: Existing calls work the same
- ✅ **Idempotent**: Safe to run multiple times
- ✅ **Performance**: Similar or better performance than before

## Rollback Plan

If issues occur, rollback the SQL function:

```sql
-- Rollback to previous version
CREATE OR REPLACE FUNCTION check_availability_conflict(...)
-- Copy the old function body from 20251123_create_availability_tables.sql
```

Frontend changes can be reverted via git:
```bash
git checkout HEAD~1 -- src/pages/Scheduling.tsx
```

---

**Status**: ✅ Ready for testing
**Migration applied**: Run `supabase db push` to apply
**Frontend deployed**: Restart dev server to see changes
