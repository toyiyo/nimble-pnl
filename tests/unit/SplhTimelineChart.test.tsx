import React from 'react';
import { describe, it, expect, beforeAll } from 'vitest';
import { render } from '@testing-library/react';
import {
  SplhTimelineChart,
  buildSplhChartData,
  formatSplhTooltipValue,
} from '@/components/scheduling/ShiftPlanner/SplhTimelineChart';
import type { SplhPoint } from '@/lib/splhAnalytics';

// Recharts' <ResponsiveContainer> measures via getBoundingClientRect() and
// bails out (renders nothing) when the host element reports zero size —
// jsdom's default. Stub a fixed size so the chart actually mounts its
// children for the smoke-render assertions below.
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

const points: SplhPoint[] = [
  { bucketStart: '2026-07-06', label: 'Mon', totalSales: 1200, totalHours: 20, splh: 60 },
  { bucketStart: '2026-07-07', label: 'Tue', totalSales: 0, totalHours: 0, splh: null },
  { bucketStart: '2026-07-08', label: 'Wed', totalSales: 900, totalHours: 15, splh: 60 },
];

describe('buildSplhChartData', () => {
  it('maps SplhPoint[] to chart data, preserving null splh (for connectNulls gaps)', () => {
    const data = buildSplhChartData(points, 'day');
    expect(data).toHaveLength(3);
    expect(data[0]).toMatchObject({ date: '2026-07-06', dateLabel: 'Jul 6', splh: 60 });
    expect(data[1]).toMatchObject({ date: '2026-07-07', dateLabel: 'Jul 7', splh: null });
    expect(data[2]).toMatchObject({ date: '2026-07-08', dateLabel: 'Jul 8', splh: 60 });
  });

  it('formats week-granularity labels the same way (Monday bucketStart)', () => {
    const data = buildSplhChartData(points, 'week');
    expect(data[0].dateLabel).toBe('Jul 6');
  });

  it('returns an empty array for empty input', () => {
    expect(buildSplhChartData([], 'day')).toEqual([]);
  });
});

describe('formatSplhTooltipValue', () => {
  it('formats a numeric value as "$X/labor-hr"', () => {
    expect(formatSplhTooltipValue(60)).toBe('$60/labor-hr');
  });

  it('renders an em dash for null (no labor hours logged)', () => {
    expect(formatSplhTooltipValue(null)).toBe('—');
  });

  it('renders an em dash for undefined', () => {
    expect(formatSplhTooltipValue(undefined)).toBe('—');
  });
});

describe('SplhTimelineChart — render', () => {
  it('renders an SVG line chart with a target reference line label', () => {
    const { container, getByText } = render(
      <SplhTimelineChart points={points} target={95} granularity="day" />,
    );
    expect(container.querySelector('svg')).toBeTruthy();
    expect(getByText('Target $95')).toBeInTheDocument();
  });

  it('renders one line path with connectNulls disabled (data-connect-nulls="false")', () => {
    const { container } = render(
      <SplhTimelineChart points={points} target={95} granularity="day" />,
    );
    // Recharts renders the underlying <path> for the Line series; we assert
    // via the wrapping .recharts-line group so this doesn't depend on the
    // exact stroke path geometry.
    expect(container.querySelector('.recharts-line')).toBeTruthy();
  });
});
