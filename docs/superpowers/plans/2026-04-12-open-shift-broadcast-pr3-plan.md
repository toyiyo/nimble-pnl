# Open Shift Broadcast PR3 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Managers can broadcast open shifts to all active employees via push notification and email.

**Architecture:** A "Broadcast" button on the scheduling page opens a confirmation dialog. On confirm, it calls a new `broadcast-open-shifts` edge function that sends web push notifications (via `sendWebPushToUser`) and emails (via Resend) to all active employees, then stamps the publication with the broadcast timestamp.

**Tech Stack:** PostgreSQL migration, Deno edge function, TypeScript/React, React Query, Vitest, pgTAP, Playwright

**Design spec:** `docs/superpowers/specs/2026-04-12-open-shift-broadcast-pr3-design.md`

**IMPORTANT:** Before writing any Supabase query, verify actual table/column names via `npx supabase db dump --local --schema public 2>&1 | grep -A 20 "CREATE TABLE.*<table_name>"`. Never trust plan text for column names.

---

## File Structure

| File | Responsibility |
|------|---------------|
| `supabase/migrations/YYYYMMDD_add_broadcast_to_publications.sql` | Add broadcast columns |
| `supabase/tests/broadcast_open_shifts.test.sql` | pgTAP tests |
| `supabase/functions/broadcast-open-shifts/index.ts` | Edge function: send notifications |
| `src/hooks/useBroadcastOpenShifts.ts` | Mutation hook for broadcast |
| `src/components/scheduling/BroadcastOpenShiftsDialog.tsx` | Confirmation dialog |
| `src/pages/Scheduling.tsx` | Add broadcast button |
| `src/hooks/useSchedulePublish.tsx` | Update to return broadcast columns |
| `tests/unit/broadcastOpenShifts.test.ts` | Unit tests |
| `tests/e2e/broadcast-open-shifts.spec.ts` | E2E test |

---

### Task 1: Database migration — add broadcast columns

**Files:**
- Create: `supabase/migrations/YYYYMMDD_add_broadcast_to_publications.sql`
- Create: `supabase/tests/broadcast_open_shifts.test.sql`

- [ ] **Step 1: Write pgTAP test**

Create `supabase/tests/broadcast_open_shifts.test.sql`:

```sql
BEGIN;
SELECT plan(4);

SELECT has_column('schedule_publications', 'open_shifts_broadcast_at',
  'schedule_publications should have open_shifts_broadcast_at column');

SELECT has_column('schedule_publications', 'open_shifts_broadcast_by',
  'schedule_publications should have open_shifts_broadcast_by column');

SELECT col_is_null('schedule_publications', 'open_shifts_broadcast_at',
  'open_shifts_broadcast_at should be nullable');

SELECT col_is_null('schedule_publications', 'open_shifts_broadcast_by',
  'open_shifts_broadcast_by should be nullable');

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:db`
Expected: FAIL — columns don't exist.

- [ ] **Step 3: Write the migration**

Run `npx supabase migration new add_broadcast_to_publications` then write:

```sql
-- Track when open shifts were broadcast for each published week
ALTER TABLE schedule_publications
  ADD COLUMN IF NOT EXISTS open_shifts_broadcast_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS open_shifts_broadcast_by UUID REFERENCES auth.users(id);
```

- [ ] **Step 4: Reset DB and run tests**

Run: `npx supabase db reset && npm run test:db`
Expected: All pgTAP tests pass.

- [ ] **Step 5: Regenerate types**

