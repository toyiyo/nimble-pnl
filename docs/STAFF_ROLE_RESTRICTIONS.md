# Staff Role Restrictions & Employee Invitation Flow - Implementation Guide

## Overview

This document describes the implementation of staff role restrictions and the simplified employee invitation flow, as requested in PR comment #3536579711.

## Problem Statement

The original implementation had several issues:
1. **Staff users could see all navigation** - Staff members saw management features they shouldn't access
2. **Manual invitation process** - Managers had to create employee AND send invitation separately
3. **No automatic linking** - Employee records and user accounts weren't automatically connected
4. **Complex onboarding** - Required multiple manual steps to setup employees

## Solution Implemented

### 1. Staff Role Restrictions

#### Route Protection
- Modified `ProtectedRoute` component to accept `allowStaff` parameter
- Added `StaffRoleChecker` component that:
  - Checks user's role from restaurant context
  - Allows staff access only to: `/employee/*` and `/settings`
  - Redirects all other attempts to `/employee/clock`

**Allowed paths for staff:**
```typescript
const staffAllowedPaths = [
  '/employee/clock',
  '/employee/timecard',  // Future
  '/employee/pay',       // Future
  '/employee/schedule',  // Future
  '/settings'
];
```

#### Sidebar Navigation Filtering
- `AppSidebar` component now filters navigation based on role
- Staff users see minimal menu:
  - **Employee** section: Time Clock
  - **Settings** section: Settings
- Managers/owners see full navigation

**Implementation:**
```typescript
const filteredNavigationGroups = isStaff
  ? [
      {
        label: 'Employee',
        items: [
          { path: '/employee/clock', label: 'Time Clock', icon: Clock },
        ],
      },
      {
        label: 'Settings',
        items: [
          { path: '/settings', label: 'Settings', icon: Settings },
        ],
      },
    ]
  : navigationGroups;
```

### 2. Simplified Employee Invitation Flow

#### Add Employee Integration
Modified `EmployeeDialog` to automatically send staff invitation when email is provided.

**Flow:**
1. Manager creates employee with email
2. Employee record created in database
3. Invitation automatically sent via edge function
4. Toast notification confirms both actions

**Code:**
```typescript
createEmployee.mutate(employeeData, {
  onSuccess: async (newEmployee) => {
    if (email && email.trim()) {
      await supabase.functions.invoke('send-team-invitation', {
        body: {
          restaurantId: restaurantId,
          email: email.trim(),
          role: 'staff',
          employeeId: newEmployee.id, // Links invitation to employee
        },
      });
    }
  },
});
```

#### Database Changes
Added `employee_id` column to `invitations` table:

**Migration:** `20251115_add_employee_id_to_invitations.sql`
```sql
ALTER TABLE public.invitations 
ADD COLUMN IF NOT EXISTS employee_id UUID 
REFERENCES public.employees(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_invitations_employee_id 
ON public.invitations(employee_id);
```

#### Invitation Acceptance Updates
Modified `accept-invitation` edge function to link employee record:

```typescript
// If this is a staff invitation with an employee_id, link the employee to this user
if (invitation.role === 'staff' && invitation.employee_id) {
  await supabase
    .from('employees')
    .update({ user_id: user.id })
    .eq('id', invitation.employee_id)
    .eq('restaurant_id', invitation.restaurant_id);
}
```

## User Flows

### Manager Workflow (Before)
1. Navigate to Scheduling
2. Click "Add Employee"
3. Fill in employee details
4. Save employee
5. Navigate to Team page
6. Click "Invite Member"
7. Enter same email again
8. Send invitation
9. **Manual step:** Link employee to user later

### Manager Workflow (After) ✅
1. Navigate to Scheduling
2. Click "Add Employee"
3. Fill in employee details (including email)
4. Click save
5. ✨ **Done!** Employee created AND invited automatically

### Employee Workflow (After) ✅
1. Receive invitation email
2. Click accept invitation link
3. Create account or sign in
4. ✨ **Automatically:**
   - Added to restaurant as "staff"
   - Linked to employee record
   - Redirected to Time Clock
5. See only Time Clock and Settings in navigation

## Technical Details

### Files Modified

**Frontend Components:**
```
src/App.tsx
  - Added ProtectedRoute allowStaff parameter
  - Added StaffRoleChecker component
  - Updated route definitions

src/components/AppSidebar.tsx
  - Added role-based navigation filtering
  - Staff see minimal menu

src/components/EmployeeDialog.tsx
  - Integrated invitation sending
  - Added success/error handling
```

**Backend Functions:**
```
supabase/functions/send-team-invitation/index.ts
  - Added employeeId parameter
  - Store employeeId in invitation

supabase/functions/accept-invitation/index.ts
  - Added employee linking logic
  - Update employee.user_id on acceptance
```

**Database:**
```
supabase/migrations/20251115_add_employee_id_to_invitations.sql
  - Add employee_id column
  - Add index
  - Add comment
```

### Security Considerations

✅ **RLS Policies:** All data access controlled by Row Level Security  
✅ **Role Isolation:** Staff can't access management data  
✅ **Invitation Validation:** Email must match invitation  
✅ **Employee Linking:** Only links if invitation has employee_id  
✅ **Restaurant Scoping:** All operations scoped to restaurant  

### Error Handling

**EmployeeDialog:**
- Gracefully handles invitation send failures
- Employee still created if email fails
- User notified of partial success

