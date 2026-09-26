# AI chat validation fixes: plan

Design: `docs/superpowers/specs/2026-09-26-ai-chat-validation-fixes-design.md`
(revision 2). STE-aligned. Each task is RED (failing test), GREEN, REFACTOR,
COMMIT. Server tasks (S) and client tasks (C) touch different files and can run
in parallel. Inside each track, run the tasks in order.

## Server track

### S1. D1: capability RPC without `.catch()`
- Files: `supabase/functions/_shared/tools-registry.ts`,
  `tests/unit/tools-registry.test.ts`, new
  `tests/unit/types/capabilityRpc.test.ts`.
- RED: change `mockSupabase` to a builder with `then()` only. Add cases:
  `error` field, rejected `then`, synchronous throw. Add the
  `@ts-expect-error` type test.
- GREEN: `PromiseLike` return type; `callCapabilityRpc` helper with one `try`
  around the call and the `await`.
- Check: `npm run test`, `npm run typecheck:types`.

### S2. D2-D6: pure formatters
- Files: new `supabase/functions/_shared/aiToolFormatters.ts`, new
  `tests/unit/aiToolFormatters.test.ts`, new
  `supabase/tests/ai_tool_projections.test.sql`.
- Exports: `POS_SALE_PREVIEW_COLUMNS`, `mapTopSoldItems`,
  `buildCashFlowSummary`, `computeCashCoverage`, `incomeStatementBasis`,
  `monthlyPnlBasis`.
- The projection test checks each column against `unified_sales.Row` in
  `src/integrations/supabase/types.ts`. The pgTAP file asserts `has_column`.

### S3. Wire the formatters into `ai-execute-tool`
- Files: `supabase/functions/ai-execute-tool/index.ts`, `tools-registry.ts`
  (descriptions for `get_financial_statement` and `generate_report`).
- Replace the inline code at `:3362`, `:3386`, `:1298-1307`, `:537-555`,
  `:2899`, `:2916`, `:2957-2961`. Add `basis` to the 2 P&L results.
- Test: source checks (style of `tests/unit/ai-restaurant-today-wiring.test.ts`):
  the file imports the formatters; no `inflows_7d`; no `, source'`.

### S4. D9: tool list follows the capability
- Files: `tools-registry.ts`, `supabase/functions/ai-chat-stream/index.ts`,
  `tests/unit/tools-registry.test.ts`, `tests/unit/ai-restaurant-today-wiring.test.ts`
  (or a new source-check file).
- `getTools(..., { hasSchedulingOrPayroll })`; the flag resolves in
  `Promise.all` with the timezone; the labor prompt block depends on the flag.

### S5. D10: required-argument check
- Files: `tools-registry.ts`, `ai-execute-tool/index.ts`,
  `tests/unit/tools-registry.test.ts`.
- `missingRequiredArgs`; HTTP 200 `INVALID_ARGUMENTS`; the check does
  not enforce `period` (every handler defaults it); "every dispatcher case
  has a registry entry" test.

## Client track

### C1. D7: turn loop in `useAiChat`
- Files: `src/hooks/useAiChat.tsx`, new `tests/unit/useAiChat.test.tsx`.
- Cases per the design (1 round, 2 rounds with history shape, cap, abort,
  no retry after a tool call, 500 on round 2, long turn, pass-through of
  `ok:false`).

### C2. D7b: saved history
- Files: `src/components/ai-chat/AiChatPanel.tsx`,
  `src/hooks/useAiChatMessages.ts`, tests.
- Remove duplicates by ID; mark loaded rows; send `created_at`; title rule.

### C3. D8: `ChatMessage`
- Files: `src/components/ChatMessage.tsx`, `AiChatPanel.tsx` (a11y roles),
  new `tests/unit/ChatMessage.test.tsx`.

### C4. E2E: `tests/e2e/ai-chat.spec.ts`
- Route mocks for both functions; 2-round answer; no "Processing..."; navigate
  button; reload keeps the answer.

## Docs

- `docs/AI_CHAT.md`: testing section (unit, live harness method, E2E).

## Verify

- `npm run typecheck`, `npm run typecheck:types`, `npm run lint`,
  `npm run test`, `npm run build`, the pgTAP chat files and the new
  projection file, `npx playwright test tests/e2e/ai-chat.spec.ts`.
- Re-run the scratch live harness: 225-call matrix, `{}` args per tool,
  write checks, chat stream with the mock model, browser.
