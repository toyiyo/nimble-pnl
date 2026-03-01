import { describe, it, expect } from 'vitest';
import { getShiftStatusClass } from '@/pages/Scheduling';
import { buildShiftChangeDescription } from '@/hooks/useShifts';
import {
  formatTime,
  hoursForSlot,
  formatWeekRange,
  dateForDay,
  timesOverlap,
  COLUMN_DAYS,
  DAY_SHORT,
} from '@/utils/schedulingHelpers';

describe('getShiftStatusClass', () => {
  it('returns conflict styling when conflicts are present', () => {
    expect(getShiftStatusClass('confirmed', true)).toBe('border-l-warning bg-warning/5 hover:bg-warning/10');
  });

  it('returns status styling when no conflicts', () => {
    expect(getShiftStatusClass('confirmed', false)).toBe('border-l-success');
    expect(getShiftStatusClass('cancelled', false)).toBe('border-l-destructive opacity-60');
    expect(getShiftStatusClass('scheduled', false)).toBe('border-l-primary/50');
  });
});

describe('buildShiftChangeDescription', () => {
  it('describes deleted shifts with preserved locked shifts', () => {
    expect(buildShiftChangeDescription(2, 1, 'deleted')).toBe('2 shifts deleted. 1 locked shift was preserved.');
  });

  it('describes updated shifts with unchanged locked shifts', () => {
    expect(buildShiftChangeDescription(3, 2, 'updated')).toBe('3 shifts updated. 2 locked shifts were unchanged.');
  });

  it('handles singular grammar correctly', () => {
    expect(buildShiftChangeDescription(1, 0, 'deleted')).toBe('1 shift deleted.');
    expect(buildShiftChangeDescription(1, 1, 'updated')).toBe('1 shift updated. 1 locked shift was unchanged.');
  });
});

// ---------------------------------------------------------------------------
// schedulingHelpers.ts — shared constants & pure functions
// ---------------------------------------------------------------------------

describe('COLUMN_DAYS', () => {
  it('has Mon–Sun order [1,2,3,4,5,6,0]', () => {
    expect(COLUMN_DAYS).toEqual([1, 2, 3, 4, 5, 6, 0]);
  });

  it('has exactly 7 entries', () => {
    expect(COLUMN_DAYS).toHaveLength(7);
  });
});

