# Design: Quiet publish and live edit of a published schedule

Date: 2026-08-15
Author: Claude (with Jose)
Status: Draft for Phase 2.5 review

## Problem

Managers republish after a small change. Each publish notifies every
scheduled employee (`src/hooks/useSchedulePublish.tsx:260`). Each edit
of a published week requires a full unpublish first, because the client
throws on any change to a locked shift (`src/hooks/useShifts.tsx:386`).
The unpublish then notifies everyone again
(`src/hooks/useSchedulePublish.tsx:325`). The result is a loud
publish/unpublish cycle for a one-shift correction. Employees get
repeated notifications that contradict each other. PR #753 removed the
alarmist banners; this design removes the cycle that produced them.

## Decisions (approved by Jose, 2026-08-15)

1. The publish dialog gets a "Notify employees" option, checked by
   default on every open.
2. Every change path to a published shift shows one warning flow: the
   edit dialog, the delete flow, and the timeline drag.
3. On a reassignment, both the old and the new employee can get the
   change notification.

## Feature A: Publish without notifications

### Current behavior (cited)

- `PublishScheduleDialog` collects only `notes`, then calls
  `onConfirm(notes)` (`src/components/PublishScheduleDialog.tsx:34`,
  `:56-59`).
- `usePublishSchedule` always awaits
  `invokeScheduleNotification('notify-schedule-published', …)` after the
  `publish_schedule` RPC commits
  (`src/hooks/useSchedulePublish.tsx:260`).
- `schedule_publications.notification_sent` defaults to `false`
  (`supabase/migrations/20251123000000_schedule_publishing.sql:17`). The
  only writer that sets it `true` is the edge function after a
  successful fan-out
  (`supabase/functions/notify-schedule-published/index.ts:338`).

### Change

- Add a `Checkbox` "Notify employees" to `PublishScheduleDialog`,
  checked on every open. `onConfirm` gains a second argument:
  `onConfirm(notes: string | undefined, notify: boolean)`.
  - Reset mechanism: the dialog stays mounted in
    `src/pages/Scheduling.tsx:1710-1724`, and the current `notes` reset
    runs only in `handleConfirm`/`handleCancel`
    (`src/components/PublishScheduleDialog.tsx:56-64`) — an Escape or
    overlay close bypasses both. Reset `notify` to `true` (and `notes`
    to `''`) in a `useEffect` keyed on `open`.
  - Pair the checkbox with `<Label htmlFor>` / `<Checkbox id>`, same as
    the Notes field (`src/components/PublishScheduleDialog.tsx:154-162`).
- Add `notify: boolean` to `PublishScheduleParams`
  (`src/hooks/useSchedulePublish.tsx:9`). When `notify` is `false`, do
  not call `invokeScheduleNotification`. Return the outcome
  `{ status: 'skipped' }`.
- Add `'skipped'` to `NotificationOutcome`
  (`src/hooks/useSchedulePublish.tsx:36`). The toast for `skipped` is
  neutral: "Schedule Published" / "No notifications were sent."
- No database change for the publish path. `notification_sent` stays
  `false`, which is true.
- The publish notify function is not called on a quiet publish, so the
  lesson of 2026-07-20 (derive the message from DB state) is not
  violated — there is no message.
- **Retraction gate change (from Phase 2.5 review).**
  `notify-schedule-unpublished` gates every retraction notice on
  `schedule_publications.notification_sent`
  (`supabase/functions/notify-schedule-unpublished/index.ts:180-187`).
  A quiet publish leaves that flag `false`, so a later real retraction
  of a live, visible week would send nothing. Change the gate: send the
  retraction notice when the retracted publication row exists,
  regardless of `notification_sent`. A published week is visible to
  employees whether or not the publish was announced.

## Feature B: Change a published shift, with a warning

### Current behavior (cited)

- `useUpdateShift` calls `assertShiftNotLocked(id)` and throws
  "Cannot modify a locked shift. The schedule has been published."
  (`src/hooks/useShifts.tsx:317`, `:377-389`).
