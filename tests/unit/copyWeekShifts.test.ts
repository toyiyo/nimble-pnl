import { describe, it, expect } from 'vitest';
import { buildCopyPayload } from '@/lib/copyWeekShifts';
import type { Shift } from '@/types/scheduling';

/**
 * Helper to create a local Date and return its ISO string (UTC),
 * matching the format Supabase returns for timestamptz columns.
 */
function localToISO(dateStr: string): string {
  return new Date(dateStr).toISOString();
}

function mockShift(overrides: Partial<Shift>): Shift {
  return {
    id: crypto.randomUUID(),
    restaurant_id: 'r1',
    employee_id: 'e1',
    start_time: localToISO('2026-03-02T10:00:00Z'),
    end_time: localToISO('2026-03-02T16:00:00Z'),
    break_duration: 30,
    position: 'Server',
    notes: undefined,
    status: 'scheduled',
    is_published: false,
    locked: false,
    is_recurring: false,
    recurrence_parent_id: null,
    recurrence_pattern: null,
    published_at: null,
    published_by: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  } as Shift;
}

describe('buildCopyPayload', () => {
  // Source week: Mon Mar 2 - Sun Mar 8 2026, Target week: Mon Mar 9 - Sun Mar 15 (offset = +7 days).
  // `sourceMonday`/`targetMonday` are the host-local-midnight `Date`s the UI calendar produces —
  // built with the local `Date(y, m, d)` constructor, matching real call sites (`getMondayOfWeek`).
  const sourceMonday = new Date(2026, 2, 2);
  const targetMonday = new Date(2026, 2, 9);
  const restaurantId = 'r1';
  const tz = 'UTC';

  it('should offset shift dates by the week delta', () => {
    const shifts = [
      mockShift({
        start_time: localToISO('2026-03-02T10:00:00Z'),
        end_time: localToISO('2026-03-02T16:00:00Z'),
      }),
    ];
    const result = buildCopyPayload(shifts, sourceMonday, targetMonday, restaurantId, tz);
    expect(result).toHaveLength(1);
    expect(result[0].start_time).toBe('2026-03-09T10:00:00.000Z');
    expect(result[0].end_time).toBe('2026-03-09T16:00:00.000Z');
  });

  it('should preserve employee_id, position, break_duration, notes', () => {
    const shifts = [
      mockShift({ employee_id: 'emp-42', position: 'Bartender', break_duration: 45, notes: 'Training shift' }),
    ];
    const result = buildCopyPayload(shifts, sourceMonday, targetMonday, restaurantId, tz);
    expect(result[0].employee_id).toBe('emp-42');
    expect(result[0].position).toBe('Bartender');
    expect(result[0].break_duration).toBe(45);
    expect(result[0].notes).toBe('Training shift');
  });

  it('should always set status=scheduled, is_published=false, locked=false', () => {
    const shifts = [mockShift({ status: 'confirmed', is_published: true, locked: true })];
    const result = buildCopyPayload(shifts, sourceMonday, targetMonday, restaurantId, tz);
    expect(result[0].status).toBe('scheduled');
    expect(result[0].is_published).toBe(false);
    expect(result[0].locked).toBe(false);
  });

  it('should exclude cancelled shifts', () => {
    const shifts = [mockShift({ status: 'scheduled' }), mockShift({ status: 'cancelled' })];
    const result = buildCopyPayload(shifts, sourceMonday, targetMonday, restaurantId, tz);
    expect(result).toHaveLength(1);
  });

  it('should use the provided restaurantId', () => {
    const shifts = [mockShift({ restaurant_id: 'old-r' })];
    const result = buildCopyPayload(shifts, sourceMonday, targetMonday, 'new-r', tz);
    expect(result[0].restaurant_id).toBe('new-r');
  });

  it('should handle negative offset (copying backward)', () => {
    const result = buildCopyPayload(
      [mockShift({
        start_time: localToISO('2026-03-09T10:00:00Z'),
        end_time: localToISO('2026-03-09T16:00:00Z'),
      })],
      new Date(2026, 2, 9),
      new Date(2026, 2, 2),
      restaurantId,
      tz,
    );
    expect(result[0].start_time).toBe('2026-03-02T10:00:00.000Z');
  });

  it('should handle overnight shifts (end_time next day)', () => {
    const shifts = [mockShift({
      start_time: localToISO('2026-03-02T22:00:00Z'),
      end_time: localToISO('2026-03-03T06:00:00Z'),
    })];
    const result = buildCopyPayload(shifts, sourceMonday, targetMonday, restaurantId, tz);
    // Start on target Monday (9th) at 22:00, end on target Tuesday (10th) at 06:00.
    expect(result[0].start_time).toBe('2026-03-09T22:00:00.000Z');
    expect(result[0].end_time).toBe('2026-03-10T06:00:00.000Z');
  });

  it('should return empty array for empty input', () => {
    const result = buildCopyPayload([], sourceMonday, targetMonday, restaurantId, tz);
    expect(result).toEqual([]);
  });

  it('should handle multi-week offset (2 weeks forward)', () => {
    const twoWeeksLater = new Date(2026, 2, 16);
    const shifts = [mockShift({
      start_time: localToISO('2026-03-04T10:00:00Z'),
      end_time: localToISO('2026-03-04T16:00:00Z'),
    })];
    const result = buildCopyPayload(shifts, sourceMonday, twoWeeksLater, restaurantId, tz);
    // Wed Mar 4 + 14 days = Wed Mar 18
    expect(result[0].start_time).toBe('2026-03-18T10:00:00.000Z');
  });

  it('should produce ISO strings (matching codebase convention)', () => {
    const shifts = [mockShift()];
    const result = buildCopyPayload(shifts, sourceMonday, targetMonday, restaurantId, tz);
    expect(result[0].start_time).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(result[0].end_time).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('should preserve restaurant-local wall-clock time across a restaurant-tz DST boundary', () => {
    // US Spring Forward: America/Chicago skips 02:00 CST -> 03:00 CDT on 2026-03-08.
    // Source Mon Mar 2 (CST, UTC-6) copied to target Mon Mar 9 (CDT, UTC-5): a
    // restaurant-local 10:00 shift must land on 10:00 restaurant-local both weeks,
    // which means a *different* UTC instant (15:00Z pre-DST, 15:00Z post-DST would
    // be wrong — the correct post-DST UTC hour shifts by one).
    const chicagoTz = 'America/Chicago';
    const shifts = [mockShift({
      start_time: '2026-03-02T16:00:00.000Z', // 10:00 CST (UTC-6)
      end_time: '2026-03-02T22:00:00.000Z', // 16:00 CST
    })];

    const result = buildCopyPayload(shifts, sourceMonday, targetMonday, restaurantId, chicagoTz);

    // 10:00 CDT (UTC-5) on Mar 9, not a naive +7-day / same-ms-offset copy.
    expect(result[0].start_time).toBe('2026-03-09T15:00:00.000Z');
    expect(result[0].end_time).toBe('2026-03-09T21:00:00.000Z');
  });

  it('should bucket by the restaurant calendar day, not the host device day (headline surface-5 defect)', () => {
    // A shift at 00:30 Wednesday Asia/Tokyo time is, in UTC, still Tuesday
    // afternoon (2026-03-03T15:30:00Z). The previous implementation derived
    // `dayOffset` from `new Date(isoString).getDate()` — the *host* device's
    // calendar day — which can disagree with the restaurant's calendar day
    // for exactly this kind of late-night/early-morning shift, landing the
    // copy on the wrong day of week. `sourceMonday`/`targetMonday` here are
    // built with the local `Date(y, m, d)` constructor (host-local midnight,
    // as real call sites produce), independent of the restaurant's zone.
    const tokyoTz = 'Asia/Tokyo';
    const shifts = [mockShift({
      start_time: '2026-03-03T15:30:00.000Z', // 00:30 Wed Mar 4, Asia/Tokyo
      end_time: '2026-03-03T17:30:00.000Z', // 02:30 Wed Mar 4, Asia/Tokyo
    })];

    const result = buildCopyPayload(shifts, sourceMonday, targetMonday, restaurantId, tokyoTz);

    // Correct: same restaurant-local wall clock one week later — Wed Mar 11, 00:30 JST.
    expect(result[0].start_time).toBe('2026-03-10T15:30:00.000Z');
    expect(result[0].end_time).toBe('2026-03-10T17:30:00.000Z');

    const weekdayTokyo = new Intl.DateTimeFormat('en-US', { timeZone: tokyoTz, weekday: 'long' })
      .format(new Date(result[0].start_time));
    expect(weekdayTokyo).toBe('Wednesday');
  });

  it('should throw on an invalid/empty timezone rather than silently falling back', () => {
    const shifts = [mockShift()];
    expect(() => buildCopyPayload(shifts, sourceMonday, targetMonday, restaurantId, '')).toThrow();
    expect(() => buildCopyPayload(shifts, sourceMonday, targetMonday, restaurantId, 'Not/AZone')).toThrow();
  });
});
