import { describe, it, expect, vi } from 'vitest';
import {
  runBankReauthNotices,
  type BankReauthNoticesDeps,
  type CohortARow,
  type CohortBRow,
  type RecipientRow,
} from '../../supabase/functions/_shared/bankReauthNoticesHandler';

const OWNER: RecipientRow = { user_id: 'owner-1', email: 'owner@example.com', full_name: 'Owner One', role: 'owner' };
const MANAGER: RecipientRow = { user_id: 'mgr-1', email: 'mgr@example.com', full_name: 'Manager One', role: 'manager' };

function cohortARow(over: Partial<CohortARow> = {}): CohortARow {
  return {
    connected_bank_id: 'bank-1',
    restaurant_id: 'rest-1',
    institution_name: 'Chase',
    account_mask: '4242',
    deactivated_at: '2026-07-10T12:00:00.000Z',
    elapsed_days: 1,
    sent_stages: [],
    ...over,
  };
}

function cohortBRow(over: Partial<CohortBRow> = {}): CohortBRow {
  return {
    connected_bank_id: 'bank-2',
    restaurant_id: 'rest-2',
    institution_name: 'Ally',
    account_mask: '9999',
    deactivated_at: '2026-07-01T12:00:00.000Z',
    data_current_through: '2026-07-14T12:00:00.000Z',
    ...over,
  };
}

interface Env {
  deps: BankReauthNoticesDeps;
  emailCalls: Array<{ to: string; subject: string }>;
  pushCalls: Array<{ userIds: string[]; restaurantId: string }>;
  recordCalls: Array<{ restaurant_id: string; connected_bank_id: string; stage: string; deactivated_at: string }>;
  recipientCalls: Array<{ restaurantId: string; roles: string[] }>;
}

function makeDeps(opts: {
  cohortA?: CohortARow[];
  cohortB?: CohortBRow[];
  recipients?: RecipientRow[];
  channels?: { email: boolean; push: boolean };
  recordError?: string;
} = {}): Env {
  const emailCalls: Env['emailCalls'] = [];
  const pushCalls: Env['pushCalls'] = [];
  const recordCalls: Env['recordCalls'] = [];
  const recipientCalls: Env['recipientCalls'] = [];

  const deps: BankReauthNoticesDeps = {
    fetchCohortA: vi.fn().mockResolvedValue({ data: opts.cohortA ?? [], error: null }),
    fetchCohortB: vi.fn().mockResolvedValue({ data: opts.cohortB ?? [], error: null }),
    fetchRecipients: vi.fn(async (restaurantId: string, roles: Array<'owner' | 'manager'>) => {
      recipientCalls.push({ restaurantId, roles });
      return { data: opts.recipients ?? [OWNER, MANAGER], error: null };
    }),
    resolveChannels: vi.fn().mockResolvedValue(opts.channels ?? { email: true, push: true }),
    sendEmail: vi.fn(async (msg) => {
      emailCalls.push({ to: msg.to, subject: msg.subject });
      return { id: `resend-${emailCalls.length}`, error: null };
    }),
    sendPush: vi.fn(async (userIds: string[], restaurantId: string) => {
      pushCalls.push({ userIds, restaurantId });
      return { sent: userIds.length };
    }),
    recordNotice: vi.fn(async (row) => {
      recordCalls.push(row);
      return { error: opts.recordError ? { message: opts.recordError } : null };
    }),
    fromEmail: 'EasyShiftHQ <notifications@easyshifthq.com>',
    appUrl: 'https://app.easyshifthq.com',
  };

  return { deps, emailCalls, pushCalls, recordCalls, recipientCalls };
}

