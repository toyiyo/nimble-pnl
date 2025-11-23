# Time-Off and Availability Management - Implementation Guide

## Overview

This document describes the complete implementation of the Time-Off Request and Employee Availability management features for the restaurant scheduling system.

## Features Implemented

### 1. Time-Off Request Management

**Employee Request Workflow:**
- Employees/managers can submit time-off requests with date ranges and optional reason
- Requests start in "pending" status awaiting manager approval
- Calendar-based date picker for easy date selection
- Supports multi-day time-off periods

**Manager Approval Interface:**
- Managers can view all pending, approved, and rejected requests
- One-click approve/reject functionality
- Visual status indicators (badges)
- Ability to edit or delete requests

**Conflict Detection:**
- Automatic detection when scheduling shifts during approved/pending time-off
- Real-time warnings displayed in shift creation dialog
- Prevents accidental scheduling conflicts

### 2. Employee Availability Management

**Recurring Weekly Availability:**
- Set regular availability for each day of the week (e.g., "Mondays 9 AM - 5 PM")
- Toggle between available/unavailable for specific days
- Optional notes field for additional context
- Supports different availability for different days

**One-Time Exceptions:**
- Override regular availability for specific dates
- Mark dates as unavailable (e.g., appointments, personal events)
- Mark dates as available with specific hours (overriding regular schedule)
- Reason field to document exceptions

**Conflict Detection:**
- Warns when scheduling outside employee's regular availability window
- Checks both recurring patterns and date-specific exceptions
- Real-time feedback before shift submission

## Database Schema

### Tables Created

#### `employee_availability`
- Stores recurring weekly availability preferences
- Fields: `id`, `restaurant_id`, `employee_id`, `day_of_week` (0-6), `start_time`, `end_time`, `is_available`, `notes`
- Constraints: Valid day_of_week (0-6), end_time > start_time

#### `availability_exceptions`
- Stores one-time availability changes
- Fields: `id`, `restaurant_id`, `employee_id`, `date`, `start_time`, `end_time`, `is_available`, `reason`
- Constraints: Valid time ranges when applicable

#### `time_off_requests` (pre-existing, already in use)
- Fields: `id`, `restaurant_id`, `employee_id`, `start_date`, `end_date`, `reason`, `status`, `reviewed_at`, `reviewed_by`

### Database Functions

#### `check_timeoff_conflict()`
```sql
check_timeoff_conflict(
  p_employee_id UUID,
  p_start_time TIMESTAMP WITH TIME ZONE,
  p_end_time TIMESTAMP WITH TIME ZONE
)
```
Returns any time-off requests that overlap with the given shift time range.

#### `check_availability_conflict()`
```sql
check_availability_conflict(
  p_employee_id UUID,
  p_restaurant_id UUID,
  p_start_time TIMESTAMP WITH TIME ZONE,
  p_end_time TIMESTAMP WITH TIME ZONE
)
```
Checks both availability exceptions and recurring weekly availability patterns to detect conflicts.

## Component Architecture

### React Components

#### Time-Off Components
- **TimeOffRequestDialog**: Form for creating/editing time-off requests
- **TimeOffList**: Displays all requests with approve/reject actions
- Integrated into Scheduling page's "Time-Off" tab

#### Availability Components
- **AvailabilityDialog**: Form for setting recurring weekly availability
- **AvailabilityExceptionDialog**: Form for one-time availability changes
- Integrated into Scheduling page's "Availability" tab

#### Enhanced Components
- **ShiftDialog**: Updated with real-time conflict detection and warnings
- **Scheduling Page**: New tabbed interface (Schedule, Time-Off, Availability)

### React Hooks

#### `useTimeOffRequests(restaurantId)`
- Fetches all time-off requests for a restaurant
- Returns: `{ timeOffRequests, loading, error }`

#### `useCreateTimeOffRequest()`, `useUpdateTimeOffRequest()`, etc.
- Mutations for CRUD operations on time-off requests
- Includes `useApproveTimeOffRequest()` and `useRejectTimeOffRequest()`

#### `useEmployeeAvailability(restaurantId, employeeId?)`
- Fetches recurring availability patterns
- Optional employeeId filter

#### `useAvailabilityExceptions(restaurantId, employeeId?)`
- Fetches one-time availability exceptions
- Optional employeeId filter

#### `useCheckConflicts(params)`
- Real-time conflict detection hook
- Params: `{ employeeId, restaurantId, startTime, endTime }`
- Returns: `{ conflicts, hasConflicts, loading }`

## User Interface Flow

