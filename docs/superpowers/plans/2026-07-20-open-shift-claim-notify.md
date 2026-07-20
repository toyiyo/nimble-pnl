# Open Shift Claim Decision Notifications — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Notify the claiming employee (email + web push) when a manager approves or rejects their open-shift claim, persist the manager's reviewer note, and make the dialog's "will be notified" promise truthful.

**Architecture:** A new migration adds a `reviewer_note` column and updates the two claim RPCs to persist it (preserving `SECURITY DEFINER`). A new `open_shift_claim_reviewed` type is added to the admin notification matrix (3 synced lists + CHECK + sync test). A new `notify-open-shift-claim` edge function (mirroring `send-shift-trade-notification`) sends email + web push to the claimant; its recipient/content logic lives in a pure, unit-tested `_shared` helper. The client hooks invoke it fire-and-forget after RPC success. The dialog banner is extended to reject and refactored onto shadcn `Alert`.

**Tech Stack:** Supabase Postgres (plpgsql RPC, pgTAP), Deno edge functions, Resend email, web-push, React + React Query, shadcn/ui, Vitest.

**Reference spec:** `docs/superpowers/specs/2026-07-20-open-shift-claim-notify-design.md`

**Lessons in force:** never embed `public→auth` for emails (fetch from `employees` directly); `supabase.functions.invoke()` resolves `{data,error}` on HTTP failures and only rejects on transport failures — notification must be fire-and-forget; no hardcoded past dates in pgTAP (use `CURRENT_DATE + n`); re-run the full vitest suite after touching `useOpenShiftClaims.ts`.

---

## File Structure

- Create `supabase/migrations/20260721000000_open_shift_claim_notify.sql` — reviewer_note column, RPC updates, CHECK extension, comment fix.
- Create `supabase/tests/open_shift_claim_reviewer_note.test.sql` — pgTAP: note persists on approve/reject.
- Modify `supabase/functions/_shared/resolveChannels.ts` — add type to union.
- Modify `src/lib/notificationTypes.ts` — add type to union + catalog.
- Modify `tests/unit/notificationTypes.test.ts` — mirror list + count 16.
- Create `supabase/functions/_shared/openShiftClaimNotify.ts` — pure recipient/content helper.
- Create `tests/unit/openShiftClaimNotify.test.ts` — helper unit tests.
- Create `supabase/functions/notify-open-shift-claim/index.ts` — edge function glue.
- Modify `src/hooks/useOpenShiftClaims.ts` — fire-and-forget notify after approve/reject.
- Create `tests/unit/useOpenShiftClaims.notify.test.ts` — invoke-on-success + swallow-failure.
- Modify `src/components/schedule/TradeApprovalQueue.tsx` — Alert banner on approve + reject.

---

## Task 1: Migration — reviewer_note column + RPC persistence + CHECK extension

**Files:**
- Create: `supabase/migrations/20260721000000_open_shift_claim_notify.sql`
- Reference (AUTHORITATIVE/latest `approve` body — has the tz `AT TIME ZONE` fix AND the is_active guard): `supabase/migrations/20260707090000_approve_open_shift_claim_active_guard.sql`
- Reference (AUTHORITATIVE/latest `reject` body — never redefined since original): `supabase/migrations/20260412145842_open_shift_claims.sql:434-469`
- Reference (CHECK + comment): `supabase/migrations/20260719120000_notification_channel_settings.sql:24-42,92`

> **CRITICAL — do not copy `approve` from the original `20260412145842` migration.** That version was superseded twice: `20260413001912_fix_shift_claim_timezone.sql` (timezone `::timestamp AT TIME ZONE v_tz`) and `20260707090000_approve_open_shift_claim_active_guard.sql` (the `is_active` guard). Copying the stale body would silently revert both fixes and break `supabase/tests/61_approve_open_shift_claim_active_guard.test.sql`. The `approve` body below is the current authoritative one + only the `reviewer_note` line.

- [ ] **Step 1: Write the migration file**

