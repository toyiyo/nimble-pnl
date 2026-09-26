# AI chat validation fixes: design

Date: 2026-09-26. Branch: `claude/chatbot-feature-testing-bwissl`. STE-aligned.
Revision 2: folds in the Phase 2.5 Supabase and frontend design reviews.

## 1. Context

A live validation of the AI chat ran on local Supabase. It called all 26 tools
of `ai-execute-tool` as 9 roles (225 calls). It ran `ai-chat-stream` against a
mock OpenRouter server. It drove the chat panel in Chromium. The run found 10
defects. The user approved a fix for all 10. For defect 6 the user chose
"labels only".

Unit tests (177), pgTAP (13 files), write paths, tenant isolation, pay
redaction, and model fallback passed. This design does not change them.

## 2. Server defects

### D1 (critical): `.catch()` on a PostgREST builder

- Fact: `hasSchedulingOrPayrollCapability` calls `.catch(toResult)` on
  `supabase.rpc(...)` (`supabase/functions/_shared/tools-registry.ts:960`,
  `:966`). `hasPayRatesCapability` does the same (`:1008`).
- Fact: the builder implements `PromiseLike` and defines `then` only
  (`node_modules/@supabase/postgrest-js/dist/cjs/PostgrestBuilder.d.ts:3`,
  `PostgrestBuilder.js:49`). The edge runtime resolves
  `https://esm.sh/@supabase/supabase-js@2`; in the live run that was
  postgrest-js 2.117.1, which also has `then` only (`dist/index.mjs:391` in
  the Deno npm cache).
- Fact: `CapabilityCheckClient.rpc` returns `Promise<...>`
  (`tools-registry.ts:930-935`). That type lets TypeScript accept `.catch()`.
- Fact: the unit tests mock `rpc` with `Promise.resolve(...)`
  (`tests/unit/tools-registry.test.ts:213-218`). Lesson 2026-07-29
  (`memory/lessons.md:1855`) names this trap.
- Fact: `npm run typecheck` compiles only `src` (`tsconfig.app.json`), so a type
  in `supabase/` has no CI gate. `tsconfig.typetest.json` gates
  `tests/unit/types/**/*.test.ts` (`package.json:16`).
- Effect (live run): `TypeError: supabase.rpc(...).catch is not a function`.
  `get_kpis`, `get_labor_costs`, `get_schedule_overview` and `get_ai_insights`
  return HTTP 500 for every role. A denied role gets 500, not 403.
- Fix: return type `PromiseLike<...>`. One helper `callCapabilityRpc` wraps the
  call and the `await` in one `try`, so a synchronous throw also becomes
  `{ data: null, error }`. The fail-closed deny and the log stay
  (`tools-registry.ts:969-989`).
- Tests: change `mockSupabase` to a builder with `then()` only. Add cases for
  an `error` field, a rejected `then`, and a synchronous throw. Add
  `tests/unit/types/capabilityRpc.test.ts` with `@ts-expect-error` on `.catch`
  of `ReturnType<CapabilityCheckClient['rpc']>`.

### D2 (critical): `unified_sales.source` does not exist

- Fact: `executeBatchCategorizePosSales` selects
  `'id, item_name, total_price, sale_date, source'`
  (`supabase/functions/ai-execute-tool/index.ts:3362`) and reads `s.source`
  (`:3386`).
- Fact: the table has `pos_system` and no `source`
  (`supabase/migrations/20250925125415_2d2eb8de-f634-4fac-b444-1683592a7b2a.sql:11-14`;
  `src/integrations/supabase/types.ts`, `unified_sales.Row`).
- Effect: preview and confirm both fail with
  `column unified_sales.source does not exist`.
- Fix: constant `POS_SALE_PREVIEW_COLUMNS` in a new pure module
  `supabase/functions/_shared/aiToolFormatters.ts`. Select `pos_system`. Keep
  the output key `source` (value = `pos_system`), so the model contract does
  not change.
- Tests: a unit test checks each column against the keys of
  `unified_sales.Row` in `src/integrations/supabase/types.ts`. A pgTAP file
  `supabase/tests/ai_tool_projections.sql` asserts `has_column` for each
  selected column.

### D3 (major): `quantity_sold` counts rows, not units

- Fact: `executeGetSalesSummary` maps `quantity_sold: sale_count` and
  `avg_price: revenue / sale_count` (`ai-execute-tool/index.ts:1298-1307`).
  `get_top_sold_items` also returns `quantity`
  (`supabase/migrations/20260814142000_get_top_sold_items.sql:4,10`).
- Fix: `mapTopSoldItems(rows)` in `aiToolFormatters.ts`. `quantity_sold` =
  `quantity`; `avg_price` = `revenue / quantity`; new `line_count` =
  `sale_count`.

