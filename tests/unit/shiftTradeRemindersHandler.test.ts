import { describe, it, expect, vi } from 'vitest';
import {
  runShiftTradeReminders,
  RUN_BUDGET_MS,
  MAX_PUSH_TARGETS,
  CANDIDATE_LIMIT,
  MAX_CANDIDATE_PAGES,
  type ShiftTradeRemindersDeps,
  type ReminderCandidateRow,
  type UnclaimedRecipientRow,
} from '../../supabase/functions/_shared/shiftTradeRemindersHandler';

// Friday 2026-09-25 10:00 in Chicago.
const START_MS = Date.parse('2026-09-25T15:00:00Z');

function candidate(over: Partial<ReminderCandidateRow> = {}): ReminderCandidateRow {
  return {
    shift_trade_id: 'trade-1',
    restaurant_id: 'rest-1',
    stage: '24h',
    // Friday 17:00 to 23:00 in Chicago.
    start_time: '2026-09-25T22:00:00Z',
    end_time: '2026-09-26T04:00:00Z',
    position: 'Server',
    is_published: true,
    offered_by_name: 'Maria Lopez',
    restaurant_name: 'Blue Fig',
    restaurant_timezone: 'America/Chicago',
    ...over,
  };
}

const users = (n: number): string[] => Array.from({ length: n }, (_, i) => `user-${i}`);

const RECIPIENTS: UnclaimedRecipientRow[] = [
  { user_id: 'user-owner', email: 'owner@example.com', kind: 'scheduler' },
  { user_id: 'user-mgr', email: 'mgr@example.com', kind: 'scheduler' },
  { user_id: 'user-poster', email: null, kind: 'poster' },
];

interface Env {
  deps: ShiftTradeRemindersDeps;
  calls: string[];
  pushCalls: Array<{ userIds: string[]; restaurantId: string; title: string; body: string; url: string; tag: string }>;
  emailCalls: Array<{ to: string; subject: string; html: string }>;
  logs: string[];
  clock: { ms: number };
}

function makeEnv(opts: {
  candidates?: ReminderCandidateRow[];
  /** One array for each fetchCandidates call. An empty page after the last. */
  pages?: ReminderCandidateRow[][];
  candidatesError?: string;
  claim?: (tradeId: string, stage: string) => boolean;
  channels?: { email: boolean; push: boolean };
  audience?: string[];
  audienceFor?: (tradeId: string) => string[];
  audienceError?: string;
  pushSkipped?: (userIds: string[]) => number;
  recipients?: UnclaimedRecipientRow[];
  recipientsError?: string;
  onPush?: (env: Env, userIds: string[]) => void;
  pushThrows?: (tradeId: string) => boolean;
  emailError?: (to: string) => string | null;
} = {}): Env {
  const env = {
    calls: [] as string[],
    pushCalls: [] as Env['pushCalls'],
    emailCalls: [] as Env['emailCalls'],
    logs: [] as string[],
    clock: { ms: START_MS },
  } as Env;

  env.deps = {
    fetchCandidates: vi.fn(async (nowIso: string, limit: number) => {
      env.calls.push(`candidates:${nowIso}:${limit}`);
      if (opts.candidatesError) return { data: null, error: { message: opts.candidatesError } };
      if (opts.pages) return { data: opts.pages.shift() ?? [], error: null };
      return { data: opts.candidates ?? [candidate()], error: null };
    }),
    claim: vi.fn(async (tradeId: string, stage: string) => {
      env.calls.push(`claim:${tradeId}:${stage}`);
      return { data: opts.claim ? opts.claim(tradeId, stage) : true, error: null };
    }),
    resolveChannels: vi.fn(async (restaurantId: string, type: string) => {
      env.calls.push(`channels:${restaurantId}:${type}`);
      return opts.channels ?? { email: true, push: true };
    }),
    fetchAudience: vi.fn(async (tradeId: string) => {
      env.calls.push(`audience:${tradeId}`);
      if (opts.audienceError) return { data: null, error: { message: opts.audienceError } };
      const ids = opts.audienceFor?.(tradeId) ?? opts.audience ?? ['user-a', 'user-b'];
      return { data: ids.map((user_id) => ({ user_id })), error: null };
    }),
    fetchUnclaimedRecipients: vi.fn(async (tradeId: string) => {
      env.calls.push(`recipients:${tradeId}`);
      if (opts.recipientsError) return { data: null, error: { message: opts.recipientsError } };
      return { data: opts.recipients ?? RECIPIENTS, error: null };
    }),
    sendPush: vi.fn(async (userIds: string[], restaurantId: string, payload) => {
      const tradeId = payload.tag.replace(/^trade-(reminder|unclaimed)-/, '');
      env.calls.push(`push:${tradeId}`);
      if (opts.pushThrows?.(tradeId)) throw new Error('push service down');
      env.pushCalls.push({ userIds, restaurantId, ...payload });
      opts.onPush?.(env, userIds);
      const skipped = opts.pushSkipped?.(userIds) ?? 0;
      return { sent: userIds.length - skipped, skipped };
    }),
    sendEmail: vi.fn(async (to: string, subject: string, html: string) => {
      env.calls.push('email');
      env.emailCalls.push({ to, subject, html });
      const err = opts.emailError?.(to) ?? null;
      return err ? { ok: false, status: 422, error: err } : { ok: true, status: 200 };
    }),
    now: () => env.clock.ms,
    sleep: async () => {},
    log: (line: string) => env.logs.push(line),
    logError: (line: string) => env.logs.push(line),
    appUrl: 'https://app.easyshifthq.com',
  };
  return env;
}

