// Pure helper for `stripe-refresh-balance` and the `refreshed_balance` webhook
// branch. No Stripe client, no Supabase client, no fetch — directly
// unit-testable under vitest (mirrors the pattern already used by
// `_shared/resolveChannels.ts`, `_shared/bankReauthStages.ts` and
// `_shared/bankSyncAccountDecision.ts`).
//
// See docs/superpowers/specs/2026-07-23-bank-reauth-flow-design.md §4.4.

/**
 * Computes the `as_of_date` value to write for a `bank_account_balances`
 * row, from Stripe's own `balance.as_of` (a Unix timestamp in seconds on the
 * account's `balance` object).
 *
 * Returns `undefined` — never `now()` — when Stripe doesn't supply one, so
 * callers can omit the `as_of_date` key from their update/upsert payload
 * entirely and leave whatever value is already persisted untouched. Never
 * invents a date (design §4.4).
 */
export function computeAsOfDate(
  stripeAsOfSeconds: number | null | undefined,
): string | undefined {
  if (stripeAsOfSeconds === null || stripeAsOfSeconds === undefined) {
    return undefined;
  }
  return new Date(stripeAsOfSeconds * 1000).toISOString();
}
