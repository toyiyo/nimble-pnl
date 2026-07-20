# Design: Notify employee on open-shift-claim approve/reject + persist reviewer note

**Date:** 2026-07-20
**Branch:** claude/cranky-jepsen-7b82fc
**Status:** Approved

## Problem

In the Open Shift Claiming feature, the manager approve/reject dialog
(`src/components/schedule/TradeApprovalQueue.tsx`) tells the manager
"The employee will be notified of your decision." — but no notification is
ever sent. Neither the client hooks (`src/hooks/useOpenShiftClaims.ts`) nor
the RPCs `approve_open_shift_claim` / `reject_open_shift_claim`
(`supabase/migrations/20260412145842_open_shift_claims.sql`) send any push,
email, or in-app notification. The claiming employee only learns the outcome
by re-opening `/employee/shifts` and noticing the status badge change
(Pending → approved/rejected).

Additionally, both RPCs accept a `p_reviewer_note TEXT` argument that is
**silently discarded** — there is no `reviewer_note` column on
`open_shift_claims` to persist it, and the manager's note (which the UI marks
"Recommended" on reject) is lost.

## Goal

Make the promise truthful: on approve **and** reject, notify the claiming
employee via email + web push (respecting the admin notification matrix),
persist the reviewer note, and surface the note in the notification.

## Non-goals

- Notifying managers of claims (that flows through the existing claim-request
  card render; out of scope).
- In-app notification center / bell UI (no such surface exists for this
  feature; email + web push match the broadcast/trade precedent).
- Changing the claim/approval RPC business logic (shift creation, capacity,
  conflict checks) — untouched.

## Approach

Mirror the proven `supabase/functions/send-shift-trade-notification`
pattern. That function is the closest analog: it already notifies a specific
employee on `approved`/`rejected`, gates each channel through
`resolveChannels`, includes a manager note in the email, and degrades
gracefully per channel. The open-shift-claim case is simpler — a single
recipient (the claimant), no marketplace broadcast.

### Component 1 — Migration `20260721000000_open_shift_claim_notify.sql`

1. `ALTER TABLE public.open_shift_claims ADD COLUMN IF NOT EXISTS reviewer_note TEXT;`
   (nullable; no default).
2. `CREATE OR REPLACE FUNCTION public.approve_open_shift_claim(p_claim_id UUID, p_reviewer_note TEXT DEFAULT NULL)`
   — identical body to the existing function **plus** `reviewer_note = p_reviewer_note`
   in the `UPDATE public.open_shift_claims SET ...` clause. Signature unchanged,
   so no `GRANT` churn and no client-signature break.
3. `CREATE OR REPLACE FUNCTION public.reject_open_shift_claim(...)` — same
   `reviewer_note = p_reviewer_note` addition to its `UPDATE`.
4. Extend the notification-type catalog: drop and re-add
   `notification_channel_settings_type_check` with the new value
   `open_shift_claim_reviewed` appended to the existing 15. (A CHECK
   constraint can't be `ALTER`-ed in place; drop + re-add is the standard
   pattern.)

Idempotency: `CREATE OR REPLACE` and `ADD COLUMN IF NOT EXISTS` are re-run
safe. The constraint drop uses `DROP CONSTRAINT IF EXISTS` before re-add.

### Component 2 — Notification-type registry (3 hand-synced lists + test)

The matrix keeps three hand-maintained copies of the type list in sync,
enforced by `tests/unit/notificationTypes.test.ts`. Add one type,
`open_shift_claim_reviewed`, to all three:

- `supabase/functions/_shared/resolveChannels.ts` — add to the
  `NotificationType` union.
- `src/lib/notificationTypes.ts` — add to the union **and** the
  `NOTIFICATION_TYPES` catalog as
  `{ key: 'open_shift_claim_reviewed', label: 'Open shift claim reviewed', group: 'Scheduling', channels: ['email', 'push'] }`.
- The migration CHECK constraint (Component 1.4).
- `tests/unit/notificationTypes.test.ts` — add to the `RESOLVER_TYPES` mirror
  and bump `toHaveLength(15)` → `toHaveLength(16)`.

One combined type (not split approved/rejected) per product decision: the
claimant is the only recipient in both cases and admins want a single toggle.

### Component 3 — Edge function `notify-open-shift-claim/index.ts`

Fire-and-forget notifier, invoked by the client after the RPC succeeds.

- CORS preflight; require `Authorization` header.
- JWT-scoped client for `auth.getUser()`; **service-role `admin` client** for
  all data reads and the web-push subscription lookup (the trade function's
  documented reason: RLS silently returns zero rows for another user's
  subscription under a JWT client).
- Body: `{ claimId: string, action: 'approved' | 'rejected' }`. Validate both.
- Fetch the claim via `admin`:
  `open_shift_claims` row (status, restaurant_id, reviewer_note, shift_date)
  joined to `shift_templates` (name, start_time, end_time, position),
  `employees!claimed_by_employee_id` (name, email, user_id), and
  `restaurants` (name). Employee email/user_id fetched **directly from the
  `employees` table** — never via a `public→auth` PostgREST embed
  (lesson 2026-05-10: that embed silently returns null).
- Authorize caller: verify `user_restaurants` membership (owner/manager) for
  the claim's `restaurant_id` via `admin`. 403 otherwise. (Any authenticated
  user could otherwise POST an arbitrary `claimId`.)
