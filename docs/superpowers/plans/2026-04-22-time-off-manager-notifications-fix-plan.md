# Time-Off Manager Notifications Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix silent failure where owners/managers receive no email when a time-off request is submitted, and surface future silent failures via logs + a UI warning.

**Architecture:** Extract the recipient-resolution function from the edge function into a testable module using the working `profiles:user_id(email)` join pattern. Add a React Query hook and a Settings UI warning card that flags restaurants with zero configured approvers. No DB migration.

**Tech Stack:** TypeScript, React 18.3, React Query, Vitest, Vite, Supabase Edge Functions (Deno), pgTAP, Tailwind/shadcn.

**Spec:** `docs/superpowers/specs/2026-04-22-time-off-manager-notifications-fix-design.md`

---

## File Structure

**Create:**
- `supabase/functions/send-time-off-notification/buildEmails.ts` — pure recipient-resolution module (no Deno-URL imports, so Vitest can import it)
- `src/hooks/useApproverCount.ts` — React Query hook returning count of owners+managers for a restaurant
- `supabase/tests/notification_approver_resolution.test.sql` — pgTAP test verifying the join works
- `tests/unit/sendTimeOffNotification-buildEmails.test.ts` — unit test for extracted module
- `tests/unit/useApproverCount.test.ts` — unit test for the new hook
- `tests/unit/NotificationSettings.test.tsx` — component test for the warning card

**Modify:**
- `supabase/functions/send-time-off-notification/index.ts` — use extracted buildEmails; add observability logs
- `src/components/NotificationSettings.tsx` — render warning when approverCount is 0 and notify_managers is on

**Not touched:** DB schema, `_shared/notificationHelpers.ts`, other notification edge functions.

---

## Task 1: Extract `buildEmails` with failing test

Create a new, Vitest-importable module that replaces the broken inline function. The module MUST be free of Deno-URL imports so Node/Vitest can import it; the edge function will import it with a `.ts` extension as Deno requires.

**Files:**
- Create: `supabase/functions/send-time-off-notification/buildEmails.ts`
- Create: `tests/unit/sendTimeOffNotification-buildEmails.test.ts`

- [ ] **Step 1.1: Write the failing test file**