describe('runBankReauthNotices', () => {
  it('returns zero counts and no results when both cohorts are empty', async () => {
    const { deps } = makeDeps();
    const out = await runBankReauthNotices(deps);
    expect(out.cohortACount).toBe(0);
    expect(out.cohortBCount).toBe(0);
    expect(out.results).toEqual([]);
  });

  it('cohort A day_1: sends email + push to owner+manager and records the dedupe row', async () => {
    const env = makeDeps({ cohortA: [cohortARow({ elapsed_days: 1, sent_stages: [] })] });
    const out = await runBankReauthNotices(env.deps);

    expect(out.results).toHaveLength(1);
    expect(out.results[0].stage).toBe('day_1');
    expect(out.results[0].status).toBe('sent');
    expect(env.emailCalls).toHaveLength(2); // owner + manager
    expect(env.pushCalls).toHaveLength(1);
    expect(env.pushCalls[0].userIds.sort()).toEqual(['mgr-1', 'owner-1']);
    expect(env.recordCalls).toHaveLength(1);
    expect(env.recordCalls[0]).toMatchObject({
      restaurant_id: 'rest-1',
      connected_bank_id: 'bank-1',
      stage: 'day_1',
      deactivated_at: '2026-07-10T12:00:00.000Z',
    });
  });

  it('cohort A: a bank at day 6 with only day_1 already sent jumps straight to day_4, not a backfill of both', async () => {
    const env = makeDeps({
      cohortA: [cohortARow({ elapsed_days: 6, sent_stages: ['day_1'] })],
    });
    const out = await runBankReauthNotices(env.deps);

    expect(out.results).toHaveLength(1);
    expect(out.results[0].stage).toBe('day_4');
  });

  it('cohort A: a stage already sent for this exact outage is skipped entirely (no result row, no send, no re-record)', async () => {
    const env = makeDeps({
      cohortA: [cohortARow({ elapsed_days: 1, sent_stages: ['day_1'] })],
    });
    const out = await runBankReauthNotices(env.deps);

    expect(out.results).toHaveLength(0);
    expect(env.emailCalls).toHaveLength(0);
    expect(env.recordCalls).toHaveLength(0);
  });

  it('cohort A: day 0 (elapsedDays=0) never sends anything — in-app only per design §4.6', async () => {
    const env = makeDeps({ cohortA: [cohortARow({ elapsed_days: 0, sent_stages: [] })] });
    const out = await runBankReauthNotices(env.deps);

    expect(out.results).toHaveLength(0);
    expect(env.emailCalls).toHaveLength(0);
  });

  it('cohort A day_10: narrows recipients to owner-only and sends no push', async () => {
    const env = makeDeps({
      cohortA: [cohortARow({ elapsed_days: 10, sent_stages: ['day_1', 'day_4'] })],
      recipients: [OWNER],
    });
    const out = await runBankReauthNotices(env.deps);

    expect(out.results[0].stage).toBe('day_10');
    expect(env.recipientCalls[0].roles).toEqual(['owner']);
    expect(env.emailCalls).toHaveLength(1);
    expect(env.pushCalls).toHaveLength(0);
  });

  it('cohort B: sends a recovered receipt over email only, never push, and records stage=recovered', async () => {
    const env = makeDeps({ cohortB: [cohortBRow()] });
    const out = await runBankReauthNotices(env.deps);

    expect(out.results).toHaveLength(1);
    expect(out.results[0].stage).toBe('recovered');
    expect(env.emailCalls).toHaveLength(2);
    expect(env.pushCalls).toHaveLength(0);
    expect(env.recordCalls[0]).toMatchObject({
      connected_bank_id: 'bank-2',
      stage: 'recovered',
      deactivated_at: '2026-07-01T12:00:00.000Z',
    });
  });

  it('processes both cohorts in the same run', async () => {
    const env = makeDeps({
      cohortA: [cohortARow({ elapsed_days: 1 })],
      cohortB: [cohortBRow()],
    });
    const out = await runBankReauthNotices(env.deps);

    expect(out.cohortACount).toBe(1);
    expect(out.cohortBCount).toBe(1);
    expect(out.results.map((r) => r.stage).sort()).toEqual(['day_1', 'recovered']);
  });

  it('gates email off when resolveChannels reports email disabled for this restaurant', async () => {
    const env = makeDeps({
      cohortA: [cohortARow({ elapsed_days: 1 })],
      channels: { email: false, push: true },
    });
    const out = await runBankReauthNotices(env.deps);

    expect(env.emailCalls).toHaveLength(0);
    expect(env.pushCalls).toHaveLength(1);
    expect(out.results[0].status).toBe('sent'); // still records — the channel gate, not an error
  });

  it('gates push off when resolveChannels reports push disabled for this restaurant', async () => {
    const env = makeDeps({
      cohortA: [cohortARow({ elapsed_days: 1 })],
      channels: { email: true, push: false },
    });
    const out = await runBankReauthNotices(env.deps);

    expect(env.emailCalls).toHaveLength(2);
    expect(env.pushCalls).toHaveLength(0);
  });

  it('still records the dedupe row when both channels are disabled, so the stage is not re-evaluated tomorrow', async () => {
    const env = makeDeps({
      cohortA: [cohortARow({ elapsed_days: 1 })],
      channels: { email: false, push: false },
    });
    const out = await runBankReauthNotices(env.deps);

    expect(env.emailCalls).toHaveLength(0);
    expect(env.pushCalls).toHaveLength(0);
    expect(env.recordCalls).toHaveLength(1);
    expect(out.results[0].status).toBe('sent');
    // Both channels disabled means no recipients round-trip was needed either.
    expect(env.recipientCalls).toHaveLength(0);
  });

  it('skips a recipient with no email when sending the email channel, without failing the run', async () => {
    const env = makeDeps({
      cohortA: [cohortARow({ elapsed_days: 1 })],
      recipients: [OWNER, { ...MANAGER, email: null }],
    });
    const out = await runBankReauthNotices(env.deps);

    expect(env.emailCalls).toHaveLength(1);
    expect(env.emailCalls[0].to).toBe('owner@example.com');
    expect(out.results[0].emailsSent).toBe(1);
    // Push still goes to both recipients — push only needs a user_id, not an email.
    expect(env.pushCalls[0].userIds.sort()).toEqual(['mgr-1', 'owner-1']);
  });

  it('surfaces a fetchCohortA error without throwing, and does not touch cohort B', async () => {
    const env = makeDeps({ cohortB: [cohortBRow()] });
    env.deps.fetchCohortA = vi.fn().mockResolvedValue({ data: null, error: { message: 'db down' } });

    const out = await runBankReauthNotices(env.deps);

    expect(out.error).toBe('db down');
    expect(out.results).toEqual([]);
    expect(env.emailCalls).toHaveLength(0);
  });

  it('marks a target as status=error (without throwing) when recordNotice fails', async () => {
    const env = makeDeps({
      cohortA: [cohortARow({ elapsed_days: 1 })],
      recordError: 'unique violation',
    });
    const out = await runBankReauthNotices(env.deps);

    expect(out.results[0].status).toBe('error');
    expect(out.results[0].error).toBe('unique violation');
    // The send already happened before the record failure — not rolled back.
    expect(env.emailCalls).toHaveLength(2);
  });
});