- `useUpdateShiftSeries` throws the same way for a locked occurrence
  (`src/hooks/useShifts.tsx:627-628`).
- `useDeleteShift` deletes without a lock check, but the series delete
  RPC takes `p_include_locked` and reports a `locked_count`
  (`src/hooks/useShifts.tsx:517`, `:525`).
- The `log_shift_changes` trigger records every UPDATE and DELETE of a
  published shift into `schedule_change_logs`, with `change_type`,
  `employee_id`, `changed_by`, `before_data`, and `after_data`
  (`supabase/migrations/20251123000000_schedule_publishing.sql:97-166`).
- The publish RPC sets `locked = true` on every shift in the week
  (`supabase/migrations/20260729120000_publish_schedule_tz_bucketing.sql:97`).
  No trigger or RLS policy blocks an update to a locked shift — the
  block is client-side only (`src/hooks/useShifts.tsx:386`).

### Change: the confirm flow

Two independent client-side lock mechanisms exist. Both get the same
opt-in bypass:

1. `assertShiftNotLocked` in `src/hooks/useShifts.tsx:377-389`, called
   by `useUpdateShift` (`:317`) and mirrored by the throw in
   `useUpdateShiftSeries` (`:627-628`).
2. `assertNotLockedClient` in `src/lib/shiftMutationPipeline.ts:81-85`,
   called 8 times in `src/hooks/useValidatedShiftMutations.ts`
   (lines 363, 408, 446, 494, 530, 574, 602, 614). This pipeline serves
   `TimelineShiftPopover.tsx`, `ShiftTimelineTab.tsx`, and
   `useShiftPlanner.ts`.

Changes:

- Add an `allowPublished?: boolean` option to the mutations behind both
  mechanisms. When `true`, skip the lock assertion. When absent, current
  behavior is unchanged — the assertions stay as the last-line backstop.
- New hook `usePublishedShiftGuard`, instantiated **once** in
  `src/pages/Scheduling.tsx`. It renders the **single**
  `PublishedShiftChangeDialog` instance for the page and exposes one
  callback: `guardShiftChange({ shiftId, run })`. Child surfaces receive
  the callback through props (single-dialog pattern, per CLAUDE.md).
- `guardShiftChange` does a **fresh** SELECT of
  `shifts.locked, employee_id` (the same query `assertShiftNotLocked`
  already does at `src/hooks/useShifts.tsx:377-384`) — never the React
  Query cache. A stale cache can say `locked: false` for a shift another
  tab published seconds ago; the fresh read closes that hole.
  - Fresh read says not locked → call `run({ allowPublished: false })`.
    The inner assertion still backstops the small window between read
    and write.
  - Fresh read says locked → open the dialog. On confirm, call
    `run({ allowPublished: true })`, then the notify step when checked.
- Call sites to wire (each passes its mutation as `run`):
  - `ShiftDialog` save path (`src/components/ShiftDialog.tsx`). This
    also covers `WeekScheduleMobile.tsx`, which holds no mutation hook
    and only opens `ShiftDialog` via `onEditShift`.
  - Delete flows in `src/pages/Scheduling.tsx`, including
    `useDeleteShift` and `useDeleteShiftSeries`
    (`src/pages/Scheduling.tsx:322`).
  - Timeline commit paths in
    `src/components/scheduling/ShiftTimeline/ShiftTimelineTab.tsx:694`
    and `:734` (`validateAndUpdateTime` / `forceUpdateTime`), and the
    edits in `TimelineShiftPopover.tsx`.
  - Delete the gesture gates `if (locked) return;` in
    `src/components/scheduling/ShiftTimeline/useTimelineBarDrag.ts:20`
    and `:198`. Today they stop a drag on a locked shift before any
    commit. With the guard in place, the gesture must start so the
    commit can reach the dialog.
