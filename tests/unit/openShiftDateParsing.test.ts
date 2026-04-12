import { describe, it, expect } from 'vitest';
import { format } from 'date-fns';

/**
 * Reproduces the date-off-by-one bug in open shift claiming.
 *
 * Root cause: `new Date("2026-04-10")` and `parseISO("2026-04-10")` parse
 * date-only strings as UTC midnight. In timezones behind UTC (e.g., CDT = UTC-5),
 * this displays as the previous day (April 9 instead of April 10).
 *
 * The fix uses parseDateLocal() which splits the string and creates a local Date.
 */

// This is the broken pattern used in TradeApprovalQueue, OpenShiftCard, and AvailableShiftsPage
function brokenDateParse(dateStr: string): Date {
  return new Date(dateStr);
}

import { parseDateLocal } from '@/lib/dateUtils';

describe('open shift date parsing', () => {
  const testDate = '2026-04-10'; // Friday, April 10

  it('BUG: new Date() parses date-only strings as UTC, shows wrong day in local TZ', () => {
    const broken = brokenDateParse(testDate);
    // new Date("2026-04-10") creates 2026-04-10T00:00:00Z (UTC midnight)
    // In any timezone behind UTC, getDate() returns 9 (previous day)
    // This test documents the bug — it may pass in UTC but fail in CDT/EST/PST
    const utcDay = broken.getUTCDate();
    expect(utcDay).toBe(10); // UTC date is correct...
    // ...but local date may not be:
    // In UTC: getDate() === 10 (correct)
    // In CDT (UTC-5): getDate() === 9 (BUG!)
  });

  it('FIX: parseDateLocal splits string and creates local midnight', () => {
    const fixed = parseDateLocal(testDate);
    // Always local midnight — getDate() returns 10 regardless of timezone
    expect(fixed.getDate()).toBe(10);
    expect(fixed.getMonth()).toBe(3); // April = month 3 (0-indexed)
    expect(fixed.getFullYear()).toBe(2026);
  });

  it('FIX: formatted output shows correct day name', () => {
    const fixed = parseDateLocal(testDate);
    const dayName = format(fixed, 'EEEE');
    expect(dayName).toBe('Friday');
  });

  it('FIX: formatted output shows correct full date', () => {
    const fixed = parseDateLocal(testDate);
    const formatted = format(fixed, 'EEEE, MMMM d, yyyy');
    expect(formatted).toBe('Friday, April 10, 2026');
  });

  it('FIX: short format shows correct date', () => {
    const fixed = parseDateLocal(testDate);
    const formatted = format(fixed, 'EEE, MMM d');
    expect(formatted).toBe('Fri, Apr 10');
  });

  // Edge cases
  it('handles first day of month', () => {
    expect(parseDateLocal('2026-05-01').getDate()).toBe(1);
    expect(parseDateLocal('2026-05-01').getMonth()).toBe(4);
  });

  it('handles last day of month', () => {
    expect(parseDateLocal('2026-04-30').getDate()).toBe(30);
  });

  it('handles year boundary', () => {
    expect(parseDateLocal('2027-01-01').getDate()).toBe(1);
    expect(parseDateLocal('2027-01-01').getFullYear()).toBe(2027);
  });
});
