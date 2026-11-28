# MCP shift template tools: design

Date: 2026-11-28
Status: draft, waits for approval
Branch: `claude/brave-cannon-ofnnes`

## Problem

The planner coverage slots are rows in `shift_templates`. Today a manager makes
each slot in a dialog, one at a time. One user filled about 20 dialogs in one
session. The EasyShiftHQ MCP connector has no tool for these rows.

## Goal

Add 4 MCP tools: `list_shift_templates`, `create_shift_template`,
`update_shift_template`, and `delete_shift_template`. The 3 write tools take a
batch and use the `preview` / `confirmed` pattern.

## Non-goals

- No change to `coverage.open_spots` or to `get_scheduling_context`. The
  data-fix session owns them.
- No cascade of new template hours to linked shifts. The planner dialog keeps
  that feature (`update_shift_template_with_cascade`). See "Decided trade-offs".
- No UI change.

## Facts about the current code

| Fact | Source |
|---|---|
| The table is `shift_templates`: `name`, `start_time TIME`, `end_time TIME`, `break_duration INTEGER`, `position`, `is_active`, `updated_at`. | `supabase/migrations/20251114100000_create_scheduling_tables.sql:34-47` |
| `updated_at` changes on every UPDATE (trigger). | `supabase/migrations/20251114100000_create_scheduling_tables.sql:281-282` |
| `days INTEGER[]`, each value 0-6 (0 = Sunday). | `supabase/migrations/20260301044927_shift_templates_days_array.sql:5,15-17` |
| `area TEXT` is optional. | `supabase/migrations/20260411200001_add_area_to_shift_templates.sql:2` |
| `capacity INTEGER NOT NULL DEFAULT 1 CHECK (capacity >= 1)` is "staff needed". | `supabase/migrations/20260411221543_add_capacity_to_shift_templates.sql:5-7` |
| Two active templates cannot share `(restaurant_id, position, start_time, end_time, days, COALESCE(area,''))`. | `supabase/migrations/20260528120000_shift_templates_idempotent_apply.sql:22-24` |
| `shifts.shift_template_id` is a FK with `ON DELETE SET NULL`. | `supabase/migrations/20260416000000_add_shift_template_id.sql:3-4` |
| `open_shift_claims.shift_template_id` is a FK with `ON DELETE CASCADE`. | `supabase/migrations/20260412145842_open_shift_claims.sql:9` |
| `template_hours_cascade_batches.shift_template_id` is a FK with `ON DELETE CASCADE`. | `supabase/migrations/20260805160000_template_cascade_undo_restores_template.sql:24` |
| INSERT, UPDATE and DELETE on `shift_templates` need `edit:scheduling` (RLS). | `supabase/migrations/20260730150000_rewrite_collaborator_policies.sql:106-128` |
| The dialog is `TemplateFormDialog`. It is valid only when the trimmed name and position are not empty, at least 1 day is set, both times are set, and start is not equal to end. | `src/components/scheduling/ShiftPlanner/TemplateFormDialog.tsx:109-110` |
| The dialog clamps break to `>= 0` and capacity to `>= 1`. | `src/components/scheduling/ShiftPlanner/TemplateFormDialog.tsx:370,388` |
| The dialog trims name and position, and sends an empty area as `null`. | `src/components/scheduling/ShiftPlanner/TemplateFormDialog.tsx:159-163` |
| The dialog allows end before start (overnight). The only time rule is `startTime !== endTime`. | `src/components/scheduling/ShiftPlanner/TemplateFormDialog.tsx:110` |
| "Hide" sets `is_active = false`. Linked shifts stay. | `src/hooks/useShiftTemplates.tsx:376-380` |
| "Delete" is a hard DELETE. | `src/hooks/useShiftTemplates.tsx:412-420` |
| The delete dialog shows pending claims (destroyed), future linked shifts (kept), and upcoming open spots in 28 days. | `src/hooks/useTemplateDeletionImpact.ts:13,30-55` |
| The update RPC checks `edit:scheduling` and locks the template `FOR UPDATE`. | `supabase/migrations/20260805160000_template_cascade_undo_restores_template.sql:83,105` |
| Write tools are listed in `WRITE_TOOLS`. The MCP marks them `destructiveHint`. | `supabase/functions/_shared/tools-registry.ts:944-948`, `supabase/functions/_shared/mcpHandler.ts:179` |
| The client write list is `WRITE_TOOL_NAMES`. | `supabase/functions/_shared/aiWriteTools.ts:9-13` |
| `hasEditSchedulingCapability` exists and fails closed. | `supabase/functions/_shared/tools-registry.ts:1206-1221` |
| The dispatcher checks capability-gated tools, else `canUseTool`. | `supabase/functions/ai-execute-tool/index.ts:3830-3848` |
| The dispatcher resolves the restaurant time zone once per call. | `supabase/functions/ai-execute-tool/index.ts:3872` |
| `preview` and `confirmed` must be booleans. | `supabase/functions/_shared/tools-registry.ts:1025-1035` |

