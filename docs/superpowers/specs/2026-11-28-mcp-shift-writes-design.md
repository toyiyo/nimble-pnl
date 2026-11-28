# MCP shift write tools — design

Date: 2026-11-28
Branch: `claude/eager-darwin-sdvxwq`
Status: draft, waits for user approval
TLA+: `specs/tla/mcp-shift-writes/` (result in section 9)

## 1. Problem

The EasyShiftHQ MCP connector has read tools only for scheduling
(`get_schedule_overview`, `get_scheduling_context`). Each schedule change
needs manual clicks in the browser. This design adds four tools:

| Tool | Writes | Purpose |
|---|---|---|
| `update_shift` | yes | Reassign or retime one shift. |
| `create_shift` | yes | Add one shift. |
| `delete_shift` | yes | Delete one shift. |
| `simulate_schedule_change` | no | Show the preview of a list of changes. |

## 2. Facts about the current code

Each claim has a citation. The design depends on these facts.

1. The categorization write tools use `preview: true`, then `confirmed: true`.
   The confirm has no stale check
   (`supabase/functions/ai-execute-tool/index.ts:3463`, `:3486`).
2. `WRITE_TOOLS` marks a tool as destructive for the connector
   (`supabase/functions/_shared/tools-registry.ts:944-948`,
   `supabase/functions/_shared/mcpHandler.ts:167`).
3. The connector checks that `restaurant_id` is one of the caller's
   memberships before it forwards a call
   (`supabase/functions/_shared/mcpHandler.ts:330`). `ai-execute-tool` reads
   the role for that `restaurant_id` again (`ai-execute-tool/index.ts:3805-3815`).
4. A timeout of the forward does not stop the server. The connector tells
   Claude to read the data before it calls a write tool again
   (`mcpHandler.ts:345-352`).
5. `hasEditSchedulingCapability` exists and fails closed
   (`tools-registry.ts:1206-1221`). `edit:scheduling` is true for owner,
   manager, operations_manager, collaborator_operations_manager, and area
   grants (`supabase/migrations/20260730140000_user_has_capability_from_areas.sql:146`, `:226`).
6. A `BEFORE UPDATE` trigger sets `shifts.updated_at = NOW()`
   (`supabase/migrations/20251114100000_create_scheduling_tables.sql:262-279`).
7. The `log_shift_change` trigger writes a `schedule_change_logs` row in the
   same transaction as an UPDATE or DELETE of a shift with
   `is_published = true`. It writes no row for an INSERT, and no row for a
   draft shift. `before_data` and `after_data` are `row_to_json(OLD/NEW)`
   (`supabase/migrations/20251123000000_schedule_publishing.sql:96-169`).
8. `publish_schedule` updates the shift rows (`is_published = true,
   locked = true`), so the trigger of fact 6 changes `updated_at`
   (`supabase/migrations/20260729120000_publish_schedule_tz_bucketing.sql:96-103`).
9. The Scheduling UI notifies a change to a published shift with one call:
   `notify-shift-changed` with body `{ changeLogId }`
   (`src/hooks/usePublishedShiftGuard.tsx:193-195`). The function reads the
   row, checks `edit:scheduling`, claims `notified_at` (zero rows = already
   sent), and derives the recipients from the row only
   (`supabase/functions/notify-shift-changed/index.ts:58`, `:85-95`, `:107-121`,
   `supabase/functions/_shared/shiftChangedNotification.ts:72-90`).
10. The function refuses a row older than 10 minutes
    (`supabase/functions/_shared/shiftChangedNotification.ts:28`).
11. The UI finds its change log row with "latest row for this shift, this
    user, since `startedAt`" (`src/hooks/usePublishedShiftGuard.tsx:173-179`).
12. The UI single delete passes `skipLegacyNotify: true`, so a draft delete
    sends nothing and a published delete uses only `notify-shift-changed`
    (`src/pages/Scheduling.tsx:862-875`). An update of a draft shift sends
    nothing (the guard runs `notify: false`,
    `src/hooks/usePublishedShiftGuard.tsx:132-135`).
13. A new shift from the UI is always a draft (`is_published: false,
    locked: false`) (`src/components/ShiftDialog.tsx:250-251`).
14. The UI conflict checks are the RPCs `check_timeoff_conflict` and
    `check_availability_conflict` (`src/hooks/useConflictDetection.tsx:37-49`).
    Overlap and short rest (`MIN_REST_HOURS = 8`) are in
    `supabase/functions/_shared/shiftWarnings.ts:2`, `:36-79`.