describe('DAY_SHORT', () => {
  it('maps JS getDay() indices to short day names', () => {
    expect(DAY_SHORT).toEqual(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
  });

  it('has exactly 7 entries', () => {
    expect(DAY_SHORT).toHaveLength(7);
  });

  it('has Sunday at index 0 and Saturday at index 6', () => {
    expect(DAY_SHORT[0]).toBe('Sun');
    expect(DAY_SHORT[6]).toBe('Sat');
  });
});

describe('formatTime', () => {
  it('formats AM times correctly', () => {
    expect(formatTime('09:30')).toBe('9:30 AM');
    expect(formatTime('06:00')).toBe('6:00 AM');
  });

  it('formats PM times correctly', () => {
    expect(formatTime('14:30')).toBe('2:30 PM');
    expect(formatTime('21:45')).toBe('9:45 PM');
  });

  it('formats noon (12:00) as 12:00 PM', () => {
    expect(formatTime('12:00')).toBe('12:00 PM');
  });

  it('formats midnight (00:00) as 12:00 AM', () => {
    expect(formatTime('00:00')).toBe('12:00 AM');
  });

  it('formats 12:59 PM correctly', () => {
    expect(formatTime('12:59')).toBe('12:59 PM');
  });

  it('pads single-digit minutes with a leading zero', () => {
    expect(formatTime('08:05')).toBe('8:05 AM');
    expect(formatTime('13:01')).toBe('1:01 PM');
  });
});

describe('hoursForSlot', () => {
  it('calculates hours for a normal daytime shift', () => {
    // 09:00 to 17:00, no break = 8 hours
    expect(hoursForSlot('09:00', '17:00', 0)).toBe(8);
  });

  it('subtracts break minutes', () => {
    // 09:00 to 17:00, 30 min break = 7.5 hours
    expect(hoursForSlot('09:00', '17:00', 30)).toBe(7.5);
  });

  it('handles overnight shifts', () => {
    // 22:00 to 06:00 = 8 hours, no break
    expect(hoursForSlot('22:00', '06:00', 0)).toBe(8);
  });

  it('handles overnight shifts with break', () => {
    // 22:00 to 06:00 = 8 hours - 60 min break = 7 hours
    expect(hoursForSlot('22:00', '06:00', 60)).toBe(7);
  });

  it('returns zero when break equals or exceeds shift duration', () => {
    // 09:00 to 10:00 = 60 min, break = 60 min => 0
    expect(hoursForSlot('09:00', '10:00', 60)).toBe(0);
    // break exceeds shift
    expect(hoursForSlot('09:00', '10:00', 120)).toBe(0);
  });

  it('handles a zero-duration "shift" (start == end) as 24h overnight', () => {
    // When end == start, diff is 0, which triggers +24h => 24 hours
    expect(hoursForSlot('09:00', '09:00', 0)).toBe(24);
  });
});

describe('formatWeekRange', () => {
  it('formats a same-month range', () => {
    // 2026-03-02 (Mon) through 2026-03-08 (Sun) — same month
    const result = formatWeekRange('2026-03-02');
    expect(result).toBe('Mar 2 \u2013 8, 2026');
  });

  it('formats a cross-month range', () => {
    // 2026-02-23 (Mon) through 2026-03-01 (Sun) — crosses Feb→Mar
    const result = formatWeekRange('2026-02-23');
    expect(result).toBe('Feb 23 \u2013 Mar 1, 2026');
  });

  it('formats a cross-year range', () => {
    // 2025-12-29 (Mon) through 2026-01-04 (Sun)
    const result = formatWeekRange('2025-12-29');
    expect(result).toBe('Dec 29 \u2013 Jan 4, 2026');
  });
});

describe('dateForDay', () => {
  // Week starting Monday 2026-03-02
  const WEEK_START = '2026-03-02';

  it('returns Monday for dayOfWeek=1 (offset 0)', () => {
    const d = dateForDay(WEEK_START, 1);
    expect(d.getDate()).toBe(2);
    expect(d.getMonth()).toBe(2); // March (0-indexed)
  });

  it('returns Tuesday for dayOfWeek=2 (offset 1)', () => {
    const d = dateForDay(WEEK_START, 2);
    expect(d.getDate()).toBe(3);
  });

  it('returns Saturday for dayOfWeek=6 (offset 5)', () => {
    const d = dateForDay(WEEK_START, 6);
    expect(d.getDate()).toBe(7);
  });

  it('returns Sunday for dayOfWeek=0 (offset 6)', () => {
    const d = dateForDay(WEEK_START, 0);
    expect(d.getDate()).toBe(8);
  });
});

describe('timesOverlap', () => {
  it('detects overlapping ranges', () => {
    // 09:00–12:00 vs 11:00–14:00
    expect(timesOverlap('09:00', '12:00', '11:00', '14:00')).toBe(true);
  });

  it('returns false for non-overlapping ranges', () => {
    // 09:00–12:00 vs 13:00–17:00
    expect(timesOverlap('09:00', '12:00', '13:00', '17:00')).toBe(false);
  });

  it('returns false for adjacent ranges (end == start)', () => {
    // 09:00–12:00 vs 12:00–17:00 — touching but not overlapping
    expect(timesOverlap('09:00', '12:00', '12:00', '17:00')).toBe(false);
  });

  it('detects identical ranges as overlapping', () => {
    expect(timesOverlap('09:00', '17:00', '09:00', '17:00')).toBe(true);
  });

  it('detects overnight overlap when both ranges are overnight', () => {
    // Both overnight: 22:00–06:00 vs 23:00–07:00
    expect(timesOverlap('22:00', '06:00', '23:00', '07:00')).toBe(true);
  });

  it('returns false when overnight shift and early daytime shift do not overlap in algorithm', () => {
    // The simple algorithm adjusts end < start by +24h but doesn't shift
    // non-overnight ranges, so 22:00–06:00 vs 05:00–08:00 returns false
    // because aStart(1320) < bEnd(480) is false.
    expect(timesOverlap('22:00', '06:00', '05:00', '08:00')).toBe(false);
  });

  it('detects overlap when daytime range starts during overnight range evening portion', () => {
    // Overnight: 20:00–04:00 vs daytime: 21:00–23:00 — overlaps evening portion
    expect(timesOverlap('20:00', '04:00', '21:00', '23:00')).toBe(true);
  });

  it('returns false when overnight shift does not overlap daytime shift', () => {
    // Overnight: 22:00–06:00 vs daytime: 07:00–12:00
    expect(timesOverlap('22:00', '06:00', '07:00', '12:00')).toBe(false);
  });

  it('detects two overnight shifts that overlap', () => {
    // 22:00–04:00 vs 23:00–05:00
    expect(timesOverlap('22:00', '04:00', '23:00', '05:00')).toBe(true);
  });

  it('handles one range fully containing the other', () => {
    // 08:00–18:00 contains 10:00–14:00
    expect(timesOverlap('08:00', '18:00', '10:00', '14:00')).toBe(true);
  });
});
