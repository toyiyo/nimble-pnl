import { describe, it, expect } from 'vitest';
import { buildCopyPayload, shouldAllowDrop } from '@/components/scheduling/useShiftCopyDnd';

describe('shouldAllowDrop', () => {
  it('returns false when dropping on the same day', () => {
    expect(shouldAllowDrop({ sourceEmployeeId: 'emp-1', sourceDay: '2026-03-24', targetEmployeeId: 'emp-1', targetDay: '2026-03-24' })).toBe(false);
  });
  it('returns true when dropping on a different employee, different day', () => {
    expect(shouldAllowDrop({ sourceEmployeeId: 'emp-1', sourceDay: '2026-03-24', targetEmployeeId: 'emp-2', targetDay: '2026-03-25' })).toBe(true);
  });
  it('returns true when dropping on a different employee, same day', () => {
    expect(shouldAllowDrop({ sourceEmployeeId: 'emp-1', sourceDay: '2026-03-24', targetEmployeeId: 'emp-2', targetDay: '2026-03-24' })).toBe(true);
  });
  it('returns true for same employee, different day', () => {
    expect(shouldAllowDrop({ sourceEmployeeId: 'emp-1', sourceDay: '2026-03-24', targetEmployeeId: 'emp-1', targetDay: '2026-03-25' })).toBe(true);
  });
});

