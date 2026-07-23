import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  LaborBalanceRibbon,
  balanceChipAriaLabel,
  balanceChipClassName,
} from '@/components/labor/LaborBalanceRibbon';
import type { FinancialPoint } from '@/lib/laborPnlAnalytics';

function makePoint(overrides: Partial<FinancialPoint>): FinancialPoint {
  return {
    bucketStart: '2026-07-06',
    label: 'Jul 6',
    sales: 1000,
    laborCost: 220,
    laborHours: 40,
    laborPct: 22,
    balanceState: 'balanced',
    ...overrides,
  };
}

describe('balanceChipAriaLabel', () => {
  it('names the bucket label and its balance state', () => {
    expect(balanceChipAriaLabel(makePoint({ label: 'Jul 6', balanceState: 'over' }))).toBe('Jul 6: over');
  });
});

describe('balanceChipClassName', () => {
  it('maps over/under/balanced to their dedicated --labor-* token classes', () => {
    expect(balanceChipClassName('over')).toBe('bg-[hsl(var(--labor-over))]');
    expect(balanceChipClassName('under')).toBe('bg-[hsl(var(--labor-under))]');
    expect(balanceChipClassName('balanced')).toBe('bg-[hsl(var(--labor-balanced))]');
  });
});

describe('LaborBalanceRibbon — render', () => {
  const points: FinancialPoint[] = [
    makePoint({ bucketStart: '2026-07-06', label: 'Jul 6', balanceState: 'over' }),
    makePoint({ bucketStart: '2026-07-07', label: 'Jul 7', balanceState: 'balanced' }),
    makePoint({ bucketStart: '2026-07-08', label: 'Jul 8', balanceState: 'under' }),
  ];

  it('renders one chip per point, each with the correct state class and aria-label', () => {
    render(<LaborBalanceRibbon points={points} />);
    const chips = screen.getAllByRole('listitem');
    expect(chips).toHaveLength(3);

    expect(chips[0]).toHaveAccessibleName('Jul 6: over');
    expect(chips[0]).toHaveClass('bg-[hsl(var(--labor-over))]');

    expect(chips[1]).toHaveAccessibleName('Jul 7: balanced');
    expect(chips[1]).toHaveClass('bg-[hsl(var(--labor-balanced))]');

    expect(chips[2]).toHaveAccessibleName('Jul 8: under');
    expect(chips[2]).toHaveClass('bg-[hsl(var(--labor-under))]');
  });

  it('exposes an accessible list name for the strip', () => {
    render(<LaborBalanceRibbon points={points} />);
    expect(screen.getByRole('list', { name: /staffing balance/i })).toBeInTheDocument();
  });

  it('renders nothing for an empty window (parent owns the empty state)', () => {
    const { container } = render(<LaborBalanceRibbon points={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
