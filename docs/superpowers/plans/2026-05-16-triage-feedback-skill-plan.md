# Triage-Feedback Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a manually-invoked `/triage-feedback` slash command that turns recent PostHog signals (survey responses, error tracking, rageclicks) into anonymized GitHub issue bodies, while keeping reporter PII in a local JSONL audit log.

**Architecture:** A single Node helper (`dev-tools/feedback-log.js`) provides deterministic JSONL read/write/sanitization and is the only chokepoint for PII handling. A markdown slash command (`.claude/commands/triage-feedback.md`) orchestrates the PostHog / Supabase prod / Grafana MCP calls and `gh` queries around the helper. Helper is unit-tested with Vitest using a tmpdir log path; the command is a prompt and is not unit-tested.

**Tech Stack:** Node 20+ (CommonJS, matching existing `dev-tools/*.js`), Vitest, gh CLI, PostHog/Supabase/Grafana MCPs.

---

## File Structure

| Path | Status | Responsibility |
|------|--------|----------------|
| `dev-tools/feedback-log.js` | Create | Helper: append/query/sanitize, CLI + library exports |
| `tests/unit/feedbackLog.test.ts` | Create | Vitest unit tests for helper functions |
| `.claude/commands/triage-feedback.md` | Create | Slash-command orchestration prompt |
| `docs/superpowers/specs/2026-05-16-triage-feedback-skill-design.md` | Already exists | Approved design spec |

---

### Task 1: Helper module skeleton + sanitizer

**Files:**
- Create: `dev-tools/feedback-log.js`
- Test: `tests/unit/feedbackLog.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/feedbackLog.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
// CommonJS import — feedback-log.js is plain Node, no TS
import { sanitize } from '../../dev-tools/feedback-log.js';

describe('feedback-log: sanitize', () => {
  it('strips email addresses', () => {
    expect(sanitize('contact monica@rushbowls.com about this')).toBe(
      'contact <redacted-email> about this',
    );
  });

  it('strips UUIDs', () => {
    expect(sanitize('user 4bb07d19-bb65-4661-89c6-bb537b0fa1de failed')).toBe(
      'user <redacted-uuid> failed',
    );
  });

  it('strips bearer tokens and JWT-shaped strings', () => {
    expect(sanitize('Authorization: Bearer abc.def.ghi')).toContain('<redacted-token>');
    expect(sanitize('token eyJhbGciOi.eyJzdWIiOi.signaturepart')).toContain('<redacted-token>');
  });

  it('redacts restaurant_id query/url segments', () => {
    expect(sanitize('restaurant_id=ae87f51e-e2c0-44f4-b6bb-3953d5bbdbff')).toBe(
      'restaurant_id=<redacted>',
    );
  });

  it('truncates output longer than 2000 chars to 2000 + ellipsis marker', () => {
    const input = 'a'.repeat(5000);
    const out = sanitize(input);
    expect(out.length).toBeLessThanOrEqual(2000 + '… [truncated]'.length);
    expect(out.endsWith('… [truncated]')).toBe(true);
  });

  it('passes through clean text unchanged', () => {
    expect(sanitize('Scroll does not work on /pos-sales')).toBe(
      'Scroll does not work on /pos-sales',
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/unit/feedbackLog.test.ts`
Expected: FAIL — cannot find module `dev-tools/feedback-log.js`.

- [ ] **Step 3: Write the minimal implementation**

Create `dev-tools/feedback-log.js`:

```js
'use strict';

const EMAIL = /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const JWT = /\beyJ[\w-]+\.[\w-]+\.[\w-]+\b/g;
const BEARER = /Bearer\s+[A-Za-z0-9._\-+/=]+/g;
const RESTAURANT_ID_PARAM = /restaurant_id=([^&\s"']+)/gi;
const MAX_LEN = 2000;

function sanitize(text) {
  if (typeof text !== 'string') return '';
  let out = text;
  out = out.replace(RESTAURANT_ID_PARAM, 'restaurant_id=<redacted>');
  out = out.replace(JWT, '<redacted-token>');
  out = out.replace(BEARER, '<redacted-token>');
  out = out.replace(EMAIL, '<redacted-email>');
  out = out.replace(UUID, '<redacted-uuid>');
  if (out.length > MAX_LEN) out = out.slice(0, MAX_LEN) + '… [truncated]';
  return out;
}

module.exports = { sanitize };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- tests/unit/feedbackLog.test.ts`
Expected: PASS — all 6 sanitize tests green.

- [ ] **Step 5: Commit**

```bash
git add dev-tools/feedback-log.js tests/unit/feedbackLog.test.ts
git commit -m "feat(triage-feedback): add sanitizer for PII redaction

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 2: Append rows to JSONL log

**Files:**
- Modify: `dev-tools/feedback-log.js`
- Modify: `tests/unit/feedbackLog.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `tests/unit/feedbackLog.test.ts`:

```ts
import { appendRow, _resetLogPathForTests } from '../../dev-tools/feedback-log.js';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('feedback-log: appendRow', () => {
  let dir: string;
  let logPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'feedback-log-test-'));
    logPath = join(dir, 'feedback-log.jsonl');
    _resetLogPathForTests(logPath);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    _resetLogPathForTests(null);
  });

  it('creates parent directory if missing', () => {
    const nested = join(dir, 'a', 'b', 'log.jsonl');
    _resetLogPathForTests(nested);
    appendRow({ id: '1', signature: 'x', filed_at: '2026-05-16T00:00:00Z' });
    expect(existsSync(nested)).toBe(true);
  });

  it('appends a JSONL line per call', () => {
    appendRow({ id: '1', signature: 'a', filed_at: '2026-05-16T00:00:00Z' });
    appendRow({ id: '2', signature: 'b', filed_at: '2026-05-16T00:01:00Z' });
    const contents = readFileSync(logPath, 'utf8');
    const lines = contents.trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).id).toBe('1');
    expect(JSON.parse(lines[1]).id).toBe('2');
  });

  it('is idempotent on duplicate id (does not append again)', () => {
    appendRow({ id: '1', signature: 'a', filed_at: '2026-05-16T00:00:00Z' });
    appendRow({ id: '1', signature: 'a', filed_at: '2026-05-16T00:00:00Z' });
    const lines = readFileSync(logPath, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(1);
  });

  it('throws on missing id field', () => {
    expect(() => appendRow({ signature: 'a' } as any)).toThrow(/id/i);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npm run test -- tests/unit/feedbackLog.test.ts`
Expected: FAIL — `appendRow is not a function`.

- [ ] **Step 3: Extend the implementation**

Replace `dev-tools/feedback-log.js` with:

```js
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const EMAIL = /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const JWT = /\beyJ[\w-]+\.[\w-]+\.[\w-]+\b/g;
const BEARER = /Bearer\s+[A-Za-z0-9._\-+/=]+/g;
const RESTAURANT_ID_PARAM = /restaurant_id=([^&\s"']+)/gi;
const MAX_LEN = 2000;

function sanitize(text) {
  if (typeof text !== 'string') return '';
  let out = text;
  out = out.replace(RESTAURANT_ID_PARAM, 'restaurant_id=<redacted>');
  out = out.replace(JWT, '<redacted-token>');
  out = out.replace(BEARER, '<redacted-token>');
  out = out.replace(EMAIL, '<redacted-email>');
  out = out.replace(UUID, '<redacted-uuid>');
  if (out.length > MAX_LEN) out = out.slice(0, MAX_LEN) + '… [truncated]';
  return out;
}

let _testLogPath = null;

function _resetLogPathForTests(p) {
  _testLogPath = p;
}

function getLogPath() {
  if (_testLogPath) return _testLogPath;
  if (process.env.NIMBLE_PNL_FEEDBACK_LOG) return process.env.NIMBLE_PNL_FEEDBACK_LOG;
  return path.join(os.homedir(), '.nimble-pnl', 'feedback-log.jsonl');
}

function readAllRows() {
  const p = getLogPath();
  if (!fs.existsSync(p)) return [];
  const text = fs.readFileSync(p, 'utf8');
  return text
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
}

function appendRow(row) {
  if (!row || typeof row !== 'object') throw new Error('row must be an object');
  if (!row.id || typeof row.id !== 'string') throw new Error('row.id (string) is required');
  const p = getLogPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const existing = readAllRows();
  if (existing.some((r) => r.id === row.id)) return false;
  fs.appendFileSync(p, JSON.stringify(row) + '\n', 'utf8');
  return true;
}

module.exports = { sanitize, appendRow, _resetLogPathForTests };
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npm run test -- tests/unit/feedbackLog.test.ts`
Expected: PASS — sanitize (6) + appendRow (4) tests green.