describe('runShiftTradeReminders: limits', () => {
  it('uses a 60 s budget, 500 push targets, 50 candidates a page and 10 pages', () => {
    expect(RUN_BUDGET_MS).toBe(60_000);
    expect(MAX_PUSH_TARGETS).toBe(500);
    expect(CANDIDATE_LIMIT).toBe(50);
    expect(MAX_CANDIDATE_PAGES).toBe(10);
  });

  it('reads candidates at the injected clock with p_limit 50', async () => {
    const env = makeEnv({ candidates: [] });
    await runShiftTradeReminders(env.deps);
    expect(env.calls[0]).toBe('candidates:2026-09-25T15:00:00.000Z:50');
  });
});

describe('runShiftTradeReminders: claim before send', () => {
  it('reads the audience, then claims, then checks channels, then sends', async () => {
    const env = makeEnv();
    await runShiftTradeReminders(env.deps);
    expect(env.calls.slice(1)).toEqual([
      'audience:trade-1',
      'claim:trade-1:24h',
      'channels:rest-1:shift_trade_reminder',
      'push:trade-1',
    ]);
  });

  it('does not claim when the audience read fails, so the next run tries again', async () => {
    const env = makeEnv({ audienceError: 'db down' });
    const result = await runShiftTradeReminders(env.deps);
    expect(env.deps.claim).not.toHaveBeenCalled();
    expect(env.deps.sendPush).not.toHaveBeenCalled();
    expect(result).toMatchObject({ claimed: 0, skipped: 1 });
    expect(env.logs.join('\n')).toMatch(/audience read failed trade=trade-1/);
  });

  it('skips the send when the claim returns false', async () => {
    const env = makeEnv({ claim: () => false });
    const result = await runShiftTradeReminders(env.deps);
    expect(env.deps.resolveChannels).not.toHaveBeenCalled();
    expect(env.deps.sendPush).not.toHaveBeenCalled();
    expect(result).toMatchObject({ candidates: 1, claimed: 0, skipped: 1, pushed: 0 });
  });

  it('skips the send when the claim RPC fails', async () => {
    const env = makeEnv();
    env.deps.claim = vi.fn(async () => ({ data: null, error: { message: 'db down' } }));
    const result = await runShiftTradeReminders(env.deps);
    expect(env.deps.sendPush).not.toHaveBeenCalled();
    expect(result).toMatchObject({ claimed: 0, skipped: 1 });
  });
});

