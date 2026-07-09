# Design — Notify: schedule-published web-push fix + published-shift-delete notification

**Date:** 2026-07-09
**Branch:** `feature/notify-shift-changes`
**Author:** Claude (dev workflow)

## Problem

Two concrete, verified gaps in the employee notification system:

1. **`notify-schedule-published` sends its push through the disabled FCM path.**
   The function emails scheduled employees (works) but delivers push via
   `send-push-notification` → Firebase Cloud Messaging + `device_tokens`. The native/FCM
   path is hard-disabled (`useDeviceToken.ts`: `PUSH_NOTIFICATIONS_ENABLED = false`), so
   **PWA employees who enabled web push never receive the schedule-published push.** Every
   other notification in the app (shift trades, time-off, open shifts) uses the working
   web-push path (`_shared/webPushHelper.ts` → `web_push_subscriptions`).

2. **Deleting a published shift silently drops the employee.**
   Publishing sets shifts `is_published = true, locked = true`; all update/reassign paths
   assert-not-locked and throw, so a published shift can only be changed via
   unpublish → edit → republish (which re-fires `notify-schedule-published`). The **one
   reachable, unnotified** employee-facing change to a published shift is **deletion**:
   `Scheduling.tsx` → `confirmDeleteShift` → `useDeleteShift` has no lock guard, and the
   delete dialog even warns *"This shift has been published and employees may have already
   seen it."* The employee is never told their shift vanished.

`send-shift-notification` already exists (email + web push, restaurant-settings gated,
handles `created`/`modified`/`deleted`) but has **zero callers**, and its `deleted` branch
is broken for real deletes — it re-`SELECT`s the shift by id and, finding the row gone,
returns `"Shift already deleted, notification skipped"`.

## Scope (approved)

- **In:** Fix #1 (web push). Fix #2 for the **single** published-shift delete
  (`useDeleteShift`), reusing `send-shift-notification`. Client-side, no DB migration.
  Restaurant-level `notification_settings` gating retained (`notify_shift_deleted`).
- **Out (documented follow-ups):**
  - Series delete of published shifts (`useDeleteShiftSeries` + `includePublished`) — needs
    a batch/summary notification shape, different from the one-shift model. Noted below.
  - `created`/`modified` shift notifications — dead code under the lock model; excluded.
  - Per-employee notification preferences — future layered-control work. The design keeps
    the server-side gate as the single decision point so a per-user override can slot in
    later without touching callers.
  - Removing the dormant FCM path / dead `notification_settings` columns — cleanup, later.

## Approach

### Part 1 — schedule-published → web push

- **New** `supabase/functions/_shared/schedulePublishedPush.ts` (pure, no Deno-only
  imports — vitest-importable):

  ```ts
  export interface SchedulePushEmployee { user_id?: string | null }
  export type WebPushSend = (userId: string) => Promise<unknown>;

  /** Fan a "Schedule Updated" push out to every scheduled employee with a user_id.
   *  Sender is injected so the Deno-only web-push call stays out of this module. */
  export async function notifySchedulePublishedPush(
    employees: SchedulePushEmployee[],
    send: WebPushSend,
  ): Promise<{ attempted: number }> {
    const targets = employees.filter((e): e is { user_id: string } => !!e.user_id);
    await Promise.allSettled(targets.map((e) => send(e.user_id)));
    return { attempted: targets.length };
  }
  ```

