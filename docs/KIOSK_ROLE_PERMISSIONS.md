# Kiosk Role Permissions & Restrictions

## Overview

The `kiosk` role is a highly restricted service account role designed exclusively for time clock kiosk devices. Kiosk users have minimal permissions and can **ONLY** access the `/kiosk` route - nothing else.

## Purpose

The kiosk role exists to:
1. Allow dedicated tablets/devices to function as time clock kiosks
2. Prevent staff or managers from accessing sensitive restaurant data on public devices
3. Isolate time punch functionality from all other restaurant management features

## Permission Matrix

| Feature/Route | Owner | Manager | Chef | Staff | Kiosk |
|--------------|-------|---------|------|-------|-------|
| Dashboard (/) | ✅ | ✅ | ✅ | ❌ | ❌ |
| Team Management | ✅ | ✅ | ❌ | ❌ | ❌ |
| Integrations | ✅ | ✅ | ❌ | ❌ | ❌ |
| Recipes | ✅ | ✅ | ✅ | ❌ | ❌ |
| POS Sales | ✅ | ✅ | ❌ | ❌ | ❌ |
| Reports | ✅ | ✅ | ✅ | ❌ | ❌ |
| Inventory | ✅ | ✅ | ✅ | ❌ | ❌ |
| Purchase Orders | ✅ | ✅ | ✅ | ❌ | ❌ |
| Banking/Accounting | ✅ | ✅ | ❌ | ❌ | ❌ |
| Scheduling | ✅ | ✅ | ❌ | ❌ | ❌ |
| Time Punches Manager | ✅ | ✅ | ❌ | ❌ | ❌ |
| Employee Clock | ✅ | ✅ | ✅ | ✅ | ❌ |
| Employee Portal | ✅ | ✅ | ✅ | ✅ | ❌ |
| Settings | ✅ | ✅ | ✅ | ✅ | ❌ |
| **Kiosk Mode** | ✅ | ✅ | ✅ | ✅ | **✅ ONLY** |

## Implementation

### 1. Route-Level Restrictions (`App.tsx`)

```typescript
const StaffRoleChecker = ({ children, allowStaff, currentPath }) => {
  const { selectedRestaurant } = useRestaurantContext();
  const role = selectedRestaurant?.role;
  const isKiosk = role === 'kiosk';
  
  // CRITICAL: Kiosk users can ONLY access /kiosk - nothing else
  if (isKiosk && currentPath !== '/kiosk') {
    return <Navigate to="/kiosk" replace />;
  }
  
  // Staff and other role checks...
};
```

**Key Points:**
- Kiosk check happens **first** before any other role logic
- ANY attempt to navigate away from `/kiosk` immediately redirects back
- No exceptions - kiosk users are locked to one route only

### 2. UI/Navigation Restrictions (`AppSidebar.tsx`)

```typescript
const role = selectedRestaurant?.role;
const isKiosk = role === 'kiosk';

const filteredNavigationGroups = isKiosk
  ? [] // Kiosk: no navigation at all
  : isStaff
  ? [/* limited staff navigation */]
  : navigationGroups; // Full access for owner/manager/chef
```

