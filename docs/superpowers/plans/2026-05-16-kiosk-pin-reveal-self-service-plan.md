# Kiosk PIN Reveal & Employee Self-Service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let managers see and distribute freshly-generated kiosk PINs (one-time reveal), notify employees out-of-band when their PIN is changed (without leaking the value), and give employees a self-service `/employee/pin` page to regenerate their PIN without involving the manager.

**Architecture:** All three pieces ride on the existing hashed `employee_pins` table. A new RLS policy lets employees upsert only their own row. A new `notify-pin-changed` edge function sends a push + email "your manager updated your PIN" without the value. The hook layer accepts an `actor: 'manager' | 'self'` so the same mutation drives both flows. UI delivery uses the project's Apple/Notion styling per CLAUDE.md.

**Tech Stack:** React 18 + TypeScript + Vite, TailwindCSS + shadcn/ui, Lucide icons, React Query, React Router 6, Supabase (Postgres + Auth + Edge Functions in Deno + Resend for email), Vitest + RTL for unit, pgTAP for SQL.

**Spec:** `docs/superpowers/specs/2026-05-16-kiosk-pin-reveal-self-service-design.md`

---

## File Structure

### New
- `supabase/migrations/20260516120000_employee_self_pin_rls.sql` — RLS policies for employee self-manage
- `supabase/tests/20_employee_pins_self_rls.sql` — pgTAP test for the new policies
- `supabase/functions/notify-pin-changed/index.ts` — push + email notification edge function
- `src/components/time-clock/PinRevealDialog.tsx` — one-time reveal modal
- `src/pages/EmployeePin.tsx` — employee self-service page
- `tests/unit/PinRevealDialog.test.tsx`
- `tests/unit/EmployeePin.test.tsx`
- `tests/unit/useKioskPins.test.tsx`

### Modified
- `src/hooks/useKioskPins.tsx` — accept `actor`, fire `notify-pin-changed` when manager
- `src/pages/TimePunchesManager.tsx` — accumulate plain PINs from bulk loop, open reveal modal, drop inline `lastSavedPin` panel
- `src/components/time-clock/EmployeePinsCard.tsx` — add amber info strip above Generate button
- `src/components/time-clock/index.ts` — export `PinRevealDialog`
- `src/pages/EmployeeMore.tsx` — add "Kiosk PIN" entry to `mainItems`
- `src/App.tsx` — register `/employee/pin` route under employee guard

---

## Task 1: Add RLS policies for employee self-manage

**Files:**
- Create: `supabase/migrations/20260516120000_employee_self_pin_rls.sql`
- Create: `supabase/tests/20_employee_pins_self_rls.sql`

- [ ] **Step 1: Write the failing pgTAP test**

Create `supabase/tests/20_employee_pins_self_rls.sql`:

```sql
BEGIN;
SELECT plan(6);

-- Setup: create a restaurant, manager user, two staff users + employee rows
INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-00000000a001', 'mgr@test.local'),
  ('00000000-0000-0000-0000-00000000a002', 'alice@test.local'),
  ('00000000-0000-0000-0000-00000000a003', 'bob@test.local');

INSERT INTO restaurants (id, name) VALUES
  ('00000000-0000-0000-0000-0000000000r1', 'Test Cafe');

INSERT INTO user_restaurants (restaurant_id, user_id, role) VALUES
  ('00000000-0000-0000-0000-0000000000r1', '00000000-0000-0000-0000-00000000a001', 'manager'),
  ('00000000-0000-0000-0000-0000000000r1', '00000000-0000-0000-0000-00000000a002', 'staff'),
  ('00000000-0000-0000-0000-0000000000r1', '00000000-0000-0000-0000-00000000a003', 'staff');

INSERT INTO employees (id, restaurant_id, user_id, name, position, is_active) VALUES
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000r1', '00000000-0000-0000-0000-00000000a002', 'Alice', 'server', true),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000r1', '00000000-0000-0000-0000-00000000a003', 'Bob',   'server', true);

-- Switch to Alice's context
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-00000000a002';
SET LOCAL role = 'authenticated';

-- Test 1: Alice can insert her OWN pin row
SELECT lives_ok(
  $$ INSERT INTO employee_pins (restaurant_id, employee_id, pin_hash, min_length)
     VALUES ('00000000-0000-0000-0000-0000000000r1', '00000000-0000-0000-0000-0000000000e1', 'aaa', 4) $$,
  'Alice can insert her own employee_pins row'
);

-- Test 2: Alice can update her own pin row
SELECT lives_ok(
  $$ UPDATE employee_pins SET pin_hash = 'bbb'
     WHERE employee_id = '00000000-0000-0000-0000-0000000000e1' $$,
  'Alice can update her own employee_pins row'
);

-- Test 3: Alice CANNOT insert Bob's pin row
SELECT throws_ok(
  $$ INSERT INTO employee_pins (restaurant_id, employee_id, pin_hash, min_length)
     VALUES ('00000000-0000-0000-0000-0000000000r1', '00000000-0000-0000-0000-0000000000e2', 'ccc', 4) $$,
  NULL,
  NULL,
  'Alice cannot insert a pin row for Bob'
);

-- Test 4: Alice CANNOT delete her own pin row (delete remains manager-only)
SELECT is(
  (SELECT count(*)::int FROM employee_pins WHERE employee_id = '00000000-0000-0000-0000-0000000000e1'),
  1,
  'Pin row still exists before delete attempt'
);
DELETE FROM employee_pins WHERE employee_id = '00000000-0000-0000-0000-0000000000e1';
SELECT is(
  (SELECT count(*)::int FROM employee_pins WHERE employee_id = '00000000-0000-0000-0000-0000000000e1'),
  1,
  'Alice cannot delete her own employee_pins row (RLS hides delete)'
);

-- Test 5: Deactivated employee cannot upsert
UPDATE employees SET is_active = false WHERE id = '00000000-0000-0000-0000-0000000000e1';
SELECT throws_ok(
  $$ UPDATE employee_pins SET pin_hash = 'zzz'
     WHERE employee_id = '00000000-0000-0000-0000-0000000000e1' $$,
  NULL,
  NULL,
  'Deactivated Alice cannot update her pin row'
);

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:db -- -f 20_employee_pins_self_rls.sql`
Expected: tests 1, 2, 5 fail because no self-manage policy exists yet (insert/update denied for Alice).

