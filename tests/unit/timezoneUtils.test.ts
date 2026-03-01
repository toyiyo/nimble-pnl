import { describe, it, expect } from 'vitest';
import { localToUTC } from '@/utils/timezoneUtils';

describe('localToUTC', () => {
  it('converts America/Chicago 10:00 to UTC 16:00 in standard time', () => {
    // CST = UTC-6
    const result = localToUTC('2026-01-15', '10:00', 'America/Chicago');
    expect(result).toBe('2026-01-15T16:00:00.000Z');
  });

  it('converts America/Chicago 10:00 to UTC 15:00 in daylight time', () => {
    // CDT = UTC-5 (DST starts second Sunday of March)
    const result = localToUTC('2026-07-15', '10:00', 'America/Chicago');
    expect(result).toBe('2026-07-15T15:00:00.000Z');
  });

  it('converts America/New_York 09:00 to UTC 14:00 in standard time', () => {
    // EST = UTC-5
    const result = localToUTC('2026-01-15', '09:00', 'America/New_York');
    expect(result).toBe('2026-01-15T14:00:00.000Z');
  });

  it('handles UTC timezone as no-op', () => {
    const result = localToUTC('2026-03-01', '14:30', 'UTC');
    expect(result).toBe('2026-03-01T14:30:00.000Z');
  });

  it('handles midnight correctly', () => {
    const result = localToUTC('2026-01-15', '00:00', 'America/Chicago');
    expect(result).toBe('2026-01-15T06:00:00.000Z');
  });

  it('handles 23:59 correctly', () => {
    const result = localToUTC('2026-01-15', '23:59', 'America/Chicago');
    expect(result).toBe('2026-01-16T05:59:00.000Z');
  });
});
