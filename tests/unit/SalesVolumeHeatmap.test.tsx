import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  SalesVolumeHeatmap,
  computeActiveSalesHours,
  getSalesCellAriaLabel,
  getSalesCellStyle,
} from '@/components/labor/SalesVolumeHeatmap';
import type { SalesVolumeCell } from '@/lib/laborPnlAnalytics';

function makeCell(overrides: Partial<SalesVolumeCell>): SalesVolumeCell {
  return {
    dow: 0,
    hour: 0,
    totalSales: 0,
    intensity: 0,
    peak: false,
    estimated: false,
    ...overrides,
  };
}

// A full 7x24 grid (matching buildSplhGrid/buildSalesVolumeGrid's real shape),
// all zero-sales except a handful of active cells on Fri (dow=5) / Sat (dow=6).
function buildGrid(activeCells: SalesVolumeCell[]): SalesVolumeCell[] {
  const cells: SalesVolumeCell[] = [];
  for (let dow = 0; dow < 7; dow++) {
    for (let hour = 0; hour < 24; hour++) {
      const override = activeCells.find((c) => c.dow === dow && c.hour === hour);
      cells.push(override ?? makeCell({ dow, hour }));
    }
  }
  return cells;
}

describe('computeActiveSalesHours', () => {
  it('returns only hours with sales on any day, sorted ascending', () => {
    const cells = [
      makeCell({ dow: 5, hour: 18, totalSales: 300, intensity: 1 }),
      makeCell({ dow: 6, hour: 12, totalSales: 50, intensity: 0.2 }),
      makeCell({ dow: 0, hour: 3, totalSales: 0 }),
    ];
    expect(computeActiveSalesHours(cells)).toEqual([12, 18]);
  });

  it('returns an empty array when every cell has zero sales', () => {
    const cells = [makeCell({ dow: 0, hour: 0 }), makeCell({ dow: 1, hour: 1 })];
    expect(computeActiveSalesHours(cells)).toEqual([]);
  });
});

describe('getSalesCellAriaLabel', () => {
  it('describes a cell with sales', () => {
    expect(
      getSalesCellAriaLabel(makeCell({ dow: 5, hour: 18, totalSales: 1234 }), 'Fri'),
    ).toBe('Fri 6 PM: $1,234 in sales');
  });

  it('describes a zero-sales cell', () => {
    expect(getSalesCellAriaLabel(makeCell({ dow: 0, hour: 3, totalSales: 0 }), 'Sun')).toBe(
      'Sun 3 AM: no sales',
    );
  });

  it('appends "peak" when the cell is flagged peak', () => {
    expect(
      getSalesCellAriaLabel(makeCell({ dow: 5, hour: 18, totalSales: 900, peak: true }), 'Fri'),
    ).toBe('Fri 6 PM: $900 in sales, peak hour');
  });
});

describe('getSalesCellStyle', () => {
  it('returns bg-muted with no inline style for a zero-sales cell', () => {
    const result = getSalesCellStyle(makeCell({ totalSales: 0, intensity: 0 }));
    expect(result.className).toBe('bg-muted');
    expect(result.style).toBeUndefined();
  });

  it('uses the --labor-balanced token, ramped by intensity, for an active cell', () => {
    const result = getSalesCellStyle(makeCell({ totalSales: 100, intensity: 0.5 }));
    expect(result.style?.backgroundColor).toContain('--labor-balanced');
  });

  it('ramps opacity up with intensity', () => {
    const low = getSalesCellStyle(makeCell({ totalSales: 10, intensity: 0.1 }));
    const high = getSalesCellStyle(makeCell({ totalSales: 100, intensity: 0.9 }));
    const lowOpacity = Number(low.style?.backgroundColor?.match(/\/\s*([\d.]+)\)/)?.[1]);
    const highOpacity = Number(high.style?.backgroundColor?.match(/\/\s*([\d.]+)\)/)?.[1]);
    expect(highOpacity).toBeGreaterThan(lowOpacity);
  });
});

describe('SalesVolumeHeatmap — render', () => {
  const activeCells = [
    makeCell({ dow: 5, hour: 18, totalSales: 300, intensity: 1, peak: true }),
    makeCell({ dow: 5, hour: 19, totalSales: 100, intensity: 0.33 }),
    makeCell({ dow: 6, hour: 18, totalSales: 40, intensity: 0.13 }),
  ];
  const grid = buildGrid(activeCells);

  it('renders an accessible grid with role=grid/row/gridcell', () => {
    render(<SalesVolumeHeatmap cells={grid} estimated={false} capped={false} />);
    expect(screen.getByRole('grid')).toBeInTheDocument();
    expect(screen.getAllByRole('row').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('gridcell').length).toBeGreaterThan(0);
  });

  it('renders exactly 7 day rows (plus the header row) in Mon-first order', () => {
    render(<SalesVolumeHeatmap cells={grid} estimated={false} capped={false} />);
    const labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    for (const label of labels) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    // header row + 7 day rows
    expect(screen.getAllByRole('row')).toHaveLength(8);
  });

  it('every gridcell is keyboard-focusable and has an aria-label', () => {
    render(<SalesVolumeHeatmap cells={grid} estimated={false} capped={false} />);
    for (const cell of screen.getAllByRole('gridcell')) {
      expect(cell).toHaveAttribute('tabindex', '0');
      expect(cell.getAttribute('aria-label')).toBeTruthy();
    }
  });

  it('trims dead hour columns down to only the active hours (18 and 19)', () => {
    render(<SalesVolumeHeatmap cells={grid} estimated={false} capped={false} />);
    expect(screen.getByText('6 PM')).toBeInTheDocument();
    expect(screen.getByText('7 PM')).toBeInTheDocument();
    expect(screen.queryByText('12 AM')).not.toBeInTheDocument();
  });

  it('shows an "Estimated" badge when estimated=true', () => {
    render(<SalesVolumeHeatmap cells={grid} estimated={true} capped={false} />);
    expect(screen.getByText('Estimated')).toBeInTheDocument();
  });

  it('does not show the "Estimated" badge when estimated=false', () => {
    render(<SalesVolumeHeatmap cells={grid} estimated={false} capped={false} />);
    expect(screen.queryByText('Estimated')).not.toBeInTheDocument();
  });

  it('shows a "partial window" badge when capped=true', () => {
    render(<SalesVolumeHeatmap cells={grid} estimated={false} capped={true} />);
    expect(screen.getByText(/partial window/i)).toBeInTheDocument();
  });

  it('does not show the "partial window" badge when capped=false', () => {
    render(<SalesVolumeHeatmap cells={grid} estimated={false} capped={false} />);
    expect(screen.queryByText(/partial window/i)).not.toBeInTheDocument();
  });

  it('renders a fallback message when every cell has zero sales', () => {
    const emptyGrid = buildGrid([]);
    render(<SalesVolumeHeatmap cells={emptyGrid} estimated={false} capped={false} />);
    expect(screen.queryByRole('grid')).not.toBeInTheDocument();
    expect(screen.getByText(/no sales/i)).toBeInTheDocument();
  });
});
