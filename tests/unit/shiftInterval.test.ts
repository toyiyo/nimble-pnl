import { describe, it, expect, afterEach } from 'vitest';
import { ShiftInterval, formatDayLabel, formatLocalDate, wallClockToInstant } from '@/lib/shiftInterval';

// ---------------------------------------------------------------------------
// ShiftInterval.create
// ---------------------------------------------------------------------------
describe('ShiftInterval.create', () => {
  describe('standard same-day shifts', () => {
    it('creates a morning shift (09:00 - 17:00)', () => {
      const si = ShiftInterval.create('2026-03-01', '09:00', '17:00', 'UTC');
      expect(si.businessDate).toBe('2026-03-01');
      expect(si.startAt).toEqual(new Date('2026-03-01T09:00:00Z'));
      expect(si.endAt).toEqual(new Date('2026-03-01T17:00:00Z'));
    });

    it('creates a lunch shift (11:00 - 15:00)', () => {
      const si = ShiftInterval.create('2026-03-15', '11:00', '15:00', 'UTC');
      expect(si.durationInHours).toBe(4);
    });

    it('creates a short 15-minute shift (boundary) with no warnings', () => {
      const si = ShiftInterval.create('2026-06-10', '10:00', '10:15', 'UTC');
      expect(si.durationInMinutes).toBe(15);
      expect(si.durationWarnings).toHaveLength(0);
    });

    it('creates a 16-hour shift (max boundary) with no warnings', () => {
      const si = ShiftInterval.create('2026-04-01', '06:00', '22:00', 'UTC');
      expect(si.durationInHours).toBe(16);
      expect(si.durationWarnings).toHaveLength(0);
    });
  });

  describe('midnight-crossing shifts', () => {
    it('creates a night shift crossing midnight (22:00 - 02:00)', () => {
      const si = ShiftInterval.create('2026-03-01', '22:00', '02:00', 'UTC');
      expect(si.businessDate).toBe('2026-03-01');
      expect(si.startAt).toEqual(new Date('2026-03-01T22:00:00Z'));
      expect(si.endAt).toEqual(new Date('2026-03-02T02:00:00Z'));
      expect(si.durationInHours).toBe(4);
    });

    it('creates a shift ending just after midnight (23:00 - 00:30)', () => {
      const si = ShiftInterval.create('2026-07-20', '23:00', '00:30', 'UTC');
      expect(si.startAt).toEqual(new Date('2026-07-20T23:00:00Z'));
      expect(si.endAt).toEqual(new Date('2026-07-21T00:30:00Z'));
      expect(si.durationInMinutes).toBe(90);
    });

    it('creates a late-night closing shift (20:00 - 03:00)', () => {
      const si = ShiftInterval.create('2026-12-31', '20:00', '03:00', 'UTC');
      expect(si.startAt).toEqual(new Date('2026-12-31T20:00:00Z'));
      expect(si.endAt).toEqual(new Date('2027-01-01T03:00:00Z'));
      expect(si.durationInHours).toBe(7);
    });
  });
});

