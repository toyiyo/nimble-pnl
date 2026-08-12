import { describe, it, expect, afterEach, vi } from 'vitest';
import { localWindow } from '@/lib/localDateWindow';

describe('localWindow', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns today-in-tz as endStr and weeks*7 days earlier as startStr (UTC)', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-07-14T12:00:00Z'));
    expect(localWindow('UTC', 18)).toEqual({ startStr: '2026-03-10', endStr: '2026-07-14' });
  });

  it('CRITICAL: uses the restaurant-local calendar day, not the host/UTC day', () => {
    // 2026-07-14T05:00:00Z is already July 14 in UTC, but still July 13 in
    // Honolulu (UTC-10, no DST). A host-date implementation returns the wrong
    // endStr for any non-UTC restaurant. This proof needs the host machine's
    // own timezone to differ from Honolulu — else a host-date implementation
    // would produce the same July 13 result by coincidence and this test
    // would pass without catching the regression it exists to catch.
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).not.toBe('Pacific/Honolulu');

    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-07-14T05:00:00Z'));
    expect(localWindow('Pacific/Honolulu', 4)).toEqual({ startStr: '2026-06-15', endStr: '2026-07-13' });
  });

  it('spans exactly weeks*7 days back for an 18-week window', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-01T12:00:00Z'));
    const { startStr, endStr } = localWindow('UTC', 18);
    expect(endStr).toBe('2026-01-01');
    expect(startStr).toBe('2025-08-28'); // 126 days before 2026-01-01
  });
});
