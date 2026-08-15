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
- Add `notify: boolean` to `PublishScheduleParams`
  (`src/hooks/useSchedulePublish.tsx:9`). When `notify` is `false`, do
  not call `invokeScheduleNotification`. Return the outcome
  `{ status: 'skipped' }`.
- Add `'skipped'` to `NotificationOutcome`
  (`src/hooks/useSchedulePublish.tsx:36`). The toast for `skipped` is
  neutral: "Schedule Published" / "No notifications were sent."
- No database change. `notification_sent` stays `false`, which is true.
- No edge function change. The function is not called on a quiet
  publish, so the lesson of 2026-07-20 (derive the message from DB
  state) is not violated — there is no message.

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

- Delete the throw in `assertShiftNotLocked` callers. Replace with a
  page-level confirm dialog, one instance per page (single-dialog
  pattern, per CLAUDE.md).
- New component `src/components/scheduling/PublishedShiftChangeDialog.tsx`:
  an `AlertDialog` with:
  - Title: "This shift is published"
  - Body: "{Employee} can see this shift. Save the change anyway?"
  - A `Checkbox` "Notify {employee} about this change", checked by
    default. On a reassignment the label names both employees.
  - Buttons: "Cancel" and "Save change".
- New hook `usePublishedShiftGuard`. It wraps a mutation call. When the
  target shift has `locked = true`, it opens the dialog and defers the
  mutation until confirm. When not locked, it calls through directly.
- Call sites to wire:
  - `ShiftDialog` save path (`src/components/ShiftDialog.tsx`).
  - Delete flows in `src/pages/Scheduling.tsx` and the timeline.
  - Drag commit in the timeline
    (`src/components/scheduling/ShiftTimeline/useTimelineBarDrag.ts`).
  - `WeekScheduleMobile` edit path
    (`src/components/scheduling/WeekScheduleMobile.tsx`).
- The shift stays `is_published = true, locked = true` after the edit.
  The week stays published. No banner changes on the employee page —
  the employee sees the updated shift, plus a notification when the
  manager chose one.

### Change: the notification

- New edge function `supabase/functions/notify-shift-changed/index.ts`.
- Request body: `{ changeLogId: string }` only. The body carries no
  decision fields (lesson 2026-07-20).
- The function:
  1. Authenticates the caller. Checks the caller has role
     `owner`/`manager` on the log row's `restaurant_id` — same pattern
     as `notify-schedule-published`.
  2. Reads the `schedule_change_logs` row by id with the service-role
     client. Refuses (404/409) when the row is absent or older than 10
     minutes — a stale id is not valid to notify on.
  3. Derives everything from the row: `change_type`
     (`updated`/`deleted`), the shift fields from
     `before_data`/`after_data`, and the recipients.
  4. Recipients: `before_data.employee_id`, plus `after_data.employee_id`
     when different (reassignment). Resolve names/emails from
     `employees`, push subscriptions via the existing
     `webPushFanout` helper (`supabase/functions/_shared/webPushFanout.ts`).
  5. Sends one email + push per recipient with the concrete change:
     "Your Tue 5:00 PM shift changed to 6:00 PM", "Your Tue shift was
     removed", "You have a new shift".
  6. Returns `{ sent, failed }` — same contract that
     `invokeScheduleNotification` already parses
     (`src/hooks/useSchedulePublish.tsx:115-136`).
- Client: after the guarded mutation commits and when the manager left
  "Notify" checked, look up the newest `schedule_change_logs` row for
  that shift (SELECT is allowed to restaurant members per
  `supabase/migrations/20251123000000_schedule_publishing.sql:74-83`),
  then call the function with its id. Reuse `invokeScheduleNotification`
  for outcome handling and toasts.
- When the manager unchecks "Notify": no call. The change log row still
  exists — the audit trail does not depend on the notification.

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
- pgTAP: none needed — no schema change, no RPC change. The
  `log_shift_change` trigger already has coverage.
- E2E (`tests/e2e/`): extend the publish-states spec: publish with
  notify unchecked (assert the publish succeeds), edit a published shift
  via the guard dialog (assert the warning shows, the change saves, and
  the week stays published — no unpublish).
- Edge function: deno unit test for the derive-from-log logic if the
  repo has precedent; otherwise cover the request-shape guards.