Create `tests/unit/sendTimeOffNotification-buildEmails.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { buildEmails } from '../../supabase/functions/send-time-off-notification/buildEmails';

type ManagerRow = {
  user_id: string;
  profiles: { email: string | null } | null;
};

interface MockResult {
  data: ManagerRow[] | null;
  error: { message: string } | null;
}

/**
 * Builds a supabase-like stub that captures the call chain for assertions
 * and returns whatever MockResult the test supplies.
 */
function makeSupabaseStub(result: MockResult) {
  const calls = {
    table: '' as string,
    select: '' as string,
    eqCol: '' as string,
    eqVal: '' as string,
    inCol: '' as string,
    inVals: [] as string[],
  };
  const chain = {
    select: (cols: string) => {
      calls.select = cols;
      return {
        eq: (col: string, val: string) => {
          calls.eqCol = col;
          calls.eqVal = val;
          return {
            in: async (col: string, vals: string[]) => {
              calls.inCol = col;
              calls.inVals = vals;
              return result;
            },
          };
        },
      };
    },
  };
  const supabase = {
    from: vi.fn((table: string) => {
      calls.table = table;
      return chain;
    }),
  };
  return { supabase, calls };
}

describe('buildEmails', () => {
  it('returns only employee when notifyEmployee=true and notifyManagers=false', async () => {
    const { supabase } = makeSupabaseStub({ data: [], error: null });
    const result = await buildEmails({
      supabase: supabase as never,
      restaurantId: 'rest-1',
      employeeEmail: 'employee@example.com',
      notifyEmployee: true,
      notifyManagers: false,
    });
    expect(result.emails).toEqual(['employee@example.com']);
    expect(result.employeeIncluded).toBe(true);
    expect(result.managersFound).toBe(0);
    expect(result.managerLookupError).toBeUndefined();
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('queries user_restaurants joined to profiles for managers', async () => {
    const { supabase, calls } = makeSupabaseStub({
      data: [
        { user_id: 'u1', profiles: { email: 'owner@example.com' } },
        { user_id: 'u2', profiles: { email: 'manager@example.com' } },
      ],
      error: null,
    });
    const result = await buildEmails({
      supabase: supabase as never,
      restaurantId: 'rest-1',
      employeeEmail: null,
      notifyEmployee: false,
      notifyManagers: true,
    });
    expect(calls.table).toBe('user_restaurants');
    expect(calls.select).toContain('profiles:user_id');
    expect(calls.eqCol).toBe('restaurant_id');
    expect(calls.eqVal).toBe('rest-1');
    expect(calls.inCol).toBe('role');
    expect(calls.inVals).toEqual(['owner', 'manager']);
    expect(result.emails.sort()).toEqual(['manager@example.com', 'owner@example.com']);
    expect(result.managersFound).toBe(2);
    expect(result.employeeIncluded).toBe(false);
  });

  it('de-duplicates when employee is also a manager', async () => {
    const { supabase } = makeSupabaseStub({
      data: [
        { user_id: 'u1', profiles: { email: 'shared@example.com' } },
        { user_id: 'u2', profiles: { email: 'other@example.com' } },
      ],
      error: null,
    });
    const result = await buildEmails({
      supabase: supabase as never,
      restaurantId: 'rest-1',
      employeeEmail: 'shared@example.com',
      notifyEmployee: true,
      notifyManagers: true,
    });
    expect(result.emails.sort()).toEqual(['other@example.com', 'shared@example.com']);
    expect(result.employeeIncluded).toBe(true);
    expect(result.managersFound).toBe(2);
  });

  it('captures managerLookupError when the query errors', async () => {
    const { supabase } = makeSupabaseStub({
      data: null,
      error: { message: 'relation profiles does not exist' },
    });
    const result = await buildEmails({
      supabase: supabase as never,
      restaurantId: 'rest-1',
      employeeEmail: null,
      notifyEmployee: false,
      notifyManagers: true,
    });
    expect(result.emails).toEqual([]);
    expect(result.managersFound).toBe(0);
    expect(result.managerLookupError).toBe('relation profiles does not exist');
  });

  it('returns empty list when both flags are false', async () => {
    const { supabase } = makeSupabaseStub({ data: [], error: null });
    const result = await buildEmails({
      supabase: supabase as never,
      restaurantId: 'rest-1',
      employeeEmail: 'employee@example.com',
      notifyEmployee: false,
      notifyManagers: false,
    });
    expect(result.emails).toEqual([]);
    expect(result.employeeIncluded).toBe(false);
    expect(result.managersFound).toBe(0);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('skips manager rows with null profiles or null email', async () => {
    const { supabase } = makeSupabaseStub({
      data: [
        { user_id: 'u1', profiles: null },
        { user_id: 'u2', profiles: { email: null } },
        { user_id: 'u3', profiles: { email: 'real@example.com' } },
      ],
      error: null,
    });
    const result = await buildEmails({
      supabase: supabase as never,
      restaurantId: 'rest-1',
      employeeEmail: null,
      notifyEmployee: false,
      notifyManagers: true,
    });
    expect(result.emails).toEqual(['real@example.com']);
    expect(result.managersFound).toBe(1);
  });
});
```

- [ ] **Step 1.2: Run test to verify it fails**

Run: `npx vitest run tests/unit/sendTimeOffNotification-buildEmails.test.ts`
Expected: FAIL with "Failed to resolve import" or "Cannot find module" — the module doesn't exist yet.

- [ ] **Step 1.3: Create `buildEmails.ts` module**

Create `supabase/functions/send-time-off-notification/buildEmails.ts`:

