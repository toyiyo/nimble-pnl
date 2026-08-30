import { PendingOutflowMatch } from '@/types/pending-outflows';

const AUTO_LINK_THRESHOLD = 70;

/**
 * Reduce raw match candidates to the single best match per bank
 * transaction. Drops matches below the auto-link threshold and keeps
 * the highest-scoring pending outflow when several tie for one
 * transaction.
 */
export function selectBestMatchPerTransaction(
  matches: PendingOutflowMatch[]
): PendingOutflowMatch[] {
  const bestByTransaction = new Map<string, PendingOutflowMatch>();

  for (const match of matches) {
    if (match.match_score < AUTO_LINK_THRESHOLD) continue;

    const current = bestByTransaction.get(match.bank_transaction_id);
    if (!current || match.match_score > current.match_score) {
      bestByTransaction.set(match.bank_transaction_id, match);
    }
  }

  return Array.from(bestByTransaction.values());
}
