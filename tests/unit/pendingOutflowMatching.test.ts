import { describe, it, expect } from 'vitest';
import { selectBestMatchPerTransaction } from '@/lib/pendingOutflowMatching';
import { PendingOutflowMatch } from '@/types/pending-outflows';

function makeMatch(overrides: Partial<PendingOutflowMatch>): PendingOutflowMatch {
  return {
    pending_outflow_id: 'po-1',
    bank_transaction_id: 'bt-1',
    match_score: 100,
    amount_delta: 0,
    date_delta: 0,
    payee_similarity: 'exact',
    ...overrides,
  };
}

describe('selectBestMatchPerTransaction', () => {
  it('returns an empty array for empty input', () => {
    expect(selectBestMatchPerTransaction([])).toEqual([]);
  });

  it('drops a match below the 70 threshold', () => {
    const matches = [makeMatch({ match_score: 69.9 })];
    expect(selectBestMatchPerTransaction(matches)).toEqual([]);
  });

  it('keeps a match exactly at the 70 threshold', () => {
    const matches = [makeMatch({ match_score: 70 })];
    expect(selectBestMatchPerTransaction(matches)).toEqual(matches);
  });

  it('groups by bank_transaction_id and keeps only the top score', () => {
    const low = makeMatch({ pending_outflow_id: 'po-1', bank_transaction_id: 'bt-1', match_score: 75 });
    const high = makeMatch({ pending_outflow_id: 'po-2', bank_transaction_id: 'bt-1', match_score: 90 });
    const other = makeMatch({ pending_outflow_id: 'po-3', bank_transaction_id: 'bt-2', match_score: 80 });

    const result = selectBestMatchPerTransaction([low, high, other]);

    expect(result).toHaveLength(2);
    expect(result).toContainEqual(high);
    expect(result).toContainEqual(other);
    expect(result.find((m) => m.bank_transaction_id === 'bt-1')?.pending_outflow_id).toBe('po-2');
  });

  it('keeps the highest score when scores tie for a transaction', () => {
    const first = makeMatch({ pending_outflow_id: 'po-1', bank_transaction_id: 'bt-1', match_score: 85 });
    const tie = makeMatch({ pending_outflow_id: 'po-2', bank_transaction_id: 'bt-1', match_score: 85 });

    const result = selectBestMatchPerTransaction([first, tie]);

    expect(result).toHaveLength(1);
    expect(result[0].match_score).toBe(85);
  });
});