## Approaches

1. **Recommended: TS tool module + 3 SQL RPCs.** The TS module validates, reads
   impact, and builds the preview. Each confirm calls one RPC. The RPC locks
   the rows, checks the preview fingerprint, and writes the whole batch in one
   transaction.
2. TS only, with PostgREST writes. A batch of 20 is 20 requests. A failure in
   row 12 leaves rows 1-11. The `RowByRow` TLA+ config shows this bug.
3. Loop over `update_shift_template_with_cascade` for update. It gives the
   cascade, but it has no fingerprint check and it is one call per row.

## Design

### Files

| File | Change |
|---|---|
| `supabase/functions/_shared/mcpShiftTemplateTools.ts` | New. Pure validation, token, and preview builders. Loaders. `runShiftTemplateTool()`. |
| `supabase/functions/_shared/shiftTemplateToolDefs.ts` | New. The 4 `ToolDefinition` objects and `SHIFT_TEMPLATE_TOOLS`. |
| `supabase/functions/_shared/tools-registry.ts` | Register: spread the 4 definitions into `getTools`, add 3 names to `WRITE_TOOLS`. |
| `supabase/functions/_shared/aiWriteTools.ts` | Add 3 names to `WRITE_TOOL_NAMES`. |
| `supabase/functions/ai-execute-tool/index.ts` | 2 small hunks: skip `canUseTool` for `SHIFT_TEMPLATE_TOOLS` (the module checks capability), and 1 `case` group that calls `runShiftTemplateTool`. |
| `supabase/migrations/2026112812xxxx_mcp_shift_template_rpcs.sql` | New. 3 RPCs. |
| `supabase/tests/mcp_shift_template_rpcs.test.sql` | New pgTAP. |
| `tests/unit/mcpShiftTemplateTools.test.ts` | New Vitest. |
| `specs/tla/shift-template-crud/*` | New TLA+ spec and 4 configs. |

The task said "change `tools-registry.ts` only to register them". The dispatcher
in `ai-execute-tool/index.ts` must also get a `case`, or the call fails with
`Unknown tool`. The hunks are 2 short blocks.

### Access check

- `list_shift_templates` needs `view:scheduling`.
- The 3 write tools need `edit:scheduling` (`hasEditSchedulingCapability`). This
  is the same capability that RLS uses for writes.
- The module checks the capability before any read. A denial returns
  `TOOL_PERMISSION_DENIED` with `required_capability`.
- The RPCs are `SECURITY INVOKER`. RLS applies. Each RPC also calls
  `user_has_capability(p_restaurant_id, 'edit:scheduling')` and raises `42501`.
- Every query filters on `restaurant_id`. Each `template_id` must belong to
  `restaurant_id`, else the row error is `NOT_FOUND`.

### Fields and time zone

Input and output use the same names:

| Tool field | Column | Rule (same as the dialog) |
|---|---|---|
| `name` | `name` | Trim. Not empty. Max 100 characters. |
| `position` | `position` | Trim. Not empty. Max 100 characters. |
| `area` | `area` | Optional. Trim. Empty gives `null`. |
| `days` | `days` | Not empty. Each value is `"sun"`..`"sat"` (any case) or 0-6. The tool sorts and deduplicates. |
| `start_time`, `end_time` | `start_time`, `end_time` | `"HH:MM"`, 24 h, local restaurant time. Start is not equal to end. End before start is an overnight slot. |
| `break_minutes` | `break_duration` | Integer, `>= 0`. Default 0. |
| `staff_needed` | `capacity` | Integer, `>= 1`. Default 1. |

The dialog clamps a bad break or capacity value. The tool rejects it with a row
error. A silent clamp from a model call is a wrong value that nobody sees.

The max length rule is new. The column has no limit. The rule stops a model
from writing a very long text.

Template times are wall-clock `TIME` values in the restaurant zone. The tool
returns them as `"HH:MM"`, with `overnight: true|false` and a `tz` field
(the IANA name from `resolveRestaurantTimeZone`). Linked shift times in the
preview are `timestamptz`. The tool converts them to local date and time in
`tz`.

### `list_shift_templates`

Arguments: `restaurant_id`, optional `status` (`active` default, `inactive`,
`all`), optional `area`, optional `position`.

