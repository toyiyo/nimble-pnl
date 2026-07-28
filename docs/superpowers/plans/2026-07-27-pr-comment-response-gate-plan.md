# PR Comment Response Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make it mechanically impossible to merge a PR while any review finding — from an AI bot or a human — lacks a visible reply on the PR stating whether we agreed (and in which commit), pushed back, or deliberately ignored it.

**Architecture:** One ESM module (`dev-tools/pr-triage.js`) holds the pure rules for what a valid reply is and which findings are unanswered. A `/dev` session uses its `reply` verb to post threaded replies; a GitHub Actions workflow uses its `audit` verb to publish a blocking check run. Both share `parseVerdict`/`classifyThreads`, so CI can never reject a reply our own tooling considers valid.

**Tech Stack:** Node 20 ESM (no runtime dependencies — GitHub access is shelled out to the `gh` CLI, which is present locally and preinstalled on `ubuntu-latest`), vitest for unit tests, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-07-27-pr-comment-response-gate-design.md`

## Global Constraints

- The repo is ESM (`"type": "module"` in `package.json`). Use `import`/`export`, never `require`.
- No new npm dependencies. All GitHub access goes through `gh` shelled out via `node:child_process`.
- Pure logic (`parseVerdict`, `composeReply`, `classifyThreads`, `renderSummary`) must not perform I/O — network access lives only in the CLI verbs, which pass fetched data in as arguments. This is the seam that makes the module unit-testable.
- Follow the existing `dev-tools/feedback-log.js` shape: named exports for logic plus `export async function runCli(argv, io = {})`, with `io` injectable so tests never touch the real console or network.
- Verdict keys are exactly `agreed`, `pushed-back`, `ignored`. Display forms are exactly `✅ Agreed`, `↩️ Pushed back`, `⏭️ Ignored`. Marker form is exactly `<!-- pr-triage: <key> -->`.
- Reply authorship counts only from a non-bot with `authorAssociation` in `OWNER`, `MEMBER`, `COLLABORATOR`.
- Tests live at `tests/unit/prTriage.test.ts` and import from `../../dev-tools/pr-triage.js`, mirroring `tests/unit/feedbackLog.test.ts`.
- The check run is named exactly `pr-comment-response`. This string appears in the workflow and in the docs; they must agree, because it is what branch protection keys on.

## File Structure

| File | Responsibility |
|---|---|
| `dev-tools/pr-triage.js` (create) | Verdict vocabulary, reply composition/parsing, thread classification, summary rendering, and the `audit`/`list`/`reply` CLI. |
| `tests/unit/prTriage.test.ts` (create) | Unit tests for every pure export, using literal GraphQL-shaped fixtures. |
| `.github/workflows/pr-comment-response.yml` (create) | Runs `audit` on PR/review/comment events and publishes the `pr-comment-response` check run. |
| `.claude/skills/development-workflow.md` (modify) | Phase 9d requires a verdict reply per finding; Phase 9e requires `audit` to exit 0. |
| `.claude/workflows/dev-build-and-ship.js` (modify) | Same requirement in the autonomous 9d prompt and 9e done gate. |
| `dev-tools/README.md` (modify) | Document the three verbs. |

Tasks 1–4 build the module bottom-up (vocabulary → parsing → classification → rendering); each is independently testable. Task 5 adds the CLI + real GitHub I/O. Task 6 adds the workflow. Task 7 wires the `/dev` workflow and docs.

---

### Task 1: Verdict vocabulary and reply composition

**Files:**
- Create: `dev-tools/pr-triage.js`
- Test: `tests/unit/prTriage.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `VERDICTS` (a frozen object keyed by verdict key, each `{key, display, marker}`), and `composeReply({verdict, rationale, commit}) -> string`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/prTriage.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { VERDICTS, composeReply } from '../../dev-tools/pr-triage.js';

describe('pr-triage: VERDICTS', () => {
  it('defines exactly the three verdict keys', () => {
    expect(Object.keys(VERDICTS).sort()).toEqual(['agreed', 'ignored', 'pushed-back']);
  });

  it('carries display and marker forms', () => {
    expect(VERDICTS.agreed.display).toBe('✅ Agreed');
    expect(VERDICTS.agreed.marker).toBe('<!-- pr-triage: agreed -->');
    expect(VERDICTS['pushed-back'].display).toBe('↩️ Pushed back');
    expect(VERDICTS.ignored.display).toBe('⏭️ Ignored');
  });
});