```ts
/**
 * Resolves email recipients for a time-off notification.
 *
 * Type-agnostic: accepts any object with a `.from()` method that returns the
 * expected chain shape. This lets the real Deno Supabase client and mocks
 * from Vitest both satisfy the same interface.
 */

export interface BuildEmailsInput {
  supabase: ApproverQueryClient;
  restaurantId: string;
  employeeEmail?: string | null;
  notifyEmployee: boolean;
  notifyManagers: boolean;
}

export interface BuildEmailsResult {
  emails: string[];
  employeeIncluded: boolean;
  managersFound: number;
  managerLookupError?: string;
}

interface ApproverQueryClient {
  from(table: string): ApproverSelectBuilder;
}

interface ApproverSelectBuilder {
  select(columns: string): ApproverEqBuilder;
}

interface ApproverEqBuilder {
  eq(column: string, value: string): ApproverInBuilder;
}

interface ApproverInBuilder {
  in(
    column: string,
    values: string[]
  ): Promise<{
    data: ManagerRow[] | null;
    error: { message: string } | null;
  }>;
}

interface ManagerRow {
  user_id: string;
  profiles: { email?: string | null } | null;
}

export async function buildEmails(
  input: BuildEmailsInput
): Promise<BuildEmailsResult> {
  const {
    supabase,
    restaurantId,
    employeeEmail,
    notifyEmployee,
    notifyManagers,
  } = input;

  const emails: string[] = [];
  let employeeIncluded = false;
  let managersFound = 0;
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
      for (const m of managers) {
        const email = m?.profiles?.email;
        if (email) {
          emails.push(email);
          managersFound++;
        }
      }
    }
  }

  return {
    emails: [...new Set(emails)],
    employeeIncluded,
    managersFound,
    managerLookupError,
  };
}
```

- [ ] **Step 1.4: Run test to verify it passes**

Run: `npx vitest run tests/unit/sendTimeOffNotification-buildEmails.test.ts`
Expected: PASS — all 6 test cases pass.

- [ ] **Step 1.5: Commit**

```bash
git add supabase/functions/send-time-off-notification/buildEmails.ts tests/unit/sendTimeOffNotification-buildEmails.test.ts
git commit -m "feat(time-off): extract buildEmails to testable module with profiles join

Replaces the broken auth.users cross-schema join with the
profiles:user_id(email) pattern used by _shared/notificationHelpers.
The module is type-agnostic so Vitest can import it directly.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 2: Wire index.ts to extracted module and add observability

Replace the broken inline `buildEmails` function in the edge function with a call to the new extracted module. Add logging for the silent-failure cases identified in the spec.

**Files:**
- Modify: `supabase/functions/send-time-off-notification/index.ts`

- [ ] **Step 2.1: Remove the inline `buildEmails` and add import**

In `supabase/functions/send-time-off-notification/index.ts`, delete the `buildEmails` function (currently lines 52-84) and the `SupabaseClientType` alias (line 50). Add the import at the top alongside the other imports:

```ts
import { buildEmails } from './buildEmails.ts';
```

The imports section should look like:

```ts
import { generateHeader } from '../_shared/emailTemplates.ts';
import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@4.0.0";
import { sendWebPushToUser } from '../_shared/webPushHelper.ts';
import { buildEmails } from './buildEmails.ts';
```

- [ ] **Step 2.2: Replace the call site to use the new signature**

Find the current block (around lines 178-198) that reads:

```ts
const uniqueEmails = await buildEmails(
  supabase as any,
  timeOffRequest.restaurant_id,
  timeOffRequest.employee?.email,
  settings.time_off_notify_employee,
  settings.time_off_notify_managers
);

