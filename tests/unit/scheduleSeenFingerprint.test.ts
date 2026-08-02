import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  computeScheduleFingerprint,
  scheduleSeenKey,
  readSeenFingerprint,
  writeSeenFingerprint,
  hasScheduleChangedSinceSeen,
  type FingerprintShift,
} from '@/lib/scheduleSeenFingerprint';

const shift = (overrides: Partial<FingerprintShift> = {}): FingerprintShift => ({
  id: 's1',
  start_time: '2026-08-04T14:00:00Z',
  end_time: '2026-08-04T22:00:00Z',
  position: 'Server',
  status: 'scheduled',
  is_published: true,
  ...overrides,
});

const baseline = { publishedAt: '2026-08-01T23:42:00Z', shifts: [shift()] };

describe('computeScheduleFingerprint', () => {
  it('is stable for identical input', () => {
    expect(computeScheduleFingerprint(baseline)).toBe(computeScheduleFingerprint(baseline));
  });

  it('ignores the order rows come back in', () => {
    const a = { publishedAt: null, shifts: [shift({ id: 'a' }), shift({ id: 'b' })] };
    const b = { publishedAt: null, shifts: [shift({ id: 'b' }), shift({ id: 'a' })] };

    // Postgrest ordering is not a schedule change, and treating it as one would
    // pop the pill on every refetch until employees stopped reading it.
    expect(computeScheduleFingerprint(a)).toBe(computeScheduleFingerprint(b));
  });

  it.each([
    ['a republish', { publishedAt: '2026-08-02T10:00:00Z' }],
    ['a shift moving earlier', { shifts: [shift({ start_time: '2026-08-04T12:00:00Z' })] }],
    ['a shift ending later', { shifts: [shift({ end_time: '2026-08-04T23:30:00Z' })] }],
    ['a position change', { shifts: [shift({ position: 'Cook' })] }],
    ['a cancellation', { shifts: [shift({ status: 'cancelled' })] }],
    // The retraction case, and the reason is_published is hashed at all: an
    // unpublish leaves publishedAt and every other field here untouched.
    ['the week being retracted', { shifts: [shift({ is_published: false })] }],
    ['a shift being removed', { shifts: [] }],
    ['a shift being added', { shifts: [shift(), shift({ id: 's2' })] }],
  ])('changes on %s', (_label, overrides) => {
    expect(computeScheduleFingerprint({ ...baseline, ...overrides })).not.toBe(
      computeScheduleFingerprint(baseline)
    );
  });
});

describe('hasScheduleChangedSinceSeen', () => {
  it('does not flag a first-ever view as updated', () => {
    // Nothing has been missed yet; a pill here would just teach people to
    // dismiss it reflexively.
    expect(hasScheduleChangedSinceSeen(null, 'abc')).toBe(false);
  });

  it('flags a week that differs from what was acknowledged', () => {
    expect(hasScheduleChangedSinceSeen('abc', 'def')).toBe(true);
  });

  it('stays quiet when nothing moved', () => {
    expect(hasScheduleChangedSinceSeen('abc', 'abc')).toBe(false);
  });
});

describe('seen storage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('round-trips a fingerprint for the viewed week', () => {
    writeSeenFingerprint('r1', 'e1', '2026-08-03', 'fp1');
    expect(readSeenFingerprint('r1', 'e1', '2026-08-03')).toBe('fp1');
  });

  it('scopes the key to restaurant, employee and week', () => {
    writeSeenFingerprint('r1', 'e1', '2026-08-03', 'fp1');

    expect(readSeenFingerprint('r2', 'e1', '2026-08-03')).toBeNull();
    expect(readSeenFingerprint('r1', 'e2', '2026-08-03')).toBeNull();
    expect(readSeenFingerprint('r1', 'e1', '2026-08-10')).toBeNull();
  });

  it('prunes weeks older than eight weeks on write', () => {
    const now = new Date('2026-08-05T00:00:00Z');

    localStorage.setItem(scheduleSeenKey('r1', 'e1', '2026-05-04'), 'ancient'); // ~13 weeks back
    localStorage.setItem(scheduleSeenKey('r1', 'e1', '2026-07-06'), 'recent'); // ~4 weeks back

    writeSeenFingerprint('r1', 'e1', '2026-08-03', 'fp1', now);

    expect(readSeenFingerprint('r1', 'e1', '2026-05-04')).toBeNull();
    expect(readSeenFingerprint('r1', 'e1', '2026-07-06')).toBe('recent');
    expect(readSeenFingerprint('r1', 'e1', '2026-08-03')).toBe('fp1');
  });

  it('leaves keys belonging to other features alone', () => {
    localStorage.setItem('push_banner_dismissed_at', '2020-01-01');

    writeSeenFingerprint('r1', 'e1', '2026-08-03', 'fp1', new Date('2026-08-05T00:00:00Z'));

    expect(localStorage.getItem('push_banner_dismissed_at')).toBe('2020-01-01');
  });
});

describe('storage unavailable', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');

  afterEach(() => {
    if (original) {
      Object.defineProperty(globalThis, 'localStorage', original);
    } else {
      // No descriptor to put back means the environment had no localStorage at
      // all. Restoring nothing would leave this suite's throwing stub installed
      // for every test file that runs after it in the same worker.
      delete (globalThis as { localStorage?: unknown }).localStorage;
    }
  });

  it('degrades to no pill instead of throwing', () => {
    // Safari private mode and some native webviews throw on the first write,
    // not on property access -- hence the probe write in safeStorage().
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get: () => ({
        setItem: vi.fn(() => {
          throw new DOMException('QuotaExceededError');
        }),
        getItem: vi.fn(),
        removeItem: vi.fn(),
        key: vi.fn(),
        length: 0,
      }),
    });

    expect(() => writeSeenFingerprint('r1', 'e1', '2026-08-03', 'fp1')).not.toThrow();
    expect(readSeenFingerprint('r1', 'e1', '2026-08-03')).toBeNull();
    expect(hasScheduleChangedSinceSeen(null, 'fp1')).toBe(false);
  });
});
