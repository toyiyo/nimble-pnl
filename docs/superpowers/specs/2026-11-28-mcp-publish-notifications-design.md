# Design: MCP publish and notification tools

Date: 2026-11-28
Status: Approved 2026-11-28 (UI change: yes; quiet changes: option a)
Text standard: STE-aligned (docs/STE100_STYLE.md)

## Problem

The manager uses the EasyShiftHQ MCP connector to run the schedule. The
manager cannot ask "who got a notification, when, and about what". The
connector has no publish tool. The database does not record who got a
notification.

## Tools to add

| Tool | Kind | Role |
|---|---|---|
| `publish_week(restaurant_id, week_start, notify?, preview?, confirmed?)` | write | owner, manager |
| `get_week_change_log(restaurant_id, week_start)` | read | owner, manager |
| `get_pending_notifications(restaurant_id, week_start?)` | read | owner, manager |

The week is `week_start` to `week_start + 6` days, in restaurant local time.

## Current behavior (cited)

### Publish

- The UI calls the `publish_schedule` RPC, then invokes the edge function
  `notify-schedule-published` (`src/hooks/useSchedulePublish.tsx:269`,
  `:286`). `notify: false` skips the invoke (quiet publish).
- `publish_schedule` flips each draft shift of the week to
  `is_published = true, locked = true`, and inserts one
  `schedule_publications` row
  (`supabase/migrations/20260729120000_publish_schedule_tz_bucketing.sql:93-127`).
  It inserts the row also when it flips zero shifts.
- `notify-schedule-published` reads every published shift of the week
  (`supabase/functions/notify-schedule-published/index.ts:131`). It sends to
  **every** employee with a shift in the week (`:144`), also on a republish
  with no change (`:182`). It records only the boolean
  `schedule_publications.notification_sent` (`:344`). It does not record the
  recipients.

### Edits after publish

- The trigger `log_shift_changes` runs `AFTER UPDATE OR DELETE ON shifts`
  (`supabase/migrations/20251123000000_schedule_publishing.sql:166-167`). It
  writes one `schedule_change_logs` row when `OLD.is_published = true`
  (`:96-163`). The row has `change_type`, `employee_id`, `changed_by`,
  `changed_at`, `before_data`, `after_data`.
- The trigger does not log INSERT. It does not log the publish flip
  (`OLD.is_published = false`).
- `changed_by` is `NOT NULL` (`:29`).
- The UI invokes `notify-shift-changed` with one `changeLogId`, when the
  manager keeps "Notify" checked (`src/hooks/usePublishedShiftGuard.tsx:193`).
- `notify-shift-changed` latches `schedule_change_logs.notified_at`
  (`supabase/functions/notify-shift-changed/index.ts:111`). It derives the
  recipients from the row (`:140`). It clears the latch when nobody gets the
  message (`:287`, `:300`). It does not record the recipients.

### MCP

- The MCP server forwards each tool call, with the user JWT, to
  `ai-execute-tool` (`supabase/functions/mcp/index.ts:75`).
- `ai-execute-tool` dispatches with one `switch (tool_name)`
  (`supabase/functions/ai-execute-tool/index.ts:3879`).
- `WRITE_TOOLS` marks a tool as destructive for MCP
  (`supabase/functions/_shared/tools-registry.ts:944`,
  `supabase/functions/_shared/mcpHandler.ts:33`).
- The preview/confirm pattern: `preview: true` returns the plan,
  `confirmed: true` does the write
  (`supabase/functions/ai-execute-tool/index.ts:3432-3512`).

### Gap

1. No record of recipients. "Who got a notification" has no data.
2. A republish with no change notifies every scheduled employee.
3. Two visible changes have no change-log row. A publish flip has none.
   An open-shift claim INSERTs a shift with `is_published = true`
   (`supabase/migrations/20260721140000_open_shift_claim_authz_guard.sql:316-322`,
   `:442-449`), and the trigger has no INSERT branch.
4. The `updated` branch logs every UPDATE of a published shift and does not
   compare columns (`supabase/migrations/20251123000000_schedule_publishing.sql:117-155`).
   The Sling sync upserts with `updated_at = NOW()` on each match
   (`supabase/migrations/20260223100100_sling_sync_rpc.sql:65-73`).

## Design

### 1. Data (one new migration)

**Table `schedule_notifications`**: one row for each message to one
employee.

| Column | Note |
|---|---|
| `id uuid pk` | Also the provider idempotency key and the push `tag`. |
| `restaurant_id uuid not null` | FK `restaurants` ON DELETE CASCADE, RLS. |
| `employee_id uuid null` | FK `employees` ON DELETE SET NULL, the same rule as `schedule_change_logs.employee_id` (`20251123000000_schedule_publishing.sql:27`). |
| `source text` | `publish` or `shift_change`. |
| `publication_id uuid null` | FK `schedule_publications` ON DELETE SET NULL. |
| `status text` | `claimed`, `sent`, `failed`. |
| `channels text[]` | The channels that went out. |
| `claimed_at`, `sent_at`, `attempts`, `last_error` | |

