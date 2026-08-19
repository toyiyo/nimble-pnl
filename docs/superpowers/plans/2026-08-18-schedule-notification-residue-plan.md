# Plan: close the three gaps left after the quiet-publish change

Design: docs/superpowers/specs/2026-08-18-schedule-notification-residue-design.md
Branch: claude/confident-lewin-8e0379
Worktree: .claude/worktrees/upbeat-wing-771b94

Each task is one TDD unit: write the failing test, make it pass, commit.

No migration and no RPC change. No pgTAP test applies.

## Gap 1: give unpublish a notify choice

1. **Add `skippedDescription` to `NotificationToastCopy`.**
   File: `src/hooks/useSchedulePublish.tsx:155`. Add the optional field next
   to `successDescription`. The `skipped` branch at `:183` uses it when
   present, and keeps "No notifications were sent." when absent.
   Tests: `tests/unit/useSchedulePublish.test.ts`, the
   "notificationToast copy per outcome" describe at `:215`. Two cases:
   field present, field absent. No dependency.

2. **Add `notify` to `UnpublishScheduleParams`.**
   File: `src/hooks/useSchedulePublish.tsx:21`. Default `true` in the
   `mutationFn` signature. Gate the invoke at `:341` with the publish
   pattern from `:274`. Pass `skippedDescription` at the `:367` call site,
   with both shift-count branches from the design.
   Tests: `tests/unit/useSchedulePublish.test.ts`, the
   "unpublish notification outcomes" describe at `:230`. Mirror the publish
   tests at `:177`, `:190`, `:202`. Cases: zero invoke calls when `notify`
   is false; one call when true; one call when absent; toast text for
   `shiftCount > 0` and for `shiftCount === 0`.
   Depends on task 1.

3. **Add the checkbox and the conditional copy to the unpublish dialog.**
   File: `src/pages/Scheduling.tsx`. Six edits:
   - Add `const [unpublishNotify, setUnpublishNotify] = useState(true);`
     next to `unpublishDialogOpen` at `:270`.
   - Reset it to `true` when the dialog opens, the same as
     `PublishScheduleDialog` does.
   - Pass `notify: unpublishNotify` in the `unpublishSchedule.mutate` call
     inside `handleUnpublishSchedule` at `:793`.
   - Add the `Checkbox` and `Label` pair inside `AlertDialogContent`, with
     `id="unpublish-notify-employees"`. Copy the markup shape from
     `src/components/scheduling/PublishedShiftChangeDialog.tsx:70`.
   - Replace the description at `:1786` with the two exact strings from the
     design, chosen on `unpublishNotify`.
   - Guard the action: `event.preventDefault()` plus
     `disabled={unpublishSchedule.isPending}` on the action, the cancel, and
     the checkbox. Copy `PublishedShiftChangeDialog.tsx:52` and `:85-86`.
   - Change `text-lg` at `:1783` to `text-[17px]` and `text-sm` at `:1785`
     to `text-[13px]`.
   Tests: Playwright, task 9.
   Depends on task 2.

## Gap 2: collapse schedule email on restaurant and week

4. **Add an optional `headers` parameter to `sendEmailResult`.**
   File: `supabase/functions/_shared/emailQueue.ts:94`. Add the sixth
   parameter `headers?: Record<string, string>`. Add it to the Resend body
   at `:111` only when it holds at least one key.
   Tests: `tests/unit/emailQueue.test.ts`. Three cases: five-argument call
   sends no `headers` key; a filled object reaches the body; an empty object
   sends no `headers` key. No dependency.

5. **Create `scheduleEmailThread.ts`.**
   New file `supabase/functions/_shared/scheduleEmailThread.ts`. Two
   exports:
   - `scheduleThreadHeaders(restaurantId, weekStartDate)` returns
     `{ References, 'In-Reply-To' }` from the design's id format.
   - `shiftBusinessDay(iso, timezone)` returns `YYYY-MM-DD` through
     `Intl.DateTimeFormat('en-CA', { timeZone: safeTz(timezone) })`, or
     `null` for a missing, non-string, or unparseable value.
   Tests: new file `tests/unit/scheduleEmailThread.test.ts`. Cases: header
   id format; a shift late in the evening lands on the correct business day
   in `America/New_York`; an invalid timezone falls back and does not throw;
   a missing `start_time` returns `null`. No dependency.

