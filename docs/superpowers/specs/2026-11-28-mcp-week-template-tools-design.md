# MCP week template tools: design

Date: 2026-11-28. Branch: `claude/zen-ramanujan-yv5jhi`. Status: waiting for approval.

## Problem

A manager does not apply a week template over a week, because the manager
cannot see which manual edits the apply loses. The MCP connector has no week
template tools. The app applies a template with no preview.

## Current behavior (cited)

- Templates live in `schedule_plan_templates` as one JSONB array of shifts
  (`supabase/migrations/20260328100000_schedule_plan_templates.sql:4`). Each
  shift has `day_offset` (0 = Monday), `start_time`, `end_time` as
  restaurant-local wall clocks, `break_duration`, `position`, `employee_id`,
  `employee_name`, `notes` (`src/types/scheduling.ts:319`). The shifts have no
  stable id.
- `update_schedule_plan_template` writes the full array with a compare-and-set
  on `updated_at`
  (`supabase/migrations/20261006120000_editable_week_templates.sql:186`). It
  calls `validate_schedule_plan_template_shifts`.
- `apply_schedule_plan_template` takes instants that the **client** computes
  (`supabase/migrations/20261006120000_editable_week_templates.sql:250`). The
  wall-clock to instant step runs only in the browser:
  `buildShiftsFromTemplate` (`src/lib/schedulePlanTemplates.ts:111`) and
  `templateWeekBounds` (`src/lib/schedulePlanTemplates.ts:161`), called from
  `src/hooks/useSchedulePlanTemplates.ts:135` and `:143`.
- `replace` deletes every unlocked shift in the week
  (`20261006120000_editable_week_templates.sql:283`), then inserts every
  template shift for active employees (`:309`). An equal shift is deleted and
  inserted again, so a second apply is not a no-op. `merge` inserts only when
  the employee has no overlapping shift (`:310`).
- New shifts get `status = 'scheduled'`, `is_published = false` (`:302`).
- The `log_shift_changes` trigger writes a `schedule_change_logs` row when a
  published shift is updated or deleted
  (`supabase/migrations/20251123000000_schedule_publishing.sql:166`). The app
  then calls `notify-shift-changed` with `{ changeLogId }`
  (`src/hooks/usePublishedShiftGuard.tsx:193`).
  `deriveShiftChangeRecipients` gives the recipients of one log row
  (`supabase/functions/_shared/shiftChangedNotification.ts:68`).
- `shifts.updated_at` has a BEFORE UPDATE trigger
  (`supabase/migrations/20251114100000_create_scheduling_tables.sql:276`).
  `shifts.source` exists, default `'manual'`
  (`supabase/migrations/20260411000000_add_shift_source_column.sql:2`).
- No table records an apply. No table holds holidays or opening-hour
  exceptions (a search of `supabase/migrations` for holiday, special_hours,
  closure, business_hours, operating_hours finds none).
- `create_shift_trade_for_employee` lets an `edit:scheduling` caller post a
  draft (unpublished) shift for trade
  (`supabase/migrations/20260821120000_trade_approval_area_grant.sql:181`).
- SQL `timestamp AT TIME ZONE tz` and the shared `parseWallClock` resolve a
  DST gap and a DST repeat the same way: the smaller UTC offset wins
  (`supabase/functions/_shared/labor/restaurantClock.ts:380`, comment above
  it; pinned by `supabase/tests/wall_clock_parity.sql`).
- The MCP lists `WRITE_TOOLS` as destructive
  (`supabase/functions/_shared/mcpHandler.ts:33`,
  `supabase/functions/_shared/tools-registry.ts:944`). The dispatcher gates
  `CAPABILITY_GATED_TOOLS` on view:scheduling or view:payroll
  (`tools-registry.ts:1085`, `ai-execute-tool/index.ts:3830`).

## Decisions from the user (2026-11-28)

1. Holiday hours: return `holiday_hours: "not_tracked"`. A separate session
   adds holiday and opening-hour exceptions (suggested task queued).
2. Notifications: after the commit, send through `notify-shift-changed`, one
   call per new change-log row. No new notification code.
3. Time off: the caller picks `time_off: "skip"` (default) or `"trade"`.
   `trade` adds the shift and posts it for trade with
   `create_shift_trade_for_employee`, so coworkers can pick it up.
4. App UI: the Week Templates apply dialog uses the new SQL path. It shows a
   summary of the dry run, then confirms with the token.

## Approach