```sql
-- ============================================================================
-- Open Shift Claims: persist reviewer note + notify claimant on approve/reject
-- ============================================================================

-- A) reviewer_note column (nullable, no default; table is small & net-new — no lock concern)
ALTER TABLE public.open_shift_claims
    ADD COLUMN IF NOT EXISTS reviewer_note TEXT;

-- B) approve_open_shift_claim — verbatim copy of 20260412145842 body + reviewer_note.
--    NOTE: CREATE OR REPLACE does NOT preserve SECURITY DEFINER — it MUST be
--    re-declared below or the function silently reverts to SECURITY INVOKER and
--    the definer-rights INSERT/UPDATE break under RLS. Do not remove it.
CREATE OR REPLACE FUNCTION public.approve_open_shift_claim(
    p_claim_id UUID,
    p_reviewer_note TEXT DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_tz TEXT;
    v_claim RECORD;
    v_template RECORD;
    v_shift_id UUID;
    v_shift_start TIMESTAMPTZ;
    v_shift_end TIMESTAMPTZ;
BEGIN
    -- Lock the claim
    SELECT * INTO v_claim
    FROM public.open_shift_claims
    WHERE id = p_claim_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'error', 'Claim not found');
    END IF;

    IF v_claim.status != 'pending_approval' THEN
        RETURN json_build_object('success', false, 'error', 'Claim is not pending approval');
    END IF;

    -- Look up the restaurant timezone (after fetching the claim to get restaurant_id)
    SELECT COALESCE(r.timezone, 'America/Chicago') INTO v_tz
    FROM public.restaurants r WHERE r.id = v_claim.restaurant_id;

    -- Get the template
    SELECT * INTO v_template
    FROM public.shift_templates
    WHERE id = v_claim.shift_template_id;

    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'error', 'Template not found');
    END IF;

    -- Guard: a hidden (soft-archived) template must not be approvable into a shift.
    IF NOT v_template.is_active THEN
        RETURN json_build_object('success', false, 'error', 'This shift is no longer available');
    END IF;

    -- Build shift timestamps — cast to timestamp (no tz) first, then interpret in restaurant timezone
    v_shift_start := (v_claim.shift_date || ' ' || v_template.start_time)::timestamp AT TIME ZONE v_tz;
    v_shift_end := (v_claim.shift_date || ' ' || v_template.end_time)::timestamp AT TIME ZONE v_tz;

    IF v_template.end_time <= v_template.start_time THEN
        v_shift_end := v_shift_end + interval '1 day';
    END IF;

    -- Create the shift
    INSERT INTO public.shifts (
        restaurant_id, employee_id, start_time, end_time,
        break_duration, position, status, source, is_published
    ) VALUES (
        v_claim.restaurant_id, v_claim.claimed_by_employee_id,
        v_shift_start, v_shift_end,
        v_template.break_duration, v_template.position, 'scheduled', 'template', true
    )
    RETURNING id INTO v_shift_id;

    -- Update the claim (now persists reviewer_note)
    UPDATE public.open_shift_claims
    SET status = 'approved',
        resulting_shift_id = v_shift_id,
        reviewer_note = p_reviewer_note,
        reviewed_by = auth.uid(),
        reviewed_at = now()
    WHERE id = p_claim_id;

    RETURN json_build_object(
        'success', true,
        'shift_id', v_shift_id,
        'message', 'Claim approved and shift created'
    );
END;
$$;

-- C) reject_open_shift_claim — verbatim copy + reviewer_note. Same SECURITY DEFINER caveat.
CREATE OR REPLACE FUNCTION public.reject_open_shift_claim(
    p_claim_id UUID,
    p_reviewer_note TEXT DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_claim RECORD;
BEGIN
    SELECT * INTO v_claim
    FROM public.open_shift_claims
    WHERE id = p_claim_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'error', 'Claim not found');
    END IF;

    IF v_claim.status != 'pending_approval' THEN
        RETURN json_build_object('success', false, 'error', 'Claim is not pending approval');
    END IF;

    UPDATE public.open_shift_claims
    SET status = 'rejected',
        reviewer_note = p_reviewer_note,
        reviewed_by = auth.uid(),
        reviewed_at = now()
    WHERE id = p_claim_id;

    RETURN json_build_object(
        'success', true,
        'message', 'Claim rejected'
    );
END;
$$;

-- D) Extend notification_channel_settings type catalog with open_shift_claim_reviewed.
--    A CHECK constraint can't be ALTERed in place; drop + re-add. The re-add takes a
--    brief ACCESS EXCLUSIVE lock + full-table revalidation — fine here (table is
--    restaurants × ~16 types, low thousands of rows).
ALTER TABLE public.notification_channel_settings
    DROP CONSTRAINT IF EXISTS notification_channel_settings_type_check;

ALTER TABLE public.notification_channel_settings
    ADD CONSTRAINT notification_channel_settings_type_check
    CHECK (notification_type IN (
      'schedule_published',
      'shift_created',
      'shift_modified',
      'shift_deleted',
      'open_shifts_broadcast',
      'shift_trade_created',
      'shift_trade_accepted',
      'shift_trade_approved',
      'shift_trade_rejected',
      'shift_trade_cancelled',
      'time_off_requested',
      'time_off_approved',
      'time_off_rejected',
      'pin_reset',
      'availability_reminder',
      'open_shift_claim_reviewed'
    ));

-- E) Keep the catalog-count doc comment in sync (was "15 catalog keys").
COMMENT ON COLUMN public.notification_channel_settings.notification_type IS
  'One of the 16 catalog keys in src/lib/notificationTypes.ts — kept in sync with the CHECK constraint above. (team_invite is excluded: a transactional invite email is always sent, not admin-toggleable.)';
```