**Key Points:**
- Kiosk users see NO sidebar navigation (though they shouldn't see sidebar due to `noChrome={true}`)
- This is a safety measure in case the noChrome flag fails

### 3. Team Management Display (`TeamMembers.tsx`)

```typescript
const roleIcons = {
  owner: Crown,
  manager: Shield,
  chef: ChefHat,
  staff: User,
  kiosk: TabletSmartphone, // ✅ Added
};

const roleColors = {
  owner: "default",
  manager: "secondary",
  chef: "outline",
  staff: "outline",
  kiosk: "outline", // ✅ Added
};
```

**Key Points:**
- Kiosk role now displays properly in team member lists
- Uses `TabletSmartphone` icon to visually distinguish from other roles
- Kiosk role members **cannot** have their role changed via dropdown
- Role change dropdown is hidden for kiosk users: `member.role !== 'kiosk'`

### 4. Database Schema (`user_restaurants` table)

```sql
ALTER TABLE public.user_restaurants
  DROP CONSTRAINT IF EXISTS user_restaurants_role_check;
ALTER TABLE public.user_restaurants
  ADD CONSTRAINT user_restaurants_role_check
  CHECK (role IN ('owner', 'manager', 'chef', 'staff', 'kiosk'));
```

**Migration:** `20251127_add_kiosk_service_account.sql`

## How to Create a Kiosk User

Kiosk users are **NOT** created through normal team invitations. They are created automatically via the "Kiosk Service Account" feature:

1. Navigate to **Time Punches Manager** (manager/owner only)
2. Locate the **Kiosk Mode** card
3. Click **"Create kiosk login"** or **"Rotate credentials"**
4. System generates:
   - Email: `kiosk-{restaurant_id}@easyshifthq.com`
   - Random secure password
5. Use these credentials to sign in on the dedicated kiosk tablet
6. The kiosk account is automatically assigned `role = 'kiosk'` in `user_restaurants`

## Security Considerations

### ✅ What Kiosk Users CAN Do

1. **View the kiosk time clock interface** (`/kiosk` route only)
2. **Create time punches** (clock in/out for employees via PIN)
3. **Read employee names** (to display on kiosk UI)
4. **Read/update employee PINs** (for authentication)
5. **View recent time punches** (last 24 hours, for UI validation)

### ❌ What Kiosk Users CANNOT Do

- View dashboard or any restaurant data
- Access team management
- View or modify recipes, inventory, products
- See sales data or financial information
- Access scheduling
- View purchase orders or vendor information
- Manage integrations
- Access employee portal or settings
- Navigate to any route except `/kiosk`
- See sidebar navigation

## Comparison: Kiosk vs Staff Roles

| Capability | Staff | Kiosk |
|-----------|-------|-------|
| **Routes** | `/employee/clock`, `/employee/portal`, `/settings` | `/kiosk` **ONLY** |
| **Sidebar** | Limited navigation (2 sections) | No navigation at all |
| **Time Clock** | Can clock themselves in/out | Can record punches for all employees via PIN |
| **Employee Data** | Can view own data | Cannot view employee data (except names for punch UI) |
| **Settings** | Can update own profile | Cannot access settings |
| **Purpose** | Individual employee accounts | Shared kiosk device accounts |

## Testing Checklist

To verify kiosk permissions are working correctly:

- [ ] Create a kiosk service account
- [ ] Sign in with kiosk credentials on a test device
- [ ] Verify user lands on `/kiosk` route
- [ ] Attempt to navigate to `/` → Should redirect to `/kiosk`
- [ ] Attempt to navigate to `/team` → Should redirect to `/kiosk`
- [ ] Attempt to navigate to `/employee/clock` → Should redirect to `/kiosk`
- [ ] Attempt to navigate to `/settings` → Should redirect to `/kiosk`
- [ ] Verify no sidebar is visible (noChrome mode)
- [ ] Verify can create time punches via PIN
- [ ] Verify kiosk user appears in team member list with tablet icon
- [ ] Verify cannot change kiosk user's role via dropdown

## Files Modified

1. **`src/App.tsx`**
   - Updated `StaffRoleChecker` to check kiosk role first
   - Removed `/kiosk` from staff allowed paths
   - Added clear comments explaining kiosk-only access

2. **`src/components/AppSidebar.tsx`**
   - Separated `isKiosk` check from `isStaff` check
   - Kiosk users get empty navigation array
   - Staff users get limited navigation (unchanged)

3. **`src/components/TeamMembers.tsx`**
   - Added `TabletSmartphone` icon import
   - Added `kiosk` to `roleIcons` and `roleColors`
   - Hide role change dropdown for kiosk members: `member.role !== 'kiosk'`

## Future Enhancements

- [ ] Add session timeout for kiosk users (auto-logout after inactivity)
- [ ] Add "locked mode" indicator on kiosk UI
- [ ] Add admin override PIN to exit kiosk mode without credentials
- [ ] Add audit log for kiosk account creation/rotation
- [ ] Add device fingerprinting to tie kiosk account to specific tablet

## Related Documentation

- [STAFF_ROLE_RESTRICTIONS.md](./STAFF_ROLE_RESTRICTIONS.md) - Staff role permissions
- [TIME_TRACKING_PHASE1.md](./TIME_TRACKING_PHASE1.md) - Kiosk mode implementation
- Migration: `supabase/migrations/20251127_add_kiosk_service_account.sql`
