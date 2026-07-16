import { describe, it, expect, vi } from 'vitest';
import {
  selectBroadcastPushUserIds,
  runBounded,
} from '../../supabase/functions/_shared/webPushFanout';

describe('selectBroadcastPushUserIds', () => {
  it('drops employees with null or undefined user_id', () => {
    const employees = [
      { user_id: 'user-1' },
      { user_id: null },
      { user_id: undefined },
      {},
    ];

    expect(selectBroadcastPushUserIds(employees)).toEqual(['user-1']);
  });

  it('excludes the given excludeUserId', () => {
    const employees = [{ user_id: 'user-1' }, { user_id: 'user-2' }, { user_id: 'user-3' }];

    expect(selectBroadcastPushUserIds(employees, 'user-2')).toEqual(['user-1', 'user-3']);
  });

  it('dedupes duplicate user_ids', () => {
    const employees = [
      { user_id: 'user-1' },
      { user_id: 'user-1' },
      { user_id: 'user-2' },
    ];

    expect(selectBroadcastPushUserIds(employees)).toEqual(['user-1', 'user-2']);
  });

  it('keeps all users when excludeUserId is null or undefined', () => {
    const employees = [{ user_id: 'user-1' }, { user_id: 'user-2' }];

    expect(selectBroadcastPushUserIds(employees, null)).toEqual(['user-1', 'user-2']);
    expect(selectBroadcastPushUserIds(employees, undefined)).toEqual(['user-1', 'user-2']);
  });

  it('returns an empty array for empty input', () => {
    expect(selectBroadcastPushUserIds([])).toEqual([]);
  });
});

describe('runBounded', () => {
  it('runs the worker exactly once per item', async () => {
    const items = ['a', 'b', 'c'];
    const worker = vi.fn().mockResolvedValue(undefined);

    await runBounded(items, worker);

    expect(worker).toHaveBeenCalledTimes(3);
    expect(worker).toHaveBeenCalledWith('a');
    expect(worker).toHaveBeenCalledWith('b');
    expect(worker).toHaveBeenCalledWith('c');
  });

  it('keeps maxInFlight <= concurrency', async () => {
    const items = Array.from({ length: 5 }, (_, i) => `item-${i}`);

    let inFlight = 0;
    let maxInFlight = 0;
    const worker = vi.fn().mockImplementation(async (item: string) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return item;
    });

    await runBounded(items, worker, 2);

    expect(worker).toHaveBeenCalledTimes(5);
    expect(maxInFlight).toBeLessThanOrEqual(2);
  });

  it('does not throw when a worker rejects (Promise.allSettled semantics)', async () => {
    const items = ['a', 'b'];
    const worker = vi
      .fn()
      .mockRejectedValueOnce(new Error('worker failed'))
      .mockResolvedValueOnce(undefined);

    await expect(runBounded(items, worker)).resolves.toBeUndefined();
    expect(worker).toHaveBeenCalledTimes(2);
  });

  it('clamps non-positive concurrency to >= 1 and still completes (no hang)', async () => {
    const items = ['a', 'b'];
    const worker = vi.fn().mockResolvedValue(undefined);

    for (const concurrency of [0, -5]) {
      worker.mockClear();
      await runBounded(items, worker, concurrency);
      expect(worker).toHaveBeenCalledTimes(2);
    }
  });
});