- `resolveChannels(admin, restaurant_id, 'open_shift_claim_reviewed')`.
- Email (if `ch.email` and employee has an email): Resend, single recipient,
  approved/rejected subject + heading + body, shift details card (template
  name, date, time, position), reviewer-note block if present, deep link to
  `/employee/shifts`. HTML-escape all interpolated values (mirror the trade
  function's `escapeHtml`).
- Web push (if `ch.push` and employee has a `user_id`): `sendWebPushToUser`
  with title/body/url `/employee/shifts`.
- Each channel wrapped in try/catch → logged skip, never a false 500. Return
  `{ success: true, emailSent, pushSent }`.

Recipient/content selection (which employee, subject/body per action) is a
pure function extracted to `supabase/functions/_shared/openShiftClaimNotify.ts`
so it is unit-testable without a Deno runtime (mirrors
`tradeEmailAudience.ts`).

### Component 4 — Client wiring `src/hooks/useOpenShiftClaims.ts`

Add a module-level fire-and-forget helper mirroring
`sendShiftTradeNotification`:

```ts
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

Call it inside each mutation's `mutationFn` **after** the RPC returns success
(before returning the result), passing `'approved'` / `'rejected'`. Because
`invoke()` resolves `{ data, error }` on HTTP failures and only rejects on
transport errors (lesson 2026), the notification is intentionally
best-effort: a failed notification must not fail the approve/reject action
(the DB state is already committed).

### Component 5 — UI copy `src/components/schedule/TradeApprovalQueue.tsx`

The claim dialog's "The employee will be notified of your decision." banner
currently renders only when `claimActionType === 'approve'`. It is now
truthful; extend it to render on **reject** too (reject is where the note is
"Recommended"), so both paths honor the promise. Keep the existing
green-info styling for approve; use a neutral/muted style for reject so it
doesn't read as a success. Copy stays "The employee will be notified of your
decision."

## Data flow

```
Manager clicks Approve/Reject in dialog
  → useApproveClaimMutation / useRejectClaimMutation .mutate({ claimId, note })
    → RPC approve_open_shift_claim / reject_open_shift_claim (persists reviewer_note, updates status)
    → (on success) supabase.functions.invoke('notify-open-shift-claim', { claimId, action })
      → edge fn: auth + membership check → fetch claim/employee/template/restaurant
        → resolveChannels('open_shift_claim_reviewed')
        → email (Resend) + web push to the claiming employee
  → onSuccess: invalidate queries, toast, close dialog
```

## Error handling

- RPC failure → mutation rejects → existing `onError` toast; no notification
  attempted.
- Notification invoke failure → caught, logged, swallowed; approve/reject
  still succeeds (DB already committed).
- Edge fn: missing/invalid body → 400; unauthenticated → 401; non-member →
  403; claim not found → 404; per-channel send failure → logged, other
  channel still attempted, 200 with counts.
- `resolveChannels` fails open (both channels on) on error/missing row —
  unchanged, intentional.

## Testing

- **pgTAP** (`supabase/tests/`): `reviewer_note` persists after
  `approve_open_shift_claim` and `reject_open_shift_claim`; existing
  approve/reject behavior (status, resulting shift) unchanged. Use dynamic
  future dates (`CURRENT_DATE + n`), never hardcoded literals (lesson
  2026-04-13).
- **Vitest** (`tests/unit/`):
  - `useOpenShiftClaims`: approve and reject mutations invoke
    `notify-open-shift-claim` with the correct `action`, and a rejected/failed
    invoke does **not** fail the mutation (mock `invoke` resolving `{ error }`
    AND rejecting — both must be tolerated, per the fire-and-forget lesson).
  - `notificationTypes.test.ts`: updated to 16 types incl. the new key.
  - `openShiftClaimNotify.ts` pure helper: correct recipient + subject/body
    per action, note included when present, escaping.
- Full suite re-run after touching `useOpenShiftClaims` (shared-hook lesson).

## Decided trade-offs

- **Combined vs split notification type:** one `open_shift_claim_reviewed`
  row instead of approved/rejected pair. Simpler admin UX; the trade/time-off
  precedent splits them, but here a single recipient and single toggle is the
  product preference.
- **Fire-and-forget notification:** the notification is not transactional
  with the RPC. Accepted: the authoritative state is the DB status the
  employee already sees on `/employee/shifts`; a dropped email/push is a
  soft failure, and coupling it to the approve/reject transaction would risk
  failing a committed decision on a transient Resend/push outage.
- **No manager back-channel on notification failure:** logged server-side
  only. Acceptable for v1; a delivery-status surface is out of scope.

## Files touched

- `supabase/migrations/20260721000000_open_shift_claim_notify.sql` (new)
- `supabase/functions/notify-open-shift-claim/index.ts` (new)
- `supabase/functions/_shared/openShiftClaimNotify.ts` (new)
- `supabase/functions/_shared/resolveChannels.ts`
- `src/lib/notificationTypes.ts`
- `src/hooks/useOpenShiftClaims.ts`
- `src/components/schedule/TradeApprovalQueue.tsx`
- `tests/unit/notificationTypes.test.ts`
- `tests/unit/useOpenShiftClaims.*.test.ts` (new)
- `tests/unit/openShiftClaimNotify.test.ts` (new)
- `supabase/tests/open_shift_claim_reviewer_note.test.sql` (new)
