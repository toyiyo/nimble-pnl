import { describe, it, expect } from 'vitest';
import { formatDateTime } from '../../supabase/functions/_shared/emailTemplates';

/**
 * Task 4 — Email renders restaurant timezone.
 *
 * formatDateTime must accept an optional `timeZone` param. The same UTC
 * instant must produce different wall-clock strings in different timezones,
 * and omitting the param must remain backward-compatible.
 */
describe('formatDateTime', () => {
  // 2026-01-15 12:00:00 UTC
  // America/Chicago (UTC-6 in Jan) → 6:00 AM
  // America/New_York (UTC-5 in Jan) → 7:00 AM
  const UTC_ISO = '2026-01-15T12:00:00.000Z';

  it('renders in America/Chicago when timezone is specified', () => {
    const result = formatDateTime(UTC_ISO, 'America/Chicago');
    // 12:00 UTC − 6h = 6:00 AM CST
    expect(result).toContain('6:00 AM');
  });

  it('renders in America/New_York when timezone is specified', () => {
    const result = formatDateTime(UTC_ISO, 'America/New_York');
    // 12:00 UTC − 5h = 7:00 AM EST
    expect(result).toContain('7:00 AM');
  });

  it('same instant produces different strings for Chicago vs New York', () => {
    const chicago = formatDateTime(UTC_ISO, 'America/Chicago');
    const newYork = formatDateTime(UTC_ISO, 'America/New_York');
    expect(chicago).not.toBe(newYork);
  });

  it('omitting timeZone is backward-compatible (returns a non-empty string)', () => {
    const result = formatDateTime(UTC_ISO);
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
    // Must still include the day and year
    expect(result).toContain('2026');
    expect(result).toContain('Jan');
  });

  it('accepts a Date object as well as a string', () => {
    const date = new Date(UTC_ISO);
    const result = formatDateTime(date, 'America/Chicago');
    expect(result).toContain('6:00 AM');
  });
});
