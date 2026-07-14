import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import type { SplhGridCell, SplhPoint, SplhSummary } from '@/lib/splhAnalytics';

// --- Stub heavy child components before importing the panel under test ---

const heatmapProps: Array<Record<string, unknown>> = [];
vi.mock('@/components/scheduling/ShiftPlanner/SplhHeatmap', () => ({
  SplhHeatmap: (props: Record<string, unknown>) => {
    heatmapProps.push(props);
    return <div data-testid="heatmap" data-estimated={String(props.estimated)} />;
  },
}));

const timelineProps: Array<Record<string, unknown>> = [];
vi.mock('@/components/scheduling/ShiftPlanner/SplhTimelineChart', () => ({
  SplhTimelineChart: (props: Record<string, unknown>) => {
    timelineProps.push(props);
    return (
      <div
        data-testid="timeline"
        data-granularity={props.granularity as string}
        data-points={(props.points as unknown[]).length}
      />
    );
  },
}));

const mockUseSplhAnalytics = vi.fn();
vi.mock('@/hooks/useSplhAnalytics', () => ({
  useSplhAnalytics: (restaurantId: string | null) => mockUseSplhAnalytics(restaurantId),
}));

import { LaborEfficiencyPanel, groupHoursIntoRanges, formatHourRange, verdictToneClassName } from '@/components/scheduling/ShiftPlanner/LaborEfficiencyPanel';

const dailyPoints: SplhPoint[] = [
  { bucketStart: '2026-07-06', label: '2026-07-06', totalSales: 1200, totalHours: 20, splh: 60 },
];
const weeklyPoints: SplhPoint[] = [
  { bucketStart: '2026-06-29', label: '2026-06-29', totalSales: 8000, totalHours: 130, splh: 62 },
];

const emptyGrid: SplhGridCell[] = [];

function baseSummary(overrides: Partial<SplhSummary> = {}): SplhSummary {
  return {
    actualSplh: 72,
    target: 60,
    laborPct: 28.5,
    verdict: 'Running lean — 20% above your $60 target. You may be understaffed at peak.',
    verdictTone: 'lean',
    hireHours: [],
    trimHours: [],
    ...overrides,
  };
}

function mockHookReturn(overrides: Record<string, unknown> = {}) {
  return {
    grid: emptyGrid,
    daily: dailyPoints,
    weekly: weeklyPoints,
    summary: baseSummary(),
    target: 60,
    tz: 'America/Chicago',
    hasHourlyBreakdown: true,
    capped: false,
    hasData: true,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    ...overrides,
  };
}

function renderPanel() {
  return render(
    <MemoryRouter>
      <LaborEfficiencyPanel restaurantId="rest-1" />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  heatmapProps.length = 0;
  timelineProps.length = 0;
  mockUseSplhAnalytics.mockReset();
});

describe('groupHoursIntoRanges', () => {
  it('merges consecutive hours on the same day into a single range', () => {
    const ranges = groupHoursIntoRanges([
      { dow: 5, hour: 18 },
      { dow: 5, hour: 19 },
      { dow: 5, hour: 20 },
    ]);
    expect(ranges).toEqual([{ dow: 5, startHour: 18, endHour: 21 }]);
  });

  it('keeps non-consecutive hours on the same day as separate ranges', () => {
    const ranges = groupHoursIntoRanges([
      { dow: 5, hour: 9 },
      { dow: 5, hour: 18 },
    ]);
    expect(ranges).toEqual([
      { dow: 5, startHour: 9, endHour: 10 },
      { dow: 5, startHour: 18, endHour: 19 },
    ]);
  });

  it('sorts ranges Mon-first across days', () => {
    const ranges = groupHoursIntoRanges([
      { dow: 0, hour: 10 }, // Sun
      { dow: 1, hour: 9 },  // Mon
    ]);
    expect(ranges.map((r) => r.dow)).toEqual([1, 0]);
  });

  it('returns an empty array for empty input', () => {
    expect(groupHoursIntoRanges([])).toEqual([]);
  });
});

describe('formatHourRange', () => {
  it('formats a range with day label and start/end hour', () => {
    expect(formatHourRange({ dow: 5, startHour: 18, endHour: 21 })).toBe('Fri 6 PM–9 PM');
  });
});

