/**
 * Tests for offlineQueue.flushQueuedPunches mutex behavior — multiple
 * concurrent flushes triggered from concurrent kiosk punches must not
 * double-send the same queued entries.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: () => ({
      select: () => ({ limit: () => Promise.resolve({ error: null }) }),
    }),
  },
}));

vi.mock('@/hooks/useKioskPins', () => ({
  verifyPinForRestaurant: vi.fn(),
}));

import {
  addQueuedPunch,
  flushQueuedPunches,
  hasQueuedPunches,
  isLikelyOffline,
} from '@/utils/offlineQueue';

const wipeQueue = () => {
  try {
    localStorage.removeItem('kiosk_punch_queue');
  } catch {
    // ignore
  }
};

beforeEach(() => {
  wipeQueue();
});

afterEach(() => {
  wipeQueue();
});

describe('offlineQueue — flushing mutex', () => {
  it('serializes concurrent flushQueuedPunches calls — second call is a no-op while first is in flight', async () => {
    // Seed three queued entries.
    await addQueuedPunch({
      restaurant_id: 'r1',
      employee_id: 'e1',
      punch_type: 'clock_in',
      punch_time: new Date().toISOString(),
    });
    await addQueuedPunch({
      restaurant_id: 'r1',
      employee_id: 'e2',
      punch_type: 'clock_in',
      punch_time: new Date().toISOString(),
    });
    await addQueuedPunch({
      restaurant_id: 'r1',
      employee_id: 'e3',
      punch_type: 'clock_in',
      punch_time: new Date().toISOString(),
    });

    // sendPunch resolves after a deterministic deferred so we can race two
    // flush calls against each other.
    let resolveSend: ((value: unknown) => void) | null = null;
    const sendPunch = vi.fn(
      () =>
        new Promise((resolve) => {
          // Capture the first resolver; subsequent sends resolve immediately.
          if (!resolveSend) {
            resolveSend = resolve;
          } else {
            resolve(null);
          }
        }),
    );

    // Kick off two concurrent flushes.
    const a = flushQueuedPunches(sendPunch);
    const b = flushQueuedPunches(sendPunch);

    // b should resolve first with flushed=0 because the mutex blocked it.
    const bResult = await b;
    expect(bResult.flushed).toBe(0);
    expect(bResult.remaining).toBeGreaterThan(0);

    // Now unblock a — the first send resolves and the loop continues.
    resolveSend!(null);
    const aResult = await a;
    expect(aResult.flushed).toBe(3);
    expect(aResult.remaining).toBe(0);

    // sendPunch was only called by `a` — `b` did not double-send.
    expect(sendPunch).toHaveBeenCalledTimes(3);
  });

  it('addQueuedPunch persists the photoDataUrl so flush can rehydrate it', async () => {
    const blob = new Blob(['x'], { type: 'image/jpeg' });
    await addQueuedPunch(
      {
        restaurant_id: 'r1',
        employee_id: 'e1',
        punch_type: 'clock_in',
        punch_time: new Date().toISOString(),
      },
      blob,
    );

    expect(hasQueuedPunches()).toBe(true);

    const sendPunch = vi.fn(() => Promise.resolve(null));
    const result = await flushQueuedPunches(sendPunch);
    expect(result.flushed).toBe(1);
    expect(sendPunch).toHaveBeenCalledTimes(1);
    const arg = sendPunch.mock.calls[0][0] as { photoBlob?: Blob };
    // photoBlob is rehydrated from the data URL on flush.
    expect(arg.photoBlob).toBeInstanceOf(Blob);
  });

  it('isLikelyOffline reflects navigator.onLine', () => {
    const original = navigator.onLine;
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    expect(isLikelyOffline()).toBe(true);
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    expect(isLikelyOffline()).toBe(false);
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: original });
  });
});