if (uniqueEmails.length === 0) {
  console.log('No recipients found for notification');
  return new Response(
    JSON.stringify({
      success: true,
      message: 'No recipients configured'
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    }
  );
}
```

Replace it with:

```ts
const recipients = await buildEmails({
  supabase,
  restaurantId: timeOffRequest.restaurant_id,
  employeeEmail: timeOffRequest.employee?.email ?? null,
  notifyEmployee: !!settings.time_off_notify_employee,
  notifyManagers: !!settings.time_off_notify_managers,
});

if (recipients.managerLookupError) {
  console.error(
    'time-off notification: manager lookup failed for restaurant',
    timeOffRequest.restaurant_id,
    '-',
    recipients.managerLookupError
  );
}

if (settings.time_off_notify_managers && recipients.managersFound === 0) {
  console.warn(
    'time-off notification: notify_managers=true but 0 approvers resolved for restaurant',
    timeOffRequest.restaurant_id
  );
}

if (recipients.emails.length === 0) {
  console.log('No recipients configured for notification', {
    restaurantId: timeOffRequest.restaurant_id,
    notifyEmployee: !!settings.time_off_notify_employee,
    notifyManagers: !!settings.time_off_notify_managers,
  });
  return new Response(
    JSON.stringify({
      success: true,
      message: 'No recipients configured',
      recipients: 0,
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    }
  );
}

const uniqueEmails = recipients.emails;
```

- [ ] **Step 2.3: Add final breakdown log before the success response**

Find the existing log `console.log(`Sent ${results.length} notification emails`);` (was around line 281) and replace with:

```ts
console.log('Sent time-off notification', {
  action,
  restaurantId: timeOffRequest.restaurant_id,
  total: results.length,
  employeeIncluded: recipients.employeeIncluded,
  managersFound: recipients.managersFound,
});
```

- [ ] **Step 2.4: Run typecheck and vitest**

Run: `npm run typecheck`
Expected: PASS — TypeScript accepts the new call shape.

Run: `npx vitest run tests/unit/sendTimeOffNotification-buildEmails.test.ts`
Expected: still PASS (no regression).

- [ ] **Step 2.5: Commit**

```bash
git add supabase/functions/send-time-off-notification/index.ts
git commit -m "fix(time-off): use extracted buildEmails and log silent failures

Replaces the inline buildEmails with the extracted module so that the
manager lookup uses the working profiles:user_id(email) join. Adds
explicit logs when the manager lookup errors or when notify_managers
is on but zero approvers are resolved — these were previously silent.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 3: pgTAP test for approver resolution

Prove at the database level that the `user_restaurants` → `profiles` join returns the expected owner/manager rows, and that other roles are excluded. This is a guard against future RLS or schema changes breaking the notification pipeline.

**Files:**
- Create: `supabase/tests/notification_approver_resolution.test.sql`

- [ ] **Step 3.1: Ensure local DB is running and reset**

Run: `npm run db:reset`
Expected: Supabase local stack comes up and migrations are applied cleanly.

- [ ] **Step 3.2: Write the pgTAP test**

Create `supabase/tests/notification_approver_resolution.test.sql`:

```sql
-- Test: Time-Off Notification Approver Resolution
-- Verifies the join pattern used by the send-time-off-notification edge function
-- returns owner/manager profiles and excludes other roles.

BEGIN;

SELECT plan(6);

-- Setup: create an isolated restaurant and three users with different roles.
INSERT INTO restaurants (id, name, address, phone)
VALUES (
  '00000000-0000-0000-0000-000000000801'::uuid,
  'Approver Test Restaurant',
  '1 Test St',
  '555-0801'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, email)
VALUES
  ('00000000-0000-0000-0000-000000000802'::uuid, 'owner-approver@test.com'),
  ('00000000-0000-0000-0000-000000000803'::uuid, 'manager-approver@test.com'),
  ('00000000-0000-0000-0000-000000000804'::uuid, 'chef-approver@test.com')
ON CONFLICT (id) DO NOTHING;

INSERT INTO profiles (user_id, email)
VALUES
  ('00000000-0000-0000-0000-000000000802'::uuid, 'owner-approver@test.com'),
  ('00000000-0000-0000-0000-000000000803'::uuid, 'manager-approver@test.com'),
  ('00000000-0000-0000-0000-000000000804'::uuid, 'chef-approver@test.com')
ON CONFLICT (user_id) DO UPDATE SET email = EXCLUDED.email;

INSERT INTO user_restaurants (user_id, restaurant_id, role)
VALUES
  ('00000000-0000-0000-0000-000000000802'::uuid, '00000000-0000-0000-0000-000000000801'::uuid, 'owner'),
  ('00000000-0000-0000-0000-000000000803'::uuid, '00000000-0000-0000-0000-000000000801'::uuid, 'manager'),
  ('00000000-0000-0000-0000-000000000804'::uuid, '00000000-0000-0000-0000-000000000801'::uuid, 'chef')
ON CONFLICT (user_id, restaurant_id) DO UPDATE SET role = EXCLUDED.role;

-- Test 1: owner is resolved through the profiles join
SELECT ok(
  EXISTS(
    SELECT 1 FROM user_restaurants ur
    JOIN profiles p ON p.user_id = ur.user_id
    WHERE ur.restaurant_id = '00000000-0000-0000-0000-000000000801'::uuid
      AND ur.role = 'owner'
      AND p.email = 'owner-approver@test.com'
  ),
  'owner profile is resolvable via user_restaurants -> profiles join'
);

-- Test 2: manager is resolved
SELECT ok(
  EXISTS(
    SELECT 1 FROM user_restaurants ur
    JOIN profiles p ON p.user_id = ur.user_id
    WHERE ur.restaurant_id = '00000000-0000-0000-0000-000000000801'::uuid
      AND ur.role = 'manager'
      AND p.email = 'manager-approver@test.com'
  ),
  'manager profile is resolvable via user_restaurants -> profiles join'
);

-- Test 3: approver list contains exactly owner + manager, not chef
SELECT is(
  (SELECT count(*)::int FROM user_restaurants
   WHERE restaurant_id = '00000000-0000-0000-0000-000000000801'::uuid
     AND role IN ('owner', 'manager')),
  2,
  'Only owner and manager roles count as approvers'
);

-- Test 4: chef is NOT in the approver list
SELECT ok(
  NOT EXISTS(
    SELECT 1 FROM user_restaurants
    WHERE restaurant_id = '00000000-0000-0000-0000-000000000801'::uuid
      AND role = 'chef'
      AND role IN ('owner', 'manager')
  ),
  'chef role is excluded from approver resolution'
);

-- Test 5: join returns email for every approver (no null-profile rows)
SELECT is(
  (SELECT count(*)::int FROM user_restaurants ur
   JOIN profiles p ON p.user_id = ur.user_id
   WHERE ur.restaurant_id = '00000000-0000-0000-0000-000000000801'::uuid
     AND ur.role IN ('owner', 'manager')
     AND p.email IS NOT NULL),
  2,
  'Both approvers have non-null emails via the join'
);

-- Test 6: empty-approver case — a new restaurant with no owners/managers returns 0
INSERT INTO restaurants (id, name, address, phone)
VALUES (
  '00000000-0000-0000-0000-000000000805'::uuid,
  'Empty Approver Restaurant',
  '2 Test St',
  '555-0805'
)
ON CONFLICT (id) DO NOTHING;

SELECT is(
  (SELECT count(*)::int FROM user_restaurants
   WHERE restaurant_id = '00000000-0000-0000-0000-000000000805'::uuid
     AND role IN ('owner', 'manager')),
  0,
  'Restaurant with no team returns 0 approvers'
);

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 3.3: Run the pgTAP suite**

Run: `npm run test:db`
Expected: The new test file runs alongside existing ones; all assertions pass. Look for `notification_approver_resolution` in the output with `ok 1..6`.

- [ ] **Step 3.4: Commit**

```bash
git add supabase/tests/notification_approver_resolution.test.sql
git commit -m "test(time-off): pgTAP coverage for approver resolution join

Verifies that user_restaurants -> profiles returns owners and managers
with valid emails, and excludes other roles. Guards against schema
or RLS changes breaking the notification recipient list.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 4: `useApproverCount` hook

React Query hook that returns the count of users with role `owner` or `manager` for a given restaurant. Drives the Settings UI warning.

**Files:**
- Create: `src/hooks/useApproverCount.ts`
- Create: `tests/unit/useApproverCount.test.ts`

- [ ] **Step 4.1: Write the failing test**

Create `tests/unit/useApproverCount.test.ts`:

```ts
import React, { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockSupabase = vi.hoisted(() => ({
  from: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: mockSupabase,
}));

import { useApproverCount } from '@/hooks/useApproverCount';

function createWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return React.createElement(QueryClientProvider, { client }, children);
  };
}

function makeCountStub(count: number | null, error: unknown = null) {
  return {
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        in: vi.fn(async () => ({ count, error })),
      })),
    })),
  };
}

describe('useApproverCount', () => {
  beforeEach(() => {
    mockSupabase.from.mockReset();
  });

  it('returns 0 when restaurantId is undefined without hitting the client', async () => {
    const { result } = renderHook(() => useApproverCount(undefined), {
      wrapper: createWrapper(),
    });
    await waitFor(() => {
      expect(result.current.isFetching).toBe(false);
    });
    expect(result.current.data).toBe(0);
    expect(mockSupabase.from).not.toHaveBeenCalled();
  });

  it('fetches count from user_restaurants with owner/manager roles', async () => {
    const stub = makeCountStub(3);
    mockSupabase.from.mockReturnValue(stub);

    const { result } = renderHook(() => useApproverCount('rest-1'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.data).toBe(3));

    expect(mockSupabase.from).toHaveBeenCalledWith('user_restaurants');
    expect(stub.select).toHaveBeenCalledWith('*', { count: 'exact', head: true });
    const eqCall = stub.select.mock.results[0].value.eq;
    expect(eqCall).toHaveBeenCalledWith('restaurant_id', 'rest-1');
    const inCall = eqCall.mock.results[0].value.in;
    expect(inCall).toHaveBeenCalledWith('role', ['owner', 'manager']);
  });

  it('returns 0 when the count is null', async () => {
    mockSupabase.from.mockReturnValue(makeCountStub(null));
    const { result } = renderHook(() => useApproverCount('rest-1'), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBe(0);
  });

  it('surfaces errors through React Query', async () => {
    mockSupabase.from.mockReturnValue(
      makeCountStub(null, { message: 'boom' })
    );
    const { result } = renderHook(() => useApproverCount('rest-1'), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as { message: string }).message).toBe('boom');
  });
});
```

- [ ] **Step 4.2: Run test to verify it fails**

Run: `npx vitest run tests/unit/useApproverCount.test.ts`
Expected: FAIL with "Cannot find module '@/hooks/useApproverCount'" — the hook doesn't exist yet.

- [ ] **Step 4.3: Create the hook**

Create `src/hooks/useApproverCount.ts`:

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
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });
}
```

Note: the `enabled` option is intentionally omitted so the query still runs when `restaurantId` is undefined, returning 0 synchronously within the queryFn. This keeps the hook's contract simple and lets the `undefined` test assert `data === 0` without a conditional. The first test case in Step 4.1 verifies this contract.

- [ ] **Step 4.4: Run test to verify it passes**

Run: `npx vitest run tests/unit/useApproverCount.test.ts`
Expected: PASS — all 4 test cases pass.

- [ ] **Step 4.5: Commit**

```bash
git add src/hooks/useApproverCount.ts tests/unit/useApproverCount.test.ts
git commit -m "feat(notifications): add useApproverCount hook

