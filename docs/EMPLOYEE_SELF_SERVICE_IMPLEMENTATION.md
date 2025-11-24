# Employee Self-Service System Implementation Summary

## Overview
This implementation adds a complete employee self-service portal allowing employees to manage their own time-off requests and availability preferences without requiring manager intervention for basic operations.

## Files Created

### Database
- `supabase/migrations/20251123_add_employee_self_service_rls.sql`
  - RLS policies for employee self-service access
  - Helper function `get_current_employee_id()` with security validation

### Frontend
- `src/pages/EmployeePortal.tsx` - Main employee portal page
- `src/hooks/useCurrentEmployee.tsx` - Hook to get current employee record

### Modified Files
- `src/App.tsx` - Added employee portal route
- `src/components/AppSidebar.tsx` - Added "My Requests" link for staff
- `src/components/TimeOffRequestDialog.tsx` - Added defaultEmployeeId support
- `src/components/AvailabilityDialog.tsx` - Added defaultEmployeeId support
- `src/components/AvailabilityExceptionDialog.tsx` - Added defaultEmployeeId support
- `src/lib/utils.ts` - Added formatTime() utility function

## Features Implemented

### Employee Portal (/employee/portal)

#### Time Off Tab
- **View**: See all own time-off requests with status badges
- **Create**: Submit new time-off requests
- **Edit**: Modify pending requests only
- **Delete**: Remove pending requests
- **Status**: Visual indicators for approved/pending/rejected
- **Empty State**: Helpful message when no requests exist

#### Availability Tab

**Weekly Availability:**
- Set regular availability for each day of the week
- Mark days as available or unavailable
- Specify available hours (start/end time)
- Add optional notes

**Availability Exceptions:**
- Create one-time availability changes for specific dates
- Mark dates as unavailable (e.g., appointments)
- Set custom hours for specific dates
- Add reason for exception

### Security Features

#### Database Level (RLS Policies)
```sql
-- Employees can view their own time-off requests
CREATE POLICY "Employees can view own time-off requests"
  ON time_off_requests FOR SELECT
  USING (employee_id IN (SELECT id FROM employees WHERE user_id = auth.uid()));

-- Employees can create their own time-off requests  
CREATE POLICY "Employees can create own time-off requests"
  ON time_off_requests FOR INSERT
  WITH CHECK (employee_id IN (SELECT id FROM employees WHERE user_id = auth.uid()));

-- Employees can only update pending requests
CREATE POLICY "Employees can update own pending time-off requests"
  ON time_off_requests FOR UPDATE
  USING (
    employee_id IN (SELECT id FROM employees WHERE user_id = auth.uid())
    AND status = 'pending'
  );
```

#### Validation
- Restaurant access checked before any operation
- Employees can only access their own data
- Cannot modify approved/rejected requests
- Cannot approve/reject any requests (manager-only)

## User Experience

### For Employees
1. Navigate to "My Requests" in sidebar
2. View all own time-off requests and availability
3. Create/edit/delete own pending requests
4. Manage weekly availability preferences
5. Add exceptions for specific dates
6. Receive helpful alerts and empty states

### For Managers
- All existing functionality remains unchanged
- Full access to all employee data
- Can approve/reject requests
- Can manage all schedules

## Technical Implementation

### Data Flow
```
Employee Login → useCurrentEmployee → Get employee_id
  ↓
Access Portal → useTimeOffRequests (filtered by employee_id)
  ↓
Create Request → RLS validates employee_id matches auth.uid()
  ↓
Save to DB → Only if validation passes
```

### Component Structure
```
EmployeePortal
├── Time Off Tab
│   ├── TimeOffRequestDialog (with defaultEmployeeId)
│   ├── Request List (filtered)
│   └── Delete Confirmation
└── Availability Tab
    ├── Weekly Availability Section
    │   └── AvailabilityDialog (with defaultEmployeeId)
    └── Exceptions Section
        └── AvailabilityExceptionDialog (with defaultEmployeeId)
```

### Hook Pattern
```typescript
// Get current employee for logged-in user
const { currentEmployee } = useCurrentEmployee(restaurantId);

// Pre-fill dialogs with employee ID
<TimeOffRequestDialog 
  defaultEmployeeId={currentEmployee.id}
  ... 
/>
```

## Migration Guide

### Database Setup
```bash
# Apply the migration
psql your_database < supabase/migrations/20251123_add_employee_self_service_rls.sql
```

### Testing Checklist
- [ ] Employee can access /employee/portal
- [ ] Employee sees only their own time-off requests
- [ ] Employee can create time-off requests
- [ ] Employee can edit pending requests
- [ ] Employee CANNOT edit approved/rejected requests
- [ ] Employee CANNOT see other employees' data
- [ ] Employee can set weekly availability
- [ ] Employee can add availability exceptions
- [ ] Manager can still access all data
- [ ] Manager can approve/reject requests

## Troubleshooting

### Employee Portal Shows "Access Required"
**Problem**: User account not linked to employee record  
**Solution**: Manager needs to link user account to employee profile
```sql
UPDATE employees 
SET user_id = '<user_auth_id>' 
WHERE id = '<employee_id>';
```

### Employee Can See Other Employees' Data
**Problem**: RLS policies not applied correctly  
**Solution**: Verify policies exist and are enabled
```sql
SELECT * FROM pg_policies WHERE tablename = 'time_off_requests';
```

### Cannot Edit Time-Off Request
**Problem**: Request is already approved/rejected  
**Solution**: Employees can only edit pending requests (by design)

## Performance Considerations

### Database Queries
- All queries filtered by employee_id at database level
- Indexes on employee_id for fast lookups
- RLS policies optimized with subqueries

### Frontend
- React Query caching (30s stale time)
- Filtered data in useCurrentEmployee hook
- Minimal re-renders with proper dependencies

## Future Enhancements

### Recommended Features
1. **Email Notifications**
   - Notify employee when request is approved/rejected
   - Remind manager of pending requests

2. **Calendar View**
   - Visual calendar showing time-off
   - Color-coded availability

3. **Bulk Operations**
   - Set availability for multiple days at once
   - Copy availability from previous week

4. **Mobile App**
   - Native mobile version with Capacitor
   - Push notifications for request status

5. **Reporting**
   - Time-off usage reports for employees
   - Availability coverage analysis

## Security Summary

### What Employees CAN Do
✅ View own time-off requests  
✅ Create time-off requests  
✅ Edit pending time-off requests  
✅ Delete pending time-off requests  
✅ View own availability  
✅ Create/update availability  
✅ Delete own availability  

### What Employees CANNOT Do
❌ View other employees' requests  
❌ Approve/reject requests  
❌ Edit approved/rejected requests  
❌ Access manager-only features  
❌ Query other restaurants' data  

### Database Protection
- Row Level Security (RLS) enforced
- Restaurant access validated
- Employee ID verified on every query
- No client-side security bypasses possible

## Support

### Common Questions

**Q: How do employees access the portal?**  
A: Navigate to /employee/portal or click "My Requests" in the sidebar

**Q: Can employees approve their own requests?**  
A: No, only managers/owners can approve requests

**Q: What happens if employee is deactivated?**  
A: RLS policies check status='active', so they lose access immediately

**Q: Can managers still use the main Scheduling page?**  
A: Yes, all existing functionality remains unchanged

## Version History

### v1.0 (2025-11-23)
- Initial implementation
- Time-off request self-service
- Availability management
- RLS policies for security
- Employee portal UI
- Code review improvements
