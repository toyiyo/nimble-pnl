# Plan — Notify: schedule-published web-push fix + published-shift-delete notify

**Design:** docs/superpowers/specs/2026-07-09-notify-shift-changes-design.md
**Branch:** `feature/notify-shift-changes`

TDD throughout: RED (failing test) → GREEN (minimal code) → REFACTOR → COMMIT per task.

---

## Part 1 — schedule-published → web push

### Task 1.1 — `_shared/schedulePublishedPush.ts` (pure helper) + test
- **Test** `tests/unit/schedulePublishedPush.test.ts`: injected `send` mock —
  (a) called once per employee with a `user_id`; (b) employees without `user_id` skipped;
  (c) a rejecting `send` does not throw (Promise.allSettled); (d) bounded concurrency: with
  `concurrency=2` and 5 targets, sends still all fire and return `{attempted:5}`.
- **Code** `supabase/functions/_shared/schedulePublishedPush.ts` per design (chunked
  `Promise.allSettled`, injected `WebPushSend`, no Deno-only imports).
- Dep: none.

### Task 1.2 — wire `notify-schedule-published/index.ts` to web push
- **Code**: build a service-role client; replace the `send-push-notification` (FCM) POST
  loop with `notifySchedulePublishedPush(scheduledEmployees, (userId) => sendWebPushToUser(
  serviceClient, userId, restaurantId, {title:'Schedule Updated', body:'A new schedule has
  been published', url:'/employee/schedule', tag:'schedule-published'}))`. Remove the FCM
  fetch block + its `serviceRoleKey`-for-FCM usage (keep the key for the service client).
- **Verify**: `deno check` (or lint) the function; no vitest (Deno entry). New logic lives
  in the 1.1 helper which IS tested.
- Dep: 1.1.

---

## Part 2 — published single-shift delete → "shift removed"

### Task 2.1 — `_shared/shiftDeletedNotification.ts` (pure builder) + test
- **Test** `tests/unit/shiftDeletedNotification.test.ts`: `buildDeletedShiftNotification`
  branches — email-only (email present, no user_id); push-only (user_id, no email); both;
  skipped (neither) ⇒ `{skipped:'no-email-and-no-user'}`. Assert subject/heading text,
  `push.payload.tag === 'shift-deleted-'+shiftId`, and timezone-correct `formatDateTime`
  in the details card.
- **Code** `supabase/functions/_shared/shiftDeletedNotification.ts` — imports only the pure
  `emailTemplates.ts` (`generateEmailTemplate`, `formatDateTime`). Returns
  `{email?, push?, skipped?}`.
- Dep: none.

### Task 2.2 — `send-shift-notification/index.ts` deleted-snapshot branch
- **Code**: extend `RequestBody` with `deletedShift?: {restaurant_id, employee_id, position,
  start_time, end_time}`. Add branch for `action==='deleted' && deletedShift`:
  1. Verify JWT user is `owner`/`manager` of `deletedShift.restaurant_id` via
     `user_restaurants` (mirror `notify-schedule-published`); else 403.
  2. `shouldSendNotification(service, restaurant_id, 'notify_shift_deleted')` gate.
  3. Fetch employee by `id=employee_id AND restaurant_id` (service role) → name/email/user_id;
     missing ⇒ success-skip.
  4. `getRestaurantInfo` → name+timezone; `buildDeletedShiftNotification({shiftId, …})`.
  5. Send email via Resend (if plan.email) + `sendWebPushToUser` (if plan.push). Return
     `successResponse`. Existing created/modified fetch path untouched.
- **Verify**: logic covered via 2.1 helper; keep Deno-entry lines thin.
- Dep: 2.1.

### Task 2.3 — `src/lib/shiftDeleteNotification.ts` (client helper) + test
- **Test** `tests/unit/shiftDeleteNotificationClient.test.ts`: published+assigned ⇒ body
  with `{shiftId, action:'deleted', deletedShift:{…employee_id…}}`; `is_published` false ⇒
  null; `is_published` null/undefined ⇒ null; `employee_id` null ⇒ null; body carries NO
  email/user_id; doc test asserting the gate is `is_published`.
- **Code** `src/lib/shiftDeleteNotification.ts` per design (widened input types + comments).
- Dep: none.

### Task 2.4 — wire `useDeleteShift` (`src/hooks/useShifts.tsx`)
- **Test** `tests/unit/useShifts.deleteNotify.test.tsx`: mock `supabase.functions.invoke`
  BOTH ways (per 2026-05-16 lesson) — `mockResolvedValue({data:null, error:{message}})` and
  `mockRejectedValue(new Error())`; each asserts the delete mutation still resolves and the
  success toast still fires. Plus: published+assigned `shift` ⇒ invoke called once with the
  `deleted` body; unpublished `shift` ⇒ invoke NOT called; no `shift` ⇒ invoke NOT called.
- **Code**: add optional `shift` to the mutate input; return `{id,restaurantId,shift}`; in
  `onSuccess` fire the fire-and-forget invoke ABOVE `if (silent) return` (per FE review),
  `console.warn('shift-deleted notify failed', {shiftId, error})` on failure.
- Dep: 2.3.

### Task 2.5 — pass the snapshot from `Scheduling.tsx`
- **Code**: `confirmDeleteShift` → `deleteShift.mutate({id: shiftToDelete.id, restaurantId,
  shift: shiftToDelete}, {onSuccess:…})`. No other call site changes (lock-guarded callers
  correctly omit `shift`).
- **Verify**: typecheck; existing Scheduling tests still pass.
- Dep: 2.4.

---

## Phase 8 verify (all)
`npm run test` (new unit tests) · `npm run typecheck` · `npm run lint` · `npm run build`.
Edge-function deno files: `deno check` if available; otherwise rely on the tested `_shared`
helpers + review. No migration, no pgTAP (no schema change).

## Task dependency order
1.1 → 1.2 ; 2.1 → 2.2 ; 2.3 → 2.4 → 2.5. Parts 1 and 2 are independent (parallelizable).

## Out of scope (documented follow-ups)
- Series delete of published shifts (`useDeleteShiftSeries` + `includePublished`) — batch shape.
- Tie delete-notify to `schedule_change_logs` / per-employee rate-limit (residual-abuse hardening).
- Bulk `web_push_subscriptions` fetch inside `sendWebPushToUser` (4-caller refactor).
- Per-employee notification preferences (layered control); removing dormant FCM path.