- [ ] **Step 5: Commit**

```bash
git add dev-tools/feedback-log.js tests/unit/feedbackLog.test.ts
git commit -m "feat(triage-feedback): append rows to JSONL audit log

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 3: Query rows by signature

**Files:**
- Modify: `dev-tools/feedback-log.js`
- Modify: `tests/unit/feedbackLog.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `tests/unit/feedbackLog.test.ts`:

```ts
import { queryBySignature } from '../../dev-tools/feedback-log.js';

describe('feedback-log: queryBySignature', () => {
  let dir: string;
  let logPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'feedback-log-test-'));
    logPath = join(dir, 'log.jsonl');
    _resetLogPathForTests(logPath);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    _resetLogPathForTests(null);
  });

  it('returns empty array when log does not exist', () => {
    expect(queryBySignature('anything')).toEqual([]);
  });

  it('returns rows matching the signature', () => {
    appendRow({ id: '1', signature: 'pos-sales:scroll', filed_at: '2026-05-16T00:00:00Z' });
    appendRow({ id: '2', signature: 'pos-sales:scroll', filed_at: '2026-05-16T01:00:00Z' });
    appendRow({ id: '3', signature: 'dashboard:tz', filed_at: '2026-05-16T02:00:00Z' });
    const rows = queryBySignature('pos-sales:scroll');
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.id).sort()).toEqual(['1', '2']);
  });

  it('filters by since (ISO timestamp)', () => {
    appendRow({ id: '1', signature: 's', filed_at: '2026-05-01T00:00:00Z' });
    appendRow({ id: '2', signature: 's', filed_at: '2026-05-15T00:00:00Z' });
    const rows = queryBySignature('s', { since: '2026-05-10T00:00:00Z' });
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('2');
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npm run test -- tests/unit/feedbackLog.test.ts`
Expected: FAIL — `queryBySignature is not a function`.

- [ ] **Step 3: Add implementation**

Append to `dev-tools/feedback-log.js` (above `module.exports`):

```js
function queryBySignature(signature, opts = {}) {
  if (typeof signature !== 'string' || signature.length === 0) {
    throw new Error('signature (non-empty string) is required');
  }
  const since = opts.since ? Date.parse(opts.since) : null;
  return readAllRows().filter((row) => {
    if (row.signature !== signature) return false;
    if (since !== null) {
      const t = Date.parse(row.filed_at);
      if (Number.isNaN(t) || t < since) return false;
    }
    return true;
  });
}
```

And add `queryBySignature` to the `module.exports`:

```js
module.exports = { sanitize, appendRow, queryBySignature, _resetLogPathForTests };
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npm run test -- tests/unit/feedbackLog.test.ts`
Expected: PASS — all sanitize + appendRow + queryBySignature tests green.

- [ ] **Step 5: Commit**

