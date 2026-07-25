import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { CoverageVerdict } from '@/components/scheduling/ShiftTimeline/CoverageVerdict';
import type { CoverageVerdict as CVType } from '@/lib/coverageSummary';

const BASE = {
  minStaff: 4,
  demandShortHours: 0,
  demandShortPeopleHours: 0,
  worstCrit: null,
  floorOnlyHours: 0,
  floorPeopleHours: 0,
  coveredHours: 0,
  nodataHours: 0,
} satisfies Partial<CVType>;

const NO_DEMAND: CVType = {
  ...BASE,
  hasDemand: false,
  metAll: false,
  shortHours: 0,
  totalHours: 3,
  worst: null,
};

const ALL_MET: CVType = {
  ...BASE,
  hasDemand: true,
  metAll: true,
  shortHours: 0,
  totalHours: 8,
  worst: null,
  coveredHours: 8,
};

// Short in both ways: 3 demand-short hours (7 people-hours, worst 5 PM short 3)
// AND 2 floor-only hours against a 4-person floor.
const SHORT: CVType = {
  hasDemand: true,
  metAll: false,
  shortHours: 5,
  totalHours: 14,
  worst: { hour: 17, delta: -3 },
  minStaff: 4,
  demandShortHours: 3,
  demandShortPeopleHours: 7,
  worstCrit: { hour: 17, short: 3 },
  floorOnlyHours: 2,
  floorPeopleHours: 2,
  coveredHours: 9,
  nodataHours: 0,
};

// The sentence interleaves emphasis <span>s, so assert on full textContent
// rather than per-text-node matchers (which don't span child elements).
describe('CoverageVerdict', () => {
  it('shows neutral message when no demand is configured', () => {
    const { container } = render(<CoverageVerdict verdict={NO_DEMAND} />);
    expect(container.textContent).toMatch(/add staffing targets/i);
  });

  it('shows "meeting demand all day" when everything is covered', () => {
    const { container } = render(<CoverageVerdict verdict={ALL_MET} />);
    expect(container.textContent).toMatch(/meeting demand all day/i);
    expect(container.textContent).not.toMatch(/sales justify/i);
  });

  it('leads with the demand-short people-hours and the worst hour', () => {
    const { container } = render(<CoverageVerdict verdict={SHORT} />);
    expect(container.textContent).toMatch(/sales justify/i);
    expect(container.textContent).toMatch(/7 more people-hours/i);
    expect(container.textContent).toMatch(/worst at 5 PM \(short 3\)/i);
  });

  it('distinguishes floor-only hours from demand-short hours', () => {
    const { container } = render(<CoverageVerdict verdict={SHORT} />);
    expect(container.textContent).toMatch(/2 hours only trip the 4-person floor/i);
    expect(container.textContent).toMatch(/demand there is already met/i);
  });

  it('renders a chips row with the nonzero categories', () => {
    const { getByTestId } = render(<CoverageVerdict verdict={SHORT} />);
    const chips = getByTestId('coverage-verdict-chips');
    expect(chips.textContent).toMatch(/short on demand/i);
    expect(chips.textContent).toMatch(/at the floor only/i);
    expect(chips.textContent).toMatch(/covered/i);
  });
});