- **Modify** `supabase/functions/notify-schedule-published/index.ts`:
  - Build a **service-role** client (needed: `web_push_subscriptions` RLS restricts rows to
    `auth.uid() = user_id`; the manager's JWT can't read employees' subscriptions). The
    service-role key is already read here (was used for the FCM POST).
  - Replace the `send-push-notification` (FCM) fetch loop with:
    ```ts
    await notifySchedulePublishedPush(scheduledEmployees, (userId) =>
      sendWebPushToUser(serviceClient, userId, restaurantId, {
        title: 'Schedule Updated',
        body: 'A new schedule has been published',
        url: '/employee/schedule',
        tag: 'schedule-published',
      }));
    ```
  - Net index.ts change is ~3 lines calling the tested helper (keeps new-code coverage green).

### Part 2 — published single-shift delete → "shift removed" notification

**Security first.** The row is gone by the time we notify, so the client must pass a
snapshot. To avoid turning `send-shift-notification` into an open email relay (an authed
user POSTing an arbitrary `to` address — cf. the PR #500 `notify-pin-changed` P1 lesson),
the snapshot carries **`employee_id`, never an email/user_id**. The function looks up the
employee's real email/user_id server-side and verifies the caller is an **owner/manager of
that restaurant** (new — the function previously only validated that the JWT was a real
user).

- **New** `supabase/functions/_shared/shiftDeletedNotification.ts` (pure; imports only the
  pure `emailTemplates.ts` — vitest-importable):

  ```ts
  export interface DeletedShiftNotificationInput {
    employeeName: string | null;
    employeeEmail: string | null;
    employeeUserId: string | null;
    restaurantName: string;
    timezone: string;
    position: string;
    startTime: string;   // ISO
    endTime: string;     // ISO
    appUrl: string;
  }
  export interface DeletedShiftNotificationPlan {
    email?: { subject: string; html: string; to: string };
    push?: { userId: string; payload: { title; body; url; tag } };
    skipped?: 'no-email-and-no-user';
  }
  export function buildDeletedShiftNotification(
    input: DeletedShiftNotificationInput,
  ): DeletedShiftNotificationPlan;
  ```
  Branches (each hit by a test → satisfies ≥80% new-code coverage): email-only,
  push-only, both, and skipped-when-neither.

- **Modify** `supabase/functions/send-shift-notification/index.ts` — add a `deletedShift`
  snapshot branch (existing `created`/`modified` fetch path untouched):
  ```ts
  interface RequestBody {
    shiftId: string;
    action: 'created' | 'modified' | 'deleted';
    previousShift?: { start_time; end_time; position };
    deletedShift?: {                 // NEW — row is gone, cannot re-fetch
      restaurant_id: string;
      employee_id: string;
      position: string;
      start_time: string;
      end_time: string;
    };
  }
  ```
  Flow for `action === 'deleted' && deletedShift`:
  1. Require a valid JWT (existing) **and** verify the caller has `owner`/`manager` in
     `user_restaurants` for `deletedShift.restaurant_id` (mirror `notify-schedule-published`).
     Else `403`.
  2. Settings gate: `shouldSendNotification(service, restaurant_id, 'notify_shift_deleted')`.
  3. Fetch the employee **authoritatively** from `employees` by
     `id = employee_id AND restaurant_id = restaurant_id` (service role) → name/email/user_id.
     Missing employee → `successResponse` skip.
  4. `getRestaurantInfo` → name + timezone. `buildDeletedShiftNotification(...)`.
  5. Send email via Resend (if `email` in plan) and `sendWebPushToUser` (if `push` in plan).
  Returns `successResponse` on skip conditions (never surfaces to the fire-and-forget caller).

- **New** `src/lib/shiftDeleteNotification.ts` (pure, tested):
  ```ts
  export interface DeletableShift {
    id: string;
    restaurant_id: string;
    employee_id: string | null;
    is_published?: boolean | null;
    position: string;
    start_time: string;
    end_time: string;
  }
  export interface ShiftDeletedInvokeBody {
    shiftId: string;
    action: 'deleted';
    deletedShift: { restaurant_id; employee_id; position; start_time; end_time };
  }
  /** Returns the invoke body iff the deleted shift was published AND had an assigned
   *  employee; else null (drafts and open/unassigned shifts never notify). */
  export function buildShiftDeletedInvoke(shift: DeletableShift): ShiftDeletedInvokeBody | null;
  ```

- **Modify** `src/hooks/useShifts.tsx` — `useDeleteShift` accepts an optional `shift`
  snapshot so it can decide/notify centrally without an extra fetch:
  ```ts
  mutationFn: async ({ id, restaurantId, shift }:
    { id: string; restaurantId: string; shift?: DeletableShift }) => { …unchanged delete… }
  onSuccess: (data) => {
    queryClient.invalidateQueries(['shifts', data.restaurantId]);
    const body = data.shift ? buildShiftDeletedInvoke(data.shift) : null;
    if (body) {
      supabase.functions.invoke('send-shift-notification', { body })
        .then(({ error }) => { if (error) console.warn('shift-deleted notify failed', error); })
        .catch((e) => console.warn('shift-deleted notify failed', e)); // fire-and-forget
    }
    if (!silent) toast({ … });   // unchanged
  }
  ```
  (Return `{ id, restaurantId, shift }` from `mutationFn` so `onSuccess` has the snapshot.)

- **Modify** `src/pages/Scheduling.tsx` — `confirmDeleteShift` passes the full shift:
  `deleteShift.mutate({ id: shiftToDelete.id, restaurantId, shift: shiftToDelete }, …)`.
  Other `useDeleteShift`/`useValidatedShiftMutations` callers pass no `shift` (they are
  lock-guarded to unpublished shifts) → no notification, correct.

## Why not the DB trigger (this round)

`log_shift_change` already fires on published-shift delete and captures `before_data`, and a
trigger would catch every delete path uniformly. But it requires async invoke infra
(pg_net/queue + cron), a migration, service-role secrets in-DB, and pgTAP — larger than the
approved client-side scope. The client helper centralizes the decision so a later trigger
migration can replace the call site without reworking the notification contract.

## Data flow (end-to-end, verified per layer)

Delete published shift → `Scheduling.confirmDeleteShift` (has full `shiftToDelete` incl.
`is_published`, `employee_id`) → `useDeleteShift.mutate({id,restaurantId,shift})` → DB delete
→ `onSuccess` → `buildShiftDeletedInvoke(shift)` (published + assigned ⇒ body) →
`invoke('send-shift-notification', {deletedShift:{…employee_id…}})` → edge fn verifies
manager role + gate + **authoritative employee lookup** + `buildDeletedShiftNotification` →
Resend email + `sendWebPushToUser`.

## Testing

- `tests/unit/schedulePublishedPush.test.ts` — per-employee send, skips no-`user_id`,
  swallows a rejecting sender (Promise.allSettled).
- `tests/unit/shiftDeletedNotification.test.ts` — all four plan branches (email-only,
  push-only, both, skipped); timezone-correct `formatDateTime` output.
- `tests/unit/shiftDeleteNotificationClient.test.ts` — `buildShiftDeletedInvoke`: published+
  assigned ⇒ body; unpublished ⇒ null; `employee_id` null ⇒ null; body shape carries
  `employee_id` (never email).
- `tests/unit/useShifts.deleteNotify.test.ts(x)` — per the 2026-05-16 lesson, **two** invoke
  mocks: `mockResolvedValue({ data:null, error:{message} })` and `mockRejectedValue(Error)`;
  both assert the delete mutation still resolves and the toast still fires; plus a
  published-with-employee case asserts invoke called with the `deleted` body, and an
  unpublished case asserts invoke NOT called.
- Edge-function `index.ts` snapshot branch: unit-covered indirectly via the pure helpers;
  the Deno auth/gate/lookup lines stay thin (kept small so new-code coverage holds).

## Decided trade-offs

- **Series delete of published shifts stays unnotified this round** — reachable but low
  frequency and needs a different (batched) notification. Documented follow-up.
- **Snapshot `position`/`start`/`end` are client-supplied (display-only).** Worst case a
  manager (already authorized on that restaurant) sends a slightly-stale "shift removed"
  email to their own employee. Identity-bearing fields (email/user_id) are server-authoritative,
  so there is no cross-tenant or arbitrary-recipient exposure.
- **No new-migration coverage risk**: identity lookup is server-side; the client cannot
  redirect the notification to an arbitrary address.
