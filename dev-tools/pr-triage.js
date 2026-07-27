#!/usr/bin/env node
/**
 * pr-triage — enforce that every PR review finding carries a visible verdict reply.
 *
 * Pure logic (VERDICTS, composeReply, parseVerdict, classifyThreads, renderSummary)
 * performs no I/O so it can be unit-tested. All GitHub access lives in the CLI verbs.
 *
 * See docs/superpowers/specs/2026-07-27-pr-comment-response-gate-design.md
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

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
      // Hold the marker path to the same floor as the hand-typed one: our own
      // composeReply enforces it, but a marker reply written by hand must not
      // pass the gate with a rationale like "ok".
      const rationale = stripToRationale(body.replace(spec.marker, ''), spec.display);
      return rationale.length >= MIN_RATIONALE_LENGTH ? { verdict: spec.key, rationale } : null;
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

    const finding = makeFinding('thread', {
      id: t.id,
      commentId: root.databaseId,
      author: root.author?.login,
      path: t.path ?? '',
      line: t.line ?? null,
      body: root.body,
    });

    // A note the PR author left for reviewers is not a finding against us.
    if (sameUser(root.author?.login, prAuthor)) {
      result.skipped.push(finding);
      continue;
    }

    const reason = firstUnansweredReason(comments.slice(1), knownShas);
    if (reason) result.unanswered.push({ ...finding, reason });
    else result.answered.push(finding);
  }

  // GitHub tracks a request for changes per reviewer, not per review: a reviewer
  // who re-reviews and drops the request is no longer blocking. So collapse to
  // each reviewer's latest review before deciding what still needs an answer.
  for (const r of latestReviewPerAuthor(reviews)) {
    if (!BLOCKING_REVIEW_STATES.has(r?.state)) continue;
    if (sameUser(r.author?.login, prAuthor)) continue;

    const finding = makeFinding('review', { id: r.id, author: r.author?.login, body: r.body });
    if (isReviewAnswered(r, reviews)) result.answered.push(finding);
    else result.unanswered.push({ ...finding, reason: 'no reply' });
  }

  return result;
}

/**
 * Reduce a flat review list to each author's most recent review, mirroring how
 * GitHub itself decides whether a reviewer is currently requesting changes.
 * @param {object[]} reviews
 * @returns {object[]}
 */
function latestReviewPerAuthor(reviews) {
  const latest = new Map();
  for (const r of reviews) {
    const login = r?.author?.login;
    if (!login) continue;
    const seen = latest.get(login.toLowerCase());
    // Equal/absent timestamps fall back to list order, which GitHub returns
    // chronologically — so the last one wins, as it should.
    if (!seen || submittedAtMs(r) >= submittedAtMs(seen)) latest.set(login.toLowerCase(), r);
  }
  return [...latest.values()];
}

function submittedAtMs(review) {
  const t = Date.parse(review?.submittedAt ?? '');
  return Number.isNaN(t) ? 0 : t;
}

/**
 * A CHANGES_REQUESTED review is answered only by a LATER review that carries a
 * verdict from a non-bot maintainer AND names the reviewer it answers.
 *
 * Both conditions matter. Without the name check, one reply would silently
 * satisfy every bot that requested changes at the same time — the exact hole
 * this gate exists to close. Without the ordering check, a verdict written
 * before the finding existed would pre-answer it.
 *
 * @param {object} review the CHANGES_REQUESTED review needing an answer
 * @param {object[]} allReviews every review on the PR
 * @returns {boolean}
 */
function isReviewAnswered(review, allReviews) {
  const target = (review.author?.login ?? '').toLowerCase();
  if (!target) return false;
  const askedAt = submittedAtMs(review);

  return allReviews.some((other) => {
    if (other === review) return false;
    if (isBotActor(other.author)) return false;
    if (!MAINTAINER_ASSOCIATIONS.has(other.authorAssociation)) return false;
    if (!parseVerdict(other.body)) return false;
    if (submittedAtMs(other) < askedAt) return false;
    return mentionsLogin(other.body, target);
  });
}

/** True when the body names this reviewer, with or without a leading `@`. */
function mentionsLogin(body, login) {
  const escaped = login.replace(/[.*+?^${}()|[\]\\-]/gu, '\\$&');
  return new RegExp(`(^|[^\\w/-])@?${escaped}([^\\w-]|$)`, 'iu').test(body ?? '');
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
  const shaPattern = new RegExp(`\\b[0-9a-f]{${MIN_SHA_PREFIX},40}\\b`, 'gi');
  const cited = body.match(shaPattern) ?? [];
  return cited.some((c) =>
    knownShas.some((sha) => sha.toLowerCase().startsWith(c.toLowerCase())),
  );
}

/** Shape a thread or review into the common finding record the classifier tracks. */
function makeFinding(kind, { id, commentId = null, author, path = '', line = null, body }) {
  return { kind, id, commentId, author: author ?? 'unknown', path, line, excerpt: excerpt(body) };
}

function sameUser(a, b) {
  return Boolean(a) && Boolean(b) && a.toLowerCase() === b.toLowerCase();
}

function excerpt(body, max = 120) {
  const flat = (body ?? '').replace(/\s+/gu, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

/** Render a finding's file:line as markdown, or a fallback for review-level findings. */
function formatLocation(f) {
  if (!f.path) return '_PR review_';
  const line = f.line ? `:${f.line}` : '';
  return `\`${f.path}${line}\``;
}

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
    .map((f) => `| ${f.author} | ${formatLocation(f)} | ${f.reason} | ${f.excerpt || ''} |`)
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
        nodes { id state body submittedAt authorAssociation author { login __typename } }
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

  // Independent reads — run concurrently rather than paying for both round trips in series.
  let commitsFetchFailed = false;
  const [{ threads, reviews, prAuthor }, commits] = await Promise.all([
    fetchPr({ owner, repo, pr, graphql }),
    gh([`repos/${owner}/${repo}/pulls/${pr}/commits`, '--paginate']).catch((e) => {
      // Verification is skipped rather than failing the gate, but that must be
      // visible — a silent skip here would reopen the exact loophole ("agreed"
      // replies citing an unverifiable commit) this check exists to close.
      commitsFetchFailed = true;
      error(`Warning: could not fetch PR commits to verify "agreed" replies (${e.message}). ` +
        'Commit-citation checks are skipped for this run.');
      return undefined;
    }),
  ]);
  if (!commitsFetchFailed && Array.isArray(commits) === false) {
    error('Warning: PR commits fetch returned an unexpected shape; commit-citation checks are skipped for this run.');
  }
  const knownShas = Array.isArray(commits) ? commits.map((c) => c.sha).filter(Boolean) : undefined;

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
