import { describe, it, expect } from 'vitest';
import { mergeManualHours, hoursFromPunches } from '@/utils/tipHours';

describe('mergeManualHours', () => {
  it('preserves a manually-edited entry (flag === false) over punch-derived', () => {
    const result = mergeManualHours(
      { a: '0.00', b: '0.00' }, // punchDerived
      { a: '8', b: '0.00' },    // prev
      { a: false },             // a was user-typed
    );
    expect(result.a).toBe('8');     // preserved
    expect(result.b).toBe('0.00');  // refreshed from punches
  });

  it('refreshes an auto-calculated entry (flag === true) from punch-derived', () => {
    const result = mergeManualHours(
      { a: '7.50' },
      { a: '8.00' },
      { a: true }, // a was auto-calculated, not manual
    );
    expect(result.a).toBe('7.50');
  });

  it('refreshes an entry whose flag is absent (undefined) from punch-derived', () => {
    const result = mergeManualHours(
      { a: '6.00', b: '6.00' },
      { a: '6.00', b: '99' },
      { a: false }, // b absent from the flag map entirely
    );
    expect(result.a).toBe('6.00'); // manual preserved
    expect(result.b).toBe('6.00'); // b has no flag → punch-derived wins
  });

  it('exact bug scenario: typed hours survive a punch-derived all-zero refresh', () => {
    const result = mergeManualHours(
      { a: '0.00', b: '0.00' }, // no punches → all zero
      { a: '8' },               // user typed a, b untouched
      { a: false },
    );
    expect(result).toEqual({ a: '8', b: '0.00' });
  });

  it('returns punch-derived unchanged when there are no manual edits', () => {
    const result = mergeManualHours(
      { a: '5.00', b: '5.00' },
      { a: '5.00', b: '5.00' },
      { a: true, b: true },
    );
    expect(result).toEqual({ a: '5.00', b: '5.00' });
  });

  it('handles empty maps', () => {
    expect(mergeManualHours({}, {}, {})).toEqual({});
  });

  it('keeps a manual entry even if it is absent from punch-derived', () => {
    const result = mergeManualHours({}, { a: '8' }, { a: false });
    expect(result.a).toBe('8');
  });

  it('does not mutate its inputs', () => {
    const punch = { a: '0.00' };
    const prev = { a: '8' };
    const flags = { a: false };
    mergeManualHours(punch, prev, flags);
    expect(punch).toEqual({ a: '0.00' });
    expect(prev).toEqual({ a: '8' });
  });
});

describe('hoursFromPunches', () => {
  const dayStart = new Date('2026-11-13T00:00:00Z');
  const dayEnd = new Date('2026-11-13T23:59:59.999Z');
  const punch = (employee_id: string, punch_type: string, punch_time: string) =>
    ({ employee_id, punch_type, punch_time }) as unknown as Parameters<typeof hoursFromPunches>[1][number];

  it('counts a cross-midnight shift when punches arrive newest first (the useTimePunches order)', () => {
    // useTimePunches orders punch_time DESC. The old Effect 2 pairing looked for a
    // clock_out AFTER the clock_in in array order, found none, and wrote "0.00".
    const punches = [
      punch('nova', 'clock_out', '2026-11-14T01:00:00Z'),
      punch('nova', 'clock_in', '2026-11-13T20:00:00Z'),
    ];
    expect(hoursFromPunches(['nova'], punches, dayStart, dayEnd)).toEqual({ nova: '5' });
  });

  it('rounds to one decimal place', () => {
    const punches = [
      punch('ana', 'clock_in', '2026-11-13T10:00:00Z'),
      punch('ana', 'clock_out', '2026-11-13T14:20:00Z'),
    ];
    expect(hoursFromPunches(['ana'], punches, dayStart, dayEnd)).toEqual({ ana: '4.3' });
  });

  it('omits an employee with no punches', () => {
    const punches = [
      punch('ana', 'clock_in', '2026-11-13T10:00:00Z'),
      punch('ana', 'clock_out', '2026-11-13T12:00:00Z'),
    ];
    expect(hoursFromPunches(['ana', 'ben'], punches, dayStart, dayEnd)).toEqual({ ana: '2' });
  });

  it('attributes a shift to its clock-in day only', () => {
    // Clock in the previous evening: the hours belong to Nov 12, not Nov 13.
    const punches = [
      punch('cal', 'clock_out', '2026-11-13T02:00:00Z'),
      punch('cal', 'clock_in', '2026-11-12T22:00:00Z'),
    ];
    expect(hoursFromPunches(['cal'], punches, dayStart, dayEnd)).toEqual({ cal: '0' });
  });
});