### Creating a Time-Off Request

1. Navigate to Scheduling page → Time-Off tab
2. Click "New Request" button
3. Select employee from dropdown
4. Choose start and end dates using calendar picker
5. Optionally add reason
6. Submit request (status: pending)

### Approving Time-Off

1. Navigate to Scheduling page → Time-Off tab
2. Hover over pending request card
3. Click green checkmark (approve) or red X (reject)
4. Status updates immediately with timestamp and reviewer ID

### Setting Employee Availability

1. Navigate to Scheduling page → Availability tab
2. Click "Set Availability" button
3. Select employee and day of week
4. Toggle "Is available" switch
5. If available, set start/end times
6. Optionally add notes
7. Submit

### Adding Availability Exception

1. Navigate to Scheduling page → Availability tab
2. Click "Add Exception" button
3. Select employee and specific date
4. Toggle availability (default: unavailable)
5. If available, set custom hours for that date
6. Add reason (e.g., "Doctor appointment")
7. Submit

### Creating Shifts with Conflict Warnings

1. Navigate to Scheduling page → Schedule tab
2. Click "Create Shift" button
3. Select employee, date/time, position
4. As you fill in details, conflict warnings appear automatically
5. Red alert box shows any detected conflicts:
   - Time-off conflicts: "Employee has approved time-off from X to Y"
   - Availability conflicts: "Shift is outside employee typical availability (9:00-17:00)"
6. You can still submit despite warnings (manager override)

## API Integration

All components use:
- **Supabase Client** for database operations
- **React Query** for data fetching and caching
- **Automatic Auth Token** injection via Supabase client

No direct API calls or raw SQL - all queries go through typed Supabase client methods.

## Security

### Row Level Security (RLS)
- All tables have RLS enabled
- Users can only access data for their restaurants
- Write operations restricted to owner/manager roles

### Input Validation
- Database constraints (CHECK, NOT NULL)
- TypeScript type checking
- Form validation in UI

### Authentication
- All operations require authenticated session
- Restaurant access verified via `user_restaurants` table

See [SECURITY_SUMMARY_TIME_OFF_AVAILABILITY.md](./SECURITY_SUMMARY_TIME_OFF_AVAILABILITY.md) for detailed security analysis.

## Testing

### E2E Tests Created
- `tests/e2e/scheduling/time-off-requests.spec.ts`
  - Create time-off request
  - Approve request
  - Detect scheduling conflicts
  - Delete request

- `tests/e2e/scheduling/availability.spec.ts`
  - Set recurring availability
  - Add availability exception
  - Detect availability conflicts
  - Warn on exception dates

### Running Tests
```bash
npm run test:e2e
```

## Migration Guide

### Database Migration
Run the migration file:
```bash
# Migration creates tables, indexes, RLS policies, and functions
supabase/migrations/20251123_create_availability_tables.sql
```

### No Code Changes Required
The feature is fully integrated into the existing Scheduling page. No breaking changes to existing functionality.

## Future Enhancements

Recommended improvements for future iterations:

1. **Email Notifications**
   - Send email when time-off is approved/rejected
   - Remind managers of pending requests
   - Notify employees of schedule changes

2. **Audit Logging**
   - Detailed log of all approval/rejection actions
   - Track schedule change history

3. **Calendar View**
   - Visual calendar showing blocked dates (time-off)
   - Availability heatmap by employee

4. **Bulk Operations**
   - Set availability for multiple days at once
   - Approve multiple time-off requests

5. **Employee Self-Service Portal**
   - Allow employees to view and manage their own availability
   - Submit time-off requests without manager intervention

6. **Reporting**
   - Time-off usage reports
   - Availability coverage analysis

## Troubleshooting

### Conflicts Not Detecting
- Verify migration ran successfully
- Check database functions exist: `check_timeoff_conflict`, `check_availability_conflict`
- Confirm RLS policies allow query execution

### Time-Off Requests Not Appearing
- Check RLS policies for time_off_requests table
- Verify user has access to the restaurant via user_restaurants table
- Confirm employee exists and is active

### Cannot Approve Requests
- User must have 'owner' or 'manager' role
- Check user_restaurants role assignment

## Support

For issues or questions:
1. Check migration logs for errors
2. Review browser console for JavaScript errors
3. Verify Supabase connection and authentication
4. Check RLS policies in Supabase dashboard

## Version History

- **v1.0** (2025-11-23): Initial implementation
  - Time-off request management
  - Employee availability system
  - Conflict detection
  - E2E tests
  - Security review