Run: `npx supabase gen types typescript --local 2>/dev/null > src/integrations/supabase/types.ts`
Verify line 1 starts with `export type`.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/*_add_broadcast_to_publications.sql supabase/tests/broadcast_open_shifts.test.sql src/integrations/supabase/types.ts
git commit -m "feat: add broadcast columns to schedule_publications"
```

---

### Task 2: Edge function — broadcast-open-shifts

**Files:**
- Create: `supabase/functions/broadcast-open-shifts/index.ts`

- [ ] **Step 1: Verify schema before writing queries**

Run:
```bash
npx supabase db dump --local --schema public 2>&1 | grep -A 25 "CREATE TABLE.*schedule_publications"
npx supabase db dump --local --schema public 2>&1 | grep -A 15 "CREATE TABLE.*employees"
```

Note exact column names for employees (need: `id`, `user_id`, `name`, `is_active`, `restaurant_id`) and schedule_publications.

- [ ] **Step 2: Create the edge function**

Create `supabase/functions/broadcast-open-shifts/index.ts`:

```typescript
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { sendWebPushToUser } from '../_shared/webPushHelper.ts';
import { sendEmail, getManagerEmails, NOTIFICATION_FROM, APP_URL } from '../_shared/notificationHelpers.ts';

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Create client with user's auth
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );

    // Verify authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { restaurant_id, publication_id } = await req.json();

    if (!restaurant_id || !publication_id) {
      return new Response(JSON.stringify({ error: 'Missing restaurant_id or publication_id' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Verify caller is owner/manager
    const { data: userRole } = await supabase
      .from('user_restaurants')
      .select('role')
      .eq('user_id', user.id)
      .eq('restaurant_id', restaurant_id)
      .single();

    if (!userRole || !['owner', 'manager'].includes(userRole.role)) {
      return new Response(JSON.stringify({ error: 'Manager access required' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Use service role client for operations
    const serviceClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Fetch publication
    const { data: publication, error: pubError } = await serviceClient
      .from('schedule_publications')
      .select('*')
      .eq('id', publication_id)
      .eq('restaurant_id', restaurant_id)
      .single();

    if (pubError || !publication) {
      return new Response(JSON.stringify({ error: 'Publication not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Check open shifts exist
    const { data: openShifts } = await serviceClient.rpc('get_open_shifts', {
      p_restaurant_id: restaurant_id,
      p_week_start: publication.week_start_date,
      p_week_end: publication.week_end_date,
    });

    const openShiftCount = openShifts?.length ?? 0;
    if (openShiftCount === 0) {
      return new Response(JSON.stringify({ error: 'No open shifts to broadcast' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Fetch all active employees with user_id
    const { data: employees } = await serviceClient
      .from('employees')
      .select('id, user_id, name, email')
      .eq('restaurant_id', restaurant_id)
      .eq('is_active', true);

    const activeEmployees = employees ?? [];
    let pushSent = 0;
    let emailsSent = 0;

    // Format week label
    const weekLabel = `${publication.week_start_date} to ${publication.week_end_date}`;
    const notificationBody = `${openShiftCount} shift${openShiftCount > 1 ? 's are' : ' is'} open for the week of ${weekLabel}. Claim a spot!`;

    // Send push notifications
    for (const emp of activeEmployees) {
      if (!emp.user_id) continue;
      try {
        const result = await sendWebPushToUser(serviceClient, emp.user_id, restaurant_id, {
          title: 'Shifts Available',
          body: notificationBody,
          url: '/employee/shifts',
        });
        pushSent += result.sent;
      } catch {
        // Push failures are non-fatal — continue to next employee
      }
    }

    // Send emails
    const resendApiKey = Deno.env.get('RESEND_API_KEY');
    if (resendApiKey) {
      for (const emp of activeEmployees) {
        if (!emp.email) continue;
        try {
          const sent = await sendEmail(
            resendApiKey,
            NOTIFICATION_FROM,
            emp.email,
            'Shifts Available — Claim a Spot',
            `<p>Hi ${emp.name},</p>
            <p>${notificationBody}</p>
            <p><a href="${APP_URL}/employee/shifts">View Available Shifts</a></p>`
          );
          if (sent) emailsSent++;
        } catch {
          // Email failures are non-fatal
        }
      }
    }

    // Stamp the publication
    await serviceClient
      .from('schedule_publications')
      .update({
        open_shifts_broadcast_at: new Date().toISOString(),
        open_shifts_broadcast_by: user.id,
      })
      .eq('id', publication_id);

    return new Response(
      JSON.stringify({
        success: true,
        open_shifts: openShiftCount,
        push_sent: pushSent,
        emails_sent: emailsSent,
        employees_notified: activeEmployees.length,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Internal error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
```

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/broadcast-open-shifts/index.ts
git commit -m "feat: add broadcast-open-shifts edge function"
```

---

### Task 3: Hook — useBroadcastOpenShifts

**Files:**
- Create: `src/hooks/useBroadcastOpenShifts.ts`
- Modify: `src/hooks/useSchedulePublish.tsx`

- [ ] **Step 1: Create the broadcast mutation hook**

Create `src/hooks/useBroadcastOpenShifts.ts`:

```typescript
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export function useBroadcastOpenShifts() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (params: { restaurantId: string; publicationId: string }) => {
      const { data, error } = await supabase.functions.invoke('broadcast-open-shifts', {
        body: {
          restaurant_id: params.restaurantId,
          publication_id: params.publicationId,
        },
      });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error ?? 'Broadcast failed');
      return data as {
        success: boolean;
        open_shifts: number;
        push_sent: number;
        emails_sent: number;
        employees_notified: number;
      };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['schedule-publication'] });
      toast({
        title: 'Broadcast sent',
        description: `Notified ${data.employees_notified} team members about ${data.open_shifts} open shifts.`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Broadcast failed',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
}
```

- [ ] **Step 2: Update useSchedulePublish to return broadcast columns**

Read `src/hooks/useSchedulePublish.tsx` and find the `useWeekPublicationStatus` hook. Its query selects from `schedule_publications`. Add `open_shifts_broadcast_at` and `open_shifts_broadcast_by` to the `.select()` call.

Also update the return type/interface to include these fields, and the `SchedulePublication` type in `src/types/scheduling.ts` if needed.

**IMPORTANT:** Verify the exact `.select()` call — per the lesson about explicit selects, check if it uses `*` or an explicit column list. If explicit, add the new columns.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useBroadcastOpenShifts.ts src/hooks/useSchedulePublish.tsx
git commit -m "feat: add useBroadcastOpenShifts hook and update publication query"
```

---

### Task 4: BroadcastOpenShiftsDialog component

**Files:**
- Create: `src/components/scheduling/BroadcastOpenShiftsDialog.tsx`

- [ ] **Step 1: Create the dialog component**

```typescript
interface BroadcastOpenShiftsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  restaurantId: string;
  publicationId: string;
  weekStart: Date;
  weekEnd: Date;
  openShiftCount: number;
  alreadyBroadcast: boolean;
  broadcastDate?: string | null;
}
```

Layout following CLAUDE.md dialog structure:
- Header: Megaphone icon + "Broadcast Open Shifts"
- Body:
  - "{openShiftCount} open shifts for the week of {weekStart} - {weekEnd}"
  - "All active team members will be notified via push notification and email"
  - If `alreadyBroadcast`: amber alert "Already broadcast on {broadcastDate}. Sending again will re-notify your team."
- Footer: Cancel + "Broadcast to Team" button (primary style)
- Loading state: "Broadcasting..." with spinner

Import `useBroadcastOpenShifts` and call it on confirm. Close dialog on success.

Use `format` from `date-fns` for dates. Use `parseDateLocal` from `@/lib/dateUtils` for any date-only strings. Use Megaphone icon from `lucide-react` (check if it exists, otherwise use `Volume2` or `Bell`).

- [ ] **Step 2: Commit**

```bash
git add src/components/scheduling/BroadcastOpenShiftsDialog.tsx
git commit -m "feat: add BroadcastOpenShiftsDialog component"
```

---

### Task 5: Add broadcast button to Scheduling page

**Files:**
- Modify: `src/pages/Scheduling.tsx`
- Modify: `src/components/PublishScheduleDialog.tsx`

- [ ] **Step 1: Add broadcast button near publish controls**

In `src/pages/Scheduling.tsx`, near the publish button area (around line 1286), add a "Broadcast" button. Only show when:
- `open_shifts_enabled` is true (from `useStaffingSettings`)
- Week is published (`isPublished` from `useWeekPublicationStatus`)
- There are open shifts (`openShiftCount > 0`)

Button: Megaphone icon, text "Broadcast". If already broadcast, show a subtle check indicator.

Add state for `broadcastDialogOpen` and render `BroadcastOpenShiftsDialog`.

Pass the `publication.id`, `weekStart`, `weekEnd`, `openShiftCount`, `alreadyBroadcast` (from `publication.open_shifts_broadcast_at !== null`), and `broadcastDate`.

- [ ] **Step 2: Update publish dialog text**

In `PublishScheduleDialog.tsx`, when `openShiftsEnabled` is true and the week has already been broadcast, update the message from "You can fill these now or broadcast to your team later" to show "Broadcast sent on {date}" instead.

Add a new prop `broadcastDate?: string | null`. Use `parseDateLocal` if it's a date-only string, or `new Date()` if it includes time.

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`

- [ ] **Step 4: Commit**

```bash
git add src/pages/Scheduling.tsx src/components/PublishScheduleDialog.tsx
git commit -m "feat: add broadcast button to scheduling page"
```

---

### Task 6: E2E test — manager broadcasts open shifts

**Files:**
- Create: `tests/e2e/broadcast-open-shifts.spec.ts`

- [ ] **Step 1: Write the E2E test**

Test flow:
1. Sign up as manager, create restaurant
2. Seed: enable open shifts, create template with capacity > 1, publish schedule for current+next week
3. Navigate to `/scheduling`
4. Verify "Broadcast" button is visible
5. Click "Broadcast" button
6. Verify dialog appears with open shift count
7. Click "Broadcast to Team" button
8. Wait for success toast
9. Verify button shows broadcast-sent indicator

Use accessible selectors. Don't assert on timezone-dependent values. Seed data for all 7 days to handle any day-of-week.

Note: The edge function may not be running in CI without `supabase functions serve`. If the test can't call the edge function, mock the response or mark as a known limitation. Check how other E2E tests handle edge functions.

- [ ] **Step 2: Run the test**

Run: `npx playwright test tests/e2e/broadcast-open-shifts.spec.ts`

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/broadcast-open-shifts.spec.ts
git commit -m "test: E2E for broadcast open shifts"
```

---

## Self-Review

**Spec coverage:**
- Broadcast columns on schedule_publications: Task 1 ✓
- Edge function (auth, permission, send push, send email, stamp): Task 2 ✓
- Hook for broadcast mutation: Task 3 ✓
- Update publication query to return broadcast columns: Task 3 ✓
- BroadcastOpenShiftsDialog: Task 4 ✓
- Broadcast button on scheduling page: Task 5 ✓
- Publish dialog text update: Task 5 ✓
- Already-broadcast indicator: Task 4 (dialog) + Task 5 (button) ✓
- Re-broadcast with warning: Task 4 (amber alert in dialog) ✓
- pgTAP tests: Task 1 ✓
- E2E test: Task 6 ✓

**Placeholder scan:** No TBDs found. Edge function has complete code. Dialog and button have clear structural guidance with exact props.

**Type consistency:** `BroadcastOpenShiftsDialogProps` uses `openShiftCount`, `alreadyBroadcast`, `broadcastDate` — same names used in Task 5 when passing props. `useBroadcastOpenShifts` return type matches usage in Task 4.
