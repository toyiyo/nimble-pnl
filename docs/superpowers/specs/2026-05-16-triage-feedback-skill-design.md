# Design: `/triage-feedback` skill

**Date:** 2026-05-16
**Status:** Approved
**Author:** Jose Delgado (with Claude Opus 4.7)

## Problem

User feedback arrives through PostHog surveys, error tracking, and rageclicks. Identifying signals, finding the affected user, correlating with backend logs, and filing a comprehensive bug report is slow and inconsistent. We want a single command that turns raw PostHog signals into anonymized GitHub issues ready for `/dev` to run against, while keeping reporter PII off GitHub (the repo may be public).

## Goals

- Single manually-invoked command that produces ready-to-file, anonymized GitHub issue bodies from recent PostHog signals.
- Enrich each signal with Supabase prod context (reporter identity stays local, logs flow into the issue sanitized) and Grafana correlation.
- Deduplicate against open GitHub issues and prior runs to avoid spam.
- Keep an auditable local log of `signal → issue → reporter` mappings outside the repo for manual follow-up.

## Non-goals

- Scheduled/cron execution (explicitly manual only).
- Auto-filing issues via `gh` without user review (default is print-for-review; `--file` flag opts into auto-create).
- Auto-sending thank-you emails (the in-app feedback widget already shows a thank-you on submit).
- Cross-machine shared store (single-user local file).

## Architecture

### Components

| Component | Path | Responsibility |
|-----------|------|----------------|
| Slash command | `.claude/commands/triage-feedback.md` | Orchestration — drives MCP/Bash calls, AI synthesis |
| Helper script | `dev-tools/feedback-log.js` | Deterministic JSONL read/write/query, PII sanitization |
| Unit tests | `tests/unit/feedback-log.test.ts` | Cover helper subcommands and sanitizer |
| Runtime store | `~/.nimble-pnl/feedback-log.jsonl` | Append-only audit log (gitignored — lives outside repo) |

### Invocation

```
/triage-feedback                    # default: last 7 days, signals from all sources, review mode
/triage-feedback --window 24h       # narrow window
/triage-feedback --include errors   # restrict signal sources (comma-separated)
/triage-feedback --file             # auto-create GH issues after sanity check
```

### Flow

```
1. PULL signals (PostHog MCP)
   - survey-sent events in window with $survey_response_*, distinct_id
   - Error tracking issues: first_seen in window OR rising volume
   - $rageclick events grouped by (URL, selector) with ≥3 distinct users

2. ENRICH each signal
   - Supabase prod (mcp__supabase-prod):
     - auth.users by distinct_id → email, full_name
     - user_restaurants → restaurant_id, role
     - get_logs (postgres/edge-fn/pg-net) ±10min around signal timestamp
   - Grafana (mcp__grafana):
     - query_loki_logs at timestamp for service-level errors
     - list_alert_groups for any firing alert touching the same component

3. DEDUPE
   - Compute signature: hash(route + normalized_keyword)
   - gh issue list --search "<signature substring>" --state all --limit 20
   - feedback-log.js query --signature <sig>
   - Skip if matching OPEN issue exists
   - Note (but do not skip) matching CLOSED issue

4. SYNTHESIZE per new signal
   - Anonymized GH issue body:
     - Title: "<short summary> (/<route>)"
     - Sections: Summary, Reproduction, Affected users (COUNT only), Logs excerpt (sanitized), Suspected files (grep result), Acceptance criteria, Test plan
   - Print body + suggested `gh issue create` command
   - If --file: run gh after user confirms count and previews bodies

5. LOG (append to ~/.nimble-pnl/feedback-log.jsonl)
   {
     "id": "<uuid>",
     "signature": "<sig>",
     "gh_issue_number": <int|null>,        // null until filed
     "signal_type": "survey|error|rageclick",
     "signal_timestamp": "ISO-8601",
     "reporter_email": "<email|null>",
     "reporter_name": "<name|null>",
     "feedback_text": "<raw text|null>",
     "restaurant_id": "<uuid|null>",
     "route": "/foo/bar",
     "filed_at": "ISO-8601"
   }
```

### PII boundary

| Lives in GitHub issue | Lives in local JSONL |
|----------------------|---------------------|
| Route, signal type, sanitized logs, count of affected users, suspected files, generic acceptance criteria | Email, full name, raw feedback text, restaurant_id, person UUID |

**Sanitizer rules** applied by `feedback-log.js sanitize` before any text reaches the GH issue body:

- Strip email addresses (`\S+@\S+\.\S+`)
- Strip UUIDs (`[0-9a-f]{8}-[0-9a-f]{4}-...`)
- Strip bearer tokens / JWTs (`Bearer \S+`, `eyJ[\w-]+\.[\w-]+\.[\w-]+`)
- Replace `restaurant_id=<uuid>` with `restaurant_id=<redacted>`
- Hard-cap sanitized output at 2000 chars (any longer text is suffixed with `… [truncated]`)

The 2000-char cap is a defense-in-depth ceiling on what the sanitizer will return; the slash command separately limits the `feedback_text` excerpt it embeds in the issue summary to a short one-liner derived from the first ~200 chars of the sanitized text. Raw feedback stays local.

The markdown command MUST pipe any user-supplied text through `sanitize` before composing the issue body. This is the single chokepoint — easier to audit than scattered regex.

### Helper script CLI

```
node dev-tools/feedback-log.js append <json>
  # appends one JSONL row, ensures ~/.nimble-pnl/ exists, idempotent on id

node dev-tools/feedback-log.js query --signature <sig> [--since <ISO>]
  # returns matching rows as JSON array (used by dedup step)

node dev-tools/feedback-log.js sanitize
  # reads stdin, writes sanitized text to stdout
```

Exit codes: 0 success, 1 error (any failure — invalid args, IO, parse). The helper is local-only and not scripted against by callers that need to distinguish error classes, so a single non-zero code keeps the implementation simple.

## Testing strategy

- **Unit (Vitest):** `tests/unit/feedback-log.test.ts`
  - `append` creates the dir if missing, writes JSONL, is idempotent on `id`
  - `query --signature` returns matches; respects `--since`
  - `sanitize` strips each PII class with property-based-ish coverage
  - Uses a tmpdir for the store via env override (`NIMBLE_PNL_FEEDBACK_LOG` or `--log-path`)
- **No tests for the markdown command itself** — it is a prompt/orchestration document; testing happens at the helper boundary and through manual invocation.

## Open questions resolved

| Question | Decision |
|----------|----------|
| Auto-file vs review | Default review-only; `--file` opts in after preview |
| Time window default | 7 days (catches missed signals on manual cadence) |
| Rageclick threshold | ≥3 distinct users on the same (url, selector) |
| Restaurant name in issue | Never — say "1 affected merchant" or "N affected merchants" |
| Logs in issue | Sanitized excerpt only, max 20 lines, surrounded by `<details>` |
| Thank-you flow | Out of scope — handled by in-app widget |

## Risks

- **PostHog person property gaps** — distinct_id may not be the same as Supabase auth user_id for anonymous sessions. Mitigation: skill falls back to `null` reporter on unresolvable distinct_ids; signal still gets filed.
- **Sanitizer false-negatives** — regex can miss novel PII patterns. Mitigation: review-by-default; user is the final gate before `gh issue create`.
- **MCP coverage** — Supabase prod and Grafana MCPs are local-only tools. The skill assumes the user runs it in a Claude Code session that has those MCPs connected. Skill prints a clear error if either is missing.
