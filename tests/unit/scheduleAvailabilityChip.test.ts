import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

const SRC = readFileSync(resolve(__dirname, '../../src/pages/Scheduling.tsx'), 'utf8');
const CHIP_SRC = readFileSync(
  resolve(__dirname, '../../src/pages/SchedulingWeeklyAvailabilityChip.tsx'),
  'utf8',
);

describe('Scheduling availability chip — data wiring', () => {
  it('imports the availability hooks', () => {
    expect(SRC).toMatch(/from '@\/hooks\/useAvailability'/);
    expect(SRC).toMatch(/\buseEmployeeAvailability\b/);
    expect(SRC).toMatch(/\buseAvailabilityExceptions\b/);
  });

  it('imports the effective-availability helpers', () => {
    expect(SRC).toMatch(/from '@\/lib\/effectiveAvailability'/);
    expect(SRC).toMatch(/\bcomputeEffectiveAvailability\b/);
    expect(SRC).toMatch(/\bsummarizeWeekAvailability\b/);
    expect(SRC).toMatch(/\bTIME_OFF_CHIP_CLASSES\b/);
  });

  it('calls both hooks with the restaurant id', () => {
    expect(SRC).toMatch(/useEmployeeAvailability\(restaurantId\)/);
    expect(SRC).toMatch(/useAvailabilityExceptions\(restaurantId\)/);
  });

  it('memoizes computeEffectiveAvailability on a stable employee-id string key, not a fresh array literal', () => {
    // Design doc §3: dep must be `employeeIds.join(',')`-style, not
    // `employees.map(...)` (which defeats the memo every render).
    expect(SRC).toMatch(/\.join\(','\)/);
    expect(SRC).toMatch(/computeEffectiveAvailability\(/);
  });

  it('builds a per-employee week-availability summary map via summarizeWeekAvailability', () => {
    expect(SRC).toMatch(/summarizeWeekAvailability\(/);
  });
});

describe('Scheduling availability chip — desktop name-cell render', () => {
  it('restyles the time-off pill to the muted chip family (no more info-blue)', () => {
    expect(SRC).not.toMatch(/bg-info\/10 text-info/);
    // TIME_OFF_CHIP_CLASSES is the shared `weekAvailabilityChipClasses('time_off')`
    // constant (defined once in effectiveAvailability.ts) applied to the off pill.
    expect(SRC).toMatch(/TIME_OFF_CHIP_CLASSES\.bg/);
    expect(SRC).toMatch(/TIME_OFF_CHIP_CLASSES\.text/);
  });

  it('renders the shared WeeklyAvailabilityChip for the limited/available branch, distinct from the time-off pill', () => {
    // The compute-then-render chip pattern is shared with WeekScheduleMobile's
    // EmployeeCardHeader via SchedulingWeeklyAvailabilityChip.tsx, not
    // duplicated inline here.
    expect(SRC).toMatch(/from '\.\/SchedulingWeeklyAvailabilityChip'/);
    expect(SRC).toMatch(/<WeeklyAvailabilityChip availability={weekAvailability} \/>/);
  });

  it('keeps the off-pill reasons tooltip and sr-only text intact', () => {
    expect(SRC).toMatch(/off\.reasons\.length/);
    expect(SRC).toMatch(/sr-only/);
  });
});

describe('SchedulingWeeklyAvailabilityChip — shared chip render', () => {
  it('guards on a possibly-null classes object rather than assuming a chip is always shown', () => {
    // weekAvailabilityChipClasses('unset') returns null — the component must
    // render nothing in that case (and when there's no availability data at
    // all), instead of assuming a chip is always shown.
    expect(CHIP_SRC).toMatch(/\bweekAvailabilityChipClasses\b/);
    expect(CHIP_SRC).toMatch(/if \(!availability\) return null;/);
    expect(CHIP_SRC).toMatch(/if \(!classes\) return null;/);
  });
});