Move the apply logic to SQL. The app and the MCP call the same two RPCs.
The old `apply_schedule_plan_template` stays for one release so open browser
tabs with an old bundle still work. It gets a `-- DEPRECATED` comment.

### SQL (one migration, `20261128120000_week_template_apply_diff.sql`)

1. **`schedule_template_applications`** (new table): `id`, `restaurant_id`,
   `template_id`, `week_start date`, `mode`, `applied_at`, `applied_by`,
   `shift_ids uuid[]` (rows added or changed by the apply). RLS: SELECT with
   `view:scheduling`. No write policies; only the definer RPC writes. Index
   `(restaurant_id, week_start, applied_at DESC)`.
2. **`week_template_plan(p_restaurant_id, p_template_id, p_week_start, p_mode,
   p_time_off)`** (internal, `STABLE`, revoked from `authenticated`). It
   returns the plan as JSONB. One copy of the logic:
   - Instants: `((p_week_start + day_offset) + start_time) AT TIME ZONE tz`.
     The end rolls to the next day when `end_time <= start_time`. The week is
     `[monday 00:00, next monday 00:00)` in `restaurants.timezone`.
   - Slot = (employee, local day). Existing shifts in the slot are matched to
     template shifts in start order. Per slot, for `replace`:
     an equal shift (start, end, break, position, notes) is kept (no-op);
     an unequal unlocked shift is **changed in place** (same id);
     extra unlocked shifts are deleted; a locked shift is never touched, and a
     template shift that meets a locked shift is skipped with reason `locked`;
     an empty slot gets an add.
   - `fill_gaps`: add only when the employee has no overlapping shift. Never a
     change or a delete. This keeps the old `merge` overlap rule.
   - Inactive employees: skip with reason `inactive` (as today).
   - Approved time off on the slot day: `skip` gives reason `time_off`;
     `trade` gives an add with `post_for_trade: true`.
   - A DST step that gives `end <= start`: skip with reason `dst_no_length`.
3. **`preview_week_template_apply(...)`** (`edit:scheduling`, read only).
   It returns:
   - `add[]`, `delete[]`, `change[]` (with before and after), `skip[]`.
   - `flags[]`, for each `delete` or `change` row:
     `time_off_cover` (the shift is on a day where a template employee has
     approved time off), `edited_after_apply` (`created_at` or `updated_at` is
     later than the last `schedule_template_applications.applied_at` for the
     week), `deleted_day` (the last apply added shifts on a day that now has
     no shifts, and this apply adds them again). With no earlier apply, the
     last two flags cannot fire; the result says `last_apply: null`.
   - `holiday_hours: "not_tracked"`.
   - `published: boolean` and `notify[]`: the employees whose published shift
     the apply deletes or changes (the trigger then logs it). Added shifts are
     unpublished, so they send no notification.
   - `week_token`: `md5` of the template `updated_at`, the week shift rows
     (id, updated_at, start, end, employee, position, locked, status,
     is_published), and the approved time off of the week.
4. **`apply_week_template(..., p_expected_token)`** (`edit:scheduling`):
   1. `pg_advisory_xact_lock` on (restaurant, week). Template `FOR SHARE`.
      Week shift rows `FOR UPDATE`.
   2. Compute the token. If it differs from `p_expected_token`, RAISE
      `Week changed after the dry run. Run the dry run again.` Nothing commits.
   3. Compute the plan with `week_template_plan` (the same call the preview
      makes). Delete and update by id. Insert the adds with
      `source = 'week_template'`. For `post_for_trade` rows, call
      `create_shift_trade_for_employee`.
   4. Post-check: the week id set must equal (snapshot − deleted) ∪ inserted,
      and the time-off fingerprint must not change. Else RAISE (rollback).
      Reason: an INSERT by another session is not blocked by the row locks
      under READ COMMITTED (TLA+ `NoPostCheck` finds this).
   5. Insert the `schedule_template_applications` row. Return the counts and
      the new `schedule_change_logs` ids.

### MCP (`supabase/functions/_shared/mcpWeekTemplateTools.ts`, new)

Every tool takes `restaurant_id`. The dispatcher already checks membership.

- **`get_week_template(restaurant_id, id)`**: view:scheduling. Returns
  `{ tz, template: {id, name, version}, employees: [{employee_id, name,
  total_hours, days: [{day: "Mon", shifts: [{shift_key, start, end,
  break_minutes, position, notes, hours}]}]}], total_hours }`. Times are
  local `HH:MM` with the restaurant `tz`. Hours = span − break, overnight
  wraps. `shift_key` = `day_offset:employee_id:start_time`.
