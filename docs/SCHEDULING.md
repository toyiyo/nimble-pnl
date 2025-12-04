# Scheduling Module Implementation

## Overview

This document describes the initial implementation of the Scheduling module for the EasyShiftHQ restaurant management system. This module provides core employee scheduling functionality with a weekly calendar view.

## Features Implemented

### 1. Employee Management
- Create, edit, and delete employees
- Track employee details:
  - Name, email, phone
  - Position (Server, Cook, Bartender, Host, Manager, etc.)
  - Hourly rate (stored in cents)
  - Status (active, inactive, terminated)
  - Hire date
  - Notes
- Filter active employees for scheduling
   - Filter by employee position (e.g. Bartender, Cashier) to narrow the schedule view when planning shifts

### 2. Shift Scheduling
- Create, edit, and delete shifts
- Assign shifts to employees
- Configure shift details:
  - Start and end date/time
  - Break duration (in minutes)
  - Position for the shift
  - Status (scheduled, confirmed, completed, cancelled)
  - Notes
- Validation: End time must be after start time

### 3. Weekly Calendar View
- Sunday through Saturday weekly view
- Employee rows with daily columns
- Visual shift cards showing:
  - Time range (e.g., "9:00 AM - 5:00 PM")
  - Position
  - Status badge
- Quick actions:
  - Click shift to edit
  - Hover to see edit/delete buttons
  - Add shift button per day/employee cell
- Week navigation (previous/next/today)

### 4. Labor Metrics Dashboard
- **Active Employees**: Count of employees with "active" status
- **Total Hours**: Sum of scheduled hours for the week (excluding breaks)
- **Labor Cost**: Calculated weekly labor cost based on employee hourly rates

### 5. User Experience
- Loading states with skeleton placeholders
- Empty states with helpful calls-to-action
- Confirmation dialog for shift deletion
- Toast notifications for all actions
- Mobile-responsive table design
- Sticky employee column for horizontal scrolling

## Database Schema

### Tables Created

#### `employees`
```sql
- id (UUID, primary key)
- restaurant_id (UUID, foreign key to restaurants)
- name (TEXT, required)
- email (TEXT, optional)
- phone (TEXT, optional)
- position (TEXT, required)
- hourly_rate (INTEGER, cents, required)
- status (TEXT, default 'active')
- hire_date (DATE, optional)
- notes (TEXT, optional)
- created_at (TIMESTAMP)
- updated_at (TIMESTAMP)
```

#### `shifts`
```sql
- id (UUID, primary key)
- restaurant_id (UUID, foreign key to restaurants)
- employee_id (UUID, foreign key to employees)
- start_time (TIMESTAMP, required)
- end_time (TIMESTAMP, required)
- break_duration (INTEGER, minutes, default 0)
- position (TEXT, required)
- notes (TEXT, optional)
- status (TEXT, default 'scheduled')
- created_at (TIMESTAMP)
- updated_at (TIMESTAMP)
- CONSTRAINT: end_time > start_time
```

#### `shift_templates`
```sql
- id (UUID, primary key)
- restaurant_id (UUID, foreign key to restaurants)
- name (TEXT, required)
- day_of_week (INTEGER, 0-6, required)
- start_time (TIME, required)
- end_time (TIME, required)
- break_duration (INTEGER, minutes, default 0)
- position (TEXT, required)
- is_active (BOOLEAN, default true)
- created_at (TIMESTAMP)
- updated_at (TIMESTAMP)
```

#### `time_off_requests`
```sql
- id (UUID, primary key)
- restaurant_id (UUID, foreign key to restaurants)
- employee_id (UUID, foreign key to employees)
- start_date (DATE, required)
- end_date (DATE, required)
- reason (TEXT, optional)
- status (TEXT, default 'pending')
- requested_at (TIMESTAMP)
- reviewed_at (TIMESTAMP, optional)
- reviewed_by (UUID, optional foreign key to auth.users)
- created_at (TIMESTAMP)
- updated_at (TIMESTAMP)
- CONSTRAINT: end_date >= start_date
```

### Row Level Security (RLS)

All tables have RLS enabled with policies that:
- Allow SELECT for users associated with the restaurant
- Allow INSERT/UPDATE for users with 'owner' or 'manager' roles
- Allow DELETE for users with 'owner' role (employees require 'owner', shifts allow 'manager')

### Indexes

Performance indexes created on:
- `restaurant_id` for all tables
- `employee_id` for shifts and time_off_requests
- `start_time` for shifts
- `status` for employees, shifts, and time_off_requests
- `day_of_week` for shift_templates

## Code Structure

### React Hooks (`src/hooks/`)

#### `useEmployees.tsx`
- `useEmployees(restaurantId)` - Fetch employees with React Query
- `useCreateEmployee()` - Create new employee mutation
- `useUpdateEmployee()` - Update employee mutation
- `useDeleteEmployee()` - Delete employee mutation

#### `useShifts.tsx`
- `useShifts(restaurantId, startDate, endDate)` - Fetch shifts with date filtering
- `useCreateShift()` - Create new shift mutation
- `useUpdateShift()` - Update shift mutation
- `useDeleteShift()` - Delete shift mutation

### Components (`src/components/`)

#### `EmployeeDialog.tsx`
Full-featured employee form with:
- Validation for required fields
- Number formatting for hourly rate
- Status selection dropdown
- Position selection dropdown
- Date picker for hire date
- Textarea for notes

#### `ShiftDialog.tsx`
Full-featured shift form with:
- Employee selection (active employees only)
- Position selection dropdown
- Separate date and time inputs for start/end
- Break duration in minutes
- Status selection dropdown
- Client-side validation

