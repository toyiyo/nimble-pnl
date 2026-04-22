# Time-Off "Notify Managers" Fix + Observability

**Date:** 2026-04-22
**Status:** Design approved, ready for plan
**Owner:** jose.delgado@easyshifthq.com

## Problem

When employees submit time-off requests, the employee receives a notification email but owners/managers do not — even when the "Notify Managers" toggle is enabled on the restaurant's Notification Settings page.

The setting label is "Send notifications to all owners and managers." The logic intent is correct: when `time_off_notify_managers=true`, everyone in `user_restaurants` with role `owner` or `manager` for that restaurant should receive the email.

## Root Cause

In `supabase/functions/send-time-off-notification/index.ts`, the `buildEmails()` helper queries managers with a broken cross-schema join:

```ts
// Current (broken)
.from('user_restaurants')
.select(`user:auth.users(email)`)
.eq('restaurant_id', restaurantId)
.in('role', ['owner', 'manager']);
```

PostgREST does not expose the `auth` schema for joined selects this way. The query silently returns an error or empty rows. The calling code then silently ignores the error:

```ts
if (!managersError && managers) {      // no else — error is swallowed
  managers.forEach(...);
}
```

The shared helper `_shared/notificationHelpers.ts::getManagerEmails` already uses the correct pattern (`profiles:user_id(email)` — public schema). Every other notification edge function uses that helper. The time-off function does not.

**Observable effect:** The function returns `success: true, recipients: 1` (employee only). The frontend shows green. No error surfaces anywhere.

## Goal

1. Owners and managers receive time-off notification emails when `time_off_notify_managers=true`.
2. Silent failures of the recipient-resolution path become visible (logs + UI warning).
3. The Settings page surfaces when a restaurant has no one with approval powers to receive these notifications.

## Non-Goals

- Redesigning the notification settings schema.
- Refactoring every notification edge function to use the shared helper (a broader cleanup task).
- Adding a "Manager" designation to the `employees` table. Approval powers remain role-based on `user_restaurants`.
- Adding per-recipient opt-out. Restaurant-level settings already exist; per-user preferences are out of scope.

## Architecture

Three coordinated changes. No DB migration.

```
[1] Edge function fix
    supabase/functions/send-time-off-notification/index.ts
    - Replace buildEmails() manager query: profiles:user_id(email)
    - Log managerError when it fires (stop swallowing)
    - Log recipient breakdown (employee/managers/total)
    - Extract buildEmails to a separate module so it can be unit-tested

[2] Settings UI warning
    src/components/NotificationSettings.tsx
    - Amber warning card shown when notify_managers toggle is on AND
      restaurant has 0 users with role ∈ {owner, manager}

[3] Supporting hook
    src/hooks/useApproverCount.ts  (new, small)
    - React Query: SELECT count(*) FROM user_restaurants
      WHERE restaurant_id = $1 AND role IN ('owner','manager')
    - 60s staleTime, refetchOnWindowFocus
```

## Component Detail

### 1. `supabase/functions/send-time-off-notification/index.ts`

Extract `buildEmails` into a new module `supabase/functions/send-time-off-notification/buildEmails.ts`:

```ts
// buildEmails.ts
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface BuildEmailsInput {
  supabase: SupabaseClient;
  restaurantId: string;
  employeeEmail?: string | null;
  notifyEmployee: boolean;
  notifyManagers: boolean;
}

export interface BuildEmailsResult {
  emails: string[];          // de-duplicated recipient list
  employeeIncluded: boolean; // true if employee email was added
  managerCount: number;      // number of owner/manager recipients added
  managerLookupError?: string;
}

export async function buildEmails(input: BuildEmailsInput): Promise<BuildEmailsResult> {
  const { supabase, restaurantId, employeeEmail, notifyEmployee, notifyManagers } = input;
  const emails: string[] = [];
  let employeeIncluded = false;
  let managerCount = 0;
  let managerLookupError: string | undefined;

  if (notifyEmployee && employeeEmail) {
    emails.push(employeeEmail);
    employeeIncluded = true;
  }

  if (notifyManagers) {
    const { data: managers, error } = await supabase
      .from('user_restaurants')
      .select('user_id, profiles:user_id(email)')
      .eq('restaurant_id', restaurantId)
      .in('role', ['owner', 'manager']);

    if (error) {
      managerLookupError = error.message;
    } else if (managers) {
      for (const m of managers as Array<{ profiles?: { email?: string } | null }>) {
        const email = m?.profiles?.email;
        if (email) {
          emails.push(email);
          managerCount++;
        }
      }
    }
  }

  return {
    emails: [...new Set(emails)],
    employeeIncluded,
    managerCount,
    managerLookupError,
  };
}
```