describe('pr-triage: composeReply', () => {
  it('builds an agreed reply with the marker, display form and commit', () => {
    const body = composeReply({
      verdict: 'agreed',
      rationale: 'Coerced capacity via Number.isFinite before use.',
      commit: 'abc1234',
    });
    expect(body).toContain('<!-- pr-triage: agreed -->');
    expect(body).toContain('**✅ Agreed**');
    expect(body).toContain('Coerced capacity via Number.isFinite before use.');
    expect(body).toContain('`abc1234`');
  });

  it('builds a pushed-back reply without requiring a commit', () => {
    const body = composeReply({
      verdict: 'pushed-back',
      rationale: 'bg-amber-500/10 is the documented CLAUDE.md pattern.',
    });
    expect(body).toContain('<!-- pr-triage: pushed-back -->');
    expect(body).toContain('**↩️ Pushed back**');
  });

  it('throws when agreed has no commit', () => {
    expect(() =>
      composeReply({ verdict: 'agreed', rationale: 'Fixed it properly.' }),
    ).toThrow(/commit/i);
  });

  it('throws on an unknown verdict', () => {
    expect(() =>
      composeReply({ verdict: 'maybe', rationale: 'Some rationale here.' }),
    ).toThrow(/unknown verdict/i);
  });

  it('throws on an empty or whitespace rationale', () => {
    expect(() => composeReply({ verdict: 'ignored', rationale: '   ' })).toThrow(/rationale/i);
  });

  it('throws on a rationale too short to explain anything', () => {
    expect(() => composeReply({ verdict: 'ignored', rationale: 'nit' })).toThrow(/rationale/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/prTriage.test.ts`
Expected: FAIL — cannot resolve `../../dev-tools/pr-triage.js`.

- [ ] **Step 3: Write minimal implementation**

Create `dev-tools/pr-triage.js`:

```js
#!/usr/bin/env node
/**
 * pr-triage — enforce that every PR review finding carries a visible verdict reply.
 *
 * Pure logic (VERDICTS, composeReply, parseVerdict, classifyThreads, renderSummary)
 * performs no I/O so it can be unit-tested. All GitHub access lives in the CLI verbs.
 *
 * See docs/superpowers/specs/2026-07-27-pr-comment-response-gate-design.md
 */

/** The three verdicts a finding may receive. Keys are the machine form. */
export const VERDICTS = Object.freeze({
  agreed: Object.freeze({
    key: 'agreed',
    display: '✅ Agreed',
    marker: '<!-- pr-triage: agreed -->',
  }),
  'pushed-back': Object.freeze({
    key: 'pushed-back',
    display: '↩️ Pushed back',
    marker: '<!-- pr-triage: pushed-back -->',
  }),
  ignored: Object.freeze({
    key: 'ignored',
    display: '⏭️ Ignored',
    marker: '<!-- pr-triage: ignored -->',
  }),
});

/** A rationale shorter than this explains nothing to a future reader. */
const MIN_RATIONALE_LENGTH = 10;

/**
 * Build the body of a threaded reply.
 * @param {{verdict: string, rationale: string, commit?: string}} input
 * @returns {string} the markdown body to post
 */
export function composeReply({ verdict, rationale, commit } = {}) {
  const spec = VERDICTS[verdict];
  if (!spec) {
    throw new Error(
      `Unknown verdict "${verdict}". Expected one of: ${Object.keys(VERDICTS).join(', ')}`,
    );
  }

  const text = (rationale ?? '').trim();
  if (text.length < MIN_RATIONALE_LENGTH) {
    throw new Error(
      `A rationale of at least ${MIN_RATIONALE_LENGTH} characters is required — ` +
        'the point of the reply is to tell a future reader why.',
    );
  }

  if (verdict === 'agreed' && !(commit ?? '').trim()) {
    throw new Error('An "agreed" reply must cite the commit that fixed the finding.');
  }

  const suffix = verdict === 'agreed' ? ` Fixed in \`${commit.trim()}\`.` : '';
  return `${spec.marker}\n**${spec.display}** — ${text}${suffix}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/prTriage.test.ts`
Expected: PASS — 8 tests.

- [ ] **Step 5: Commit**

```bash
git add dev-tools/pr-triage.js tests/unit/prTriage.test.ts
git commit -m "feat(pr-triage): verdict vocabulary and reply composition"
```

---

### Task 2: Parse a verdict out of a reply body

**Files:**
- Modify: `dev-tools/pr-triage.js`
- Test: `tests/unit/prTriage.test.ts`

**Interfaces:**
- Consumes: `VERDICTS`, `composeReply` from Task 1.
- Produces: `parseVerdict(body) -> {verdict: string, rationale: string} | null`.

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/prTriage.test.ts` (and add `parseVerdict` to the import from Task 1):

```ts
import { parseVerdict } from '../../dev-tools/pr-triage.js';

describe('pr-triage: parseVerdict', () => {
  it('round-trips every verdict composed by composeReply', () => {
    for (const key of Object.keys(VERDICTS)) {
      const body = composeReply({
        verdict: key,
        rationale: 'A sufficiently descriptive rationale.',
        commit: 'abc1234',
      });
      expect(parseVerdict(body)?.verdict).toBe(key);
    }
  });

  it('accepts a hand-typed reply with a colon separator', () => {
    const parsed = parseVerdict('Agreed: coerced the value before use.');
    expect(parsed?.verdict).toBe('agreed');
    expect(parsed?.rationale).toBe('coerced the value before use.');
  });

  it('accepts an em-dash separator and multi-word verdicts', () => {
    expect(parseVerdict('Pushed back — this is the documented pattern.')?.verdict).toBe(
      'pushed-back',
    );
    expect(parseVerdict('Ignored - style nit, house convention differs.')?.verdict).toBe(
      'ignored',
    );
  });

  it('treats "declined" as pushed back', () => {
    expect(parseVerdict('Declined: the finding misreads the guard.')?.verdict).toBe(
      'pushed-back',
    );
  });

  it('is case-insensitive', () => {
    expect(parseVerdict('AGREED: fixed in the follow-up commit.')?.verdict).toBe('agreed');
  });

  it('rejects a bare verdict word with no rationale', () => {
    expect(parseVerdict('Agreed')).toBeNull();
    expect(parseVerdict('Agreed:')).toBeNull();
    expect(parseVerdict('Agreed: ok')).toBeNull();
  });

  it('rejects unrelated prose', () => {
    expect(parseVerdict('Thanks, nice catch!')).toBeNull();
    expect(parseVerdict('')).toBeNull();
    expect(parseVerdict(undefined)).toBeNull();
  });

  it('does not match a verdict word buried mid-sentence', () => {
    expect(parseVerdict('I think everyone agreed: this is fine as written.')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/prTriage.test.ts`
Expected: FAIL — `parseVerdict is not a function`.

- [ ] **Step 3: Write minimal implementation**

Append to `dev-tools/pr-triage.js`:

```js
/**
 * Hand-typed aliases, so a human replying in the GitHub UI is never blocked
 * by having to remember the HTML marker. Longest first: "pushed back" must be
 * tried before any shorter prefix of it could match.
 */
const VERDICT_ALIASES = [
  ['pushed back', 'pushed-back'],
  ['pushed-back', 'pushed-back'],
  ['declined', 'pushed-back'],
  ['agreed', 'agreed'],
  ['ignored', 'ignored'],
];

/**
 * Extract a verdict and its rationale from a reply body.
 * @param {string} body
 * @returns {{verdict: string, rationale: string} | null} null when the body carries no verdict
 */
export function parseVerdict(body) {
  if (typeof body !== 'string' || !body.trim()) return null;

  // Preferred form: the machine marker, wherever it appears in the body.
  for (const spec of Object.values(VERDICTS)) {
    if (body.includes(spec.marker)) {
      const rationale = stripToRationale(body.replace(spec.marker, ''), spec.display);
      return rationale ? { verdict: spec.key, rationale } : null;
    }
  }

  // Fallback: a hand-typed reply whose FIRST line opens with a verdict word.
  // Anchoring to the start is what stops "everyone agreed: ..." from matching.
  const firstLine = body.trim().split('\n')[0].trim();
  const plain = firstLine.replace(/\*\*/g, '').replace(/[✅↩️⏭️]/gu, '').trim();
  for (const [alias, key] of VERDICT_ALIASES) {
    const pattern = new RegExp(`^${alias}\\s*(?::|—|–|-)\\s*(.+)$`, 'iu');
    const match = plain.match(pattern);
    if (match) {
      const rationale = match[1].trim();
      return rationale.length >= MIN_RATIONALE_LENGTH ? { verdict: key, rationale } : null;
    }
  }

  return null;
}

/** Pull the human rationale out of a marker-form body. */
function stripToRationale(body, display) {
  return body
    .replace(/\*\*/g, '')
    .replace(display, '')
    .replace(/^[\s—–-]+/u, '')
    .trim();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/prTriage.test.ts`
Expected: PASS — all Task 1 and Task 2 tests.

- [ ] **Step 5: Commit**

```bash
git add dev-tools/pr-triage.js tests/unit/prTriage.test.ts
git commit -m "feat(pr-triage): parse verdicts from marker and hand-typed replies"
```

---

### Task 3: Classify threads and reviews into answered / unanswered

**Files:**
- Modify: `dev-tools/pr-triage.js`
- Test: `tests/unit/prTriage.test.ts`

**Interfaces:**
- Consumes: `parseVerdict` from Task 2.
- Produces:
  - `isBotActor({login, __typename}) -> boolean`
  - `classifyThreads({threads, reviews, prAuthor, knownShas}) -> {unanswered: Finding[], answered: Finding[], skipped: Finding[]}`

  where a `Finding` is `{kind: 'thread'|'review', id, author, path, line, excerpt, reason}`. `reason` is present only on `unanswered` entries and explains why it did not pass (`'no reply'`, `'reply from a bot'`, `'reply from a non-maintainer'`, `'no verdict in reply'`, `'cites an unknown commit'`).

  Input shapes mirror the GitHub GraphQL response: a thread is
  `{id, isResolved, isOutdated, path, line, comments: {nodes: [{author: {login, __typename}, authorAssociation, body, databaseId}]}}`;
  a review is `{id, state, author: {login, __typename}, authorAssociation, body}`.

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/prTriage.test.ts`:

```ts
import { classifyThreads, isBotActor } from '../../dev-tools/pr-triage.js';

const PR_AUTHOR = 'toyiyo';
const SHAS = ['abc1234def5678abc1234def5678abc1234def56'];

/** Build a GraphQL-shaped review thread. */
function thread(comments, extra = {}) {
  return {
    id: 'THREAD_1',
    isResolved: false,
    isOutdated: false,
    path: 'src/hooks/useReceiptImport.tsx',
    line: 717,
    ...extra,
    comments: { nodes: comments },
  };
}

/** Build a GraphQL-shaped comment. */
function comment(login, body, { type = 'User', assoc = 'COLLABORATOR', id = 1 } = {}) {
  return {
    databaseId: id,
    author: { login, __typename: type },
    authorAssociation: assoc,
    body,
  };
}

const FINDING = comment('coderabbitai', 'Potential off-by-one in the loop bound.', {
  type: 'Bot',
  assoc: 'NONE',
  id: 10,
});

describe('pr-triage: isBotActor', () => {
  it('detects a GraphQL Bot actor', () => {
    expect(isBotActor({ login: 'coderabbitai', __typename: 'Bot' })).toBe(true);
  });

  it('detects a [bot] login suffix', () => {
    expect(isBotActor({ login: 'sonarcloud[bot]', __typename: 'User' })).toBe(true);
  });

  it('detects known reviewer bots that are typed User and lack a suffix', () => {
    expect(isBotActor({ login: 'Copilot', __typename: 'User' })).toBe(true);
    expect(isBotActor({ login: 'chatgpt-codex-connector', __typename: 'User' })).toBe(true);
  });

  it('does not flag a human', () => {
    expect(isBotActor({ login: 'toyiyo', __typename: 'User' })).toBe(false);
  });
});

describe('pr-triage: classifyThreads', () => {
  it('blocks a bot finding with no reply', () => {
    const r = classifyThreads({ threads: [thread([FINDING])], prAuthor: PR_AUTHOR });
    expect(r.unanswered).toHaveLength(1);
    expect(r.unanswered[0].author).toBe('coderabbitai');
    expect(r.unanswered[0].reason).toBe('no reply');
  });

  it('passes a bot finding answered by a maintainer verdict reply', () => {
    const reply = comment('toyiyo', composeReply({
      verdict: 'pushed-back',
      rationale: 'The bound is exclusive; the loop is correct.',
    }), { id: 11 });
    const r = classifyThreads({ threads: [thread([FINDING, reply])], prAuthor: PR_AUTHOR });
    expect(r.unanswered).toHaveLength(0);
    expect(r.answered).toHaveLength(1);
  });

  it('does not accept a reply from another bot', () => {
    const reply = comment('Copilot', 'Agreed: this looks correct to me now.', {
      assoc: 'NONE',
      id: 12,
    });
    const r = classifyThreads({ threads: [thread([FINDING, reply])], prAuthor: PR_AUTHOR });
    expect(r.unanswered[0].reason).toBe('reply from a bot');
  });

  it('does not accept a reply from a non-maintainer', () => {
    const reply = comment('drive-by', 'Agreed: this should be fixed soon.', {
      assoc: 'NONE',
      id: 13,
    });
    const r = classifyThreads({ threads: [thread([FINDING, reply])], prAuthor: PR_AUTHOR });
    expect(r.unanswered[0].reason).toBe('reply from a non-maintainer');
  });

  it('does not accept a maintainer reply that carries no verdict', () => {
    const reply = comment('toyiyo', 'Thanks, good catch — looking into it.', { id: 14 });
    const r = classifyThreads({ threads: [thread([FINDING, reply])], prAuthor: PR_AUTHOR });
    expect(r.unanswered[0].reason).toBe('no verdict in reply');
  });

  it('skips a thread the PR author started', () => {
    const own = comment(PR_AUTHOR, 'Note for reviewers: this is intentional.', { id: 15 });
    const r = classifyThreads({ threads: [thread([own])], prAuthor: PR_AUTHOR });
    expect(r.unanswered).toHaveLength(0);
    expect(r.skipped).toHaveLength(1);
  });

  it('still blocks a resolved thread with no reply', () => {
    const r = classifyThreads({
      threads: [thread([FINDING], { isResolved: true })],
      prAuthor: PR_AUTHOR,
    });
    expect(r.unanswered).toHaveLength(1);
  });

  it('still blocks an outdated thread with no reply', () => {
    const r = classifyThreads({
      threads: [thread([FINDING], { isOutdated: true })],
      prAuthor: PR_AUTHOR,
    });
    expect(r.unanswered).toHaveLength(1);
  });

  it('blocks an agreed reply citing a commit that is not on the PR', () => {
    const reply = comment('toyiyo', composeReply({
      verdict: 'agreed',
      rationale: 'Fixed the loop bound as suggested.',
      commit: 'deadbee',
    }), { id: 16 });
    const r = classifyThreads({
      threads: [thread([FINDING, reply])],
      prAuthor: PR_AUTHOR,
      knownShas: SHAS,
    });
    expect(r.unanswered[0].reason).toBe('cites an unknown commit');
  });

  it('accepts an agreed reply citing a short prefix of a real commit', () => {
    const reply = comment('toyiyo', composeReply({
      verdict: 'agreed',
      rationale: 'Fixed the loop bound as suggested.',
      commit: 'abc1234',
    }), { id: 17 });
    const r = classifyThreads({
      threads: [thread([FINDING, reply])],
      prAuthor: PR_AUTHOR,
      knownShas: SHAS,
    });
    expect(r.unanswered).toHaveLength(0);
  });

  it('skips commit verification when knownShas is not supplied', () => {
    const reply = comment('toyiyo', composeReply({
      verdict: 'agreed',
      rationale: 'Fixed the loop bound as suggested.',
      commit: 'deadbee',
    }), { id: 18 });
    const r = classifyThreads({ threads: [thread([FINDING, reply])], prAuthor: PR_AUTHOR });
    expect(r.unanswered).toHaveLength(0);
  });

  it('blocks a CHANGES_REQUESTED review with no reply', () => {
    const r = classifyThreads({
      threads: [],
      reviews: [{
        id: 'REVIEW_1',
        state: 'CHANGES_REQUESTED',
        author: { login: 'a-human', __typename: 'User' },
        authorAssociation: 'MEMBER',
        body: 'This needs rework before merge.',
      }],
      prAuthor: PR_AUTHOR,
    });
    expect(r.unanswered).toHaveLength(1);
    expect(r.unanswered[0].kind).toBe('review');
  });

  it('never blocks on COMMENTED or APPROVED reviews', () => {
    const r = classifyThreads({
      threads: [],
      reviews: [
        { id: 'R1', state: 'COMMENTED', author: { login: 'coderabbitai', __typename: 'Bot' }, authorAssociation: 'NONE', body: 'Walkthrough summary.' },
        { id: 'R2', state: 'APPROVED', author: { login: 'a-human', __typename: 'User' }, authorAssociation: 'MEMBER', body: 'LGTM' },
      ],
      prAuthor: PR_AUTHOR,
    });
    expect(r.unanswered).toHaveLength(0);
  });

  it('tolerates missing threads, reviews and comment nodes', () => {
    expect(classifyThreads({ prAuthor: PR_AUTHOR }).unanswered).toHaveLength(0);
    expect(
      classifyThreads({ threads: [thread([])], prAuthor: PR_AUTHOR }).unanswered,
    ).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/prTriage.test.ts`
Expected: FAIL — `classifyThreads is not a function`.

- [ ] **Step 3: Write minimal implementation**

Append to `dev-tools/pr-triage.js`:

```js
/**
 * Reviewer bots GitHub reports as `User` rather than `Bot`, and whose logins
 * carry no `[bot]` suffix. MAINTENANCE TRAP: a new reviewer bot that is neither
 * typed `Bot` nor suffixed must be added here, or its replies would wrongly
 * count as answering another bot's finding. The __typename check below covers
 * every GitHub App, so this list should stay short.
 */
const KNOWN_BOT_LOGINS = ['copilot', 'chatgpt-codex-connector'];

/** Associations that mark someone as able to speak for this repo. */
const MAINTAINER_ASSOCIATIONS = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);

/** Review states that represent a finding requiring an answer. */
const BLOCKING_REVIEW_STATES = new Set(['CHANGES_REQUESTED']);

/** The shortest abbreviated SHA git will accept as unambiguous. */
const MIN_SHA_PREFIX = 7;

/**
 * @param {{login?: string, __typename?: string}} actor
 * @returns {boolean} true when the actor is a bot rather than a person
 */
export function isBotActor(actor) {
  const login = (actor?.login ?? '').toLowerCase();
  if (actor?.__typename === 'Bot') return true;
  if (login.endsWith('[bot]')) return true;
  return KNOWN_BOT_LOGINS.includes(login);
}

/**
 * Decide which findings on a PR still lack a verdict reply.
 *
 * Pure: `knownShas` is supplied by the caller; nothing here touches the network.
 *
 * @param {{threads?: object[], reviews?: object[], prAuthor: string, knownShas?: string[]}} input
 * @returns {{unanswered: object[], answered: object[], skipped: object[]}}
 */
export function classifyThreads({ threads = [], reviews = [], prAuthor, knownShas } = {}) {
  const result = { unanswered: [], answered: [], skipped: [] };

  for (const t of threads) {
    const comments = t?.comments?.nodes ?? [];
    const root = comments[0];
    if (!root) continue;

    const finding = {
      kind: 'thread',
      id: t.id,
      commentId: root.databaseId,
      author: root.author?.login ?? 'unknown',
      path: t.path ?? '',
      line: t.line ?? null,
      excerpt: excerpt(root.body),
    };

    // A note the PR author left for reviewers is not a finding against us.
    if (sameUser(root.author?.login, prAuthor)) {
      result.skipped.push(finding);
      continue;
    }

    const reason = firstUnansweredReason(comments.slice(1), knownShas);
    if (reason) result.unanswered.push({ ...finding, reason });
    else result.answered.push(finding);
  }

  for (const r of reviews) {
    if (!BLOCKING_REVIEW_STATES.has(r?.state)) continue;
    if (sameUser(r.author?.login, prAuthor)) continue;

    const finding = {
      kind: 'review',
      id: r.id,
      commentId: null,
      author: r.author?.login ?? 'unknown',
      path: '',
      line: null,
      excerpt: excerpt(r.body),
    };
    // A CHANGES_REQUESTED review is answered by a later review or a PR comment
    // carrying a verdict; the caller supplies those as `reviews` too.
    const answeredBy = reviews.some(
      (other) =>
        other !== r &&
        !isBotActor(other.author) &&
        MAINTAINER_ASSOCIATIONS.has(other.authorAssociation) &&
        parseVerdict(other.body),
    );
    if (answeredBy) result.answered.push(finding);
    else result.unanswered.push({ ...finding, reason: 'no reply' });
  }

  return result;
}

/**
 * Walk the replies to a finding and report why none of them answers it.
 * @returns {string|null} null when the finding IS answered
 */
function firstUnansweredReason(replies, knownShas) {
  if (replies.length === 0) return 'no reply';

  let reason = 'no reply';
  for (const reply of replies) {
    if (isBotActor(reply.author)) {
      reason = 'reply from a bot';
      continue;
    }
    if (!MAINTAINER_ASSOCIATIONS.has(reply.authorAssociation)) {
      reason = 'reply from a non-maintainer';
      continue;
    }
    const parsed = parseVerdict(reply.body);
    if (!parsed) {
      reason = 'no verdict in reply';
      continue;
    }
    if (parsed.verdict === 'agreed' && !citesKnownCommit(reply.body, knownShas)) {
      reason = 'cites an unknown commit';
      continue;
    }
    return null; // answered
  }
  return reason;
}

/**
 * True when the reply names a commit that is actually on the PR.
 * Verification is skipped entirely when the caller supplies no SHA list,
 * so the pure classifier stays usable without network access.
 */
function citesKnownCommit(body, knownShas) {
  if (!Array.isArray(knownShas) || knownShas.length === 0) return true;
  const cited = body.match(/\b[0-9a-f]{7,40}\b/gi) ?? [];
  return cited.some((c) =>
    knownShas.some((sha) => sha.toLowerCase().startsWith(c.toLowerCase())),
  );
}

function sameUser(a, b) {
  return Boolean(a) && Boolean(b) && a.toLowerCase() === b.toLowerCase();
}

function excerpt(body, max = 120) {
  const flat = (body ?? '').replace(/\s+/gu, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/prTriage.test.ts`
Expected: PASS — all Task 1–3 tests.

- [ ] **Step 5: Commit**

```bash
git add dev-tools/pr-triage.js tests/unit/prTriage.test.ts
git commit -m "feat(pr-triage): classify findings into answered and unanswered"
```

---

### Task 4: Render the check-run summary

**Files:**
- Modify: `dev-tools/pr-triage.js`
- Test: `tests/unit/prTriage.test.ts`

**Interfaces:**
- Consumes: the `classifyThreads` result shape from Task 3.
- Produces: `renderSummary(result) -> string` (GitHub-flavoured markdown).

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/prTriage.test.ts`:

```ts
import { renderSummary } from '../../dev-tools/pr-triage.js';

describe('pr-triage: renderSummary', () => {
  it('reports success when nothing is unanswered', () => {
    const md = renderSummary({ unanswered: [], answered: [], skipped: [] });
    expect(md).toMatch(/every finding has a verdict reply/i);
  });

  it('lists each unanswered finding with author, location and reason', () => {
    const md = renderSummary({
      unanswered: [
        {
          kind: 'thread',
          author: 'coderabbitai',
          path: 'src/hooks/useReceiptImport.tsx',
          line: 717,
          excerpt: 'Potential off-by-one in the loop bound.',
          reason: 'no reply',
        },
      ],
      answered: [{ kind: 'thread', author: 'Copilot' }],
      skipped: [],
    });
    expect(md).toContain('coderabbitai');
    expect(md).toContain('src/hooks/useReceiptImport.tsx:717');
    expect(md).toContain('no reply');
    expect(md).toMatch(/1 unanswered/i);
  });

  it('renders a review finding that has no file location', () => {
    const md = renderSummary({
      unanswered: [
        { kind: 'review', author: 'a-human', path: '', line: null, excerpt: 'Needs rework.', reason: 'no reply' },
      ],
      answered: [],
      skipped: [],
    });
    expect(md).toContain('a-human');
    expect(md).not.toContain('undefined');
    expect(md).not.toContain('null');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/prTriage.test.ts`
Expected: FAIL — `renderSummary is not a function`.

- [ ] **Step 3: Write minimal implementation**

Append to `dev-tools/pr-triage.js`:

```js
/**
 * Render the classification as markdown for the check-run summary, so the
 * reason for a red gate is legible without opening the job log.
 * @param {{unanswered: object[], answered: object[], skipped: object[]}} result
 * @returns {string}
 */
export function renderSummary(result) {
  const { unanswered = [], answered = [], skipped = [] } = result ?? {};
  const tallies =
    `**${unanswered.length} unanswered** · ${answered.length} answered · ${skipped.length} skipped (own threads)`;

  if (unanswered.length === 0) {
    return `${tallies}\n\n✅ every finding has a verdict reply on the PR.`;
  }

  const rows = unanswered
    .map((f) => {
      const where = f.path ? `\`${f.path}${f.line ? `:${f.line}` : ''}\`` : '_PR review_';
      return `| ${f.author} | ${where} | ${f.reason} | ${f.excerpt || ''} |`;
    })
    .join('\n');

  return [
    tallies,
    '',
    'Each finding below needs a threaded reply stating whether you agreed',
    '(naming the commit), pushed back, or deliberately ignored it:',
    '',
    '```bash',
    'node dev-tools/pr-triage.js list --pr <PR>',
    'node dev-tools/pr-triage.js reply --pr <PR> --comment <id> \\',
    '  --verdict agreed --commit <sha> --rationale "what you changed and why"',
    '```',
    '',
    '| Reviewer | Location | Why it is unanswered | Finding |',
    '| --- | --- | --- | --- |',
    rows,
  ].join('\n');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/prTriage.test.ts`
Expected: PASS — all Task 1–4 tests.

- [ ] **Step 5: Commit**

```bash
git add dev-tools/pr-triage.js tests/unit/prTriage.test.ts
git commit -m "feat(pr-triage): render the check-run summary"
```

---

### Task 5: The CLI — `audit`, `list`, `reply`

**Files:**
- Modify: `dev-tools/pr-triage.js`
- Test: `tests/unit/prTriage.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–4.
- Produces: `export async function runCli(argv, io = {})` where `io` is `{log, error, gh, graphql}`. `gh(args: string[]) -> Promise<any>` runs `gh api` and returns parsed JSON; `graphql(query, vars) -> Promise<any>`. Both default to real `gh` shell-outs and are injected in tests. Returns the process exit code (`0` clean, `1` unanswered findings, `2` usage error).

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/prTriage.test.ts`:

```ts
import { runCli } from '../../dev-tools/pr-triage.js';

/** Minimal fake io: records output, serves canned GitHub responses. */
function fakeIo({ threads = [], reviews = [], commits = [], onPost } = {}) {
  const out = [];
  return {
    out,
    log: (m) => out.push(String(m)),
    error: (m) => out.push(String(m)),
    graphql: async () => ({
      data: {
        repository: {
          pullRequest: {
            author: { login: 'toyiyo' },
            reviewThreads: { nodes: threads, pageInfo: { hasNextPage: false, endCursor: null } },
            reviews: { nodes: reviews },
          },
        },
      },
    }),
    gh: async (args) => {
      if (args.some((a) => a.includes('/commits'))) return commits;
      if (onPost) return onPost(args);
      return {};
    },
  };
}

const BOT_FINDING = {
  id: 'T1',
  isResolved: false,
  isOutdated: false,
  path: 'src/a.ts',
  line: 3,
  comments: {
    nodes: [
      {
        databaseId: 99,
        author: { login: 'coderabbitai', __typename: 'Bot' },
        authorAssociation: 'NONE',
        body: 'This loop bound looks wrong.',
      },
    ],
  },
};

describe('pr-triage: runCli audit', () => {
  it('exits 0 and says so when there is nothing unanswered', async () => {
    const io = fakeIo();
    const code = await runCli(['audit', '--pr', '1'], io);
    expect(code).toBe(0);
    expect(io.out.join('\n')).toMatch(/every finding has a verdict reply/i);
  });

  it('exits 1 and prints the finding when one is unanswered', async () => {
    const io = fakeIo({ threads: [BOT_FINDING] });
    const code = await runCli(['audit', '--pr', '1'], io);
    expect(code).toBe(1);
    expect(io.out.join('\n')).toContain('coderabbitai');
    expect(io.out.join('\n')).toContain('src/a.ts:3');
  });

  it('exits 2 when --pr is missing', async () => {
    const io = fakeIo();
    expect(await runCli(['audit'], io)).toBe(2);
    expect(io.out.join('\n')).toMatch(/--pr/);
  });
});

describe('pr-triage: runCli list', () => {
  it('prints the comment id needed to reply', async () => {
    const io = fakeIo({ threads: [BOT_FINDING] });
    const code = await runCli(['list', '--pr', '1'], io);
    expect(code).toBe(0);
    expect(io.out.join('\n')).toContain('99');
  });
});

describe('pr-triage: runCli reply', () => {
  it('posts a composed reply to the thread and resolves it', async () => {
    const posted = [];
    const io = fakeIo({
      threads: [BOT_FINDING],
      onPost: (args) => { posted.push(args); return {}; },
    });
    const code = await runCli(
      ['reply', '--pr', '1', '--comment', '99', '--verdict', 'pushed-back',
       '--rationale', 'The bound is exclusive; this is correct.'],
      io,
    );
    expect(code).toBe(0);
    const flat = posted.flat().join(' ');
    expect(flat).toContain('/pulls/1/comments/99/replies');
    expect(flat).toContain('↩️ Pushed back');
  });

  it('refuses an agreed reply with no commit, without posting', async () => {
    const posted = [];
    const io = fakeIo({ onPost: (args) => { posted.push(args); return {}; } });
    const code = await runCli(
      ['reply', '--pr', '1', '--comment', '99', '--verdict', 'agreed',
       '--rationale', 'Fixed it in the follow-up.'],
      io,
    );
    expect(code).toBe(2);
    expect(posted).toHaveLength(0);
    expect(io.out.join('\n')).toMatch(/commit/i);
  });

  it('exits 2 on an unknown verb', async () => {
    const io = fakeIo();
    expect(await runCli(['frobnicate'], io)).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/prTriage.test.ts`
Expected: FAIL — `runCli is not a function`.

- [ ] **Step 3: Write minimal implementation**

Append to `dev-tools/pr-triage.js`:

```js
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** Run `gh api ...` and parse the JSON it prints. */
async function ghApi(args) {
  const { stdout } = await execFileAsync('gh', ['api', ...args], {
    maxBuffer: 20 * 1024 * 1024,
  });
  return stdout.trim() ? JSON.parse(stdout) : {};
}

/** Run a GraphQL query through `gh api graphql`. */
async function ghGraphql(query, variables = {}) {
  const args = ['graphql', '-f', `query=${query}`];
  for (const [k, v] of Object.entries(variables)) {
    args.push('-F', `${k}=${v}`);
  }
  return ghApi(args);
}

const THREADS_QUERY = `
query($owner: String!, $repo: String!, $pr: Int!, $cursor: String) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $pr) {
      author { login }
      reviewThreads(first: 100, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          isResolved
          isOutdated
          path
          line
          comments(first: 100) {
            nodes {
              databaseId
              body
              authorAssociation
              author { login __typename }
            }
          }
        }
      }
      reviews(first: 100) {
        nodes { id state body authorAssociation author { login __typename } }
      }
    }
  }
}`;

const RESOLVE_MUTATION = `
mutation($threadId: ID!) {
  resolveReviewThread(input: {threadId: $threadId}) {
    thread { isResolved }
  }
}`;

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      opts[key] = true;
    } else {
      opts[key] = next;
      i += 1;
    }
  }
  return opts;
}

/** Derive `owner/repo` from the git remote, or from GITHUB_REPOSITORY in CI. */
async function resolveRepo(opts) {
  if (opts.repo) return opts.repo;
  if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY;
  const { stdout } = await execFileAsync('gh', [
    'repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner',
  ]);
  return stdout.trim();
}

/** Fetch every review thread and review for a PR, following pagination. */
async function fetchPr({ owner, repo, pr, graphql }) {
  const threads = [];
  let cursor = null;
  let author = '';
  let reviews = [];

  for (;;) {
    const res = await graphql(THREADS_QUERY, { owner, repo, pr, ...(cursor ? { cursor } : {}) });
    const node = res?.data?.repository?.pullRequest;
    if (!node) break;
    author = node.author?.login ?? author;
    reviews = node.reviews?.nodes ?? reviews;
    threads.push(...(node.reviewThreads?.nodes ?? []));
    const page = node.reviewThreads?.pageInfo;
    if (!page?.hasNextPage) break;
    cursor = page.endCursor;
  }

  return { threads, reviews, prAuthor: author };
}

const USAGE = `Usage:
  node dev-tools/pr-triage.js audit --pr <N>
  node dev-tools/pr-triage.js list  --pr <N>
  node dev-tools/pr-triage.js reply --pr <N> --comment <id> --verdict <agreed|pushed-back|ignored> \\
      [--commit <sha>] --rationale "<why>"

Exit codes: 0 clean, 1 unanswered findings, 2 usage error.`;

/**
 * @param {string[]} argv
 * @param {{log?: Function, error?: Function, gh?: Function, graphql?: Function}} io
 * @returns {Promise<number>} process exit code
 */
export async function runCli(argv, io = {}) {
  const log = io.log ?? console.log;
  const error = io.error ?? console.error;
  const gh = io.gh ?? ghApi;
  const graphql = io.graphql ?? ghGraphql;

  const [verb, ...rest] = argv;
  const opts = parseArgs(rest);

  if (!['audit', 'list', 'reply'].includes(verb)) {
    error(USAGE);
    return 2;
  }
  if (!opts.pr) {
    error('--pr <N> is required.\n' + USAGE);
    return 2;
  }

  const nameWithOwner = await resolveRepo(opts);
  const [owner, repo] = nameWithOwner.split('/');
  const pr = Number(opts.pr);

  if (verb === 'reply') {
    // Compose FIRST so an invalid reply is rejected before anything is posted.
    let body;
    try {
      body = composeReply({
        verdict: opts.verdict,
        rationale: opts.rationale,
        commit: opts.commit,
      });
    } catch (e) {
      error(e.message);
      return 2;
    }
    if (!opts.comment) {
      error('--comment <id> is required for reply.\n' + USAGE);
      return 2;
    }

    await gh([
      '--method', 'POST',
      `repos/${owner}/${repo}/pulls/${pr}/comments/${opts.comment}/replies`,
      '-f', `body=${body}`,
    ]);
    log(`Replied to comment ${opts.comment} on PR #${pr}.`);

    // Resolving is a courtesy for readability; the audit never keys on it, so a
    // failure here (e.g. the thread is already resolved) must not fail the reply.
    const { threads } = await fetchPr({ owner, repo, pr, graphql });
    const owning = threads.find((t) =>
      (t.comments?.nodes ?? []).some((c) => String(c.databaseId) === String(opts.comment)),
    );
    if (owning && !owning.isResolved) {
      try {
        await graphql(RESOLVE_MUTATION, { threadId: owning.id });
        log(`Resolved thread ${owning.id}.`);
      } catch (e) {
        log(`Reply posted; could not resolve the thread (${e.message}).`);
      }
    }
    return 0;
  }

  const { threads, reviews, prAuthor } = await fetchPr({ owner, repo, pr, graphql });

  let knownShas;
  try {
    const commits = await gh([`repos/${owner}/${repo}/pulls/${pr}/commits`, '--paginate']);
    knownShas = (Array.isArray(commits) ? commits : []).map((c) => c.sha).filter(Boolean);
  } catch {
    knownShas = undefined; // Verification is skipped rather than failing the gate.
  }

  const result = classifyThreads({ threads, reviews, prAuthor, knownShas });

  if (verb === 'list') {
    if (result.unanswered.length === 0) {
      log('No unanswered findings.');
      return 0;
    }
    for (const f of result.unanswered) {
      const where = f.path ? `${f.path}:${f.line ?? '?'}` : 'PR review';
      log(`--comment ${f.commentId ?? '(review — reply on the PR)'}  ${f.author}  ${where}  [${f.reason}]`);
      log(`    ${f.excerpt}`);
    }
    return 0;
  }

  log(renderSummary(result));
  return result.unanswered.length === 0 ? 0 : 1;
}

// Only run the CLI when executed directly, never when imported by tests.
if (process.argv[1] && process.argv[1].endsWith('pr-triage.js')) {
  runCli(process.argv.slice(2))
    .then((code) => { process.exitCode = code; })
    .catch((err) => {
      console.error(err.message);
      process.exitCode = 2;
    });
}
```

Move the two `import` statements to the top of the file — ESM requires imports at module scope.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/prTriage.test.ts`
Expected: PASS — all Task 1–5 tests.

- [ ] **Step 5: Commit**

```bash
git add dev-tools/pr-triage.js tests/unit/prTriage.test.ts
git commit -m "feat(pr-triage): audit, list and reply CLI verbs"
```

---

### Task 6: The blocking CI check

**Files:**
- Create: `.github/workflows/pr-comment-response.yml`

**Interfaces:**
- Consumes: `node dev-tools/pr-triage.js audit --pr <N>` from Task 5 (exit 0 clean / 1 unanswered), and its stdout as markdown.
- Produces: a check run named exactly `pr-comment-response` on the PR head SHA.

- [ ] **Step 1: Write the workflow**

Create `.github/workflows/pr-comment-response.yml`:

```yaml
name: PR Comment Response

# Every review finding on a PR must carry a visible verdict reply — agreed
# (naming the commit), pushed back, or deliberately ignored. This job only
# AUDITS: it reads the PR and publishes a check run. It never writes a reply.
# See docs/superpowers/specs/2026-07-27-pr-comment-response-gate-design.md

on:
  pull_request_review_comment:
    types: [created]
  pull_request_review:
    types: [submitted]
  issue_comment:
    types: [created]
  # pull_request_target, not pull_request: a fork PR's `pull_request` token is
  # read-only and cannot create a check run, so the gate would never report on
  # forks. This job never checks out the repository and never executes PR code —
  # it reads the API and writes a check run — so the usual pull_request_target
  # risk does not apply.
  pull_request_target:
    types: [opened, synchronize, reopened, ready_for_review]

permissions:
  contents: read
  pull-requests: read
  checks: write

concurrency:
  group: pr-comment-response-${{ github.event.pull_request.number || github.event.issue.number }}
  cancel-in-progress: true

jobs:
  audit:
    # issue_comment fires for issues too; only PRs have a .pull_request key.
    if: github.event_name != 'issue_comment' || github.event.issue.pull_request
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - name: Resolve PR number
        id: pr
        env:
          NUMBER: ${{ github.event.pull_request.number || github.event.issue.number }}
        run: |
          if [ -z "$NUMBER" ]; then
            echo "Could not resolve a PR number from event ${{ github.event_name }}." >&2
            exit 1
          fi
          echo "number=$NUMBER" >> "$GITHUB_OUTPUT"

      # Only the auditor script is needed, so fetch it from the BASE repo at the
      # default branch rather than checking out the PR — a fork must not be able
      # to swap out the script that grades it.
      - name: Fetch the auditor from the base branch
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          mkdir -p dev-tools
          gh api "repos/${{ github.repository }}/contents/dev-tools/pr-triage.js?ref=${{ github.event.repository.default_branch }}" \
            --jq '.content' | base64 --decode > dev-tools/pr-triage.js

      - uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Audit replies
        id: audit
        continue-on-error: true
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          set +e
          node dev-tools/pr-triage.js audit --pr "${{ steps.pr.outputs.number }}" > summary.md 2>&1
          echo "exit_code=$?" >> "$GITHUB_OUTPUT"
          cat summary.md

      - name: Publish the check run
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          HEAD_SHA=$(gh api "repos/${{ github.repository }}/pulls/${{ steps.pr.outputs.number }}" --jq .head.sha)
          if [ "${{ steps.audit.outputs.exit_code }}" = "0" ]; then
            CONCLUSION=success
            TITLE="All review findings have a verdict reply"
          else
            CONCLUSION=failure
            TITLE="Review findings are waiting for a verdict reply"
          fi
          jq -n \
            --arg name "pr-comment-response" \
            --arg head_sha "$HEAD_SHA" \
            --arg conclusion "$CONCLUSION" \
            --arg title "$TITLE" \
            --rawfile summary summary.md \
            '{name: $name, head_sha: $head_sha, status: "completed",
              conclusion: $conclusion,
              output: {title: $title, summary: $summary}}' \
            | gh api --method POST "repos/${{ github.repository }}/check-runs" --input -

      - name: Fail the job when findings are unanswered
        if: steps.audit.outputs.exit_code != '0'
        run: |
          echo "::error::Some review findings have no verdict reply. See the pr-comment-response check."
          exit 1
```

- [ ] **Step 2: Validate the YAML parses**

Run:
```bash
node -e "
const {readFileSync}=require('node:fs');
const s=readFileSync('.github/workflows/pr-comment-response.yml','utf8');
if(!s.includes('pr-comment-response')) throw new Error('check name missing');
console.log('workflow file present, check name present');
"
npx yaml-lint .github/workflows/pr-comment-response.yml 2>/dev/null || python3 -c "
import yaml,sys
d=yaml.safe_load(open('.github/workflows/pr-comment-response.yml'))
assert 'jobs' in d and 'audit' in d['jobs'], 'audit job missing'
print('YAML parses; jobs:', list(d['jobs']))
"
```
Expected: prints `YAML parses; jobs: ['audit']`.

- [ ] **Step 3: Verify the audit verb runs against a real PR**

Run: `node dev-tools/pr-triage.js audit --pr 657`
Expected: exit code 1, and a table listing the five unanswered bot findings on PR #657 (`chatgpt-codex-connector`, `Copilot` ×3, `coderabbitai`). Confirm with `echo $?`.

This is the end-to-end proof that the classifier reads real GitHub data correctly — the fixtures in Tasks 1–5 only prove the logic.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/pr-comment-response.yml
git commit -m "ci: block merge while review findings lack a verdict reply"
```

---

### Task 7: Wire the gate into the /dev workflow and document it

**Files:**
- Modify: `.claude/skills/development-workflow.md` (Phase 9d Step 3, Phase 9e criteria, Quick Reference table)
- Modify: `.claude/workflows/dev-build-and-ship.js:350-370` (9d prompt) and `:388-398` (9e done gate)
- Modify: `dev-tools/README.md`

**Interfaces:**
- Consumes: the CLI from Task 5 and the check name from Task 6.
- Produces: no code interface — this is the behavioural wiring that makes the `/dev` path use the gate.

- [ ] **Step 1: Update Phase 9d Step 3 in the skill**

In `.claude/skills/development-workflow.md`, replace the "Classify and act on each row" bullets with:

```markdown
**Step 3 — Reply to every finding, then classify and act:**

Every inline finding gets a **threaded verdict reply on the PR**. A fix is an
`agreed` reply naming the commit — it is not a substitute for replying. The
reasoning must live on the PR, not only in a local artifact:

```bash
node dev-tools/pr-triage.js list --pr <PR>     # unanswered findings + their comment ids
node dev-tools/pr-triage.js reply --pr <PR> --comment <id> \
  --verdict agreed --commit <sha> --rationale "what changed and why"
```

- **Bug / security / correctness / contract drift** → Fix it, commit naming the
  source, then reply `--verdict agreed --commit <sha>`.
- **Refactor / suggestion you are not taking** → reply `--verdict pushed-back`
  with the reason (e.g. it contradicts a documented CLAUDE.md convention).
- **Nit / informational** → reply `--verdict ignored` with one line on why.

`node dev-tools/pr-triage.js audit --pr <PR>` must exit 0 before 9e. The
`pr-comment-response` check enforces the same rule in CI.
```

- [ ] **Step 2: Update the Phase 9e done criteria in the skill**

In the 9e bullet list, add as the first bullet:

```markdown
- `node dev-tools/pr-triage.js audit --pr <PR>` exits 0 — every finding from a
  bot or a human carries a verdict reply visible on the PR.
```

And in the Quick Reference table, change the `9d Comment triage` row's command
column to:

```markdown
| 9d Comment triage | `dev-tools/pr-triage.js list/reply` + `audit` exits 0 + `gh api .../comments` | Never — green CI does NOT exempt |
```

- [ ] **Step 3: Update the autonomous workflow prompts**

In `.claude/workflows/dev-build-and-ship.js`, in the Phase 9d prompt, replace
bullet 4 with:

```js
      '4. Reply to EVERY finding on the PR with node dev-tools/pr-triage.js reply --pr ' + PR + ' --comment <id> --verdict <agreed|pushed-back|ignored> [--commit <sha>] --rationale "<why>". A fix is an "agreed" reply naming the commit, NOT a substitute for replying. Use `node dev-tools/pr-triage.js list --pr ' + PR + '` to enumerate unanswered findings and their comment ids.\n' +
      '4b. Then run: node dev-tools/pr-triage.js audit --pr ' + PR + ' — it must exit 0 before you return. If it exits 1, you have missed a finding.\n' +
```

And in the Phase 9e done-gate prompt, add as the first bullet:

```js
      `- node dev-tools/pr-triage.js audit --pr ${PR} exits 0 (every finding has a verdict reply on the PR).\n` +
```

- [ ] **Step 4: Document the tool**

Append to `dev-tools/README.md`:

```markdown
## `pr-triage.js` — every review finding gets a visible answer

Enforces that each finding on a PR (AI bot or human) carries a threaded reply
saying whether we agreed, pushed back, or deliberately ignored it. The
`pr-comment-response` GitHub check runs `audit` and blocks merge while anything
is unanswered.

```bash
node dev-tools/pr-triage.js list  --pr 657   # unanswered findings + comment ids
node dev-tools/pr-triage.js reply --pr 657 --comment 3649239869 \
  --verdict agreed --commit abc1234 --rationale "Retained failed writes until import checks them."
node dev-tools/pr-triage.js audit --pr 657   # exit 0 clean, 1 unanswered
```

Verdicts: `agreed` (requires `--commit`), `pushed-back`, `ignored`. A reply
counts only from a non-bot maintainer, and an `agreed` reply must cite a commit
that is actually on the PR. Resolving a thread without replying does **not**
count — silent resolution is the failure mode this gate exists to catch.
```

- [ ] **Step 5: Verify the wiring is consistent**

Run:
```bash
grep -c "pr-triage" .claude/skills/development-workflow.md .claude/workflows/dev-build-and-ship.js dev-tools/README.md
node --check dev-tools/pr-triage.js && node -e "
import('./.claude/workflows/dev-build-and-ship.js').catch(e=>{
  if(!/agent|phase|export/.test(String(e))) throw e;
});
console.log('workflow script still parses');
"
```
Expected: each file reports at least 1 match; `dev-build-and-ship.js` still parses.

- [ ] **Step 6: Commit**

```bash
git add .claude/skills/development-workflow.md .claude/workflows/dev-build-and-ship.js dev-tools/README.md
git commit -m "docs(workflow): require a verdict reply per finding in Phase 9d"
```

---

## Verification (Phase 8)

```bash
npm run test -- tests/unit/prTriage.test.ts   # the new suite
npm run test                                   # full unit suite, no regressions
npm run typecheck
npm run lint
npm run build
node dev-tools/pr-triage.js audit --pr 657     # real-data smoke test, expect exit 1
```

**E2E:** justified exception — this change adds CI tooling and a developer CLI. It touches no route, page, dialog, edge function, or RPC, so there is no user-facing flow for a Playwright spec to drive. `npm run test:db` is likewise inapplicable: no migration or SQL function changes.

## Self-review notes

- **Spec coverage:** module (T1–T5), workflow (T6), `/dev` wiring + docs (T7), commit-SHA verification (T3 `citesKnownCommit`, wired in T5), bot typing via `__typename` (T3 `isBotActor`), PR-number resolution across four event shapes (T6 `Resolve PR number` step). The spec's human follow-up — adding `pr-comment-response` to branch protection — is deliberately not a task; it cannot be done from a PR and is reported at the end.
- **Naming consistency:** `classifyThreads` takes `{threads, reviews, prAuthor, knownShas}` in T3 and is called with exactly those keys in T5. `renderSummary` consumes the `{unanswered, answered, skipped}` shape T3 produces. The check name `pr-comment-response` is identical in T6, T7 and the spec.
- **Known ordering constraint:** T5 appends `import` statements that ESM requires at module scope — its Step 3 says so explicitly, and `node --check` in T7 Step 5 catches it if missed.
