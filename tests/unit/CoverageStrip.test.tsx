import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';

import { CoverageStrip } from '@/components/scheduling/ShiftPlanner/CoverageStrip';

const weekDays = [
  '2026-04-20', '2026-04-21', '2026-04-22', '2026-04-23',
  '2026-04-24', '2026-04-25', '2026-04-26',
];

describe('<CoverageStrip>', () => {
  it('renders one bar per day in weekDays', () => {
    const coverage = new Map<string, number[]>();
    for (const d of weekDays) coverage.set(d, new Array(17).fill(0));
    const { container } = render(<CoverageStrip weekDays={weekDays} coverageByDay={coverage} />);
    const columns = container.querySelectorAll('[data-coverage-day]');
    expect(columns).toHaveLength(7);
  });

  it('applies density class based on bucket value', () => {
    const coverage = new Map<string, number[]>();
    const row = new Array(17).fill(0);
    row[6] = 3;
    coverage.set('2026-04-20', row);
    for (let i = 1; i < weekDays.length; i++) coverage.set(weekDays[i], new Array(17).fill(0));
    const { container } = render(<CoverageStrip weekDays={weekDays} coverageByDay={coverage} />);
    const buckets = container.querySelectorAll('[data-density]');
    // First day's 7th bucket should be density=3
    const monday = container.querySelector('[data-coverage-day="2026-04-20"]')!;
    const mondayBuckets = monday.querySelectorAll('[data-density]');
    expect(mondayBuckets[6].getAttribute('data-density')).toBe('3');
    expect(buckets.length).toBeGreaterThan(0);
  });

  it('clamps headcounts ≥4 to density 4', () => {
    const coverage = new Map<string, number[]>();
    const row = new Array(17).fill(0);
    row[0] = 7;
    coverage.set('2026-04-20', row);
    for (let i = 1; i < weekDays.length; i++) coverage.set(weekDays[i], new Array(17).fill(0));
    const { container } = render(<CoverageStrip weekDays={weekDays} coverageByDay={coverage} />);
    const monday = container.querySelector('[data-coverage-day="2026-04-20"]')!;
    const first = monday.querySelector('[data-density]')!;
    expect(first.getAttribute('data-density')).toBe('4');
  });
});