`status = 'sent'` when one channel or more went out. `channels` names
them. A failed channel next to a sent one gets no retry.

**Table `schedule_notification_changes`**: the changes in each message.

| Column | Note |
|---|---|
| `notification_id uuid` | FK ON DELETE CASCADE. Index. |
| `change_log_id uuid` | FK `schedule_change_logs` ON DELETE CASCADE. |
| `employee_id uuid` | The recipient. |
| `restaurant_id uuid` | FK ON DELETE CASCADE, RLS. |
| `UNIQUE (change_log_id, employee_id)` | One message per change and employee. |

The change set of a row is fixed at the first claim. A later claim never
adds a pair to an existing row. New pairs go to a new row with a new id. So
one id always sends the same body, and Resend accepts the retry.

**Grants and RLS.** `REVOKE ALL ... FROM PUBLIC, anon, authenticated` on
both tables, then `GRANT SELECT TO authenticated`. The SELECT policy is
`user_has_capability(restaurant_id, 'view:scheduling')`. No write policy.
The template is `supabase/migrations/20260802120000_schedule_retractions.sql:81-83`.

**New columns on `schedule_change_logs`:**

- `shift_date_before date`, `shift_date_after date`: the restaurant local
  date of `before_data.start_time` and `after_data.start_time`. A
  `BEFORE INSERT` trigger on `schedule_change_logs` fills them. So every
  writer gets them: `log_shift_change`, `unpublish_schedule`
  (`20260802120000_schedule_retractions.sql:201-211`), the template cascade
  (`20260805160000_template_cascade_undo_restores_template.sql:260-267`),
  and the cascade undo (`20260804130000_template_hours_cascade.sql:442-444`).
  A date, not a week, so the tools work for any week start day. A shift that
  moves across a week boundary belongs to both weeks.
- `tracked boolean not null default true`. The migration sets `false` on
  every existing row. Only tracked rows can be pending. Old rows show in the
  change log with `notified_at` only. So the first publish after deploy does
  not email old changes.
- Time zone rule: the same as `publish_schedule`, `UTC` when the zone is
  null, empty, or invalid
  (`20260729120000_publish_schedule_tz_bucketing.sql:76-91`). That function
  decides which shifts a week owns.
- Index `(restaurant_id, shift_date_after)` and
  `(restaurant_id, shift_date_before)`.

**Trigger `log_shift_change`** (re-declared in full; only
`20251123000000_schedule_publishing.sql:96-169` defines it):

- Add `SET search_path = public, pg_temp`.
- Change the trigger to `AFTER INSERT OR UPDATE OR DELETE`.
- New `published` branch for INSERT with `NEW.is_published = true`
  (open-shift claims), and for UPDATE with `OLD.is_published = false AND
  NEW.is_published = true` (the publish flip).
- `updated` branch: log only when a column that the employee sees changes.
  The columns are `start_time`, `end_time`, `employee_id`, `position`,
  `break_duration`, and `status`. The plan checks this list against the
  `shifts` table. A no-op Sling re-sync then writes no row.
- Keep `deleted` and `unpublished` as they are.

**`changed_by` becomes nullable.** Null means a service-role write. Today
the Sling sync is SECURITY DEFINER and called with the service role
(`supabase/functions/sling-bulk-sync/index.ts:214`), so `auth.uid()` is null
there. A Sling update of a published shift fails the `NOT NULL` check
today. With the column-compare rule, a real Sling change gets a row with
`changed_by = null`. The tool shows it as "System (Sling sync)".
`src/types/scheduling.ts:239` and `src/integrations/supabase/types.ts:6881`
change to `string | null`. The filter `.eq('changed_by', user.id)` in
`src/hooks/usePublishedShiftGuard.tsx:176` stays correct.

**Recipients of a change.** `before_data.employee_id` for the old date, and
`after_data.employee_id` for the new date. This is the rule of
`deriveShiftChangeRecipients`
(`supabase/functions/_shared/shiftChangedNotification.ts:68-87`). An open
shift has no recipient and is never pending.

**Pending pair.** A tracked row with `change_type IN ('published',
'updated', 'deleted')`, a recipient, and no link row with `status = 'sent'`.
The rule uses the change type, not the publish state of the week, so a
per-shift `unpublished` row never becomes pending after a republish.

**SQL functions** (all take `restaurant_id`):