Returns `{ tz, templates: [...] }`. Each template has `template_id`, the fields
above, `days` as names (`["Mon","Tue"]`), `is_active`, `updated_at`, and
`linked_future_shifts` (count). Sort: area, start time, position. Cap: 500 rows,
with `truncated: true` if more exist.

### `create_shift_template`

Arguments: `restaurant_id`, `templates` (array, 1-50 rows), `preview`,
`confirmed`, `preview_token`.

Preview:
- Validate each row. Check each row against the active slots in the
  restaurant and against the other rows in the batch.
- If any row has an error, return `ok: false`, `INVALID_ARGUMENTS`, and
  a per-row error list. No token.
- Else return the normalized rows, `tz`, a summary ("20 slots, 140 staff spots
  per week"), and `preview_token`.

Confirm: check the token (see below), then call `mcp_create_shift_templates`.
The RPC validates every row again and inserts all rows in one statement. A
`23505` on the slot index rolls back every row. The tool returns `SLOT_TAKEN`
with the row number.

### `update_shift_template`

Arguments: `restaurant_id`, `updates` (array, 1-50 rows). Each row has
`template_id` and the fields to change. A row can also set `is_active: true` to
restore a hidden template.

Preview:
- Read the current rows. Merge each patch into its row. Validate the result
  with the same rules and the same slot check.
- For each row, show `before` and `after` for each changed field.
- If the hours or days change, list the linked future shifts: count, and up to
  10 samples with local date, time, employee name, and published state. Say
  that these shifts keep their hours, and that the planner edit dialog can move
  them.
- If `staff_needed` changes, show the current upcoming open spots (28 days,
  as in the delete dialog) and the change per slot day.
- Return `preview_token` with the fingerprint of each row.

Confirm: call `mcp_update_shift_templates` with the full merged rows and the
fingerprints.

### `delete_shift_template`

Arguments: `restaurant_id`, `template_ids` (1-50), `mode` (`hide` or
`delete`, required).

Preview for each template:
- `hide`: the template leaves the planner grid and the AI scheduler. Linked
  shifts stay and keep their link. Pending claims stay. The user can restore
  it with `update_shift_template` and `is_active: true`.
- `delete`: pending claims (count and employee names) are deleted by the FK
  cascade. This cannot be undone. Linked shifts (count, future count) stay, and
  their link is cleared. Upcoming open spots (28 days) go away. The undo
  history of earlier hour cascades is deleted.
- Return `preview_token`.

Confirm: call `mcp_delete_shift_templates`.

### Preview token and the stale check

The token is base64url JSON:

```json
{ "v": 1, "tool": "delete_shift_template", "args_sha256": "…",
  "rows": [{ "id": "…", "updated_at": "…", "pending_claims": 2, "linked_shifts": 5 }] }
```

- `args_sha256` is the SHA-256 of the canonical (sorted keys) tool arguments,
  without `preview`, `confirmed`, and `preview_token`. The confirm computes it
  again. A different value gives `PREVIEW_MISMATCH`: the model must confirm the
  same rows that the user saw.
- `rows` is the fingerprint. The RPC compares it under a row lock.
- `linked_shifts` counts all linked shifts, not only future ones. A shift
  that starts between the preview and the confirm must not make the preview
  stale.
- The token is not signed. It is a concurrency guard, not an access control.
  RLS and the capability check give the access control. A forged fingerprint
  can only make the RPC fail.

Each update or delete RPC does these steps in one transaction:

1. Check `edit:scheduling`.
2. `SELECT ... FROM shift_templates WHERE restaurant_id = $1 AND id = ANY($2) ORDER BY id FOR UPDATE`.
   The `ORDER BY id` gives one lock order, so two batches cannot deadlock.
3. If a row is missing, raise `P0002` (`NOT_FOUND`).
4. Count the pending claims and the linked shifts for each row. Compare
   `updated_at` and both counts with the fingerprint. On any difference, raise
   the custom SQLSTATE `PT409` with the message `STALE_PREVIEW`.
5. Write all rows. Return the rows and the counts.

Why the counts cannot change after step 4: an INSERT or UPDATE that sets a FK
to the template takes `FOR KEY SHARE` on the template row. `FOR UPDATE`
conflicts with `FOR KEY SHARE`. So no new claim or linked shift can appear
until the RPC commits. The TLA+ `UiLinkShift` and `UiAddClaim` actions model
this as one step.

A create has no row to fingerprint. Its stale case is a slot that another
writer takes after the preview. The unique index catches it, and the whole
batch rolls back.

On `STALE_PREVIEW`, the tool tells the model to run the preview again and show
the user the new preview.

### SQL RPCs

```sql
mcp_create_shift_templates(p_restaurant_id uuid, p_rows jsonb) RETURNS jsonb
mcp_update_shift_templates(p_restaurant_id uuid, p_rows jsonb) RETURNS jsonb
mcp_delete_shift_templates(p_restaurant_id uuid, p_mode text, p_rows jsonb) RETURNS jsonb
```

- `SECURITY INVOKER`, `SET search_path = public`.
- `REVOKE ALL ... FROM PUBLIC, anon`; `GRANT EXECUTE ... TO authenticated`.
- Max 50 rows. Each RPC validates the same rules as the TS module. SQL is the
  authority.
- Error codes: `22023` (invalid row, message names the row index and field),
  `P0002` (not found), `PT409` (stale), `23505` (slot taken), `42501`
  (no capability).

### Error codes returned to the model

`INVALID_ARGUMENTS`, `TOOL_PERMISSION_DENIED`, `PREVIEW_REQUIRED`,
`PREVIEW_MISMATCH`, `STALE_PREVIEW`, `SLOT_TAKEN`, `NOT_FOUND`.

## TLA+ check

Spec: `specs/tla/shift-template-crud/ShiftTemplateCrud.tla`.

Actors: one MCP agent (batch create, update of `t1`, or hard delete of `t1`,
each as preview then confirm) and the planner UI (edit `t1`, delete `t1`,
link shifts to `t1`, add pending claims on `t1`, take the slot of a batch row).

Invariants:
- `NoStaleCommit`: a confirm never writes when the fingerprint changed after
  the preview.
- `BatchAllOrNothing`: when the tool call ends, the batch rows exist all or
  none.
- `NoDanglingRef`: no shift and no coverage claim points to a missing template.

Configs:

| Config | Guard off | EXPECT |
|---|---|---|
| `ShiftTemplateCrud.cfg` | none (planned design) | pass |
| `ShiftTemplateCrud_NoStaleCheck.cfg` | fingerprint compare | violation of `NoStaleCommit` |
| `ShiftTemplateCrud_RowByRow.cfg` | one transaction per batch | violation of `BatchAllOrNothing` |
| `ShiftTemplateCrud_NoFk.cfg` | FK check in the same statement | violation of `NoDanglingRef` |

`tlc.sh all` output:

```text
OK    ShiftTemplateCrud: pass (expected pass; 6864 distinct states found) log=/tmp/tlc-logs/ShiftTemplateCrud.log
OK    ShiftTemplateCrud_NoFk: violation (expected violation; 246 distinct states found) log=/tmp/tlc-logs/ShiftTemplateCrud_NoFk.log
OK    ShiftTemplateCrud_NoStaleCheck: violation (expected violation; 108 distinct states found) log=/tmp/tlc-logs/ShiftTemplateCrud_NoStaleCheck.log
OK    ShiftTemplateCrud_RowByRow: violation (expected violation; 231 distinct states found) log=/tmp/tlc-logs/ShiftTemplateCrud_RowByRow.log
---- 13/13 configs matched their EXPECT
```

## Tests

- Vitest (`tests/unit/mcpShiftTemplateTools.test.ts`): field rules, day parse,
  time parse, overnight flag, in-batch slot duplicates, merge of an update
  patch, token encode and decode, `PREVIEW_MISMATCH`, error mapping from
  SQLSTATE, preview text for each delete mode, capability denial, and the
  registry entries.
- pgTAP (`supabase/tests/mcp_shift_template_rpcs.test.sql`): each RPC writes
  the right rows; a bad row rolls back the batch; a duplicate slot rolls back
  the batch; a changed `updated_at` gives `STALE_PREVIEW`; a new pending claim
  gives `STALE_PREVIEW`; a user without `edit:scheduling` gets `42501`; a
  template of another restaurant gives `P0002`; hard delete sets
  `shifts.shift_template_id` to NULL and deletes the claims.
- E2E: justified exception. The change adds no page, route, or dialog. The
  seam is MCP to `ai-execute-tool` to SQL. The pgTAP tests cover the SQL with
  real RLS, and the unit tests cover the dispatcher wiring.

## Decided trade-offs

- **No hour cascade in `update_shift_template`.** A batch cascade must merge
  with `update_shift_template_with_cascade`, its drift buckets, and its undo
  batch. That is a large second write path. The preview names the linked
  shifts that keep their hours. A later change can add it.
- **`mode` is required on delete.** A default of `delete` destroys claims. A
  default of `hide` surprises a user who said "delete".
- **Token is not signed.** See "Preview token".