- [ ] **Step 2: Apply migration locally**

Run: `npm run db:reset`
Expected: completes without error; migration `20260721000000_open_shift_claim_notify` applied.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260721000000_open_shift_claim_notify.sql
git commit -m "feat(scheduling): persist open-shift-claim reviewer note + add notify type"
```

---

## Task 2: pgTAP — reviewer_note persists on approve/reject

**Files:**
- Create: `supabase/tests/open_shift_claim_reviewer_note.test.sql`
- Reference for fixture style: `supabase/tests/` (existing open_shift_claim tests)

- [ ] **Step 1: Write the pgTAP test (dynamic future dates — never hardcode)**

```sql
-- reviewer_note persistence for approve/reject. Fixture structure mirrors
-- 61_approve_open_shift_claim_active_guard.test.sql (RLS disabled in-txn,
-- SECURITY DEFINER functions run as postgres, dynamic CURRENT_DATE+N, two
-- pending claims for two employees since the unique index forbids two active
-- claims for the same employee/template/date).

BEGIN;
SELECT plan(4);

SET LOCAL role TO postgres;
ALTER TABLE public.restaurants        DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.employees          DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.shifts             DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.shift_templates    DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.open_shift_claims  DISABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  v_rid   uuid := '00000000-0000-0000-0000-0000000000fa';
  v_emp1  uuid := '00000000-0000-0000-0000-0000000000f1';
  v_emp2  uuid := '00000000-0000-0000-0000-0000000000f2';
  v_tmpl  uuid := '00000000-0000-0000-0000-0000000000f3';
  v_c1    uuid := '00000000-0000-0000-0000-0000000000f5';
  v_c2    uuid := '00000000-0000-0000-0000-0000000000f6';
  v_d     date := CURRENT_DATE + 5;
  v_dow   int;
BEGIN
  v_dow := EXTRACT(DOW FROM v_d)::int;

  DELETE FROM public.open_shift_claims WHERE restaurant_id = v_rid;
  DELETE FROM public.shifts            WHERE restaurant_id = v_rid;
  DELETE FROM public.shift_templates   WHERE restaurant_id = v_rid;
  DELETE FROM public.employees         WHERE restaurant_id = v_rid;
  DELETE FROM public.restaurants       WHERE id = v_rid;

  INSERT INTO public.restaurants(id, name, timezone)
    VALUES (v_rid, 'note-persist-test', 'America/Chicago')
    ON CONFLICT (id) DO UPDATE SET timezone = EXCLUDED.timezone;

  INSERT INTO public.employees(id, restaurant_id, name, position, is_active, status)
    VALUES (v_emp1, v_rid, 'E1', 'Server', true, 'active'),
           (v_emp2, v_rid, 'E2', 'Server', true, 'active')
    ON CONFLICT (id) DO UPDATE SET position = EXCLUDED.position;

  INSERT INTO public.shift_templates(
      id, restaurant_id, name, start_time, end_time, position, capacity,
      days, is_active, break_duration
  ) VALUES (
      v_tmpl, v_rid, 'Server 12-18', '12:00'::time, '18:00'::time, 'Server', 2,
      ARRAY[v_dow], true, 0
  ) ON CONFLICT (id) DO UPDATE SET days = EXCLUDED.days, is_active = true;

  INSERT INTO public.open_shift_claims(
      id, restaurant_id, shift_template_id, shift_date, claimed_by_employee_id, status
  ) VALUES
      (v_c1, v_rid, v_tmpl, v_d, v_emp1, 'pending_approval'),
      (v_c2, v_rid, v_tmpl, v_d, v_emp2, 'pending_approval');
END $$;

-- Approve with a note.
SELECT is(
  (public.approve_open_shift_claim('00000000-0000-0000-0000-0000000000f5'::uuid,
     'Approved: welcome aboard') ->> 'success'),
  'true',
  'approve_open_shift_claim succeeds with a reviewer note');

SELECT is(
  (SELECT reviewer_note FROM public.open_shift_claims
   WHERE id = '00000000-0000-0000-0000-0000000000f5'),
  'Approved: welcome aboard',
  'approve persists reviewer_note');

-- Reject with a note.
SELECT is(
  (public.reject_open_shift_claim('00000000-0000-0000-0000-0000000000f6'::uuid,
     'Rejected: already covered') ->> 'success'),
  'true',
  'reject_open_shift_claim succeeds with a reviewer note');

SELECT is(
  (SELECT reviewer_note FROM public.open_shift_claims
   WHERE id = '00000000-0000-0000-0000-0000000000f6'),
  'Rejected: already covered',
  'reject persists reviewer_note');

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 2: Run the pgTAP test**

