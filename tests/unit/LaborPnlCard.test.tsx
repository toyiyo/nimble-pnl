import React from 'react';
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import type { FinancialPoint, LaborPnlSummary } from '@/lib/laborPnlAnalytics';

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

const mockUseLaborPnlSummary = vi.fn();
vi.mock('@/hooks/useLaborPnlSummary', () => ({
  useLaborPnlSummary: (restaurantId: string | null) => mockUseLaborPnlSummary(restaurantId),
}));

import { LaborPnlCard, buildLaborSparklineData } from '@/components/dashboard/LaborPnlCard';

const sparklinePoints: FinancialPoint[] = [
  {
    bucketStart: '2026-07-06',
    label: '2026-07-06',
    sales: 1200,
    laborCost: 336,
    laborHours: 20,
    laborPct: 28,
    balanceState: 'balanced',
  },
  {
    bucketStart: '2026-07-07',
    label: '2026-07-07',
    sales: 0,
    laborCost: 0,
    laborHours: 0,
    laborPct: null,
    balanceState: 'balanced',
  },
];

function baseSummary(overrides: Partial<LaborPnlSummary> = {}): LaborPnlSummary {
  return {
    sales: 10000,
    laborCost: 2800,
    laborPct: 28,
    revPerLaborHr: 73,
    verdict: 'Labor ran 28% of sales — right on your 28% target.',
    verdictTone: 'balanced',
    overWindows: [],
    underWindows: [],
    ...overrides,
  };
}

function mockHookReturn(overrides: Record<string, unknown> = {}) {
  return {
    summary: baseSummary(),
    sparkline: sparklinePoints,
    targetPct: 28,
    capped: false,
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
      <LaborPnlCard restaurantId="rest-1" />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockUseLaborPnlSummary.mockReset();
  mockNavigate.mockReset();
});

describe('buildLaborSparklineData', () => {
  it('maps FinancialPoint[] to {date, laborPct}, preserving null laborPct', () => {
    expect(buildLaborSparklineData(sparklinePoints)).toEqual([
      { date: '2026-07-06', laborPct: 28 },
      { date: '2026-07-07', laborPct: null },
    ]);
  });

  it('returns an empty array for empty input', () => {
    expect(buildLaborSparklineData([])).toEqual([]);
  });
});

describe('LaborPnlCard — states', () => {
  it('renders skeletons while loading', () => {
    mockUseLaborPnlSummary.mockReturnValue(mockHookReturn({ isLoading: true }));
    const { container } = renderCard();
    expect(container.querySelector('.animate-pulse')).toBeTruthy();
    expect(screen.queryByText(/28%/)).not.toBeInTheDocument();
  });

  it('renders an inline error with retry on isError', () => {
    const refetch = vi.fn();
    mockUseLaborPnlSummary.mockReturnValue(mockHookReturn({ isError: true, refetch }));
    renderCard();
    expect(screen.getByText(/failed to load/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('renders an empty-state invite when hasData is false', () => {
    mockUseLaborPnlSummary.mockReturnValue(mockHookReturn({ hasData: false }));
    renderCard();
    expect(screen.getByRole('link', { name: /connect your pos/i })).toHaveAttribute('href', '/integrations');
  });
});

describe('LaborPnlCard — loaded', () => {
  it('renders the hero labor % of sales, target, and verdict', () => {
    mockUseLaborPnlSummary.mockReturnValue(mockHookReturn());
    renderCard();
    expect(screen.getByText('28%')).toBeInTheDocument();
    expect(screen.getByText(/vs 28% target/)).toBeInTheDocument();
    expect(screen.getByText(/right on your 28% target/i)).toBeInTheDocument();
  });

  it('renders revenue per labor hour', () => {
    mockUseLaborPnlSummary.mockReturnValue(mockHookReturn());
    renderCard();
    expect(screen.getByText(/\$73\/labor-hour/)).toBeInTheDocument();
  });

  it('renders an em dash for the hero number when laborPct is null', () => {
    mockUseLaborPnlSummary.mockReturnValue(
      mockHookReturn({ summary: baseSummary({ laborPct: null, verdictTone: 'none' }) }),
    );
    renderCard();
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('omits the revenue-per-labor-hour line when revPerLaborHr is null', () => {
    mockUseLaborPnlSummary.mockReturnValue(
      mockHookReturn({ summary: baseSummary({ revPerLaborHr: null }) }),
    );
    renderCard();
    expect(screen.queryByText(/\/labor-hour/)).not.toBeInTheDocument();
  });

  it('applies the over-target tone class to the hero number and verdict', () => {
    mockUseLaborPnlSummary.mockReturnValue(
      mockHookReturn({
        summary: baseSummary({
          laborPct: 34.5,
          verdictTone: 'over',
          verdict: 'Labor ran 34.5% of sales — 6.5pt over target. Team earned $60/labor-hour.',
        }),
      }),
    );
    renderCard();
    expect(screen.getByText('34.5%')).toHaveClass('text-[hsl(var(--labor-over))]');
    expect(screen.getByText(/6\.5pt over target/i)).toHaveClass('text-[hsl(var(--labor-over))]');
  });

  it('renders the sparkline as an accessible image', () => {
    mockUseLaborPnlSummary.mockReturnValue(mockHookReturn());
    renderCard();
    expect(screen.getByRole('img', { name: /labor.*trend/i })).toBeInTheDocument();
  });

  it('links to /labor for the "Open labor detail" CTA (native link semantics)', () => {
    mockUseLaborPnlSummary.mockReturnValue(mockHookReturn());
    renderCard();
    expect(screen.getByRole('link', { name: /open labor detail/i })).toHaveAttribute('href', '/labor');
  });
});
