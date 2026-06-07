# Design: OCR Rules Review Integration

**Date:** 2026-06-07
**Branch:** ocr-rules-review
**Status:** Decided — implementing

---

## Goal

Wire `open-code-review` (OCR) as an independent, **$0**, subscription-based automated code reviewer into every `/dev` run (Phase 7a, non-skippable) and as a standalone `/our-code-review` command. OCR provides deterministic, rule-based selection and lint checks; a Claude subagent on the Max subscription provides the LLM reasoning — together replacing any metered pay-as-you-go API call.

---

## Journey: Why It Took Three Attempts

### Attempt 1 — OCR with a raw Anthropic API key (metered, 401)

`open-code-review` is a Node CLI that calls an LLM API directly. The first instinct was to give it the Anthropic key from Claude Code's own session. That key is an **OAuth bearer token** issued per session by the subscription — it authenticates the Claude Code agent, not a third-party tool. Sending it as `x-api-key` (the Anthropic Console header) produced a 401 immediately. Even forwarding it with the `anthropic-beta` header Claude Code uses internally did not help: the subscription endpoint only grants access to the authorized agent (Claude Code), not to arbitrary callers pretending to be it.

**Root cause:** Subscriptions (Claude Max, ChatGPT Plus) authenticate the *official agent*. Third-party CLIs that need an LLM API key require a separate, metered pay-as-you-go key — which we are trying to avoid.

### Attempt 2 — OCR with Codex / ChatGPT Plus (throttled, model rejected)

The next approach was to route OCR through the OpenAI endpoint using a ChatGPT Plus session, via `codex`. A first test run succeeded; subsequent runs returned `model not supported` for the default model (`gpt-5.3-codex`). The Plus tier throttles the Codex model aggressively and the model itself is gated to API-tier customers. Pinning a Plus-compatible model (e.g. `gpt-5.2-codex`) helped intermittently but the reliability was insufficient to make this a non-skippable workflow step.

**Root cause:** ChatGPT Plus Codex is throttled and its "API-only" default model is rejected on Plus. Treat codex as best-effort at most.

### Attempt 3 — The breakthrough: OCR's rules are separable from the LLM

`ocr review --preview` and `ocr rules check` run **entirely locally** — they select changed files, apply rule filters, and emit a structured diff — without calling any model. Cost: $0. This means the LLM is a free choice, completely decoupled from OCR's selection logic.

**Consequence:** Use a Claude subagent (Max subscription) as the LLM. Claude subagents are invoked by Claude Code and inherit the subscription — reliable, $0, no separate API key needed. OCR does the deterministic work; the subagent does the reasoning.

---

## Chosen Architecture

```
Changed files (git diff)
        |
        v
  ocr review --preview        ← deterministic rule-based selection ($0, local)
  ocr rules check             ← lint / rule validation ($0, local)
        |
        v
  Structured diff / findings
        |
        v
  Claude subagent (Max sub)   ← LLM reasoning, $0 via subscription
        |
        v
  Findings → /dev Phase 7a output + /our-code-review output
```

**Properties:**
- $0 marginal cost per review (no metered API calls)
- Deterministic rule enforcement every run (OCR layer)
- Reliable LLM reasoning (Claude Max subscription, same agent)
- Non-skippable: wired into Phase 7a of `/dev` before any PR is created

### Workflow Integration

**Phase 7a (non-skippable, inside `/dev`):**
1. `ocr review --preview` to get the structured rule output for the current diff
2. Pass the output to a Claude subagent with the project's `CLAUDE.md` rules context
3. Subagent emits findings (P1/P2/Minor), classified and actionable
4. Any P1 finding blocks PR creation until addressed

**`/our-code-review` command:**
- Runs the same pipeline on demand, outside of `/dev`
- Useful for in-progress branches or ad-hoc review before pushing

---

## Metered API Key Fallback (Reference Only — Not Used)

Documented here for completeness if subscription access is ever unavailable.

**Anthropic Console key:**
- Header: `x-api-key: sk-ant-...`
- Models: `claude-opus-4-8`, `claude-sonnet-4-6`, `claude-haiku-4-5`
- Billing: pay-as-you-go per token
- Why avoided: adds per-run cost; this project's goal is $0 overhead review

**OpenAI key:**
- Header: `Authorization: Bearer sk-...`
- Billing: pay-as-you-go per token
- Why avoided: same cost concern; Plus throttling makes it unreliable anyway

---

## Codex: Optional Best-Effort Bonus

Codex stays in the workflow as an **optional, best-effort cross-family bonus** reviewer only:
- It runs after the OCR + Claude subagent pass
- A `::skip::` marker is emitted and the workflow continues if codex is missing, broken, or returns `model not supported`
- Its output is never required to unblock a PR
- Install via `npm i -g @openai/codex` (NOT `brew install --cask codex` — the cask leaves a dangling symlink)
- Pin a Plus-compatible model (e.g. `gpt-5.2-codex`); the default `gpt-5.3-codex` is API-tier only
- Any `codex exec` call in a script must redirect `< /dev/null` to prevent it from hanging on stdin

---

## Files Involved

| File | Purpose |
|------|---------|
| `.claude/skills/development-workflow.md` | Phase 7a: OCR + subagent review step (non-skippable) |
| `.claude/skills/our-code-review.md` | `/our-code-review` command skill |
| `dev-tools/ocr-review.sh` | Shell runner: `ocr review --preview` → subagent invocation |
| `memory/lessons.md` | Lessons from the three-attempt journey (see 2026-06-07 entries) |