6. **Thread the two schedule-level notifiers.**
   Files: `supabase/functions/notify-schedule-published/index.ts:261` and
   `supabase/functions/notify-schedule-unpublished/index.ts:267`. Build the
   headers once, before the send loop. The publish function uses the payload
   `restaurantId` and `weekStart` from `:55`. The unpublish function uses
   `retraction.week_start_date` from `:260`.
   Tests: task 5 covers the header builder. No unit test harness exists for
   these two functions; state the manual check in the PR body.
   Depends on tasks 4 and 5.

7. **Fix the timezone and thread `notify-shift-changed`.**
   File: `supabase/functions/notify-shift-changed/index.ts`. Three edits:
   - Import `safeTz` and change `:170` to `safeTz(restaurant?.timezone)`.
     This fixes a live crash: an invalid stored timezone already throws in
     `buildShiftChangeMessage`
     (`supabase/functions/_shared/shiftChangedNotification.ts:95`).
   - Read the covering publication once, before the per-recipient loop at
     `:180`. Use the bounded query from the design, with
     `week_start_date >= day - 6 days`.
   - Pass the headers into `sendEmailResult` at `:191`. No covering row and
     no business day both mean no header. Never throw.
   Tests: task 5 covers the pure parts.
   Depends on tasks 4 and 5.

## Gap 3: fix the in-product help

8. **Rewrite four places in the help article.**
   File: `src/content/help/scheduling-and-time/build-publish-weekly-schedule.md`.

   **Line 76**, replace the whole note with:

   > **Note:** A published shift stays editable. When you save a change to a
   > published shift, a confirm dialog opens. The dialog names the employee
   > who can see the shift. It also carries a **Notify employees** checkbox.
   > Clear the checkbox to save the change with no email and no push.

   **Line 151**, replace with:

   > Publishing makes the schedule visible to all employees. It also notifies
   > staff, unless you clear the **Notify employees** checkbox.

   **After line 156**, add one step to the numbered list:

   > 5. Clear **Notify employees about this schedule** to publish with no
   >    notification. The box is checked each time the dialog opens.

   **Lines 159 to 163**, replace the "Once published" list with:

   > Once published:
   > - The schedule is visible to your entire team.
   > - Shifts stay editable. A change to a published shift asks you to
   >   confirm first.
   > - Staff receive a notification, unless you cleared the checkbox.
   > - A status badge appears next to the week range showing the schedule is
   >   published.

   **Lines 167 to 174**, replace the whole section with:

   > ## Unpublish the schedule to withdraw the week
   >
   > Unpublish takes the week back from your team. Use it when the whole week
   > is wrong. To fix one shift, edit the shift in place — see
   > [Edit or delete a single shift](#edit-or-delete-a-single-shift).
   >
   > 1. Click **Unpublish** in the toolbar. It shows only when the current
   >    week is published.
   > 2. Clear **Notify employees** to withdraw the week with no notification.
   > 3. Confirm the action in the alert dialog.
   >
   > The week is no longer visible to your team. Publish again when it is
   > ready.

   The old heading anchor `#unpublish-the-schedule-to-make-corrections` dies
   with this rename. The only link to it sits in the line 76 note, which this
   task rewrites without that link. Grep the repo for the old anchor after the
   edit and check that no reference is left.
   Tests: none. This file is prose. No dependency.

## Verification

9. **Extend the E2E spec.**
   File: `tests/e2e/schedule-quiet-publish-live-edit.spec.ts`. Add one test:
   publish a week, then unpublish it with **Notify employees** clear. Check
   three things: the checkbox is checked when the dialog opens; the week
   returns to the unpublished state; the toast names the shift count and says
   nobody was notified. Reuse `publishWeek`, `seedEmployeeAndShift`, and
   `exposeSupabaseHelpers`.
   Depends on task 3.

10. **Run the gates.**
    `npm run typecheck`, `npm run lint`, `npm run test`, then the E2E spec.

## Out of scope

- No coalesce timer. The design records why.
- No GiST index and no migration. The design records why.
- No change to any employee-facing email subject or body. Commits `790718c1`
  and `809f1b9c` set that copy.