- [ ] **Step 3: Create the migration**

Create `supabase/migrations/20260516120000_employee_self_pin_rls.sql`:

```sql
-- Allow an employee to upsert only their own employee_pins row.
-- DELETE is intentionally NOT granted -- removing a PIN remains manager-only.

drop policy if exists employee_pins_self_insert on public.employee_pins;
create policy employee_pins_self_insert on public.employee_pins
  for insert
  with check (
    employee_id = (
      select id from public.employees
      where user_id = (select auth.uid())
        and restaurant_id = employee_pins.restaurant_id
        and is_active = true
    )
  );

drop policy if exists employee_pins_self_update on public.employee_pins;
create policy employee_pins_self_update on public.employee_pins
  for update
  using (
    employee_id = (
      select id from public.employees
      where user_id = (select auth.uid())
        and restaurant_id = employee_pins.restaurant_id
        and is_active = true
    )
  )
  with check (
    employee_id = (
      select id from public.employees
      where user_id = (select auth.uid())
        and restaurant_id = employee_pins.restaurant_id
        and is_active = true
    )
  );

comment on policy employee_pins_self_insert on public.employee_pins is
  'Active employee may insert their own PIN row (for /employee/pin self-service).';
comment on policy employee_pins_self_update on public.employee_pins is
  'Active employee may update their own PIN row (for /employee/pin self-service).';
```

- [ ] **Step 4: Reset DB and re-run the test**

Run: `npm run db:reset && npm run test:db -- -f 20_employee_pins_self_rls.sql`
Expected: all 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260516120000_employee_self_pin_rls.sql \
        supabase/tests/20_employee_pins_self_rls.sql