15. `max_weekly_hours` comes from `computeHourBudget` (40 for an adult, lower
    for a minor) (`supabase/functions/_shared/schedule-prompt-builder.ts:184-202`).
    It is "stored, not enforced" (`supabase/functions/_shared/schedulingContext.ts:61`).
16. The daily labor % of the connector uses `loadScheduledLaborCost`,
    `get_hourly_sales_pattern`, `projectDailySales`, and
    `computeDailyLaborPercent`, behind `view:pay_rates` and `view:pos_sales`
    (`supabase/functions/_shared/schedulingContextLabor.ts:223-299`).
    `scheduledLaborCosts` is a pure function of shifts and employees
    (`supabase/functions/_shared/labor/scheduledLaborCost.ts:75`).
17. `parseWallClock` converts a restaurant wall clock to UTC, and
    `formatInstant` shows a UTC instant in the restaurant zone
    (`supabase/functions/_shared/labor/restaurantClock.ts:380`, `:138`).
18. The in-app AI chat gets its tools from the same `getTools`
    (`supabase/functions/ai-chat-stream/index.ts:534`). Its confirm guard
    compares all args except `preview` and `confirmed`
    (`src/hooks/useAiChat.tsx:246-248`).

## 3. Decisions

### D1. Preview token with a compare-and-set (CAS) write

The preview returns `preview_token`. The token is
`base64url({ v: 1, u: <raw updated_at string> }) + "." + sha256hex(...)`.
The hash input is the canonical JSON of `restaurant_id`, `tool`, `shift_id`,
the raw `updated_at`, the change args, and `notify`.

The confirm:

1. Checks that the args hash to the token. If not: `PREVIEW_MISMATCH`.
2. Runs one statement with the raw `updated_at` from the token:
   `UPDATE shifts SET ... WHERE id = $id AND restaurant_id = $rid AND updated_at = $u RETURNING *`
   (PostgREST: `.update().eq('id').eq('restaurant_id').eq('updated_at', u).select()`).
   For a delete: `.delete()` with the same filters.
3. Zero rows back means `STALE_PREVIEW`. The tool sends no notification and
   tells Claude to call the preview again.

