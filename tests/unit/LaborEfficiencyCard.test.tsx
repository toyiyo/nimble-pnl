import React from 'react';
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import type { SplhPoint, SplhSummary } from '@/lib/splhAnalytics';

// Recharts' <ResponsiveContainer> measures via getBoundingClientRect() and
// bails out (renders nothing) when the host element reports zero size —
// jsdom's default. Stub a fixed size so the sparkline actually mounts.
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      width: 200,
      height: 48,
      top: 0,
      left: 0,
      bottom: 48,
      right: 200,
      x: 0,
      y: 0,
      toJSON: () => {},
    }),
  });
});

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

const mockUseSplhSummary = vi.fn();
vi.mock('@/hooks/useSplhSummary', () => ({
  useSplhSummary: (restaurantId: string | null) => mockUseSplhSummary(restaurantId),
}));

import { LaborEfficiencyCard, buildSparklineData, verdictToneColor } from '@/components/dashboard/LaborEfficiencyCard';

const sparklinePoints: SplhPoint[] = [
  { bucketStart: '2026-07-06', label: '2026-07-06', totalSales: 1200, totalHours: 20, splh: 60 },
  { bucketStart: '2026-07-07', label: '2026-07-07', totalSales: 0, totalHours: 0, splh: null },
];

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
    summary: baseSummary(),
    sparkline: sparklinePoints,
    target: 60,
    isLoading: false,
    isError: false,
    hasData: true,
    refetch: vi.fn(),
    ...overrides,
  };
}

function renderCard() {
  return render(
    <MemoryRouter>
      <LaborEfficiencyCard restaurantId="rest-1" />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockUseSplhSummary.mockReset();
  mockNavigate.mockReset();
});

describe('buildSparklineData', () => {
  it('maps SplhPoint[] to {date, splh}, preserving null splh', () => {
    expect(buildSparklineData(sparklinePoints)).toEqual([
      { date: '2026-07-06', splh: 60 },
      { date: '2026-07-07', splh: null },
    ]);
  });

  it('returns an empty array for empty input', () => {
    expect(buildSparklineData([])).toEqual([]);
  });
});

describe('verdictToneColor', () => {
  it('returns the lean token for tone=lean', () => {
    expect(verdictToneColor('lean')).toBe('hsl(var(--splh-lean))');
  });
  it('returns the slack token for tone=slack', () => {
    expect(verdictToneColor('slack')).toBe('hsl(var(--splh-slack))');
  });
  it('returns the balanced token for tone=balanced', () => {
    expect(verdictToneColor('balanced')).toBe('hsl(var(--splh-balanced))');
  });
  it('returns undefined for tone=none (falls back to default text color)', () => {
    expect(verdictToneColor('none')).toBeUndefined();
  });
});

describe('LaborEfficiencyCard — states', () => {
  it('renders skeletons while loading', () => {
    mockUseSplhSummary.mockReturnValue(mockHookReturn({ isLoading: true }));
    const { container } = renderCard();
    expect(container.querySelector('.animate-pulse')).toBeTruthy();
    expect(screen.queryByText(/\$72/)).not.toBeInTheDocument();
  });

  it('renders an inline error with retry on isError', () => {
    const refetch = vi.fn();
    mockUseSplhSummary.mockReturnValue(mockHookReturn({ isError: true, refetch }));
    renderCard();
    expect(screen.getByText(/failed to load/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('renders an empty-state invite when hasData is false', () => {
    mockUseSplhSummary.mockReturnValue(mockHookReturn({ hasData: false }));
    renderCard();
    expect(screen.getByRole('link', { name: /connect your pos/i })).toHaveAttribute('href', '/integrations');
  });
});

describe('LaborEfficiencyCard — loaded', () => {
  it('renders the hero SPLH number, target, and labor %', () => {
    mockUseSplhSummary.mockReturnValue(mockHookReturn());
    renderCard();
    expect(screen.getByText('$72')).toBeInTheDocument();
    expect(screen.getByText(/vs \$60 target/)).toBeInTheDocument();
    expect(screen.getByText(/labor 28\.5% of sales/i)).toBeInTheDocument();
    expect(screen.getByText(/running lean/i)).toBeInTheDocument();
  });

  it('renders an em dash for the hero number when actualSplh is null', () => {
    mockUseSplhSummary.mockReturnValue(
      mockHookReturn({ summary: baseSummary({ actualSplh: null }) }),
    );
    renderCard();
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('omits the labor % line when laborPct is null', () => {
    mockUseSplhSummary.mockReturnValue(
      mockHookReturn({ summary: baseSummary({ laborPct: null }) }),
    );
    renderCard();
    expect(screen.queryByText(/% of sales/)).not.toBeInTheDocument();
  });

  it('renders the sparkline as an accessible image', () => {
    mockUseSplhSummary.mockReturnValue(mockHookReturn());
    renderCard();
    expect(screen.getByRole('img', { name: /splh trend/i })).toBeInTheDocument();
  });

  it('navigates to /scheduling when "View in Scheduling" is clicked', () => {
    mockUseSplhSummary.mockReturnValue(mockHookReturn());
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: /view in scheduling/i }));
    expect(mockNavigate).toHaveBeenCalledWith('/scheduling');
  });
});