Run: `npm run test:db`
Expected: the new file passes all 4 assertions. If a fixture column name is wrong (e.g. `employees.status` vs `is_active`), fix the INSERT to match the live schema (`\d public.employees` / `\d public.shift_templates`) and re-run.

- [ ] **Step 3: Commit**

```bash
git add supabase/tests/open_shift_claim_reviewer_note.test.sql
git commit -m "test(db): reviewer_note persists on open-shift-claim approve/reject"
```

---

## Task 3: Register the `open_shift_claim_reviewed` notification type

**Files:**
- Modify: `supabase/functions/_shared/resolveChannels.ts:11-26` (union)
- Modify: `src/lib/notificationTypes.ts:13-28` (union) and `:44-63` (catalog)
- Modify: `tests/unit/notificationTypes.test.ts` (RESOLVER_TYPES mirror + count)

- [ ] **Step 1: Update the sync test first (RED)**

In `tests/unit/notificationTypes.test.ts`: add `'open_shift_claim_reviewed'` to the `RESOLVER_TYPES` array (after `'availability_reminder'`), and change `expect(NOTIFICATION_TYPES).toHaveLength(15)` to `toHaveLength(16)`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/notificationTypes.test.ts`
Expected: FAIL — catalog has 15 rows / drift-guard mismatch (resolver union doesn't yet include the key).

- [ ] **Step 3: Add the type to the resolver union**

In `supabase/functions/_shared/resolveChannels.ts`, add to the `NotificationType` union (after `| 'availability_reminder'`):

```ts
  | 'availability_reminder'
  | 'open_shift_claim_reviewed';
```

- [ ] **Step 4: Add the type to the frontend union + catalog**

In `src/lib/notificationTypes.ts`, add to the union (after `| 'availability_reminder'`):

```ts
  | 'availability_reminder'
  | 'open_shift_claim_reviewed';
```

And add a catalog row to `NOTIFICATION_TYPES` in the `Scheduling` group (e.g. right after the `open_shifts_broadcast` row):

```ts
  { key: 'open_shift_claim_reviewed', label: 'Open shift claim reviewed', group: 'Scheduling', channels: ['email', 'push'] },
```

- [ ] **Step 5: Run the sync test to verify it passes**

Run: `npx vitest run tests/unit/notificationTypes.test.ts`
Expected: PASS (16 rows, drift guard green).

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/_shared/resolveChannels.ts src/lib/notificationTypes.ts tests/unit/notificationTypes.test.ts
git commit -m "feat(notify): register open_shift_claim_reviewed notification type"
```

---

## Task 4: Pure notification helper `openShiftClaimNotify.ts`

**Files:**
- Create: `supabase/functions/_shared/openShiftClaimNotify.ts`
- Test: `tests/unit/openShiftClaimNotify.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import {
  buildClaimNotificationContent,
  type ClaimNotifyInput,
} from '../../supabase/functions/_shared/openShiftClaimNotify';

const base: ClaimNotifyInput = {
  action: 'approved',
  employeeName: 'Jordan Lee',
  templateName: 'Morning Line',
  position: 'Cook',
  shiftDateLocal: 'Saturday, July 25, 2026',
  startTime: '09:00',
  endTime: '17:00',
  restaurantName: 'Taco Town',
  reviewerNote: null,
};

describe('buildClaimNotificationContent', () => {
  it('approved: subject/heading reflect approval', () => {
    const c = buildClaimNotificationContent({ ...base, action: 'approved' });
    expect(c.subject).toMatch(/approved/i);
    expect(c.heading).toMatch(/approved/i);
    expect(c.pushBody).toContain('Morning Line');
  });

  it('rejected: subject/heading reflect rejection', () => {
    const c = buildClaimNotificationContent({ ...base, action: 'rejected' });
    expect(c.subject).toMatch(/(rejected|declined)/i);
    expect(c.heading).toMatch(/(rejected|declined)/i);
  });

  it('includes the reviewer note when present', () => {
    const c = buildClaimNotificationContent({ ...base, reviewerNote: 'See you then' });
    expect(c.emailHtml).toContain('See you then');
  });

  it('omits the note block when note is null', () => {
    const c = buildClaimNotificationContent({ ...base, reviewerNote: null });
    expect(c.emailHtml).not.toMatch(/Manager Note/i);
  });

  it('escapes HTML in interpolated values', () => {
    const c = buildClaimNotificationContent({
      ...base,
      employeeName: '<script>x</script>',
      reviewerNote: 'a & b <b>',
    });
    expect(c.emailHtml).not.toContain('<script>x</script>');
    expect(c.emailHtml).toContain('&lt;script&gt;');
    expect(c.emailHtml).toContain('a &amp; b &lt;b&gt;');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/openShiftClaimNotify.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helper**

```ts
// Pure recipient/content logic for notify-open-shift-claim, extracted so it is
// unit-testable without a Deno runtime (mirrors _shared/tradeEmailAudience.ts).
// IMPORTANT: this helper takes pre-split LOCAL date/time strings — never a
// timestamptz. The claim's shift_date (DATE) + template start/end (TIME) are
// already restaurant-local wall-clock; do not round-trip them through
// ::timestamptz + formatDateTime (that reintroduces the documented off-by-one).

