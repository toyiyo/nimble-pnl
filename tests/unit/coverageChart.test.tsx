import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { CoverageChart } from '@/components/scheduling/ShiftTimeline/CoverageChart';

// Shared minToPct for a 10:00–14:00 window (600–840 min, 240 min total).
// Each 60-min hour occupies 60/240 = 25% of the width.
const minToPct = (min: number) => ((min - 600) / 240) * 100;

// Two hours: hour 10 (short: delta -2) and hour 11 (covered: delta 0).
// projectedSales / laborPct are populated to test that they round-trip through
// the chart without breaking rendering (tooltip content is tested in Task 3).
const hours = [
  { hour: 10, startMin: 600, scheduled: 3, needed: 5, delta: -2, projectedSales: 480, laborPct: 22 },
  { hour: 11, startMin: 660, scheduled: 5, needed: 5, delta: 0, projectedSales: 900, laborPct: 30 },
];

// Two hours with no demand target (needed = null).
const hoursNoDemand = [
  { hour: 10, startMin: 600, scheduled: 3, needed: null, delta: null, projectedSales: null, laborPct: null },
  { hour: 11, startMin: 660, scheduled: 4, needed: null, delta: null, projectedSales: null, laborPct: null },
];

describe('CoverageChart — column layout', () => {
  it('renders one positioned column per hour, aligned to minToPct', () => {
    const { container } = render(
      <CoverageChart hours={hours} view="area" minToPct={minToPct} targetSplh={95} />,
    );
    const cols = container.querySelectorAll('[data-hour-col]');
    expect(cols).toHaveLength(2);
    // Hour 10: startMin 600 → minToPct(600) = 0%
    expect((cols[0] as HTMLElement).style.left).toBe('0%');
    // Width = minToPct(660) - minToPct(600) = 25% - 0% = 25%
    expect((cols[0] as HTMLElement).style.width).toBe('25%');
    // Hour 11: startMin 660 → minToPct(660) = 25%
    expect((cols[1] as HTMLElement).style.left).toBe('25%');
  });

  it('renders an accessible container with role="img"', () => {
    const { getByRole } = render(
      <CoverageChart hours={hours} view="area" minToPct={minToPct} targetSplh={95} />,
    );
    expect(getByRole('img')).toBeInTheDocument();
  });

  it('renders nothing when hours array is empty', () => {
    const { container } = render(
      <CoverageChart hours={[]} view="delta" minToPct={minToPct} targetSplh={null} />,
    );
    // No columns, no chart content
    expect(container.querySelectorAll('[data-hour-col]')).toHaveLength(0);
  });
});

describe('CoverageChart — area view', () => {
  it('renders a shortfall block only for short hours', () => {
    const { container } = render(
      <CoverageChart hours={hours} view="area" minToPct={minToPct} targetSplh={95} />,
    );
    // Only hour 10 is short (delta -2); hour 11 is covered
    expect(container.querySelectorAll('[data-shortfall]')).toHaveLength(1);
  });

  it('does not render a shortfall block when every hour is covered', () => {
    const coveredHours = [
      { hour: 10, startMin: 600, scheduled: 5, needed: 5, delta: 0, projectedSales: null, laborPct: null },
      { hour: 11, startMin: 660, scheduled: 6, needed: 5, delta: 1, projectedSales: null, laborPct: null },
    ];
    const { container } = render(
      <CoverageChart hours={coveredHours} view="area" minToPct={minToPct} targetSplh={null} />,
    );
    expect(container.querySelector('[data-shortfall]')).toBeFalsy();
  });

  it('renders the legend labels (Scheduled and Needed) when demand exists', () => {
    const { getAllByText, getByText } = render(
      <CoverageChart hours={hours} view="area" minToPct={minToPct} targetSplh={95} />,
    );
    expect(getByText(/scheduled/i)).toBeInTheDocument();
    // "Needed" should appear at least once (legend)
    expect(getAllByText(/needed/i).length).toBeGreaterThanOrEqual(1);
  });

  it('does not render a Needed legend item when demand is absent', () => {
    const { queryByText } = render(
      <CoverageChart hours={hoursNoDemand} view="area" minToPct={minToPct} targetSplh={null} />,
    );
    expect(queryByText(/needed/i)).not.toBeInTheDocument();
  });
});