// ---------------------------------------------------------------------------
// ShiftInterval.create — validation errors
// ---------------------------------------------------------------------------
describe('ShiftInterval.create — validation', () => {
  it('throws INVALID_DATE for garbage date string', () => {
    expect(() => ShiftInterval.create('not-a-date', '09:00', '17:00', 'UTC')).toThrow('INVALID_DATE');
  });

  it('throws INVALID_DATE for garbage start time', () => {
    expect(() => ShiftInterval.create('2026-03-01', 'abc', '17:00', 'UTC')).toThrow('INVALID_DATE');
  });

  it('throws INVALID_DATE for garbage end time', () => {
    expect(() => ShiftInterval.create('2026-03-01', '09:00', 'xyz', 'UTC')).toThrow('INVALID_DATE');
  });

  it('throws INVALID_DURATION when end equals start (same-day)', () => {
    expect(() => ShiftInterval.create('2026-03-01', '09:00', '09:00', 'UTC')).toThrow('INVALID_DURATION');
  });

  it('returns TOO_SHORT warning for a 10-minute shift', () => {
    const si = ShiftInterval.create('2026-03-01', '09:00', '09:10', 'UTC');
    expect(si.durationWarnings).toHaveLength(1);
    expect(si.durationWarnings[0].code).toBe('TOO_SHORT');
  });

  it('returns TOO_SHORT warning for a 14-minute shift (just under boundary)', () => {
    const si = ShiftInterval.create('2026-03-01', '09:00', '09:14', 'UTC');
    expect(si.durationWarnings).toHaveLength(1);
    expect(si.durationWarnings[0].code).toBe('TOO_SHORT');
  });

  it('returns MAX_ENDURANCE warning for a shift longer than 16 hours', () => {
    // 06:00 - 22:01 = 16h01m
    const si = ShiftInterval.create('2026-03-01', '06:00', '22:01', 'UTC');
    expect(si.durationWarnings).toHaveLength(1);
    expect(si.durationWarnings[0].code).toBe('MAX_ENDURANCE');
  });

  it('returns MAX_ENDURANCE warning for an extremely long overnight shift', () => {
    // 05:00 to 04:00 next day = 23 hours
    const si = ShiftInterval.create('2026-03-01', '05:00', '04:00', 'UTC');
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
      const si = ShiftInterval.create('2026-03-01', '09:00', '17:00', 'UTC');
      expect(si.durationInMinutes).toBe(480);
    });

    it('returns 90 for a 1.5-hour shift', () => {
      const si = ShiftInterval.create('2026-03-01', '12:00', '13:30', 'UTC');
      expect(si.durationInMinutes).toBe(90);
    });

    it('returns 240 for an overnight 4-hour shift', () => {
      const si = ShiftInterval.create('2026-03-01', '22:00', '02:00', 'UTC');
      expect(si.durationInMinutes).toBe(240);
    });
  });

  describe('durationInHours', () => {
    it('returns 8 for a full shift', () => {
      const si = ShiftInterval.create('2026-03-01', '09:00', '17:00', 'UTC');
      expect(si.durationInHours).toBe(8);
    });

    it('returns 0.25 for a 15-minute shift', () => {
      const si = ShiftInterval.create('2026-03-01', '09:00', '09:15', 'UTC');
      expect(si.durationInHours).toBe(0.25);
    });

    it('returns fractional hours correctly', () => {
      const si = ShiftInterval.create('2026-03-01', '09:00', '10:45', 'UTC');
      expect(si.durationInHours).toBe(1.75);
    });
  });

  describe('endsOnNextDay', () => {
    it('returns false for a same-day shift', () => {
      const si = ShiftInterval.create('2026-03-01', '09:00', '17:00', 'UTC');
      expect(si.endsOnNextDay('UTC')).toBe(false);
    });

    it('returns true for a midnight-crossing shift', () => {
      const si = ShiftInterval.create('2026-03-01', '22:00', '02:00', 'UTC');
      expect(si.endsOnNextDay('UTC')).toBe(true);
    });

    it('returns true for a shift ending just past midnight', () => {
      const si = ShiftInterval.create('2026-03-01', '23:00', '00:15', 'UTC');
      expect(si.endsOnNextDay('UTC')).toBe(true);
    });

    it('returns false when shift ends on same calendar day', () => {
      // 09:00 - 23:59 = 14h59m, under 16h, same day
      const si = ShiftInterval.create('2026-03-01', '09:00', '23:59', 'UTC');
      expect(si.endsOnNextDay('UTC')).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// overlapsWith
// ---------------------------------------------------------------------------
describe('overlapsWith', () => {
  it('detects fully overlapping shifts (one contains the other)', () => {
    const a = ShiftInterval.create('2026-03-01', '09:00', '17:00', 'UTC');
    const b = ShiftInterval.create('2026-03-01', '10:00', '14:00', 'UTC');
    expect(a.overlapsWith(b)).toBe(true);
    expect(b.overlapsWith(a)).toBe(true);
  });

  it('detects partially overlapping shifts (staggered)', () => {
    const a = ShiftInterval.create('2026-03-01', '09:00', '13:00', 'UTC');
    const b = ShiftInterval.create('2026-03-01', '12:00', '17:00', 'UTC');
    expect(a.overlapsWith(b)).toBe(true);
    expect(b.overlapsWith(a)).toBe(true);
  });

  it('returns false for non-overlapping shifts', () => {
    const a = ShiftInterval.create('2026-03-01', '09:00', '12:00', 'UTC');
    const b = ShiftInterval.create('2026-03-01', '14:00', '18:00', 'UTC');
    expect(a.overlapsWith(b)).toBe(false);
    expect(b.overlapsWith(a)).toBe(false);
  });

  it('returns false for adjacent shifts (end of one = start of other)', () => {
    const a = ShiftInterval.create('2026-03-01', '09:00', '13:00', 'UTC');
    const b = ShiftInterval.create('2026-03-01', '13:00', '17:00', 'UTC');
    expect(a.overlapsWith(b)).toBe(false);
    expect(b.overlapsWith(a)).toBe(false);
  });

  it('detects overlap across midnight', () => {
    const a = ShiftInterval.create('2026-03-01', '22:00', '02:00', 'UTC');
    const b = ShiftInterval.create('2026-03-01', '23:00', '01:00', 'UTC');
    expect(a.overlapsWith(b)).toBe(true);
    expect(b.overlapsWith(a)).toBe(true);
  });

  it('is symmetric: a.overlapsWith(b) === b.overlapsWith(a)', () => {
    const a = ShiftInterval.create('2026-03-01', '09:00', '13:00', 'UTC');
    const b = ShiftInterval.create('2026-03-01', '12:59', '17:00', 'UTC');
    expect(a.overlapsWith(b)).toBe(b.overlapsWith(a));
  });

  it('returns false for shifts on different days with no time overlap', () => {
    const a = ShiftInterval.create('2026-03-01', '09:00', '17:00', 'UTC');
    const b = ShiftInterval.create('2026-03-02', '09:00', '17:00', 'UTC');
    expect(a.overlapsWith(b)).toBe(false);
  });

  it('detects overlap when shifts are identical', () => {
    const a = ShiftInterval.create('2026-03-01', '09:00', '17:00', 'UTC');
    const b = ShiftInterval.create('2026-03-01', '09:00', '17:00', 'UTC');
    expect(a.overlapsWith(b)).toBe(true);
  });

  it('detects overlap with midnight-crossing shift and next-day early shift', () => {
    const nightShift = ShiftInterval.create('2026-03-01', '22:00', '03:00', 'UTC');
    const earlyMorning = ShiftInterval.create('2026-03-02', '02:00', '06:00', 'UTC');
    expect(nightShift.overlapsWith(earlyMorning)).toBe(true);
  });

  it('returns false when one shift ends exactly as another starts (different day)', () => {
    const nightShift = ShiftInterval.create('2026-03-01', '22:00', '02:00', 'UTC');
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
    const a = ShiftInterval.create('2026-03-01', '09:00', '13:00', 'UTC');
    const b = ShiftInterval.create('2026-03-01', '15:00', '19:00', 'UTC');
    expect(a.restHoursUntil(b)).toBe(2);
  });

  it('returns 0 for overlapping shifts', () => {
    const a = ShiftInterval.create('2026-03-01', '09:00', '14:00', 'UTC');
    const b = ShiftInterval.create('2026-03-01', '13:00', '17:00', 'UTC');
    expect(a.restHoursUntil(b)).toBe(0);
  });

  it('returns 0 for abutting shifts (no gap)', () => {
    const a = ShiftInterval.create('2026-03-01', '09:00', '13:00', 'UTC');
    const b = ShiftInterval.create('2026-03-01', '13:00', '17:00', 'UTC');
    expect(a.restHoursUntil(b)).toBe(0);
  });

  it('returns fractional hours', () => {
    const a = ShiftInterval.create('2026-03-01', '09:00', '13:00', 'UTC');
    const b = ShiftInterval.create('2026-03-01', '13:30', '17:00', 'UTC');
    expect(a.restHoursUntil(b)).toBe(0.5);
  });

  it('returns correct gap for overnight rest', () => {
    const a = ShiftInterval.create('2026-03-01', '09:00', '17:00', 'UTC');
    // Explicit Z: `a` is now UTC-anchored (via `create`'s required `tz`), so
    // `b`'s naive fromTimestamps string must share that basis — a host-local
    // parse here would silently reintroduce a host-TZ-dependent gap.
    const b = ShiftInterval.fromTimestamps(
      '2026-03-02T09:00:00Z',
      '2026-03-02T17:00:00Z',
      '2026-03-02'
    );
    expect(a.restHoursUntil(b)).toBe(16);
  });

  it('returns 0 when other shift starts before this shift ends', () => {
    const a = ShiftInterval.create('2026-03-01', '09:00', '17:00', 'UTC');
    const b = ShiftInterval.create('2026-03-01', '10:00', '14:00', 'UTC');
    expect(a.restHoursUntil(b)).toBe(0);
  });

  it('is not symmetric (direction matters)', () => {
    const a = ShiftInterval.create('2026-03-01', '09:00', '13:00', 'UTC');
    const b = ShiftInterval.create('2026-03-01', '15:00', '19:00', 'UTC');
    expect(a.restHoursUntil(b)).toBe(2);
    // b.restHoursUntil(a) should return 0 because a starts before b ends
    expect(b.restHoursUntil(a)).toBe(0);
  });

  it('returns rest hours across midnight boundary', () => {
    const closing = ShiftInterval.create('2026-03-01', '18:00', '02:00', 'UTC');
    // Explicit Z — see comment in the overnight-rest test above.
    const opening = ShiftInterval.fromTimestamps(
      '2026-03-02T08:00:00Z',
      '2026-03-02T14:00:00Z',
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

// ---------------------------------------------------------------------------
// wallClockToInstant
// ---------------------------------------------------------------------------
describe('wallClockToInstant', () => {
  it('resolves a plain summer wall clock in Chicago (CDT, UTC-5)', () => {
    expect(wallClockToInstant('2026-07-30', '06:30', 'America/Chicago')).toEqual(
      new Date('2026-07-30T11:30:00.000Z'),
    );
  });

  it('resolves a plain winter wall clock in Chicago (CST, UTC-6) — DST read from the date, not hardcoded', () => {
    expect(wallClockToInstant('2026-01-15', '06:30', 'America/Chicago')).toEqual(
      new Date('2026-01-15T12:30:00.000Z'),
    );
  });

  it('resolves a UTC wall clock unchanged', () => {
    expect(wallClockToInstant('2026-07-30', '06:30', 'UTC')).toEqual(
      new Date('2026-07-30T06:30:00.000Z'),
    );
  });

  it('returns a Date, not a string', () => {
    expect(wallClockToInstant('2026-07-30', '06:30', 'UTC')).toBeInstanceOf(Date);
  });

  describe('validation — throws before delegating', () => {
    it('throws INVALID_DATE for a malformed date', () => {
      expect(() => wallClockToInstant('not-a-date', '06:30', 'America/Chicago')).toThrow('INVALID_DATE');
    });

    it('throws INVALID_DATE for a malformed time', () => {
      expect(() => wallClockToInstant('2026-07-30', 'abc', 'America/Chicago')).toThrow('INVALID_DATE');
    });

    it('throws INVALID_DATE for a malformed non-empty timezone', () => {
      expect(() => wallClockToInstant('2026-07-30', '06:30', 'Not/AZone')).toThrow('INVALID_DATE');
    });

    it('throws INVALID_DATE for an empty-string timezone — the case that otherwise fails open to a host-local instant', () => {
      expect(() => wallClockToInstant('2026-07-30', '06:30', '')).toThrow('INVALID_DATE');
    });
  });

  describe('DST edges — pinned to Postgres, asserted under all three host TZs', () => {
    // Each expected value is what production Postgres returns for
    // `(wall)::timestamp AT TIME ZONE zone`, not a value derived from this
    // implementation. A `fromZonedTime`-based implementation returns a
    // DIFFERENT instant for the fall-back case depending on the host's TZ, so
    // running this table under one host TZ alone would pass by luck.
    const cases: Array<{ label: string; date: string; time: string; tz: string; expected: string }> = [
      {
        label: 'Chicago spring-forward (nonexistent 02:30 CST/CDT)',
        date: '2026-03-08',
        time: '02:30',
        tz: 'America/Chicago',
        expected: '2026-03-08T08:30:00.000Z',
      },
      {
        label: 'Chicago fall-back (repeated 01:30 CDT/CST)',
        date: '2026-11-01',
        time: '01:30',
        tz: 'America/Chicago',
        expected: '2026-11-01T07:30:00.000Z',
      },
      {
        label: 'Dublin spring-forward (nonexistent 01:30) — negative-DST zone, the case that pins the rule',
        date: '2026-03-29',
        time: '01:30',
        tz: 'Europe/Dublin',
        expected: '2026-03-29T01:30:00.000Z',
      },
      {
        label: 'Dublin fall-back (repeated 01:30) — negative-DST zone, the case that pins the rule',
        date: '2026-10-25',
        time: '01:30',
        tz: 'Europe/Dublin',
        expected: '2026-10-25T01:30:00.000Z',
      },
      {
        label: 'Lord Howe spring-forward (nonexistent 02:15, 30-minute DST shift)',
        date: '2026-10-04',
        time: '02:15',
        tz: 'Australia/Lord_Howe',
        expected: '2026-10-03T15:45:00.000Z',
      },
      {
        label: 'Lord Howe fall-back (repeated 01:45, 30-minute DST shift)',
        date: '2026-04-05',
        time: '01:45',
        tz: 'Australia/Lord_Howe',
        expected: '2026-04-04T15:15:00.000Z',
      },
    ];

    const hostTimezones = ['UTC', 'America/Chicago', 'Asia/Tokyo'];

    for (const hostTz of hostTimezones) {
      describe(`host TZ=${hostTz}`, () => {
        const originalTz = process.env.TZ;

        afterEach(() => {
          if (originalTz === undefined) delete process.env.TZ;
          else process.env.TZ = originalTz;
        });

        for (const { label, date, time, tz, expected } of cases) {
          it(label, () => {
            process.env.TZ = hostTz;
            expect(wallClockToInstant(date, time, tz)).toEqual(new Date(expected));
          });
        }
      });
    }
  });
});
