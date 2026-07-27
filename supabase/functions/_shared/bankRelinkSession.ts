// Pure helpers for `stripe-financial-connections-session`'s relink path. No
// Stripe client, no Supabase client, no fetch — directly unit-testable under
// vitest (mirrors the pattern already used by `_shared/resolveChannels.ts`,
// `_shared/bankReauthStages.ts`, `_shared/bankSyncAccountDecision.ts` and
// `_shared/bankBalanceAsOf.ts`).
//
// See docs/superpowers/specs/2026-07-23-bank-reauth-flow-design.md §4.5.

export interface BaseSessionParams {
  account_holder: { type: 'customer'; customer: string };
  permissions: ('payment_method' | 'balances' | 'transactions')[];
  filters: { countries: string[] };
  return_url: string;
}

export interface RelinkSessionParams extends BaseSessionParams {
  relink_options: { authorization: string };
}

export type SessionMode = 'relink' | 'link';

/**
 * Builds the session-creation params for a relink attempt: the base params
 * plus `relink_options.authorization` set to the bank's own
 * `stripe_financial_account_id` — the only Stripe identifier
 * `connected_banks` stores for the authorization Stripe is being asked to
 * repair (design §4.5). Never mutates `base`.
 */
export function buildRelinkSessionParams(
  base: BaseSessionParams,
  authorizationId: string,
): RelinkSessionParams {
  return { ...base, relink_options: { authorization: authorizationId } };
}

/**
 * True only when the Financial Connections API rejected the `relink_options`
 * parameter itself — the private-beta gate design §4.5 explicitly
 * anticipates ("Fallback (§2 non-goal): the hosted relink API is in private
 * beta. If the `relink_options` parameter is rejected by the API, catch
 * that specific failure and fall back to a normal session").
 *
 * Deliberately narrow: any other failure (auth error, network error,
 * rejection of an unrelated param, a plain non-Stripe exception) returns
 * `false` so the caller re-throws it instead of silently falling back —
 * "catch **that specific failure**", not every failure.
 */
export function isRelinkOptionsRejected(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;

  const err = error as { param?: unknown; message?: unknown };

  if (err.param === 'relink_options') return true;

  if (typeof err.message === 'string' && /\brelink_options\b/.test(err.message)) {
    return true;
  }

  return false;
}

/**
 * The `mode` field the response carries (design §4.5: "Response gains
 * `mode: 'relink' | 'link'` so the UI can word the dialog accurately").
 * Only ever `'relink'` when a relink attempt was actually made *and*
 * succeeded — never invented for the no-`connectedBankId` case or the
 * rejected-then-fell-back case, both of which are `'link'`.
 */
export function resolveSessionMode(
  attemptedRelink: boolean,
  relinkSucceeded: boolean,
): SessionMode {
  return attemptedRelink && relinkSucceeded ? 'relink' : 'link';
}