In `index.ts`, replace the existing inline `buildEmails` call site:

```ts
const result = await buildEmails({
  supabase,
  restaurantId: timeOffRequest.restaurant_id,
  employeeEmail: timeOffRequest.employee?.email,
  notifyEmployee: !!settings.time_off_notify_employee,
  notifyManagers: !!settings.time_off_notify_managers,
});

if (result.managerLookupError) {
  console.error('Manager lookup failed:', result.managerLookupError);
}

if (settings.time_off_notify_managers && result.managerCount === 0) {
  console.warn(
    `time-off notification: notify_managers=true but 0 approvers resolved for restaurant ${timeOffRequest.restaurant_id}`
  );
}

if (result.emails.length === 0) {
  console.log('No recipients configured for notification');
  return successResponse({ message: 'No recipients configured', recipients: 0 });
}

// ... send emails using result.emails ...

console.log(
  `Sent notification: employee=${result.employeeIncluded}, managers=${result.managerCount}, total=${result.emails.length}`
);
```

### 2. `src/hooks/useApproverCount.ts` (new)

```ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export function useApproverCount(restaurantId: string | undefined) {
  return useQuery({
    queryKey: ['approver-count', restaurantId],
    queryFn: async () => {
      if (!restaurantId) return 0;
      const { count, error } = await supabase
        .from('user_restaurants')
        .select('*', { count: 'exact', head: true })
        .eq('restaurant_id', restaurantId)
        .in('role', ['owner', 'manager']);
      if (error) throw error;
      return count ?? 0;
    },
    enabled: !!restaurantId,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });
}
```

### 3. `src/components/NotificationSettings.tsx` — warning card

Inside the "Notification Recipients" card, directly below the "Notify Managers" toggle row:

```tsx
import { AlertTriangle } from 'lucide-react';
import { useApproverCount } from '@/hooks/useApproverCount';

// inside component:
const { data: approverCount = 0 } = useApproverCount(restaurantId);

// render (below notify_managers toggle):
{settings.time_off_notify_managers && approverCount === 0 && (
  <div className="flex items-start gap-3 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
    <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" aria-hidden="true" />
    <div className="text-[13px]">
      <p className="font-medium text-foreground">No approvers configured</p>
      <p className="text-muted-foreground mt-0.5">
        This restaurant has no owners or managers set up to receive notifications.
        Invite a teammate with owner or manager access from the Team page.
      </p>
    </div>
  </div>
)}
```

Styling follows CLAUDE.md's "AI suggestion panel" amber-warning pattern (`bg-amber-500/10 border-amber-500/20`, `rounded-lg`, `text-[13px]`).

## Data Flow (happy path, after fix)

```
Employee submits time-off request
  → useCreateTimeOffRequest INSERT → time_off_requests (status: 'pending')
  → invoke('send-time-off-notification', { timeOffRequestId, action: 'created' })

     edge function:
       load time_off_request + employee(name, email, user_id)
       load restaurant.name
       load notification_settings (or hard-coded defaults)
       shouldNotify for action? → yes (notify_time_off_request)
       buildEmails({
         employeeEmail,
         notifyEmployee:  settings.time_off_notify_employee,
         notifyManagers:  settings.time_off_notify_managers,
       })
         → if notify_employee && employeeEmail:   emails += employeeEmail
         → if notify_managers:
              SELECT user_id, profiles:user_id(email)
              FROM user_restaurants
              WHERE restaurant_id = $1 AND role IN ('owner','manager')
              emails += profiles.email for each row with an email
       → dedupe via Set
       → return { emails, employeeIncluded, managerCount, managerLookupError? }

       if managerLookupError       → console.error
       if notifyManagers && managerCount === 0 → console.warn
       if emails.length === 0       → early return { recipients: 0 }

       send each email via Resend.emails.send()
       log final counts
       return { success: true, recipients: emails.length }
```

