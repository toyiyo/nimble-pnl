import React from 'react';
import { describe, it, expect, beforeAll } from 'vitest';
import { render } from '@testing-library/react';
import {
  DemandVsStaffingChart,
  buildDemandVsStaffingChartData,
  formatLaborPctTooltipValue,
} from '@/components/labor/DemandVsStaffingChart';
import type { FinancialPoint } from '@/lib/laborPnlAnalytics';

// Recharts' <ResponsiveContainer> measures via getBoundingClientRect() and
// bails out (renders nothing) when the host element reports zero size —
// jsdom's default. Stub a fixed size so both stacked charts actually mount
// their children for the smoke-render assertions below (same stub as
// SplhTimelineChart.test.tsx).
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      width: 600,
      height: 300,
      top: 0,
      left: 0,
      bottom: 300,
      right: 600,
      x: 0,
      y: 0,
      toJSON: () => {},
    }),
  });
});

const points: FinancialPoint[] = [
  {
    bucketStart: '2026-07-06',
    label: 'Mon',
    sales: 1200,
    laborCost: 360,
    laborHours: 20,
    laborPct: 30,
    balanceState: 'over',
  },
  {
    bucketStart: '2026-07-07',
    label: 'Tue',
    sales: 0,
    laborCost: 0,
    laborHours: 0,
    laborPct: null,
    balanceState: 'balanced',
  },
  {
    bucketStart: '2026-07-08',
    label: 'Wed',
    sales: 900,
    laborCost: 198,
    laborHours: 15,
    laborPct: 22,
    balanceState: 'balanced',
  },
];

describe('buildDemandVsStaffingChartData', () => {
  it('maps FinancialPoint[] to chart data, preserving null laborPct (for connectNulls gaps)', () => {
    const data = buildDemandVsStaffingChartData(points);
    expect(data).toHaveLength(3);
    expect(data[0]).toMatchObject({ bucketStart: '2026-07-06', label: 'Mon', sales: 1200, laborPct: 30 });
    expect(data[1]).toMatchObject({ bucketStart: '2026-07-07', label: 'Tue', sales: 0, laborPct: null });
    expect(data[2]).toMatchObject({ bucketStart: '2026-07-08', label: 'Wed', sales: 900, laborPct: 22 });
  });

  it('returns an empty array for empty input', () => {
    expect(buildDemandVsStaffingChartData([])).toEqual([]);
  });
});

describe('formatLaborPctTooltipValue', () => {
  it('formats a numeric value as "X.X%"', () => {
    expect(formatLaborPctTooltipValue(30)).toBe('30.0%');
  });

  it('renders an em dash for null (no-sales bucket)', () => {
    expect(formatLaborPctTooltipValue(null)).toBe('—');
  });

  it('renders an em dash for undefined', () => {
    expect(formatLaborPctTooltipValue(undefined)).toBe('—');
  });
});

describe('DemandVsStaffingChart — render', () => {
  it('renders two stacked charts (sales area + labor-% line) with a target reference line label', () => {
    const { container, getByText } = render(
      <DemandVsStaffingChart points={points} targetPct={24} granularity="day" />,
    );
    const areas = container.querySelectorAll('.recharts-area');
    const lines = container.querySelectorAll('.recharts-line');
    expect(areas.length).toBeGreaterThan(0);
    expect(lines.length).toBeGreaterThan(0);
    expect(getByText('Target 24%')).toBeInTheDocument();
  });

  it('renders one staffing-balance ribbon chip per bucket (data length matches points)', () => {
    const { getAllByRole } = render(
      <DemandVsStaffingChart points={points} targetPct={24} granularity="day" />,
    );
    expect(getAllByRole('listitem')).toHaveLength(points.length);
  });

  it('exposes an accessible name naming the target and granularity view', () => {
    const { getByRole } = render(
      <DemandVsStaffingChart points={points} targetPct={24} granularity="week" />,
    );
    expect(
      getByRole('img', { name: /net sales versus labor percent against a 24% target, daily view/i }),
    ).toBeInTheDocument();
  });

  it('renders nothing for an empty points array (three-state safe — parent owns loading/error/empty)', () => {
    const { container, queryByRole } = render(
      <DemandVsStaffingChart points={[]} targetPct={24} granularity="day" />,
    );
    expect(queryByRole('img')).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });
});
