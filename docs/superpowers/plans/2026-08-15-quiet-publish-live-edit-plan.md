# Plan: Quiet publish and live edit

Design: docs/superpowers/specs/2026-08-15-quiet-publish-live-edit-design.md
Branch: feature/quiet-publish-live-edit
Worktree: .claude/worktrees/quiet-publish-live-edit

Each task is one TDD unit: write the failing test, make it pass, commit.

## Feature A: quiet publish

1. **Add `'skipped'` to `NotificationOutcome`.**
   File: `src/hooks/useSchedulePublish.tsx`. Add the variant and the
   `notificationToast` branch: title unchanged, description
   "No notifications were sent." Tests: `tests/unit/` toast copy per
   outcome. No dependency.

2. **Add `notify` to `PublishScheduleParams`.**
   File: `src/hooks/useSchedulePublish.tsx`. When `notify === false`,
   do not call `invokeScheduleNotification`; return
   `{ status: 'skipped' }`. Default `true` when absent. Tests: mock the
   invoke; check zero calls when false, one call when true.
   Depends on task 1.

3. **Add the "Notify employees" checkbox to `PublishScheduleDialog`.**
   Files: `src/components/PublishScheduleDialog.tsx`,
   `src/pages/Scheduling.tsx` (`handlePublishSchedule`). Checkbox with
   `Label htmlFor`/`id`, checked by default. `useEffect` on `open`
   resets `notify` to `true` and `notes` to `''`. `onConfirm(notes,
   notify)`. Tests: default state, reset on reopen, callback arguments.
   Depends on task 2.

4. **Change the retraction gate in `notify-schedule-unpublished`.**
   File: `supabase/functions/notify-schedule-unpublished/index.ts`
   (`:180-187`). Gate the send on the retracted publication row, not on
   `notification_sent`. Tests: per repo precedent for edge-function
   tests; otherwise document manual check in the PR. No dependency.

## Feature B: live edit of a published shift

5. **Migration: `schedule_change_logs.notified_at`.**
   New file under `supabase/migrations/`. Nullable `TIMESTAMPTZ`, no
   default. pgTAP: column exists, is nullable. No dependency.

6. **Add `allowPublished` to the `useShifts` mutations.**
   File: `src/hooks/useShifts.tsx`. `useUpdateShift`,
   `useUpdateShiftSeries`, `useDeleteShift`, `useDeleteShiftSeries`
   accept the option; `true` skips `assertShiftNotLocked` / the series
   throw / maps to `p_include_locked`. Absent → unchanged. Tests: both
   states per mutation. No dependency.

7. **Add `allowPublished` to the validated pipeline.**
   Files: `src/lib/shiftMutationPipeline.ts`,
   `src/hooks/useValidatedShiftMutations.ts`. Thread the option past
   `assertNotLockedClient` at all 8 call sites. Absent → unchanged.
   Tests: both states. No dependency.

8. **Build `PublishedShiftChangeDialog`.**
   New file `src/components/scheduling/PublishedShiftChangeDialog.tsx`.
   Per the design's dialog section (AlertDialog, typography scale,
   checkbox as sibling of the description, pending-disable on confirm).
   Tests: render, checkbox default, callback payload, disabled while
   pending. No dependency.

9. **Build `usePublishedShiftGuard`.**
   New file `src/hooks/usePublishedShiftGuard.ts`. One instance per
   page; fresh SELECT of `locked, employee_id`; not locked → run
   directly; locked → dialog → run with `allowPublished: true`.
   Tests: fresh-read decision, deferred run, cancel path.
   Depends on tasks 6, 8.

10. **Wire `ShiftDialog` save through the guard.**
    Files: `src/components/ShiftDialog.tsx`, `src/pages/Scheduling.tsx`.
    Covers `WeekScheduleMobile` (it opens `ShiftDialog`).
    Depends on task 9.

11. **Wire the delete flows through the guard.**
    File: `src/pages/Scheduling.tsx` (`useDeleteShift`,
    `useDeleteShiftSeries` call sites). Depends on task 9.

12. **Wire the timeline through the guard.**
    Files: `src/components/scheduling/ShiftTimeline/ShiftTimelineTab.tsx`
    (`:694`, `:734`), `TimelineShiftPopover.tsx`; delete the
    `if (locked) return;` gates in `useTimelineBarDrag.ts:20,198`.
    Depends on tasks 7, 9.

13. **Build the `notify-shift-changed` edge function.**
    New dir `supabase/functions/notify-shift-changed/`. The nine-step
    order from the design: auth → read row (service role) →
    `user_has_capability` check → validity checks → `notified_at` latch
    → derive → recipients → send (email + `sendWebPushToUser`) →
    `{ sent, failed }`. Tests: derive/validity logic per repo precedent.
    Depends on task 5.

14. **Client notify step after a guarded change.**
    File: `src/hooks/usePublishedShiftGuard.ts`. Scoped log-row lookup
    (`shift_id`, `changed_by`, `changed_at >= start`), then
    `invokeScheduleNotification('notify-shift-changed', { changeLogId })`
    with the "Shift updated" toast copy. Tests: lookup filter, skip
    when the checkbox was unchecked. Depends on tasks 9, 13.

15. **E2E.**
    File: `tests/e2e/employee-schedule-retraction.spec.ts` (extend) or a
    new spec. Scenarios: publish with notify unchecked succeeds; edit a
    published shift → warning dialog shows → save → shift changed and
    week stays published. Depends on tasks 3, 10.

## Order

5 → 13 in parallel with 1 → 2 → 3.
6, 7, 8 in parallel; then 9; then 10, 11, 12, 14; then 4, 15.