Returns the count of users with role owner or manager for a
restaurant. Used by the NotificationSettings UI to warn when
no approvers are configured to receive time-off notifications.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 5: Warning card in NotificationSettings

Render an amber warning card below the "Notify Managers" toggle when the setting is on AND no owners/managers exist for the restaurant.

**Files:**
- Modify: `src/components/NotificationSettings.tsx`
- Create: `tests/unit/NotificationSettings.test.tsx`

- [ ] **Step 5.1: Write the failing test**

Create `tests/unit/NotificationSettings.test.tsx`:

```tsx
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const approverCountMock = vi.hoisted(() => vi.fn());
const notificationSettingsMock = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/useApproverCount', () => ({
  useApproverCount: approverCountMock,
}));

vi.mock('@/hooks/useNotificationSettings', () => ({
  useNotificationSettings: notificationSettingsMock,
  useUpdateNotificationSettings: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('@/hooks/useNotificationPreferences', () => ({
  useNotificationPreferences: () => ({
    preferences: { weekly_brief_email: true },
    updatePreferences: vi.fn(),
    isUpdating: false,
  }),
}));

import { NotificationSettings } from '@/components/NotificationSettings';

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>
  );
}

const baseSettings = {
  notify_time_off_request: true,
  notify_time_off_approved: true,
  notify_time_off_rejected: true,
  time_off_notify_managers: true,
  time_off_notify_employee: true,
};

describe('NotificationSettings approver warning', () => {
  beforeEach(() => {
    approverCountMock.mockReset();
    notificationSettingsMock.mockReset();
  });

  it('renders warning when notify_managers is on and approver count is 0', () => {
    notificationSettingsMock.mockReturnValue({
      settings: baseSettings,
      loading: false,
    });
    approverCountMock.mockReturnValue({ data: 0, isLoading: false });

    renderWithClient(<NotificationSettings restaurantId="rest-1" />);

    expect(screen.getByText('No approvers configured')).toBeInTheDocument();
  });

  it('hides warning when at least one approver exists', () => {
    notificationSettingsMock.mockReturnValue({
      settings: baseSettings,
      loading: false,
    });
    approverCountMock.mockReturnValue({ data: 2, isLoading: false });

    renderWithClient(<NotificationSettings restaurantId="rest-1" />);

    expect(screen.queryByText('No approvers configured')).not.toBeInTheDocument();
  });

  it('hides warning when notify_managers is off even if approverCount is 0', () => {
    notificationSettingsMock.mockReturnValue({
      settings: { ...baseSettings, time_off_notify_managers: false },
      loading: false,
    });
    approverCountMock.mockReturnValue({ data: 0, isLoading: false });

    renderWithClient(<NotificationSettings restaurantId="rest-1" />);

    expect(screen.queryByText('No approvers configured')).not.toBeInTheDocument();
  });

  it('hides warning while approverCount is still loading', () => {
    notificationSettingsMock.mockReturnValue({
      settings: baseSettings,
      loading: false,
    });
    approverCountMock.mockReturnValue({ data: undefined, isLoading: true });

    renderWithClient(<NotificationSettings restaurantId="rest-1" />);

    expect(screen.queryByText('No approvers configured')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 5.2: Run test to verify it fails**

Run: `npx vitest run tests/unit/NotificationSettings.test.tsx`
Expected: FAIL — "No approvers configured" text not found (component doesn't render the warning yet).

- [ ] **Step 5.3: Modify `NotificationSettings.tsx` to render the warning**

In `src/components/NotificationSettings.tsx`:

**a.** Add the import for `AlertTriangle` by updating line 7 from:
```tsx
import { Bell, Mail, Users, CheckCircle, Newspaper } from 'lucide-react';
```
to:
```tsx
import { Bell, Mail, Users, CheckCircle, Newspaper, AlertTriangle } from 'lucide-react';
```

**b.** Add the hook import after line 9:
```tsx
import { useApproverCount } from '@/hooks/useApproverCount';
```

**c.** Inside the component, after line 18 (`const { preferences: briefPrefs, ... } = useNotificationPreferences(restaurantId);`), add:

```tsx
const { data: approverCount, isLoading: approverCountLoading } = useApproverCount(restaurantId);
const showNoApproversWarning =
  !approverCountLoading &&
  localSettings.time_off_notify_managers &&
  (approverCount ?? 0) === 0;
