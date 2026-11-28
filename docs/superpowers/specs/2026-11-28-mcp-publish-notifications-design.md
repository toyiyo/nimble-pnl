# Design: MCP publish and notification tools

Date: 2026-11-28
Status: Draft, waiting for user approval
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
3. A new shift added to a published week has no change-log row.

## Design

### 1. Data (one new migration)

**Table `schedule_notifications`**: one row for each message to one
employee.

| Column | Note |
|---|---|
| `id uuid pk` | Also the provider idempotency key. |
| `restaurant_id uuid not null` | FK `restaurants`, RLS. |
| `employee_id uuid not null` | FK `employees`. |
| `week_start date not null` | Local week. |
| `source text` | `publish` or `shift_change`. |
| `publication_id uuid null` | FK `schedule_publications`. |
| `status text` | `claimed`, `sent`, `failed`. |
| `channels text[]` | `email`, `push` that went out. |
| `claimed_at`, `sent_at`, `attempts`, `last_error` | |

**Table `schedule_notification_changes`**: the changes in each message.

| Column | Note |
|---|---|
| `notification_id uuid` | FK `schedule_notifications` on delete cascade. |
| `change_log_id uuid` | FK `schedule_change_logs`. |
| `employee_id uuid` | Copy of the recipient. |
| `restaurant_id uuid` | RLS. |
| `UNIQUE (change_log_id, employee_id)` | One message per change and employee. |

RLS on both tables: SELECT for a member with `view:scheduling`. No
INSERT/UPDATE/DELETE policy. Only the SECURITY DEFINER functions below
write, and only the service role can execute them.

**Trigger `log_shift_change` (re-declared in full):**

- Add a `published` branch: `OLD.is_published = false AND
  NEW.is_published = true`. One row for each shift that `publish_schedule`
  flips. This logs the first publish, and each new shift at a republish.
- Keep the `updated`, `deleted`, and `unpublished` branches as they are.
- Add `week_start date` to `schedule_change_logs`. The trigger fills it from
  the restaurant time zone and the shift `start_time`.
- Make `changed_by` nullable. Null means a system write (service role). A
  `NOT NULL` column with the new branch would make a service-role publish
  fail.

A draft shift that is not visible gets no row. When the next publish flips
it, it gets a `published` row. A draft that the manager deletes before
the publish never gets a row. Employees did not see it.

**SQL functions** (all take `restaurant_id`):

| Function | Security | Purpose |
|---|---|---|
| `get_schedule_pending_notifications(restaurant, week_start?, week_end?)` | invoker, RLS | (change, recipient) pairs with no `sent` link. State `pending`, `failed`, or `in_doubt` (claimed, owner lease expired). |
| `get_schedule_week_change_log(restaurant, week_start, week_end)` | invoker, RLS | Change rows of the week with actor name and the notifications for each. |
| `claim_schedule_notifications(restaurant, week_start, week_end, source, publication_id, change_log_id?)` | definer, service role | Takes `pg_advisory_xact_lock` on (restaurant, week). Makes one row for each employee with free pairs. Takes back `failed` rows and `claimed` rows older than the lease. Returns rows and their changes. |
| `mark_schedule_notification(id, status, channels, error)` | definer, service role | Writes `sent` or `failed`. |

The lease is 10 minutes. The edge function wall-clock limit is shorter, so
an expired claim has no live owner.

Recipients of a change: `before_data.employee_id` and
`after_data.employee_id` (the same rule as
`deriveShiftChangeRecipients`). An open shift has no recipient and never
shows as pending.

### 2. Notifiers (same code path for UI and MCP)

**`notify-schedule-published`** (changed):

1. Auth and role check stay as they are.
2. Call `claim_schedule_notifications(source = 'publish')`.
3. For each claimed row, send to that employee only. The email lists the
   employee's changes. Send email with `Idempotency-Key: <row id>`.
4. Call `mark_schedule_notification` with the result.
5. Keep `schedule_publications.notification_sent` as it is.

Effect: a republish with no change sends nothing. A republish after an edit
sends to the employees with a change only. **This changes UI behavior.**
The UI shares this function.

**`notify-shift-changed`** (changed): keep the `notified_at` latch. Then call
`claim_schedule_notifications(source = 'shift_change', change_log_id)`.
Send only to the claimed rows, then mark them. A change that a publish
notifier already sent is skipped.

**`sendEmailResult`** (`supabase/functions/_shared/emailQueue.ts:94`) gets an
optional `idempotencyKey` argument for the Resend HTTP header.

### 3. MCP tools (new file `supabase/functions/_shared/mcpPublishTools.ts`)

- `runPublishWeek(args, restaurantId, supabase, deps)`:
  - `preview: true`: read the draft shifts of the week and
    `get_schedule_pending_notifications`. Return each employee who gets a
    message, with the shifts in the message (local times, `tz`). Return the
    count of shifts that the publish will lock.
  - `confirmed: true`: call `publish_schedule` with the user client (same
    RPC as the UI). Then invoke `notify-schedule-published` with the user
    JWT (same function as the UI), unless `notify: false`. Return the
    publication id and the real recipients.
  - The confirm returns the real result. When it differs from the
    preview (a change arrived between the two calls), the result says so.
- `runGetWeekChangeLog`: call `get_schedule_week_change_log`. Each entry:
  change type, shift summary before and after, `changed_by` name,
  `changed_at` local, and the notifications (employee, status, `sent_at`
  local, channels). The top level has `tz`.
- `runGetPendingNotifications`: call `get_schedule_pending_notifications`.
  With no `week_start`, return all published weeks from today on.

Registration: `tools-registry.ts` gets the three definitions, the
manager/owner list, and `publish_week` in `WRITE_TOOLS`. `ai-execute-tool`
gets three `case` lines that call the new file. The change log records
changes from the UI and from the MCP, because the trigger runs for every
shift write.

### 4. Tests

- Unit (`tests/unit/mcpPublishTools.test.ts`): preview grouping, confirm
  path calls the RPC then the function, `notify: false`, local-time
  formatting, error paths.
- pgTAP (`supabase/tests/schedule_notifications.sql`): trigger `published`
  branch, `week_start`, RLS isolation between two restaurants, claim
  uniqueness, second claim with no change returns zero rows, lease reclaim,
  pending states.
- E2E: the UI publish flow must still work. Extend the existing publish spec:
  a republish with no change shows "no notifications" in the toast.

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
  `in_doubt`. After the lease, the next notifier run sends it again with
  the same key, and the provider drops the copy.
- **Push has no provider key.** Web push uses `tag = <row id>`. The browser
  replaces a notification with the same tag, so the employee sees one.
- **Preview drift.** The confirm does not lock the preview. It returns the
  real recipients and flags a difference.
- **Retractions.** `unpublished` rows show in the change log. Their
  notification state comes from `schedule_retractions.notified_at`. They are
  not in the pending tool, because the week is no longer published.

## Out of scope

- A UI page for the change log.
- Changes to `notify-schedule-unpublished`.
- Shift write tools (other session).