Same sequence for `approved`/`rejected` actions (plus the existing send-push-notification branch to the employee).

## Error Handling

| Failure | Before | After |
|---|---|---|
| Cross-schema join broken | silent, 0 managers emailed | query fixed; returns rows |
| `managerError` non-null | silently ignored | `console.error` with message |
| `notify_managers=true` but 0 approvers exist | silent `success: true` | `console.warn` in function log; amber warning on Settings UI |
| No recipients at all (both toggles off, or no data) | `success: true, "No recipients configured"` | unchanged — this is a valid state |
| Resend API fails | caught, thrown as 500 | unchanged |

## Testing

### pgTAP — `supabase/tests/notification_approver_resolution.test.sql`

```sql
BEGIN;
SELECT plan(3);

-- Setup: restaurant with owner, manager, chef; profiles populated
-- (uses standard pgTAP test fixtures)

-- Test 1: owner is resolved
SELECT ok(
  EXISTS(
    SELECT 1 FROM user_restaurants ur
    JOIN profiles p ON p.user_id = ur.user_id
    WHERE ur.restaurant_id = :restaurant_id AND ur.role = 'owner' AND p.email IS NOT NULL
  ),
  'Owner with profile email is resolvable via the notification join'
);

-- Test 2: manager is resolved
SELECT ok(
  EXISTS(
    SELECT 1 FROM user_restaurants ur
    JOIN profiles p ON p.user_id = ur.user_id
    WHERE ur.restaurant_id = :restaurant_id AND ur.role = 'manager' AND p.email IS NOT NULL
  ),
  'Manager with profile email is resolvable'
);

-- Test 3: chef and other roles excluded
SELECT is(
  (SELECT count(*) FROM user_restaurants
   WHERE restaurant_id = :restaurant_id
     AND role IN ('owner','manager')),
  2::bigint,
  'Only owner and manager roles are counted as approvers'
);

SELECT * FROM finish();
ROLLBACK;
```

### Vitest — `tests/unit/sendTimeOffNotification-buildEmails.test.ts`

Import the extracted `buildEmails` module with a mocked Supabase client:

1. `notifyEmployee=true, notifyManagers=false, employeeEmail='e@x'` → `emails=['e@x']`, employeeIncluded=true, managerCount=0
2. `notifyEmployee=false, notifyManagers=true` with 2 manager rows → `emails` = 2 manager emails, managerCount=2
3. Both true, employee email also appears in manager list → de-duplicated to 2 addresses (not 3)
4. `notifyManagers=true` but query returns `{ error }` → `managerLookupError` populated, emails empty, managerCount=0
5. Both false → `emails=[]`
6. Manager row missing `profiles.email` (null) → skipped silently, not counted

### Vitest — `tests/unit/NotificationSettings-approverWarning.test.tsx`

1. Toggle on + `useApproverCount → 0` → warning card renders
2. Toggle on + `useApproverCount → 1` → warning card does NOT render
3. Toggle off + `useApproverCount → 0` → warning card does NOT render

## Files Changed

**New:**
- `supabase/functions/send-time-off-notification/buildEmails.ts`
- `src/hooks/useApproverCount.ts`
- `supabase/tests/notification_approver_resolution.test.sql`
- `tests/unit/sendTimeOffNotification-buildEmails.test.ts`
- `tests/unit/NotificationSettings-approverWarning.test.tsx`

**Modified:**
- `supabase/functions/send-time-off-notification/index.ts` — use extracted buildEmails; add logs
- `src/components/NotificationSettings.tsx` — render warning card conditionally

**Not touched:**
- DB schema / migrations
- `_shared/notificationHelpers.ts`
- Other notification edge functions

## Rollout

- Single PR, no flags.
- No DB migration; `profiles` already populated.
- Existing restaurants with approvers start receiving notifications immediately after edge function redeploy.
- Restaurants with no approvers will see the new amber warning on their Settings page on next visit.

## Open Questions

None — design approved conversationally on 2026-04-22.
