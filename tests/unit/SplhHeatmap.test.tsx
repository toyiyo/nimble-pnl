import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  SplhHeatmap,
  computeActiveHours,
  computeCellOpacity,
  getCellBackground,
  getCellAriaLabel,
} from '@/components/scheduling/ShiftPlanner/SplhHeatmap';
import type { SplhGridCell } from '@/lib/splhAnalytics';

function makeCell(overrides: Partial<SplhGridCell>): SplhGridCell {
  return {
    dow: 0,
    hour: 0,
    totalSales: 0,
    totalHours: 0,
    splh: null,
    state: 'closed',
    ...overrides,
  };
}

// A minimal but full 7x24 grid, all closed, except a handful of active cells
// spread across Fri (dow=5) and Sat (dow=6).
function buildGrid(activeCells: SplhGridCell[]): SplhGridCell[] {
  const cells: SplhGridCell[] = [];
  for (let dow = 0; dow < 7; dow++) {
    for (let hour = 0; hour < 24; hour++) {
      const override = activeCells.find((c) => c.dow === dow && c.hour === hour);
      cells.push(override ?? makeCell({ dow, hour }));
    }
  }
  return cells;
}

describe('computeActiveHours', () => {
  it('returns only hours that have sales or labor hours on any day, sorted ascending', () => {
    const cells = [
      makeCell({ dow: 5, hour: 18, totalSales: 100, totalHours: 2, splh: 50, state: 'balanced' }),
      makeCell({ dow: 6, hour: 12, totalSales: 50, totalHours: 1, splh: 50, state: 'balanced' }),
      makeCell({ dow: 0, hour: 3, totalSales: 0, totalHours: 0, state: 'closed' }),
    ];
    expect(computeActiveHours(cells)).toEqual([12, 18]);
  });

  it('treats a cell with hours but zero sales as active (no-labor is the inverse case)', () => {
    const cells = [makeCell({ dow: 1, hour: 9, totalSales: 0, totalHours: 2, splh: 0, state: 'slack' })];
    expect(computeActiveHours(cells)).toEqual([9]);
  });

  it('returns an empty array when every cell is closed', () => {
    const cells = [makeCell({ dow: 0, hour: 0 }), makeCell({ dow: 1, hour: 1 })];
    expect(computeActiveHours(cells)).toEqual([]);
  });
});

describe('computeCellOpacity', () => {
  it('is fixed at 0.35 for balanced cells regardless of splh', () => {
    const cell = makeCell({ splh: 100, state: 'balanced' });
    expect(computeCellOpacity(cell, 100)).toBe(0.35);
  });

  it('ramps up with distance from target for lean cells, capped at 0.90', () => {
    const near = makeCell({ splh: 120, state: 'lean' }); // 20% over target
    const far = makeCell({ splh: 300, state: 'lean' }); // 200% over target (clamped)
    expect(computeCellOpacity(near, 100)).toBeCloseTo(0.35 + 0.2 * 0.55, 5);
    expect(computeCellOpacity(far, 100)).toBeCloseTo(0.9, 5);
  });

  it('ramps for slack cells the same way as lean (symmetric distance)', () => {
    const cell = makeCell({ splh: 50, state: 'slack' }); // 50% under target
    expect(computeCellOpacity(cell, 100)).toBeCloseTo(0.35 + 0.5 * 0.55, 5);
  });
});

describe('getCellBackground', () => {
  it('uses bg-muted for closed cells (no inline color)', () => {
    const result = getCellBackground(makeCell({ state: 'closed' }), 100);
    expect(result.className).toBe('bg-muted');
    expect(result.style).toBeUndefined();
  });

  it('uses bg-muted for no-labor cells', () => {
    const result = getCellBackground(makeCell({ state: 'no-labor', totalSales: 50 }), 100);
    expect(result.className).toBe('bg-muted');
  });

  it('uses the --splh-lean token for lean cells', () => {
    const result = getCellBackground(makeCell({ state: 'lean', splh: 150 }), 100);
    expect(result.style?.backgroundColor).toContain('--splh-lean');
  });

  it('uses the --splh-slack token for slack cells', () => {
    const result = getCellBackground(makeCell({ state: 'slack', splh: 50 }), 100);
    expect(result.style?.backgroundColor).toContain('--splh-slack');
  });

  it('uses the --splh-balanced token for balanced cells', () => {
    const result = getCellBackground(makeCell({ state: 'balanced', splh: 100 }), 100);
    expect(result.style?.backgroundColor).toContain('--splh-balanced');
  });
});

