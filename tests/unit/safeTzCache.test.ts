import { describe, it, expect, vi, afterEach } from 'vitest';
import { safeTz, DEFAULT_TIMEZONE } from '../../supabase/functions/_shared/timezone';

afterEach(() => vi.restoreAllMocks());

describe('safeTz', () => {
  it('builds the check formatter once per zone, not on each call', () => {
    const spy = vi.spyOn(Intl, 'DateTimeFormat');
    // A zone that no other test in this file uses, so the cache starts empty for it.
    for (let i = 0; i < 50; i++) safeTz('Pacific/Chatham');
    expect(spy.mock.calls.filter((c) => (c[1] as Intl.DateTimeFormatOptions)?.timeZone === 'Pacific/Chatham').length)
      .toBe(1);
  });

  it('keeps the same results', () => {
    expect(safeTz('America/New_York')).toBe('America/New_York');
    expect(safeTz('Bad/Zone')).toBe(DEFAULT_TIMEZONE);
    expect(safeTz('Bad/Zone')).toBe(DEFAULT_TIMEZONE);
    expect(safeTz('')).toBe(DEFAULT_TIMEZONE);
    expect(safeTz(null)).toBe(DEFAULT_TIMEZONE);
  });
});