describe('runShiftTradeReminders: channel gate after the claim', () => {
  it('counts an employee stage as skipped when push is off', async () => {
    const env = makeEnv({ channels: { email: true, push: false } });
    const result = await runShiftTradeReminders(env.deps);
    expect(env.deps.claim).toHaveBeenCalledTimes(1);
    expect(env.deps.sendPush).not.toHaveBeenCalled();
    expect(result).toMatchObject({ claimed: 1, skipped: 1, pushed: 0 });
  });

  it('counts unclaimed as skipped when all channels are off', async () => {
    const env = makeEnv({ candidates: [candidate({ stage: 'unclaimed' })], channels: { email: false, push: false } });
    const result = await runShiftTradeReminders(env.deps);
    expect(env.calls).toContain('channels:rest-1:shift_trade_unclaimed');
    expect(env.deps.fetchUnclaimedRecipients).toHaveBeenCalledTimes(1);
    expect(env.deps.sendPush).not.toHaveBeenCalled();
    expect(env.deps.sendEmail).not.toHaveBeenCalled();
    expect(result).toMatchObject({ claimed: 1, skipped: 1, pushed: 0, emailed: 0 });
  });
});

describe('runShiftTradeReminders: run budget', () => {
  it('defers the rest when the wall-clock budget is used up', async () => {
    const env = makeEnv({
      candidates: [
        candidate({ shift_trade_id: 't1' }),
        candidate({ shift_trade_id: 't2' }),
        candidate({ shift_trade_id: 't3' }),
      ],
      onPush: (e) => {
        e.clock.ms += RUN_BUDGET_MS;
      },
    });
    const result = await runShiftTradeReminders(env.deps);
    expect(env.deps.claim).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ candidates: 3, claimed: 1, deferred: 2 });
  });

  it('defers the rest when the push-target budget is used up', async () => {
    const big = users(MAX_PUSH_TARGETS);
    const env = makeEnv({
      candidates: [candidate({ shift_trade_id: 't1' }), candidate({ shift_trade_id: 't2' })],
      audience: big,
    });
    const result = await runShiftTradeReminders(env.deps);
    expect(env.deps.claim).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ candidates: 2, claimed: 1, deferred: 1, pushed: MAX_PUSH_TARGETS });
  });

  it('defers a candidate before its claim when its audience does not fit the rest of the budget', async () => {
    const env = makeEnv({
      candidates: [
        candidate({ shift_trade_id: 't1' }),
        candidate({ shift_trade_id: 't2' }),
        candidate({ shift_trade_id: 't3' }),
      ],
      audience: users(300),
    });
    const result = await runShiftTradeReminders(env.deps);
    expect(env.calls).not.toContain('claim:t2:24h');
    expect(env.deps.claim).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ candidates: 3, claimed: 1, deferred: 2, pushed: 300 });
  });

  it('sends one audience above the budget in chunks of 500 when the run is empty', async () => {
    const env = makeEnv({
      candidates: [candidate({ shift_trade_id: 't1' }), candidate({ shift_trade_id: 't2' })],
      audienceFor: (tradeId) => (tradeId === 't1' ? users(1_200) : users(2)),
    });
    const result = await runShiftTradeReminders(env.deps);
    expect(env.pushCalls.map((p) => p.userIds.length)).toEqual([500, 500, 200]);
    expect(new Set(env.pushCalls.flatMap((p) => p.userIds)).size).toBe(1_200);
    expect(result).toMatchObject({ claimed: 1, pushed: 1_200, deferred: 1 });
  });

  it('counts only the targets that sendPush did not skip, and logs the skipped count', async () => {
    const env = makeEnv({
      candidates: [candidate({ shift_trade_id: 't1' }), candidate({ shift_trade_id: 't2' })],
      audienceFor: (tradeId) => (tradeId === 't1' ? users(500) : users(100)),
      pushSkipped: (ids) => (ids.length === 500 ? 100 : 0),
    });
    const result = await runShiftTradeReminders(env.deps);
    // 400 targets used after t1, so t2 (100 users) still fits.
    expect(env.deps.claim).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ claimed: 2, pushed: 500, deferred: 0 });
    expect(env.logs.join('\n')).toMatch(/push skipped trade=t1 skipped=100/);
  });
});