- `useShiftPlanner.ts` keeps the current throw. The planner is a
  programmatic bulk path; a per-shift dialog does not fit it. Same
  category as `BulkEditShiftsDialog` (see Out of scope).
- The shift stays `is_published = true, locked = true` after the edit.
  The week stays published. No banner changes on the employee page —
  the employee sees the updated shift, plus a notification when the
  manager chose one.

### The dialog (`src/components/scheduling/PublishedShiftChangeDialog.tsx`)

- An `AlertDialog` (installed; keeps the Radix focus trap and focus
  return).
- Title: "This shift is published". Style
  `text-[17px] font-semibold text-foreground` — not the shadcn default
  `text-lg`.
- Description (`AlertDialogDescription`,
  `text-[13px] text-muted-foreground`): "{Employee} can see this shift.
  Save the change anyway?" On a reassignment, the copy names both
  employees.
- The `Checkbox` "Notify {employee} about this change" is a **sibling**
  of the description, not inside it — an interactive control must not
  sit in the `aria-describedby` block. Pair it with
  `<Label htmlFor>` / `<Checkbox id>`, the same pattern as the Notes
  field (`src/components/PublishScheduleDialog.tsx:154-162`). Checked
  each time the dialog opens.
- Buttons: "Cancel" and "Save change". Disable "Save change" while the
  deferred mutation or the notify invoke is in flight — a fast
  double-click must not fire twice.

### Change: the notification

- New migration: add `notified_at TIMESTAMPTZ` (nullable) to
  `schedule_change_logs`. This is the idempotency latch. The precedent
  is `schedule_retractions.notified_at`
  (`supabase/functions/notify-schedule-unpublished/index.ts:187-200`).
- New edge function `supabase/functions/notify-shift-changed/index.ts`.
- Request body: `{ changeLogId: string }` only. The body carries no
  decision fields (lesson 2026-07-20).
- The function, in this exact order:
  1. Authenticates the caller (JWT present and valid).
  2. Reads the `schedule_change_logs` row by id with the service-role
     client. Refuses (404) when the row is absent.
  3. Checks the caller can edit the schedule for the row's
     `restaurant_id`: `user_has_capability(restaurant_id,
     'edit:scheduling')` — the same gate as the `shifts` UPDATE RLS
     policy (`supabase/migrations/20260730150000_rewrite_collaborator_policies.sql:140-144`).
     Refuses (403) on failure. The order matters: `restaurant_id` is
     only known after step 2, and nothing sends before step 3 passes.
  4. Refuses (409) when the row is older than 10 minutes, when
     `change_type` is not `updated` or `deleted`, or when `shift_id`
     is null. Restaurant-level `unpublished` rows have no `shift_id`
     (`supabase/migrations/20251123000000_schedule_publishing.sql:243-259`)
     and are not valid targets.
  5. Claims the latch:
     `UPDATE schedule_change_logs SET notified_at = now()
      WHERE id = $1 AND notified_at IS NULL RETURNING id`.
     Zero rows returned → already notified → answer 200 with
     `{ sent: 0, alreadyNotified: true }`. A double-click or client
     retry cannot send twice.
  6. Derives everything from the row: `change_type`
     (`updated`/`deleted`), the shift fields from
     `before_data`/`after_data`, and the recipients.
  7. Recipients: `before_data.employee_id`, plus `after_data.employee_id`
     when different (reassignment). When every recipient slot is null
     (an open shift), answer 200 with `{ sent: 0 }`. Resolve
     names/emails from `employees`. Send push via `sendWebPushToUser`
     in `supabase/functions/_shared/webPushHelper.ts:98` — the same
     helper `notify-schedule-published/index.ts:296` uses.
     (`webPushFanout.ts` holds only the dedup filter and the bounded
     loop, not the sender.)
  8. Sends one email + push per recipient with the concrete change:
     "Your Tue 5:00 PM shift changed to 6:00 PM", "Your Tue shift was
     removed", "You have a new shift".
  9. Returns `{ sent, failed }` — same contract that
     `invokeScheduleNotification` already parses
     (`src/hooks/useSchedulePublish.tsx:115-136`).