- **`update_week_template(restaurant_id, id, add[], remove[], modify[],
  preview | confirmed, version)`**: edit:scheduling. `remove` and `modify`
  use `shift_key`. A key that matches 0 or 2+ shifts is an error. Preview
  returns the before and after per employee and the `version`. Confirm
  rebuilds the array from the current template and calls the existing
  `update_schedule_plan_template` with `p_expected_updated_at = version`, so
  a stale preview fails there. No new SQL.
- **`apply_week_template(restaurant_id, id, week_start, mode, time_off,
  dry_run, confirm_token)`**: edit:scheduling. `dry_run` defaults to `true`
  and calls the preview RPC. `dry_run: false` requires `confirm_token` and
  calls the apply RPC. After the commit, the tool calls
  `notify-shift-changed` once per returned change-log id (at most 10 at a
  time) and reports sent and failed counts.

Registration only in `tools-registry.ts` (definitions, `WRITE_TOOLS`,
role list) and `aiWriteTools.ts` (`WRITE_TOOL_NAMES`). The
`ai-execute-tool/index.ts` switch gets three `case` lines that call the new
file.

### App UI

`useSchedulePlanTemplates.applyTemplate` calls `preview_week_template_apply`,
then `apply_week_template` with the token. `ApplyWeekTemplateDialog` shows the
counts (add, change, delete, skip) and the flag count before the user clicks
Apply. The mode label `merge` becomes "Fill gaps" and maps to `fill_gaps`.

## TLA+ check

Spec: `specs/tla/week-template-apply/WeekTemplateApply.tla`. Actors: the
manager (DryRun, Check, Commit), other editors (insert, update, delete),
template edits, and time-off approvals. Check and Commit are separate actions,
so an INSERT can run between them.

| Invariant | Bad outcome it rejects |
|---|---|
| `NoStaleCommit` | A commit where the week, template, or time off changed after the dry run |
| `DryRunEqualsResult` | The committed week differs from the dry-run diff applied to the dry-run week |
| `FillGapsKeepsRows` | `fill_gaps` changes or deletes an existing row |
| `DeletesOnlyListed` | A deleted id that the dry run did not list |
| `Idempotent` | A second apply with the same input has a non-empty plan |

Bounds: 2 slots, 2 values, 2 edits, 2 applies, 3 start weeks, all templates.

```text
OK    WeekTemplateApply: pass (expected pass; 251100 distinct states found)
OK    WeekTemplateApply_FillOverwrites: violation (expected violation)   -> FillGapsKeepsRows
OK    WeekTemplateApply_NoPostCheck: violation (expected violation)      -> DryRunEqualsResult
OK    WeekTemplateApply_NoToken: violation (expected violation)          -> NoStaleCommit
OK    WeekTemplateApply_NoTokenDeletes: violation (expected violation)   -> DeletesOnlyListed
OK    WeekTemplateApply_OldReplace: violation (expected violation)       -> Idempotent
---- 6/6 configs matched their EXPECT
```

`OldReplace` is today's delete-all and insert-all `replace`. It fails
`Idempotent` from the first state. The diff-based `replace` fixes this.

## Tests

- pgTAP `supabase/tests/<next>_week_template_apply.test.sql`: token mismatch
  raises; equal rows are no-ops; second apply is empty; `fill_gaps` keeps
  rows; locked rows kept; time off skip and trade; flags; post-check raise;
  DST gap and repeat parity; tenant isolation; role denial.
- Unit `tests/unit/mcpWeekTemplateTools.test.ts`: grouping and hours,
  `shift_key` edits, preview/confirm flags, `dry_run` and token rules, role
  denial, notification fan-out.
- E2E: extend `tests/e2e/week-templates.spec.ts` for the dialog summary and
  apply.

## Decided trade-offs

- `replace` changes behavior: equal shifts keep their ids, and unequal shifts
  are changed in place. Published shifts that do not change send no
  notification. This is the fix for idempotency, not a regression.
- A concurrent INSERT into the week makes the confirm fail. The user runs the
  dry run again. This is rare and safe.
- `update_week_template` preview checks shape in TypeScript. The server
  validator is authoritative at confirm time.

## Out of scope

Holiday and opening-hour exceptions (separate session). The shift write
tools and the notification preview (another session).
