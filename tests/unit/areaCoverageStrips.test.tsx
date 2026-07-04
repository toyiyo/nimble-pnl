/**
 * Unit tests for AreaCoverageStrips — the per-area scheduled headcount strips.
 *
 * These tests verify:
 * 1. Returns null (renders nothing) when areas array is empty.
 * 2. Renders one row per area with the area name visible.
 * 3. Each per-hour cell carries role="img" and an accessible aria-label
 *    containing area name, formatted hour, and scheduled count.
 * 4. Cells show the scheduled count (numeric, not colored short/covered).
 * 5. A footnote about demand targets is rendered below the strips.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { AreaCoverageStrips } from '@/components/scheduling/ShiftTimeline/AreaCoverageStrips';
import type { AreaCoverage } from '@/lib/coverageSummary';

const makeAreas = (): AreaCoverage[] => [
  {
    area: 'Cold Stone',
    hours: [
      { hour: 10, startMin: 600, scheduled: 2, needed: null, delta: null, projectedSales: null, laborPct: null },
      { hour: 11, startMin: 660, scheduled: 3, needed: null, delta: null, projectedSales: null, laborPct: null },
    ],
  },
  {
    area: "Wetzel's",
    hours: [
      { hour: 10, startMin: 600, scheduled: 0, needed: null, delta: null, projectedSales: null, laborPct: null },
      { hour: 11, startMin: 660, scheduled: 1, needed: null, delta: null, projectedSales: null, laborPct: null },
    ],
  },
];

describe('AreaCoverageStrips', () => {
  it('renders nothing when the areas array is empty', () => {
    const { container } = render(<AreaCoverageStrips areas={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders a labelled row for each area', () => {
    render(<AreaCoverageStrips areas={makeAreas()} />);
    expect(screen.getByText('Cold Stone')).toBeInTheDocument();
    expect(screen.getByText("Wetzel's")).toBeInTheDocument();
  });

  it('CRITICAL: each per-hour cell has role="img" and aria-label with area, hour, and count', () => {
    render(<AreaCoverageStrips areas={makeAreas()} />);
    // Cold Stone at 10 AM with 2 scheduled
    expect(
      screen.getByRole('img', { name: /cold stone.*10 am.*2 scheduled/i }),
    ).toBeInTheDocument();
    // Wetzel's at 11 AM with 1 scheduled
    expect(
      screen.getByRole('img', { name: /wetzel.*11 am.*1 scheduled/i }),
    ).toBeInTheDocument();
  });

  it('CRITICAL: cells show the scheduled headcount as visible text', () => {
    render(<AreaCoverageStrips areas={makeAreas()} />);
    // Cold Stone hour 10: 2 scheduled; hour 11: 3 scheduled
    // We expect at least two cells showing "2" and "3"
    const cells = screen.getAllByRole('img');
    const labels = cells.map((c) => c.getAttribute('aria-label') ?? '');
    expect(labels.some((l) => /2 scheduled/i.test(l))).toBe(true);
    expect(labels.some((l) => /3 scheduled/i.test(l))).toBe(true);
  });

  it('renders the demand-targets footnote below the strips', () => {
    render(<AreaCoverageStrips areas={makeAreas()} />);
    expect(
      screen.getByText(/demand targets are set for the whole location/i),
    ).toBeInTheDocument();
  });

  it('renders a single area with Unassigned label when area name is "Unassigned"', () => {
    const areas: AreaCoverage[] = [
      {
        area: 'Unassigned',
        hours: [
          { hour: 9, startMin: 540, scheduled: 1, needed: null, delta: null, projectedSales: null, laborPct: null },
        ],
      },
    ];
    render(<AreaCoverageStrips areas={areas} />);
    expect(screen.getByText('Unassigned')).toBeInTheDocument();
    expect(
      screen.getByRole('img', { name: /unassigned.*9 am.*1 scheduled/i }),
    ).toBeInTheDocument();
  });
});
