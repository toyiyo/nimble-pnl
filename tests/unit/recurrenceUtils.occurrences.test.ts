/**
 * Reproduction: `generateRecurringDates` with `endType: 'after'` drops the
 * final occurrence — `occurrences: 3` yields 2 dates, `occurrences: 2` yields
 * 1. Found while un-skipping the Task 6 (surface 4, recurring shifts) E2E
 * spec, which dies on this occurrence-count mismatch before it ever reaches
 * a timezone assertion. Pre-existing since the original recurrence-pattern
 * PR (#200); unrelated to the shift-creation timezone defect this branch
 * otherwise fixes.
 */
import { describe, it, expect } from 'vitest';
import { generateRecurringDates } from '@/utils/recurrenceUtils';
import type { RecurrencePattern } from '@/types/scheduling';

describe('generateRecurringDates — endType "after" occurrence count', () => {
  const start = new Date('2026-08-12T11:30:00Z');

  it.each([1, 2, 3, 5])('returns exactly N=%i dates for a daily pattern', (occurrences) => {
    const pattern: RecurrencePattern = {
      type: 'daily',
      interval: 1,
      endType: 'after',
      occurrences,
    };
    const dates = generateRecurringDates(start, pattern);
    expect(dates.length).toBe(occurrences);
  });

  it('the 3-occurrence case lands on 2026-08-12, 13, 14', () => {
    const pattern: RecurrencePattern = {
      type: 'daily',
      interval: 1,
      endType: 'after',
      occurrences: 3,
    };
    const dates = generateRecurringDates(start, pattern);
    const isoDays = dates.map((d) => d.toISOString().slice(0, 10));
    expect(isoDays).toEqual(['2026-08-12', '2026-08-13', '2026-08-14']);
  });
});
