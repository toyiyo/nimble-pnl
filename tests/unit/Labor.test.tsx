import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import type { FinancialPoint, LaborPnlSummary, SalesVolumeCell } from '@/lib/laborPnlAnalytics';

// --- Stub heavy child components before importing the page under test, so
// this test exercises only Labor.tsx's own composition/state logic. Each
// child already has its own dedicated unit test (D1-D5). ---

const chartProps: Array<Record<string, unknown>> = [];
vi.mock('@/components/labor/DemandVsStaffingChart', () => ({
  DemandVsStaffingChart: (props: Record<string, unknown>) => {
    chartProps.push(props);
    return <div data-testid="chart" data-granularity={props.granularity as string} />;
  },
}));

const heatmapProps: Array<Record<string, unknown>> = [];
vi.mock('@/components/labor/SalesVolumeHeatmap', () => ({
  SalesVolumeHeatmap: (props: Record<string, unknown>) => {
    heatmapProps.push(props);
    return <div data-testid="heatmap" data-estimated={String(props.estimated)} data-capped={String(props.capped)} />;
  },
}));

vi.mock('@/components/labor/LaborVerdict', () => ({
  LaborVerdict: ({ summary }: { summary: LaborPnlSummary | null | undefined }) => (
    <div data-testid="verdict">{summary?.verdict}</div>
  ),
}));

const editableTargetProps: Array<Record<string, unknown>> = [];
vi.mock('@/components/labor/EditableLaborTarget', () => ({
  EditableLaborTarget: (props: Record<string, unknown>) => {
    editableTargetProps.push(props);
    return <div data-testid="editable-target" data-target={props.targetPct as number} />;
  },
}));

const mockUseLaborPnlAnalytics = vi.fn();
vi.mock('@/hooks/useLaborPnlAnalytics', () => ({
  useLaborPnlAnalytics: (restaurantId: string | null, granularity: string) =>
    mockUseLaborPnlAnalytics(restaurantId, granularity),
}));

const mockUseRestaurantContext = vi.fn();
vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => mockUseRestaurantContext(),
}));

import Labor, { windowRangeLabel, findWindowPoints, estimateWindowDollars } from '@/pages/Labor';

const POINTS: FinancialPoint[] = [
  {
    bucketStart: '2026-07-06',
    label: '2026-07-06',
    sales: 1000,
    laborCost: 400,
    laborHours: 40,
    laborPct: 40,
    balanceState: 'over',
  },
  {
    bucketStart: '2026-07-07',
    label: '2026-07-07',
    sales: 800,
    laborCost: 300,
    laborHours: 30,
    laborPct: 37.5,
    balanceState: 'over',
  },
  {
    bucketStart: '2026-07-08',
    label: '2026-07-08',
    sales: 900,
    laborCost: 100,
    laborHours: 10,
    laborPct: 11.1,
    balanceState: 'under',
  },
];

function baseSummary(overrides: Partial<LaborPnlSummary> = {}): LaborPnlSummary {
  return {
    sales: 2700,
    laborCost: 800,
    laborPct: 29.6,
    revPerLaborHr: 33.75,
    verdict: 'Labor ran 29.6% of sales — 7.6pt over target.',
    verdictTone: 'over',
    overWindows: [],
    underWindows: [],
    ...overrides,
  };
}

const GRID: SalesVolumeCell[] = [
  { dow: 1, hour: 12, totalSales: 500, intensity: 1, peak: true, estimated: false },
];

function mockHookReturn(overrides: Record<string, unknown> = {}) {
  return {
    series: POINTS,
    seriesIsShapeEstimate: false,
    grid: GRID,
    summary: baseSummary(),
    // Staffing callouts now come from the hook (series-derived), not summary.
    overWindows: [],
    underWindows: [],
    targetPct: 22,
    capped: false,
    hasData: true,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    updateTarget: vi.fn().mockResolvedValue(undefined),
    isSavingTarget: false,
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <Labor />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  chartProps.length = 0;
  heatmapProps.length = 0;
  editableTargetProps.length = 0;
  mockUseLaborPnlAnalytics.mockReset();
  mockUseRestaurantContext.mockReset();
  mockUseRestaurantContext.mockReturnValue({ selectedRestaurant: { restaurant_id: 'rest-1' } });
});

describe('windowRangeLabel', () => {
  it('renders a single label when the window is one bucket', () => {
    expect(windowRangeLabel({ startLabel: '2026-07-06', endLabel: '2026-07-06', bucketCount: 1 })).toBe(
      '2026-07-06',
    );
  });

  it('renders a range when the window spans multiple buckets', () => {
    expect(windowRangeLabel({ startLabel: '2026-07-06', endLabel: '2026-07-07', bucketCount: 2 })).toBe(
      '2026-07-06 – 2026-07-07',
    );
  });
});

describe('findWindowPoints', () => {
  it('slices the matching contiguous points by startLabel + bucketCount', () => {
    const found = findWindowPoints(POINTS, { startLabel: '2026-07-06', endLabel: '2026-07-07', bucketCount: 2 });
    expect(found).toEqual([POINTS[0], POINTS[1]]);
  });

  it('returns an empty array when the start label has no match', () => {
    expect(findWindowPoints(POINTS, { startLabel: 'missing', endLabel: 'missing', bucketCount: 1 })).toEqual([]);
  });
});

