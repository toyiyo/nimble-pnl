import { describe, it, expect } from 'vitest';
import { toBusinessDay } from '@/lib/restaurantClock';

/**
 * Regression test for CodeRabbit review, PR #682: Scheduling.tsx's
 * `selectShiftsForDay` (~line 511) and `getShiftsForEmployee` (~line 778)
 * both used to bucket a shift to a grid column via
 *   isSameDay(parseISO(shift.start_time), day)
 * which compares in the VIEWER's local zone. That directly contradicted the
 * `dayIsToday` highlight (Scheduling.tsx:1204), which this branch already
 * converted to the restaurant's business day -- same column, two different
 * notions of "day".
 *
 * The fix buckets both call sites the same way instead:
 *   toBusinessDay(shift.start_time, restaurantTimezone) === dayKey
 *
 * Rendering Scheduling.tsx itself needs ~20 unrelated hooks mocked
 * (useShifts, useEmployees, useShiftTemplates, useStaffingSettings,
 * useShiftTrades, useTimeOffRequests, useEmployeeAvailability, ...) and this
 * codebase has no existing render harness for that page. This test instead
 * pins the exact bucketing expression both fixed call sites now share,
 * against the scenario the brief calls out: a shift instant that lands on
 * the restaurant's Tuesday but a viewer-local Wednesday.
 */
describe('Scheduling day bucketing — toBusinessDay(shift.start_time, tz), not isSameDay(parseISO(...), day)', () => {
  const restaurantTz = 'America/Chicago'; // UTC-5 in April (CDT, no DST edge in play)

  it('buckets a late-evening restaurant shift into the restaurant Tuesday column, not the viewer Wednesday column', () => {
    // 2026-04-14 23:00 America/Chicago == 2026-04-15 04:00 UTC.
    const shiftStartInstant = '2026-04-15T04:00:00.000Z';

    // What the pre-fix `isSameDay(parseISO(instant), day)` effectively did:
    // read the day in the VIEWER's zone. A UTC-based viewer reads Wednesday.
    const viewerLocalDay = shiftStartInstant.slice(0, 10);
    expect(viewerLocalDay).toBe('2026-04-15'); // Wednesday

    // What the fix does: bucket by the restaurant's own business day.
    const restaurantDay = toBusinessDay(shiftStartInstant, restaurantTz);
    expect(restaurantDay).toBe('2026-04-14'); // Tuesday

    const tuesdayColumn = '2026-04-14';
    const wednesdayColumn = '2026-04-15';

    // The fixed comparison (`toBusinessDay(...) === dayStr`) lands the shift
    // in the Tuesday column...
    expect(restaurantDay === tuesdayColumn).toBe(true);
    // ...not the viewer's Wednesday column, which is what the old
    // isSameDay/parseISO comparison would have matched instead.
    expect(restaurantDay === wednesdayColumn).toBe(false);
  });
});