### D4 (major): `_7d` fields hold full-period totals

- Fact: the cash-flow block sums every day of the period into `inflows_7d`,
  `outflows_7d`, `net_cash_flow_7d` (`ai-execute-tool/index.ts:537-555`).
  `periodDays` (`:543`) does not count the end day.
- Fact: no `src/` file reads these keys (grep on 2026-09-26: 0 hits).
- Fix: `buildCashFlowSummary(days, start, end)` returns `inflows`, `outflows`,
  `net_cash_flow`, `period_days` (end day included), and
  `avg_daily_cash_flow` over `period_days`.

### D5 (major): cash coverage is 0 when labor cost is 0

- Fact: `laborCost > 0 ? balance / laborCost : 0`
  (`ai-execute-tool/index.ts:2899`). Status is `critical` below 1.5 (`:2960`).
  The alert fires below 1.5 (`:2916`).
- Fix: `computeCashCoverage(balance, laborCost)` returns
  `{ multiplier: null, status: 'not_applicable' }` when labor cost is 0. The
  alert fires only when `multiplier !== null && multiplier < 1.5`.

### D6 (major): two P&L tools disagree (decision: labels only)

- Fact: `get_financial_statement` takes expenses from
  `get_journal_expense_total` (`ai-execute-tool/index.ts:987`).
- Fact: `generate_report` `monthly_pnl` takes expenses from the
  `get_bank_transaction_summary` outflow (`:1719-1725`) and computes
  `revenue - cogs - expenses` (`:1734`). COGS is inventory usage
  (`:1709-1715`), so a food purchase can count twice. The RPC does not exclude
  transfers (`supabase/migrations/20260814146000_get_bank_aggregates.sql:17,25-29`).
- Fact: no UI view uses either source as-is. The Income Statement reads journal
  lines directly and adds uncategorized bank outflows and a payroll fallback
  (`src/components/financial-statements/IncomeStatement.tsx:197-221`, `:420`,
  `:286-379`). The dashboard Monthly Breakdown uses `fetchExpenseData`
  (`src/lib/expenseDataFetcher.ts:97-147`) and `netRevenue - totalExpenses`
  (`supabase/functions/_shared/monthlyPerformance.ts:162`).
- User decision (2026-09-26): labels only. No calculation changes.
- Fix: `incomeStatementBasis()` and `monthlyPnlBasis()` in
  `aiToolFormatters.ts` return a `basis` object: source of revenue, COGS and
  expenses, `closest_ui_view`, and a `differences` note. The descriptions of
  `get_financial_statement` and `generate_report`
  (`tools-registry.ts:636-637`, `:661-662`) tell the model to read `basis`
  before it compares figures.
- Follow-up (not in this PR): move the UI monthly pipeline to `_shared/` and
  make the AI call it.

### D9 (minor): the model gets tools that the gate denies

- Fact: `getTools` adds `get_labor_costs` and `get_schedule_overview` for all
  roles (`tools-registry.ts:238`, `:275`). The dispatcher denies them without
  `view:scheduling` or `view:payroll` (`ai-execute-tool/index.ts:3602-3623`).
- Fact: the only production caller of `getTools` is
  `supabase/functions/ai-chat-stream/index.ts:528`. The others are
  `tests/unit/tools-registry.test.ts` and
  `tests/unit/weekly-brief-ai-tools-retired.test.ts:33`.
- Fact: the system prompt names `get_labor_costs` as "REQUIRED for labor cost
  questions" (`ai-chat-stream/index.ts:657`).
- Fix: `getTools(restaurantId, role, options?)` with
  `{ hasSchedulingOrPayroll?: boolean }`. `false` omits the 2 tools;
  `undefined` keeps today's list. `ai-chat-stream` resolves the flag with
  `hasSchedulingOrPayrollCapability` inside `Promise.all` with
  `resolveRestaurantTimeZone` (`:521`). When the flag is `false`, the prompt
  drops the `get_labor_costs` lines and says that labor data needs
  `view:scheduling` or `view:payroll`.
- Failure path: an RPC error gives `false` (fail closed, logged). The tool list
  is not a security boundary; the dispatcher still gates.

### D10 (minor): missing required arguments give HTTP 500

- Fact: the dispatcher sends `args` to the handler with no check
  (`ai-execute-tool/index.ts:3654`). `get_bank_transactions` with no dates
  returns 500 and `invalid input syntax for type timestamp with time zone`.
- Fact: `ai-chat-stream` forwards a raw string when `JSON.parse` fails
  (`:399-406`).
- Fact: the in-band error convention is HTTP 200 with `ok:false`
  (`ai-execute-tool/index.ts:3244`, `:3342`, `:3424`).
