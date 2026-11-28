# MCP shift write tools — plan

Design: `docs/superpowers/specs/2026-11-28-mcp-shift-writes-design.md` (approved 2026-11-28)
Branch: `claude/eager-darwin-sdvxwq` (the session branch; push only here)
TLA+: `specs/tla/mcp-shift-writes/` (done; `tlc.sh all` = 13/13)

User decisions (2026-11-28): connector only (D4); `create_shift` makes a
draft and notifies nobody (D2); E2E is an HTTP test of `ai-execute-tool`
(section 10).

## Rules for every task

- TDD: write the failing test, then the code, then commit with explicit paths.
- Read the design section that the task names before you start.
- Keep the code pure where the design says pure. The pure module has no
  Deno imports, so vitest can import it (precedent:
  `supabase/functions/_shared/shiftChangedNotification.ts`).
- Use `crypto.subtle.digest('SHA-256', ...)`. It is in Deno and Node 20.
- Times: `parseWallClock` and `formatInstant` from
  `supabase/functions/_shared/labor/restaurantClock.ts`. Never the host zone.
- Keep `updated_at` as the raw server string. Never round-trip it through `Date`.
- No nested ternaries. Mark parameters `Readonly<>` where they are objects.
- Write comments in STE-aligned English.

## Tasks

### T1. Pure token module

File: `supabase/functions/_shared/mcpScheduleWritePreview.ts`.
Test: `tests/unit/mcpScheduleWritePreview.test.ts`.

- `canonicalJson(value)`: keys sorted, no whitespace.
- `makePreviewToken({ restaurantId, tool, shiftId, updatedAt, args, notify })`
  returns `base64url({v:1,u}) + '.' + sha256hex(canonicalJson(...))`.
  `updatedAt` is `null` for a create.
- `readPreviewToken(token)` returns `{ updatedAt, hash }` or `null` for a bad token.
- `checkPreviewToken(token, input)` returns `ok`, `mismatch`, or `malformed`.
- `createdShiftId(token)`: first 16 bytes of the hash, version 4 and variant
  bits set, as a UUID string (D8).
- Tests: round trip; one changed arg gives `mismatch`; `notify` change gives
  `mismatch`; a bad base64 gives `malformed`; `createdShiftId` matches the
  v4 regex and is the same for the same token.

### T2. Pure time helpers

Same files as T1.

- `sameInstant(a, b)`: parse a Postgres or ISO timestamp to microseconds
  since epoch (a `bigint`). Accept `Z`, `+00:00`, `-06:00`, `+05:30`, a space
  or `T`, and 0 to 6 fraction digits.
- `resolveInputTime(value, tz)`: an ISO string with `Z` or an offset gives
  that instant. `YYYY-MM-DDTHH:mm` with no offset goes through
  `parseWallClock(value, tz)`. Anything else returns `null`.
- `showTime(iso, tz)` returns `{ utc, local }` (`local` from `formatInstant`,
  pattern `EEE MMM d, h:mm a`).
- Tests: every `sameInstant` form of design section 7; a Chicago wall clock
  on 2026-03-08 (DST) and 2026-11-01; a shift at 7:00 PM Chicago that is
  past UTC midnight shows the Chicago date.

### T3. Pure recipients and notify status

Same files as T1.

- `previewRecipients({ published, notify, op, beforeEmployeeId, afterEmployeeId })`
  returns `[{ employeeId, role }]` with the rules of design D2. For a
  published update it calls `deriveShiftChangeRecipients` from
  `shiftChangedNotification.ts` on a synthetic row, so the two rules cannot drift.
- `notifyStatusFrom({ httpStatus, body, thrown })` returns the D2 status table.
- Tests: one test per row of both D2 tables.

### T4. Pure conflict merge and hour check

Same files as T1.

- `diffConflicts(before, after)` marks each `after` item `new: true` when no
  `before` item has the same `(type, employee_id, other_id)`.
- `weeklyHours(shifts, employeeId, weekStart, tz)`: hours minus breaks,
  shifts not cancelled, shifts that start in the restaurant week.
- `hourLimitConflict(...)` uses `computeHourBudget` from
  `schedule-prompt-builder.ts`.
- `warningsToConflicts(findShiftWarnings(...))` maps `overlap` and `clopen`
  to `overlap` and `short_rest`.
- Tests: an adult at 38h + 4h gives `max_weekly_hours`; a minor gives the
  minor cap; a shift that becomes an overlap is `new: true`; an overlap that
  was there before is `new: false`.

### T5. Pure labor delta

Same files as T1.

- `laborDelta({ shiftsBefore, shiftsAfter, employees, days, tz, projectedSalesByDay, targetPct })`
  runs `scheduledLaborCosts` twice and `computeDailyLaborPercent` twice.
  Returns one item per day in `days`.
- Tests: a retime that adds 2 hours to an $18/h employee adds $36 to that
  day; a day with no projected sales gives `percent: null`.

### T6. Handler: load and preview of `update_shift` and `delete_shift`

File: `supabase/functions/_shared/mcpScheduleWriteTools.ts`.
Test: `tests/unit/mcpScheduleWriteTools.test.ts` with a fake Supabase client
(precedent: the fake clients in `tests/unit/mcpHandler.test.ts`).

- `loadShiftForWrite(supabase, restaurantId, shiftId)`: one select with
  `restaurant_id` and `id`, columns `id, employee_id, start_time, end_time,
  break_duration, position, notes, status, is_published, locked,
  recurrence_parent_id, is_recurring, updated_at`.
