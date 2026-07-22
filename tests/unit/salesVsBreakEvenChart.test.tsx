import React from 'react';
import { describe, it, expect, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import {
  SalesVsBreakEvenChart,
  BreakEvenTooltipContent,
  formatYAxisTick,
} from '@/components/budget/SalesVsBreakEvenChart';
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

describe('SalesVsBreakEvenChart — custom tooltip content', () => {
  // Recharts drops `contentStyle` once a custom `content` renderer is set —
  // the renderer has to reproduce bg-background / border-border/40 /
  // rounded-lg by hand or the tooltip regresses to an unstyled default box.
  // Recharts only mounts <Tooltip content> on hover, which is unreliable to
  // simulate over jsdom-measured SVG coordinates, so this tests the exported
  // renderer directly with the payload shape Recharts passes it — the same
  // pattern this suite already uses for pure formatter helpers.
  function makeTooltipPayload(overrides: Partial<BreakEvenData['history'][number]> = {}) {
    return [
      {
        payload: makeHistoryRow(overrides),
      },
    ];
  }

  it('renders nothing when not active', () => {
    const { container } = render(
      <BreakEvenTooltipContent active={false} payload={makeTooltipPayload()} label="2026-07-01" />,
    );

    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when active but there is no payload', () => {
    const { container } = render(<BreakEvenTooltipContent active payload={[]} label="2026-07-01" />);

    expect(container.firstChild).toBeNull();
  });

  it('reproduces bg-background / border-border/40 / rounded-lg by hand', () => {
    const { container } = render(
      <BreakEvenTooltipContent
        active
        payload={makeTooltipPayload({ date: '2026-07-01', sales: 3200, breakEven: 2500, delta: 700, isPartial: false })}
        label="2026-07-01"
      />,
    );

    const root = container.firstChild as HTMLElement;
    expect(root.className).toMatch(/bg-background/);
    expect(root.className).toMatch(/border-border\/40/);
    expect(root.className).toMatch(/rounded-lg/);
  });

  it('shows Sales, Break-even, and a signed surplus for a complete day above break-even', () => {
    render(
      <BreakEvenTooltipContent
        active
        payload={makeTooltipPayload({ date: '2026-07-01', sales: 3200, breakEven: 2500, delta: 700, status: 'above', isPartial: false })}
        label="2026-07-01"
      />,
    );

    expect(screen.getByText('$3,200')).toBeInTheDocument();
    expect(screen.getByText('$2,500')).toBeInTheDocument();
    const surplus = screen.getByText('+$700');
    expect(surplus).toBeInTheDocument();
    expect(surplus.className).toMatch(/text-success/);
  });

  it('shows a signed shortfall in the destructive color for a complete day below break-even', () => {
    render(
      <BreakEvenTooltipContent
        active
        payload={makeTooltipPayload({ date: '2026-07-01', sales: 2200, breakEven: 2500, delta: -300, status: 'below', isPartial: false })}
        label="2026-07-01"
      />,
    );

    const shortfall = screen.getByText('-$300');
    expect(shortfall).toBeInTheDocument();
    expect(shortfall.className).toMatch(/text-destructive/);
  });

  it('shows "In progress" instead of a signed verdict for the partial day', () => {
    render(
      <BreakEvenTooltipContent
        active
        payload={makeTooltipPayload({ date: '2026-07-22', sales: 900, breakEven: 2500, delta: -1600, status: 'below', isPartial: true })}
        label="2026-07-22"
      />,
    );

    expect(screen.getByText('In progress')).toBeInTheDocument();
    // The deeply negative running delta must not leak through as a
    // "verdict" the way it would for a graded (non-partial) day — this is
    // the tooltip's version of the finding-#2 regression guard already
    // applied to the bar fill.
    expect(screen.queryByText('-$1,600')).not.toBeInTheDocument();
  });
});

describe('formatYAxisTick', () => {
  // Finding #5: the old formatter was `` `$${(v / 1000).toFixed(0)}k` `` —
  // rounding straight to whole thousands meant two visually distinct bars
  // (e.g. $2,512 and $3,350) could both land on a tick labeled "$3k". Below
  // $10k the axis needs one decimal of resolution to actually distinguish
  // them.
  it('renders 2512 and 3350 as distinct one-decimal ticks, not both "$3k"', () => {
    const low = formatYAxisTick(2512);
    const high = formatYAxisTick(3350);

    expect(low).toBe('$2.5k');
    expect(high).toBe('$3.4k');
    expect(low).not.toBe(high);
  });

  it('renders whole thousands (no decimal) at or above $10k', () => {
    expect(formatYAxisTick(10000)).toBe('$10k');
    expect(formatYAxisTick(15000)).toBe('$15k');
    expect(formatYAxisTick(125000)).toBe('$125k');
  });

  it('renders $0 with one decimal below the $10k threshold', () => {
    expect(formatYAxisTick(0)).toBe('$0.0k');
  });

  it('renders one decimal just under the $10k threshold', () => {
    expect(formatYAxisTick(9999)).toBe('$10.0k');
  });
});
