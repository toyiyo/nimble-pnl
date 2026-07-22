import React from 'react';
import { describe, it, expect, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SalesVsBreakEvenChart } from '@/components/budget/SalesVsBreakEvenChart';
import type { BreakEvenData } from '@/types/operatingCosts';
import type { MonthlyProgress } from '@/lib/monthlyBreakEvenProgress';

// Recharts' <ResponsiveContainer> measures via getBoundingClientRect() and
// bails out (renders nothing) when the host element reports zero size —
// jsdom's default. Stub a fixed size so the chart mounts its children
// (same stub as DemandVsStaffingChart.test.tsx / SplhTimelineChart.test.tsx).
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

function makeMonthlyProgress(overrides: Partial<MonthlyProgress> = {}): MonthlyProgress {
  return {
    monthLabel: 'Jul 2026',
    daysInMonth: 31,
    dayOfMonth: 22,
    mtdSales: 40000,
    monthlyBreakEven: 60000,
    progressPercent: 66.7,
    expectedPercent: (22 / 31) * 100,
    paceDelta: 0,
    status: 'on_pace',
    amountRemaining: 20000,
    daysRemaining: 9,
    dailyNeeded: 2222,
    dailyActual: 1818,
    projectedMonthly: 56000,
    projectedDelta: -4000,
    ...overrides,
  };
}

function makeHistoryRow(overrides: Partial<BreakEvenData['history'][number]> = {}) {
  return {
    date: '2026-07-01',
    sales: 3000,
    breakEven: 2500,
    delta: 500,
    status: 'above' as const,
    isPartial: false,
    ...overrides,
  };
}

function makeData(overrides: Partial<BreakEvenData> = {}): BreakEvenData {
  return {
    dailyBreakEven: 2500,
    monthlyBreakEven: 75000,
    yearlyBreakEven: 900000,
    totalVariablePercent: 0.61,
    contributionMargin: 0.39,
    todaySales: 1200,
    todayStatus: 'below',
    todayDelta: -1300,
    fixedCosts: { items: [], totalDaily: 300, totalMonthly: 9000, totalYearly: 108000 },
    variableCosts: { items: [], totalDaily: 0, avgDailySales: 3000 },
    history: [makeHistoryRow()],
    daysAbove: 1,
    daysBelow: 0,
    avgSurplus: 500,
    avgShortfall: 0,
    netDelta: 500,
    completeDays: 1,
    monthlyProgress: makeMonthlyProgress(),
    ...overrides,
  };
}

function renderChart(data: BreakEvenData | null, isLoading = false) {
  return render(
    <MemoryRouter>
      <SalesVsBreakEvenChart data={data} isLoading={isLoading} />
    </MemoryRouter>,
  );
}

describe('SalesVsBreakEvenChart — verdict strip', () => {
  it('renders a signed positive net figure in the success color when netDelta is positive', () => {
    renderChart(
      makeData({
        netDelta: 1756,
        completeDays: 13,
        history: [makeHistoryRow()],
      }),
    );

    const net = screen.getByText('+$1,756');
    expect(net).toBeInTheDocument();
    expect(net.className).toMatch(/text-success/);
    expect(net.className).toMatch(/text-\[17px\]/);
    expect(net.className).toMatch(/font-semibold/);
  });

  it('renders a signed negative net figure in the destructive color when netDelta is negative', () => {
    renderChart(
      makeData({
        netDelta: -136,
        completeDays: 13,
        history: [makeHistoryRow()],
      }),
    );

    const net = screen.getByText('-$136');
    expect(net).toBeInTheDocument();
    expect(net.className).toMatch(/text-destructive/);
  });

  it('renders a plain-language clause describing the verdict', () => {
    renderChart(
      makeData({
        netDelta: 1756,
        completeDays: 13,
        history: [makeHistoryRow()],
      }),
    );

    expect(screen.getByText(/ahead of break-even/i)).toBeInTheDocument();
  });

  it('renders the opposite clause when behind', () => {
    renderChart(
      makeData({
        netDelta: -136,
        completeDays: 13,
        history: [makeHistoryRow()],
      }),
    );

    expect(screen.getByText(/behind break-even/i)).toBeInTheDocument();
  });

  it('renders the period covered by the net figure', () => {
    renderChart(
      makeData({
        netDelta: 1756,
        completeDays: 13,
        history: [makeHistoryRow()],
      }),
    );

    expect(screen.getByText(/13 complete days/i)).toBeInTheDocument();
  });

  it('singularizes the period label when there is exactly one complete day', () => {
    renderChart(
      makeData({
        netDelta: 500,
        completeDays: 1,
        history: [makeHistoryRow()],
      }),
    );

    expect(screen.getByText(/1 complete day\b/i)).toBeInTheDocument();
    expect(screen.queryByText(/1 complete days/i)).not.toBeInTheDocument();
  });

  it('renders a neutral verdict when netDelta is exactly zero', () => {
    renderChart(
      makeData({
        netDelta: 0,
        completeDays: 5,
        history: [makeHistoryRow()],
      }),
    );

    const net = screen.getByText('$0');
    expect(net).toBeInTheDocument();
    expect(net.className).not.toMatch(/text-success/);
    expect(net.className).not.toMatch(/text-destructive/);
    expect(screen.getByText(/exactly at break-even/i)).toBeInTheDocument();
  });
});

