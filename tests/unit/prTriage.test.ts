import { describe, it, expect } from 'vitest';
import { VERDICTS, composeReply, parseVerdict, classifyThreads, isBotActor, renderSummary, runCli } from '../../dev-tools/pr-triage.js';

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

  it('rejects a marker-form reply whose rationale explains nothing', () => {
    expect(parseVerdict('<!-- pr-triage: ignored -->\n**⏭️ Ignored** — ok')).toBeNull();
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

const PR_AUTHOR = 'toyiyo';
const REPO = 'toyiyo/nimble-pnl';
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
        submittedAt: '2026-07-27T10:00:00Z',
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

  // --- Review-level correlation. Without these rules one maintainer reply
  // would silently satisfy every simultaneous CHANGES_REQUESTED at once.
  const reviewFrom = (login, state, at, body = 'Please rework this section.') => ({
    id: `R_${login}_${at}`,
    state,
    submittedAt: at,
    author: { login, __typename: login === 'a-human' ? 'User' : 'Bot' },
    authorAssociation: login === 'a-human' ? 'MEMBER' : 'NONE',
    body,
  });

  const verdictReview = (at, body) => ({
    id: `R_ANSWER_${at}`,
    state: 'COMMENTED',
    submittedAt: at,
    author: { login: PR_AUTHOR, __typename: 'User' },
    authorAssociation: 'OWNER',
    body,
  });

  it('answers only the reviewer a verdict reply names, not every open review', () => {
    const r = classifyThreads({
      reviews: [
        reviewFrom('coderabbitai', 'CHANGES_REQUESTED', '2026-07-27T10:00:00Z'),
        reviewFrom('Copilot', 'CHANGES_REQUESTED', '2026-07-27T10:01:00Z'),
        verdictReview(
          '2026-07-27T11:00:00Z',
          'Pushed back — @coderabbitai the bound is exclusive, the loop is correct.',
        ),
      ],
      prAuthor: PR_AUTHOR,
    });
    expect(r.answered.map((f) => f.author)).toEqual(['coderabbitai']);
    expect(r.unanswered.map((f) => f.author)).toEqual(['Copilot']);
  });

  it('does not accept a verdict reply submitted before the review it would answer', () => {
    const r = classifyThreads({
      reviews: [
        verdictReview('2026-07-27T09:00:00Z', 'Agreed — @coderabbitai fixed already in abc1234.'),
        reviewFrom('coderabbitai', 'CHANGES_REQUESTED', '2026-07-27T10:00:00Z'),
      ],
      prAuthor: PR_AUTHOR,
    });
    expect(r.unanswered).toHaveLength(1);
    expect(r.unanswered[0].author).toBe('coderabbitai');
  });

  it('matches the reviewer login with or without a leading @', () => {
    const r = classifyThreads({
      reviews: [
        reviewFrom('coderabbitai', 'CHANGES_REQUESTED', '2026-07-27T10:00:00Z'),
        verdictReview('2026-07-27T11:00:00Z', 'Ignored - coderabbitai flagged a style nit here.'),
      ],
      prAuthor: PR_AUTHOR,
    });
    expect(r.unanswered).toHaveLength(0);
  });

  it('stops blocking once the reviewer itself re-reviews and drops the request', () => {
    const r = classifyThreads({
      reviews: [
        reviewFrom('coderabbitai', 'CHANGES_REQUESTED', '2026-07-27T10:00:00Z'),
        reviewFrom('coderabbitai', 'APPROVED', '2026-07-27T12:00:00Z', 'All addressed.'),
      ],
      prAuthor: PR_AUTHOR,
    });
    expect(r.unanswered).toHaveLength(0);
  });

  it('CRITICAL: a later COMMENTED review does not dismiss a change request', () => {
    // GitHub only clears CHANGES_REQUESTED on APPROVED or DISMISSED. Treating a
    // routine follow-up COMMENTED review as clearing it would silently drop a
    // blocking finding — bots post COMMENTED reviews constantly.
    const r = classifyThreads({
      reviews: [
        reviewFrom('coderabbitai', 'CHANGES_REQUESTED', '2026-07-27T10:00:00Z'),
        reviewFrom('coderabbitai', 'COMMENTED', '2026-07-27T12:00:00Z', 'One more note.'),
      ],
      prAuthor: PR_AUTHOR,
    });
    expect(r.unanswered).toHaveLength(1);
  });

  it('CRITICAL: a review-level agreed verdict must cite a real commit too', () => {
    const r = classifyThreads({
      reviews: [
        reviewFrom('coderabbitai', 'CHANGES_REQUESTED', '2026-07-27T10:00:00Z'),
        verdictReview('2026-07-27T11:00:00Z', 'Agreed — @coderabbitai fixed in `deadbee`.'),
      ],
      prAuthor: PR_AUTHOR,
      knownShas: SHAS,
    });
    expect(r.unanswered).toHaveLength(1);
    expect(r.unanswered[0].reason).toBe('cites an unknown commit');
  });

  it('accepts a review-level agreed verdict citing a real commit', () => {
    const r = classifyThreads({
      reviews: [
        reviewFrom('coderabbitai', 'CHANGES_REQUESTED', '2026-07-27T10:00:00Z'),
        verdictReview('2026-07-27T11:00:00Z', 'Agreed — @coderabbitai fixed in `abc1234`.'),
      ],
      prAuthor: PR_AUTHOR,
      knownShas: SHAS,
    });
    expect(r.unanswered).toHaveLength(0);
  });

  it('keeps blocking when the reviewer re-requests changes after approving', () => {
    const r = classifyThreads({
      reviews: [
        reviewFrom('coderabbitai', 'APPROVED', '2026-07-27T10:00:00Z', 'Looks fine.'),
        reviewFrom('coderabbitai', 'CHANGES_REQUESTED', '2026-07-27T12:00:00Z'),
      ],
      prAuthor: PR_AUTHOR,
    });
    expect(r.unanswered).toHaveLength(1);
  });

  it('does not let a bot verdict answer a CHANGES_REQUESTED review', () => {
    const botAnswer = {
      ...verdictReview('2026-07-27T11:00:00Z', 'Agreed — @a-human this is now handled in abc1234.'),
      author: { login: 'Copilot', __typename: 'User' },
      authorAssociation: 'NONE',
    };
    const r = classifyThreads({
      reviews: [reviewFrom('a-human', 'CHANGES_REQUESTED', '2026-07-27T10:00:00Z'), botAnswer],
      prAuthor: PR_AUTHOR,
    });
    expect(r.unanswered).toHaveLength(1);
  });

  it('handles hyphenated reviewer logins without throwing', () => {
    // Most reviewer bots are hyphenated (chatgpt-codex-connector,
    // copilot-pull-request-reviewer), so a regex that throws here takes the
    // whole gate down rather than reporting findings.
    const r = classifyThreads({
      reviews: [
        {
          id: 'R1',
          state: 'CHANGES_REQUESTED',
          submittedAt: '2026-07-27T10:00:00Z',
          author: { login: 'chatgpt-codex-connector', __typename: 'User' },
          authorAssociation: 'NONE',
          body: 'Please rework this.',
        },
        verdictReview(
          '2026-07-27T11:00:00Z',
          'Pushed back — @chatgpt-codex-connector the guard is correct as written.',
        ),
      ],
      prAuthor: PR_AUTHOR,
    });
    expect(r.unanswered).toHaveLength(0);
    expect(r.answered).toHaveLength(1);
  });

  it('tolerates missing threads, reviews and comment nodes', () => {
    expect(classifyThreads({ prAuthor: PR_AUTHOR }).unanswered).toHaveLength(0);
    expect(
      classifyThreads({ threads: [thread([])], prAuthor: PR_AUTHOR }).unanswered,
    ).toHaveLength(0);
  });
});

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

  it('escapes backslashes before pipes so escaping cannot be spoofed', () => {
    // Escaping | -> \| without first escaping \ lets a body ending in a
    // backslash produce \\| , which renders as a literal backslash followed by
    // a live column separator.
    const md = renderSummary({
      unanswered: [{
        kind: 'thread', author: 'bot', path: 'a.ts', line: 1,
        excerpt: 'trailing backslash \\ | then more',
        reason: 'no reply',
      }],
      answered: [], skipped: [],
    });
    const row = md.split('\n').find((l) => l.includes('bot')) ?? '';
    expect(row.split(/(?<!\\)\|/u).filter((c) => c.trim()).length).toBe(4);
  });

  it('escapes pipes so a finding cannot break the summary table', () => {
    // CodeRabbit bodies routinely contain "| Major | Quick win |" badge rows;
    // unescaped they split the row into bogus columns.
    const md = renderSummary({
      unanswered: [{
        kind: 'thread',
        author: 'coderabbitai',
        path: 'src/a.ts',
        line: 1,
        excerpt: '_Correctness_ | _Major_ | _Quick win_ toast ignores failures',
        reason: 'no reply',
      }],
      answered: [],
      skipped: [],
    });
    const row = md.split('\n').find((l) => l.includes('coderabbitai')) ?? '';
    // Split on UNESCAPED pipes only — that is what the markdown renderer sees.
    expect(row.split(/(?<!\\)\|/u).filter((c) => c.trim()).length).toBe(4);
    expect(row).toContain('\\|');
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

/** Minimal fake io: records output, serves canned GitHub responses. */
function fakeIo({ threads = [], reviews = [], commits = [], commitsError, onPost } = {}) {
  const out: string[] = [];
  return {
    out,
    log: (m: unknown) => out.push(String(m)),
    error: (m: unknown) => out.push(String(m)),
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
    gh: async (args: string[]) => {
      if (args.some((a) => a.includes('/commits'))) {
        if (commitsError) throw new Error(commitsError);
        return commits;
      }
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
    const code = await runCli(['audit', '--pr', '1', '--repo', REPO], io);
    expect(code).toBe(0);
    expect(io.out.join('\n')).toMatch(/every finding has a verdict reply/i);
  });

  it('exits 1 and prints the finding when one is unanswered', async () => {
    const io = fakeIo({ threads: [BOT_FINDING] });
    const code = await runCli(['audit', '--pr', '1', '--repo', REPO], io);
    expect(code).toBe(1);
    expect(io.out.join('\n')).toContain('coderabbitai');
    expect(io.out.join('\n')).toContain('src/a.ts:3');
  });

  it('exits 2 when --pr is missing', async () => {
    const io = fakeIo();
    expect(await runCli(['audit'], io)).toBe(2);
    expect(io.out.join('\n')).toMatch(/--pr/);
  });

  it('fails closed when the commits fetch fails, rather than skipping verification', async () => {
    // A gate that cannot verify must not report success: skipping the check
    // would let an "agreed" reply citing an unverifiable commit pass.
    const io = fakeIo({ commitsError: 'rate limited' });
    const code = await runCli(['audit', '--pr', '1', '--repo', REPO], io);
    expect(code).toBe(2);
    expect(io.out.join('\n')).toMatch(/could not fetch pr commits.*rate limited/i);
  });

  it('fails closed when GraphQL returns no pull request data', async () => {
    const io = fakeIo();
    io.graphql = async () => ({ data: { repository: null } });
    const code = await runCli(['audit', '--pr', '1', '--repo', REPO], io);
    expect(code).toBe(2);
    expect(io.out.join('\n')).toMatch(/could not read pull request/i);
  });

  it('fails closed when GraphQL reports errors', async () => {
    const io = fakeIo();
    io.graphql = async () => ({ errors: [{ message: 'Bad credentials' }] });
    const code = await runCli(['audit', '--pr', '1', '--repo', REPO], io);
    expect(code).toBe(2);
    expect(io.out.join('\n')).toMatch(/bad credentials/i);
  });

  it('fails closed when a thread has more comments than one page', async () => {
    const io = fakeIo({
      threads: [{
        ...BOT_FINDING,
        comments: { ...BOT_FINDING.comments, pageInfo: { hasNextPage: true, endCursor: 'x' } },
      }],
    });
    const code = await runCli(['audit', '--pr', '1', '--repo', REPO], io);
    expect(code).toBe(2);
    expect(io.out.join('\n')).toMatch(/more replies than.*could read/i);
  });

  it('follows pagination across review pages', async () => {
    let reviewPages = 0;
    const io = fakeIo();
    io.graphql = async (query: string) => {
      if (!query.includes('reviews(first: 100, after:')) {
        return {
          data: {
            repository: {
              pullRequest: {
                author: { login: 'toyiyo' },
                reviewThreads: { nodes: [], pageInfo: { hasNextPage: false } },
              },
            },
          },
        };
      }
      reviewPages += 1;
      return {
        data: {
          repository: {
            pullRequest: {
              reviews: {
                nodes: reviewPages === 1
                  ? [{ id: 'R1', state: 'COMMENTED', submittedAt: '2026-07-27T10:00:00Z', author: { login: 'coderabbitai', __typename: 'Bot' }, authorAssociation: 'NONE', body: 'note' }]
                  : [{ id: 'R2', state: 'CHANGES_REQUESTED', submittedAt: '2026-07-27T11:00:00Z', author: { login: 'a-human', __typename: 'User' }, authorAssociation: 'MEMBER', body: 'Needs rework.' }],
                pageInfo: { hasNextPage: reviewPages === 1, endCursor: 'c1' },
              },
            },
          },
        },
      };
    };
    const code = await runCli(['audit', '--pr', '1', '--repo', REPO], io);
    expect(reviewPages).toBe(2); // the second page must actually be requested
    expect(code).toBe(1); // and its CHANGES_REQUESTED must be seen
    expect(io.out.join('\n')).toContain('a-human');
  });

  it('rejects --pr with no value instead of silently targeting PR #1', async () => {
    const io = fakeIo();
    expect(await runCli(['audit', '--pr', '--repo', REPO], io)).toBe(2);
    expect(io.out.join('\n')).toMatch(/--pr/);
  });

  it('rejects a non-numeric --pr', async () => {
    const io = fakeIo();
    expect(await runCli(['audit', '--pr', 'abc', '--repo', REPO], io)).toBe(2);
  });
});

describe('pr-triage: runCli list', () => {
  it('tells review-level findings to use --review, not --comment', async () => {
    const io = fakeIo({
      reviews: [{
        id: 'R1', state: 'CHANGES_REQUESTED', submittedAt: '2026-07-27T10:00:00Z',
        author: { login: 'a-human', __typename: 'User' },
        authorAssociation: 'MEMBER', body: 'Needs rework.',
      }],
    });
    await runCli(['list', '--pr', '1', '--repo', REPO], io);
    const out = io.out.join('\n');
    expect(out).toContain('--review a-human');
    expect(out).not.toMatch(/--comment (null|undefined)/);
  });

  it('prints the comment id needed to reply', async () => {
    const io = fakeIo({ threads: [BOT_FINDING] });
    const code = await runCli(['list', '--pr', '1', '--repo', REPO], io);
    expect(code).toBe(0);
    expect(io.out.join('\n')).toContain('99');
  });
});

describe('pr-triage: runCli reply', () => {
  it('posts a composed reply to the thread and resolves it', async () => {
    const posted: string[][] = [];
    const io = fakeIo({
      threads: [BOT_FINDING],
      onPost: (args: string[]) => { posted.push(args); return {}; },
    });
    const code = await runCli(
      ['reply', '--pr', '1', '--repo', REPO, '--comment', '99', '--verdict', 'pushed-back',
       '--rationale', 'The bound is exclusive; this is correct.'],
      io,
    );
    expect(code).toBe(0);
    const flat = posted.flat().join(' ');
    expect(flat).toContain('/pulls/1/comments/99/replies');
    expect(flat).toContain('↩️ Pushed back');
  });

  it('refuses an agreed reply with no commit, without posting', async () => {
    const posted: string[][] = [];
    const io = fakeIo({ onPost: (args: string[]) => { posted.push(args); return {}; } });
    const code = await runCli(
      ['reply', '--pr', '1', '--repo', REPO, '--comment', '99', '--verdict', 'agreed',
       '--rationale', 'Fixed it in the follow-up.'],
      io,
    );
    expect(code).toBe(2);
    expect(posted).toHaveLength(0);
    expect(io.out.join('\n')).toMatch(/commit/i);
  });

  it('answers a CHANGES_REQUESTED review with a PR-level review naming the reviewer', async () => {
    const posted: string[][] = [];
    const io = fakeIo({ onPost: (args: string[]) => { posted.push(args); return {}; } });
    const code = await runCli(
      ['reply', '--pr', '1', '--repo', REPO, '--review', 'a-human', '--verdict', 'pushed-back',
       '--rationale', 'The guard is correct as written.'],
      io,
    );
    expect(code).toBe(0);
    const flat = posted.flat().join(' ');
    expect(flat).toContain('/pulls/1/reviews');
    expect(flat).toContain('event=COMMENT');
    // Naming the reviewer is what lets classifyThreads tell which review this answers.
    expect(flat).toContain('@a-human');
  });

  it('does not double up the @ when the reviewer is passed with one', async () => {
    const posted: string[][] = [];
    const io = fakeIo({ onPost: (args: string[]) => { posted.push(args); return {}; } });
    await runCli(
      ['reply', '--pr', '1', '--repo', REPO, '--review', '@a-human', '--verdict', 'ignored',
       '--rationale', 'Style nit, house convention differs.'],
      io,
    );
    expect(posted.flat().join(' ')).not.toContain('@@');
  });

  it('exits 2 when reply is given BOTH --comment and --review', async () => {
    // Silently preferring one path posts the answer in the wrong place.
    const posted: string[][] = [];
    const io = fakeIo({ onPost: (args: string[]) => { posted.push(args); return {}; } });
    const code = await runCli(
      ['reply', '--pr', '1', '--repo', REPO, '--comment', '99', '--review', 'a-human',
       '--verdict', 'ignored', '--rationale', 'Style nit, house convention differs.'],
      io,
    );
    expect(code).toBe(2);
    expect(posted).toHaveLength(0);
  });

  it('still succeeds when the post-reply thread lookup fails', async () => {
    // The reply is already public at that point; failing the command would
    // invite a duplicate re-run.
    const io = fakeIo({ threads: [BOT_FINDING] });
    const realGraphql = io.graphql;
    let calls = 0;
    io.graphql = async (...args: unknown[]) => {
      calls += 1;
      if (calls > 0 && args[0] && String(args[0]).includes('reviewThreads')) {
        throw new Error('secondary rate limit');
      }
      return realGraphql(...args);
    };
    const code = await runCli(
      ['reply', '--pr', '1', '--repo', REPO, '--comment', '99', '--verdict', 'ignored',
       '--rationale', 'Style nit, house convention differs.'],
      io,
    );
    expect(code).toBe(0);
    expect(io.out.join('\n')).toMatch(/reply posted/i);
  });

  it('exits 2 when reply is given neither --comment nor --review', async () => {
    const io = fakeIo();
    const code = await runCli(
      ['reply', '--pr', '1', '--repo', REPO, '--verdict', 'ignored',
       '--rationale', 'Style nit, house convention differs.'],
      io,
    );
    expect(code).toBe(2);
    expect(io.out.join('\n')).toMatch(/--comment.*--review/s);
  });

  it('exits 2 on an unknown verb', async () => {
    const io = fakeIo();
    expect(await runCli(['frobnicate'], io)).toBe(2);
  });
});
