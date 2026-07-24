import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, within } from '@testing-library/react';
import { CoverageChart, columnAriaLabel } from '@/components/scheduling/ShiftTimeline/CoverageChart';
import { chartSummaryLabel } from '@/lib/coverageChartModel';
import type { CoverageHour } from '@/lib/coverageSummary';

// Shared minToPct for a 10:00–15:00 window (600–900 min, 5 hours, 300 min total).
// Each 60-min hour occupies 60/300 = 20% of the width.
const minToPct = (min: number) => ((min - 600) / 300) * 100;

const MIN_STAFF = 6;

// One hour per classification bucket, all under minStaff=6 so `crit`/`floor`
// columns both exercise the demand-slice + floor-slice stack (needed=6 > demand
// in both cases — see design doc's two-segment stacking rule).
const critHour: CoverageHour = {
  hour: 10,
  startMin: 600,
  scheduled: 3,
  scheduledMax: 3,
  needed: 6,
  demand: 5,
  delta: -3,
  projectedSales: 250,
  laborPct: null,
};
const floorHour: CoverageHour = {
  hour: 11,
  startMin: 660,
  scheduled: 4,
  scheduledMax: 4,
  needed: 6,
  demand: 3,
  delta: -2,
  projectedSales: 150,
  laborPct: null,
};
const spareHour: CoverageHour = {
  hour: 12,
  startMin: 720,
  scheduled: 8,
  scheduledMax: 8,
  needed: 6,
  demand: 3,
  delta: 2,
  projectedSales: 150,
  laborPct: null,
};
const okHour: CoverageHour = {
  hour: 13,
  startMin: 780,
  scheduled: 6,
  scheduledMax: 6,
  needed: 6,
  demand: 6,
  delta: 0,
  projectedSales: 300,
  laborPct: null,
};
const nodataHour: CoverageHour = {
  hour: 14,
  startMin: 840,
  scheduled: 2,
  scheduledMax: 2,
  needed: null,
  demand: null,
  delta: null,
  projectedSales: null,
  laborPct: null,
};

const hours: CoverageHour[] = [critHour, floorHour, spareHour, okHour, nodataHour];

function renderChart(overrides: Partial<React.ComponentProps<typeof CoverageChart>> = {}) {
  const onSelect = vi.fn();
  const utils = render(
    <CoverageChart
      hours={hours}
      minStaff={MIN_STAFF}
      minToPct={minToPct}
      selectedStartMin={null}
      onSelect={onSelect}
      {...overrides}
    />,
  );
  return { ...utils, onSelect };
}

describe('CoverageChart — column layout', () => {
  it('renders one option per hour, aligned to minToPct', () => {
    const { container } = renderChart();
    const cols = container.querySelectorAll('[role="option"]');
    expect(cols).toHaveLength(5);
    expect((cols[0] as HTMLElement).style.left).toBe('0%');
    expect((cols[0] as HTMLElement).style.width).toBe('20%');
    expect((cols[1] as HTMLElement).style.left).toBe('20%');
  });

  it('renders nothing when hours array is empty', () => {
    const { container } = renderChart({ hours: [] });
    expect(container.querySelectorAll('[role="option"]')).toHaveLength(0);
  });

  it('renders a role="toolbar" container', () => {
    const { getByRole } = renderChart();
    expect(getByRole('toolbar')).toBeInTheDocument();
  });
});

