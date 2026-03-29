import { describe, it, expect } from 'vitest';
import { ShiftInterval, formatDayLabel, formatLocalDate } from '@/lib/shiftInterval';

// ---------------------------------------------------------------------------
// ShiftInterval.create
// ---------------------------------------------------------------------------
describe('ShiftInterval.create', () => {
  describe('standard same-day shifts', () => {
    it('creates a morning shift (09:00 - 17:00)', () => {
      const si = ShiftInterval.create('2026-03-01', '09:00', '17:00');
      expect(si.businessDate).toBe('2026-03-01');
      expect(si.startAt).toEqual(new Date('2026-03-01T09:00:00'));
      expect(si.endAt).toEqual(new Date('2026-03-01T17:00:00'));
    });

    it('creates a lunch shift (11:00 - 15:00)', () => {
      const si = ShiftInterval.create('2026-03-15', '11:00', '15:00');
      expect(si.durationInHours).toBe(4);
    });

    it('creates a short 15-minute shift (boundary) with no warnings', () => {
      const si = ShiftInterval.create('2026-06-10', '10:00', '10:15');
      expect(si.durationInMinutes).toBe(15);
      expect(si.durationWarnings).toHaveLength(0);
    });

    it('creates a 16-hour shift (max boundary) with no warnings', () => {
      const si = ShiftInterval.create('2026-04-01', '06:00', '22:00');
      expect(si.durationInHours).toBe(16);
      expect(si.durationWarnings).toHaveLength(0);
    });
  });

  describe('midnight-crossing shifts', () => {
    it('creates a night shift crossing midnight (22:00 - 02:00)', () => {
      const si = ShiftInterval.create('2026-03-01', '22:00', '02:00');
      expect(si.businessDate).toBe('2026-03-01');
      expect(si.startAt).toEqual(new Date('2026-03-01T22:00:00'));
      expect(si.endAt).toEqual(new Date('2026-03-02T02:00:00'));
      expect(si.durationInHours).toBe(4);
    });

    it('creates a shift ending just after midnight (23:00 - 00:30)', () => {
      const si = ShiftInterval.create('2026-07-20', '23:00', '00:30');
      expect(si.startAt).toEqual(new Date('2026-07-20T23:00:00'));
      expect(si.endAt).toEqual(new Date('2026-07-21T00:30:00'));
      expect(si.durationInMinutes).toBe(90);
    });

    it('creates a late-night closing shift (20:00 - 03:00)', () => {
      const si = ShiftInterval.create('2026-12-31', '20:00', '03:00');
      expect(si.startAt).toEqual(new Date('2026-12-31T20:00:00'));
      expect(si.endAt).toEqual(new Date('2027-01-01T03:00:00'));
      expect(si.durationInHours).toBe(7);
    });
  });
});

// ---------------------------------------------------------------------------
// ShiftInterval.create — validation errors
// ---------------------------------------------------------------------------
describe('ShiftInterval.create — validation', () => {
  it('throws INVALID_DATE for garbage date string', () => {
    expect(() => ShiftInterval.create('not-a-date', '09:00', '17:00')).toThrow('INVALID_DATE');
  });

  it('throws INVALID_DATE for garbage start time', () => {
    expect(() => ShiftInterval.create('2026-03-01', 'abc', '17:00')).toThrow('INVALID_DATE');
  });

  it('throws INVALID_DATE for garbage end time', () => {
    expect(() => ShiftInterval.create('2026-03-01', '09:00', 'xyz')).toThrow('INVALID_DATE');
  });

  it('throws INVALID_DURATION when end equals start (same-day)', () => {
    expect(() => ShiftInterval.create('2026-03-01', '09:00', '09:00')).toThrow('INVALID_DURATION');
  });

  it('returns TOO_SHORT warning for a 10-minute shift', () => {
    const si = ShiftInterval.create('2026-03-01', '09:00', '09:10');
    expect(si.durationWarnings).toHaveLength(1);
    expect(si.durationWarnings[0].code).toBe('TOO_SHORT');
  });

  it('returns TOO_SHORT warning for a 14-minute shift (just under boundary)', () => {
    const si = ShiftInterval.create('2026-03-01', '09:00', '09:14');
    expect(si.durationWarnings).toHaveLength(1);
    expect(si.durationWarnings[0].code).toBe('TOO_SHORT');
  });

  it('returns MAX_ENDURANCE warning for a shift longer than 16 hours', () => {
    // 06:00 - 22:01 = 16h01m
    const si = ShiftInterval.create('2026-03-01', '06:00', '22:01');
    expect(si.durationWarnings).toHaveLength(1);
    expect(si.durationWarnings[0].code).toBe('MAX_ENDURANCE');
  });

  it('returns MAX_ENDURANCE warning for an extremely long overnight shift', () => {
    // 05:00 to 04:00 next day = 23 hours
    const si = ShiftInterval.create('2026-03-01', '05:00', '04:00');
    expect(si.durationWarnings).toHaveLength(1);
    expect(si.durationWarnings[0].code).toBe('MAX_ENDURANCE');
  });
});