describe('CoverageChart — accessibility (tooltip shell)', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('each hour column is keyboard-focusable (tabIndex=0)', () => {
    const { container } = render(
      <CoverageChart hours={hours} view="area" minToPct={minToPct} targetSplh={95} />,
    );
    const cols = Array.from(container.querySelectorAll('[data-hour-col]')) as HTMLElement[];
    expect(cols).toHaveLength(2);
    cols.forEach((col) => {
      expect(col.getAttribute('tabindex')).toBe('0');
    });
  });

  it('each hour column has a descriptive aria-label', () => {
    const { container } = render(
      <CoverageChart hours={hours} view="area" minToPct={minToPct} targetSplh={95} />,
    );
    const cols = Array.from(container.querySelectorAll('[data-hour-col]')) as HTMLElement[];
    cols.forEach((col) => {
      const label = col.getAttribute('aria-label');
      expect(label).toBeTruthy();
      expect(label!.length).toBeGreaterThan(0);
    });
  });

  it('renders tooltip shell without React ref-forwarding warnings (area view)', () => {
    render(<CoverageChart hours={hours} view="area" minToPct={minToPct} targetSplh={95} />);
    const refWarning = consoleErrorSpy.mock.calls.find((args) =>
      typeof args[0] === 'string' && args[0].includes('Function components cannot be given refs'),
    );
    expect(refWarning).toBeUndefined();
  });

  it('renders tooltip shell without React ref-forwarding warnings (delta view)', () => {
    render(<CoverageChart hours={hours} view="delta" minToPct={minToPct} targetSplh={95} />);
    const refWarning = consoleErrorSpy.mock.calls.find((args) =>
      typeof args[0] === 'string' && args[0].includes('Function components cannot be given refs'),
    );
    expect(refWarning).toBeUndefined();
  });
});

describe('CoverageChart — delta view', () => {
  it('renders diverging bars with signed labels in delta view', () => {
    const { container, getByText } = render(
      <CoverageChart hours={hours} view="delta" minToPct={minToPct} targetSplh={95} />,
    );
    // Hour 10 is short → data-bar="short"
    expect(container.querySelectorAll('[data-bar="short"]')).toHaveLength(1);
    // Signed delta label "-2" for the short hour
    expect(getByText('-2')).toBeInTheDocument();
  });

  it('renders a covered bar for the zero-delta hour', () => {
    const { container } = render(
      <CoverageChart hours={hours} view="delta" minToPct={minToPct} targetSplh={95} />,
    );
    expect(container.querySelectorAll('[data-bar="covered"]')).toHaveLength(1);
  });

  it('renders one bar per hour via data-bar attribute', () => {
    const { container } = render(
      <CoverageChart hours={hours} view="delta" minToPct={minToPct} targetSplh={95} />,
    );
    expect(container.querySelectorAll('[data-bar]')).toHaveLength(2);
  });

  it('scales no-demand bars by headcount peak (delta view)', () => {
    const nd = [
      { hour: 10, startMin: 600, scheduled: 1, needed: null, delta: null, projectedSales: null, laborPct: null },
      { hour: 11, startMin: 660, scheduled: 4, needed: null, delta: null, projectedSales: null, laborPct: null },
    ];
    const { container } = render(
      <CoverageChart hours={nd} view="delta" minToPct={minToPct} targetSplh={null} />,
    );
    const bars = Array.from(container.querySelectorAll('[data-bar="no-demand"]')) as HTMLElement[];
    expect(bars).toHaveLength(2);
    const h = (el: HTMLElement) => parseFloat(el.style.height);
    // Hour 11 (scheduled=4) must be proportionally taller than hour 10 (scheduled=1)
    expect(h(bars[1])).toBeGreaterThan(h(bars[0]) * 3); // 4 vs 1, proportional not pegged
  });
});