describe('CoverageChart — roving tabindex + keyboard selection', () => {
  it('defaults the first column to tabIndex 0 when selectedStartMin is null', () => {
    const { container } = renderChart();
    const cols = Array.from(container.querySelectorAll('[role="option"]')) as HTMLElement[];
    expect(cols[0].getAttribute('tabindex')).toBe('0');
    cols.slice(1).forEach((col) => expect(col.getAttribute('tabindex')).toBe('-1'));
  });

  it('marks the column matching selectedStartMin as tabIndex 0 and aria-selected', () => {
    const { container } = renderChart({ selectedStartMin: 660 });
    const cols = Array.from(container.querySelectorAll('[role="option"]')) as HTMLElement[];
    expect(cols[1].getAttribute('tabindex')).toBe('0');
    expect(cols[1].getAttribute('aria-selected')).toBe('true');
    expect(cols[0].getAttribute('tabindex')).toBe('-1');
    expect(cols[0].getAttribute('aria-selected')).toBe('false');
  });

  it('clicking a column calls onSelect with its startMin', () => {
    const { container, onSelect } = renderChart();
    const cols = Array.from(container.querySelectorAll('[role="option"]')) as HTMLElement[];
    fireEvent.click(cols[2]);
    expect(onSelect).toHaveBeenCalledWith(720);
  });

  it('ArrowRight moves selection to the next column', () => {
    const { container, onSelect } = renderChart({ selectedStartMin: 600 });
    const toolbar = container.querySelector('[role="toolbar"]') as HTMLElement;
    fireEvent.keyDown(toolbar, { key: 'ArrowRight' });
    expect(onSelect).toHaveBeenCalledWith(660);
  });

  it('ArrowLeft moves selection to the previous column', () => {
    const { container, onSelect } = renderChart({ selectedStartMin: 660 });
    const toolbar = container.querySelector('[role="toolbar"]') as HTMLElement;
    fireEvent.keyDown(toolbar, { key: 'ArrowLeft' });
    expect(onSelect).toHaveBeenCalledWith(600);
  });

  it('ArrowLeft on the first column is a no-op (stays clamped)', () => {
    const { container, onSelect } = renderChart({ selectedStartMin: 600 });
    const toolbar = container.querySelector('[role="toolbar"]') as HTMLElement;
    fireEvent.keyDown(toolbar, { key: 'ArrowLeft' });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('ArrowRight on the last column is a no-op (stays clamped)', () => {
    const { container, onSelect } = renderChart({ selectedStartMin: 840 });
    const toolbar = container.querySelector('[role="toolbar"]') as HTMLElement;
    fireEvent.keyDown(toolbar, { key: 'ArrowRight' });
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe('CoverageChart — SVG demand/floor split', () => {
  it('renders a demand slice only for the crit column', () => {
    const { container } = renderChart();
    expect(container.querySelectorAll('[data-demand-slice]')).toHaveLength(1);
  });

  it('renders a floor slice for both crit and floor columns', () => {
    const { container } = renderChart();
    expect(container.querySelectorAll('[data-floor-slice]')).toHaveLength(2);
  });

  it('the floor slice uses stroke-dasharray (texture, not color alone)', () => {
    const { container } = renderChart();
    const slices = Array.from(container.querySelectorAll('[data-floor-slice]'));
    slices.forEach((el) => {
      expect(el.getAttribute('stroke-dasharray')).toBeTruthy();
    });
  });

  it('renders a hatched nodata ghost for the no-sales-history column, with no other slices', () => {
    const { container } = renderChart();
    const nodataEls = container.querySelectorAll('[data-nodata]');
    expect(nodataEls).toHaveLength(1);
  });

  it('defines a <pattern> for the nodata hatch', () => {
    const { container } = renderChart();
    expect(container.querySelector('pattern')).toBeTruthy();
  });

  it('renders a floor rule line labeled with minStaff', () => {
    const { container, getByText } = renderChart();
    expect(container.querySelectorAll('[data-floor-rule]')).toHaveLength(1);
    expect(getByText(new RegExp(`floor\\s*${MIN_STAFF}`, 'i'))).toBeInTheDocument();
  });

  it('uses only semantic HSL tokens for fills/strokes, never raw hex', () => {
    const { container } = renderChart();
    const svg = container.querySelector('svg')!;
    expect(svg.innerHTML).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });
});

describe('CoverageChart — accessible summary', () => {
  it('renders a sr-only <p> with the chartSummaryLabel rollup', () => {
    const { container } = renderChart();
    const expected = chartSummaryLabel(hours, MIN_STAFF).ariaLabel;
    const p = container.querySelector('p.sr-only');
    expect(p).toBeTruthy();
    expect(p!.textContent).toBe(expected);
  });

  it('renders a sr-only <ul aria-label="Understaffed windows"> with one <li> per crit/floor hour', () => {
    const { getByLabelText } = renderChart();
    const list = getByLabelText('Understaffed windows');
    const items = list.querySelectorAll('li');
    // crit + floor = 2 short hours in this fixture
    expect(items).toHaveLength(2);
    expect(list.className).toMatch(/sr-only/);
  });
});

describe('CoverageChart — sticky y-axis gutter (mirrors TimelineLane)', () => {
  it('renders the y-axis gutter with the sticky/left-0/z-10/w-[120px] classes TimelineLane uses for its label column', () => {
    const { getByTestId } = renderChart();
    const gutter = getByTestId('coverage-y-axis-gutter');
    const classes = gutter.className.split(/\s+/);
    expect(classes).toContain('sticky');
    expect(classes).toContain('left-0');
    expect(classes).toContain('z-10');
    expect(classes).toContain('w-[120px]');
  });

  it('places the gutter before the scrollable plot region in DOM order, so it stays pinned while the plot scrolls', () => {
    const { container, getByTestId, getByRole } = renderChart();
    const gutter = getByTestId('coverage-y-axis-gutter');
    const toolbar = getByRole('toolbar');
    const all = Array.from(container.querySelectorAll('*'));
    expect(all.indexOf(gutter)).toBeLessThan(all.indexOf(toolbar));
  });

  it('renders the y-axis ticks inside the gutter, not the scrollable plot', () => {
    const { getByTestId } = renderChart();
    const gutter = getByTestId('coverage-y-axis-gutter');
    // MIN_STAFF=6, spareHour.scheduled=8 -> peak >= 9, so at least a 0 and a top tick render.
    expect(within(gutter).getByText('0')).toBeInTheDocument();
  });

  it('the plot columns still align to minToPct, unaffected by the sticky gutter wrapper', () => {
    const { container } = renderChart();
    const cols = container.querySelectorAll('[role="option"]');
    expect((cols[0] as HTMLElement).style.left).toBe('0%');
    expect((cols[0] as HTMLElement).style.width).toBe('20%');
    expect((cols[4] as HTMLElement).style.left).toBe('80%');
  });
});

describe('CoverageChart — legend', () => {
  it('renders all four swatches', () => {
    const { getByTestId } = renderChart();
    const legend = within(getByTestId('coverage-chart-legend'));
    expect(legend.getByText(/short on demand/i)).toBeInTheDocument();
    expect(legend.getByText(/at the floor only/i)).toBeInTheDocument();
    expect(legend.getByText(/covered/i)).toBeInTheDocument();
    expect(legend.getByText(/no sales history/i)).toBeInTheDocument();
  });
});

describe('columnAriaLabel', () => {
  it('CRITICAL: crit column names the demand shortfall', () => {
    const label = columnAriaLabel(critHour, MIN_STAFF);
    expect(label).toMatch(/10\s*AM/i);
    expect(label).toMatch(/3 scheduled/i);
    expect(label).toMatch(/short 2 on demand/i);
  });

  it('CRITICAL: floor column names the floor shortfall (not demand)', () => {
    const label = columnAriaLabel(floorHour, MIN_STAFF);
    expect(label).toMatch(/short 2 at the floor/i);
    expect(label).not.toMatch(/on demand/i);
  });

  it('CRITICAL: spare column names the surplus', () => {
    const label = columnAriaLabel(spareHour, MIN_STAFF);
    expect(label).toMatch(/covered/i);
    expect(label).toMatch(/\+2 spare/i);
  });

  it('CRITICAL: ok column reads "on target"', () => {
    const label = columnAriaLabel(okHour, MIN_STAFF);
    expect(label).toMatch(/on target/i);
  });

  it('CRITICAL: nodata column names the missing sales history, not a demand number', () => {
    const label = columnAriaLabel(nodataHour, MIN_STAFF);
    expect(label).toMatch(/no sales history/i);
    expect(label).not.toMatch(/demand target: \d/i);
  });
});
