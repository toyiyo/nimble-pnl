import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CoverageChart, buildHourTooltip } from '@/components/scheduling/ShiftTimeline/CoverageChart';

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

describe('CoverageChart — tooltip content (buildHourTooltip)', () => {
  // Hour 10: 3 scheduled, 5 needed (short by 2), projected sales $480, targetSplh $95
  const shortHour = {
    hour: 10,
    startMin: 600,
    scheduled: 3,
    needed: 5,
    delta: -2,
    projectedSales: 480,
    laborPct: 22,
  };

  // Hour 11: 5 scheduled, 5 needed (covered, no surplus), with sales data
  const coveredExactHour = {
    hour: 11,
    startMin: 660,
    scheduled: 5,
    needed: 5,
    delta: 0,
    projectedSales: 900,
    laborPct: 30,
  };

  // Hour 12: 6 scheduled, 5 needed (covered + 1 spare)
  const spareHour = {
    hour: 12,
    startMin: 720,
    scheduled: 6,
    needed: 5,
    delta: 1,
    projectedSales: null,
    laborPct: null,
  };

  // No-demand hour: scheduled only
  const noDemandHour = {
    hour: 10,
    startMin: 600,
    scheduled: 4,
    needed: null,
    delta: null,
    projectedSales: null,
    laborPct: null,
  };

  it('CRITICAL: includes time range in tooltip for short hour', () => {
    const lines = buildHourTooltip(shortHour, 95);
    // Line 1 should contain the time range (e.g. "10 AM" or "10–11 AM")
    expect(lines[0]).toMatch(/10\s*(AM|am)/i);
  });

  it('CRITICAL: includes scheduled and needed counts for short hour', () => {
    const lines = buildHourTooltip(shortHour, 95);
    const combined = lines.join(' ');
    expect(combined).toMatch(/3 scheduled/i);
    expect(combined).toMatch(/5 needed/i);
  });

  it('CRITICAL: includes projected sales when rec data present', () => {
    const lines = buildHourTooltip(shortHour, 95);
    const combined = lines.join(' ');
    // Should include "Projected sales $480" (or similar formatting)
    expect(combined).toMatch(/projected sales/i);
    expect(combined).toMatch(/480/);
  });

  it('CRITICAL: includes SPLH math (÷ $95/labor-hr) when targetSplh and projectedSales present', () => {
    const lines = buildHourTooltip(shortHour, 95);
    const combined = lines.join(' ');
    // Should explain the math: divisor = $95/labor-hr, result ≈ 5 needed
    expect(combined).toMatch(/\$?95/);
    expect(combined).toMatch(/labor.hr|labor-hr/i);
  });

  it('CRITICAL: short hour verdict is "Short 2 — add staff"', () => {
    const lines = buildHourTooltip(shortHour, 95);
    const combined = lines.join(' ');
    expect(combined).toMatch(/short 2/i);
    expect(combined).toMatch(/add staff/i);
  });

  it('CRITICAL: covered hour with exact fit shows "Right on target"', () => {
    const lines = buildHourTooltip(coveredExactHour, 95);
    const combined = lines.join(' ');
    expect(combined).toMatch(/right on target/i);
  });

  it('CRITICAL: spare hour verdict includes "Covered" and spare count', () => {
    const lines = buildHourTooltip(spareHour, null);
    const combined = lines.join(' ');
    expect(combined).toMatch(/covered/i);
    expect(combined).toMatch(/\+1 spare/i);
  });

  it('CRITICAL: no-demand hour shows "no demand target" message without sales rows', () => {
    const lines = buildHourTooltip(noDemandHour, null);
    const combined = lines.join(' ');
    expect(combined).toMatch(/no demand target/i);
    expect(combined).toMatch(/set staffing targets/i);
    // Must NOT include projected sales or SPLH math rows
    expect(combined).not.toMatch(/projected sales/i);
    expect(combined).not.toMatch(/labor.hr/i);
  });

  it('CRITICAL: omits sales line when projectedSales is null', () => {
    const lines = buildHourTooltip(spareHour, 95);
    const combined = lines.join(' ');
    expect(combined).not.toMatch(/projected sales/i);
    expect(combined).not.toMatch(/labor.hr/i);
  });

  it('omits SPLH math row when targetSplh is null (even if sales present)', () => {
    const lines = buildHourTooltip(shortHour, null);
    const combined = lines.join(' ');
    // Sales line should still show
    expect(combined).toMatch(/projected sales/i);
    // But SPLH math row must not appear
    expect(combined).not.toMatch(/labor.hr/i);
  });

  it('CRITICAL: aria-label on each column contains the scheduled/needed summary', () => {
    const { container } = render(
      <CoverageChart hours={hours} view="area" minToPct={minToPct} targetSplh={95} />,
    );
    const cols = Array.from(container.querySelectorAll('[data-hour-col]')) as HTMLElement[];
    // Hour 10: short — aria-label should mention "3 scheduled" and "5 needed"
    expect(cols[0].getAttribute('aria-label')).toMatch(/3 scheduled/i);
    expect(cols[0].getAttribute('aria-label')).toMatch(/5 needed/i);
    // Hour 11: covered — aria-label should mention scheduled and needed
    expect(cols[1].getAttribute('aria-label')).toMatch(/5 scheduled/i);
    expect(cols[1].getAttribute('aria-label')).toMatch(/5 needed/i);
  });

  it('CRITICAL: tooltip content renders correct lines for short hour with sales (TooltipContent wiring)', () => {
    // Use buildHourTooltip directly to verify the content wired into TooltipContent
    // is correct — the tooltip shell wiring is validated by the tooltip shell tests above.
    // This test ensures the full content contract: time, counts, sales, SPLH math, verdict.
    const shortHourFull = {
      hour: 10,
      startMin: 600,
      scheduled: 3,
      needed: 5,
      delta: -2,
      projectedSales: 480,
      laborPct: 22,
    };
    const lines = buildHourTooltip(shortHourFull, 95);
    // Lines wired into <TooltipContent> via tooltipLines.map(...)
    // Verify the full set of lines that will appear in the portal:
    expect(lines).toHaveLength(5); // time, scheduled/needed, sales, SPLH math, verdict
    expect(lines[0]).toMatch(/10 AM/i); // time range
    expect(lines[1]).toBe('3 scheduled · 5 needed');
    expect(lines[2]).toBe('Projected sales $480');
    expect(lines[3]).toMatch(/\$95\/labor-hr/);
    expect(lines[4]).toBe('Short 2 — add staff');
  });

  it('tooltip degrades gracefully with no demand/recs', () => {
    // Verify the graceful-degradation path: no demand, no sales rows.
    const noDemandH = {
      hour: 10,
      startMin: 600,
      scheduled: 4,
      needed: null,
      delta: null,
      projectedSales: null,
      laborPct: null,
    };
    const lines = buildHourTooltip(noDemandH, null);
    // Lines wired into <TooltipContent>:
    expect(lines).toHaveLength(3); // time, scheduled count, no-demand verdict
    expect(lines[1]).toBe('4 scheduled');
    expect(lines[2]).toMatch(/no demand target/i);
    // Must NOT contain projected sales or SPLH rows
    const combined = lines.join(' ');
    expect(combined).not.toMatch(/projected sales/i);
    expect(combined).not.toMatch(/labor-hr/i);
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
