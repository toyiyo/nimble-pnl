import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { zonedNaiveToUtc, safeTz, tzOffsetMs, resolveRestaurantTimeZone } from '../../supabase/functions/_shared/timezone';

// All assertions compare against explicit UTC ISO strings (via Date.UTC / toISOString)
// so they are TZ-portable and do not depend on the host machine's local timezone.

describe('zonedNaiveToUtc', () => {
  it('converts a naive America/Chicago datetime in CDT (summer, UTC-5)', () => {
    const result = zonedNaiveToUtc('2026-07-19T07:32:16', 'America/Chicago');
    expect(result.toISOString()).toBe('2026-07-19T12:32:16.000Z');
  });

  it('converts a naive America/Chicago datetime in CST (winter, UTC-6)', () => {
    const result = zonedNaiveToUtc('2026-01-15T07:32:16', 'America/Chicago');
    expect(result.toISOString()).toBe('2026-01-15T13:32:16.000Z');
  });

  it('tolerates naive timestamps with fractional seconds (truncates to whole seconds)', () => {
    // A POS feed may include milliseconds (e.g. Toast-style ".071"). The helper
    // must not return NaN here — a NaN would make the caller silently store a
    // NULL sold_at / order_time, reintroducing the very data-loss this fixes.
    const result = zonedNaiveToUtc('2026-07-19T07:32:16.071', 'America/Chicago');
    expect(result.toISOString()).toBe('2026-07-19T12:32:16.000Z');
  });

  it('tolerates a naive timestamp with no seconds component', () => {
    const result = zonedNaiveToUtc('2026-07-19T07:32', 'America/Chicago');
    expect(result.toISOString()).toBe('2026-07-19T12:32:00.000Z');
  });

  it('CRITICAL: handles the DST spring-forward transition day (2026-03-08) correctly on either side', () => {
    // 2026-03-08 02:00 local -> 03:00 local in America/Chicago (spring forward).
    // Before the transition (still CST, UTC-6):
    const before = zonedNaiveToUtc('2026-03-08T01:30:00', 'America/Chicago');
    expect(before.toISOString()).toBe('2026-03-08T07:30:00.000Z');

    // After the transition (now CDT, UTC-5):
    const after = zonedNaiveToUtc('2026-03-08T10:00:00', 'America/Chicago');
    expect(after.toISOString()).toBe('2026-03-08T15:00:00.000Z');
  });

  it('CRITICAL: handles the 3:00-7:59 AM local window on spring-forward day (single-pass offset probe bug)', () => {
    // Regression for a single-pass offset-probe bug: the naive-as-UTC "guess"
    // instant for 03:30 local (03:30Z) falls BEFORE the 08:00Z transition, so
    // a single formatToParts probe at the guess reads the pre-transition CST
    // offset (-6h) even though the intended wall-clock time is post-transition
    // CDT (-5h) — corrupting the result by 1h (previously returned
    // 2026-03-08T09:30:00.000Z, i.e. local 04:30, instead of 08:30:00.000Z).
    const result = zonedNaiveToUtc('2026-03-08T03:30:00', 'America/Chicago');
    expect(result.toISOString()).toBe('2026-03-08T08:30:00.000Z');

    // A second point in the same previously-broken window, near the low end.
    const result2 = zonedNaiveToUtc('2026-03-08T03:01:00', 'America/Chicago');
    expect(result2.toISOString()).toBe('2026-03-08T08:01:00.000Z');

    // Near the high end of the window (just before 8 AM local).
    const result3 = zonedNaiveToUtc('2026-03-08T07:59:00', 'America/Chicago');
    expect(result3.toISOString()).toBe('2026-03-08T12:59:00.000Z');
  });

  it('falls back to America/Chicago for an empty timezone string, no throw', () => {
    expect(() => zonedNaiveToUtc('2026-07-19T07:32:16', '')).not.toThrow();
    const result = zonedNaiveToUtc('2026-07-19T07:32:16', '');
    expect(result.toISOString()).toBe('2026-07-19T12:32:16.000Z');
  });

  it('falls back to America/Chicago for an invalid/bogus timezone string, no throw', () => {
    expect(() => zonedNaiveToUtc('2026-07-19T07:32:16', 'Bogus/Zone')).not.toThrow();
    const result = zonedNaiveToUtc('2026-07-19T07:32:16', 'Bogus/Zone');
    expect(result.toISOString()).toBe('2026-07-19T12:32:16.000Z');
  });

  it('falls back to America/Chicago for a null/undefined timezone, no throw', () => {
    // zonedNaiveToUtc's timeZone param is typed `string | null | undefined`,
    // so this is exercising a real (non-error) runtime branch, not a type error.
    const result = zonedNaiveToUtc('2026-01-15T07:32:16', null);
    expect(result.toISOString()).toBe('2026-01-15T13:32:16.000Z');
  });

  it('parses a space-separated naive datetime the same as a T-separated one', () => {
    const result = zonedNaiveToUtc('2026-07-19 07:32:16', 'America/Chicago');
    expect(result.toISOString()).toBe('2026-07-19T12:32:16.000Z');
  });

  it('defaults seconds to :00 when omitted', () => {
    const result = zonedNaiveToUtc('2026-07-19T07:32', 'America/Chicago');
    expect(result.toISOString()).toBe('2026-07-19T12:32:00.000Z');
  });

  it('returns an invalid Date for an unparseable naive string, no throw', () => {
    expect(() => zonedNaiveToUtc('not-a-date', 'America/Chicago')).not.toThrow();
    const result = zonedNaiveToUtc('not-a-date', 'America/Chicago');
    expect(Number.isNaN(result.getTime())).toBe(true);
  });
});

