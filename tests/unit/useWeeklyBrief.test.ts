import React, { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useWeeklyBrief, useWeeklyBriefHistory } from '@/hooks/useWeeklyBrief';

const mockSupabase = vi.hoisted(() => ({
  from: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: mockSupabase,
}));

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
};

const mockBrief = {
  id: 'brief-1',
  restaurant_id: 'rest-123',
  brief_week_end: '2026-02-15',
  metrics_json: { net_revenue: 35000, food_cost_pct: 28.5 },
  comparisons_json: {},
  variances_json: [
    { metric: 'net_revenue', value: 35000, direction: 'up', flag: null, prior_week: 32000, delta_vs_prior: 3000, delta_pct_vs_prior: 9.4, avg_4week: 33500, delta_pct_vs_avg: 4.5 },
  ],
  inbox_summary_json: { open_count: 3, critical_count: 1 },
  recommendations_json: [{ title: 'Review food cost', body: 'Food cost increased', impact: 'High', effort: 'Low' }],
  narrative: 'Revenue was up 9.4% this week.',
  computed_at: '2026-02-16T06:00:00Z',
  email_sent_at: null,
};

// Helper to build a chainable Supabase query mock
function buildQueryChain(resolvedValue: { data: unknown; error: unknown }) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.order = vi.fn().mockReturnValue(chain);
  chain.limit = vi.fn().mockReturnValue(chain);
  chain.maybeSingle = vi.fn().mockResolvedValue(resolvedValue);
  return chain;
}

describe('useWeeklyBrief', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when restaurantId is undefined', async () => {
    const { result } = renderHook(() => useWeeklyBrief(undefined), { wrapper: createWrapper() });
    // Query is disabled, so data stays undefined
    expect(result.current.data).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
  });

  it('fetches a weekly brief for a specific week end date', async () => {
    const chain = buildQueryChain({ data: mockBrief, error: null });
    mockSupabase.from.mockReturnValue(chain);

    const { result } = renderHook(
      () => useWeeklyBrief('rest-123', '2026-02-15'),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(mockBrief);
    expect(mockSupabase.from).toHaveBeenCalledWith('weekly_brief');
    expect(chain.eq).toHaveBeenCalledWith('restaurant_id', 'rest-123');
    expect(chain.eq).toHaveBeenCalledWith('brief_week_end', '2026-02-15');
  });

  it('defaults to the most recent Sunday when no date is provided', async () => {
    const chain = buildQueryChain({ data: null, error: null });
    mockSupabase.from.mockReturnValue(chain);

    const now = new Date();
    const dayOfWeek = now.getDay();
    const lastSunday = new Date(now);
    lastSunday.setDate(now.getDate() - (dayOfWeek === 0 ? 7 : dayOfWeek));
    const expectedDate = lastSunday.toISOString().split('T')[0];

    const { result } = renderHook(
      () => useWeeklyBrief('rest-123'),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(chain.eq).toHaveBeenCalledWith('brief_week_end', expectedDate);
  });

  it('throws on Supabase error', async () => {
    const chain = buildQueryChain({ data: null, error: { message: 'DB error' } });
    mockSupabase.from.mockReturnValue(chain);

    const { result } = renderHook(
      () => useWeeklyBrief('rest-123', '2026-02-15'),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toEqual({ message: 'DB error' });
  });
});

describe('useWeeklyBriefHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns undefined when restaurantId is undefined (query disabled)', async () => {
    const { result } = renderHook(() => useWeeklyBriefHistory(undefined), { wrapper: createWrapper() });
    expect(result.current.data).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
  });

  it('fetches brief history with default limit', async () => {
    const historyData = [
      { id: 'b1', brief_week_end: '2026-02-15', metrics_json: {}, narrative: 'Week 1', computed_at: '2026-02-16T06:00:00Z' },
      { id: 'b2', brief_week_end: '2026-02-08', metrics_json: {}, narrative: 'Week 2', computed_at: '2026-02-09T06:00:00Z' },
    ];

    const chain: Record<string, ReturnType<typeof vi.fn>> = {};
    chain.select = vi.fn().mockReturnValue(chain);
    chain.eq = vi.fn().mockReturnValue(chain);
    chain.order = vi.fn().mockReturnValue(chain);
    chain.limit = vi.fn().mockResolvedValue({ data: historyData, error: null });
    mockSupabase.from.mockReturnValue(chain);

    const { result } = renderHook(
      () => useWeeklyBriefHistory('rest-123'),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(historyData);
    expect(chain.limit).toHaveBeenCalledWith(14);
    expect(chain.order).toHaveBeenCalledWith('brief_week_end', { ascending: false });
  });

  it('respects custom limit parameter', async () => {
    const chain: Record<string, ReturnType<typeof vi.fn>> = {};
    chain.select = vi.fn().mockReturnValue(chain);
    chain.eq = vi.fn().mockReturnValue(chain);
    chain.order = vi.fn().mockReturnValue(chain);
    chain.limit = vi.fn().mockResolvedValue({ data: [], error: null });
    mockSupabase.from.mockReturnValue(chain);

    const { result } = renderHook(
      () => useWeeklyBriefHistory('rest-123', 4),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(chain.limit).toHaveBeenCalledWith(4);
  });

  it('returns empty array when data is null', async () => {
    const chain: Record<string, ReturnType<typeof vi.fn>> = {};
    chain.select = vi.fn().mockReturnValue(chain);
    chain.eq = vi.fn().mockReturnValue(chain);
    chain.order = vi.fn().mockReturnValue(chain);
    chain.limit = vi.fn().mockResolvedValue({ data: null, error: null });
    mockSupabase.from.mockReturnValue(chain);

    const { result } = renderHook(
      () => useWeeklyBriefHistory('rest-123'),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });
});