// ---------------------------------------------------------------------------
// ShiftInterval.fromTimestamps
// ---------------------------------------------------------------------------
describe('ShiftInterval.fromTimestamps', () => {
  it('creates from ISO timestamp strings', () => {
    const si = ShiftInterval.fromTimestamps(
      '2026-05-10T08:30:00',
      '2026-05-10T16:30:00',
      '2026-05-10'
    );
    expect(si.startAt).toEqual(new Date('2026-05-10T08:30:00'));
    expect(si.endAt).toEqual(new Date('2026-05-10T16:30:00'));
    expect(si.businessDate).toBe('2026-05-10');
    expect(si.durationInHours).toBe(8);
  });

  it('handles overnight timestamps with explicit dates', () => {
    const si = ShiftInterval.fromTimestamps(
      '2026-06-15T22:00:00',
      '2026-06-16T06:00:00',
      '2026-06-15'
    );
    expect(si.durationInHours).toBe(8);
    expect(si.businessDate).toBe('2026-06-15');
  });

  it('throws INVALID_DATE for invalid ISO strings', () => {
    expect(() =>
      ShiftInterval.fromTimestamps('garbage', '2026-05-10T16:30:00', '2026-05-10')
    ).toThrow('INVALID_DATE');
  });

  it('throws INVALID_DATE for invalid end ISO string', () => {
    expect(() =>
      ShiftInterval.fromTimestamps('2026-05-10T08:30:00', 'garbage', '2026-05-10')
    ).toThrow('INVALID_DATE');
  });

  it('throws INVALID_DURATION when end is before start', () => {
    expect(() =>
      ShiftInterval.fromTimestamps(
        '2026-05-10T16:30:00',
        '2026-05-10T08:30:00',
        '2026-05-10'
      )
    ).toThrow('INVALID_DURATION');
  });

  it('returns TOO_SHORT warning for timestamps less than 15 minutes apart', () => {
    const si = ShiftInterval.fromTimestamps(
      '2026-05-10T08:30:00',
      '2026-05-10T08:40:00',
      '2026-05-10'
    );
    expect(si.durationWarnings).toHaveLength(1);
    expect(si.durationWarnings[0].code).toBe('TOO_SHORT');
  });

  it('returns MAX_ENDURANCE warning for timestamps more than 16 hours apart', () => {
    const si = ShiftInterval.fromTimestamps(
      '2026-05-10T06:00:00',
      '2026-05-10T22:01:00',
      '2026-05-10'
    );
    expect(si.durationWarnings).toHaveLength(1);
    expect(si.durationWarnings[0].code).toBe('MAX_ENDURANCE');
  });
});

