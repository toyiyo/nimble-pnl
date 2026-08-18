# Design: close the three gaps left after the quiet-publish change

Date: 2026-08-18
Branch: `claude/confident-lewin-8e0379`

## 1. The task premise is out of date

The task asks for a fix that is already on `main`.

Commit `26e9e296` ("feat(scheduling): quiet publish and live edit of published
shifts (#756)") merged on 2026-08-15. It removed the lock:

- `src/hooks/usePublishedShiftGuard.tsx:1` holds the guard hook. It reads
  `shifts.locked` fresh, then opens a confirm dialog for a published shift.
- `src/components/scheduling/PublishedShiftChangeDialog.tsx:1` holds that
  dialog. It carries a Notify checkbox.
- `supabase/functions/notify-shift-changed/index.ts:1` sends one email that
  names the change.
- `src/hooks/useSchedulePublish.tsx:274` skips the publish email when the
  manager clears the Notify checkbox.

The two lines the task quotes no longer exist:

- `src/components/PublishScheduleDialog.tsx:151` now reads
  "Editable — a change to a published shift asks you to confirm first".
- `src/components/ShiftDialog.tsx` has no "Shift is Locked" banner. Commit
  `fd7d765b` deleted it.

The employee copy constraint is also already met. Commit `790718c1` deleted the
"Schedule not published yet" alert and the "Draft — not confirmed" badge.
Commit `809f1b9c` deleted the retraction alert. `src/components/employee/ShiftRow.tsx:98`
now carries a hue and a screen-reader-only "Draft" label, with no text badge.

## 2. What is still broken

Three gaps remain. The user approved all three.

### Gap 1 — Unpublish has no notify choice

`src/hooks/useSchedulePublish.tsx:341` invokes `notify-schedule-unpublished`
whenever `shiftCount > 0`. There is no flag to stop it.

`src/hooks/useSchedulePublish.tsx:21` defines `UnpublishScheduleParams` with
four fields. `notify` is not one of them.

Publish got the choice at `src/components/PublishScheduleDialog.tsx:176`.
Unpublish did not. The unpublish dialog at `src/pages/Scheduling.tsx:1787`
promises "and notify employees that the schedule has changed" with no way to
decline.

### Gap 2 — Email does not collapse

Push collapses. Each function passes a `tag`:

- `supabase/functions/notify-schedule-published/index.ts:305` — `"schedule-published"`
- `supabase/functions/notify-schedule-unpublished/index.ts:310` — `"schedule-unpublished"`
- `supabase/functions/notify-shift-changed/index.ts:213` — `` `shift-changed-${row.shift_id}-${employee.id}` ``

Email does not. `supabase/functions/_shared/emailQueue.ts:94` defines
`sendEmailResult(resendApiKey, from, to, subject, html)`. It posts
`{ from, to, subject, html }` to Resend at
`supabase/functions/_shared/emailQueue.ts:111`. There is no header field, so
each message stands alone in the inbox.

Five edits to one published week therefore send five separate
`notify-shift-changed` emails per employee.

### Gap 3 — The in-product help still teaches the deleted workflow

`src/content/help/scheduling-and-time/build-publish-weekly-schedule.md:76`
says the save button is disabled and "You must unpublish the schedule first".

Line 160 says "All shifts are locked and cannot be edited without unpublishing."

Line 167 heads a section "Unpublish the schedule to make corrections", and
line 169 opens it with "If you need to edit shifts after publishing:".

Line 151 says publishing "sends push notifications to staff", with no mention
of the Notify checkbox that `src/components/PublishScheduleDialog.tsx:176`
added.

A manager who reads this help still runs the unpublish/republish cycle that
#756 deleted. This is the closest live match to the owner feedback.

## 3. The fix

### Gap 1 — Add `notify` to unpublish

**Hook.** Add `notify?: boolean` to `UnpublishScheduleParams`
(`src/hooks/useSchedulePublish.tsx:21`). Default it to `true` in the
`mutationFn` signature, so every existing caller keeps its behavior.

Gate the invoke at `src/hooks/useSchedulePublish.tsx:341`:

```ts
const notification: NotificationOutcome =
  !notify
    ? { status: 'skipped' }
    : shiftCount > 0
      ? await invokeScheduleNotification('notify-schedule-unpublished', { ... })
      : { status: 'sent', sent: 0 };
```

This copies the publish pattern at `src/hooks/useSchedulePublish.tsx:274`.

**Toast.** `notificationToast` already handles `skipped` at
`src/hooks/useSchedulePublish.tsx:183`. It returns the plain title and
"No notifications were sent."

That description drops the shift count the manager needs. Add an optional
`skippedDescription` to `NotificationToastCopy`, next to `successDescription`.
The `skipped` branch uses it when present, and keeps the current string when
absent. The unpublish call site at `src/hooks/useSchedulePublish.tsx:367`
passes "N shifts have been unlocked for editing. Nobody was notified."

**UI.** Add a checkbox to the unpublish `AlertDialog` at
`src/pages/Scheduling.tsx:1776`. Mirror `src/components/PublishScheduleDialog.tsx:174`:
`Checkbox` plus `Label`, checked by default.

Reset it to `true` when the dialog opens, the same as
`PublishScheduleDialog` does for its own checkbox.

Make the description at `src/pages/Scheduling.tsx:1787` conditional. It must
not promise a notification the manager declined.

**No RPC change.** `unpublish_schedule` still runs on both paths. The flag
gates the edge-function invoke only, in the client. No pgTAP test applies.

### Gap 2 — Thread schedule email on restaurant and week

**Mechanism.** RFC 5322 `References` and `In-Reply-To` headers. A mail client
groups messages that share a `References` chain. This is the email equal of
the push `tag`.

**New shared module** `supabase/functions/_shared/scheduleEmailThread.ts`:

```ts
export const scheduleThreadHeaders = (
  restaurantId: string,
  weekStartDate: string,
): Record<string, string> => {
  const id = `<schedule-${restaurantId}-${weekStartDate}@easyshifthq.com>`;
  return { References: id, 'In-Reply-To': id };
};
```

The key is `restaurant_id` plus `week_start_date`, as the task asks.

**Sender change.** Add an optional sixth parameter `headers` to
`sendEmailResult` at `supabase/functions/_shared/emailQueue.ts:94`. Forward it
into the Resend request body at `supabase/functions/_shared/emailQueue.ts:111`
only when it holds at least one key. Every current caller passes five
arguments and keeps its behavior.

**Call sites.**

1. `supabase/functions/notify-schedule-published/index.ts:261` — the function
   already holds `restaurantId` and the publication row.
2. `supabase/functions/notify-schedule-unpublished/index.ts:267` — use
   `retraction.week_start_date`, read at
   `supabase/functions/notify-schedule-unpublished/index.ts:260`.
3. `supabase/functions/notify-shift-changed/index.ts:191` — the row has no
   week. Resolve it, see below.

**Week lookup for `notify-shift-changed`.** `schedule_change_logs` has no week
column. `supabase/migrations/20251123000000_schedule_publishing.sql:23` lists
its columns.

Do not re-derive the week from the shift date. The codebase holds two week
conventions: `src/pages/Scheduling.tsx:291` uses `weekStartsOn: 1`, and
`src/hooks/usePeriodNavigation.ts:32` uses a `WEEK_STARTS_ON` constant. A
re-derived week can miss the stored one.

Read the stored value instead. `publish_schedule` buckets a shift into a week
with `(s.start_time AT TIME ZONE v_tz)::date` between `p_week_start` and
`p_week_end`, at
`supabase/migrations/20260729120000_publish_schedule_tz_bucketing.sql:101`.

So:

1. Take the shift start from `after_data.start_time`, or `before_data.start_time`
   for a delete. `supabase/migrations/20251123000000_schedule_publishing.sql:114`
   writes `row_to_json(OLD)` and `row_to_json(NEW)` into those columns.
2. Convert it to the restaurant business day with `Intl.DateTimeFormat` and the
   `en-CA` locale, which gives `YYYY-MM-DD`. The function already reads
   `restaurant.timezone` at
   `supabase/functions/notify-shift-changed/index.ts:170`.
3. Select the covering publication:
   `.eq('restaurant_id', ...).lte('week_start_date', day).gte('week_end_date', day)`,
   ordered by `published_at` descending, limit 1.
4. No row found means no thread header. Send the email with no header.

The lookup runs once per invocation, before the per-recipient loop, not once
per recipient.

### Gap 3 — Fix the help doc

Rewrite four places in
`src/content/help/scheduling-and-time/build-publish-weekly-schedule.md`:

- **Line 76** — replace the lock note. A published shift now opens a confirm
  dialog with a Notify checkbox.
- **Line 151** — say that publishing notifies staff when the Notify checkbox
  stays checked.
- **Line 160** — replace "All shifts are locked and cannot be edited without
  unpublishing" with the confirm-dialog behavior.
- **Lines 167 to 175** — rewrite the unpublish section. Unpublish now means
  "withdraw the week", not "the way to edit". Add the new Notify checkbox.

## 4. Employee-facing copy

The constraint from commits `790718c1` and `809f1b9c`: employee copy must never
read as "your shifts are not real".

This change writes no new employee copy. It adds headers to existing emails and
adds a manager-facing checkbox and help text.

The unpublish subject at
`supabase/functions/notify-schedule-unpublished/index.ts:271` stays as it is.
`supabase/migrations/20260802120000_schedule_retractions.sql:1` holds the
retraction design that set it. A retraction email only goes out after a real
publish, so it corrects a wrong belief. That is the same reason `790718c1`
gave for keeping the retraction alert at the time.

## 5. Decided trade-offs

**Threading does not force one thread across every event type.** Gmail groups
on the `References` chain and on a matching subject. The four subjects differ:

- `supabase/functions/notify-schedule-published/index.ts:267` — "New Schedule Published: ..."
- `supabase/functions/notify-schedule-published/index.ts:266` — "Updated Schedule: ... — changes made"
- `supabase/functions/notify-schedule-unpublished/index.ts:271` — "Schedule update: ... is being revised"
- `supabase/functions/notify-shift-changed/index.ts:195` — "{title} - {restaurant}"

Apple Mail, Outlook, and Thunderbird thread on `References` alone, so all four
collapse there. Gmail collapses repeated messages of the same kind, because
those share a subject.

The storm case is repeated edits to one week. Those all send
"Shift Updated - {restaurant}", one subject, so they collapse in Gmail too.

The alternative is one stable subject for all four kinds. That is rejected: the
subject is the only part an employee reads in a notification list, and a shared
subject would hide whether the week was published, withdrawn, or moved by an
hour. Losing that distinction is the failure mode commits `790718c1` and
`809f1b9c` fixed.

**No coalesce timer.** The task's fallback asked to hold the unpublish mail when
a republish follows soon after. That fallback applied only if the lock stayed.
The lock is gone, so unpublish is now rare. A defer timer would need a queue and
a cron drain for one rare event. Rejected as cost without benefit.

## 6. Tests

| Change | Test | File |
|---|---|---|
| `notify` flag on unpublish | Vitest | `tests/unit/useSchedulePublish.test.ts` |
| `skippedDescription` in `notificationToast` | Vitest | `tests/unit/useSchedulePublish.test.ts` |
| `scheduleThreadHeaders` key format | Vitest | `tests/unit/scheduleEmailThread.test.ts` |
| `sendEmailResult` forwards headers | Vitest | `tests/unit/scheduleEmailThread.test.ts` |
| Unpublish notify checkbox | Playwright | `tests/e2e/schedule-quiet-publish-live-edit.spec.ts` |

No pgTAP test. No RPC and no migration changes in this work.