- Fact: `get_kpis` and `get_sales_summary` default `period`
  (`:109`, `:1206`) but mark it `required` (registry).
- Fix: `missingRequiredArgs(toolName, args)` in `tools-registry.ts` reads a
  module-level map of all tools. A non-object `args` reports every required
  name. `null`, `undefined` and `''` count as missing. The dispatcher runs it
  after the permission check and before `resolveRestaurantTimeZone`. It returns
  HTTP 200 `{ ok:false, error:{ code:'INVALID_ARGUMENTS', missing, message } }`.
  The check does not enforce `period`: every handler with a period has a
  default window (`supabase/functions/_shared/restaurantDate.ts:203-205`: last
  7 days; `get_kpis` and `get_sales_summary`: month). The registry still lists
  `period` as required, so the model sends it.
- Build finding (2026-09-26): a live `{}` call per tool on the old and new code
  showed that 10 period tools answered `ok` before. The first version of this
  fix rejected them. The `period` exemption keeps them working. Only
  `navigate` and `get_financial_intelligence` change from `ok` to
  `INVALID_ARGUMENTS`; their old answers were garbage ("I can take you to
  undefined"; no date range).
- Tests: complete call, missing field, string/`null`/`undefined` args, unknown
  tool, and "every dispatcher case has a registry entry".

## 3. Client defects

### D7 (major): the chat drops a second round of tool calls

- Fact: the first stream handles `tool_call` (`src/hooks/useAiChat.tsx:406-440`),
  attaches `tool_calls` at `message_end` (`:440-451`), then calls
  `streamFollowUp` (`:480`). `streamFollowUp` handles only `message_start`,
  `message_delta`, `message_end` and `error` (`:167-228`).
- Fact: `ai-chat-stream` emits `tool_call` events on every request
  (`supabase/functions/ai-chat-stream/index.ts:393-418`).
- Fact: related hook defects that a multi-round turn makes worse:
  - A 30 s timer covers the whole turn (`useAiChat.tsx:296-300`). It sets
    `isStreaming=false` and does not abort.
  - `abortStream` (`:502-508`) aborts, and the `AbortError` path retries with a
    new controller (`:81`, `:256-263`). A retry after tools ran calls them
    again, which can repeat a confirmed write.
  - History comes from a `setMessages` updater (`:472-477`) and a stale
    `messages` closure (`:321`).
  - Several exits of `streamFollowUp` return with no error (`:76-78`, `:127`,
    `:131-134`).
  - IDs use `Date.now()` (`:409`, `:423`) and can collide.
  - A non-2xx tool response becomes `TOOL_ERROR` (`:50-53`), so the model never
    sees `TOOL_PERMISSION_DENIED` or `INVALID_ARGUMENTS`.
  - The SSE parser keeps a last line with no newline in `buffer` (`:357`) and
    never flushes it.
  - `tool_calls: []` is sent when it is empty (`:106`, `:326`).
- Fix: rewrite the turn as one loop.
  - `runRound(history, signal)` handles `message_start`, `message_delta`,
    `tool_call` and `message_end`, runs the tools, and returns
    `{ assistant, toolMessages }`. The assistant message carries its
    `tool_calls`.
  - `sendMessage` keeps a local `turnHistory`, seeded from a `messagesRef`.
    It calls `runRound` in `for (round = 1; round <= MAX_TOOL_ROUNDS; round++)`.
    `MAX_TOOL_ROUNDS = 4` counts every request, the first one included. If
    round 4 still asks for tools, the hook sets the error "The assistant needed
    too many steps. Ask a more specific question."
  - One `AbortController` per turn. Each round has an idle timeout of 30 s
    with no event; it aborts with a `TimeoutError` reason. The whole-turn timer
    is deleted. `isStreaming` stays true until the loop exits.
  - Retry (max 2, backoff) only on HTTP >= 500 or a network error before the
    first event of a round. No retry after a `tool_call` or `message_delta`,
    and no retry on a user abort.
  - Every failure exit sets an error. A failed round deletes its empty
    assistant row.
  - Client IDs use `crypto.randomUUID()`. `created_at` values increase
    strictly within a turn.
  - `executeTool` returns the JSON body when it has `ok:false`, for any status.
  - The parser flushes `buffer` at `done`. `tool_calls` is sent only when
    its length is more than 0.
  - An `isStreamingRef` blocks a second submit during a turn.
- Tests: `tests/unit/useAiChat.test.tsx` with `renderHook`, fake timers, a
  mocked `fetch` (SSE bodies), and a mocked `supabase.auth.getSession`.
  Cases: 1 round; 2 rounds (assert the history in each request has
  `assistant{tool_calls}` before the matching `tool{tool_call_id}`); cap
  reached (exact fetch count and error text); abort in round 2 (no more
  fetch calls); error after a `tool_call` (tool runs once); 500 on every try
  of round 2 (error set); a 2-round turn longer than 30 s in total
  (`isStreaming` stays true, no error); `TOOL_PERMISSION_DENIED` passes
  through.

### D7b: saved history loses rows (found by the frontend review)

- Fact: the save effect treats a message as saved when a DB row has the same
  `content` and `role` (`src/components/ai-chat/AiChatPanel.tsx:124-134`).
  Every tool-call assistant message has `content: ''`, so only the first one
  is saved. A reloaded session then has `tool` rows with no parent
  `tool_calls`, which providers reject.
- Fact: `saveMessagesBatch` sends no `created_at`
  (`src/hooks/useAiChatMessages.ts:84-93`). The default is `now()`
  (`supabase/migrations/20260128000000_ai_chat_persistence.sql:28`), so all
  rows of one batch share a timestamp. The load orders by `created_at`
  (`useAiChatMessages.ts:30`).
- Fact: the loaded DB rows are set into the hook at
  `AiChatPanel.tsx:92-95`. The saved-ID set is seeded only when the session ID
  changes (`:108-116`), often before the rows arrive.
- Fact: the title rule `messages.length <= 3` (`:150`) fails for a first turn
  that uses tools.
- Fix: dedupe by message ID only. Add the loaded DB IDs to the saved set at
  the load point (`:92-95`). Send `created_at` from the client. Set the title
  when the session has exactly one user message.
- Tests: extend the hook tests for `saveMessagesBatch` (sends `created_at`);
  a panel-level unit test for the dedupe rule (two `''` assistant rows are
  both saved; loaded rows are not saved again).

### D8 (minor): stale "Processing..." bubble

- Fact: `ChatMessage` returns a "Processing..." card for any assistant message
  with empty content (`src/components/ChatMessage.tsx:111-125`). This runs
  before the navigate logic (`:132`, button at `:311`) and the tool line
  (`:320`).
- Fact: the panel already shows "Cooking up a response..." while
  `isStreaming` is true (`AiChatPanel.tsx:302-316`).
- Fact: loaded rows always have `tool_calls: []`
  (`src/hooks/useAiChatMessages.ts:41`).
- Fix: `ChatMessage` renders nothing for an empty assistant message with
  `tool_calls?.length` 0. With tool calls and no text, it shows the tool line
  and the navigate button, with no empty markdown block or divider. The tool
  line shows `tc.function.name` (delete the dead `JSON.parse`). The navigate
  button shows a label ("POS Sales"), not the slug. Icons get
  `aria-hidden="true"`. The panel indicator gets `role="status"` and
  `aria-live="polite"`; the error block gets `role="alert"`.
- Tests: `tests/unit/ChatMessage.test.tsx` with `vi.mock('mermaid')` and a
  `MemoryRouter`. Cases: empty + `tool_calls: []` renders nothing; empty +
  `navigate` shows "Go to POS Sales" and no "Processing..."; text renders.

### E2E

- `tests/e2e/ai-chat.spec.ts`. CI serves no edge functions
  (`.github/workflows/unit-tests.yml` e2e job), so Playwright routes mock
  `**/functions/v1/ai-chat-stream` and `**/functions/v1/ai-execute-tool`.
  The stream mock picks its answer by call count and asserts
  `request.postDataJSON().messages` history shape. Every SSE body ends with
  `\n\n`.
- The user comes from `signUpAndCreateRestaurant`, which sets the `pro` tier
  (`tests/helpers/e2e-supabase.ts:1231`); the role is owner.
- Assert: a 2-round answer; no "Processing..."; the "Go to" button for a
  `navigate` call; the conversation reloads with its answer.

## 4. Test strategy

- Unit (Vitest) for every fix; type test for D1; pgTAP `has_column` for D2.
- The pure module `aiToolFormatters.ts` has no Deno imports (lesson
  2026-05-07).
- Live check after the fixes: re-run the scratch harness (225-call matrix,
  write checks, `{}` args for every tool before and after, chat stream with
  the mock model, browser). The harness is not committed.

## 5. Out of scope and follow-ups

- The UTC labor window (`supabase/functions/_shared/restaurantDate.ts:82-104`)
  is a documented trade-off.
- `collaborator_accountant` access to `get_payroll_summary` is a product
  question.
- Follow-ups: D6 full parity; a lint rule against `.catch` on `.rpc()`/`.from()`
  chains; `PromiseLike` in the other structural client types
  (`_shared/financialAggregates.ts:26` and others); pin the esm.sh
  supabase-js version.