```bash
git add dev-tools/feedback-log.js tests/unit/feedbackLog.test.ts
git commit -m "feat(triage-feedback): query rows by signature with optional since

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 4: CLI entry (append / query / sanitize subcommands)

**Files:**
- Modify: `dev-tools/feedback-log.js`
- Modify: `tests/unit/feedbackLog.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `tests/unit/feedbackLog.test.ts`:

```ts
import { runCli } from '../../dev-tools/feedback-log.js';

describe('feedback-log: CLI', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'feedback-log-cli-'));
    _resetLogPathForTests(join(dir, 'log.jsonl'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    _resetLogPathForTests(null);
  });

  it('append subcommand parses JSON arg and appends', async () => {
    const exit = await runCli(['append', JSON.stringify({
      id: 'cli-1', signature: 's', filed_at: '2026-05-16T00:00:00Z'
    })]);
    expect(exit).toBe(0);
    const rows = queryBySignature('s');
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('cli-1');
  });

  it('query subcommand prints matching rows as JSON array', async () => {
    appendRow({ id: 'q-1', signature: 'foo', filed_at: '2026-05-16T00:00:00Z' });
    const logs: string[] = [];
    const exit = await runCli(['query', '--signature', 'foo'], {
      stdout: (line: string) => logs.push(line),
    });
    expect(exit).toBe(0);
    const parsed = JSON.parse(logs.join(''));
    expect(parsed).toHaveLength(1);
    expect(parsed[0].id).toBe('q-1');
  });

  it('sanitize subcommand reads stdin and writes sanitized stdout', async () => {
    const out: string[] = [];
    const exit = await runCli(['sanitize'], {
      stdin: 'email is monica@example.com',
      stdout: (line: string) => out.push(line),
    });
    expect(exit).toBe(0);
    expect(out.join('')).toContain('<redacted-email>');
  });

  it('returns exit 1 on unknown subcommand', async () => {
    const exit = await runCli(['nope']);
    expect(exit).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npm run test -- tests/unit/feedbackLog.test.ts`
Expected: FAIL — `runCli is not a function`.

- [ ] **Step 3: Add CLI entry**

Append to `dev-tools/feedback-log.js` (above `module.exports`):

```js
async function runCli(argv, io = {}) {
  const stdout = io.stdout || ((s) => process.stdout.write(s));
  const stdin = io.stdin;
  const [sub, ...rest] = argv;

  try {
    if (sub === 'append') {
      const json = rest[0];
      if (!json) throw new Error('append requires a JSON arg');
      const row = JSON.parse(json);
      appendRow(row);
      return 0;
    }
    if (sub === 'query') {
      const sigIdx = rest.indexOf('--signature');
      if (sigIdx === -1 || !rest[sigIdx + 1]) throw new Error('query requires --signature <sig>');
      const sinceIdx = rest.indexOf('--since');
      const opts = {};
      if (sinceIdx !== -1) opts.since = rest[sinceIdx + 1];
      const rows = queryBySignature(rest[sigIdx + 1], opts);
      stdout(JSON.stringify(rows));
      return 0;
    }
    if (sub === 'sanitize') {
      const text = stdin !== undefined ? stdin : await readStdin();
      stdout(sanitize(text));
      return 0;
    }
    process.stderr.write(`Unknown subcommand: ${sub}\n`);
    return 1;
  } catch (err) {
    process.stderr.write(`Error: ${err.message}\n`);
    return 1;
  }
}

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => (data += chunk));
    process.stdin.on('end', () => resolve(data));
  });
}

if (require.main === module) {
  runCli(process.argv.slice(2)).then((code) => process.exit(code));
}
```

And update `module.exports`:

```js
module.exports = { sanitize, appendRow, queryBySignature, runCli, _resetLogPathForTests };
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npm run test -- tests/unit/feedbackLog.test.ts`
Expected: PASS — all 4 CLI tests + earlier tests green.

- [ ] **Step 5: Commit**

