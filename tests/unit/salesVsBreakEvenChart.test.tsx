import React from 'react';
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// Matches the established mock-navigate convention (LaborPnlCard.test.tsx,
// OnboardingDrawer.test.tsx): stub `useNavigate` while keeping every other
// react-router-dom export (MemoryRouter, etc.) real.
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

import {
  SalesVsBreakEvenChart,
  BreakEvenTooltipContent,
  formatYAxisTick,
  formatCOGSVariance,
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

interface COGSProps {
  readonly actualCOGSPercentage?: number;
  readonly targetCOGSPercentage?: number;
}

function renderChartWithCOGS(data: BreakEvenData | null, cogsProps: COGSProps) {
  return render(
    <MemoryRouter>
      <SalesVsBreakEvenChart data={data} isLoading={false} {...cogsProps} />
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
    expect(bars[0].getAttribute('fill')).not.toBe('hsl(var(--destructive))');
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
    expect(bar?.getAttribute('fill')).toBe('hsl(var(--success))');
  });

  it('still applies the flat "below" status fill for a non-partial row', () => {
    const { container } = renderChart(
      makeData({ history: [makeHistoryRow({ status: 'below', isPartial: false })] }),
    );

    const bar = container.querySelector('.recharts-bar-rectangle path');
    expect(bar?.getAttribute('fill')).toBe('hsl(var(--destructive))');
  });

  it('branches on isPartial before status: an isPartial row with status "above" still renders the hatch, not the success fill', () => {
    const { container } = renderChart(
      makeData({
        history: [makeHistoryRow({ status: 'above', delta: 100, isPartial: true })],
        completeDays: 0,
      }),
    );

    const bar = container.querySelector('.recharts-bar-rectangle path');
    expect(bar?.getAttribute('fill')).not.toBe('hsl(var(--success))');
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

// Finding #6: the COGS row printed two bare percentages side by side and
// left the reader to do the subtraction themselves. `formatCOGSVariance`
// turns that into an explicit points-vs-target claim.
describe('formatCOGSVariance', () => {
  it('returns a plus-signed points-over-target label, flagged destructive, when actual exceeds target', () => {
    const result = formatCOGSVariance(46.9, 28.0);

    expect(result).not.toBeNull();
    expect(result?.label).toBe('+18.9 pts over target');
    expect(result?.colorClass).toMatch(/text-destructive/);
  });

  it('returns an unsigned points-under-target label, not destructive, when actual is under target', () => {
    const result = formatCOGSVariance(24.0, 28.0);

    expect(result).not.toBeNull();
    expect(result?.label).toBe('4.0 pts under target');
    expect(result?.colorClass).not.toMatch(/text-destructive/);
  });

  it('returns an "on target" label when actual equals target exactly', () => {
    const result = formatCOGSVariance(28.0, 28.0);

    expect(result).not.toBeNull();
    expect(result?.label).toBe('On target');
    expect(result?.colorClass).not.toMatch(/text-destructive/);
  });

  it('returns null when actualCOGSPercentage is undefined', () => {
    expect(formatCOGSVariance(undefined, 28.0)).toBeNull();
  });

  it('returns null when targetCOGSPercentage is undefined', () => {
    expect(formatCOGSVariance(46.9, undefined)).toBeNull();
  });

  it('returns null when both percentages are undefined', () => {
    expect(formatCOGSVariance(undefined, undefined)).toBeNull();
  });
});

describe('SalesVsBreakEvenChart — COGS variance chip', () => {
  it('renders the variance in points, plus-signed, in text-destructive when actual is over target', () => {
    renderChartWithCOGS(makeData(), { actualCOGSPercentage: 46.9, targetCOGSPercentage: 28.0 });

    const chip = screen.getByText('+18.9 pts over target');
    expect(chip).toBeInTheDocument();
    expect(chip.className).toMatch(/text-destructive/);
  });

  it('renders the variance in points, unsigned, not in text-destructive, when actual is under target', () => {
    renderChartWithCOGS(makeData(), { actualCOGSPercentage: 24.0, targetCOGSPercentage: 28.0 });

    const chip = screen.getByText('4.0 pts under target');
    expect(chip).toBeInTheDocument();
    expect(chip.className).not.toMatch(/text-destructive/);
  });

  it('renders an explicit period label alongside the COGS stats', () => {
    renderChartWithCOGS(
      makeData({ history: [makeHistoryRow({ date: '2026-07-01' }), makeHistoryRow({ date: '2026-07-02' })] }),
      { actualCOGSPercentage: 46.9, targetCOGSPercentage: 28.0 },
    );

    expect(screen.getByText(/over the last 2 days/i)).toBeInTheDocument();
  });

  it('does not render a variance chip, and does not crash, when actualCOGSPercentage is undefined', () => {
    renderChartWithCOGS(makeData(), { targetCOGSPercentage: 28.0 });

    expect(screen.queryByText(/pts (over|under) target/)).not.toBeInTheDocument();
    expect(screen.getByText('28.0%')).toBeInTheDocument();
  });

  it('does not render a variance chip, and does not crash, when targetCOGSPercentage is undefined', () => {
    renderChartWithCOGS(makeData(), { actualCOGSPercentage: 46.9 });

    expect(screen.queryByText(/pts (over|under) target/)).not.toBeInTheDocument();
    expect(screen.getByText('46.9%')).toBeInTheDocument();
  });

  it('renders the actual COGS % in a neutral color, not text-success, when there is no target to compare against', () => {
    renderChartWithCOGS(makeData(), { actualCOGSPercentage: 46.9 });

    const actual = screen.getByText('46.9%');
    expect(actual.className).not.toMatch(/text-success/);
    expect(actual.className).not.toMatch(/text-destructive/);
  });

  it('does not render the COGS block or a variance chip when both percentages are undefined', () => {
    renderChartWithCOGS(makeData(), {});

    expect(screen.queryByText(/Target COGS %/)).not.toBeInTheDocument();
    expect(screen.queryByText(/pts (over|under) target/)).not.toBeInTheDocument();
  });
});

// Two full weeks (2026-06-01 Mon .. 2026-06-14 Sun) that trip
// `deriveWeekdayPattern`'s clean-split rule — mirrors the fixture in
// `tests/unit/breakEvenInsights.test.ts` so this is a known non-null result,
// not an incidental one.
function makeCleanSplitHistory(): BreakEvenData['history'] {
  const weekdayDeltas: Record<number, number> = {
    1: -900, // Mon
    2: -1000, // Tue
    3: -1100, // Wed
    4: -1200, // Thu
    5: 800, // Fri
    6: 700, // Sat
    0: 600, // Sun
  };
  const dates = [
    '2026-06-01', '2026-06-02', '2026-06-03', '2026-06-04', '2026-06-05', '2026-06-06', '2026-06-07',
    '2026-06-08', '2026-06-09', '2026-06-10', '2026-06-11', '2026-06-12', '2026-06-13', '2026-06-14',
  ];
  return dates.map((date) => {
    const weekday = new Date(
      Number(date.slice(0, 4)),
      Number(date.slice(5, 7)) - 1,
      Number(date.slice(8, 10)),
    ).getDay();
    const delta = weekdayDeltas[weekday];
    return makeHistoryRow({
      date,
      delta,
      sales: 2500 + delta,
      status: delta > 0 ? 'above' : 'below',
      isPartial: false,
    });
  });
}

// Finding #3 / memory/lessons.md 2026-07-22: a derived sentence good enough
// to be an aria-label is good enough to be on screen — this must render as
// visible copy, never sr-only-only.
describe('SalesVsBreakEvenChart — weekday insight line', () => {
  it('renders the deriveWeekdayPattern sentence as a visible paragraph under the chart', () => {
    renderChart(
      makeData({ history: makeCleanSplitHistory(), completeDays: 14 }),
    );

    const insight = screen.getByText(/never break even/);
    expect(insight).toBeInTheDocument();
    expect(insight.tagName).toBe('P');
    // Explicitly NOT sr-only — the whole point is sighted users read it too.
    expect(insight.className).not.toMatch(/sr-only/);
    // Not visually hidden by other common hide-from-sight mechanisms either.
    expect(insight).not.toHaveAttribute('hidden');
    expect(insight.className).not.toMatch(/\binvisible\b/);
  });

  it('does not render an insight paragraph when deriveWeekdayPattern returns null (insufficient data)', () => {
    // makeData()'s default history is a single row — well under the 7
    // complete-day minimum, so deriveWeekdayPattern returns null.
    renderChart(makeData());

    expect(screen.queryByText(/never break even/)).not.toBeInTheDocument();
    expect(screen.queryByText(/weakest day/)).not.toBeInTheDocument();
  });
});

// Finding: useBreakEvenAnalysis already returns `error`
// (useBreakEvenAnalysis.tsx:97-100) but neither call site captured it, so a
// fetch/RLS failure fell through to the empty state and told the owner "Set
// up your budget" — wrong and alarming. `error` must render a distinct
// branch instead.
describe('SalesVsBreakEvenChart — error state', () => {
  function renderChartWithError(error: Error | null, data: BreakEvenData | null = null) {
    return render(
      <MemoryRouter>
        <SalesVsBreakEvenChart data={data} isLoading={false} error={error} />
      </MemoryRouter>,
    );
  }

  it('renders a distinct error message instead of the "Set up your budget" empty state when error is set', () => {
    renderChartWithError(new Error('Failed to fetch'));

    expect(screen.queryByText(/set up your budget/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/no break-even data yet/i)).not.toBeInTheDocument();
    expect(screen.getByText(/couldn.t load break-even data/i)).toBeInTheDocument();
  });

  it('renders the error branch even when data happens to be present', () => {
    // A stale query error can coexist with cached data — the branch order
    // must still surface the error, not silently render the stale chart.
    renderChartWithError(new Error('Failed to fetch'), makeData());

    expect(screen.getByText(/couldn.t load break-even data/i)).toBeInTheDocument();
  });

  it('does not render the error branch when error is null', () => {
    renderChart(makeData());

    expect(screen.queryByText(/couldn.t load break-even data/i)).not.toBeInTheDocument();
  });
});

// Finding #8: clicking a bar navigated to `/reports` with `location.state`,
// which no longer matches what that page reads. Bars must navigate to
// `/pos-sales` via search params instead, and — since Recharts emits plain
// SVG shapes with no tabIndex/role/key handling of its own — must be
// reachable and activatable from the keyboard, not just the mouse.
describe('SalesVsBreakEvenChart — bar click / keyboard navigation', () => {
  beforeEach(() => {
    mockNavigate.mockClear();
  });

  function getBar() {
    // The bar is the only role="button" element the chart itself renders;
    // its accessible name is built from date/sales/delta (getBarAccessibleName).
    return screen.getByRole('button', { name: /jul 15.*sales.*break-even/i });
  }

  it('clicking a bar navigates to /pos-sales with matching startDate and endDate for that day', () => {
    renderChart(
      makeData({
        history: [makeHistoryRow({ date: '2026-07-15', sales: 3200, delta: 700, status: 'above' })],
      }),
    );

    fireEvent.click(getBar());

    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith('/pos-sales?startDate=2026-07-15&endDate=2026-07-15');
  });

  it('pressing Enter on a focused bar navigates identically to a click', () => {
    renderChart(
      makeData({
        history: [makeHistoryRow({ date: '2026-07-15', sales: 3200, delta: 700, status: 'above' })],
      }),
    );

    const bar = getBar();
    bar.focus();
    fireEvent.keyDown(bar, { key: 'Enter' });

    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith('/pos-sales?startDate=2026-07-15&endDate=2026-07-15');
  });

  it('pressing Space on a focused bar also navigates', () => {
    renderChart(
      makeData({
        history: [makeHistoryRow({ date: '2026-07-15', sales: 3200, delta: 700, status: 'above' })],
      }),
    );

    const bar = getBar();
    bar.focus();
    fireEvent.keyDown(bar, { key: ' ' });

    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith('/pos-sales?startDate=2026-07-15&endDate=2026-07-15');
  });

  it('never navigates to the old /reports target', () => {
    renderChart(
      makeData({
        history: [makeHistoryRow({ date: '2026-07-15', sales: 3200, delta: 700, status: 'above' })],
      }),
    );

    fireEvent.click(getBar());

    expect(mockNavigate).not.toHaveBeenCalledWith(
      '/reports',
      expect.anything(),
    );
    expect(mockNavigate.mock.calls.every(([target]) => typeof target === 'string' && !target.startsWith('/reports'))).toBe(true);
  });

  it('exposes each bar as a keyboard-focusable button', () => {
    renderChart(
      makeData({
        history: [makeHistoryRow({ date: '2026-07-15', sales: 3200, delta: 700, status: 'above' })],
      }),
    );

    const bar = getBar();
    expect(bar).toHaveAttribute('tabindex', '0');
    expect(bar).toHaveAttribute('role', 'button');
  });

  it('updates the footer hint to reference POS sales, not P&L', () => {
    renderChart(
      makeData({
        history: [makeHistoryRow({ date: '2026-07-15', sales: 3200, delta: 700, status: 'above' })],
      }),
    );

    expect(screen.getByText(/pos sales/i)).toBeInTheDocument();
    expect(screen.queryByText(/view p&l/i)).not.toBeInTheDocument();
  });
});
