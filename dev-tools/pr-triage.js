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