| Function | Security | Purpose |
|---|---|---|
| `get_schedule_pending_notifications(restaurant, from_date?, to_date?)` | definer, explicit check | Pending pairs. State `pending`, `failed`, or `in_doubt`. |
| `get_schedule_week_change_log(restaurant, from_date, to_date)` | definer, explicit check | Change rows of the range, actor name, and the notifications for each. |
| `claim_schedule_notifications(restaurant, from_date, to_date, source, publication_id, change_log_id?)` | definer, service role | Locks with `pg_advisory_xact_lock(hashtext(restaurant_id::text), from_date - DATE '2000-01-01')`. Takes back eligible rows. Makes new rows for free pairs. Returns rows and their changes. |
| `mark_schedule_notification(id, status, channels, error)` | definer, service role | Writes `sent` or `failed`. |

The two read functions start with
`IF NOT user_has_capability(p_restaurant_id, 'view:scheduling') THEN RAISE`.
SECURITY INVOKER with RLS gives a wrong answer: the existing
`schedule_change_logs` policy admits any member
(`20251123000000_schedule_publishing.sql:74-82`), but the new tables do not,
so a staff caller sees every change as pending. All four functions get
`REVOKE EXECUTE ... FROM PUBLIC, anon`. The two writers also revoke
`authenticated`.

**Reclaim rules.**

- A `failed` row: the provider rejected it, so nothing arrived. The next
  claim takes it back, with the same id and the same change set.
- A `claimed` row with `claimed_at` older than 10 minutes and newer than
  60 minutes: the next claim takes it back.
- A `claimed` row older than 60 minutes: never sent again automatically.
  The pending tool shows it as `in_doubt`. The manager decides.
- Why these numbers. The session network blocks `supabase.com` and
  `resend.com`, so the plan cannot quote the docs. The window is set so that
  it is safe with a large margin on the limits we expect. The edge function
  wall-clock limit is some minutes, so a 10-minute claim has no live owner.
  Resend keeps an `Idempotency-Key` for many hours, so a resend inside
  60 minutes cannot deliver a copy. The constants are in one SQL function,
  so a later change is one line.
- No cron. A later publish, a later shift-change notify, or a retry runs
  the claim.

The plan checks both platform numbers against the live docs before the
code.

### 2. Notifiers (same code path for UI and MCP)

**`notify-schedule-published`** (changed):

1. Auth and the owner/manager check stay as they are
   (`supabase/functions/notify-schedule-published/index.ts:66`).
2. Call `claim_schedule_notifications(source = 'publish')` for the week.
3. Zero rows claimed: answer 200 with `{ sent: 0, nothingToSend: true }`.
   Today the function answers 502 when nobody was reached (`:382-395`).
4. For each claimed row, send to that employee only. The email lists the
   employee's changes, one line per shift. Send email with
   `Idempotency-Key: <row id>`. Send push with `tag: <row id>`.
5. Call `mark_schedule_notification` with the result.
6. Keep `schedule_publications.notification_sent` as it is.

**`notify-shift-changed`** (changed): the per-employee claim becomes the
only latch. The `notified_at` claim moves after the send, as a record only.
Today a latch set after a partial send blocks a retry of the missed
recipient (`supabase/functions/notify-shift-changed/index.ts:117-121`,
`:277-298`). Zero rows claimed answers 200 with `alreadyNotified: true`.

**`sendEmailResult`** (`supabase/functions/_shared/emailQueue.ts:94`) gets an
optional `idempotencyKey` argument for the Resend HTTP header.

**Quiet paths.** An edit with "Notify" off, and a `notify: false` publish,
leave the pairs pending. The next publish with notify on sends them, and the
preview lists them first. See "Decision for the user" below.

### 3. MCP tools (new file `supabase/functions/_shared/mcpPublishTools.ts`)

- `runPublishWeek(args, restaurantId, supabase, deps)`:
  - `preview: true`: read the draft shifts of the week and
    `get_schedule_pending_notifications`. Return each employee who gets a
    message, with the shifts in the message (local times, `tz`). Return the
    count of shifts that the publish will lock.
  - `confirmed: true`: call `publish_schedule` with the user client (same
    RPC as the UI). Then start `notify-schedule-published` with the user
    JWT (same function as the UI), unless `notify: false`.
  - The MCP forward timeout is 25 s (`supabase/functions/mcp/index.ts:26`).
    `sendPaced` can run 90 s (`supabase/functions/_shared/emailQueue.ts:41`).
    So the tool waits at most 15 s for the notify result. If the result is
    not back, the tool returns `notifications: "sending"`. The callee is a
    separate function call, so it keeps on. When `EdgeRuntime.waitUntil`
    exists, the tool also passes the pending promise to it. The
    result tells the model to call `get_pending_notifications` later. A
    second `confirmed` call is safe: the publish flips nothing, and the
    claim finds nothing free.
  - When the real recipients differ from the preview, the result says so.