- `buildPreview(...)` loads the employees (active check), the window shifts
  plus neighbors, the conflict RPCs (D6 batch rules), the open trades, and
  the labor inputs behind the pay and sales gates. It returns the result of
  design section 4.
- Errors: `SHIFT_NOT_FOUND` (other restaurant too), `EMPLOYEE_NOT_FOUND`,
  `INVALID_ARGUMENTS` (bad time, `end <= start`, no field to change),
  `SERIES_PARENT` for a delete of a parent with children.
- Tests: a cross-restaurant id gives `SHIFT_NOT_FOUND`; the token in the
  result passes `checkPreviewToken` for the same args.

### T7. Handler: confirm of `update_shift` and `delete_shift`

Same files as T6.

- Confirm steps of design D1 (1 to 4). The update sends the detach columns
  of design D9 when the shift is recurring.
- The delete uses `.select('id, employee_id, is_published')`.
- Zero rows: the triage read of D1 step 3.
- After a commit of a published shift with `notify: true`: the exact change
  log lookup of D2, then `supabase.functions.invoke('notify-shift-changed',
  { body: { changeLogId } })`. Map the answer with `notifyStatusFrom`.
- Tests:
  - zero CAS rows and a newer `updated_at` give `STALE_PREVIEW`, and `invoke` has 0 calls;
  - zero rows and no row give `SHIFT_NOT_FOUND`;
  - a published update calls `invoke` 1 time with the row id found by `changed_at`;
  - a draft update and `notify: false` call `invoke` 0 times;
  - a recurring update sends `recurrence_parent_id: null, is_recurring: false, recurrence_pattern: null`;
  - args that differ from the token give `PREVIEW_MISMATCH`, and the update has 0 calls;
  - `confirmed: true` with no token gives `PREVIEW_REQUIRED`;
  - an `invoke` error gives `notification.status: 'failed'` and the result still says the shift changed.

### T8. Handler: `create_shift`

Same files as T6.

- Preview and confirm of design D8. Insert with `id: createdShiftId(token)`,
  `is_published: false`, `locked: false`, `source: 'manual'`,
  `status: 'scheduled'`. `23505` gives `DUPLICATE_SHIFT` and the existing row.
- The preview notes that the shift is a draft and nobody gets a notification.
- Tests: insert payload has the explicit id and both publish flags false; a
  `23505` gives `DUPLICATE_SHIFT`; a copy found by the read check gives
  `DUPLICATE_SHIFT` with 0 insert calls.

### T9. Handler: `simulate_schedule_change`

Same files as T6.

- At most 20 changes. Apply them in memory in order. Write nothing.
- One read of the target shifts with `.in('id', ids)`. One window read. At
  most 6 RPCs at one time. One `get_hourly_sales_pattern` call.
- Tests: 21 changes give `INVALID_ARGUMENTS`; 20 changes give at most 1
  target read, 1 window read, 1 sales call; the fake client records no
  insert, update, or delete.

### T10. Registry and dispatch (keep small)

- `mcpScheduleWriteTools.ts` exports `SCHEDULE_WRITE_TOOL_DEFINITIONS`,
  `SCHEDULE_WRITE_TOOL_NAMES` (the 3 writes), `isScheduleWriteTool`, and
  `runScheduleWriteTool`.
- `tools-registry.ts`: import; spread the 4 definitions into the `getTools`
  list for every role; spread the 3 names into `WRITE_TOOLS`; add
  `preview_token` handling only if `missingRequiredArgs` needs it.
- `ai-execute-tool/index.ts`: one gate branch before `canUseTool` that calls
  `hasEditSchedulingCapability` and returns 403 with
  `required_capability: 'edit:scheduling'`; one dispatch line before the
  `switch`.
- `ai-chat-stream/index.ts`: filter out `isScheduleWriteTool` names and
  `simulate_schedule_change` (D4).
- Tests: extend `tests/unit/tools-registry.test.ts` (the 3 names are in
  `WRITE_TOOLS`; the 4 tools are in `getTools('', 'manager')`), and
  `tests/unit/mcpHandler.test.ts` (the 3 writes have `destructiveHint`,
  simulate is read-only).

### T11. Integration test of `ai-execute-tool` (E2E slice)

File: `tests/e2e/mcp-shift-writes.spec.ts` (Playwright `request`, no page).

- Seed with the helpers in `tests/helpers/` and a service-role client in the
  Node test process only.
- Case 1: preview `update_shift`, change the shift with a direct UPDATE,
  confirm. Expect `STALE_PREVIEW` and no new `schedule_change_logs` row.
- Case 2: publish the week, preview a reassign with `notify: true`, confirm.
  Expect one `updated` change log row and the `changeLogId` in the result.
- If edge functions cannot run in the container, state the justified
  exception in Verify and let CI run the spec.

### T12. Docs

- `docs/CLAUDE_INTEGRATION.md`: add the four tools and the preview/confirm
  rule.
- `mcpHandler.ts` server instructions: one sentence on `preview_token` and
  `STALE_PREVIEW`. Keep the change small.

### T13. TLA+ in Verify

- Run `.claude/skills/run-tla/tlc.sh all`. Expect 13/13.

## Out of scope

- The UI "latest row" lookup race (design section 8). Queued as a separate task.
- Series edits, recurring creates, and the in-app chat.