describe('getCellAriaLabel', () => {
  it('describes a closed cell', () => {
    expect(getCellAriaLabel(makeCell({ dow: 0, hour: 3, state: 'closed' }), 'Sun')).toBe('Sun 3 AM: closed');
  });

  it('describes a no-labor cell', () => {
    expect(
      getCellAriaLabel(makeCell({ dow: 1, hour: 9, state: 'no-labor', totalSales: 40 }), 'Mon'),
    ).toBe('Mon 9 AM: sales but no labor logged');
  });

  it('describes a lean/slack/balanced cell with its splh value and state', () => {
    expect(
      getCellAriaLabel(makeCell({ dow: 5, hour: 18, state: 'lean', splh: 150 }), 'Fri'),
    ).toBe('Fri 6 PM: $150 per labor hour, lean');
  });
});

describe('SplhHeatmap — render', () => {
  const activeCells = [
    makeCell({ dow: 5, hour: 18, totalSales: 300, totalHours: 2, splh: 150, state: 'lean' }),
    makeCell({ dow: 5, hour: 19, totalSales: 100, totalHours: 2, splh: 50, state: 'slack' }),
    makeCell({ dow: 6, hour: 18, totalSales: 40, totalHours: 0, splh: null, state: 'no-labor' }),
  ];
  const grid = buildGrid(activeCells);

  it('renders an accessible grid with role=grid/row/gridcell', () => {
    render(<SplhHeatmap cells={grid} target={100} estimated={false} />);
    expect(screen.getByRole('grid')).toBeInTheDocument();
    expect(screen.getAllByRole('row').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('gridcell').length).toBeGreaterThan(0);
  });

  it('every gridcell is keyboard-focusable and has an aria-label', () => {
    render(<SplhHeatmap cells={grid} target={100} estimated={false} />);
    for (const cell of screen.getAllByRole('gridcell')) {
      expect(cell).toHaveAttribute('tabindex', '0');
      expect(cell.getAttribute('aria-label')).toBeTruthy();
    }
  });

  it('renders sticky day-of-week labels in Mon-first order', () => {
    render(<SplhHeatmap cells={grid} target={100} estimated={false} />);
    const labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    for (const label of labels) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('trims dead hour columns down to only the active hours (18 and 19)', () => {
    render(<SplhHeatmap cells={grid} target={100} estimated={false} />);
    expect(screen.getByText('6 PM')).toBeInTheDocument();
    expect(screen.getByText('7 PM')).toBeInTheDocument();
    expect(screen.queryByText('12 AM')).not.toBeInTheDocument();
  });

  it('shows a legend with lean/balanced/slack/closed entries', () => {
    render(<SplhHeatmap cells={grid} target={100} estimated={false} />);
    expect(screen.getByText(/lean/i)).toBeInTheDocument();
    expect(screen.getByText(/balanced/i)).toBeInTheDocument();
    expect(screen.getByText(/slack/i)).toBeInTheDocument();
    expect(screen.getByText(/closed/i)).toBeInTheDocument();
  });

  it('shows an "Estimated" badge and note when estimated=true', () => {
    render(<SplhHeatmap cells={grid} target={100} estimated={true} />);
    expect(screen.getByText('Estimated')).toBeInTheDocument();
  });

  it('does not show the "Estimated" badge when estimated=false', () => {
    render(<SplhHeatmap cells={grid} target={100} estimated={false} />);
    expect(screen.queryByText('Estimated')).not.toBeInTheDocument();
  });

  it('renders a fallback message when every cell is closed (no active hours)', () => {
    const closedGrid = buildGrid([]);
    render(<SplhHeatmap cells={closedGrid} target={100} estimated={false} />);
    expect(screen.queryByRole('grid')).not.toBeInTheDocument();
    expect(screen.getByText(/no sales or labor/i)).toBeInTheDocument();
  });
});
