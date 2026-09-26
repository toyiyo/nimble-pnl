# AI chat validation fixes: plan

Design: `docs/superpowers/specs/2026-09-26-ai-chat-validation-fixes-design.md`.
STE-aligned. Do the tasks in order. Each task is RED (failing test), GREEN,
REFACTOR, COMMIT.

## T1. D1: capability RPC without `.catch()`

- Files: `supabase/functions/_shared/tools-registry.ts`,
  `tests/unit/tools-registry.test.ts`.
- RED: add a `thenableRpc` mock that has `then()` only. Test
  `hasSchedulingOrPayrollCapability` and `hasPayRatesCapability` for grant,
  deny, `error` field, and a rejected `then`. The current code throws
  `TypeError`.
- GREEN: change `CapabilityCheckClient.rpc` to return `PromiseLike<...>`.
  Add `callCapabilityRpc(supabase, restaurantId, capability)` with
  `try { return await ... } catch (err) { return { data: null, error: err } }`.
  Use it at the 3 call sites.
- Check: `npm run typecheck` passes; the type now rejects `.catch()`.

## T2. Pure formatters (D2, D3, D4, D5, D6)

- Files: new `supabase/functions/_shared/aiToolFormatters.ts`, new
  `tests/unit/aiToolFormatters.test.ts`.
- Exports: `POS_SALE_PREVIEW_COLUMNS`, `mapTopSoldItems`,
  `buildCashFlowSummary`, `computeCashCoverage`, `incomeStatementBasis`,
  `monthlyPnlBasis`.
- RED/GREEN per export. The projection test reads the `unified_sales` columns
  from the migrations and checks each selected column exists.

## T3. Wire the formatters into `ai-execute-tool`

- File: `supabase/functions/ai-execute-tool/index.ts`,
  `supabase/functions/_shared/tools-registry.ts` (descriptions for
  `get_financial_statement` and `generate_report`).
- Replace the inline code at `:3362`, `:3386`, `:1299-1307`, `:553-555`,
  `:2897`, `:2916`, `:2957-2961`. Add `basis` to the 2 P&L results.
- Test: extend `tests/unit/ai-restaurant-today-wiring.test.ts` style source
  checks: the file imports the formatters and has no `inflows_7d`, no
  `, source'`, no inline coverage ternary.

## T4. D9: omit capability-gated tools for roles without the capability

- Files: `tools-registry.ts`, `supabase/functions/ai-chat-stream/index.ts`,
  `tests/unit/tools-registry.test.ts`.
- RED: `getTools('r', 'staff', { hasSchedulingOrPayroll: false })` must not
  list the 2 tools; `true` and `undefined` list them.
- GREEN: add the option. In `ai-chat-stream`, resolve the flag with
  `hasSchedulingOrPayrollCapability` before `getTools`.

## T5. D10: required-argument check

- Files: `tools-registry.ts`, `ai-execute-tool/index.ts`,
  `tests/unit/tools-registry.test.ts`.
- RED: `missingRequiredArgs('get_bank_transactions', {})` returns
  `['start_date', 'end_date']`; a complete call returns `[]`; an unknown tool
  returns `[]`.
- GREEN: add the function. The dispatcher returns HTTP 400
  `INVALID_ARGUMENTS` after the permission check.

## T6. D7: multi-round tool calls in `useAiChat`

- Files: `src/hooks/useAiChat.tsx`, new `tests/unit/useAiChat.test.tsx`.
- RED: mock `fetch` with SSE bodies. A 2-round turn ends with the final text.
  The current hook ends with no answer.
- GREEN: one shared tool-call handler for both streams. `streamFollowUp`
  handles `tool_call` and recurses up to `MAX_TOOL_ROUNDS = 4`. At the cap,
  set an error.
- Also test: 1 round; cap reached; tool error goes back to the model.

## T7. D8: no stale "Processing..." for tool-call messages

- Files: `src/components/ChatMessage.tsx`, new
  `tests/unit/ChatMessage.test.tsx`.
- RED: an assistant message with empty content and a `navigate` tool call
  shows the "Go to" button and no "Processing...".
- GREEN: change the empty-content branch.

## T8. E2E: `tests/e2e/ai-chat.spec.ts`

- Playwright routes mock `ai-chat-stream` (SSE) and `ai-execute-tool` (JSON).
- Sign up a user with `signUpAndCreateRestaurant` from
  `tests/helpers/e2e-supabase.ts`. Give the restaurant the `pro` tier.
- Assert: a 1-round answer; a 2-round answer; no "Processing..." left.

## T9. Docs

- `docs/AI_CHAT.md`: update the testing section (unit, live harness method,
  E2E spec).

## Verify

- `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build`,
  pgTAP chat files, `npx playwright test tests/e2e/ai-chat.spec.ts`.
- Re-run the scratch live harness: 225-call matrix, write checks, chat
  stream, browser.
