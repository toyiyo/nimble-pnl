---
description: Pull recent PostHog feedback/errors/rageclicks, enrich with Supabase+Grafana, dedupe, and produce anonymized GitHub issue bodies (PII stays in ~/.nimble-pnl/feedback-log.jsonl)
---

# Triage Feedback

Turn recent PostHog signals into ready-to-file GitHub issue bodies. Reporter PII never reaches the issue body — it is recorded in a local JSONL audit log at `~/.nimble-pnl/feedback-log.jsonl`.

## Arguments

Parse `$ARGUMENTS` for these flags (all optional):

- `--window <Nd | Nh>` — time window (default: `7d`)
- `--include <list>` — comma-separated subset of: `surveys`, `errors`, `rageclicks` (default: all three)
- `--file` — after preview, run `gh issue create` for each new issue (default: print only)

## Required MCPs

Before doing anything, verify these MCPs are connected by attempting a discovery call:

- `mcp__claude_ai_PostHog__exec` (PostHog hosted MCP)
- `mcp__supabase-prod__execute_sql` (Supabase prod MCP)
- `mcp__grafana__list_datasources` or similar (Grafana MCP)

If any are missing, print:

```
⚠ <name> MCP not connected. Connect it before re-running.
```

and stop.

## Flow

### 1. PULL signals

For PostHog, follow the schema-first protocol:

```text
posthog:exec search <regex>   → posthog:exec info <tool>
                              → posthog:exec call <tool> {...}
```

**Surveys** (`survey sent` events in window):

```sql
SELECT timestamp, distinct_id, person_id,
       properties.`$survey_id` AS survey_id,
       properties.`$current_url` AS url,
       properties.`$survey_completed` AS completed,
       toJSONString(properties) AS raw_props
FROM events
WHERE event = 'survey sent'
  AND timestamp >= now() - INTERVAL <WINDOW>
ORDER BY timestamp DESC
LIMIT 100
```

Extract the survey response from `raw_props` by looking for any property key matching `$survey_response_<uuid>`.

**Error tracking issues**: Use the `query-error-tracking-issues-list` PostHog tool, filtered to the window. Prioritize issues whose `first_seen` is in window OR whose event count is rising.

**Rageclicks** (`$rageclick` events with ≥3 distinct users on same url+selector):

```sql
SELECT properties.`$current_url` AS url,
       properties.`$el_text` AS selector,
       count() AS hits,
       uniqExact(distinct_id) AS distinct_users
FROM events
WHERE event = '$rageclick'
  AND timestamp >= now() - INTERVAL <WINDOW>
GROUP BY url, selector
HAVING distinct_users >= 3
ORDER BY hits DESC
LIMIT 50
```

### 2. ENRICH each signal

For each signal with a `distinct_id`, look up the reporter in Supabase prod:

```sql
SELECT id, email, raw_user_meta_data->>'full_name' AS full_name
FROM auth.users WHERE id = '<distinct_id>'
```

If found, also fetch their restaurant association:

```sql
SELECT ur.role, r.id AS restaurant_id, r.name AS restaurant_name
FROM user_restaurants ur
JOIN restaurants r ON r.id = ur.restaurant_id
WHERE ur.user_id = '<distinct_id>'
LIMIT 1
```

Fall back to `null` on unresolvable distinct_ids — signal still gets processed.

Pull contextual logs ±10 min around the signal timestamp via `mcp__supabase-prod__get_logs` (try `postgres`, `edge-function`, `pg_net` services).

For Grafana correlation at the signal timestamp:

- `mcp__grafana__query_loki_logs` filtered by the affected service in a 10-min window
- `mcp__grafana__list_alert_groups` to check for firing alerts at that time

### 3. DEDUPE

For each candidate signal:

1. Compute `signature` = first 12 chars of `sha256(<route> + ':' + <normalized_keyword>)`. Generate via:

   ```bash
   node -e "console.log(require('crypto').createHash('sha256').update('<route>:<keyword>').digest('hex').slice(0,12))"
   ```

2. Check the local log:

   ```bash
   node dev-tools/feedback-log.js query --signature <sig>
   ```

   If any row has a non-null `gh_issue_number` AND the GitHub issue is still open, **skip**.

3. Search GitHub:

   ```bash
   gh issue list --search "<sig>" --state all --limit 20 --json number,state,title
   ```

   Skip if a matching **open** issue exists. Note matching **closed** issues in the run summary.

### 4. SYNTHESIZE the issue body

For each surviving candidate:

**a. Sanitize every piece of free-text** before composing the body:

```bash
printf '%s' "<text>" | node dev-tools/feedback-log.js sanitize
```

The sanitizer strips emails, UUIDs, JWTs, Bearer tokens, and `restaurant_id=` query params. Apply it to: feedback text, log excerpts, page titles, any URL beyond the route, error messages.

**b. Compose this exact body**, using sanitized inputs:

```markdown
## Summary
<one-line sanitized summary>

## Signal
- **Source:** <survey | error_tracking | rageclick>
- **Route:** <route>
- **Window:** <ISO start> → <ISO end>
- **Affected users:** <count>

## Reproduction
<derived steps, sanitized>

## Logs (sanitized excerpt)
<details><summary>Backend logs ±10min</summary>

```
<up to 20 lines, sanitized>
```

</details>

## Suspected files
<output of `grep -r "<keyword>" src/ supabase/ --include="*.ts" --include="*.tsx" -l | head -10`, prefixed with signature for findability>

## Acceptance criteria
- [ ] Issue reproduces on <route> with <input>
- [ ] Fix verified locally + in staging
- [ ] Regression test added

## Test plan
- Unit: <relevant unit tests>
- E2E: <playwright path if UI bug>

---
sig:<signature>
```

The trailing `sig:<signature>` line is what `gh issue list --search` matches on for future dedup.

**c. Generate a stable id for the row:**

```bash
node -e "console.log(crypto.randomUUID())"
```

### 5. PREVIEW or FILE

Print the title + body for each candidate. Then:

- **Default (no `--file`):** Print a `gh issue create` command per candidate with `--title` and `--body` quoted, for the user to copy and run.
- **`--file`:** Confirm the count with the user. On confirmation, run `gh issue create --title "..." --body "..."` per candidate and capture the issue number from the URL it returns.

### 6. LOG

For every candidate (filed OR skipped due to dedup), append a row:

```bash
node dev-tools/feedback-log.js append "$(cat <<EOF
{
  "id": "<uuid>",
  "signature": "<sig>",
  "gh_issue_number": <number or null>,
  "signal_type": "survey|error|rageclick",
  "signal_timestamp": "<ISO>",
  "reporter_email": "<email or null>",
  "reporter_name": "<name or null>",
  "feedback_text": "<raw, NOT sanitized — local only>",
  "restaurant_id": "<uuid or null>",
  "route": "<route>",
  "filed_at": "<ISO now>"
}
EOF
)"
```

The helper is idempotent on `id` — safe to re-run.

### 7. SUMMARIZE

End with a short tally:

```
Triage-feedback complete.
  Signals scanned:        <N>
  Skipped (dedup open):   <N>
  Notable closed matches: <N>
  Filed:                  <N>
  Reviewed, not filed:    <N>

Local log: ~/.nimble-pnl/feedback-log.jsonl
```

## Guarantees

- Reporter `email`, `full_name`, raw feedback text, and restaurant context never appear in the GitHub issue body.
- Helper output goes only to local JSONL; stdout in this command never echoes raw PII to the user.
- Default mode prints — never files — issues. `--file` is opt-in.