describe('runShiftTradeReminders: candidate pages', () => {
  const page = (prefix: string, n = CANDIDATE_LIMIT) =>
    Array.from({ length: n }, (_, i) => candidate({ shift_trade_id: `${prefix}-${i}` }));

  it('reads one page when the page is not full', async () => {
    const env = makeEnv({ pages: [page('a', 3)], audience: [] });
    const result = await runShiftTradeReminders(env.deps);
    expect(env.deps.fetchCandidates).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ candidates: 3, claimed: 3 });
  });

  it('reads the next page after a full page', async () => {
    const env = makeEnv({ pages: [page('a'), page('b', 7)], audience: [] });
    const result = await runShiftTradeReminders(env.deps);
    expect(env.deps.fetchCandidates).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ candidates: CANDIDATE_LIMIT + 7, claimed: CANDIDATE_LIMIT + 7 });
  });

  it('stops after 10 pages', async () => {
    const pages = Array.from({ length: 12 }, (_, i) => page(`p${i}`));
    const env = makeEnv({ pages, audience: [] });
    const result = await runShiftTradeReminders(env.deps);
    expect(env.deps.fetchCandidates).toHaveBeenCalledTimes(MAX_CANDIDATE_PAGES);
    expect(result.candidates).toBe(CANDIDATE_LIMIT * MAX_CANDIDATE_PAGES);
  });

  it('does not process a row two times when a later page returns it again', async () => {
    const first = page('a');
    const env = makeEnv({ pages: [first, [...first]], claim: () => false });
    const result = await runShiftTradeReminders(env.deps);
    expect(env.deps.fetchCandidates).toHaveBeenCalledTimes(2);
    expect(env.deps.claim).toHaveBeenCalledTimes(CANDIDATE_LIMIT);
    expect(result).toMatchObject({ candidates: CANDIDATE_LIMIT, skipped: CANDIDATE_LIMIT });
  });

  it('does not read the next page when the run budget is used up', async () => {
    const env = makeEnv({
      pages: [page('a'), page('b')],
      onPush: (e) => {
        e.clock.ms += RUN_BUDGET_MS;
      },
    });
    const result = await runShiftTradeReminders(env.deps);
    expect(env.deps.fetchCandidates).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ claimed: 1, deferred: CANDIDATE_LIMIT - 1 });
  });
});

describe('runShiftTradeReminders: channel cache', () => {
  it('resolves the channels one time for each restaurant and type in a run', async () => {
    const env = makeEnv({
      candidates: [
        candidate({ shift_trade_id: 't1' }),
        candidate({ shift_trade_id: 't2' }),
        candidate({ shift_trade_id: 't3', stage: 'unclaimed' }),
        candidate({ shift_trade_id: 't4', restaurant_id: 'rest-2' }),
      ],
    });
    await runShiftTradeReminders(env.deps);
    expect(env.calls.filter((c) => c.startsWith('channels:'))).toEqual([
      'channels:rest-1:shift_trade_reminder',
      'channels:rest-1:shift_trade_unclaimed',
      'channels:rest-2:shift_trade_reminder',
    ]);
  });
});

describe('runShiftTradeReminders: employee stages', () => {
  it('pushes the audience with the employee content', async () => {
    const env = makeEnv({ audience: ['user-a', 'user-b'] });
    const result = await runShiftTradeReminders(env.deps);
    expect(env.pushCalls).toHaveLength(1);
    expect(env.pushCalls[0]).toMatchObject({
      userIds: ['user-a', 'user-b'],
      restaurantId: 'rest-1',
      title: 'Maria needs cover today',
      url: '/employee/shifts?trade=trade-1&restaurant=rest-1&from=reminder',
      tag: 'trade-reminder-trade-1',
    });
    expect(env.deps.sendEmail).not.toHaveBeenCalled();
    expect(result).toMatchObject({ claimed: 1, pushed: 2, emailed: 0 });
  });

  it('builds {when} from the real hours left at the injected clock', async () => {
    const env = makeEnv({ candidates: [candidate({ stage: '6h' })] });
    env.clock.ms = Date.parse('2026-09-25T17:30:00Z');
    await runShiftTradeReminders(env.deps);
    expect(env.pushCalls[0].title).toBe("Maria's shift starts in 4 hours");
  });

  it('sends nothing for an empty audience, and still counts the claim', async () => {
    const env = makeEnv({ audience: [] });
    const result = await runShiftTradeReminders(env.deps);
    expect(env.deps.sendPush).not.toHaveBeenCalled();
    expect(result).toMatchObject({ claimed: 1, pushed: 0, skipped: 0 });
  });
});

