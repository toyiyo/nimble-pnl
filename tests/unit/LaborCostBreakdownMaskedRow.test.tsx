import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LaborCostBreakdown } from '@/components/scheduling/LaborCostBreakdown';
import type { EmployeeLaborCost } from '@/hooks/useEmployeeLaborCosts';

// A masked pay row carries cost 0 as a placeholder, not a real figure.
// Showing "$0.00" would read as a fact. The row must show a dash and name
// the reason for a screen reader.
const maskedRow: EmployeeLaborCost = {
  id: 'emp-1',
  name: 'Ann Lee',
  position: 'Server',
  hours: 8,
  rate: 0,
  cost: 0,
  compensationType: 'hourly',
  isOutlier: false,
  outlierLevel: 'none',
  costIsHidden: true,
};

const visibleRow: EmployeeLaborCost = {
  id: 'emp-2',
  name: 'Bo Ray',
  position: 'Cook',
  hours: 8,
  rate: 20,
  cost: 160,
  compensationType: 'hourly',
  isOutlier: false,
  outlierLevel: 'none',
  costIsHidden: false,
};

describe('LaborCostBreakdown masked row', () => {
  it('shows a dash instead of $0.00 for a masked-cost row', () => {
    render(
      <LaborCostBreakdown employeeCosts={[maskedRow]} onEditEmployee={vi.fn()} />
    );
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.queryByText('$0.00')).not.toBeInTheDocument();
  });

  it('gives the dash an accessible name explaining why cost is hidden', () => {
    render(
      <LaborCostBreakdown employeeCosts={[maskedRow]} onEditEmployee={vi.fn()} />
    );
    expect(screen.getByLabelText('Labor cost hidden')).toBeInTheDocument();
  });

  it('does not show a fabricated $0.00/hr rate under a masked row', () => {
    render(
      <LaborCostBreakdown employeeCosts={[maskedRow]} onEditEmployee={vi.fn()} />
    );
    expect(screen.getByText('8.0h · rate hidden')).toBeInTheDocument();
    expect(screen.queryByText(/\$0\.00\/hr/)).not.toBeInTheDocument();
  });

  it('still shows the real dollar figure for a visible row', () => {
    render(
      <LaborCostBreakdown employeeCosts={[visibleRow]} onEditEmployee={vi.fn()} />
    );
    expect(screen.getByText('$160.00')).toBeInTheDocument();
  });
});
