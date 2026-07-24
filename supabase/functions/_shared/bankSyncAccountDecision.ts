// Pure per-account sync decision logic for `stripe-sync-transactions`.
// No Stripe client, no Supabase client, no fetch — directly unit-testable
// under vitest (mirrors the pattern already used by `_shared/resolveChannels.ts`
// and `_shared/bankReauthStages.ts`).
//
// See docs/superpowers/specs/2026-07-23-bank-reauth-flow-design.md §4.3.

/** What the sync run should do next for a single Financial Connections account. */
export type AccountAction =
  | { kind: 'needs_reauth' }
  | { kind: 'subscribe' }
  | { kind: 'refresh_and_fetch' };

/** The per-account entry the response's `accounts` array reports. */
export type AccountSyncStatus = 'ok' | 'subscribing' | 'needs_reauth' | 'refresh_failed';

export interface AccountSyncResult {
  accountId: string;
  synced: number;
  status: AccountSyncStatus;
  error?: string;
}

/**
 * Decides what to do with one account, given Stripe's account status and
 * whether it already carries the `transactions` feature subscription.
 *
 * `accountStatus !== 'active'` always wins — an inactive account cannot be
 * refreshed or fetched regardless of subscription state (design §4.3.1).
 */
export function decideAccountAction(input: {
  accountStatus: string;
  hasTransactionsSub: boolean;
}): AccountAction {
  if (input.accountStatus !== 'active') {
    return { kind: 'needs_reauth' };
  }
  if (!input.hasTransactionsSub) {
    return { kind: 'subscribe' };
  }
  return { kind: 'refresh_and_fetch' };
}

/** Result entry for an account that needed re-authorization: no fetch happened. */
export function resultForNeedsReauth(accountId: string): AccountSyncResult {
  return { accountId, synced: 0, status: 'needs_reauth' };
}

/** Result entry for an account newly subscribed to `transactions`: Stripe is
 * still backfilling, so there is nothing to fetch on this run. */
export function resultForSubscribing(accountId: string): AccountSyncResult {
  return { accountId, synced: 0, status: 'subscribing' };
}

/**
 * Result entry for an account whose refresh was attempted. A
 * `transaction_refresh.status === 'failed'` is a hard signal (design
 * §4.3.2/.3): it produces an error result with `synced: 0` regardless of
 * `syncedCount`, so a failed refresh never gets credited with rows that in
 * fact came from stale, previously-fetched data. Any other status (including
 * `undefined`, when Stripe reports no refresh was attempted) reports the
 * real synced count as `ok`.
 */
export function resultForRefresh(
  accountId: string,
  refreshStatus: string | undefined,
  syncedCount: number,
): AccountSyncResult {
  if (refreshStatus === 'failed') {
    return {
      accountId,
      synced: 0,
      status: 'refresh_failed',
      error: `Transaction refresh failed for account ${accountId}`,
    };
  }
  return { accountId, synced: syncedCount, status: 'ok' };
}

/**
 * Whether `connected_banks.last_sync_at` should be stamped for this run.
 * Only true when at least one account actually completed a successful
 * refresh+fetch (design §4.3.3: "last_sync_at = now() only when the refresh
 * succeeded"). A bank where every account needs reauth, is still
 * subscribing, or whose only refresh attempt failed must not claim it
 * "synced".
 */
export function shouldStampLastSyncAt(results: AccountSyncResult[]): boolean {
  return results.some((r) => r.status === 'ok');
}

/**
 * `data_current_through` = MAX(transaction_date) over the rows actually held
 * for the bank (design §4.3.3), recomputed after insert. Never invents a
 * date: an empty/all-null input returns null rather than `now()`.
 */
export function computeDataCurrentThrough(
  dates: Array<string | Date | null | undefined>,
): string | null {
  let max: number | null = null;
  for (const d of dates) {
    if (!d) continue;
    const t = new Date(d).getTime();
    if (Number.isNaN(t)) continue;
    if (max === null || t > max) max = t;
  }
  return max === null ? null : new Date(max).toISOString();
}