describe('estimateWindowDollars', () => {
  it('sums laborCost - target-implied cost across the window, over target (positive delta)', () => {
    // point0: 400 - 1000*0.22 = 180; point1: 300 - 800*0.22 = 124 -> 304
    const window = { startLabel: '2026-07-06', endLabel: '2026-07-07', bucketCount: 2 };
    expect(estimateWindowDollars(POINTS, window, 22)).toBe(304);
  });

  it('returns a positive magnitude for an under-target window too', () => {
    // point2: 100 - 900*0.22 = -98 -> magnitude 98
    const window = { startLabel: '2026-07-08', endLabel: '2026-07-08', bucketCount: 1 };
    expect(estimateWindowDollars(POINTS, window, 22)).toBe(98);
  });
});

describe('Labor page', () => {
  it('renders a loading skeleton (by role) while data loads', () => {
    mockUseLaborPnlAnalytics.mockReturnValue(mockHookReturn({ isLoading: true }));
    renderPage();
    expect(screen.getByRole('status', { name: /loading labor data/i })).toBeInTheDocument();
  });

  it('renders an inline error with retry on failure', () => {
    const refetch = vi.fn();
    mockUseLaborPnlAnalytics.mockReturnValue(mockHookReturn({ isError: true, refetch }));
    renderPage();
    expect(screen.getByText(/failed to load labor data/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(refetch).toHaveBeenCalled();
  });

  it('renders an empty state inviting POS connect when there is no data', () => {
    mockUseLaborPnlAnalytics.mockReturnValue(mockHookReturn({ hasData: false }));
    renderPage();
    expect(screen.getByRole('link', { name: /connect your pos/i })).toBeInTheDocument();
  });

  it('renders the guard when no restaurant is selected', () => {
    mockUseRestaurantContext.mockReturnValue({ selectedRestaurant: null });
    mockUseLaborPnlAnalytics.mockReturnValue(mockHookReturn());
    renderPage();
    expect(screen.getByText(/select a restaurant/i)).toBeInTheDocument();
    expect(mockUseLaborPnlAnalytics).toHaveBeenCalledWith(null, 'day');
  });

  it('renders the KPI row, verdict, chart, and heatmap with real data', () => {
    mockUseLaborPnlAnalytics.mockReturnValue(mockHookReturn());
    renderPage();
    expect(screen.getByTestId('verdict')).toHaveTextContent('Labor ran 29.6% of sales — 7.6pt over target.');
    expect(screen.getByText(/labor % of sales/i)).toBeInTheDocument();
    expect(screen.getByText(/revenue per labor hour/i)).toBeInTheDocument();
    expect(screen.getByText(/net sales/i)).toBeInTheDocument();
    expect(screen.getByText('Labor $')).toBeInTheDocument();
    expect(screen.getByTestId('chart')).toHaveAttribute('data-granularity', 'day');
    expect(screen.getByTestId('heatmap')).toHaveAttribute('data-estimated', 'false');
    expect(screen.getByTestId('editable-target')).toHaveAttribute('data-target', '22');
  });

  it('derives the heatmap "estimated" flag from the grid cells', () => {
    mockUseLaborPnlAnalytics.mockReturnValue(
      mockHookReturn({ grid: [{ dow: 1, hour: 12, totalSales: 500, intensity: 1, peak: true, estimated: true }] }),
    );
    renderPage();
    expect(screen.getByTestId('heatmap')).toHaveAttribute('data-estimated', 'true');
  });

  it('switches granularity via the Day/Week/Month toggle, re-invoking the hook', () => {
    mockUseLaborPnlAnalytics.mockReturnValue(mockHookReturn());
    renderPage();
    expect(mockUseLaborPnlAnalytics).toHaveBeenLastCalledWith('rest-1', 'day');

    fireEvent.click(screen.getByRole('radio', { name: 'Week' }));
    expect(mockUseLaborPnlAnalytics).toHaveBeenLastCalledWith('rest-1', 'week');

    fireEvent.click(screen.getByRole('radio', { name: 'Month' }));
    expect(mockUseLaborPnlAnalytics).toHaveBeenLastCalledWith('rest-1', 'month');
  });

  it('renders staffing callouts with a $ estimate for over/under windows', () => {
    mockUseLaborPnlAnalytics.mockReturnValue(
      mockHookReturn({
        overWindows: [{ startLabel: '2026-07-06', endLabel: '2026-07-07', bucketCount: 2 }],
        underWindows: [{ startLabel: '2026-07-08', endLabel: '2026-07-08', bucketCount: 1 }],
      }),
    );
    renderPage();
    expect(screen.getByText(/\$304 over target labor spend/i)).toBeInTheDocument();
    expect(screen.getByText(/\$98 under target labor spend/i)).toBeInTheDocument();
  });

  it('shows a partial-window note when capped', () => {
    mockUseLaborPnlAnalytics.mockReturnValue(mockHookReturn({ capped: true }));
    renderPage();
    expect(screen.getByTestId('heatmap')).toHaveAttribute('data-capped', 'true');
  });

  it('wires the editable target to updateTarget', () => {
    const updateTarget = vi.fn().mockResolvedValue(undefined);
    mockUseLaborPnlAnalytics.mockReturnValue(mockHookReturn({ updateTarget, isSavingTarget: true }));
    renderPage();
    expect(editableTargetProps[0].onCommit).toBe(updateTarget);
    expect(editableTargetProps[0].disabled).toBe(true);
  });
});