describe('runShiftTradeReminders: unclaimed stage', () => {
  it('reads the recipients, then claims, then checks channels, then sends', async () => {
    const env = makeEnv({ candidates: [candidate({ stage: 'unclaimed' })], channels: { email: false, push: true } });
    await runShiftTradeReminders(env.deps);
    expect(env.calls.slice(1, 4)).toEqual([
      'recipients:trade-1',
      'claim:trade-1:unclaimed',
      'channels:rest-1:shift_trade_unclaimed',
    ]);
  });

  it('does not claim when the recipients read fails, so the next run tries again', async () => {
    const env = makeEnv({ candidates: [candidate({ stage: 'unclaimed' })], recipientsError: 'db down' });
    const result = await runShiftTradeReminders(env.deps);
    expect(env.deps.claim).not.toHaveBeenCalled();
    expect(env.deps.sendPush).not.toHaveBeenCalled();
    expect(env.deps.sendEmail).not.toHaveBeenCalled();
    expect(result).toMatchObject({ claimed: 0, skipped: 1 });
    expect(env.logs.join('\n')).toMatch(/recipients read failed trade=trade-1/);
  });

  it('defers before the claim when the scheduler and poster targets do not fit the rest of the budget', async () => {
    const schedulers: UnclaimedRecipientRow[] = users(250).map((user_id) => ({ user_id, email: null, kind: 'scheduler' }));
    const env = makeEnv({
      candidates: [candidate({ shift_trade_id: 't1' }), candidate({ shift_trade_id: 't2', stage: 'unclaimed' })],
      audience: users(300),
      recipients: [...schedulers, { user_id: 'user-poster', email: null, kind: 'poster' }],
    });
    const result = await runShiftTradeReminders(env.deps);
    expect(env.calls).toContain('recipients:t2');
    expect(env.calls).not.toContain('claim:t2:unclaimed');
    expect(result).toMatchObject({ claimed: 1, deferred: 1, pushed: 300 });
  });

  it('sends a large scheduler list in chunks of 500', async () => {
    const schedulers: UnclaimedRecipientRow[] = users(1_200).map((user_id) => ({ user_id, email: null, kind: 'scheduler' }));
    const env = makeEnv({
      candidates: [candidate({ stage: 'unclaimed' })],
      recipients: [...schedulers, { user_id: 'user-poster', email: null, kind: 'poster' }],
    });
    const result = await runShiftTradeReminders(env.deps);
    const schedulerCalls = env.pushCalls.filter((p) => p.url === '/scheduling');
    expect(schedulerCalls.map((p) => p.userIds.length)).toEqual([500, 500, 200]);
    expect(new Set(schedulerCalls.flatMap((p) => p.userIds)).size).toBe(1_200);
    expect(result).toMatchObject({ claimed: 1, pushed: 1_201 });
  });

  it('pushes schedulers and the poster with separate text, and emails schedulers one by one', async () => {
    const env = makeEnv({ candidates: [candidate({ stage: 'unclaimed' })] });
    const result = await runShiftTradeReminders(env.deps);

    const scheduler = env.pushCalls.find((p) => p.url === '/scheduling');
    const poster = env.pushCalls.find((p) => p.url === '/employee/schedule');
    expect(scheduler?.userIds).toEqual(['user-owner', 'user-mgr']);
    expect(scheduler?.title).toBe("Nobody took Maria's shift yet");
    expect(poster?.userIds).toEqual(['user-poster']);
    expect(poster?.title).toBe('Your shift is still up for trade');

    expect(env.emailCalls.map((e) => e.to)).toEqual(['owner@example.com', 'mgr@example.com']);
    expect(env.emailCalls[0].subject).toBe("Nobody took Maria's shift yet");
    expect(env.emailCalls[0].html).toContain('https://app.easyshifthq.com/scheduling');
    expect(result).toMatchObject({ claimed: 1, pushed: 3, emailed: 2 });
  });

  it('sends the scheduler push and the poster push at the same time', async () => {
    const env = makeEnv({ candidates: [candidate({ stage: 'unclaimed' })] });
    const events: string[] = [];
    env.deps.sendPush = vi.fn(async (userIds: string[], _restaurantId: string, payload) => {
      events.push(`start:${payload.url}`);
      await new Promise((resolve) => setTimeout(resolve, 0));
      events.push(`end:${payload.url}`);
      return { sent: userIds.length, skipped: 0 };
    });
    await runShiftTradeReminders(env.deps);
    expect(events.slice(0, 2).sort()).toEqual(['start:/employee/schedule', 'start:/scheduling']);
  });

  it('sends email only when push is off, and the poster gets nothing', async () => {
    const env = makeEnv({ candidates: [candidate({ stage: 'unclaimed' })], channels: { email: true, push: false } });
    const result = await runShiftTradeReminders(env.deps);
    expect(env.deps.sendPush).not.toHaveBeenCalled();
    expect(result).toMatchObject({ pushed: 0, emailed: 2 });
  });

  it('sends push only when email is off', async () => {
    const env = makeEnv({ candidates: [candidate({ stage: 'unclaimed' })], channels: { email: false, push: true } });
    const result = await runShiftTradeReminders(env.deps);
    expect(env.deps.sendEmail).not.toHaveBeenCalled();
    expect(result).toMatchObject({ pushed: 3, emailed: 0 });
  });
});

