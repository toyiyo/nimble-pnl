/**
 * Tests for src/lib/shiftTradeStatus.ts
 *
 * isTradeExpired(startTimeIso, now) — pure, injected `now` for determinism.
 */

import { describe, it, expect } from 'vitest';
import { isTradeExpired } from '@/lib/shiftTradeStatus';

describe('isTradeExpired', () => {
  const now = new Date('2026-07-01T12:00:00.000Z');

  it('returns true when the shift start_time is in the past', () => {
    expect(isTradeExpired('2026-07-01T11:59:59.999Z', now)).toBe(true);
  });

  it('returns true when the shift start_time is well in the past', () => {
    expect(isTradeExpired('2026-06-01T08:00:00.000Z', now)).toBe(true);
  });

  it('returns false when the shift start_time is in the future', () => {
    expect(isTradeExpired('2026-07-01T12:00:00.001Z', now)).toBe(false);
  });

  it('returns false when the shift start_time is exactly equal to now (not strictly past)', () => {
    expect(isTradeExpired('2026-07-01T12:00:00.000Z', now)).toBe(false);
  });

  it('returns false when startTimeIso is undefined', () => {
    expect(isTradeExpired(undefined, now)).toBe(false);
  });
});