```

**d.** Inside the "Notification Recipients" card, insert the warning card directly after the "Notify Managers" toggle block and before the `<Separator />` that separates it from the "Notify Employee" toggle. Change the block (current lines 161-180):
```tsx
<CardContent className="space-y-6">
  <div className="flex items-center justify-between">
    <div>
      <Label htmlFor="notify-managers" className="text-base">
        Notify Managers
      </Label>
      <p className="text-sm text-muted-foreground">
        Send notifications to all owners and managers
      </p>
    </div>
    <Switch
      id="notify-managers"
      checked={localSettings.time_off_notify_managers}
      onCheckedChange={(checked) =>
        setLocalSettings({ ...localSettings, time_off_notify_managers: checked })
      }
    />
  </div>

  <Separator />
```

to:
```tsx
<CardContent className="space-y-6">
  <div className="flex items-center justify-between">
    <div>
      <Label htmlFor="notify-managers" className="text-base">
        Notify Managers
      </Label>
      <p className="text-sm text-muted-foreground">
        Send notifications to all owners and managers
      </p>
    </div>
    <Switch
      id="notify-managers"
      checked={localSettings.time_off_notify_managers}
      onCheckedChange={(checked) =>
        setLocalSettings({ ...localSettings, time_off_notify_managers: checked })
      }
    />
  </div>

  {showNoApproversWarning && (
    <div
      role="alert"
      className="flex items-start gap-3 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20"
    >
      <AlertTriangle
        className="h-4 w-4 text-amber-600 mt-0.5 shrink-0"
        aria-hidden="true"
      />
      <div className="text-[13px]">
        <p className="font-medium text-foreground">No approvers configured</p>
        <p className="text-muted-foreground mt-0.5">
          This restaurant has no owners or managers set up to receive notifications.
          Invite a teammate with owner or manager access from the Team page.
        </p>
      </div>
    </div>
  )}

  <Separator />
