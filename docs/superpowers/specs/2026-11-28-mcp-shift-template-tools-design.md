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
| An unknown tool name throws `Unknown tool`. | `supabase/functions/ai-execute-tool/index.ts:3965` |
| `update_shift_template_with_cascade` has no preview fingerprint check. | `supabase/migrations/20260805160000_template_cascade_undo_restores_template.sql:49-143` |
| The cascade moves only shifts that match the OLD template hours. | `supabase/migrations/20260805160000_template_cascade_undo_restores_template.sql:191-194` |
| The dialog offers the cascade only when the typed hours differ from the saved hours. | `src/hooks/useTemplateHoursLedger.ts:115-118` |
| The AI scheduler reads only active templates. | `supabase/functions/generate-schedule/index.ts:158-161` |
| `get_open_shifts` counts open spots only for active templates. | `supabase/migrations/20260721140000_open_shift_claim_authz_guard.sql:134` |
| `approve_open_shift_claim` refuses a claim on a hidden template. | `supabase/migrations/20260721140000_open_shift_claim_authz_guard.sql:429-431` |
| A claim has status `pending_approval`, `approved`, `rejected` or `cancelled`. The FK cascade deletes all of them. | `supabase/migrations/20260412145842_open_shift_claims.sql:9,12-13` |
| `schedule_change_logs.cascade_batch_id` has no FK. | `supabase/migrations/20260804130000_template_hours_cascade.sql:28` |
| Without a batch header row, undo uses its legacy path and still reverts the shifts. | `supabase/migrations/20260805160000_template_cascade_undo_restores_template.sql:455-456,498-512` |
| `log_shift_changes` writes a `schedule_change_logs` row for each change to a published shift. | `supabase/migrations/20251123000000_schedule_publishing.sql:117-146,166-169` |
| The TS zone fallback is `America/Chicago`. | `supabase/functions/_shared/timezone.ts:15` |
| The MCP catalog is the union of `getTools('', role)` for the user's roles. | `supabase/functions/_shared/mcpHandler.ts:190-193` |
| SQL functions in this area use `SET search_path = public, pg_temp`. | `supabase/migrations/20260805160000_template_cascade_undo_restores_template.sql:66` |

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
| `supabase/migrations/20261128120000_mcp_shift_template_rpcs.sql` | New. 3 write RPCs, 1 read RPC (`mcp_shift_template_impact`), 2 indexes. |
| `supabase/tests/mcp_shift_template_rpcs.test.sql` | New pgTAP. |
| `tests/unit/mcpShiftTemplateTools.test.ts` | New Vitest. |
| `specs/tla/shift-template-crud/*` | New TLA+ spec and 5 configs. |

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
- `getTools` gives the 4 tools to every role except `staff` and `kiosk`. Those
  roles never hold `edit:scheduling`, so the tools only add noise for them.
  The capability check is the real gate.
- Every query filters on `restaurant_id`. Each `template_id` must belong to
  `restaurant_id`, else the row error is `NOT_FOUND`.

### Fields and time zone

Input and output use the same names:

| Tool field | Column | Rule (same as the dialog) |
|---|---|---|
| `name` | `name` | Trim. Not empty. Max 100 characters. |
| `position` | `position` | Trim. Not empty. Max 100 characters. |
| `area` | `area` | Optional. Trim. Empty gives `null`. |
| `days` | `days` | Not empty. Each value is `"sun"`..`"sat"` (any case) or 0-6. The tool sorts and deduplicates. The slot check compares the sorted array exactly, as the index does. Overlapping day sets do not conflict. |
| `start_time`, `end_time` | `start_time`, `end_time` | `"HH:MM"`, 24 h, local restaurant time. Start is not equal to end. End before start is an overnight slot. |
| `break_minutes` | `break_duration` | Integer, `>= 0`. Default 0. |
| `staff_needed` | `capacity` | Integer, `>= 1`. Default 1. |

The dialog clamps a bad break or capacity value. The tool rejects it with a row
error. A silent clamp from a model call is a wrong value that nobody sees.

The max length rule is new. The column has no limit. The rule stops a model
from writing a very long text.

Template times are wall-clock `TIME` values in the restaurant zone. The tool
returns them as `"HH:MM"`, with `overnight: true|false` and a `tz` field
(the IANA name from `resolveRestaurantTimeZone`, fallback `America/Chicago`).
Linked shift times in the preview are `timestamptz`. The tool converts them to
local date and time in `tz`. The 28-day open-spot window starts at today in
`tz`.

### `list_shift_templates`

