# AI chat validation fixes: design

Date: 2026-09-26. Branch: `claude/chatbot-feature-testing-bwissl`. STE-aligned.

## 1. Context

A live validation of the AI chat ran on local Supabase. It called all 26 tools
of `ai-execute-tool` as 9 roles (225 calls). It ran `ai-chat-stream` against a
mock OpenRouter server. It drove the chat panel in Chromium. The run found 10
defects. The user approved a fix for all 10. For defect 6 the user said: "don't
change what our UIs use; for the AI, call what our UI uses".

Unit tests (177), pgTAP (13 files), write paths, tenant isolation, pay
redaction, and model fallback passed. This design does not change them.

## 2. Defects and fixes

### D1 (critical): `.catch()` on a PostgREST builder

- Fact: `hasSchedulingOrPayrollCapability` calls `.catch(toResult)` on
  `supabase.rpc(...)` (`supabase/functions/_shared/tools-registry.ts:960`,
  `:966`). `hasPayRatesCapability` does the same (`:1008`).
- Fact: supabase-js `rpc()` returns a `PostgrestBuilder`. It has `then()` and no
  `catch()` (postgrest-js 2.117.1 `dist/index.mjs:391`).
- Fact: `CapabilityCheckClient.rpc` has the return type `Promise<...>`
  (`tools-registry.ts:930-935`). That type lets TypeScript accept `.catch()`.
- Fact: the unit tests mock `rpc` with `Promise.resolve(...)`
  (`tests/unit/tools-registry.test.ts:213-218`), so the tests cannot see the
  defect. Lesson 2026-07-29 in `memory/lessons.md` names this trap.
- Effect (live run): `TypeError: supabase.rpc(...).catch is not a function`.
  `get_kpis`, `get_labor_costs`, `get_schedule_overview` and `get_ai_insights`
  return HTTP 500 for every role. A denied role gets 500, not 403.
- Fix: change the return type to `PromiseLike<...>`. Replace each `.catch` with
  one helper, `callCapabilityRpc`, that uses `try { await } catch`. The helper
  keeps the fail-closed and log behavior (`tools-registry.ts:969-983`).
- Test: a mock builder that has `then()` only. Cases: grant, deny, `error`
  field, rejected `then`. The rejected case must deny and log.

### D2 (critical): `unified_sales.source` does not exist

- Fact: `executeBatchCategorizePosSales` selects
  `'id, item_name, total_price, sale_date, source'`
  (`supabase/functions/ai-execute-tool/index.ts:3362`) and reads `s.source`
  (`:3386`). The table has `pos_system`, not `source` (migration
  `20251022` family; live schema check on 2026-09-26).
- Effect: preview and confirm both fail with
  `column unified_sales.source does not exist`.
- Fix: move the projection to a constant `POS_SALE_PREVIEW_COLUMNS` in a new
  pure module `supabase/functions/_shared/aiToolFormatters.ts`. Select
  `pos_system`. Keep the output key `source` (value = `pos_system`), so the
  model contract does not change.
- Test: unit test pins the column list against the `unified_sales` columns in
  the migrations (lesson 2026-05-26). The live harness confirms it.

### D3 (major): `quantity_sold` counts rows, not units

- Fact: `executeGetSalesSummary` maps `quantity_sold: sale_count` and
  `avg_price: revenue / sale_count` (`ai-execute-tool/index.ts:1299-1307`).
  `get_top_sold_items` also returns `quantity`
  (`supabase/migrations/20260814142000_get_top_sold_items.sql:4,10`).
- Effect: seeded 80 units at $12 show as `quantity_sold: 8`, `avg_price: 120`.
- Fix: pure function `mapTopSoldItems(rows)` in `aiToolFormatters.ts`.
  `quantity_sold` = `quantity`; `avg_price` = `revenue / quantity`;
  new field `line_count` = `sale_count`.
- Test: unit test with the seeded shape.

### D4 (major): `_7d` fields hold full-period totals

- Fact: `calculateCashFlowMetrics` sums every day of the requested period into
  `inflows_7d`, `outflows_7d`, `net_cash_flow_7d`
  (`ai-execute-tool/index.ts:537-555`).
- Effect: the model reports a 30-day total as "last 7 days".
- Fix: rename to `inflows`, `outflows`, `net_cash_flow`; add `period_days`.
  No UI reads these keys (grep of `src/` on 2026-09-26: 0 hits).
- Test: pure function `buildCashFlowSummary(days, start, end)` in
  `aiToolFormatters.ts`, with a unit test.

### D5 (major): cash coverage is 0 when labor cost is 0

- Fact: `cashCoverageBeforePayroll = laborCost > 0 ? balance / laborCost : 0`
  (`ai-execute-tool/index.ts:2897`). Status is `critical` below 1.5
  (`:2960`). The alert fires below 1.5 (`:2916`).
- Effect: $25,000 cash and no payroll outflow give "critical" and a false alert.
- Fix: pure function `computeCashCoverage(balance, laborCost)` returns
  `{ multiplier: null, status: 'not_applicable' }` when labor cost is 0. The
  alert fires only when `multiplier !== null && multiplier < 1.5`.
- Test: unit test for 0, low, and high coverage.

### D6 (major): two P&L tools disagree

See section 3.

### D7 (major): the chat drops a second round of tool calls

- Fact: the first stream handles `tool_call` events
  (`src/hooks/useAiChat.tsx:406-440`) and then calls `streamFollowUp`
  (`:497`). `streamFollowUp` handles only `message_start`, `message_delta`,
  `message_end` and `error` (`:167-228`).
- Fact: `ai-chat-stream` emits `tool_call` events on every request
  (`supabase/functions/ai-chat-stream/index.ts:393-418`).