// ---------------------------------------------------------------------------
// Computed properties
// ---------------------------------------------------------------------------
describe('computed properties', () => {
  describe('durationInMinutes', () => {
    it('returns 480 for an 8-hour shift', () => {
      const si = ShiftInterval.create('2026-03-01', '09:00', '17:00');
      expect(si.durationInMinutes).toBe(480);
    });

    it('returns 90 for a 1.5-hour shift', () => {
      const si = ShiftInterval.create('2026-03-01', '12:00', '13:30');
      expect(si.durationInMinutes).toBe(90);
    });

    it('returns 240 for an overnight 4-hour shift', () => {
      const si = ShiftInterval.create('2026-03-01', '22:00', '02:00');
      expect(si.durationInMinutes).toBe(240);
    });
  });

  describe('durationInHours', () => {
    it('returns 8 for a full shift', () => {
      const si = ShiftInterval.create('2026-03-01', '09:00', '17:00');
      expect(si.durationInHours).toBe(8);
    });

    it('returns 0.25 for a 15-minute shift', () => {
      const si = ShiftInterval.create('2026-03-01', '09:00', '09:15');
      expect(si.durationInHours).toBe(0.25);
    });

    it('returns fractional hours correctly', () => {
      const si = ShiftInterval.create('2026-03-01', '09:00', '10:45');
      expect(si.durationInHours).toBe(1.75);
    });
  });

  describe('endsOnNextDay', () => {
    it('returns false for a same-day shift', () => {
      const si = ShiftInterval.create('2026-03-01', '09:00', '17:00');
      expect(si.endsOnNextDay).toBe(false);
    });

    it('returns true for a midnight-crossing shift', () => {
      const si = ShiftInterval.create('2026-03-01', '22:00', '02:00');
      expect(si.endsOnNextDay).toBe(true);
    });

    it('returns true for a shift ending just past midnight', () => {
      const si = ShiftInterval.create('2026-03-01', '23:00', '00:15');
      expect(si.endsOnNextDay).toBe(true);
    });

    it('returns false when shift ends on same calendar day', () => {
      // 09:00 - 23:59 = 14h59m, under 16h, same day
      const si = ShiftInterval.create('2026-03-01', '09:00', '23:59');
      expect(si.endsOnNextDay).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// overlapsWith
// ---------------------------------------------------------------------------
describe('overlapsWith', () => {
  it('detects fully overlapping shifts (one contains the other)', () => {
    const a = ShiftInterval.create('2026-03-01', '09:00', '17:00');
    const b = ShiftInterval.create('2026-03-01', '10:00', '14:00');
    expect(a.overlapsWith(b)).toBe(true);
    expect(b.overlapsWith(a)).toBe(true);
  });

  it('detects partially overlapping shifts (staggered)', () => {
    const a = ShiftInterval.create('2026-03-01', '09:00', '13:00');
    const b = ShiftInterval.create('2026-03-01', '12:00', '17:00');
    expect(a.overlapsWith(b)).toBe(true);
    expect(b.overlapsWith(a)).toBe(true);
  });

  it('returns false for non-overlapping shifts', () => {
    const a = ShiftInterval.create('2026-03-01', '09:00', '12:00');
    const b = ShiftInterval.create('2026-03-01', '14:00', '18:00');
    expect(a.overlapsWith(b)).toBe(false);
    expect(b.overlapsWith(a)).toBe(false);
  });

  it('returns false for adjacent shifts (end of one = start of other)', () => {
    const a = ShiftInterval.create('2026-03-01', '09:00', '13:00');
    const b = ShiftInterval.create('2026-03-01', '13:00', '17:00');
    expect(a.overlapsWith(b)).toBe(false);
    expect(b.overlapsWith(a)).toBe(false);
  });

  it('detects overlap across midnight', () => {
    const a = ShiftInterval.create('2026-03-01', '22:00', '02:00');
    const b = ShiftInterval.create('2026-03-01', '23:00', '01:00');
    expect(a.overlapsWith(b)).toBe(true);
    expect(b.overlapsWith(a)).toBe(true);
  });

  it('is symmetric: a.overlapsWith(b) === b.overlapsWith(a)', () => {
    const a = ShiftInterval.create('2026-03-01', '09:00', '13:00');
    const b = ShiftInterval.create('2026-03-01', '12:59', '17:00');
    expect(a.overlapsWith(b)).toBe(b.overlapsWith(a));
  });

  it('returns false for shifts on different days with no time overlap', () => {
    const a = ShiftInterval.create('2026-03-01', '09:00', '17:00');
    const b = ShiftInterval.create('2026-03-02', '09:00', '17:00');
    expect(a.overlapsWith(b)).toBe(false);
  });

  it('detects overlap when shifts are identical', () => {
    const a = ShiftInterval.create('2026-03-01', '09:00', '17:00');
    const b = ShiftInterval.create('2026-03-01', '09:00', '17:00');
    expect(a.overlapsWith(b)).toBe(true);
  });

  it('detects overlap with midnight-crossing shift and next-day early shift', () => {
    const nightShift = ShiftInterval.create('2026-03-01', '22:00', '03:00');
    const earlyMorning = ShiftInterval.create('2026-03-02', '02:00', '06:00');
    expect(nightShift.overlapsWith(earlyMorning)).toBe(true);
  });

  it('returns false when one shift ends exactly as another starts (different day)', () => {
    const nightShift = ShiftInterval.create('2026-03-01', '22:00', '02:00');
    const morningShift = ShiftInterval.fromTimestamps(
      '2026-03-02T02:00:00',
      '2026-03-02T06:00:00',
      '2026-03-02'
    );
    expect(nightShift.overlapsWith(morningShift)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// restHoursUntil
// ---------------------------------------------------------------------------
describe('restHoursUntil', () => {
  it('returns the gap in hours between two shifts', () => {
    const a = ShiftInterval.create('2026-03-01', '09:00', '13:00');
    const b = ShiftInterval.create('2026-03-01', '15:00', '19:00');
    expect(a.restHoursUntil(b)).toBe(2);
  });

  it('returns 0 for overlapping shifts', () => {
    const a = ShiftInterval.create('2026-03-01', '09:00', '14:00');
    const b = ShiftInterval.create('2026-03-01', '13:00', '17:00');
    expect(a.restHoursUntil(b)).toBe(0);
  });

  it('returns 0 for abutting shifts (no gap)', () => {
    const a = ShiftInterval.create('2026-03-01', '09:00', '13:00');
    const b = ShiftInterval.create('2026-03-01', '13:00', '17:00');
    expect(a.restHoursUntil(b)).toBe(0);
  });

  it('returns fractional hours', () => {
    const a = ShiftInterval.create('2026-03-01', '09:00', '13:00');
    const b = ShiftInterval.create('2026-03-01', '13:30', '17:00');
    expect(a.restHoursUntil(b)).toBe(0.5);
  });

  it('returns correct gap for overnight rest', () => {
    const a = ShiftInterval.create('2026-03-01', '09:00', '17:00');
    const b = ShiftInterval.fromTimestamps(
      '2026-03-02T09:00:00',
      '2026-03-02T17:00:00',
      '2026-03-02'
    );
    expect(a.restHoursUntil(b)).toBe(16);
  });

  it('returns 0 when other shift starts before this shift ends', () => {
    const a = ShiftInterval.create('2026-03-01', '09:00', '17:00');
    const b = ShiftInterval.create('2026-03-01', '10:00', '14:00');
    expect(a.restHoursUntil(b)).toBe(0);
  });

  it('is not symmetric (direction matters)', () => {
    const a = ShiftInterval.create('2026-03-01', '09:00', '13:00');
    const b = ShiftInterval.create('2026-03-01', '15:00', '19:00');
    expect(a.restHoursUntil(b)).toBe(2);
    // b.restHoursUntil(a) should return 0 because a starts before b ends
    expect(b.restHoursUntil(a)).toBe(0);
  });

  it('returns rest hours across midnight boundary', () => {
    const closing = ShiftInterval.create('2026-03-01', '18:00', '02:00');
    const opening = ShiftInterval.fromTimestamps(
      '2026-03-02T08:00:00',
      '2026-03-02T14:00:00',
      '2026-03-02'
    );
    expect(closing.restHoursUntil(opening)).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// formatDayLabel
// ---------------------------------------------------------------------------
describe('formatDayLabel', () => {
  it('formats a Sunday date string', () => {
    // 2026-03-01 is a Sunday
    const label = formatDayLabel('2026-03-01');
    expect(label).toContain('Sun');
    expect(label).toContain('Mar');
    expect(label).toContain('1');
  });

  it('formats a Wednesday date correctly', () => {
    // 2026-03-04 is a Wednesday
    const label = formatDayLabel('2026-03-04');
    expect(label).toContain('Wed');
    expect(label).toContain('Mar');
    expect(label).toContain('4');
  });

  it('formats a Saturday correctly', () => {
    // 2026-03-07 is a Saturday
    const label = formatDayLabel('2026-03-07');
    expect(label).toContain('Sat');
    expect(label).toContain('Mar');
    expect(label).toContain('7');
  });

  it('formats dates in January', () => {
    // 2026-01-15 is a Thursday
    const label = formatDayLabel('2026-01-15');
    expect(label).toContain('Thu');
    expect(label).toContain('Jan');
    expect(label).toContain('15');
  });

  it('formats December dates', () => {
    // 2026-12-25 is a Friday
    const label = formatDayLabel('2026-12-25');
    expect(label).toContain('Fri');
    expect(label).toContain('Dec');
    expect(label).toContain('25');
  });
});

// ---------------------------------------------------------------------------
// formatLocalDate
// ---------------------------------------------------------------------------
describe('formatLocalDate', () => {
  it('formats a date as YYYY-MM-DD', () => {
    const d = new Date('2026-03-01T12:00:00');
    expect(formatLocalDate(d)).toBe('2026-03-01');
  });

  it('pads single-digit months', () => {
    const d = new Date('2026-01-15T12:00:00');
    expect(formatLocalDate(d)).toBe('2026-01-15');
  });

  it('pads single-digit days', () => {
    const d = new Date('2026-03-05T12:00:00');
    expect(formatLocalDate(d)).toBe('2026-03-05');
  });

  it('handles month and day both needing padding', () => {
    const d = new Date('2026-02-03T12:00:00');
    expect(formatLocalDate(d)).toBe('2026-02-03');
  });

  it('handles double-digit months and days', () => {
    const d = new Date('2026-12-31T12:00:00');
    expect(formatLocalDate(d)).toBe('2026-12-31');
  });

  it('handles the first day of the year', () => {
    const d = new Date('2026-01-01T12:00:00');
    expect(formatLocalDate(d)).toBe('2026-01-01');
  });

  it('uses local date components, not UTC', () => {
    // Construct a Date using local constructor to ensure local date
    const d = new Date(2026, 2, 15); // March 15 2026 00:00 local
    expect(formatLocalDate(d)).toBe('2026-03-15');
  });
});