git commit -m "feat(db): RLS policies for employee self-manage of kiosk PIN"
```

---

## Task 2: `notify-pin-changed` edge function

**Files:**
- Create: `supabase/functions/notify-pin-changed/index.ts`

- [ ] **Step 1: Write the edge function**

Create `supabase/functions/notify-pin-changed/index.ts` (mirrors `send-team-invitation` style):

```typescript
import { generateHeader } from '../_shared/emailTemplates.ts';
import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { Resend } from 'https://esm.sh/resend@4.0.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RequestBody {
  restaurantId: string;
  employeeId: string;
  action: 'created' | 'reset';
  actor: 'manager' | 'self';
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const body: RequestBody = await req.json();
    if (!body.restaurantId || !body.employeeId || !body.action || !body.actor) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Employees don't need to be notified when they reset their own PIN.
    if (body.actor === 'self') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { data: employee, error: empErr } = await supabase
      .from('employees')
      .select('id, name, email, user_id, restaurant_id')
      .eq('id', body.employeeId)
      .eq('restaurant_id', body.restaurantId)
      .maybeSingle();

    if (empErr || !employee) {
      console.warn('notify-pin-changed: employee not found', { empErr, employeeId: body.employeeId });
      return new Response(JSON.stringify({ ok: true, skipped: 'employee_not_found' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: restaurant } = await supabase
      .from('restaurants')
      .select('name')
      .eq('id', body.restaurantId)
      .maybeSingle();
    const restaurantName = restaurant?.name ?? 'your restaurant';

    // Push notification (no-op if no device tokens).
    if (employee.user_id) {
      try {
        await supabase.functions.invoke('send-push-notification', {
          body: {
            user_id: employee.user_id,
            title: 'Kiosk PIN updated',
            body: `Your manager updated your kiosk PIN at ${restaurantName}.`,
            data: { type: 'pin_changed', restaurant_id: body.restaurantId },
          },
        });
      } catch (pushErr) {
        console.warn('notify-pin-changed: push failed', pushErr);
      }
    }

    // Email (no PIN value).
    if (employee.email) {
      const resendKey = Deno.env.get('RESEND_API_KEY');
      if (resendKey) {
        try {
          const resend = new Resend(resendKey);
          await resend.emails.send({
            from: 'EasyShiftHQ <notifications@easyshifthq.com>',
            to: [employee.email],
            subject: `Your kiosk PIN was updated at ${restaurantName}`,
            html: `
              <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff;">
                ${generateHeader()}
                <div style="padding: 40px 32px;">
                  <h1 style="color: #1f2937; font-size: 22px; margin: 0 0 16px;">Your kiosk PIN was updated</h1>
                  <p style="color: #6b7280; line-height: 1.6; font-size: 16px; margin: 0 0 16px;">
                    Hi ${employee.name},
                  </p>
                  <p style="color: #6b7280; line-height: 1.6; font-size: 16px; margin: 0 0 16px;">
                    Your manager just updated your kiosk PIN at
                    <strong style="color: #1f2937;">${restaurantName}</strong>.
                  </p>
                  <p style="color: #6b7280; line-height: 1.6; font-size: 16px; margin: 0 0 16px;">
                    For security, we don't email PIN values. Ask your manager for the new PIN, or generate a new one yourself:
                  </p>
                  <div style="text-align: center; margin: 24px 0;">
                    <a href="https://app.easyshifthq.com/employee/pin"
                       style="background: #059669; color: #fff; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: 600;">
                      Set my own PIN
                    </a>
                  </div>
                  <p style="color: #9ca3af; font-size: 13px; margin-top: 32px;">
                    If you didn't expect this, contact your manager right away.
                  </p>
                </div>
              </div>
            `,
          });
        } catch (mailErr) {
          console.warn('notify-pin-changed: email failed', mailErr);
        }
      }
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('notify-pin-changed error', err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
};

serve(handler);
```

- [ ] **Step 2: Smoke-test the function locally**

Run (in another terminal): `npm run functions:serve`
Then:

```bash
curl -i -X POST http://localhost:54321/functions/v1/notify-pin-changed \
  -H "Content-Type: application/json" \
  -d '{"restaurantId":"00000000-0000-0000-0000-0000000000r1","employeeId":"00000000-0000-0000-0000-0000000000e1","action":"reset","actor":"self"}'
```
Expected: HTTP/1.1 204.

Then:

```bash
curl -i -X POST http://localhost:54321/functions/v1/notify-pin-changed \
  -H "Content-Type: application/json" \
  -d '{"restaurantId":"00000000-0000-0000-0000-0000000000r1","employeeId":"00000000-0000-0000-0000-0000000000e1","action":"reset","actor":"manager"}'
```
Expected: HTTP/1.1 200 with `{"ok":true}` (or `{"ok":true,"skipped":"employee_not_found"}` if no seed data).

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/notify-pin-changed/index.ts
git commit -m "feat(functions): notify-pin-changed edge function (push + email, no PIN value)"
```

---

## Task 3: Wire `actor` parameter and notification into `useKioskPins`

**Files:**
- Modify: `src/hooks/useKioskPins.tsx`
- Create: `tests/unit/useKioskPins.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/useKioskPins.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useUpsertEmployeePin } from '@/hooks/useKioskPins';

const upsertSelectMock = vi.fn();
const functionsInvokeMock = vi.fn().mockResolvedValue({ data: { ok: true }, error: null });

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: () => ({
      upsert: () => ({
        select: () => ({
          single: upsertSelectMock,
        }),
      }),
    }),
    functions: {
      invoke: functionsInvokeMock,
    },
  },
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

const wrapper = ({ children }: { children: React.ReactNode }) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
};

describe('useUpsertEmployeePin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    upsertSelectMock.mockResolvedValue({
      data: {
        id: 'pin-1',
        restaurant_id: 'r1',
        employee_id: 'e1',
        pin_hash: 'h',
        min_length: 4,
        force_reset: false,
        last_used_at: null,
        created_at: '2026-05-16T00:00:00Z',
        updated_at: '2026-05-16T00:00:00Z',
      },
      error: null,
    });
  });

  it('invokes notify-pin-changed when actor is manager', async () => {
    const { result } = renderHook(() => useUpsertEmployeePin(), { wrapper });
    await result.current.mutateAsync({
      restaurant_id: 'r1',
      employee_id: 'e1',
      pin: '1357',
      actor: 'manager',
    });
    await waitFor(() => {
      expect(functionsInvokeMock).toHaveBeenCalledWith('notify-pin-changed', {
        body: { restaurantId: 'r1', employeeId: 'e1', action: 'reset', actor: 'manager' },
      });
    });
  });

  it('does NOT invoke notify-pin-changed when actor is self', async () => {
    const { result } = renderHook(() => useUpsertEmployeePin(), { wrapper });
    await result.current.mutateAsync({
      restaurant_id: 'r1',
      employee_id: 'e1',
      pin: '1357',
      actor: 'self',
    });
    expect(functionsInvokeMock).not.toHaveBeenCalled();
  });

  it('defaults to actor=manager when omitted (back-compat)', async () => {
    const { result } = renderHook(() => useUpsertEmployeePin(), { wrapper });
    await result.current.mutateAsync({
      restaurant_id: 'r1',
      employee_id: 'e1',
      pin: '1357',
    });
    await waitFor(() => expect(functionsInvokeMock).toHaveBeenCalled());
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- useKioskPins.test.tsx`
Expected: FAIL — `actor` not accepted, no `functions.invoke` call.

- [ ] **Step 3: Modify the hook**

Modify `src/hooks/useKioskPins.tsx`. Add `actor` to `UpsertPinInput`, fire the notification in `onSuccess`:

```typescript
type UpsertPinInput = {
  restaurant_id: string;
  employee_id: string;
  pin?: string;
  min_length?: number;
  force_reset?: boolean;
  allowSimpleSequence?: boolean;
  actor?: 'manager' | 'self';
};
```

In the mutation function, after `if (error) { ... throw error }` and before `return { pin: pinToUse, record: data as EmployeePin };`, capture the actor so it's available in `onSuccess`:

```typescript
      return {
        pin: pinToUse,
        record: data as EmployeePin,
        actor: payload.actor ?? 'manager',
        action: 'reset' as const,
      };
```

Update `onSuccess` to fire the notification (fire-and-forget; never block the success path):

```typescript
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: pinQueryKey(result.record.restaurant_id) });

      if (result.actor === 'manager') {
        supabase.functions
          .invoke('notify-pin-changed', {
            body: {
              restaurantId: result.record.restaurant_id,
              employeeId: result.record.employee_id,
              action: result.action,
              actor: 'manager',
            },
          })
          .catch((err) => {
            console.warn('notify-pin-changed invoke failed', err);
          });
      }

      toast({
        title: 'PIN saved',
        description:
          result.actor === 'self'
            ? 'Your new PIN is ready below.'
            : 'New PIN ready to share securely with the employee.',
      });
    },
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -- useKioskPins.test.tsx`
Expected: all 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useKioskPins.tsx tests/unit/useKioskPins.test.tsx
git commit -m "feat(kiosk-pins): add actor param + fire notify-pin-changed for manager updates"
```

---

## Task 4: Build the `PinRevealDialog` component

**Files:**
- Create: `src/components/time-clock/PinRevealDialog.tsx`
- Modify: `src/components/time-clock/index.ts`
- Create: `tests/unit/PinRevealDialog.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/PinRevealDialog.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PinRevealDialog } from '@/components/time-clock/PinRevealDialog';

const writeTextMock = vi.fn().mockResolvedValue(undefined);
Object.assign(navigator, { clipboard: { writeText: writeTextMock } });

const sample = [
  { employeeId: 'e1', name: 'Alice Ng',    position: 'Server', pin: '4729' },
  { employeeId: 'e2', name: 'Bob Smith',   position: 'Cook',   pin: '8163' },
];

describe('PinRevealDialog', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders one row per revealed PIN', () => {
    render(<PinRevealDialog open pins={sample} onOpenChange={() => {}} />);
    expect(screen.getByText('Alice Ng')).toBeInTheDocument();
    expect(screen.getByText('4729')).toBeInTheDocument();
    expect(screen.getByText('Bob Smith')).toBeInTheDocument();
    expect(screen.getByText('8163')).toBeInTheDocument();
  });

  it('renders the non-recoverable warning', () => {
    render(<PinRevealDialog open pins={sample} onOpenChange={() => {}} />);
    expect(
      screen.getByText(/won't see these PINs again/i)
    ).toBeInTheDocument();
  });

  it('copy-all writes a newline-delimited string of `Name — PIN`', async () => {
    render(<PinRevealDialog open pins={sample} onOpenChange={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /copy all/i }));
    expect(writeTextMock).toHaveBeenCalledWith('Alice Ng — 4729\nBob Smith — 8163');
  });

  it('per-row copy writes only that PIN', async () => {
    render(<PinRevealDialog open pins={sample} onOpenChange={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /copy pin for alice ng/i }));
    expect(writeTextMock).toHaveBeenCalledWith('4729');
  });

  it('Done button calls onOpenChange(false)', () => {
    const onOpenChange = vi.fn();
    render(<PinRevealDialog open pins={sample} onOpenChange={onOpenChange} />);
    fireEvent.click(screen.getByRole('button', { name: /done/i }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- PinRevealDialog.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the component**

Create `src/components/time-clock/PinRevealDialog.tsx`:

```typescript
import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { KeyRound, AlertTriangle, Copy, Check, Printer } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface RevealedPin {
  employeeId: string;
  name: string;
  position?: string | null;
  pin: string;
}

interface PinRevealDialogProps {
  open: boolean;
  pins: RevealedPin[];
  onOpenChange: (open: boolean) => void;
}

const formatBulk = (pins: RevealedPin[]) =>
  pins.map((p) => `${p.name} — ${p.pin}`).join('\n');

export function PinRevealDialog({ open, pins, onOpenChange }: PinRevealDialogProps) {
  const [announce, setAnnounce] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const copyOne = async (p: RevealedPin) => {
    await navigator.clipboard.writeText(p.pin);
    setCopiedId(p.employeeId);
    setAnnounce(`PIN for ${p.name} copied.`);
    window.setTimeout(() => setCopiedId(null), 1500);
  };

  const copyAll = async () => {
    await navigator.clipboard.writeText(formatBulk(pins));
    setAnnounce(`Copied ${pins.length} PIN${pins.length === 1 ? '' : 's'}.`);
  };

  const print = () => {
    window.print();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[80vh] p-0 gap-0 border-border/40 overflow-hidden print:max-w-none print:max-h-none print:border-0">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-border/40 print:hidden">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-muted/50 flex items-center justify-center">
              <KeyRound className="h-5 w-5 text-foreground" />
            </div>
            <div>
              <DialogTitle className="text-[17px] font-semibold text-foreground">
                PINs ready to share
              </DialogTitle>
              <p className="text-[13px] text-muted-foreground mt-0.5">
                Distribute these now — they're hashed after you close.
              </p>
            </div>
          </div>
        </DialogHeader>

        <div className="px-6 pt-4 print:hidden">
          <div className="flex items-start gap-2.5 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
            <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-500 mt-0.5 flex-shrink-0" />
            <p className="text-[13px] text-amber-800 dark:text-amber-300">
              You won't see these PINs again after closing this dialog.
            </p>
          </div>
        </div>

        <div className="px-6 py-4 overflow-y-auto print:overflow-visible">
          <ul className="space-y-2 print:space-y-0">
            {pins.map((p, i) => {
              const justCopied = copiedId === p.employeeId;
              return (
                <li
                  key={p.employeeId}
                  className="reveal-row group flex items-center justify-between gap-3 p-4 rounded-xl border border-border/40 bg-background print:rounded-none print:border-0 print:border-b print:break-inside-avoid print:py-6"
                  style={{ animationDelay: `${i * 50}ms` }}
                >
                  <div className="min-w-0">
                    <div className="text-[14px] font-medium text-foreground truncate">
                      {p.name}
                    </div>
                    {p.position && (
                      <div className="text-[12px] text-muted-foreground truncate">
                        {p.position}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-[28px] font-mono tracking-[0.3em] text-foreground print:text-[48px]">
                      {p.pin}
                    </span>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => copyOne(p)}
                      aria-label={`Copy PIN for ${p.name}`}
                      className="print:hidden"
                    >
                      {justCopied ? (
                        <Check className="h-4 w-4 text-emerald-600" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        <div
          aria-live="polite"
          aria-atomic="true"
          className="sr-only"
        >
          {announce}
        </div>

        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-border/40 bg-background sticky bottom-0 print:hidden">
          <Button variant="ghost" onClick={print} className="text-[13px] font-medium">
            <Printer className="h-4 w-4 mr-2" />
            Print
          </Button>
          <Button variant="outline" onClick={copyAll} className="text-[13px] font-medium">
            <Copy className="h-4 w-4 mr-2" />
            Copy all
          </Button>
          <Button onClick={() => onOpenChange(false)} className="text-[13px] font-medium">
            Done
          </Button>
        </div>

        <style>{`
          @keyframes reveal-in {
            from { opacity: 0; transform: translateY(4px); }
            to   { opacity: 1; transform: translateY(0); }
          }
          .reveal-row {
            opacity: 0;
            animation: reveal-in 240ms ease-out forwards;
          }
          @media (prefers-reduced-motion: reduce) {
            .reveal-row { animation: none; opacity: 1; }
          }
        `}</style>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Export from the barrel file**

Modify `src/components/time-clock/index.ts` — add `PinRevealDialog` to the existing exports:

```typescript
export { PinRevealDialog, type RevealedPin } from './PinRevealDialog';
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run test -- PinRevealDialog.test.tsx`
Expected: all 5 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/components/time-clock/PinRevealDialog.tsx \
        src/components/time-clock/index.ts \
        tests/unit/PinRevealDialog.test.tsx
git commit -m "feat(kiosk-pins): PinRevealDialog component for one-time reveal"
```

---

## Task 5: Wire the reveal modal into `TimePunchesManager`

**Files:**
- Modify: `src/pages/TimePunchesManager.tsx`

- [ ] **Step 1: Add reveal state**

In `TimePunchesManager.tsx`, near the existing `pinDialogEmployee` / `pinValue` state (around line 94), add:

```typescript
const [revealedPins, setRevealedPins] = useState<RevealedPin[]>([]);
const [revealOpen, setRevealOpen] = useState(false);
```

And import the dialog at the top with the other time-clock imports:

```typescript
import { StatusSummary, KioskModeCard, EmployeePinsCard, PinRevealDialog, type RevealedPin } from '@/components/time-clock';
```

- [ ] **Step 2: Update the single-employee save handler**

Replace the existing `handleSavePin` function (around line 155):

```typescript
  const handleSavePin = async () => {
    if (!restaurantId || !pinDialogEmployee) return;
    try {
      const result = await upsertPin.mutateAsync({
        restaurant_id: restaurantId,
        employee_id: pinDialogEmployee.id,
        pin: pinValue,
        min_length: pinPolicy.minLength,
        force_reset: pinForceReset,
        allowSimpleSequence: pinPolicy.allowSimpleSequences,
        actor: 'manager',
      });
      setRevealedPins([
        {
          employeeId: pinDialogEmployee.id,
          name: pinDialogEmployee.name,
          position: pinDialogEmployee.position,
          pin: result.pin,
        },
      ]);
      setRevealOpen(true);
      closePinDialog();
    } catch (error) {
      console.error('Error saving PIN', error);
    }
  };
```

- [ ] **Step 3: Update the bulk auto-generate handler**

Replace the existing `handleAutoGeneratePins` function (around line 176):

```typescript
  const handleAutoGeneratePins = async () => {
    if (!restaurantId) return;
    const missing = employees.filter((emp) => !pinLookup.get(emp.id));
    if (missing.length === 0) {
      toast({
        title: 'All employees covered',
        description: 'Every active employee already has a PIN.',
      });
      return;
    }

    const generatedReveals: RevealedPin[] = [];
    for (const emp of missing) {
      const candidate = generatePolicyPin();
      try {
        const result = await upsertPin.mutateAsync({
          restaurant_id: restaurantId,
          employee_id: emp.id,
          pin: candidate,
          min_length: pinPolicy.minLength,
          force_reset: pinPolicy.forceResetOnNext,
          allowSimpleSequence: pinPolicy.allowSimpleSequences,
          actor: 'manager',
        });
        generatedReveals.push({
          employeeId: emp.id,
          name: emp.name,
          position: emp.position,
          pin: result.pin,
        });
      } catch (error) {
        console.error('Error generating PIN', error);
        break;
      }
    }

    if (generatedReveals.length > 0) {
      setRevealedPins(generatedReveals);
      setRevealOpen(true);
    }
  };
```

- [ ] **Step 4: Drop the inline `lastSavedPin` panel and render the dialog**

In the existing PIN Dialog block, remove the `lastSavedPin` panel (the green "Saved: {lastSavedPin}" block, around lines 982–990). Also remove the `lastSavedPin` state, the `setLastSavedPin(null)` calls in `openPinDialog`/`closePinDialog`, and the now-unused `KeyRound` import if it's only used for that panel.

Then, near the other top-level dialogs at the bottom of the JSX (near the `Delete Confirmation` AlertDialog), add the reveal dialog:

```typescript
      <PinRevealDialog
        open={revealOpen}
        pins={revealedPins}
        onOpenChange={(o) => {
          setRevealOpen(o);
          if (!o) setRevealedPins([]);
        }}
      />
```

- [ ] **Step 5: Run type-check + tests**

Run: `npm run typecheck && npm run test -- TimePunchesManager`
Expected: PASS (no existing test for this page — the typecheck is the gate).

- [ ] **Step 6: Manual smoke test**

Start dev server (`npm run dev`), sign in as a manager, open Time Punches → Time Clock Settings → Employee PINs. Click "Generate N missing" (need ≥2 employees with no PIN). Confirm the reveal modal opens, lists all PINs, Copy-all and Print buttons work. Set a single PIN; confirm the reveal modal opens with a single row.

- [ ] **Step 7: Commit**

```bash
git add src/pages/TimePunchesManager.tsx
git commit -m "feat(kiosk-pins): open PinRevealDialog after manager bulk/single PIN ops"
```

---

## Task 6: Add the "doesn't email" hint to `EmployeePinsCard`

**Files:**
- Modify: `src/components/time-clock/EmployeePinsCard.tsx`

- [ ] **Step 1: Add the amber info strip above the Generate button**

Modify `src/components/time-clock/EmployeePinsCard.tsx`. Add the `Info` import:

```typescript
import { KeyRound, Info } from 'lucide-react';
```

Replace the header block (currently `<CardHeader className="pb-4">…</CardHeader>` around lines 31–51) with a version that has the hint strip below the existing header row:

```typescript
      <CardHeader className="pb-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <KeyRound className="h-5 w-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-lg">Employee PINs</CardTitle>
              <CardDescription>
                {pinsSet} employee{pinsSet !== 1 ? 's' : ''} have a PIN
              </CardDescription>
            </div>
          </div>
          {missing > 0 && (
            <Button size="sm" variant="outline" onClick={onAutoGenerate} disabled={pinsLoading || isPinSaving}>
              Generate {missing} missing
            </Button>
          )}
        </div>

        <div className="flex items-start gap-2.5 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20">
          <Info className="h-4 w-4 text-amber-600 dark:text-amber-500 mt-0.5 flex-shrink-0" />
          <p className="text-[12px] text-amber-800 dark:text-amber-300 leading-snug">
            Resetting a PIN doesn't email the new digits. We'll notify the employee that you changed it — share the new PIN with them in person.
          </p>
        </div>
      </CardHeader>
```

- [ ] **Step 2: Run type-check**

Run: `npm run typecheck`
Expected: pass.

- [ ] **Step 3: Commit**

```bash
git add src/components/time-clock/EmployeePinsCard.tsx
git commit -m "feat(kiosk-pins): warn manager that PIN reset doesn't email the value"
```

---

## Task 7: Build the `/employee/pin` self-service page

**Files:**
- Create: `src/pages/EmployeePin.tsx`
- Create: `tests/unit/EmployeePin.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/EmployeePin.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import EmployeePin from '@/pages/EmployeePin';

const mutateAsyncMock = vi.fn();
const useEmployeePinsMock = vi.fn();
const useCurrentEmployeeMock = vi.fn();

vi.mock('@/hooks/useKioskPins', () => ({
  useEmployeePins: (...args: unknown[]) => useEmployeePinsMock(...args),
  useUpsertEmployeePin: () => ({
    mutateAsync: mutateAsyncMock,
    isPending: false,
  }),
}));

vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => ({
    selectedRestaurant: { restaurant_id: 'r1', restaurant: { name: 'Test Cafe' } },
  }),
}));

vi.mock('@/hooks/useTimePunches', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useTimePunches')>('@/hooks/useTimePunches');
  return {
    ...actual,
    useCurrentEmployee: (...args: unknown[]) => useCurrentEmployeeMock(...args),
  };
});

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

describe('EmployeePin page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useCurrentEmployeeMock.mockReturnValue({
      employee: { id: 'e1', name: 'Alice', position: 'Server' },
      loading: false,
    });
    useEmployeePinsMock.mockReturnValue({ pins: [], loading: false });
  });

  it('shows the "No PIN yet" empty state', () => {
    render(<EmployeePin />);
    expect(screen.getByText(/no pin yet/i)).toBeInTheDocument();
  });

  it('Generate calls mutateAsync with actor=self and shows the PIN after success', async () => {
    mutateAsyncMock.mockResolvedValue({ pin: '7432', record: { id: 'pin-1', restaurant_id: 'r1' } });
    render(<EmployeePin />);
    fireEvent.click(screen.getByRole('button', { name: /generate a new pin/i }));
    await waitFor(() => {
      expect(mutateAsyncMock).toHaveBeenCalledWith(
        expect.objectContaining({
          restaurant_id: 'r1',
          employee_id: 'e1',
          actor: 'self',
          force_reset: false,
        })
      );
    });
    expect(await screen.findByText('7432')).toBeInTheDocument();
  });

  it('shows status pill when a PIN already exists', () => {
    useEmployeePinsMock.mockReturnValue({
      pins: [{
        id: 'pin-1', employee_id: 'e1', restaurant_id: 'r1', pin_hash: 'h',
        min_length: 4, force_reset: false, last_used_at: null,
        created_at: '2026-05-10T00:00:00Z', updated_at: '2026-05-10T00:00:00Z',
      }],
      loading: false,
    });
    render(<EmployeePin />);
    expect(screen.getByText(/pin set/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- EmployeePin.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the page**

Create `src/pages/EmployeePin.tsx`:

```typescript
import { useMemo, useState } from 'react';
import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { useCurrentEmployee } from '@/hooks/useTimePunches';
import { useEmployeePins, useUpsertEmployeePin } from '@/hooks/useKioskPins';
import { generateNumericPin, isSimpleSequence } from '@/utils/kiosk';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { KeyRound, Copy, Check, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';

const MIN_LENGTH = 4;

function EmployeePin() {
  const { selectedRestaurant } = useRestaurantContext();
  const restaurantId = selectedRestaurant?.restaurant_id || null;
  const { employee, loading: empLoading } = useCurrentEmployee(restaurantId);
  const { pins, loading: pinsLoading } = useEmployeePins(restaurantId);
  const upsertPin = useUpsertEmployeePin();

  const myPin = useMemo(
    () => pins.find((p) => p.employee_id === employee?.id) ?? null,
    [pins, employee?.id]
  );

  const [tab, setTab] = useState<'generate' | 'type'>('generate');
  const [revealed, setRevealed] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [typed, setTyped] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);

  const minLength = myPin?.min_length ?? MIN_LENGTH;
  const typedTooShort = typed.length > 0 && typed.length < minLength;
  const typedSimple = typed.length >= 3 && isSimpleSequence(typed);
  const confirmMismatch = confirm.length > 0 && confirm !== typed;
  const canSubmitTyped =
    typed.length >= minLength && !typedSimple && confirm === typed && !upsertPin.isPending;

  if (empLoading || pinsLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-7 w-32" />
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    );
  }

  if (!restaurantId || !employee) {
    return (
      <div className="text-[13px] text-muted-foreground">
        Pick a restaurant from the switcher to manage your kiosk PIN.
      </div>
    );
  }

  const generate = async () => {
    setError(null);
    let candidate = generateNumericPin(minLength);
    let attempts = 0;
    while (isSimpleSequence(candidate) && attempts < 6) {
      candidate = generateNumericPin(minLength);
      attempts++;
    }
    try {
      const result = await upsertPin.mutateAsync({
        restaurant_id: restaurantId,
        employee_id: employee.id,
        pin: candidate,
        min_length: minLength,
        force_reset: false,
        actor: 'self',
      });
      setRevealed(result.pin);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save PIN.');
    }
  };

  const saveTyped = async () => {
    if (!canSubmitTyped) return;
    setError(null);
    try {
      const result = await upsertPin.mutateAsync({
        restaurant_id: restaurantId,
        employee_id: employee.id,
        pin: typed,
        min_length: minLength,
        force_reset: false,
        actor: 'self',
      });
      setRevealed(result.pin);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save PIN.');
    }
  };

  const copyRevealed = async () => {
    if (!revealed) return;
    await navigator.clipboard.writeText(revealed);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  const lastUsedLabel = myPin?.last_used_at
    ? `Last used ${formatDistanceToNow(new Date(myPin.last_used_at), { addSuffix: true })}`
    : null;

  return (
    <div className="space-y-3">
      <div className="pt-2 pb-1">
        <h1 className="text-[20px] font-bold text-foreground">Kiosk PIN</h1>
      </div>

      <div className="rounded-xl border border-border/40 bg-background overflow-hidden">
        <div className="px-5 py-4 border-b border-border/40">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-muted/50 flex items-center justify-center">
              <KeyRound className="h-5 w-5 text-foreground" />
            </div>
            <div>
              <div className="text-[17px] font-semibold text-foreground">Kiosk PIN</div>
              <div className="text-[13px] text-muted-foreground mt-0.5">
                Use this PIN on the kiosk to clock in
              </div>
            </div>
          </div>
        </div>

        <div className="px-5 py-4 border-b border-border/40">
          {myPin ? (
            myPin.force_reset ? (
              <span className="inline-flex items-center gap-2 text-[12px] font-medium px-2 py-1 rounded-md bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20">
                Temporary PIN · Change it on the kiosk
              </span>
            ) : (
              <span className="inline-flex items-center gap-2 text-[12px] font-medium px-2 py-1 rounded-md bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20">
                PIN set{lastUsedLabel ? ` · ${lastUsedLabel}` : ''}
              </span>
            )
          ) : (
            <span className="inline-flex items-center gap-2 text-[12px] font-medium px-2 py-1 rounded-md bg-muted text-muted-foreground">
              No PIN yet
            </span>
          )}
        </div>

        <div className="px-5 pt-3">
          <div className="flex items-center">
            {(['generate', 'type'] as const).map((t) => (
              <button
                key={t}
                onClick={() => {
                  setTab(t);
                  setRevealed(null);
                  setError(null);
                }}
                className={cn(
                  'relative px-0 py-3 mr-6 text-[14px] font-medium transition-colors',
                  tab === t ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {t === 'generate' ? 'Generate for me' : 'Type my own'}
                {tab === t && (
                  <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-foreground" />
                )}
              </button>
            ))}
          </div>
        </div>

        <div className="px-5 py-5 space-y-4">
          {revealed ? (
            <div className="p-5 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
              <div className="text-[12px] uppercase tracking-wider text-emerald-700 dark:text-emerald-400 font-medium">
                Your new PIN
              </div>
              <div className="flex items-center justify-between mt-2">
                <span className="text-[36px] font-mono tracking-[0.3em] text-foreground">
                  {revealed}
                </span>
                <Button size="sm" variant="outline" onClick={copyRevealed} aria-label="Copy PIN">
                  {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
                  <span className="ml-1.5 text-[13px]">{copied ? 'Copied' : 'Copy'}</span>
                </Button>
              </div>
              <p className="text-[12px] text-muted-foreground mt-3">
                This is your only chance to see this number. We hash it for storage.
              </p>
            </div>
          ) : tab === 'generate' ? (
            <Button
              onClick={generate}
              disabled={upsertPin.isPending}
              className="w-full h-10 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[13px] font-medium"
            >
              {upsertPin.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : null}
              Generate a new PIN
            </Button>
          ) : (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <label className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                  New PIN ({minLength}–6 digits)
                </label>
                <Input
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  value={typed}
                  onChange={(e) => setTyped(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  className="h-10 text-[16px] font-mono tracking-[0.3em] bg-muted/30 border-border/40 rounded-lg"
                />
                {typedTooShort && (
                  <p className="text-[12px] text-destructive">Must be at least {minLength} digits.</p>
                )}
                {typedSimple && (
                  <p className="text-[12px] text-amber-600">Avoid simple sequences like 1234.</p>
                )}
              </div>
              <div className="space-y-1.5">
                <label className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                  Confirm PIN
                </label>
                <Input
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  className="h-10 text-[16px] font-mono tracking-[0.3em] bg-muted/30 border-border/40 rounded-lg"
                />
                {confirmMismatch && (
                  <p className="text-[12px] text-destructive">PINs do not match.</p>
                )}
              </div>
              <Button
                onClick={saveTyped}
                disabled={!canSubmitTyped}
                className="w-full h-10 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[13px] font-medium"
              >
                {upsertPin.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                Save my PIN
              </Button>
            </div>
          )}

          {error && (
            <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-[13px] text-destructive">
              {error}
            </div>
          )}

          <p className="text-[12px] text-muted-foreground">
            For security we never store readable PINs. If you forget yours, generate a new one here.
          </p>
        </div>
      </div>
    </div>
  );
}

export default EmployeePin;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -- EmployeePin.test.tsx`
Expected: all 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/pages/EmployeePin.tsx tests/unit/EmployeePin.test.tsx
git commit -m "feat(employee): /employee/pin self-service page (generate / type my own)"
```

---

## Task 8: Register route + add nav entry

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/pages/EmployeeMore.tsx`

- [ ] **Step 1: Add the route**

Look at `src/App.tsx` for the existing `/employee/timecard` route. Add this next to it (use the same `ProtectedRoute`/guard wrapper that route uses):

```typescript
import EmployeePin from './pages/EmployeePin';

// ... inside <Routes>, alongside /employee/timecard, /employee/portal, etc.
<Route path="/employee/pin" element={
  <ProtectedRoute>
    <MobileLayout>
      <EmployeePin />
    </MobileLayout>
  </ProtectedRoute>
} />
```

If the existing routes use a different wrapper or layout component name, match exactly what `/employee/timecard` uses — search the file for `EmployeeTimecard` to find the pattern.

- [ ] **Step 2: Add the nav entry**

Modify `src/pages/EmployeeMore.tsx` — add `KeyRound` to the lucide import and insert a `Kiosk PIN` item in `mainItems` (between `Timecard` and `Requests`):

```typescript
import { Clock, CalendarCheck, ShoppingBag, Coins, Settings, ChevronRight, KeyRound, type LucideIcon } from 'lucide-react';
```

```typescript
const mainItems: NavItem[] = [
  { path: '/employee/timecard', label: 'Timecard',           description: 'Hours worked this period',   icon: Clock },
  { path: '/employee/pin',      label: 'Kiosk PIN',          description: 'Set or reset your kiosk PIN', icon: KeyRound },
  { path: '/employee/portal',   label: 'Requests',           description: 'Time off & availability',     icon: CalendarCheck },
  { path: '/employee/shifts',   label: 'Shift Marketplace',  description: 'Pick up available shifts',    icon: ShoppingBag },
  { path: '/employee/tips',     label: 'Tips',               description: 'Tip history & breakdown',     icon: Coins },
];
```

- [ ] **Step 3: Run type-check + tests**

Run: `npm run typecheck && npm run test -- EmployeeMore.test.tsx`
Expected: type-check passes; if the `EmployeeMore.test.tsx` test asserts an exact item count or order, update it to expect 5 items including "Kiosk PIN".

- [ ] **Step 4: Manual smoke test**

Sign in as a staff user. Open the mobile More tab → "Kiosk PIN" link appears → tap it → page loads at `/employee/pin`. With no PIN set: "Generate for me" produces a new PIN displayed in the green panel. Verify the kiosk accepts that PIN.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx src/pages/EmployeeMore.tsx
git commit -m "feat(employee): register /employee/pin route and More nav entry"
```

---

## Self-Review

After the eight tasks above, run a final pass:

- [ ] **Spec coverage walkthrough.** Re-read the spec sections A–D and confirm each maps to a task: A (reveal modal) → Tasks 4 + 5; B (manager hint) → Task 6; C (notification function + actor) → Tasks 2 + 3; D (`/employee/pin`) → Tasks 7 + 8. RLS change → Task 1.

- [ ] **Run the full local verify suite.**

```bash
npm run typecheck && npm run lint && npm run test && npm run test:db && npm run build
```
Expected: all green.

- [ ] **Lessons capture.** After CI is green and the PR is merging, add an entry to `memory/lessons.md` under the appropriate category capturing any non-obvious finding from this implementation (e.g., RLS `(select auth.uid())` performance pattern adoption, or any edge function quirk encountered).