```bash
git add dev-tools/feedback-log.js tests/unit/feedbackLog.test.ts
git commit -m "feat(triage-feedback): CLI subcommands (append/query/sanitize)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 5: Slash-command markdown

**Files:**
- Create: `.claude/commands/triage-feedback.md`

No tests — this is prompt content. Manual verification only.

- [ ] **Step 1: Write the slash command**

Create `.claude/commands/triage-feedback.md`:

````markdown
---
description: Pull recent PostHog feedback/errors/rageclicks, enrich with Supabase+Grafana, dedupe, and produce anonymized GitHub issue bodies (PII stays in ~/.nimble-pnl/feedback-log.jsonl)
---

# Triage Feedback

Turn recent PostHog signals into ready-to-file GitHub issue bodies. Reporter PII never reaches the issue body — it is recorded in a local JSONL audit log.

## Arguments

Parse `$ARGUMENTS` for these flags (all optional):

- `--window <Nd | Nh>` — time window (default: `7d`)
- `--include <list>` — comma-separated subset of: `surveys`, `errors`, `rageclicks` (default: all three)
- `--file` — after preview, run `gh issue create` for each new issue (default: print only)

## Required MCPs

Before doing anything, verify these MCPs are connected by attempting a no-op call:

- `mcp__claude_ai_PostHog__exec` (PostHog hosted MCP)
- `mcp__supabase-prod__execute_sql` (Supabase prod MCP)
- `mcp__grafana__*` (Grafana MCP)

If any are missing, print: `"⚠ <name> MCP not connected. Connect it before re-running."` and stop.

## Flow

### 1. PULL signals

For PostHog, follow the schema-first protocol:

```text
posthog:exec search query → posthog:exec info <tool> → posthog:exec call ...
```

Pull signals in parallel where possible:

**Surveys** (`survey sent` events in window):

```sql
SELECT timestamp, distinct_id, person_id,
       properties.`$survey_id` AS survey_id,
       properties.`$current_url` AS url,
       extractAll(toJSONString(properties), '"\\$survey_response_[^"]+"\\s*:\\s*"([^"]+)"')[1] AS response_text,
       properties.`$survey_completed` AS completed
FROM events
WHERE event = 'survey sent'
  AND timestamp >= now() - INTERVAL <WINDOW>
ORDER BY timestamp DESC
LIMIT 100
```

**Error tracking** (Error Tracking issues whose `first_seen` falls in window OR whose event count is rising):
Use the `query-error-tracking-issues-list` PostHog tool.

**Rageclicks** (`$rageclick` events with ≥3 distinct users on same url+selector in window):

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

For each signal with a `distinct_id`:

```sql
-- Supabase prod
SELECT id, email, raw_user_meta_data->>'full_name' AS full_name
FROM auth.users WHERE id = '<distinct_id>'
```

If found, also fetch:

```sql
SELECT ur.role, r.id AS restaurant_id, r.name AS restaurant_name
FROM user_restaurants ur JOIN restaurants r ON r.id = ur.restaurant_id
WHERE ur.user_id = '<distinct_id>' LIMIT 1
```

And logs ±10 min via `mcp__supabase-prod__get_logs` (postgres / edge-fn / pg-net).

For Grafana correlation at signal timestamp:

- `mcp__grafana__query_loki_logs` filtered by service + 10 min window
- `mcp__grafana__list_alert_groups` for firing alerts at that time

### 3. DEDUPE

For each candidate signal:

1. Compute `signature` = first 12 chars of sha256(`url + ':' + normalized_keyword`).
2. Search local log: `node dev-tools/feedback-log.js query --signature <sig>`. If any row has a non-null `gh_issue_number` and the GitHub issue is still open, **skip**.
3. Search GitHub: `gh issue list --search "<signature>" --state all --limit 20 --json number,state,title`. Skip if matching open issue exists. Note closed matches in the output for the user's awareness.

### 4. SYNTHESIZE the issue body

For each surviving candidate:

1. Pipe every piece of free-text (feedback, logs excerpt, page titles) through:

   ```bash
   echo "<text>" | node dev-tools/feedback-log.js sanitize
   ```

2. Compose this body (use semantic markdown — do NOT echo any reporter identity):

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
   <result of `grep -r "<keyword>" src/ supabase/ --include="*.ts" --include="*.tsx" -l | head -10`>

   ## Acceptance criteria
   - [ ] Issue reproduces on <route> with <input>
   - [ ] Fix verified locally + in staging
   - [ ] Regression test added

   ## Test plan
   - Unit: <relevant tests>
   - E2E: <playwright path if UI bug>
   ```