The raw string goes back unchanged. A JS `Date` drops microseconds (lesson
2026-10-06, PR #842).

A publish or unpublish between the preview and the confirm changes
`updated_at` (fact 8). So the confirm also fails when the published state
changes, and the notified set of the preview stays correct.

A client retry of a committed confirm (fact 4) has the old `updated_at`. It
gets `STALE_PREVIEW` and changes nothing.

### D2. Notification through the UI path only

After a committed write of a published shift with `notify: true`, the tool
calls `notify-shift-changed` with `{ changeLogId }` (fact 9). It uses the
caller's JWT, so the function does its own `edit:scheduling` check. There is
no second notification path.

The tool finds its own change log row exactly. It does not use the UI
"latest row" lookup (fact 11):

- update: `shift_id = id`, `change_type = 'updated'`, and
  `after_data.updated_at` equal to the `updated_at` that the write returned.
- delete: `shift_id = id`, `change_type = 'deleted'`, and
  `before_data.updated_at` equal to the token `updated_at`.

The compare is on the microsecond value, not on the string. A pure helper
`sameInstant(a, b)` parses both Postgres forms. A UI edit right after the
MCP commit makes a second row. The "latest row" lookup then picks the UI
row, and the MCP change gets no notification. TLC finds this case (section 9).

Rules for the set of notified employees (same as the UI, facts 7, 12, 13):

| Shift state | `notify` | Notified |
|---|---|---|
| Published, update | true | old and new assignee (one if the same) |
| Published, delete | true | the assignee |
| Published | false | nobody. The preview warns that nobody is told. |
| Draft (not published) | any | nobody |
| `create_shift` | any | nobody. The new shift is a draft (fact 13). |

The preview computes this set with the same rule as
`deriveShiftChangeRecipients` (fact 9). The confirm result returns
`notification: { status: 'sent' | 'already_sent' | 'failed' | 'not_requested' | 'none_needed', notified: [...] }`.
A failed send does not undo the write. The result says that the shift
changed and the employees were not told, and gives the names.

### D3. Role check per call

Every tool takes `restaurant_id` (the connector requires it, fact 3).
`ai-execute-tool` gates the four tools on `hasEditSchedulingCapability`
for that `restaurant_id` (fact 5). Every query filters on `restaurant_id`.
`employee_id` must be an active employee of that restaurant. Nothing reads
the restaurant that the UI selected.

`simulate_schedule_change` also needs `edit:scheduling`. It shows the
same data that the write preview shows.

### D4. Connector only, not the in-app chat (recommended)

The in-app chat guard compares all args except `preview` and `confirmed`
(fact 18). A confirm with `preview_token` never matches its preview there.
Also the chat UI has no view for a shift preview. So `ai-chat-stream` drops
the four tools with one filter line (`isMcpOnlyTool`). The in-app chat can
get the tools in a later PR.

### D5. Times

- Input `start` and `end`: an ISO instant with `Z` or an offset, or a
  restaurant wall clock `YYYY-MM-DDTHH:mm` with no offset. A wall clock goes
  through `parseWallClock` with the restaurant zone (fact 17).
- Output: each time shows as `{ utc, local, tz }`. `local` comes from
  `formatInstant` with the restaurant zone. Never the server zone.
- `break` is minutes (`shifts.break_duration`).

### D6. Conflicts in the preview

For each changed or new shift, the preview gives `conflicts` with
`new: true` when the conflict is not there before the change:

| Type | Source |
|---|---|
| `overlap`, `short_rest` | `findShiftWarnings` on the employee shifts of the period, plus neighbors (fact 14) |
| `time_off` | RPC `check_timeoff_conflict` (fact 14) |
| `availability` | RPC `check_availability_conflict` (fact 14) |
| `max_weekly_hours` | the employee's scheduled hours in the restaurant week (Monday to Sunday) after the change, compared with `computeHourBudget` (fact 15) |

Conflicts are warnings. They do not block the confirm. The UI also lets a
manager save with a warning.

### D7. Labor % change for the day

For each restaurant day that the change touches, the preview gives
`labor: { date, before: { cost, percent }, after: { cost, percent }, target_pct }`.
It runs the pure `scheduledLaborCosts` twice, with the shifts before and
after the change, and one sales projection (fact 16). Without
`view:pay_rates` or `view:pos_sales`, the item is
`{ hidden: true, reason }`, as `get_scheduling_context` does.

### D8. `create_shift` duplicate guard

A create has no row to compare. A retry after a timeout can add a second
shift (fact 4). The confirm refuses a create when a not-cancelled shift with
the same restaurant, employee, start, and end exists (`DUPLICATE_SHIFT`). The
token for a create hashes the args only.

### D9. Scope limits for this PR

- One shift for each write call. `simulate_schedule_change` takes at most 20
  changes. It writes nothing.
- A recurring shift: the tools change only that one shift (scope `this`).
  The series RPCs are out of scope.
- `create_shift` makes a non-recurring draft shift with `source = 'manual'`.

## 4. Tool contracts

All tools: `restaurant_id` (required, added by the connector).

`update_shift`

```text
shift_id: string (required)
employee_id?: string   start?: string   end?: string   break?: integer (minutes)
position?: string      notes?: string
notify: boolean (required)
preview?: boolean      confirmed?: boolean      preview_token?: string (required with confirmed)
```

`create_shift`: `employee_id`, `start`, `end`, `position` (required),
`break?`, `notes?`, `notify`, and the same flags.

`delete_shift`: `shift_id`, `notify`, and the same flags.

`simulate_schedule_change`: `changes[]`, each
`{ action: 'create' | 'update' | 'delete', shift_id?, employee_id?, start?, end?, break?, position? }`.

Preview result (one item per change):

```json
{
  "action": "update_shift", "preview": true, "preview_token": "…",
  "shift_id": "…", "published": true, "tz": "America/Chicago",
  "before": { "employee": {"id":"…","name":"Ana"}, "start": {"utc":"2026-12-01T22:00:00Z","local":"Tue Dec 1, 4:00 PM"}, "end": {…}, "break": 30 },
  "after":  { "employee": {"id":"…","name":"Ben"}, "start": {…}, "end": {…}, "break": 30 },
  "notifications": { "will_notify": [{"id":"…","name":"Ana","role":"removed"},{"id":"…","name":"Ben","role":"assigned"}], "note": null },
  "conflicts": [{ "type": "short_rest", "employee": "Ben", "new": true, "detail": "6.5h rest before this shift (minimum 8h)" }],
  "labor": [{ "date": "2026-12-01", "before": {"cost": 812.5, "percent": 24.1}, "after": {"cost": 830.0, "percent": 24.6}, "target_pct": 25 }]
}
```

## 5. Files

| File | Change |
|---|---|
| `supabase/functions/_shared/mcpScheduleWriteTools.ts` | New. Tool definitions, handlers, `runScheduleWriteTool`. |
| `supabase/functions/_shared/mcpScheduleWritePreview.ts` | New. Pure: token, diff, recipients, conflict merge, labor delta, `sameInstant`. |
| `supabase/functions/_shared/tools-registry.ts` | Small: spread the 4 definitions into `getTools`, spread the names into `WRITE_TOOLS` (3 tools; simulate is not a write). |
| `supabase/functions/ai-execute-tool/index.ts` | Small: one capability gate branch, one dispatch line. |
| `supabase/functions/ai-chat-stream/index.ts` | One filter line (D4). |
| `tests/unit/mcpScheduleWritePreview.test.ts`, `tests/unit/mcpScheduleWriteTools.test.ts` | New. |
| `specs/tla/mcp-shift-writes/*` | New. |

No new SQL. No migration. pgTAP: not needed, because there is no new SQL.

## 6. Error codes

`INVALID_ARGUMENTS`, `SHIFT_NOT_FOUND`, `EMPLOYEE_NOT_FOUND`,
`PREVIEW_REQUIRED` (confirm without a token), `PREVIEW_MISMATCH`,
`STALE_PREVIEW`, `DUPLICATE_SHIFT`, `TOOL_PERMISSION_DENIED` (403).

## 7. Tests

- Unit (vitest): token round trip and mismatch; `sameInstant` with
  `+00:00`, `Z`, and 3 or 6 fraction digits; the recipient table of D2 (each
  row); diff in UTC and `America/Chicago`, with a shift that crosses UTC
  midnight (lesson 2026-07-12); a wall clock on a DST day; conflict merge
  with `new`; `max_weekly_hours` for an adult and a minor; labor delta with
  the gates off.
- Handler tests with a fake Supabase client: confirm with zero CAS rows
  returns `STALE_PREVIEW` and does not invoke `notify-shift-changed`; a
  committed published update invokes it once with the exact row id; a draft
  update does not invoke it; a cross-restaurant `shift_id` returns
  `SHIFT_NOT_FOUND`; a user without `edit:scheduling` gets 403.
- E2E: see section 10.

## 8. Decided trade-offs

- A failed notification does not roll back the write. The UI does the same
  (fact 9, the UI shows "notification not sent"). The result names the
  employees, so the manager can tell them.
- The UI "latest row" lookup (fact 11) has the race of section 9. This PR
  does not change the UI. A follow-up issue can move the UI to the exact
  lookup.
- `create_shift` on a published week makes a draft and notifies nobody, as
  the UI does (fact 13). The preview says so.

## 9. TLA+ check

Spec: `specs/tla/mcp-shift-writes/McpShiftWrites.tla`. The model has one
shift, two MCP calls (preview, confirm, retry, notify), one UI editor (edit
or delete, and its own notify), and one publish or unpublish. `ver` stands
for `updated_at`.

Invariants:

- `StaleNeverCommits`: a commit happens only on the row version that the
  preview showed. A retry never writes a second time.
- `NotifiedEqualsPreview`: after notify, the employees notified about the
  change log row of a call are the set that its preview showed.
- `FailedWriteSendsNothing`: a stale or rejected confirm sends nothing.
- `ExactlyOnce`: no employee gets two notifications for one row. On a
  published shift with `notify`, each affected employee gets one.

Counterfactuals (each turns off one guard of the design):

| Config | Guard off | Result |
|---|---|---|
| `McpShiftWrites_NoCas.cfg` | `.eq('updated_at', token)` | `StaleNeverCommits` violated |
| `McpShiftWrites_NoArgsCheck.cfg` | args hash check | `NotifiedEqualsPreview` violated |
| `McpShiftWrites_LatestLog.cfg` | exact change log lookup | `NotifiedEqualsPreview` violated (trace: MCP commit, UI edit, MCP notify takes the UI row) |

`tlc.sh all` output:

```text
OK    McpShiftWrites: pass (expected pass; 1107797 distinct states found)
OK    McpShiftWrites_LatestLog: violation (expected violation; 30002 distinct states found)
OK    McpShiftWrites_NoArgsCheck: violation (expected violation; 5797 distinct states found)
OK    McpShiftWrites_NoCas: violation (expected violation; 663 distinct states found)
---- 13/13 configs matched their EXPECT
```

The model does not cover `create_shift`. A create has no prior row and no
notification (D2), so no concurrent writer can break these invariants. D8
covers the retry case.

## 10. E2E

The tools have no UI. A Playwright spec cannot drive an MCP client. The
plan adds an E2E-level test that calls `ai-execute-tool` over HTTP on local
Supabase: preview, a UI-style direct UPDATE of the shift, then confirm. It
expects `STALE_PREVIEW`. A second case confirms a published update and
checks the `schedule_change_logs` row and `notified_at`. If edge functions
cannot run in the cloud container (lesson 2026-10-27: `edge-runtime` cannot
reach `deno.land`), the plan states that as the justified exception and CI
runs the test.