export type ClaimAction = 'approved' | 'rejected';

export interface ClaimNotifyInput {
  action: ClaimAction;
  employeeName: string;
  templateName: string;
  position: string;
  shiftDateLocal: string; // already formatted local date, e.g. "Saturday, July 25, 2026"
  startTime: string;      // "09:00"
  endTime: string;        // "17:00"
  restaurantName: string;
  reviewerNote: string | null;
}

export interface ClaimNotificationContent {
  subject: string;
  heading: string;
  pushBody: string;
  emailHtml: string;
}

const escapeHtml = (str: string): string =>
  str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

export function buildClaimNotificationContent(
  input: ClaimNotifyInput,
): ClaimNotificationContent {
  const approved = input.action === 'approved';
  const statusText = approved ? 'Approved' : 'Rejected';
  const statusColor = approved ? '#10b981' : '#ef4444';

  const name = escapeHtml(input.employeeName);
  const template = escapeHtml(input.templateName);
  const position = escapeHtml(input.position);
  const dateLocal = escapeHtml(input.shiftDateLocal);
  const start = escapeHtml(input.startTime);
  const end = escapeHtml(input.endTime);
  const restaurant = escapeHtml(input.restaurantName);
  const note = input.reviewerNote ? escapeHtml(input.reviewerNote) : null;

  const subject = approved
    ? 'Your Shift Claim Was Approved'
    : 'Your Shift Claim Was Rejected';
  const heading = approved
    ? 'Your Shift Claim Has Been Approved'
    : 'Your Shift Claim Has Been Rejected';
  const message = approved
    ? `Your claim for ${template} has been approved. The shift has been added to your schedule.`
    : `Your claim for ${template} has been rejected.`;
  const pushBody = approved
    ? `Your claim for ${input.templateName} was approved. Check your schedule.`
    : `Your claim for ${input.templateName} was rejected.`;

  const appUrl = 'https://app.easyshifthq.com/employee/shifts';

  const emailHtml = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;background-color:#f3f4f6;">
  <div style="max-width:600px;margin:0 auto;background-color:#ffffff;">
    <div style="padding:40px 32px;">
      <h1 style="color:#1f2937;font-size:24px;font-weight:600;margin:0 0 16px 0;">${escapeHtml(heading)}</h1>
      <div style="margin-bottom:24px;"><span style="background-color:${statusColor};color:#fff;padding:6px 14px;border-radius:6px;font-size:14px;font-weight:600;">${statusText}</span></div>
      <p style="color:#4b5563;line-height:1.6;font-size:16px;margin:0 0 24px 0;">Hi <strong style="color:#1f2937;">${name}</strong>,</p>
      <p style="color:#4b5563;line-height:1.6;font-size:16px;margin:0 0 24px 0;">${message}</p>
      <div style="background:linear-gradient(135deg,#f0fdf4 0%,#dcfce7 100%);padding:24px;border-radius:12px;margin:24px 0;border-left:4px solid ${statusColor};">
        <table style="width:100%;border-collapse:collapse;">
          <tr><td style="padding:6px 0;color:#4b5563;font-size:14px;font-weight:600;">Restaurant:</td><td style="padding:6px 0;color:#1f2937;font-size:14px;text-align:right;">${restaurant}</td></tr>
          <tr><td style="padding:6px 0;color:#4b5563;font-size:14px;font-weight:600;">Shift:</td><td style="padding:6px 0;color:#1f2937;font-size:14px;text-align:right;">${template}</td></tr>
          <tr><td style="padding:6px 0;color:#4b5563;font-size:14px;font-weight:600;">Position:</td><td style="padding:6px 0;color:#1f2937;font-size:14px;text-align:right;">${position}</td></tr>
          <tr><td style="padding:6px 0;color:#4b5563;font-size:14px;font-weight:600;">Date:</td><td style="padding:6px 0;color:#1f2937;font-size:14px;text-align:right;">${dateLocal}</td></tr>
          <tr><td style="padding:6px 0;color:#4b5563;font-size:14px;font-weight:600;">Time:</td><td style="padding:6px 0;color:#1f2937;font-size:14px;text-align:right;">${start} – ${end}</td></tr>
        </table>
      </div>
      ${note ? `<div style="background-color:#fef3c7;border-left:4px solid #f59e0b;border-radius:4px;padding:16px;margin:24px 0;"><p style="margin:0 0 8px;color:#92400e;font-size:14px;font-weight:600;">Manager Note:</p><p style="margin:0;color:#78350f;font-size:14px;line-height:1.5;">${note}</p></div>` : ''}
      <div style="text-align:center;margin:32px 0;"><a href="${appUrl}" style="background:linear-gradient(135deg,#3b82f6 0%,#2563eb 100%);color:#ffffff !important;padding:14px 32px;text-decoration:none;border-radius:8px;display:inline-block;font-weight:600;font-size:16px;border:2px solid #2563eb;"><span style="color:#ffffff !important;">View My Shifts</span></a></div>
      <p style="color:#6b7280;font-size:14px;margin:32px 0 0 0;line-height:1.6;">If you have any questions, please contact your manager.</p>
    </div>
    <div style="background-color:#f9fafb;padding:24px 32px;border-top:1px solid #e5e7eb;">
      <p style="color:#6b7280;font-size:13px;text-align:center;margin:0;line-height:1.5;"><strong style="color:#4b5563;">EasyShiftHQ</strong><br>Restaurant Operations Management System</p>
      <p style="color:#9ca3af;font-size:12px;text-align:center;margin:8px 0 0 0;">This is an automated notification. Please do not reply to this email.</p>
    </div>
  </div>
</body>
</html>`;

  return { subject, heading, pushBody, emailHtml };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/openShiftClaimNotify.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/openShiftClaimNotify.ts tests/unit/openShiftClaimNotify.test.ts
git commit -m "feat(notify): pure content helper for open-shift-claim notifications"
```

---

## Task 5: Edge function `notify-open-shift-claim`

**Files:**
- Create: `supabase/functions/notify-open-shift-claim/index.ts`
- Reference: `supabase/functions/send-shift-trade-notification/index.ts` (auth + admin-client + resolveChannels + push pattern), `supabase/functions/broadcast-open-shifts/index.ts` (sendEmail + resolveChannels)

> No standalone Deno test (matches the trade function, which also has none — logic is covered by the Task 4 helper tests). This task is thin glue; verified end-to-end in Phase 8 typecheck/build and manually.

- [ ] **Step 1: Implement the edge function**

```ts
import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { sendEmail, NOTIFICATION_FROM } from "../_shared/notificationHelpers.ts";
import { sendWebPushToUser } from "../_shared/webPushHelper.ts";
import { resolveChannels, type SupabaseLike } from "../_shared/resolveChannels.ts";
import { buildClaimNotificationContent, type ClaimAction } from "../_shared/openShiftClaimNotify.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const EMPLOYEE_SHIFTS_ROUTE = "/employee/shifts";

interface RequestBody {
  claimId: string;
  action: ClaimAction;
}

// Format a DATE ('2026-07-25') as a local long date without any timezone cast.
const formatLocalDate = (isoDate: string): string => {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d)); // UTC constructor + UTC getters = no tz shift
  return dt.toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC",
  });
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing authorization header");

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    // JWT client only for auth.getUser(); admin client for all data + push reads.
    const supabase = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
      global: { headers: { Authorization: authHeader } },
    });
    const admin = createClient(supabaseUrl, serviceKey);

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) throw new Error("Unauthorized");

    const { claimId, action }: RequestBody = await req.json();
    if (!claimId || (action !== "approved" && action !== "rejected")) {
      return new Response(JSON.stringify({ error: "claimId and action ('approved'|'rejected') are required" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 });
    }

    // Fetch the claim + joins via admin (RLS would zero out the employee's own row for a manager caller).
    const { data: claim, error: claimError } = await admin
      .from("open_shift_claims")
      .select(`
        id, restaurant_id, shift_date, reviewer_note,
        shift_template:shift_templates(name, start_time, end_time, position),
        employee:employees!claimed_by_employee_id(name, email, user_id),
        restaurant:restaurants(name)
      `)
      .eq("id", claimId)
      .single();

    if (claimError || !claim) {
      return new Response(JSON.stringify({ error: "Claim not found" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 404 });
    }

    // Caller must be an owner/manager of this claim's restaurant.
    const { data: membership } = await admin
      .from("user_restaurants")
      .select("role")
      .eq("user_id", user.id)
      .eq("restaurant_id", claim.restaurant_id)
      .maybeSingle();
    if (!membership || !["owner", "manager"].includes(membership.role)) {
      return new Response(JSON.stringify({ error: "Forbidden" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 403 });
    }

    const tmpl = claim.shift_template as unknown as { name: string; start_time: string; end_time: string; position: string } | null;
    const emp = claim.employee as unknown as { name: string; email: string | null; user_id: string | null } | null;
    const rest = claim.restaurant as unknown as { name: string } | null;

    const content = buildClaimNotificationContent({
      action,
      employeeName: emp?.name ?? "there",
      templateName: tmpl?.name ?? "your shift",
      position: tmpl?.position ?? "—",
      shiftDateLocal: formatLocalDate(claim.shift_date),
      startTime: tmpl?.start_time ?? "",
      endTime: tmpl?.end_time ?? "",
      restaurantName: rest?.name ?? "Your Restaurant",
      reviewerNote: claim.reviewer_note ?? null,
    });

    const ch = await resolveChannels(admin as unknown as SupabaseLike, claim.restaurant_id, "open_shift_claim_reviewed");

    let emailSent = false;
    let pushSent = 0;

    if (ch.email && RESEND_API_KEY && emp?.email) {
      try {
        emailSent = await sendEmail(RESEND_API_KEY, NOTIFICATION_FROM, emp.email, content.subject, content.emailHtml);
      } catch (e) {
        console.error("Claim notify email failed:", e);
      }
    }

    if (ch.push && emp?.user_id) {
      try {
        const r = await sendWebPushToUser(admin, emp.user_id, claim.restaurant_id, {
          title: content.heading,
          body: content.pushBody,
          url: EMPLOYEE_SHIFTS_ROUTE,
          tag: `claim-${action}-${claimId}`,
        });
        pushSent = r.sent;
      } catch (e) {
        console.error("Claim notify push failed:", e);
      }
    }

    return new Response(JSON.stringify({ success: true, emailSent, pushSent }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 });
  } catch (error: unknown) {
    console.error("Error in notify-open-shift-claim:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "An error occurred" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 });
  }
});
```

- [ ] **Step 2: Verify the WebPushPayload accepts `tag`**

Run: `grep -n "interface WebPushPayload" -A 8 supabase/functions/_shared/webPushHelper.ts`
Expected: the payload type includes an optional `tag?: string`. If it does NOT, drop the `tag` field from the `sendWebPushToUser` call above.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/notify-open-shift-claim/index.ts
git commit -m "feat(notify): notify-open-shift-claim edge function (email + web push)"
```

---

## Task 6: Client wiring — invoke notify after approve/reject

**Files:**
- Modify: `src/hooks/useOpenShiftClaims.ts:75-126`
- Test: `tests/unit/useOpenShiftClaims.notify.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const invokeMock = vi.fn();
const rpcMock = vi.fn();

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    rpc: (...a: unknown[]) => rpcMock(...a),
    functions: { invoke: (...a: unknown[]) => invokeMock(...a) },
  },
}));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