describe('SalesVsBreakEvenChart — partial bar fill + hatch', () => {
  // Regression guard for finding #2: today's bar is a running partial
  // total, not a graded outcome. Even when the partial delta reads deeply
  // negative, the bar must never render the destructive ("below") fill —
  // it must render the hatch pattern instead. isPartial is checked before
  // status.
  it('does not render the destructive fill for a partial row with a deeply negative delta', () => {
    const { container } = renderChart(
      makeData({
        history: [
          makeHistoryRow({
            date: '2026-07-22',
            status: 'below',
            delta: -5000,
            isPartial: true,
          }),
        ],
        completeDays: 0,
        daysAbove: 0,
        daysBelow: 0,
        netDelta: 0,
      }),
    );

    const bars = container.querySelectorAll('.recharts-bar-rectangle path');
    expect(bars).toHaveLength(1);
    expect(bars[0].getAttribute('fill')).not.toBe('hsl(0, 84.2%, 60.2%)');
  });

  it('fills the partial bar from a userSpaceOnUse SVG pattern, not a flat status color', () => {
    const { container } = renderChart(
      makeData({
        history: [makeHistoryRow({ status: 'below', delta: -5000, isPartial: true })],
        completeDays: 0,
      }),
    );

    const pattern = container.querySelector('pattern');
    expect(pattern).toBeTruthy();
    expect(pattern?.getAttribute('patternUnits')).toBe('userSpaceOnUse');
    expect(pattern?.id).toBeTruthy();

    const bar = container.querySelector('.recharts-bar-rectangle path');
    expect(bar?.getAttribute('fill')).toBe(`url(#${pattern?.id})`);
  });

  it('colors the hatch pattern with the warning token', () => {
    const { container } = renderChart(
      makeData({
        history: [makeHistoryRow({ status: 'below', delta: -5000, isPartial: true })],
        completeDays: 0,
      }),
    );

    const pattern = container.querySelector('pattern');
    const patternMarkup = pattern?.innerHTML ?? '';
    expect(patternMarkup).toMatch(/hsl\(var\(--warning\)\)/);
  });

  it('still applies the flat "above" status fill for a non-partial row', () => {
    const { container } = renderChart(
      makeData({ history: [makeHistoryRow({ status: 'above', isPartial: false })] }),
    );

    const bar = container.querySelector('.recharts-bar-rectangle path');
    expect(bar?.getAttribute('fill')).toBe('hsl(142.1, 76.2%, 36.3%)');
  });

  it('still applies the flat "below" status fill for a non-partial row', () => {
    const { container } = renderChart(
      makeData({ history: [makeHistoryRow({ status: 'below', isPartial: false })] }),
    );

    const bar = container.querySelector('.recharts-bar-rectangle path');
    expect(bar?.getAttribute('fill')).toBe('hsl(0, 84.2%, 60.2%)');
  });

  it('branches on isPartial before status: an isPartial row with status "above" still renders the hatch, not the success fill', () => {
    const { container } = renderChart(
      makeData({
        history: [makeHistoryRow({ status: 'above', delta: 100, isPartial: true })],
        completeDays: 0,
      }),
    );

    const bar = container.querySelector('.recharts-bar-rectangle path');
    expect(bar?.getAttribute('fill')).not.toBe('hsl(142.1, 76.2%, 36.3%)');
    expect(bar?.getAttribute('fill')).toMatch(/^url\(#.+\)$/);
  });
});

describe('SalesVsBreakEvenChart — two-letter weekday axis', () => {
  // 2026-07-21 is a Tuesday, 2026-07-23 is a Thursday. The narrow `EEEEE`
  // token renders both as the single letter "T" — indistinguishable. The
  // two-letter `EEEEEE` token must render "Tu" vs "Th" so the axis actually
  // tells them apart.
  it('renders distinct two-letter weekday labels for Tue and Thu, not the same single letter', () => {
    const { container } = renderChart(
      makeData({
        history: [
          makeHistoryRow({ date: '2026-07-21', status: 'above' }),
          makeHistoryRow({ date: '2026-07-23', status: 'above' }),
        ],
      }),
    );

    // The custom tick renders the weekday as its own <tspan>, separate from
    // the "MMM d" line below it.
    const tspans = Array.from(container.querySelectorAll('.recharts-xAxis tspan')).map(
      (t) => t.textContent,
    );

    expect(tspans).toContain('Tu');
    expect(tspans).toContain('Th');
    expect(tspans).not.toContain('T');
  });

  it('renders the month/day as a second line under the weekday for each tick', () => {
    const { container } = renderChart(
      makeData({
        history: [makeHistoryRow({ date: '2026-07-21', status: 'above' })],
      }),
    );

    const tspans = Array.from(container.querySelectorAll('.recharts-xAxis tspan')).map(
      (t) => t.textContent,
    );

    expect(tspans).toContain('Tu');
    expect(tspans).toContain('Jul 21');
  });
});
