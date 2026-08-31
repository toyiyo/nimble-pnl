import { PendingOutflowMatch } from '@/types/pending-outflows';

// Minimum score for a one-click match suggestion in the transaction
// list. This gates the UI suggestion only — the SQL auto-link in
// auto_link_pending_outflows_internal uses its own deterministic
// criteria and never reads this value.
const MATCH_SUGGESTION_THRESHOLD = 70;

/**
 * Reduce raw match candidates to the single best match per bank
 * transaction. Drops matches below the suggestion threshold and keeps
 * the highest-scoring pending outflow when several tie for one
 * transaction.
 */
export function selectBestMatchPerTransaction(
  matches: PendingOutflowMatch[]
): PendingOutflowMatch[] {
  const bestByTransaction = new Map<string, PendingOutflowMatch>();

  for (const match of matches) {
    if (match.match_score < MATCH_SUGGESTION_THRESHOLD) continue;

    const current = bestByTransaction.get(match.bank_transaction_id);
    if (!current || match.match_score > current.match_score) {
      bestByTransaction.set(match.bank_transaction_id, match);
    }
  }

  return Array.from(bestByTransaction.values());
}