import { useApproveClaimMutation, useRejectClaimMutation } from '@/hooks/useOpenShiftClaims';

const wrapper = ({ children }: { children: React.ReactNode }) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
};

beforeEach(() => {
  invokeMock.mockReset();
  rpcMock.mockReset();
  rpcMock.mockResolvedValue({ data: { success: true }, error: null });
  invokeMock.mockResolvedValue({ data: { success: true }, error: null });
});

describe('useApproveClaimMutation', () => {
  it('invokes notify-open-shift-claim with action "approved" after RPC success', async () => {
    const { result } = renderHook(() => useApproveClaimMutation(), { wrapper });
    result.current.mutate({ claimId: 'c1', note: 'ok' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invokeMock).toHaveBeenCalledWith('notify-open-shift-claim', {
      body: { claimId: 'c1', action: 'approved' },
    });
  });

  it('still succeeds when the notify invoke resolves with an error (fire-and-forget)', async () => {
    invokeMock.mockResolvedValue({ data: null, error: { message: '500' } });
    const { result } = renderHook(() => useApproveClaimMutation(), { wrapper });
    result.current.mutate({ claimId: 'c1' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it('still succeeds when the notify invoke rejects (transport failure)', async () => {
    invokeMock.mockRejectedValue(new Error('network down'));
    const { result } = renderHook(() => useApproveClaimMutation(), { wrapper });
    result.current.mutate({ claimId: 'c1' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });
});

describe('useRejectClaimMutation', () => {
  it('invokes notify with action "rejected" after RPC success', async () => {
    const { result } = renderHook(() => useRejectClaimMutation(), { wrapper });
    result.current.mutate({ claimId: 'c2', note: 'no' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invokeMock).toHaveBeenCalledWith('notify-open-shift-claim', {
      body: { claimId: 'c2', action: 'rejected' },
    });
  });

  it('does NOT invoke notify when the RPC returns success:false', async () => {
    rpcMock.mockResolvedValue({ data: { success: false, error: 'nope' }, error: null });
    const { result } = renderHook(() => useRejectClaimMutation(), { wrapper });
    result.current.mutate({ claimId: 'c2' });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/useOpenShiftClaims.notify.test.ts`
Expected: FAIL — notify invoke not called (hook doesn't send yet).

- [ ] **Step 3: Add the fire-and-forget helper and call it after RPC success**

In `src/hooks/useOpenShiftClaims.ts`, add near the top (after imports):

```ts
/**
 * Fire-and-forget claim-decision notification. Mirrors sendShiftTradeNotification.
 * `supabase.functions.invoke` resolves `{data,error}` on HTTP failures and only
 * rejects on transport failures — either way the caller must not fail the
 * approve/reject action (DB state is already committed).
 */
const sendClaimReviewNotification = async (
  claimId: string,
  action: 'approved' | 'rejected',
) => {
  try {
    await supabase.functions.invoke('notify-open-shift-claim', {
      body: { claimId, action },
    });
  } catch (err) {
    console.error('Failed to send claim review notification:', err);
  }
};
```

In `useApproveClaimMutation`'s `mutationFn`, after the `if (!result.success) throw ...` line and before `return result;`:

```ts
      if (!result.success) throw new Error(result.error ?? 'Failed to approve claim');
      await sendClaimReviewNotification(params.claimId, 'approved');
      return result;
```

In `useRejectClaimMutation`'s `mutationFn`, likewise:

```ts
      if (!result.success) throw new Error(result.error ?? 'Failed to reject claim');
      await sendClaimReviewNotification(params.claimId, 'rejected');
      return result;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/useOpenShiftClaims.notify.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Run the full suite (shared-hook lesson)**

Run: `npm run test`
Expected: all green — no regression in other `useOpenShiftClaims`/component consumers.

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useOpenShiftClaims.ts tests/unit/useOpenShiftClaims.notify.test.ts
git commit -m "feat(scheduling): notify claimant on open-shift-claim approve/reject"
```

---

## Task 7: UI — extend the "will be notified" banner to reject, on shadcn Alert

**Files:**
- Modify: `src/components/schedule/TradeApprovalQueue.tsx:15-50` (imports) and `:740-747` (claim banner)

- [ ] **Step 1: Add imports**

Add to the shadcn imports block:

```ts
import { Alert, AlertDescription } from '@/components/ui/alert';
```

Add `Info` to the existing `lucide-react` import list (alongside `AlertCircle`).

- [ ] **Step 2: Replace the approve-only banner with an approve+reject Alert**

Replace the existing block (currently rendered only for `claimActionType === 'approve'`):

```tsx
              {claimActionType === 'approve' && (
                <div className="flex items-start gap-2 rounded-lg bg-green-500/10 border border-green-500/20 p-3">
                  <AlertCircle className="mt-0.5 h-4 w-4 text-green-600 dark:text-green-400 shrink-0" />
                  <p className="text-[13px] text-green-700 dark:text-green-300">
                    The employee will be notified of your decision.
                  </p>
                </div>
              )}
```

with (renders for both actions; reject uses semantic-token subtle-surface + Info icon):

```tsx
              {claimActionType === 'approve' ? (
                <Alert className="bg-green-500/10 border-green-500/20">
                  <CheckCircle aria-hidden="true" className="h-4 w-4 text-green-600 dark:text-green-400" />
                  <AlertDescription className="text-[13px] text-green-700 dark:text-green-300">
                    The employee will be notified of your decision.
                  </AlertDescription>
                </Alert>
              ) : (
                <Alert className="border-border/40 bg-muted/30">
                  <Info aria-hidden="true" className="h-4 w-4 text-muted-foreground" />
                  <AlertDescription className="text-[13px] text-muted-foreground">
                    The employee will be notified of your decision.
                  </AlertDescription>
                </Alert>
              )}
```

- [ ] **Step 3: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: no errors from the touched file.

- [ ] **Step 4: Build sanity**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/components/schedule/TradeApprovalQueue.tsx
git commit -m "fix(scheduling): show 'will be notified' banner on claim reject too (shadcn Alert)"
```

---

## Task 8: Full verification pass

- [ ] **Step 1: Run everything**

Run: `npm run test && npm run test:db && npm run typecheck && npm run lint && npm run build`
Expected: all green. (E2E `npm run test:e2e` per Phase 8 if the environment supports it.)

- [ ] **Step 2: Update progress.md and proceed to Ship (Phase 9).**

---

## Self-Review notes

- **Spec coverage:** Component 1 → Task 1; Component 2 (registry) → Task 3; Component 3 (edge fn) → Tasks 4+5; Component 4 (client) → Task 6; Component 5 (UI) → Task 7; testing section → Tasks 2, 4, 6 + Task 8. All covered.
- **Type consistency:** helper export name `buildClaimNotificationContent` / `ClaimNotifyInput` / `ClaimAction` used identically in Tasks 4 and 5. Notify body shape `{ claimId, action }` identical in Tasks 5 and 6. Notification key `open_shift_claim_reviewed` identical in Tasks 1, 3, 5.
- **Open verification points flagged inline:** WebPushPayload `tag` support (Task 5 Step 2); pgTAP fixture column names vs live schema (Task 2 Step 2). Both have explicit fallback instructions.
