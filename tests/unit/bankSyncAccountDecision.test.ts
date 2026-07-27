import { describe, it, expect } from 'vitest';
import {
  decideAccountAction,
  resultForNeedsReauth,
  resultForSubscribing,
  resultForRefresh,
  shouldStampLastSyncAt,
  computeDataCurrentThrough,
} from '../../supabase/functions/_shared/bankSyncAccountDecision';

// Plan RED case 1: account.status !== 'active' -> needs_reauth, no fetch, no last_sync_at.
describe('decideAccountAction', () => {
  it('returns needs_reauth when the Stripe account status is not active, regardless of subscription state', () => {
    expect(
      decideAccountAction({ accountStatus: 'inactive', hasTransactionsSub: true }),
    ).toEqual({ kind: 'needs_reauth' });
    expect(
      decideAccountAction({ accountStatus: 'inactive', hasTransactionsSub: false }),
    ).toEqual({ kind: 'needs_reauth' });
  });

  it('returns subscribe for an active account not yet subscribed to transactions', () => {
    expect(
      decideAccountAction({ accountStatus: 'active', hasTransactionsSub: false }),
    ).toEqual({ kind: 'subscribe' });
  });

  it('returns refresh_and_fetch for an active, already-subscribed account', () => {
    expect(
      decideAccountAction({ accountStatus: 'active', hasTransactionsSub: true }),
    ).toEqual({ kind: 'refresh_and_fetch' });
  });
});

describe('resultForNeedsReauth', () => {
  it('reports synced 0 and status needs_reauth — no fetch happened', () => {
    expect(resultForNeedsReauth('fca_123')).toEqual({
      accountId: 'fca_123',
      synced: 0,
      status: 'needs_reauth',
    });
  });
});

describe('resultForSubscribing', () => {
  it('reports synced 0 and status subscribing', () => {
    expect(resultForSubscribing('fca_456')).toEqual({
      accountId: 'fca_456',
      synced: 0,
      status: 'subscribing',
    });
  });
});

// Plan RED case 2: transaction_refresh.status === 'failed' -> error result,
// last_sync_at untouched, sync_error set.
describe('resultForRefresh', () => {
  it('reports a refresh_failed error result when Stripe reports the refresh failed, ignoring any synced count', () => {
    const result = resultForRefresh('fca_789', 'failed', 0);
    expect(result.status).toBe('refresh_failed');
    expect(result.synced).toBe(0);
    expect(result.error).toBeTruthy();
  });

  it('reports the real synced count with status ok when the refresh succeeded', () => {
    expect(resultForRefresh('fca_789', 'succeeded', 42)).toEqual({
      accountId: 'fca_789',
      synced: 42,
      status: 'ok',
    });
  });

  it('reports ok when Stripe omits transaction_refresh.status entirely (no refresh was attempted, e.g. first subscribe cycle)', () => {
    expect(resultForRefresh('fca_789', undefined, 5)).toEqual({
      accountId: 'fca_789',
      synced: 5,
      status: 'ok',
    });
  });
});

// Plan RED case 3: a mix of one unsubscribed and two subscribed accounts
// returns real counts for the two subscribed ones instead of the bank-wide
// needsSubscriptionSetup early return discarding them.
describe('mixed-subscription account set (design §5b)', () => {
  it('produces per-account results that preserve the real counts of subscribed siblings alongside a cold account', () => {
    const results = [
      resultForRefresh('fca_warm_1', 'succeeded', 42),
      resultForSubscribing('fca_cold'),
      resultForRefresh('fca_warm_2', 'succeeded', 7),
    ];

    expect(results).toEqual([
      { accountId: 'fca_warm_1', synced: 42, status: 'ok' },
      { accountId: 'fca_cold', synced: 0, status: 'subscribing' },
      { accountId: 'fca_warm_2', synced: 7, status: 'ok' },
    ]);

    const totalSynced = results.reduce((sum, r) => sum + r.synced, 0);
    expect(totalSynced).toBe(49);
  });
});

describe('shouldStampLastSyncAt', () => {
  it('is true when at least one account completed a successful refresh+fetch', () => {
    expect(
      shouldStampLastSyncAt([
        { accountId: 'a', synced: 0, status: 'subscribing' },
        { accountId: 'b', synced: 3, status: 'ok' },
      ]),
    ).toBe(true);
  });

  it('is false when every account needs reauth', () => {
    expect(
      shouldStampLastSyncAt([
        { accountId: 'a', synced: 0, status: 'needs_reauth' },
        { accountId: 'b', synced: 0, status: 'needs_reauth' },
      ]),
    ).toBe(false);
  });

  it('is false when the only refresh attempted failed', () => {
    expect(
      shouldStampLastSyncAt([
        { accountId: 'a', synced: 0, status: 'refresh_failed', error: 'boom' },
      ]),
    ).toBe(false);
  });

  it('is false when every account is still subscribing (no fetch has happened yet)', () => {
    expect(
      shouldStampLastSyncAt([{ accountId: 'a', synced: 0, status: 'subscribing' }]),
    ).toBe(false);
  });
});

// Plan RED case 4: a successful run sets data_current_through to
// MAX(transaction_date).
describe('computeDataCurrentThrough', () => {
  it('returns the latest transaction_date as an ISO string', () => {
    expect(
      computeDataCurrentThrough([
        '2026-07-10T12:00:00.000Z',
        '2026-07-22T08:30:00.000Z',
        '2026-07-15T00:00:00.000Z',
      ]),
    ).toBe('2026-07-22T08:30:00.000Z');
  });

  it('returns null when there are no rows for the bank — never invents a date', () => {
    expect(computeDataCurrentThrough([])).toBeNull();
  });

  it('ignores null/undefined entries when computing the max', () => {
    expect(
      computeDataCurrentThrough([null, '2026-07-01T00:00:00.000Z', undefined]),
    ).toBe('2026-07-01T00:00:00.000Z');
  });
});
