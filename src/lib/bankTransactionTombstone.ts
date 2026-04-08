/**
 * Client-side fingerprint computation for bank transactions.
 *
 * IMPORTANT: This must produce the SAME normalised components as the SQL function
 * `compute_transaction_fingerprint` in the tombstone migration.  The SQL version
 * returns an MD5 hash — this TypeScript version returns a plain-text fingerprint
 * that is useful for local comparisons and unit-testing.  For tombstone look-ups
 * against the database, always call the SQL function via RPC so the hashing is
 * identical.
 */

/**
 * Compute a deterministic fingerprint string from transaction fields.
 *
 * The normalisation rules mirror the SQL function:
 *   1. description is trimmed, lower-cased, and non-alphanumeric chars (except spaces) are removed
 *   2. amount is converted to integer cents
 *   3. direction is 'credit' (>= 0) or 'debit' (< 0)
 *
 * Returns a pipe-delimited string:  date|amountCents|direction|normalisedDescription
 */
export function computeTransactionFingerprint(
  transactionDate: string,
  amount: number,
  description: string,
): string {
  const normalizedDesc = (description || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, '');
  const amountCents = Math.round(amount * 100);
  const direction = amount >= 0 ? 'credit' : 'debit';
  return `${transactionDate}|${amountCents}|${direction}|${normalizedDesc}`;
}

/**
 * Filter out transactions whose external IDs match tombstone records.
 * Used by Stripe sync to skip re-importing deleted transactions.
 *
 * Note: The Stripe sync edge function (Deno) implements the same logic inline
 * since it cannot import from `src/lib/`. This function documents the pattern
 * and is validated via unit tests.
 *
 * @param incoming - Array of transactions with an `id` field (e.g. Stripe transaction ID)
 * @param tombstonedExternalIds - Set of external IDs that have been deleted
 * @returns Filtered array excluding tombstoned transactions
 */
export function filterTombstonedTransactions<T extends { id: string }>(
  incoming: T[],
  tombstonedExternalIds: Set<string>,
): T[] {
  if (tombstonedExternalIds.size === 0) return incoming;
  return incoming.filter((txn) => !tombstonedExternalIds.has(txn.id));
}