### Pages (`src/pages/`)

#### `Scheduling.tsx`
Main scheduling page with:
- Weekly calendar grid
- Week navigation controls
- Labor metrics cards
- Employee/shift management dialogs
- Shift deletion confirmation
- Responsive table layout

### Types (`src/types/`)

#### `scheduling.ts`
TypeScript interfaces for:
- `Employee`
- `Shift`
- `ShiftTemplate`
- `TimeOffRequest`
- `ScheduleWeek`
- `LaborMetrics`

## Navigation

Added to sidebar under new "Operations" section:
- Menu item: "Scheduling"
- Icon: CalendarCheck
- Route: `/scheduling`

## Technical Implementation Details

### React Query Configuration
- `staleTime`: 30 seconds (ensures real-time data freshness)
- `refetchOnWindowFocus`: true (refresh when user returns to tab)
- `refetchOnMount`: true (refresh when component mounts)
- Query keys properly scoped by restaurant ID and date ranges

### Accessibility
- All form inputs have associated labels
- ARIA labels on icon-only buttons
- Keyboard navigation support
- Focus management in dialogs
- Screen reader compatible

### Data Integrity
- All monetary values stored in cents (integer math)
- Timestamps in ISO 8601 format
- Timezone-aware date handling
- Constraint checks in database
- Client-side validation before submission

### Performance
- Database indexes on frequently queried columns
- React Query caching reduces redundant requests
- Memoization for expensive calculations
- Lazy loading of shift data by week

## Future Enhancements

This initial implementation provides the foundation for:

1. **Time Tracking Module**
   - Clock in/out interface
   - Break tracking
   - Live "who's on the clock" view
   - GPS/geofence validation

2. **Tip Pooling Engine**
   - Pool configuration
   - Tip contribution tracking
   - Distribution calculations
   - Payout reports

3. **Shift Exchange System**
   - Shift trading between employees
   - Shift claiming (open shifts)
   - Manager approval workflow

4. **Compliance Engine**
   - Overtime detection and warnings
   - Break rule validation
   - Minor labor restrictions
   - Schedule conflict detection

5. **Advanced Scheduling**
   - Drag-and-drop shift creation
   - Template-based scheduling
   - Copy from previous weeks
   - Schedule publishing/notifications

6. **Payroll Integration**
   - Timecard export (CSV/API)
   - Tip distribution export
   - Wage calculation reports

7. **Mobile Applications**
   - Employee mobile app (view schedules, request time off)
   - Manager mobile app (approve requests, monitor attendance)

## Testing

### Build Status
✅ TypeScript compilation successful  
✅ Vite build successful (no errors)  
✅ ESLint validation passed (zero errors)

### Manual Testing Checklist
- [ ] Create employee
- [ ] Edit employee details
- [ ] Delete employee
- [ ] Create shift for employee
- [ ] Edit shift details
- [ ] Delete shift
- [ ] Navigate weeks (previous/next/today)
- [ ] Verify labor metrics calculations
- [ ] Test responsive layout on mobile
- [ ] Verify RLS policies (users can only see their restaurant data)

## Migration Deployment

To deploy this feature:

1. Apply database migration:
   ```bash
   supabase db push
   ```

2. The migration file `20251114_create_scheduling_tables.sql` will:
   - Create all four tables
   - Enable RLS on all tables
   - Create RLS policies
   - Add performance indexes
   - Set up update triggers

3. No data migration needed (new feature)

## Security Considerations

- ✅ All tables have RLS enabled
- ✅ Users can only access data for their associated restaurants
- ✅ Role-based permissions (owner/manager/employee)
- ✅ Hourly rates stored as integers (cents) to prevent floating-point issues
- ✅ Timestamps prevent timezone confusion
- ✅ Constraint checks prevent invalid data

## API Endpoints Used

All operations use Supabase client with automatic RLS:
- `supabase.from('employees').select()...`
- `supabase.from('employees').insert()...`
- `supabase.from('employees').update()...`
- `supabase.from('employees').delete()...`
- `supabase.from('shifts').select('*, employee:employees(*)')...`
- `supabase.from('shifts').insert()...`
- `supabase.from('shifts').update()...`
- `supabase.from('shifts').delete()...`

## Dependencies

No new dependencies added. Uses existing packages:
- `@tanstack/react-query` - Data fetching and caching
- `date-fns` - Date manipulation and formatting
- `lucide-react` - Icons
- `@radix-ui/*` - Accessible UI primitives (via shadcn/ui)

## Browser Support

Same as main application:
- Chrome/Edge (latest)
- Firefox (latest)
- Safari (latest)
- Mobile browsers (iOS Safari, Chrome Android)

## Known Limitations

1. No drag-and-drop yet (requires additional library)
2. No shift templates UI (tables exist, but no UI to manage)
3. No time-off request UI (tables exist, but no UI to manage)
4. No real-time collaboration (multiple managers editing simultaneously)
5. No conflict detection UI (overlapping shifts, double-booking)
6. No mobile app (web only)

## Documentation Links

- Database schema: `supabase/migrations/20251114_create_scheduling_tables.sql`
- Type definitions: `src/types/scheduling.ts`
- Employee hooks: `src/hooks/useEmployees.tsx`
- Shift hooks: `src/hooks/useShifts.tsx`
- Employee dialog: `src/components/EmployeeDialog.tsx`
- Shift dialog: `src/components/ShiftDialog.tsx`
- Main page: `src/pages/Scheduling.tsx`
