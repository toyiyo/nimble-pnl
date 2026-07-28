# Handoff: Rushbowls manager-who-is-also-an-employee (2026-07-22)

## The ask
A Rushbowls user is both a manager and needs the employee view to enter their time.
They created **two accounts** ("Alexis manager" and "Alexis Sánchez") and report that
logging out and back in with the other account still lands them on `/employee`, not the
manager view.

## Investigation already completed (code-side — do not redo)

**Architectural root:** `user_restaurants` has `UNIQUE(user_id, restaurant_id)`
(`supabase/migrations/20250915210020_*.sql:31`). One user = exactly one role per
restaurant. That constraint is the entire reason the two-account workaround exists.

**But the role controls far less than it appears:**

1. Clock-in does **not** require the `staff` role. `useCurrentEmployee`
   (`src/hooks/useCurrentEmployee.tsx:20`) resolves the employee purely by
   `employees.user_id = auth.uid()` + restaurant + `status='active'`. Role is never read.
2. RLS already allows it. `time_punches` has BOTH "Employees can insert own time punches"
   (`employee_id IN (SELECT id FROM employees WHERE user_id = auth.uid())`) and a
   manager-role insert policy. **No policy change needed.**
3. `allowStaff={true}` on the `/employee/*` routes means "staff are ALSO allowed", not
   "staff only". `StaffRoleChecker` (`src/App.tsx:231`) only redirects when `isStaff`.
   A manager can already open `/employee/clock` by URL today and it works.
4. `link_employee_to_user(p_employee_id, p_user_id)` already exists
   (`supabase/migrations/20251115100200_link_employee_to_user_helper.sql`), is
   owner/manager-gated, and never touches `user_restaurants.role`.
5. `AppSidebar` has **zero** links to `/employee/*` — the capability exists but is
   unreachable in the UI.

**Ruled out for the login-switch symptom:** `useRestaurants` uses plain `useState` keyed
on `user.id` (not React Query), so there's no cross-account cache. `signOut`
(`src/hooks/useAuth.tsx:196`) clears all `sb-` keys and does
`window.location.href='/auth'` — a hard reload wiping memory. Client uses
`storage: localStorage` (`src/integrations/supabase/client.ts:20`), so that sweep is
complete. A leaked session between accounts is **not possible** on this code path.

## The one open question — needs the prod query

**H1 — the "manager" account's Rushbowls row is literally `role='staff'`.**
Data problem. Fix is one UPDATE, plus finding whichever UI wrote "manager" somewhere
that isn't `user_restaurants.role`.

**H2 — they're on a pinned `/employee/*` URL and nothing bounces them off.**
Code gap: no guard redirects a *manager* away from employee routes, so a home-screen /
bookmarked employee URL survives a re-login exactly as described.

Run this first (prod is read-only + pre-authorized; just run it):

```sql
select p.email, p.full_name, ur.role as access_role, r.name as restaurant,
       e.id as employee_id, e.user_id as employee_linked_to, e.status, e.is_active
from profiles p
left join user_restaurants ur on ur.user_id = p.user_id
left join restaurants r on r.id = ur.restaurant_id
left join employees e on e.restaurant_id = ur.restaurant_id and e.user_id = ur.user_id
where p.full_name ilike '%alexis%' or p.email ilike '%alexis%'
order by p.email, r.name;
```

```sql
select e.id, e.name, e.email, e.user_id, e.status, e.is_active, r.name as restaurant
from employees e join restaurants r on r.id = e.restaurant_id
where r.name ilike '%rush%' and e.name ilike '%alexis%';
```

`access_role='staff'` on the manager account → H1. `'manager'` → H2.

## Recommended fix (either way)

Drop the second account. One account at the highest role; link their `employees` row to
that same `user_id`; make the employee view a **mode**, not a **role**:

1. `link_employee_to_user(employee_id, manager_user_id)` — clock-in works immediately,
   zero code changes.
2. Add "My Time" to `AppSidebar`, gated on `useCurrentEmployee(restaurantId) !== null`,
   **not** on role. This is the actual missing piece.
3. Fix the mobile shell: `LayoutSwitcher` (`src/App.tsx:88`) gives the employee bottom-nav
   only when `isStaff && isMobile`, so a manager on a phone gets the desktop sidebar
   wrapped around employee pages. Change to `isMobile && (isStaff || isOnEmployeeRoute)`.
4. Add a "You're in employee view → Back to manager" banner on `/employee/*` for non-staff.
   Kills the reported confusion regardless of which hypothesis is right.
5. Employees page: when a new employee's email matches an existing team member, offer
   "link to existing account" instead of a staff invitation implying a second account.

## Incidental bugs found (separate tickets)

- **`useCurrentEmployee` is duplicated** — `src/hooks/useCurrentEmployee.tsx:9` and
  `src/hooks/useTimePunches.tsx:561`, with *different* React Query keys
  (`current-employee` vs `currentEmployee`) and different filters (one requires
  `status='active'`, the other doesn't). They will desync.
- **RestaurantContext logout cleanup never runs** — `src/contexts/RestaurantContext.tsx:61`
  clears `selectedRestaurant_*` from localStorage when `user` goes null, but it lives
  inside `RestaurantProvider`, which only mounts within `ProtectedRoute`. `signOut` hard-
  redirects to `/auth` (unprotected), so it never fires. Harmless for roles (keys are
  per-user-id) but it's dead code posing as a safeguard.