describe('verdictToneClassName', () => {
  it('returns the lean class for tone=lean', () => {
    expect(verdictToneClassName('lean')).toBe('text-[hsl(var(--splh-lean))]');
  });
  it('returns the slack class for tone=slack', () => {
    expect(verdictToneClassName('slack')).toBe('text-[hsl(var(--splh-slack))]');
  });
  it('returns the balanced class for tone=balanced', () => {
    expect(verdictToneClassName('balanced')).toBe('text-[hsl(var(--splh-balanced))]');
  });
  it('returns an empty string for tone=none (falls back to default text color)', () => {
    expect(verdictToneClassName('none')).toBe('');
  });
});

describe('LaborEfficiencyPanel — states', () => {
  it('renders skeletons while loading', () => {
    mockUseSplhAnalytics.mockReturnValue(mockHookReturn({ isLoading: true }));
    const { container } = renderPanel();
    expect(container.querySelectorAll('[data-testid="heatmap"]').length).toBe(0);
    expect(container.querySelector('.animate-pulse')).toBeTruthy();
  });

  it('renders an inline error with retry on isError', () => {
    const refetch = vi.fn();
    mockUseSplhAnalytics.mockReturnValue(mockHookReturn({ isError: true, refetch }));
    renderPanel();
    expect(screen.getByText(/failed to load/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('renders an empty-state invite when hasData is false', () => {
    mockUseSplhAnalytics.mockReturnValue(mockHookReturn({ hasData: false }));
    renderPanel();
    expect(screen.getByRole('link', { name: /connect your pos/i })).toHaveAttribute('href', '/integrations');
  });
});

describe('LaborEfficiencyPanel — loaded', () => {
  it('renders the header with actual SPLH, target, and labor %', () => {
    mockUseSplhAnalytics.mockReturnValue(mockHookReturn());
    renderPanel();
    expect(screen.getByText('Labor efficiency')).toBeInTheDocument();
    expect(screen.getByText(/\$72\/labor-hr/)).toBeInTheDocument();
    expect(screen.getByText(/vs \$60 target/)).toBeInTheDocument();
    expect(screen.getByText(/28\.5% of sales/)).toBeInTheDocument();
    expect(screen.getByText(/running lean/i)).toBeInTheDocument();
  });

  it('passes estimated=true to SplhHeatmap when hasHourlyBreakdown is false', () => {
    mockUseSplhAnalytics.mockReturnValue(mockHookReturn({ hasHourlyBreakdown: false }));
    renderPanel();
    expect(screen.getByTestId('heatmap').dataset.estimated).toBe('true');
  });

  it('hides the hire/trim callout when both lists are empty', () => {
    mockUseSplhAnalytics.mockReturnValue(mockHookReturn());
    renderPanel();
    expect(screen.queryByText(/consider hiring/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/consider trimming/i)).not.toBeInTheDocument();
  });

  it('renders the hire/trim callout with grouped human ranges when present', () => {
    mockUseSplhAnalytics.mockReturnValue(
      mockHookReturn({
        summary: baseSummary({
          hireHours: [{ dow: 5, hour: 18 }, { dow: 5, hour: 19 }],
          trimHours: [{ dow: 2, hour: 10 }],
        }),
      }),
    );
    renderPanel();
    expect(screen.getByText(/consider hiring/i)).toBeInTheDocument();
    expect(screen.getByText(/fri 6 pm–8 pm/i)).toBeInTheDocument();
    expect(screen.getByText(/consider trimming/i)).toBeInTheDocument();
    expect(screen.getByText(/tue 10 am–11 am/i)).toBeInTheDocument();
  });

  it('shows the capped notice when capped is true', () => {
    mockUseSplhAnalytics.mockReturnValue(mockHookReturn({ capped: true }));
    renderPanel();
    expect(screen.getByText(/partial window/i)).toBeInTheDocument();
  });

  it('hides the capped notice when capped is false', () => {
    mockUseSplhAnalytics.mockReturnValue(mockHookReturn({ capped: false }));
    renderPanel();
    expect(screen.queryByText(/partial window/i)).not.toBeInTheDocument();
  });

  it('defaults the timeline to day granularity and switches to week on toggle', () => {
    mockUseSplhAnalytics.mockReturnValue(mockHookReturn());
    renderPanel();
    expect(screen.getByTestId('timeline').dataset.granularity).toBe('day');
    expect(screen.getByTestId('timeline').dataset.points).toBe(String(dailyPoints.length));

    fireEvent.click(screen.getByRole('radio', { name: /^week$/i }));

    expect(screen.getByTestId('timeline').dataset.granularity).toBe('week');
    expect(screen.getByTestId('timeline').dataset.points).toBe(String(weeklyPoints.length));
  });
});