describe('buildCopyPayload', () => {
  const UTC = 'UTC';
  const baseShift = {
    id: 'shift-1',
    restaurant_id: 'rest-1',
    employee_id: 'emp-1',
    start_time: '2026-03-24T09:00:00.000Z',
    end_time: '2026-03-24T17:00:00.000Z',
    break_duration: 30,
    position: 'Server',
    notes: 'Morning shift',
    status: 'scheduled' as const,
    is_recurring: true,
    recurrence_pattern: { type: 'weekly' as const, endType: 'never' as const },
    recurrence_parent_id: 'parent-1',
    is_published: false,
    locked: false,
    created_at: '',
    updated_at: '',
  };

  it('builds payload with correct target date and restaurant-local time', () => {
    const payload = buildCopyPayload(baseShift, '2026-03-26', UTC);
    expect(payload.employee_id).toBe('emp-1');
    expect(payload.restaurant_id).toBe('rest-1');
    expect(payload.position).toBe('Server');
    expect(payload.break_duration).toBe(30);
    expect(payload.notes).toBe('Morning shift');
    expect(payload.start_time).toBe('2026-03-26T09:00:00.000Z');
  });

  it('strips recurrence fields — always creates a one-off', () => {
    const payload = buildCopyPayload(baseShift, '2026-03-26', UTC);
    expect(payload.is_recurring).toBe(false);
    expect(payload.recurrence_pattern).toBeNull();
    expect(payload.recurrence_parent_id).toBeNull();
  });

  it('sets status to scheduled and locked to false', () => {
    const payload = buildCopyPayload({ ...baseShift, status: 'confirmed', locked: true }, '2026-03-26', UTC);
    expect(payload.status).toBe('scheduled');
    expect(payload.locked).toBe(false);
    expect(payload.is_published).toBe(false);
  });

  it('uses target employee ID when provided', () => {
    const payload = buildCopyPayload(baseShift, '2026-03-26', UTC, 'emp-2');
    expect(payload.employee_id).toBe('emp-2');
    expect(payload.position).toBe('Server'); // keeps source position
  });

  it('defaults to source employee when no target employee provided', () => {
    const payload = buildCopyPayload(baseShift, '2026-03-26', UTC);
    expect(payload.employee_id).toBe('emp-1');
  });

  // Named for the contract this actually asserts. It used to say
  // "duration-preserving", which is the contract `buildCopyPayload`
  // deliberately does NOT have: reusing the source's elapsed duration is the
  // bug that skews a copy dropped either side of a DST transition. What is
  // preserved is the pair of restaurant-local wall clocks plus the end-day
  // offset; the duration is whatever those imply on the target dates.
  it('handles overnight shifts (end time next day), wall-clock-preserving', () => {
    const overnight = {
      ...baseShift,
      start_time: '2026-03-24T22:00:00.000Z',
      end_time: '2026-03-25T02:00:00.000Z',
    };
    const payload = buildCopyPayload(overnight, '2026-03-28', UTC);
    expect(payload.start_time).toBe('2026-03-28T22:00:00.000Z');
    expect(payload.end_time).toBe('2026-03-29T02:00:00.000Z');
  });

  it('anchors to the restaurant timezone, not the host device — the headline surface-6 defect', () => {
    // Restaurant is America/Chicago; the previous implementation read the
    // HOST's local hour/minute (`srcStart.getHours()`) instead, so under a
    // host TZ other than Chicago the copy would land on the wrong wall-clock
    // hour. 09:00 Chicago (CDT, UTC-5) on 2026-03-24 is 14:00Z.
    const chicagoShift = { ...baseShift, start_time: '2026-03-24T14:00:00.000Z', end_time: '2026-03-24T22:00:00.000Z' };
    const payload = buildCopyPayload(chicagoShift, '2026-03-26', 'America/Chicago');
    // 09:00 CDT on the target day, still 2026-03-26 in Chicago -> 14:00Z.
    expect(payload.start_time).toBe('2026-03-26T14:00:00.000Z');
  });

  it('preserves the restaurant-local wall clock across a DST transition the host does not observe', () => {
    // US Spring Forward: America/Chicago skips 02:00 CST -> 03:00 CDT on 2026-03-08.
    // A 09:00 CST (UTC-6) shift on Mon Mar 2, copied to Sun Mar 8 (already CDT,
    // UTC-5), must still read 09:00 restaurant-local — a different UTC instant,
    // not a naive same-ms-offset copy.
    const chicagoTz = 'America/Chicago';
    const shift = { ...baseShift, start_time: '2026-03-02T15:00:00.000Z', end_time: '2026-03-02T19:00:00.000Z' }; // 09:00-13:00 CST
    const payload = buildCopyPayload(shift, '2026-03-08', chicagoTz);
    expect(payload.start_time).toBe('2026-03-08T14:00:00.000Z'); // 09:00 CDT
    expect(payload.end_time).toBe('2026-03-08T18:00:00.000Z'); // 13:00 CDT
  });

  it('resolves the copy\'s end time from its own wall clock, not the source\'s elapsed-instant duration, when the SOURCE shift itself crosses the spring-forward transition', () => {
    // Source is a 22:00->06:00 Chicago overnight shift straddling the
    // 2026-03-08 02:00->03:00 spring-forward: 22:00 CST 03-07 to 06:00 CDT
    // 03-08 is 8h of wall-clock time but only 7h of elapsed instant time. A
    // `newStart + sourceDurationMs` strategy would carry that 7h onto the
    // copy even though the copy's target day (well after the transition)
    // never crosses one itself, landing the copy at 05:00 instead of 06:00.
    const chicagoTz = 'America/Chicago';
    const source = {
      ...baseShift,
      start_time: '2026-03-08T04:00:00.000Z', // 22:00 CST 2026-03-07
      end_time: '2026-03-08T11:00:00.000Z', // 06:00 CDT 2026-03-08
    };
    const payload = buildCopyPayload(source, '2026-04-06', chicagoTz);
    // 22:00 CDT 2026-04-06 -> 03:00Z 2026-04-07.
    expect(payload.start_time).toBe('2026-04-07T03:00:00.000Z');
    // 06:00 CDT 2026-04-07 -> 11:00Z 2026-04-07. A durationMs-based
    // implementation would instead produce 2026-04-07T10:00:00.000Z (05:00 CDT).
    expect(payload.end_time).toBe('2026-04-07T11:00:00.000Z');
  });

  it('preserves a multi-day span — a Mon 09:00 -> Tue 17:00 source keeps its extra calendar day', () => {
    // ShiftDialog exposes INDEPENDENT start-date and end-date fields and only
    // rejects `end <= start`, so a shift whose end lands on a later calendar
    // day while its end clock is >= its start clock is representable and
    // creatable (>16h is a duration *warning*, never a rejection). Rebuilding
    // the copy from the two `HH:MM` values alone silently collapses it to a
    // single day, because the only multi-day signal `ShiftInterval.create`
    // has is the `endTime < startTime` overnight heuristic — which 17:00 vs
    // 09:00 does not trip.
    const source = {
      ...baseShift,
      start_time: '2026-03-23T09:00:00.000Z', // Mon 09:00 UTC
      end_time: '2026-03-24T17:00:00.000Z', // Tue 17:00 UTC — 32h
    };
    const payload = buildCopyPayload(source, '2026-03-25', UTC); // drop on Wed
    expect(payload.start_time).toBe('2026-03-25T09:00:00.000Z'); // Wed 09:00
    // Thu 17:00, not Wed 17:00. A HH:MM-only reconstruction yields
    // 2026-03-25T17:00:00.000Z and turns a 32h shift into an 8h one.
    expect(payload.end_time).toBe('2026-03-26T17:00:00.000Z');
  });

  it('preserves an exact 24h span rather than throwing INVALID_DURATION', () => {
    // Equal start/end wall clocks are not an overnight crossing by the
    // `endTime < startTime` test, so a HH:MM-only reconstruction resolves
    // both onto the same day, computes a zero duration, and throws.
    const source = {
      ...baseShift,
      start_time: '2026-03-23T09:00:00.000Z', // Mon 09:00 UTC
      end_time: '2026-03-24T09:00:00.000Z', // Tue 09:00 UTC — exactly 24h
    };
    const payload = buildCopyPayload(source, '2026-03-25', UTC);
    expect(payload.start_time).toBe('2026-03-25T09:00:00.000Z');
    expect(payload.end_time).toBe('2026-03-26T09:00:00.000Z');
  });

  it('carries a multi-day span across a DST transition using each endpoint\'s own wall clock', () => {
    // Chicago source: Fri 22:00 -> Sun 06:00 (a 2-day offset), copied onto a
    // target Friday whose span straddles the 2026-11-01 fall-back. The span
    // must stay 2 calendar days at the same wall clocks; the elapsed
    // duration legitimately grows by an hour because the target span gains
    // the repeated hour.
    const chicagoTz = 'America/Chicago';
    const source = {
      ...baseShift,
      start_time: '2026-07-11T03:00:00.000Z', // Fri 2026-07-10 22:00 CDT
      end_time: '2026-07-12T11:00:00.000Z', // Sun 2026-07-12 06:00 CDT
    };
    const payload = buildCopyPayload(source, '2026-10-30', chicagoTz);
    expect(payload.start_time).toBe('2026-10-31T03:00:00.000Z'); // Fri 22:00 CDT
    // Sun 2026-11-01 06:00 is CST (UTC-6), after the 02:00 fall-back.
    expect(payload.end_time).toBe('2026-11-01T12:00:00.000Z');
  });

  it('throws on an invalid/empty timezone rather than silently falling back', () => {
    expect(() => buildCopyPayload(baseShift, '2026-03-26', '')).toThrow();
    expect(() => buildCopyPayload(baseShift, '2026-03-26', 'Not/AZone')).toThrow();
  });
});
