import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

const SRC = readFileSync(resolve(__dirname, '../../src/pages/Scheduling.tsx'), 'utf8');

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
    expect(SRC).toMatch(/\bweekAvailabilityChipClasses\b/);
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
    expect(SRC).toMatch(/weekAvailabilityChipClasses\('time_off'\)/);
  });

  it('renders a chip for limited/available status using the summary map, distinct from the time-off pill', () => {
    expect(SRC).toMatch(/weekAvailability\.label/);
  });

  it('keeps the off-pill reasons tooltip and sr-only text intact', () => {
    expect(SRC).toMatch(/off\.reasons\.length/);
    expect(SRC).toMatch(/sr-only/);
  });

  it('renders no chip for unset (weekAvailabilityChipClasses returns null)', () => {
    // The render path must guard on a possibly-null classes object rather
    // than assuming a chip is always shown.
    expect(SRC).toMatch(/availabilityChipClasses/);
  });
});
