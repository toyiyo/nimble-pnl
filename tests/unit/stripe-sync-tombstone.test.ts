import { describe, it, expect } from 'vitest';
import { filterTombstonedTransactions } from '@/lib/bankTransactionTombstone';

describe('filterTombstonedTransactions', () => {
  it('returns all transactions when no tombstones exist', () => {
    const incoming = [
      { id: 'txn_1', description: 'Test' },
      { id: 'txn_2', description: 'Test 2' },
    ];
    const tombstonedIds = new Set<string>();
    const result = filterTombstonedTransactions(incoming, tombstonedIds);
    expect(result).toHaveLength(2);
    expect(result).toEqual(incoming);
  });

  it('filters out transactions with tombstoned external IDs', () => {
    const incoming = [
      { id: 'txn_1', description: 'Test' },
      { id: 'txn_2', description: 'Deleted' },
      { id: 'txn_3', description: 'Test 3' },
    ];
    const tombstonedIds = new Set(['txn_2']);
    const result = filterTombstonedTransactions(incoming, tombstonedIds);
    expect(result).toHaveLength(2);
    expect(result.map(t => t.id)).toEqual(['txn_1', 'txn_3']);
  });

  it('filters out all transactions if all are tombstoned', () => {
    const incoming = [{ id: 'txn_1', description: 'Test' }];
    const tombstonedIds = new Set(['txn_1']);
    const result = filterTombstonedTransactions(incoming, tombstonedIds);
    expect(result).toHaveLength(0);
  });

  it('handles empty incoming array', () => {
    const incoming: { id: string; description: string }[] = [];
    const tombstonedIds = new Set(['txn_1']);
    const result = filterTombstonedTransactions(incoming, tombstonedIds);
    expect(result).toHaveLength(0);
  });

  it('handles multiple tombstoned IDs efficiently', () => {
    const incoming = [
      { id: 'txn_1', amount: 100 },
      { id: 'txn_2', amount: 200 },
      { id: 'txn_3', amount: 300 },
      { id: 'txn_4', amount: 400 },
      { id: 'txn_5', amount: 500 },
    ];
    const tombstonedIds = new Set(['txn_2', 'txn_4']);
    const result = filterTombstonedTransactions(incoming, tombstonedIds);
    expect(result).toHaveLength(3);
    expect(result.map(t => t.id)).toEqual(['txn_1', 'txn_3', 'txn_5']);
  });

  it('preserves original transaction objects without mutation', () => {
    const txn1 = { id: 'txn_1', description: 'Test', extra: { nested: true } };
    const txn2 = { id: 'txn_2', description: 'Deleted' };
    const incoming = [txn1, txn2];
    const tombstonedIds = new Set(['txn_2']);
    const result = filterTombstonedTransactions(incoming, tombstonedIds);
    expect(result[0]).toBe(txn1); // Same reference, not a copy
  });
});
