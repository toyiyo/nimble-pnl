import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { CoverageStatusStrip } from '@/components/scheduling/ShiftTimeline/CoverageStatusStrip';

const hours = [
  { hour: 16, startMin: 960, scheduled: 3, needed: 5, delta: -2 },
  { hour: 17, startMin: 1020, scheduled: 5, needed: 5, delta: 0 },
];

describe('CoverageStatusStrip', () => {
  it('labels each hour and enumerates short windows for screen readers', () => {
    render(<CoverageStatusStrip hours={hours} />);
    // Short hour cell should carry an aria-label mentioning "short 2"
    expect(screen.getByLabelText(/short 2/i)).toBeInTheDocument();
    // A visually-hidden list with aria-label "Understaffed windows" for screen readers
    expect(screen.getByRole('list', { name: /understaffed/i })).toBeInTheDocument();
  });

  it('renders one cell per hour', () => {
    render(<CoverageStatusStrip hours={hours} />);
    // Both hour cells should exist — one short, one covered
    expect(screen.getByLabelText(/short 2/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/covered/i)).toBeInTheDocument();
  });

  it('marks covered hours with a "covered" aria-label', () => {
    const allCoveredHours = [
      { hour: 9, startMin: 540, scheduled: 4, needed: 3, delta: 1 },
      { hour: 10, startMin: 600, scheduled: 3, needed: 3, delta: 0 },
    ];
    render(<CoverageStatusStrip hours={allCoveredHours} />);
    // Both cells should say "covered" — neither should say "short"
    const cells = screen.getAllByLabelText(/covered/i);
    expect(cells.length).toBe(2);
    expect(screen.queryByLabelText(/short/i)).not.toBeInTheDocument();
  });

  it('does not render an understaffed list when there are no short hours', () => {
    const allCoveredHours = [
      { hour: 9, startMin: 540, scheduled: 4, needed: 3, delta: 1 },
    ];
    render(<CoverageStatusStrip hours={allCoveredHours} />);
    // No understaffed list when nothing is short
    expect(screen.queryByRole('list', { name: /understaffed/i })).not.toBeInTheDocument();
  });

  it('handles hours with no demand (needed = null) — labels them as "scheduled"', () => {
    const noDemandHours = [
      { hour: 8, startMin: 480, scheduled: 2, needed: null, delta: null },
      { hour: 9, startMin: 540, scheduled: 3, needed: null, delta: null },
    ];
    render(<CoverageStatusStrip hours={noDemandHours} />);
    // Cells exist and have aria-labels mentioning the hour
    const cells = screen.getAllByLabelText(/8 am|9 am/i);
    expect(cells.length).toBe(2);
    // No understaffed list
    expect(screen.queryByRole('list', { name: /understaffed/i })).not.toBeInTheDocument();
  });

  it('renders nothing when hours array is empty', () => {
    const { container } = render(<CoverageStatusStrip hours={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('CRITICAL: shows have/needed for demand hours and scheduled-only when no demand', () => {
    render(
      <CoverageStatusStrip
        hours={[
          { hour: 17, startMin: 1020, scheduled: 3, needed: 5, delta: -2 },
          { hour: 18, startMin: 1080, scheduled: 4, needed: null, delta: null },
        ]}
      />,
    );
    // Demand-present hour shows "have/needed" fraction
    expect(screen.getByText('3/5')).toBeInTheDocument();
    // No-demand hour shows just the scheduled count
    expect(screen.getByText('4')).toBeInTheDocument();
  });

  it('CRITICAL: aria-label for demand cell includes "N of M" and gap direction', () => {
    render(
      <CoverageStatusStrip
        hours={[{ hour: 18, startMin: 1080, scheduled: 3, needed: 5, delta: -2 }]}
      />,
    );
    // aria-label should expose "3 of 5, short 2" so screen readers convey the fraction
    expect(screen.getByLabelText(/3 of 5.*short 2/i)).toBeInTheDocument();
  });
});
