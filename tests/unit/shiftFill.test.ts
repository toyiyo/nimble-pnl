/**
 * Tests for computeCellFill / distinctAssignedCount — the "fill by assignment"
 * engine that replaces the whole-floor coverage sweep for the per-template
 * fill badge. See docs/superpowers/specs/2026-07-20-shift-fill-by-assignment-design.md.
 *
 * Key invariant under test: `openSpots` is driven by COUNT(DISTINCT employee_id)
 * assigned to the template's own bucket — NOT by the time-based sweep-line
 * `minConcurrent` (which stays available for the coveragePct/segments popover
 * only). A single assignee whose hours cover only part of the window still
 * fills the slot.
 */
import { describe, it, expect } from 'vitest';
import { computeCellFill, distinctAssignedCount } from '@/lib/shiftFill';
import type { CoverageShift } from '@/types/scheduling';

const mk = (
  emp: string,
  startIso: string,
  endIso: string,
  overrides: Partial<CoverageShift> = {},
): CoverageShift => ({
  employee_id: emp,
  start_time: startIso,
  end_time: endIso,
  position: 'Server',
  status: 'scheduled',
  ...overrides,
});

// America/Chicago, 2026-06-27 (CDT, UTC-5). 09:00 local = 14:00Z.
const tz = 'America/Chicago';
const D = '2026-06-27';
const baseOpts = { position: 'Server', tz, dateStr: D, windowStart: '09:00:00', windowEnd: '17:00:00' };

describe('distinctAssignedCount', () => {
  it('empty bucket => 0', () => {
    expect(distinctAssignedCount([])).toBe(0);
  });

  it('one employee with two overlapping shifts in the bucket counts once', () => {
    const bucket = [
      mk('A', '2026-06-27T14:00:00Z', '2026-06-27T16:00:00Z'), // 09:00-11:00 CDT
      mk('A', '2026-06-27T15:00:00Z', '2026-06-27T17:00:00Z'), // 10:00-12:00 CDT (same emp)
    ];
    expect(distinctAssignedCount(bucket)).toBe(1);
  });

  it('ignores cancelled shifts', () => {
    const bucket = [
      mk('A', '2026-06-27T14:00:00Z', '2026-06-27T22:00:00Z'), // 09:00-17:00 CDT
      mk('B', '2026-06-27T14:00:00Z', '2026-06-27T22:00:00Z', { status: 'cancelled' }),
    ];
    expect(distinctAssignedCount(bucket)).toBe(1);
  });

  it('two distinct employees => 2', () => {
    const bucket = [
      mk('A', '2026-06-27T14:00:00Z', '2026-06-27T22:00:00Z'),
      mk('B', '2026-06-27T14:00:00Z', '2026-06-27T22:00:00Z'),
    ];
    expect(distinctAssignedCount(bucket)).toBe(2);
  });
});

describe('computeCellFill — fill badge decoupled from time-based sweep', () => {
  it('empty bucket => openSpots == capacity, minConcurrent == 0, coveragePct == 0', () => {
    const c = computeCellFill([], 2, baseOpts);
    expect(c.openSpots).toBe(2);
    expect(c.minConcurrent).toBe(0);
    expect(c.coveragePct).toBe(0);
  });

  it('partial-hours single assignee (capacity 1) fills the slot even though hours only cover part of the window', () => {
    // Template window 09:00-17:00 (8h), cap 1. Employee A works only 09:00-11:00.
    const bucket = [mk('A', '2026-06-27T14:00:00Z', '2026-06-27T16:00:00Z')]; // 09:00-11:00 CDT
    const c = computeCellFill(bucket, 1, baseOpts);
    expect(c.openSpots).toBe(0); // filled by assignment
    // The time-based sweep still reports the true gap (11:00-17:00 uncovered) —
    // it must NOT be what openSpots is derived from.
    expect(c.minConcurrent).toBe(0);
    expect(c.coveragePct).toBeLessThan(100);
  });

  it('capacity floor: 0/NaN coerced to 1', () => {
    const c = computeCellFill([], 0, baseOpts);
    expect(c.openSpots).toBe(1);
    const c2 = computeCellFill([], Number.NaN, baseOpts);
    expect(c2.openSpots).toBe(1);
  });

  it('over-assignment: 2 distinct employees in a capacity-1 bucket => 0 open (clamped, not negative)', () => {
    const bucket = [
      mk('A', '2026-06-27T14:00:00Z', '2026-06-27T22:00:00Z'), // 09:00-17:00 CDT
      mk('B', '2026-06-27T14:00:00Z', '2026-06-27T22:00:00Z'), // 09:00-17:00 CDT
    ];
    expect(distinctAssignedCount(bucket)).toBe(2);
    const c = computeCellFill(bucket, 1, baseOpts);
    expect(c.openSpots).toBe(0);
  });

  it('cancelled shift in the bucket does not count toward assignment', () => {
    const bucket = [mk('A', '2026-06-27T14:00:00Z', '2026-06-27T22:00:00Z', { status: 'cancelled' })];
    const c = computeCellFill(bucket, 1, baseOpts);
    expect(c.openSpots).toBe(1);
  });

  it('coveragePct/segments are produced from the sweep over the bucket only (100% full-window coverage)', () => {
    const bucket = [
      mk('A', '2026-06-27T14:00:00Z', '2026-06-27T18:00:00Z'), // 09:00-13:00 CDT
      mk('B', '2026-06-27T18:00:00Z', '2026-06-27T22:00:00Z'), // 13:00-17:00 CDT
    ];
    const c = computeCellFill(bucket, 1, baseOpts);
    expect(c.coveragePct).toBe(100);
    expect(c.segments.every((s) => s.covered)).toBe(true);
    expect(c.coveringEmployees.map((e) => e.employeeId).sort()).toEqual(['A', 'B']);
  });

  it('regression: a same-position shift belonging to a different template is not in this bucket, so it does not affect this cell', () => {
    // Simulates the bug: an employee's long shift on a DIFFERENT template would
    // previously satisfy the whole-floor sweep for this cell. Since the caller
    // is responsible for bucketing by shift_template_id, that other shift never
    // appears in `bucket` here — computeCellFill has no way to see it.
    const bucket: CoverageShift[] = []; // this template's bucket has no assignees
    const c = computeCellFill(bucket, 1, baseOpts);
    expect(c.openSpots).toBe(1); // genuinely open, not phantom-filled
  });
});
