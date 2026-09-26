# Design: category lookup for the AI tools and the Claude connector

Date: 2026-09-26
Status: approved (scope and access chosen by the user)

## Problem

A live Claude session could not categorize a bank deposit. The session
reported:

- No tool returns category IDs. There is no `list_categories`. The trial
  balance and the balance sheet return no account IDs.
- A preview with the account code `2600-1` returned
  `Invalid category_id: 2600-1`. Nothing was saved.

The three write tools accept only a `chart_of_accounts` UUID:

- `batch_categorize_transactions` looks up the category with
  `.eq('id', category_id)` (`supabase/functions/ai-execute-tool/index.ts:3233-3242`).
- `batch_categorize_pos_sales` does the same
  (`supabase/functions/ai-execute-tool/index.ts:3330-3339`).
- `create_categorization_rule` does the same
  (`supabase/functions/ai-execute-tool/index.ts:3419-3428`).
- Each tool describes the argument as "Chart of accounts category ID to
  assign" (`supabase/functions/_shared/tools-registry.ts:724`, `:753`, `:790`).

The trial balance selects `id` but drops it from each row
(`supabase/functions/ai-execute-tool/index.ts:1113-1135`).

So Claude cannot finish a categorization without a UUID from the app UI.

## Decision

The user chose both fixes, and the manager and owner gate.

### 1. New read tool `list_categories`

- Arguments: `search` (optional text, matches the account code or the
  account name, no case), `account_type` (optional:
  `asset | liability | equity | revenue | expense | cogs`, from
  `supabase/migrations/20251018224243_8835e4b7-f8a8-42bd-858e-d210c0c5e2ec.sql:6`),
  `include_inactive` (optional boolean, default false).
- Result: `categories[]` with `id`, `account_code`, `account_name`,
  `account_type`, `account_subtype`, `parent_account_id`, `is_active`,
  sorted by `account_code`, plus `count`.
- Access: manager and owner. Add it to `managerOwnerTools`
  (`supabase/functions/_shared/tools-registry.ts:898-917`) and to the
  manager/owner block of `getTools` (`supabase/functions/_shared/tools-registry.ts:341`).
- Query: one select on `chart_of_accounts` through the caller's JWT, so RLS
  applies. The select always has `.eq('restaurant_id', restaurantId)`: RLS
  alone returns the rows of every restaurant of the user. `account_type` and
  `is_active` are `.eq()` filters too. The `search` filter runs in a pure
  TypeScript function, not in a PostgREST `or()` string, so a comma or a
  parenthesis in `search` cannot change the query.
- Cap: the search runs on all rows that the select returns. Then the result
  keeps the first 500 and sets `truncated: true` when more rows matched.

### 2. The write tools accept an account code

- A new helper, `resolveCategoryRef`, in
  `supabase/functions/_shared/categoryLookup.ts`. The rules:
  - Trim the input. Do not change its case. Match with `.eq()`, because the
    unique key is case-sensitive.
  - A UUID-shaped input: look up `id` first. With no row, look up
    `account_code`, because `account_code` is free text
    (`supabase/migrations/20251018183326_5da7500b-3a17-4a58-af24-d2175258f871.sql:92`).
  - Other input: look up `account_code`.
  - Always filter on `restaurant_id`. Use `.maybeSingle()`.
  - No row: return "not found". A database error: throw it, so it does not
    show as "not found".
  - An inactive account: return an error that names it. Do not categorize to
    an inactive account.
- The code lookup is safe: `(restaurant_id, account_code)` is unique
  (`supabase/migrations/20251018183326_5da7500b-3a17-4a58-af24-d2175258f871.sql:104`,
  `supabase/migrations/20251021205038_e14802bd-3989-4537-a92c-ce799399b250.sql:4-5`).
- The three handlers call the helper in place of their own lookup. The
  preview already shows the category name and code
  (`supabase/functions/ai-execute-tool/index.ts:3277`), so the user sees the
  resolved account before a save.
- The error text changes to name both forms:
  `Unknown category "<ref>". Use a category id or an account code from list_categories.`
- The argument description changes to "Category id or account code from
  list_categories (for example 4000)."

### 3. Connector and prompt

- `list_categories` gets the title "List categories" in `MCP_TOOL_TITLES`
  (`supabase/functions/_shared/mcpHandler.ts:57-81`). It is not in
  `WRITE_TOOL_NAMES` (`supabase/functions/_shared/aiWriteTools.ts:9-13`), so
  the connector marks it `readOnlyHint: true`.
- The in-app prompt section "6. Data changes"
  (`supabase/functions/ai-chat-stream/index.ts:680-683`) gets one line: find
  the category with `list_categories` first.

## Decided trade-offs

- The in-app write guard compares the preview and the confirm arguments
  exactly (`src/hooks/useAiChat.tsx:225-289`). A preview with `2600-1` and a
  confirm with the UUID do not match, and the guard blocks the confirm. That
  fails safe: the model shows the preview again. No change here.
- `get_financial_statement` rows still have no `id`. `list_categories` gives
  the id, so this change does not widen the statement output.
- The 19 restaurants under one login is data, not code. It is out of scope.
- PostgREST `max-rows` can cut a select at 1000 rows with no error. A chart
  of accounts has far fewer rows, so the design accepts this limit.

## Tests

- Unit: `resolveCategoryRef` (UUID path, code path, trimmed code, case kept,
  UUID-shaped code falls back to the code, unknown ref, inactive account,
  database error passes through, `restaurant_id` in every query), the pure
  filter (search on code and name, no case, cap and `truncated`).
- Unit: `list_categories` in `getTools` for manager and owner only;
  `canUseTool` gate; MCP title and `readOnlyHint`; no model instructions in
  its descriptions (existing test in `tests/unit/mcpHandler.test.ts`).
- E2E: none. The change adds an edge-function tool with no UI. The AI chat
  E2E (`tests/e2e/ai-chat.spec.ts`) stubs the model, so it cannot drive a
  real tool choice.
