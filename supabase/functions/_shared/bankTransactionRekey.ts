// Pure planner for the store step of `stripe-sync-transactions`.
// No Stripe client, no Supabase client, no fetch. Directly unit-testable
// under vitest (same pattern as `_shared/bankSyncAccountDecision.ts`).
//
// A new Stripe transaction re-keys an existing orphan row when the Stripe
// values match. See docs/superpowers/specs/2026-11-05-bank-reconnect-dedupe-design.md.

/** Projection for the page read of bank rows. Aliases avoid the real columns. */
export const BANK_ROW_MATCH_SELECT =
  'id, stripe_transaction_id, created_at, ta:raw_data->>transacted_at, amt:raw_data->>amount, descr:raw_data->>description';

/** Maximum re-keys (rows and tombstones together) for one run. */
export const MAX_REKEYS_PER_RUN = 500;

export interface StripeTxn {
  id: string;
  account?: string;
  transacted_at: number;
  amount: number;
  description?: string | null;
  [key: string]: unknown;
}

export interface BankRowMatch {
  id: string;
  stripe_transaction_id: string;
  created_at: string;
  ta: string | number | null;
  amt: string | number | null;
  descr: string | null;
}

export interface TombstoneMatch {
  id: string;
  external_transaction_id: string | null;
  transaction_date: string | null;
  amount: number | string | null;
  description: string | null;
  source: string | null;
  connected_bank_id: string | null;
}

export type StoreDecision =
  | { kind: 'skip_existing'; txn: StripeTxn }
  | { kind: 'skip_tombstoned'; txn: StripeTxn }
  | { kind: 'rekey_row'; txn: StripeTxn; rowId: string; previousStripeId: string }
  | { kind: 'rekey_tombstone'; txn: StripeTxn; tombstoneId: string }
  | { kind: 'defer_rekey'; txn: StripeTxn }
  | { kind: 'insert'; txn: StripeTxn };

function toNumber(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Key for a bank row, from the Stripe values. Null when a value is missing. */
export function rowKey(
  transactedAt: string | number | null | undefined,
  amount: string | number | null | undefined,
  description: string | null | undefined,
): string | null {
  const ta = toNumber(transactedAt);
  const amt = toNumber(amount);
  if (ta === null || amt === null) return null;
  return JSON.stringify([ta, amt, description ?? null]);
}

/** Same normalization as `compute_transaction_fingerprint`. */
function normalizeDescription(description: string | null | undefined): string {
  return (description ?? '').toLowerCase().trim().replace(/[^a-z0-9 ]/g, '');
}

function utcDate(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const d = new Date(typeof value === 'number' ? value * 1000 : value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/**
 * Key for a tombstone. `amountDollars` is in dollars. The key uses cents.
 * `date` is a DATE string or an ISO instant.
 */
export function tombstoneKey(
  date: string | number | null | undefined,
  amountDollars: string | number | null | undefined,
  description: string | null | undefined,
): string | null {
  const d = utcDate(date);
  const amt = toNumber(amountDollars);
  if (d === null || amt === null) return null;
  return JSON.stringify([d, Math.round(amt * 100), normalizeDescription(description)]);
}

function txnTombstoneKey(txn: StripeTxn): string | null {
  const d = utcDate(txn.transacted_at);
  const amt = toNumber(txn.amount);
  if (d === null || amt === null) return null;
  return JSON.stringify([d, Math.round(amt), normalizeDescription(txn.description)]);
}

export interface PlanInput {
  txns: StripeTxn[];
  rows: BankRowMatch[];
  tombstones: TombstoneMatch[];
  bankId: string;
}

/** Returns one decision for each Stripe transaction, in input order. */
export function planTransactionStore(input: PlanInput): StoreDecision[] {
  const { txns, rows, tombstones, bankId } = input;
  const stripeIds = new Set(txns.map((t) => t.id));
  const rowIds = new Set(rows.map((r) => r.stripe_transaction_id));
  const tombIds = new Set(
    tombstones.map((t) => t.external_transaction_id).filter((x): x is string => !!x),
  );

  // Orphan rows, oldest first, grouped by key.
  const rowPools = new Map<string, BankRowMatch[]>();
  const sortedRows = [...rows].sort((a, b) =>
    a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  for (const r of sortedRows) {
    if (stripeIds.has(r.stripe_transaction_id)) continue;
    const k = rowKey(r.ta, r.amt, r.descr);
    if (k === null) continue;
    const pool = rowPools.get(k);
    if (pool) pool.push(r);
    else rowPools.set(k, [r]);
  }

  // Orphan tombstones, grouped by key.
  const tombPools = new Map<string, TombstoneMatch[]>();
  const sortedTombs = [...tombstones].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const t of sortedTombs) {
    const ext = t.external_transaction_id;
    if (!ext || !ext.startsWith('fctxn_')) continue;
    if (t.source !== 'bank_integration' || t.connected_bank_id !== bankId) continue;
    if (stripeIds.has(ext)) continue;
    const k = tombstoneKey(t.transaction_date, t.amount, t.description);
    if (k === null) continue;
    const pool = tombPools.get(k);
    if (pool) pool.push(t);
    else tombPools.set(k, [t]);
  }

  let rekeys = 0;
  const decisions: StoreDecision[] = [];
  for (const txn of txns) {
    if (rowIds.has(txn.id)) {
      decisions.push({ kind: 'skip_existing', txn });
      continue;
    }
    if (tombIds.has(txn.id)) {
      decisions.push({ kind: 'skip_tombstoned', txn });
      continue;
    }
    const rk = rowKey(txn.transacted_at, txn.amount, txn.description);
    const rowPool = rk === null ? undefined : rowPools.get(rk);
    const tk = txnTombstoneKey(txn);
    const tombPool = tk === null ? undefined : tombPools.get(tk);
    const hasRow = !!rowPool && rowPool.length > 0;
    const hasTomb = !hasRow && !!tombPool && tombPool.length > 0;

    if (!hasRow && !hasTomb) {
      decisions.push({ kind: 'insert', txn });
      continue;
    }
    if (rekeys >= MAX_REKEYS_PER_RUN) {
      decisions.push({ kind: 'defer_rekey', txn });
      continue;
    }
    rekeys++;
    if (hasRow) {
      const r = rowPool!.shift()!;
      decisions.push({
        kind: 'rekey_row',
        txn,
        rowId: r.id,
        previousStripeId: r.stripe_transaction_id,
      });
    } else {
      const t = tombPool!.shift()!;
      decisions.push({ kind: 'rekey_tombstone', txn, tombstoneId: t.id });
    }
  }
  return decisions;
}