Arguments: `restaurant_id`, optional `status` (`active` default, `inactive`,
`all`), optional `area`, optional `position`.

Returns `{ tz, templates: [...] }`. Each template has `template_id`, the fields
above, `days` as names (`["Mon","Tue"]`), `is_active`, `updated_at`, and
`linked_future_shifts` (count, from one grouped query, not one query per
template). Sort: area, start time, position. Cap: 500 rows,
with `truncated: true` if more exist.

### `create_shift_template`

Arguments: `restaurant_id`, `templates` (array, 1-50 rows), `preview`,
`confirmed`, `preview_token`.

Preview:
- Validate each row. Check each row against the active slots in the
  restaurant and against the earlier rows in the batch.
- If any row has an error, return `ok: false`, `INVALID_ARGUMENTS`, and
  a per-row error list. No token.
- Else return the normalized rows, `tz`, a summary ("20 slots, 140 staff spots
  per week"), and `preview_token`.

Confirm: check the token (see below), then call `mcp_create_shift_templates`.
The RPC validates every row again. It checks the slot of each row in order
before its INSERT, so an error names the row index. All rows are in one
transaction. Any error rolls back every row.

### `update_shift_template`

Arguments: `restaurant_id`, `updates` (array, 1-50 rows). Each row has
`template_id` and the fields to change. A row can also set `is_active: true` to
restore a hidden template.

Preview:
- Read the current rows. Merge each patch into its row. Validate the result
  with the same rules.
- Check the slots in batch order, the same order as the SQL UPDATE. The
  unique index is partial, so Postgres cannot defer it and checks each row.
  A swap of 2 slots in one batch fails. The preview rejects it with a row error
  that says to use a temporary time or 2 calls.
- For each row, show `before` and `after` for each changed field.
- If the hours or days change, list the linked future shifts: count, and up to
  10 samples with local date, time, employee name, and published state. Tell
  the user these facts:
  - The shifts keep their current hours.
  - The planner shows them as drifted from the template.
  - No one-step way exists to move them after this change. The planner
    cascade moves only shifts that match the old hours, and it shows only when
    the typed hours differ from the saved hours.
  - To move them with the template, use the planner edit dialog instead of
    this tool.
- If `staff_needed` changes, show the current upcoming open spots (28 days)
  and the change per slot day.
- Return `preview_token`.

Confirm: call `mcp_update_shift_templates` with the full merged rows and the
fingerprints.

### `delete_shift_template`

Arguments: `restaurant_id`, `template_ids` (1-50), `mode` (`hide` or
`delete`, required).

Preview for each template:
- `hide`:
  - The template leaves the planner grid, the open spots, and the AI
    scheduler.
  - Linked shifts stay and keep their link.
  - Pending claims stay, but no manager can approve them while the template
    is hidden.
  - The user can restore the template with `update_shift_template` and
    `is_active: true`.
- `delete`:
  - All claims on the template are deleted, in every status. The preview shows
    the count per status and the names on the pending claims. This cannot be
    undone.
  - Linked shifts stay, and their link is cleared. The preview shows the count,
    the future count, and the published count. Each published shift gets one
    change-log row.
  - Upcoming open spots (28 days) go away.
  - An earlier hour cascade can still be undone for its shifts. The undo
    cannot restore the template.
- Return `preview_token`.

Confirm: call `mcp_delete_shift_templates`.

### Impact reads

`mcp_shift_template_impact(p_restaurant_id uuid, p_template_ids uuid[])` is a
`STABLE`, `SECURITY INVOKER` read RPC. It returns one row per template:

- `updated_at_text` (the exact `updated_at::text`, microseconds kept),
- `shifts_hash` (md5 of the sorted ids of all linked shifts),
- `claims_hash` (md5 of the sorted `id:status` of all claims),
- counts: linked shifts, future linked shifts, published linked shifts, claims
  per status.

The preview calls it once for the whole batch. The write RPCs call the same
SQL inside the transaction. So the preview and the confirm use one formula,
and the TS code never parses a timestamp.

### Preview token and the stale check

The token is base64url JSON:

```json
{ "v": 1, "tool": "delete_shift_template", "user_id": "…", "exp": 1764340000,
  "args_sha256": "…",
  "rows": [{ "id": "…", "updated_at": "…", "shifts_hash": "…", "claims_hash": "…" }] }
```

- `args_sha256` is the SHA-256 of the normalized rows (after trim, day parse,
  and merge), not of the raw arguments. `["mon"]` and `[1]` give the same hash.
  The confirm computes it again. A different value gives `PREVIEW_MISMATCH`.
- `exp` is 15 minutes after the preview. `user_id` must match the caller. A
  failure gives `PREVIEW_EXPIRED`.
- `rows` is the fingerprint. The RPC compares it under a row lock.
- Update and hide compare only `updated_at`. They do not change shifts or
  claims, so a new linked shift must not make them stale.
- Hard delete compares `updated_at`, `shifts_hash`, and `claims_hash`. Ids,
  not counts: one unlink plus one new link keeps the count the same (A-B-A).
  The `CountOnly` TLA+ config shows this bug.
- `shifts_hash` covers all linked shifts, not only future ones. A shift that
  starts between the preview and the confirm must not make the preview stale.
- The token is not signed. See "Decided trade-offs".

Each update or delete RPC does these steps in one transaction:

1. Check `edit:scheduling`. Raise `42501` if not.
2. `SET LOCAL lock_timeout = '5s'`.
3. `PERFORM 1 FROM shift_templates WHERE restaurant_id = $1 AND id = ANY($2) ORDER BY id FOR UPDATE`.
4. If a row is missing, raise `P0002` (`NOT_FOUND`).
5. In a separate plpgsql statement, read the fingerprint. Under READ COMMITTED,
   each statement takes a new snapshot. So this read sees every row that
   committed while step 3 waited. A CTE with the lock would use the old
   snapshot.
6. On any difference, raise the custom SQLSTATE `PT409` with the message
   `STALE_PREVIEW`.
7. Write the rows in batch order. Return the rows and the counts.

Why the fingerprint cannot change after step 5:
- An INSERT or UPDATE that sets a FK to the template takes `FOR KEY SHARE` on
  the template row. `FOR UPDATE` conflicts with `FOR KEY SHARE`. So no new
  claim or linked shift can appear until the RPC commits.
- A shift unlink or delete, and a claim status change, take no lock on the
  template. They can commit after step 5. For update and hide, these rows are
  not in the fingerprint. For hard delete, the FK action locks each shift and
  claim row and acts on its latest version. The result is still correct: every
  remaining reference is cleared or deleted. The preview can then overstate a
  count by the rows that left after step 5. It never understates one.

Lock order and deadlock:
- `ORDER BY id` gives one lock order between 2 MCP batches.
- A planner write can still deadlock with an MCP batch. Example:
  `approve_open_shift_claim` locks a claim, then its shift INSERT waits on the
  template. The MCP delete holds the template, then its cascade waits on that
  claim.
- Postgres stops one of the 2 transactions with `40P01`. A wait longer than
  5 s gives `55P03`. The tool maps both to `CONFLICT_RETRY`, and the whole
  batch rolls back. The model runs the preview again.

### SQL RPCs

```sql
mcp_shift_template_impact(p_restaurant_id uuid, p_template_ids uuid[]) RETURNS TABLE (...)
mcp_create_shift_templates(p_restaurant_id uuid, p_rows jsonb) RETURNS jsonb
mcp_update_shift_templates(p_restaurant_id uuid, p_rows jsonb) RETURNS jsonb
mcp_delete_shift_templates(p_restaurant_id uuid, p_mode text, p_rows jsonb) RETURNS jsonb
```

- `SECURITY INVOKER`, `SET search_path = public, pg_temp`.
- `REVOKE ALL ... FROM PUBLIC, anon`; `GRANT EXECUTE ... TO authenticated`.
- Max 50 rows. Each RPC validates the same rules as the TS module. SQL is the
  authority.
- Error codes: `22023` (invalid row, message names the row index and field),
  `P0002` (not found), `PT409` (stale), `23505` (slot taken), `42501`
  (no capability), `40P01` and `55P03` (lock conflict).
- New indexes: `template_hours_cascade_batches (shift_template_id)` and
  `open_shift_claims (shift_template_id)`. Without them, a delete of 50
  templates scans both tables for the FK action. A migration runs in a
  transaction, so the indexes are plain `CREATE INDEX IF NOT EXISTS`. Both
  tables are small.

### Error codes returned to the model

`INVALID_ARGUMENTS`, `TOOL_PERMISSION_DENIED`, `PREVIEW_REQUIRED`,
`PREVIEW_MISMATCH`, `PREVIEW_EXPIRED`, `STALE_PREVIEW`, `SLOT_TAKEN`,
`NOT_FOUND`, `CONFLICT_RETRY`.

The TS module maps errors by `error.code` (the SQLSTATE), never by HTTP
status. PostgREST sends HTTP 409 for both `23505` and `PT409`.

## TLA+ check

Spec: `specs/tla/shift-template-crud/ShiftTemplateCrud.tla`.

Actors:
- One MCP agent. It runs a batch create, an update of `t1`, or a hard delete
  of `t1`. Each tool is a preview, then a confirm.
- The planner UI. It edits `t1`, deletes `t1`, links and unlinks shifts on
  `t1`, adds and approves claims on `t1`, and takes the slot of a batch row.

Invariants:
- `NoStaleCommit`: a confirm never writes when the state that it acts on
  changed after the preview.
- `BatchAllOrNothing`: when the tool call ends, the batch rows exist all or
  none.
- `NoDanglingRef`: no shift and no coverage claim points to a missing template.

Configs:

| Config | Guard off | EXPECT |
|---|---|---|
| `ShiftTemplateCrud.cfg` | none (planned design) | pass |
| `ShiftTemplateCrud_NoStaleCheck.cfg` | fingerprint compare | violation of `NoStaleCommit` |
| `ShiftTemplateCrud_CountOnly.cfg` | ids in the fingerprint (counts only) | violation of `NoStaleCommit` |
| `ShiftTemplateCrud_RowByRow.cfg` | one transaction per batch | violation of `BatchAllOrNothing` |
| `ShiftTemplateCrud_NoFk.cfg` | FK check in the same statement | violation of `NoDanglingRef` |

TLC output for this spec:

```text
OK    ShiftTemplateCrud: pass (expected pass; 70236 distinct states found)
OK    ShiftTemplateCrud_CountOnly: violation (expected violation; 1631 distinct states found)
OK    ShiftTemplateCrud_NoFk: violation (expected violation; 542 distinct states found)
OK    ShiftTemplateCrud_NoStaleCheck: violation (expected violation; 131 distinct states found)
OK    ShiftTemplateCrud_RowByRow: violation (expected violation; 690 distinct states found)
```

The model makes `UiLinkShift` one atomic step. The approve path is 2 steps in
real code. See "Decided trade-offs".

## Tests

- Vitest (`tests/unit/mcpShiftTemplateTools.test.ts`): field rules, day parse,
  time parse, overnight flag, in-batch slot check in order (swap rejected),
  merge of an update patch, token encode and decode, `PREVIEW_MISMATCH`,
  `PREVIEW_EXPIRED`, error map for each SQLSTATE, preview text for each
  delete mode, capability denial, and the registry entries.
- pgTAP (`supabase/tests/mcp_shift_template_rpcs.test.sql`):
  - Each RPC writes the right rows.
  - A bad row rolls back the batch. A duplicate slot rolls back the batch.
  - A swap of 2 slots in one update batch gives `23505`.
  - A changed `updated_at` gives `PT409` for update and for delete.
  - A new linked shift gives `PT409` for delete, and no error for hide.
  - An unlink plus a new link (same count) gives `PT409` for delete.
  - A claim status change gives `PT409` for delete.
  - A user without `edit:scheduling` gets `42501`.
  - A template of another restaurant gives `P0002`.
  - Hard delete sets `shifts.shift_template_id` to NULL and deletes the
    claims in every status.
  - `mcp_shift_template_impact` returns the same hashes before and after a
    no-op.
- E2E: justified exception. The change adds no page, route, or dialog. The
  seam is MCP to `ai-execute-tool` to SQL. The pgTAP tests cover the SQL with
  real RLS, and the unit tests cover the dispatcher wiring.

## Decided trade-offs

- **No hour cascade in `update_shift_template`.** A batch cascade must merge
  with `update_shift_template_with_cascade`, its drift buckets, and its undo
  batch. That is a large second write path. The preview tells the user that the
  linked shifts keep their hours, and that the planner dialog is the way to
  move them.
- **`mode` is required on delete.** A default of `delete` destroys claims. A
  default of `hide` surprises a user who said "delete".
- **The token is not signed.** A signature needs a new production secret. It
  also cannot prove that the user saw the preview: a model can preview and
  confirm without the user. The MCP `destructiveHint` and the server
  instructions make the client ask the user. The stale check runs in SQL, and
  a forged fingerprint can only make the RPC fail. The token has `exp` and
  `user_id`.
- **The approve race exists today and stays.** `approve_open_shift_claim` reads
  the template without a lock, then inserts a shift. If an MCP hide or hour
  change commits between those 2 steps, the new shift has the old hours or
  points to a hidden template. The planner UI has the same race today. The
  reference stays valid, so `NoDanglingRef` holds. A follow-up can make that
  read `FOR KEY SHARE`.