3. Generate a stable UUID for the row id (use `crypto.randomUUID()` via a one-liner: `node -e "console.log(crypto.randomUUID())"`).

### 5. PREVIEW or FILE

Print the title + body for each candidate. Then:

- **Default (no `--file`):** Print a `gh issue create` command per candidate for the user to copy/run.
- **`--file`:** Ask the user to confirm the count. On yes, run `gh issue create --title "..." --body "..."` per candidate and capture the issue number.

### 6. LOG

For every candidate (filed or skipped), append a row:

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
  Skipped (dedup):        <N>
  Filed:                  <N>
  Reviewed, not filed:    <N>

Local log: ~/.nimble-pnl/feedback-log.jsonl (<X> rows)
```

## Guarantees

- Reporter `email`, `full_name`, raw feedback text, and restaurant context never appear in the GitHub issue body.
- Helper output goes only to local JSONL; stdout in this command never echoes raw PII.
- Default mode prints — never files — issues. `--file` is opt-in.
````

- [ ] **Step 2: Manually verify the file parses**

Run: `head -5 .claude/commands/triage-feedback.md`
Expected: shows YAML frontmatter with `description:` line.

- [ ] **Step 3: Commit**

```bash
git add .claude/commands/triage-feedback.md
git commit -m "feat(triage-feedback): add /triage-feedback slash command

Orchestration prompt that pulls PostHog signals, enriches with Supabase
prod + Grafana, dedupes against GH issues and the local audit log, and
produces anonymized GH issue bodies. Default mode prints for review;
--file flag opts into auto-create via gh.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 6: Verify the full helper test suite

**Files:** None (verification only)

- [ ] **Step 1: Run the helper tests in isolation**

Run: `npm run test -- tests/unit/feedbackLog.test.ts`
Expected: All tests pass (~15 tests across sanitize, appendRow, queryBySignature, CLI).

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS — no type errors. (The new test file uses TS; the helper is plain JS and is imported via Node's module resolution, which Vitest handles via its TS pipeline.)

- [ ] **Step 3: Run lint**

Run: `npm run lint`
Expected: PASS — no new lint errors. Fix any introduced.

- [ ] **Step 4: No commit needed if everything is green**

If any of the above fail, fix and commit a `fix(triage-feedback): ...` patch before proceeding.

---

## Self-Review

**Spec coverage:**
- [x] Single manually-invoked command — Task 5
- [x] Pulls surveys + errors + rageclicks — Task 5 step 1
- [x] Enriches with Supabase prod + Grafana — Task 5 step 2
- [x] Dedupes against GH + local log — Task 5 step 3
- [x] Anonymized issue body, raw PII stays local — Task 5 steps 4–6 + sanitizer Task 1
- [x] `~/.nimble-pnl/feedback-log.jsonl` audit log — Tasks 2 + 4
- [x] `--file` opt-in, default review-only — Task 5 step 5
- [x] Thank-you flow explicitly OUT of scope — confirmed (no task for it)
- [x] PostHog person UUID may differ from Supabase user_id — handled by null-on-miss in Task 5 step 2

**Placeholder scan:** No `TBD`/`TODO`. Every code block contains complete content.

**Type consistency:** All helper functions reference the same names across tasks (`sanitize`, `appendRow`, `queryBySignature`, `runCli`, `_resetLogPathForTests`).

Plan is complete.
