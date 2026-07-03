import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CoverageVerdict } from '@/components/scheduling/ShiftTimeline/CoverageVerdict';
import type { CoverageVerdict as CVType } from '@/lib/coverageSummary';

const NO_DEMAND: CVType = {
  hasDemand: false,
  metAll: false,
  shortHours: 0,
  totalHours: 3,
  worst: null,
};

const ALL_MET: CVType = {
  hasDemand: true,
  metAll: true,
  shortHours: 0,
  totalHours: 8,
  worst: null,
};

const SHORT: CVType = {
  hasDemand: true,
  metAll: false,
  shortHours: 5,
  totalHours: 14,
  worst: { hour: 17, delta: -3 },
};

describe('CoverageVerdict', () => {
  it('shows neutral message when no demand is configured', () => {
    render(<CoverageVerdict verdict={NO_DEMAND} />);
    expect(screen.getByText(/add staffing targets/i)).toBeInTheDocument();
  });

  it('shows green "meeting demand" message when all hours are met', () => {
    render(<CoverageVerdict verdict={ALL_MET} />);
    expect(screen.getByText(/meeting demand all day/i)).toBeInTheDocument();
  });

  it('shows red short-staffed headline with hour counts', () => {
    render(<CoverageVerdict verdict={SHORT} />);
    expect(screen.getByText(/short-staffed 5 of 14 hours/i)).toBeInTheDocument();
  });

  it('shows the worst-hour subline when short', () => {
    render(<CoverageVerdict verdict={SHORT} />);
    // Biggest gap subline should mention the worst hour (17 → "5 PM") and the deficit
    expect(screen.getByText(/biggest gap/i)).toBeInTheDocument();
    expect(screen.getByText(/short 3/i)).toBeInTheDocument();
  });

  it('does not show a subline when all demand is met', () => {
    render(<CoverageVerdict verdict={ALL_MET} />);
    expect(screen.queryByText(/biggest gap/i)).not.toBeInTheDocument();
  });
});
