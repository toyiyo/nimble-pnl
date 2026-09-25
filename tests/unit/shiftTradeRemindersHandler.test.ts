import { describe, it, expect, vi } from 'vitest';
import {
  runShiftTradeReminders,
  RUN_BUDGET_MS,
  MAX_PUSH_TARGETS,
  CANDIDATE_LIMIT,
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
    offered_by_employee_id: 'emp-poster',
    offered_by_name: 'Maria Lopez',
    offered_by_user_id: 'user-poster',
    target_employee_id: null,
    restaurant_name: 'Blue Fig',
    restaurant_timezone: 'America/Chicago',
    ...over,
  };
}

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
  candidatesError?: string;
  claim?: (tradeId: string, stage: string) => boolean;
  channels?: { email: boolean; push: boolean };
  audience?: string[];
  recipients?: UnclaimedRecipientRow[];
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
      return { data: (opts.audience ?? ['user-a', 'user-b']).map((user_id) => ({ user_id })), error: null };
    }),
    fetchUnclaimedRecipients: vi.fn(async (tradeId: string) => {
      env.calls.push(`recipients:${tradeId}`);
      return { data: opts.recipients ?? RECIPIENTS, error: null };
    }),
    sendPush: vi.fn(async (userIds: string[], restaurantId: string, payload) => {
      const tradeId = payload.tag.replace('trade-reminder-', '');
      env.calls.push(`push:${tradeId}`);
      if (opts.pushThrows?.(tradeId)) throw new Error('push service down');
      env.pushCalls.push({ userIds, restaurantId, ...payload });
      opts.onPush?.(env, userIds);
      return { sent: userIds.length };
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
  it('uses a 60 s budget, 1,000 push targets and 50 candidates', () => {
    expect(RUN_BUDGET_MS).toBe(60_000);
    expect(MAX_PUSH_TARGETS).toBe(1_000);
    expect(CANDIDATE_LIMIT).toBe(50);
  });

  it('reads candidates at the injected clock with p_limit 50', async () => {
    const env = makeEnv({ candidates: [] });
    await runShiftTradeReminders(env.deps);
    expect(env.calls[0]).toBe('candidates:2026-09-25T15:00:00.000Z:50');
  });
});

describe('runShiftTradeReminders: claim before send', () => {
  it('claims, then checks channels, then reads the audience, then sends', async () => {
    const env = makeEnv();
    await runShiftTradeReminders(env.deps);
    expect(env.calls.slice(1)).toEqual([
      'claim:trade-1:24h',
      'channels:rest-1:shift_trade_reminder',
      'audience:trade-1',
      'push:trade-1',
    ]);
  });

  it('skips the send when the claim returns false', async () => {
    const env = makeEnv({ claim: () => false });
    const result = await runShiftTradeReminders(env.deps);
    expect(env.deps.resolveChannels).not.toHaveBeenCalled();
    expect(env.deps.fetchAudience).not.toHaveBeenCalled();
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
    expect(env.deps.fetchAudience).not.toHaveBeenCalled();
    expect(env.deps.sendPush).not.toHaveBeenCalled();
    expect(result).toMatchObject({ claimed: 1, skipped: 1, pushed: 0 });
  });

  it('counts unclaimed as skipped when all channels are off', async () => {
    const env = makeEnv({ candidates: [candidate({ stage: 'unclaimed' })], channels: { email: false, push: false } });
    const result = await runShiftTradeReminders(env.deps);
    expect(env.calls).toContain('channels:rest-1:shift_trade_unclaimed');
    expect(env.deps.fetchUnclaimedRecipients).not.toHaveBeenCalled();
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
    const big = Array.from({ length: MAX_PUSH_TARGETS }, (_, i) => `user-${i}`);
    const env = makeEnv({
      candidates: [candidate({ shift_trade_id: 't1' }), candidate({ shift_trade_id: 't2' })],
      audience: big,
    });
    const result = await runShiftTradeReminders(env.deps);
    expect(env.deps.claim).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ candidates: 2, claimed: 1, deferred: 1, pushed: MAX_PUSH_TARGETS });
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
