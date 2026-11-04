import { describe, it, expect } from 'vitest';

import { depositMatchQueryKey } from '@/hooks/useDepositMatch';

describe('depositMatchQueryKey', () => {
  it('shapes the key as [deposit-match, restaurantId, start, end]', () => {
    expect(depositMatchQueryKey('rest-1', '2026-08-01', '2026-08-31')).toEqual([
      'deposit-match',
      'rest-1',
      '2026-08-01',
      '2026-08-31',
    ]);
  });

  // React Query hashes an array key with JSON.stringify, which serializes
  // an undefined entry as null — so a null-arg call and an undefined-arg
  // call land on the SAME cache key. This test only checks that the
  // helper passes each raw arg through unchanged; it makes no claim about
  // cache isolation between the two.
  it('carries a null or undefined restaurant/range through unchanged, as its own raw tuple', () => {
    expect(depositMatchQueryKey(null, null, null)).toEqual(['deposit-match', null, null, null]);
    expect(depositMatchQueryKey(undefined, undefined, undefined)).toEqual([
      'deposit-match',
      undefined,
      undefined,
      undefined,
    ]);
  });

  it('produces a different key for a different restaurant, so a switch cannot show stale data', () => {
    const keyA = depositMatchQueryKey('rest-1', '2026-08-01', '2026-08-31');
    const keyB = depositMatchQueryKey('rest-2', '2026-08-01', '2026-08-31');
    expect(keyA).not.toEqual(keyB);
  });

  it('produces a different key for a different range on the same restaurant', () => {
    const keyA = depositMatchQueryKey('rest-1', '2026-08-01', '2026-08-31');
    const keyB = depositMatchQueryKey('rest-1', '2026-07-01', '2026-07-31');
    expect(keyA).not.toEqual(keyB);
  });
});
