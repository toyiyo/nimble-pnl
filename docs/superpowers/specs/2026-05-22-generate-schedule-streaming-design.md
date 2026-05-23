# generate-schedule: switch to streaming AI path — design

**Date:** 2026-05-22
**Branch:** `fix/generate-schedule-streaming`
**Severity:** P0 production-down. AI schedule generation returns 502 for at least one production restaurant.

## Symptom

Frontend shows: "Something Went Wrong / The AI schedule generation failed / Generation failed / Edge Function returned a non-2xx status code".

Edge function logs (production, Wetzel's Cold Stone Alamo Ranch, ID `7c0c76e3-e770-401b-a2a9-c1edd407efed`, prompt=20,089 chars):

```text
[generate-schedule] Trying model: Gemini 2.5 Flash
✅ Gemini 2.5 Flash succeeded
[generate-schedule] Model Gemini 2.5 Flash parse failed: Signal timed out.
[generate-schedule] Trying model: Gemini 2.5 Flash Lite
✅ Gemini 2.5 Flash Lite succeeded
[generate-schedule] Model Gemini 2.5 Flash Lite parse failed: Signal timed out.
[generate-schedule] Trying model: Llama 4 Maverick
✅ Llama 4 Maverick succeeded
[generate-schedule] Model Llama 4 Maverick parse failed: Signal timed out.
[generate-schedule] Model chain wall-clock budget exhausted (90010ms > 90000ms). Stopping early.
```

## Root cause

`supabase/functions/_shared/ai-caller.ts:77` attaches `signal: AbortSignal.timeout(30000)` to the OpenRouter fetch and **returns the `Response` object without consuming the body**. The 30s signal stays bound to the Response's body stream.

`supabase/functions/generate-schedule/index.ts:553` later calls `await response.json()`, which triggers a stream pull on that bound signal. If the body has not finished arriving within 30s of fetch initiation, the pull aborts with `DOMException("Signal timed out.", "TimeoutError")`. The catch block at line 569 logs it as "parse failed", which is misleading — the JSON parser never ran.

For this restaurant the response body genuinely takes >30s to ship because:

- `max_tokens: 16384` plus `response_format: { type: 'json_schema', strict: true }` forces per-token schema validation server-side, slowing emission.
- Recent prompt growth (PR #506 added 7-day per-employee availability + Rule 12 HARD-fill; PR #511 added per-template capacity + Rule 1 active-days) pushed average output length past the 30s body-download threshold.

Three consecutive 30s body-read aborts (~90s) exhaust the wall-clock budget at `index.ts:535` and the function returns synthetic 502.

The misleading `✅ X succeeded` log is real — fetch headers came back fast. Only the body read timed out.

## Why streaming fixes it

`supabase/functions/_shared/streaming.ts` already implements `callModelWithStreaming`:

- Uses `signal: AbortSignal.timeout(90000)` (90s, 3× the broken path).
- Adds `stream: true` to the request body so OpenRouter ships SSE chunks instead of buffering the full body.
- Consumes the SSE stream **inside the same function** via `processStreamedResponse`, then returns the accumulated content string. No bound signal can fire on a caller's `response.json()` because there is no `response.json()` — the helper returns a string, not a Response.
- Reader runs continuously across chunks, so an isolated slow chunk does not cause an abort as long as the whole stream completes within 90s.

## Fix

1. Extract the model-loop logic from `generate-schedule/index.ts` into a new pure helper `supabase/functions/_shared/schedule-ai-runner.ts` so it can be unit-tested from Vitest.
   - Signature: `runScheduleModelChain({ models, requestBody, callStreaming, now?, budgetMs? })` returns `{ data, model } | null`.
   - `callStreaming` is injected (real impl = `callModelWithStreaming`; tests supply a fake).
   - Loops models in order, calls `callStreaming`, strips markdown fences, `JSON.parse`, returns first success.
   - Continues to next model on null content, parse error, or invalid shape.
   - Respects `budgetMs` (wall-clock) using `now()` at loop start.
2. Wire `generate-schedule/index.ts` to use the helper with `callModelWithStreaming` as the real `callStreaming`. Remove the `callModel` import and the bespoke loop.
3. Recalibrate `MODEL_LOOP_BUDGET_MS`. Each streaming attempt can take up to 90s. Supabase edge functions hard-kill at ~150s. To allow at least one fallback attempt: budget = 130s (allows model 1 to fully consume 90s, then ~30-40s for model 2 to either succeed quickly or fail-fast on an explicit error). For most calls model 1 will succeed in 15-25s and the budget never matters.

## Out of scope

- Changing the prompt size or json_schema constraints. Those rules are intentional for correctness.
- Touching other edge functions that use `callModel`. This change is scoped to schedule generation only.
- Re-enabling Braintrust. Telemetry remains a no-op (`braintrust.ts:4` `initLogger = null`).

## Test plan

Vitest unit tests against `runScheduleModelChain`:

1. Returns parsed JSON + model name on first model success.
2. Falls back to next model when first returns `null` content.
3. Falls back to next model when first returns content that fails `JSON.parse`.
4. Strips markdown code fences (```json ... ```) before parsing.
5. Returns `null` when every model fails.
6. Stops iterating models once wall-clock budget is exhausted (uses injected `now`).
7. Calls `callStreaming` exactly once per model (no extra retries — the streaming primitive owns retries internally).

Manual verification post-deploy: trigger generation for the affected restaurant. Expect success in <30s with `streaming` markers in the log.

## Risk

- Low: the streaming primitive has been in `_shared/` since before this incident and is exercised by `callAIWithFallbackStreaming`. We are reusing it, not introducing it.
- Behavioral diff vs. non-streaming: OpenRouter does not include token usage in SSE streams. Logging will not capture exact token counts for these calls. Acceptable trade-off given Braintrust is disabled and prompt size is already logged at line 511.