describe('runShiftTradeReminders: failures and logs', () => {
  it('a failed send does not stop the loop', async () => {
    const env = makeEnv({
      candidates: [candidate({ shift_trade_id: 't1' }), candidate({ shift_trade_id: 't2' })],
      pushThrows: (tradeId) => tradeId === 't1',
    });
    const result = await runShiftTradeReminders(env.deps);
    expect(env.deps.claim).toHaveBeenCalledTimes(2);
    expect(env.pushCalls.map((p) => p.tag)).toEqual(['trade-reminder-t2']);
    expect(result).toMatchObject({ claimed: 2, pushed: 2 });
  });

  it('a failed email does not stop the other emails, and counts only the sent ones', async () => {
    const env = makeEnv({
      candidates: [candidate({ stage: 'unclaimed' })],
      emailError: (to) => (to === 'owner@example.com' ? 'Invalid `to` field: owner@example.com' : null),
    });
    const result = await runShiftTradeReminders(env.deps);
    expect(env.emailCalls).toHaveLength(2);
    expect(result).toMatchObject({ emailed: 1 });
  });

  it('logs counts and ids only, never an email address', async () => {
    const env = makeEnv({
      candidates: [candidate({ shift_trade_id: 't1', stage: 'unclaimed' }), candidate({ shift_trade_id: 't2' })],
      emailError: (to) => (to === 'owner@example.com' ? 'Invalid `to` field: owner@example.com' : null),
      pushThrows: (tradeId) => tradeId === 't2',
    });
    await runShiftTradeReminders(env.deps);
    const all = env.logs.join('\n');
    expect(all).not.toMatch(/@/);
    expect(all).not.toContain('Maria');
    expect(all).toContain('t1');
    expect(all).toContain('user-owner');
    expect(all).toMatch(/candidates=2/);
  });
});

describe('runShiftTradeReminders: response', () => {
  it('returns the counts for a mixed run', async () => {
    const env = makeEnv({
      candidates: [
        candidate({ shift_trade_id: 't1', stage: '72h' }),
        candidate({ shift_trade_id: 't2', stage: 'unclaimed' }),
        candidate({ shift_trade_id: 't3', stage: '6h' }),
      ],
      claim: (tradeId) => tradeId !== 't3',
      audience: ['user-a'],
    });
    const result = await runShiftTradeReminders(env.deps);
    expect(result).toEqual({
      candidates: 3,
      claimed: 2,
      pushed: 4,
      emailed: 2,
      skipped: 1,
      deferred: 0,
    });
  });

  it('returns the error when the candidates read fails', async () => {
    const env = makeEnv({ candidatesError: 'boom' });
    const result = await runShiftTradeReminders(env.deps);
    expect(result).toEqual({
      candidates: 0,
      claimed: 0,
      pushed: 0,
      emailed: 0,
      skipped: 0,
      deferred: 0,
      error: 'boom',
    });
    expect(env.deps.claim).not.toHaveBeenCalled();
  });
});
