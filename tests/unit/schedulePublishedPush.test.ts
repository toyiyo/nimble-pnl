import { describe, it, expect, vi } from 'vitest';
import {
  notifySchedulePublishedPush,
  type SchedulePushEmployee,
} from '../../supabase/functions/_shared/schedulePublishedPush';

describe('notifySchedulePublishedPush', () => {
  it('sends once per employee that has a user_id', async () => {
    const employees: SchedulePushEmployee[] = [
      { user_id: 'user-1' },
      { user_id: 'user-2' },
    ];
    const send = vi.fn().mockResolvedValue(undefined);

    const result = await notifySchedulePublishedPush(employees, send);

    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenCalledWith('user-1');
    expect(send).toHaveBeenCalledWith('user-2');
    expect(result).toEqual({ attempted: 2 });
  });

  it('skips employees without a user_id', async () => {
    const employees: SchedulePushEmployee[] = [
      { user_id: 'user-1' },
      { user_id: null },
      { user_id: undefined },
      {},
    ];
    const send = vi.fn().mockResolvedValue(undefined);

    const result = await notifySchedulePublishedPush(employees, send);

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith('user-1');
    expect(result).toEqual({ attempted: 1 });
  });

  it('does not throw when a send rejects (Promise.allSettled semantics)', async () => {
    const employees: SchedulePushEmployee[] = [
      { user_id: 'user-1' },
      { user_id: 'user-2' },
    ];
    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error('push failed'))
      .mockResolvedValueOnce(undefined);

    await expect(notifySchedulePublishedPush(employees, send)).resolves.toEqual({
      attempted: 2,
    });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('fans out in bounded concurrency chunks but still sends to every target', async () => {
    const employees: SchedulePushEmployee[] = Array.from({ length: 5 }, (_, i) => ({
      user_id: `user-${i}`,
    }));

    let inFlight = 0;
    let maxInFlight = 0;
    const send = vi.fn().mockImplementation(async (userId: string) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return userId;
    });

    const result = await notifySchedulePublishedPush(employees, send, 2);

    expect(send).toHaveBeenCalledTimes(5);
    expect(result).toEqual({ attempted: 5 });
    expect(maxInFlight).toBeLessThanOrEqual(2);
  });

  it('does not hang on a non-positive concurrency (clamps step to >= 1)', async () => {
    const employees: SchedulePushEmployee[] = [
      { user_id: 'user-1' },
      { user_id: 'user-2' },
    ];
    const send = vi.fn().mockResolvedValue(undefined);

    // A 0/negative step would spin forever without the Math.max(1, …) guard.
    for (const concurrency of [0, -5]) {
      send.mockClear();
      const result = await notifySchedulePublishedPush(employees, send, concurrency);
      expect(send).toHaveBeenCalledTimes(2);
      expect(result).toEqual({ attempted: 2 });
    }
  });
});
