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

/** Minimal fake io: records output, serves canned GitHub responses. */
function fakeIo({ threads = [], reviews = [], commits = [], onPost } = {}) {
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
    const posted: string[][] = [];
    const io = fakeIo({
      threads: [BOT_FINDING],
      onPost: (args: string[]) => { posted.push(args); return {}; },
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
    const posted: string[][] = [];
    const io = fakeIo({ onPost: (args: string[]) => { posted.push(args); return {}; } });
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