- Client: after the guarded mutation commits and when the manager left
  "Notify" checked, look up the log row (SELECT is allowed to restaurant
  members per
  `supabase/migrations/20251123000000_schedule_publishing.sql:74-83`),
  then call the function with its id.
  - The lookup is scoped, not "newest for the shift": filter on
    `shift_id`, `changed_by = auth.uid()`, and
    `changed_at >= <mutation start time>`, order by `changed_at`
    descending, limit 1. Another manager's concurrent edit can never be
    picked — `changed_by` excludes it.
  - Toast copy: pass `{ title: 'Shift updated', successDescription:
    '{Employee} was notified.' }` to `notificationToast`. Its non-`sent`
    branches build titles from the passed title
    (`src/hooks/useSchedulePublish.tsx:173-204`), so the failure toast
    reads "Shift updated — some employees not notified", which is
    correct for this context.
- When the manager unchecks "Notify": no call. The change log row still
  exists — the audit trail does not depend on the notification.

## Decided trade-offs

- **Check-then-write window.** `guardShiftChange` reads `locked` fresh,
  then writes. A publish can land between the two. The inner lock
  assertion catches that case and shows the existing error toast. Full
  atomicity needs a DB-level guard; the window is under a second and the
  failure mode is a blocked write, not a silent one. Accepted.
- **Own-edit rapid-fire race.** One manager, two edits to the same
  shift inside the lookup window: the scoped lookup picks the newest of
  the manager's own rows. The notification then describes the final
  state, which is the message the employee needs. The `notified_at`
  latch stops any double-send per row. The reviewer's stronger fix (an
  RPC that returns the trigger's log id via `RETURNING`) needs a new
  RPC that re-implements the shift UPDATE; deferred unless the build
  finds the lookup fragile in tests.
- **`useShiftPlanner` and `BulkEditShiftsDialog` keep the throw.**
  Bulk paths need a batch notification design; one dialog per shift
  does not fit. Follow-up work.

### Why the client passes a `changeLogId` and not the change itself

The trigger writes the log row in the same transaction as the shift
change (`supabase/migrations/20251123000000_schedule_publishing.sql:164-166`,
AFTER trigger). By the time the client calls the function, the row is
committed truth. The function trusts only that row. A malicious or
buggy caller can only cause a notification that matches what actually
happened, to the people it actually happened to.

## Out of scope

- `BulkEditShiftsDialog` and the shift import keep the current locked
  behavior. A bulk path can batch many change-log rows; one notification
  per row would spam. Defer to a follow-up.
- Per-restaurant defaults ("never notify") — a settings surface, not
  this change.
- The unpublish flow keeps its notification (it still exists for real
  retractions), but with Feature B managers should rarely need it.

## Testing

- Unit: `PublishScheduleDialog` checkbox behavior; `usePublishSchedule`
  skips the invoke when `notify` is false; `notificationToast` copy for
  `skipped`; `PublishedShiftChangeDialog` render + callbacks;
  `usePublishedShiftGuard` gates locked shifts and passes unlocked ones.
- Unit (Feature B additions): `allowPublished` skips both lock
  assertions and leaves default behavior unchanged; the guard's fresh
  read (not cache) decides the dialog; the log-row lookup filter
  (`shift_id` + `changed_by` + `changed_at`).
- pgTAP: the new migration — `schedule_change_logs.notified_at` exists,
  is nullable, and defaults to NULL.
- E2E (`tests/e2e/`): extend the publish-states spec: publish with
  notify unchecked (assert the publish succeeds), edit a published shift
  via the guard dialog (assert the warning shows, the change saves, and
  the week stays published — no unpublish).
- Edge function: deno unit test for the derive-from-log logic if the
  repo has precedent; otherwise cover the request-shape guards.