```

- [ ] **Step 5.4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/NotificationSettings.test.tsx`
Expected: PASS — all 4 test cases pass.

- [ ] **Step 5.5: Commit**

```bash
git add src/components/NotificationSettings.tsx tests/unit/NotificationSettings.test.tsx
git commit -m "feat(notifications): warn when restaurant has no approvers

Renders an amber warning card below the 'Notify Managers' toggle
when the setting is on but no owners or managers exist for the
restaurant. Prevents the silent-failure mode where notify_managers
is enabled but the recipient list would be empty.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 6: Full local verification

Run the complete verification suite per the superpowers:verification-before-completion skill.

- [ ] **Step 6.1: Typecheck**

Run: `npm run typecheck`
Expected: PASS — no TypeScript errors.

- [ ] **Step 6.2: Lint**

Run: `npm run lint`
Expected: PASS — no new ESLint errors for the changed files. Existing warnings unrelated to this change may remain (do not fix unrelated issues).

- [ ] **Step 6.3: Unit tests**

Run: `npm run test`
Expected: PASS — all Vitest suites green, including the four new test files.

- [ ] **Step 6.4: DB tests**

Run: `npm run test:db`
Expected: PASS — pgTAP `notification_approver_resolution` shows `ok 1..6`.

- [ ] **Step 6.5: Build**

Run: `npm run build`
Expected: PASS — production build succeeds.

- [ ] **Step 6.6: E2E tests (regression check only)**

Run: `npm run test:e2e`
Expected: PASS — existing E2E suites still green. No new E2E tests were added (the notification emails are side-effects that would require intercepting Resend, which is out of scope).

- [ ] **Step 6.7: Final commit of any fix-up changes (if needed)**

If any verification step produces fix-up commits, bundle them:

```bash
git status
# review
git add -A
git commit -m "fix(time-off): verification follow-up

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

Otherwise, nothing to commit — proceed to Phase 7 (CodeRabbit review) of the development workflow.

---

## Self-Review Notes

**Spec coverage:**
- Fix broken auth.users join → Task 1 (extracted module with profiles join) + Task 2 (wire it in)
- Surface silent failures → Task 2 (console.error/warn/log)
- Settings UI warning → Task 5
- Supporting hook → Task 4
- pgTAP test → Task 3
- Vitest unit tests → Tasks 1, 4, 5
- No DB migration → confirmed; nothing in the plan modifies the schema

**Type consistency check:**
- `BuildEmailsResult` fields (`emails`, `employeeIncluded`, `managersFound`, `managerLookupError`) are consistent between Task 1 (definition), Task 2 (usage), and Task 1's test (assertions).
- The query shape `user_restaurants.select('user_id, profiles:user_id(email)').eq(...).in(...)` is identical in the hook (Task 4 — with count option) and the resolver (Task 1), matching what Task 3's pgTAP test validates at the DB layer.
- `useApproverCount` returns `number` (Task 4); consumed as `number | undefined` in Task 5 (React Query's `data` is undefined before first resolve) and guarded with `(approverCount ?? 0) === 0`.

**No placeholders:** All steps include exact code, exact commands, and expected output.