- `runGetWeekChangeLog`: call `get_schedule_week_change_log`. Each entry:
  change type, shift summary before and after, actor name (or "System"),
  `changed_at` local, and the notifications (employee, status, `sent_at`
  local, channels). The top level has `tz`.
- `runGetPendingNotifications`: call `get_schedule_pending_notifications`.
  With no `week_start`, the range is today to today + 56 days.

Registration: `tools-registry.ts` gets the three definitions, the
manager/owner list, and `publish_week` in `WRITE_TOOLS`. `ai-execute-tool`
gets three `case` lines that call the new file. The change log records
changes from the UI and from the MCP, because both write `shifts` and the
trigger now runs on INSERT, UPDATE, and DELETE.

**UI follow-on.** `ChangeLogDialog` (`src/components/ChangeLogDialog.tsx:36-64`)
gets the new `published` rows. Add `'published'` to `ChangeType`
(`src/types/scheduling.ts:231`) with the label "Published".

### 4. Tests

- Unit (`tests/unit/mcpPublishTools.test.ts`): preview grouping, confirm
  path calls the RPC then the function, `notify: false`, the 15 s wait,
  local-time formatting, error paths.
- pgTAP (`supabase/tests/schedule_notifications.sql`): the `published`
  branch on INSERT and on the flip, the column-compare rule (a no-op update
  writes no row), the date columns from every writer, `tracked = false` on
  old rows, RLS isolation between two restaurants, the capability check,
  claim uniqueness, a second claim with no change returns zero rows, the
  reclaim windows, the pending states, grants.
- E2E: extend the publish spec. A republish with no change shows "No
  notifications were sent." in the toast.

## TLA+ check

Spec: `specs/tla/publish-notifications/PublishNotifications.tla`.

Actors: the manager (publish, add a draft, edit a visible shift, second
publish with no change), two notifier runs that can overlap, fail, crash,
and retry, and a provider that drops a repeated idempotency key.

Invariants:

| Invariant | Meaning |
|---|---|
| `NoEmptyNotification` | A second publish with no changes sends no notification. |
| `LogExactlyOnce` | Each change after publish appears exactly once in the change log. |
| `NoDuplicateDelivery` | No employee gets two notifications for the same change. |
| `PendingIffNotSent`, `SentRecordIsTrue`, `UndeliveredIsPending` | A change is pending if and only if it has no `sent` notification. A `sent` record is true. A change that did not arrive is always pending. |

Result (`.claude/skills/run-tla/tlc.sh all`):

```text
OK    PublishNotifications: pass (expected pass; 102141 distinct states found)
OK    PublishNotifications_ClientLog: violation (expected violation)      -> LogExactlyOnce
OK    PublishNotifications_NoIdemKey: violation (expected violation)      -> NoDuplicateDelivery
OK    PublishNotifications_NoUniqueClaim: violation (expected violation)  -> NoDuplicateDelivery
OK    PublishNotifications_NotifyAll: violation (expected violation)      -> NoEmptyNotification
OK    PublishNotifications_RecordFirst: violation (expected violation)    -> SentRecordIsTrue
---- 15/15 configs matched their EXPECT
```

`PublishNotifications_NotifyAll` models the current
`notify-schedule-published`. TLC shows that the current UI breaks the
first invariant.

## Decided trade-offs

- **In doubt state.** A crash after the provider accepts and before the
  record step leaves the row `claimed`. The pending tool shows it as
  `in_doubt`. Inside 60 minutes, the next claim sends it again with the same
  key, and Resend drops the copy. After 60 minutes, nothing sends it again.
- **Push has no provider key.** Web push uses `tag = <row id>`. The browser
  replaces a notification with the same tag, so the employee sees one.
- **Role checks differ.** `publish_schedule` admits any member
  (`20260729120000_publish_schedule_tz_bucketing.sql:68`).
  `notify-schedule-published` admits owner and manager only (`:66`).
  `notify-shift-changed` uses `edit:scheduling`
  (`supabase/functions/notify-shift-changed/index.ts:87-90`). This design
  does not align them. The MCP tools admit owner and manager only.
- **Double rows from the template cascade.** The cascade writes its own
  `updated` row, and the trigger writes one more for the same UPDATE. This
  exists today. The email builder groups lines by shift id, so the employee
  sees one line.
- **Preview drift.** The confirm does not lock the preview. It returns the
  real recipients and flags a difference.
- **Retractions.** `unpublished` rows show in the change log. Their
  notification state comes from `schedule_retractions.notified_at`. They are
  not in the pending tool, because the week is no longer published.

## Decisions (approved by the user, 2026-11-28)

1. The UI shares `notify-schedule-published`. After this change, a UI
   republish notifies only the employees with a pending change.
2. Quiet changes stay pending. The next publish with notify on sends them.
   The preview lists them first.

## Out of scope

- A UI page for the change log.
- Changes to `notify-schedule-unpublished`.
- Shift write tools (other session).