describe('safeTz', () => {
  it('passes through a valid IANA timezone', () => {
    expect(safeTz('America/New_York')).toBe('America/New_York');
  });

  it('falls back to America/Chicago for an invalid timezone', () => {
    expect(safeTz('Bogus/Zone')).toBe('America/Chicago');
  });

  it('falls back to America/Chicago for an empty string', () => {
    expect(safeTz('')).toBe('America/Chicago');
  });

  it('falls back to America/Chicago for null/undefined', () => {
    expect(safeTz(null)).toBe('America/Chicago');
    expect(safeTz(undefined)).toBe('America/Chicago');
  });
});

describe('tzOffsetMs', () => {
  it('returns -5h in ms for America/Chicago during CDT', () => {
    const date = new Date(Date.UTC(2026, 6, 19, 12, 0, 0)); // July -> CDT
    expect(tzOffsetMs(date, 'America/Chicago')).toBe(-5 * 60 * 60 * 1000);
  });

  it('returns -6h in ms for America/Chicago during CST', () => {
    const date = new Date(Date.UTC(2026, 0, 15, 12, 0, 0)); // January -> CST
    expect(tzOffsetMs(date, 'America/Chicago')).toBe(-6 * 60 * 60 * 1000);
  });

  it('returns 0 for UTC', () => {
    const date = new Date(Date.UTC(2026, 0, 15, 12, 0, 0));
    expect(tzOffsetMs(date, 'UTC')).toBe(0);
  });
});

// Stub matching the `.from().select().eq().maybeSingle()` chain the Revel
// callers use (revel-webhook / revel-sync-data / revel-bulk-sync), so this
// is testable in Node without a Deno/supabase-js import.
function makeSupabaseStub(
  result: { data: { timezone: string | null } | null; error: { message: string } | null },
): Parameters<typeof resolveRestaurantTimeZone>[0] {
  return {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(() => Promise.resolve(result)),
        })),
      })),
    })),
  };
}

describe('resolveRestaurantTimeZone', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('returns the restaurant timezone when set and valid', async () => {
    const supabase = makeSupabaseStub({ data: { timezone: 'America/New_York' }, error: null });
    const tz = await resolveRestaurantTimeZone(supabase, 'r1');
    expect(tz).toBe('America/New_York');
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('falls back to America/Chicago and warns when timezone is null', async () => {
    const supabase = makeSupabaseStub({ data: { timezone: null }, error: null });
    const tz = await resolveRestaurantTimeZone(supabase, 'r1');
    expect(tz).toBe('America/Chicago');
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain('r1');
  });

  it('falls back to America/Chicago and warns when the row is missing', async () => {
    const supabase = makeSupabaseStub({ data: null, error: null });
    const tz = await resolveRestaurantTimeZone(supabase, 'r1');
    expect(tz).toBe('America/Chicago');
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('falls back to America/Chicago and warns when the query errors', async () => {
    const supabase = makeSupabaseStub({ data: null, error: { message: 'boom' } });
    const tz = await resolveRestaurantTimeZone(supabase, 'r1');
    expect(tz).toBe('America/Chicago');
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('falls back to America/Chicago and warns when the stored timezone is invalid', async () => {
    const supabase = makeSupabaseStub({ data: { timezone: 'Bogus/Zone' }, error: null });
    const tz = await resolveRestaurantTimeZone(supabase, 'r1');
    expect(tz).toBe('America/Chicago');
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });
});