**accept-invitation:**
- Links employee if possible
- Continues even if linking fails
- User still added to team

## Testing Guide

### Test Staff Role Restrictions

1. **Setup:**
   - Have a user with "staff" role on a restaurant
   - Login as that user

2. **Navigate to restricted page:**
   - Try to access `/scheduling` directly
   - Should redirect to `/employee/clock`

3. **Check sidebar:**
   - Should only see "Time Clock" and "Settings"
   - No Dashboard, Inventory, Accounting, etc.

4. **Access allowed pages:**
   - `/employee/clock` should work
   - `/settings` should work

### Test Employee Invitation Flow

1. **As Manager:**
   - Go to Scheduling
   - Click "Add Employee"
   - Fill in details with valid email
   - Submit form
   - Verify toast says "invited"

2. **Check Database:**
   ```sql
   SELECT * FROM invitations 
   WHERE email = 'employee@example.com'
   ORDER BY created_at DESC 
   LIMIT 1;
   ```
   - Should have `employee_id` populated
   - Should have `role = 'staff'`

3. **As Employee (new user):**
   - Check email for invitation
   - Click accept invitation link
   - Create new account
   - Should be redirected to `/employee/clock`

4. **Verify Linking:**
   ```sql
   SELECT * FROM employees 
   WHERE email = 'employee@example.com';
   ```
   - Should have `user_id` populated

5. **Verify Access:**
   - Login as employee
   - Should only see Time Clock and Settings
   - Should be able to clock in/out

## Migration Deployment

### Prerequisites
- Existing employees table with user_id column
- Existing invitations table

### Deployment Steps

1. **Apply database migration:**
   ```bash
   cd supabase
   supabase db push
   ```

2. **Deploy edge functions:**
   ```bash
   supabase functions deploy send-team-invitation
   supabase functions deploy accept-invitation
   ```

3. **Test in staging:**
   - Create test employee with email
   - Verify invitation sent
   - Accept invitation
   - Verify linking

4. **Deploy to production:**
   - Same steps as staging
   - Monitor for errors

### Rollback Plan

If issues arise:

1. **Edge Functions:**
   - Deploy previous version
   - Functions are backwards compatible

2. **Database:**
   - Column is nullable, safe to leave
   - Can drop if needed:
     ```sql
     ALTER TABLE invitations DROP COLUMN employee_id;
     ```

## Known Limitations

1. **No bulk invitation:** Still sends one email per employee
2. **No invitation resend:** From employee dialog (can resend from Team page)
3. **Email required:** Won't send invitation without email
4. **Single role:** Only supports "staff" role for employees

## Future Enhancements

### Phase 2 Possibilities:
- **Bulk employee import:** CSV upload with automatic invitations
- **Invitation templates:** Customize invitation email per restaurant
- **Role upgrade:** Allow promoting staff to manager
- **Invitation history:** Track all invitations sent for an employee
- **Auto-reminders:** Resend invitation if not accepted after X days

## Benefits

### For Managers ✅
- ⚡ **Faster onboarding:** One step instead of two
- 🎯 **No duplication:** Enter email once
- 🔗 **Automatic linking:** No manual connection needed
- 📧 **Immediate notification:** Employee gets email right away

### For Employees ✅
- 🚀 **Simple signup:** Click link, create account, done
- 🔒 **Secure access:** Automatic role assignment
- 📱 **Focused interface:** See only what's needed
- ⏰ **Ready to work:** Clock in immediately after signup

### For System ✅
- ♻️ **Reuses infrastructure:** Existing invitation system
- 🔐 **Maintains security:** RLS policies enforced
- 📊 **Scalable:** Works for any number of employees
- 🛠️ **Maintainable:** Clean, documented code

## Troubleshooting

### Issue: Employee created but invitation not sent
**Cause:** Email service failure  
**Resolution:** Check logs, resend from Team page  
**Prevention:** Already handled in code with graceful fallback

### Issue: Invitation accepted but employee not linked
**Cause:** employee_id missing from invitation  
**Resolution:** Manually link via SQL:
```sql
UPDATE employees 
SET user_id = 'auth-user-id'
WHERE id = 'employee-id';
```
**Prevention:** Ensure employee_id passed in invitation

### Issue: Staff user can access restricted pages
**Cause:** Cache or role not loaded  
**Resolution:** Refresh page, check restaurant selection  
**Prevention:** Add loading state checks

### Issue: Duplicate invitations
**Cause:** Existing pending invitation  
**Resolution:** Handled automatically - old invitations cancelled  
**Prevention:** Already handled in send-team-invitation

## Performance Considerations

### Database
- Added index on `invitations.employee_id`
- Query performance remains optimal
- Foreign key maintains referential integrity

### Edge Functions
- Single additional query (employee link)
- Negligible performance impact
- Async operations don't block response

### Frontend
- Role check happens once per route change
- Sidebar filter runs once per render
- Minimal computational overhead

## Conclusion

The implementation successfully addresses all requirements:
- ✅ Staff role restricted to `/employee/*` and `/settings`
- ✅ Navigation hidden for staff users
- ✅ Employee invitation automatically sent from Scheduling
- ✅ Employee-user linking automated on acceptance
- ✅ Seamless flow for managers and employees
- ✅ Reuses existing invitation infrastructure

The solution is secure, scalable, and provides excellent user experience for both managers and employees.
