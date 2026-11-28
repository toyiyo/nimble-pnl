# MCP shift template tools: plan

Design: `docs/superpowers/specs/2026-11-28-mcp-shift-template-tools-design.md`
Branch: `claude/brave-cannon-ofnnes`

Do the tasks in order. Each task is RED (failing test), GREEN, REFACTOR, COMMIT.
Stage explicit paths only.

## Task 1: SQL RPCs (pgTAP first)

1. Write `supabase/tests/mcp_shift_template_rpcs.test.sql`. Cover: create of
   2 rows; a bad row rolls back the batch; a duplicate slot rolls back the
   batch; update with a correct fingerprint; update with an old `updated_at`
   gives `PT409`; delete with a new pending claim gives `PT409`; hide keeps
   linked shifts; hard delete sets `shifts.shift_template_id` to NULL and
   deletes claims; no `edit:scheduling` gives `42501`; a template of another
   restaurant gives `P0002`; more than 50 rows gives `22023`.
2. Write `supabase/migrations/20261128120000_mcp_shift_template_rpcs.sql` with
   `mcp_create_shift_templates`, `mcp_update_shift_templates`,
   `mcp_delete_shift_templates`.
3. Run `npm run test:db`.

## Task 2: Field rules (pure)

1. Tests: name and position trim and length; area empty gives null; days
   from names and numbers, sort, dedupe, reject 7 and `"xyz"`; `HH:MM` parse;
   start equal to end rejected; overnight flag; break `>= 0`; staff `>= 1`;
   in-batch slot duplicates; max 50 rows.
2. Code: `normalizeTemplateInput()`, `mergeTemplatePatch()`, `slotKey()` in
   `supabase/functions/_shared/mcpShiftTemplateTools.ts`.

## Task 3: Preview token

1. Tests: canonical args hash ignores key order and the flag fields;
   encode/decode round trip; a bad token gives `PREVIEW_REQUIRED`; changed
   args give `PREVIEW_MISMATCH`; a token for another tool is rejected.
2. Code: `canonicalArgsHash()`, `encodePreviewToken()`, `decodePreviewToken()`.

## Task 4: Preview builders (pure)

1. Tests: create summary; update `before`/`after` diff; linked-shift samples
   in local time with `tz`; `hide` and `delete` impact text; staff change with
   open spots.
2. Code: `buildCreatePreview()`, `buildUpdatePreview()`, `buildDeletePreview()`.

## Task 5: Loaders, RPC calls, error map

1. Tests (mock client): capability denial before any read; list output with
   `tz`; confirm without `preview_token` gives `PREVIEW_REQUIRED`; SQLSTATE map
   (`PT409`, `23505`, `P0002`, `22023`, `42501`); confirm passes the
   fingerprint to the RPC.
2. Code: `runShiftTemplateTool(name, args, restaurantId, supabase, tz)`.

## Task 6: Register the tools

1. Tests: `getTools` has the 4 tools; `WRITE_TOOLS` and `WRITE_TOOL_NAMES`
   have the 3 write tools; `buildMcpTools` marks them destructive;
   `missingRequiredArgs` works for them; dispatcher source routes them.
2. Code: `supabase/functions/_shared/shiftTemplateToolDefs.ts`; edits in
   `tools-registry.ts`, `aiWriteTools.ts`, `ai-execute-tool/index.ts`.

## Task 7: Verify

Run `.claude/skills/run-tla/tlc.sh all`, `npm run test`, `npm run test:db`,
`npm run typecheck`, `npm run lint`, `npm run build`.