- Effect (browser): the user sees "Processing..." and no answer.
- Fix: `streamFollowUp` handles `tool_call` the same way as the first stream.
  After the stream, if it ran tools, it calls itself with the new history.
  A cap `MAX_TOOL_ROUNDS = 4` stops a loop. At the cap, the hook sets the error
  "The assistant needed too many steps. Ask a more specific question."
  The tool-call handler becomes one shared function, so the two paths cannot
  drift again.
- Test: `tests/unit/useAiChat.test.tsx` with `renderHook`, a mocked `fetch`
  that returns SSE bodies, and a mocked `supabase.auth.getSession`. Cases:
  1 round, 2 rounds, cap reached.
- E2E: `tests/e2e/ai-chat.spec.ts`. Playwright routes mock both functions
  (CI does not serve edge functions: `.github/workflows/unit-tests.yml` e2e
  job has no `functions serve`). The spec asserts the final answer of a
  2-round question.

### D8 (minor): stale "Processing..." bubble

- Fact: `ChatMessage` returns the "Processing..." card for any assistant
  message with empty content (`src/components/ChatMessage.tsx:111-125`). This
  check runs before the tool-call line (`:320`) and the navigate button
  (`:132`, `:310`).
- Effect: after the answer arrives, the tool-call message still shows
  "Processing...". A `navigate` call with no text never shows its button.
- Fix: show "Processing..." only when the message has no content and no
  `tool_calls`. A message with `tool_calls` and no text shows the
  "Using tools" line and the navigate button.
- Test: component test in `tests/unit/ChatMessage.test.tsx`.

### D9 (minor): the model gets tools that the gate denies

- Fact: `getTools` adds `get_labor_costs` and `get_schedule_overview` for all
  roles (`tools-registry.ts:238`, `:275`). The dispatcher denies them without
  `view:scheduling` or `view:payroll` (`ai-execute-tool/index.ts:3602-3623`).
- Fix: `getTools(restaurantId, role, options?)` takes
  `{ hasSchedulingOrPayroll?: boolean }`. When it is `false`, `getTools`
  omits the 2 tools. `ai-chat-stream` resolves the flag with
  `hasSchedulingOrPayrollCapability` before it builds the tool list
  (`ai-chat-stream/index.ts:528`). When the flag is `undefined`, the list does
  not change (other callers are tests only).
- Test: unit tests for `true`, `false`, `undefined`.

### D10 (minor): missing required arguments give HTTP 500

- Fact: the dispatcher sends `args` to the handler with no check
  (`ai-execute-tool/index.ts:3654`). `get_bank_transactions` with no dates
  returns 500 and `invalid input syntax for type timestamp with time zone`.
- Fix: pure function `missingRequiredArgs(toolName, args)` in
  `tools-registry.ts` reads `parameters.required` from the registry. The
  dispatcher returns HTTP 400 `INVALID_ARGUMENTS` with the missing names, after
  the permission check.
- Test: unit tests for a complete call, a missing field, and an unknown tool.

## 3. D6: P&L expense source (decision: labels only)

- Fact: `get_financial_statement` (income statement) takes expenses from the
  RPC `get_journal_expense_total` (`ai-execute-tool/index.ts:987`).
- Fact: `generate_report` `monthly_pnl` takes expenses from the
  `get_bank_transaction_summary` outflow (`ai-execute-tool/index.ts:1719-1725`)
  and computes `revenue - cogs - expenses` (`:1733`). COGS is inventory usage
  (`:1709-1715`), so a food purchase can count twice.
- Fact: no UI view uses either source as-is. The Income Statement reads journal
  lines directly and adds uncategorized bank outflows and a payroll fallback
  (`src/components/financial-statements/IncomeStatement.tsx:197-221`, `:420`,
  `:286-379`). The dashboard Monthly Breakdown table uses bank expenses through
  `fetchExpenseData` (`src/lib/expenseDataFetcher.ts:97-147`) and computes
  `netRevenue - totalExpenses`
  (`supabase/functions/_shared/monthlyPerformance.ts:162`).
- User decision (2026-09-26): labels only. Do not change either calculation.
- Fix: each result gets a `basis` object built by a pure function in
  `aiToolFormatters.ts`:
  - `get_financial_statement` income statement: `revenue`, `cogs`, `expenses`
    source strings; `closest_ui_view: 'Income Statement'`; a note that the UI
    also adds uncategorized bank outflows and payroll without journal entries.
  - `generate_report` `monthly_pnl`: source strings;
    `closest_ui_view: 'Dashboard monthly breakdown'`; a note that bank outflows
    can include inventory purchases that COGS also counts, and that transfers
    are not excluded.
- The `get_financial_statement` and `generate_report` tool descriptions tell
  the model to read `basis` before it compares the two tools.
- Test: unit test pins the `basis` text keys for both tools.
- Follow-up (not in this PR): move the UI monthly pipeline to `_shared/` and
  make the AI call it.

## 4. Test strategy

- Unit (Vitest): every fix above has a test in `tests/unit/`. The new pure
  module `aiToolFormatters.ts` has no Deno imports (lesson 2026-05-07).
- Live check: re-run the scratch harness (225 calls, writes, chat stream,
  browser) after the fixes. The harness is not committed.
- E2E: `tests/e2e/ai-chat.spec.ts` for D7 and D8.
- No SQL change, so no new pgTAP test.

## 5. Out of scope

- The UTC labor window (`supabase/functions/_shared/restaurantDate.ts:82-104`)
  is a documented trade-off.
- `collaborator_accountant` access to `get_payroll_summary` is a product
  question. It is not in the approved list.
