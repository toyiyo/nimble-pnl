import React, { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useDailyBrief, useDailyBriefHistory } from '@/hooks/useDailyBrief';

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
  brief_date: '2026-02-14',
  metrics_json: { net_revenue: 5000, food_cost_pct: 28.5 },
  comparisons_json: {},
  variances_json: [
    { metric: 'net_revenue', value: 5000, direction: 'up', flag: null, prior_day: 4500, delta_vs_prior: 500, delta_pct_vs_prior: 11.1, same_day_last_week: null, avg_7day: 4800, delta_pct_vs_avg: 4.2 },
  ],
  inbox_summary_json: { open_count: 3, critical_count: 1 },
  recommendations_json: [{ title: 'Review food cost', body: 'Food cost increased', impact: 'High', effort: 'Low' }],
  narrative: 'Revenue was up 11% yesterday.',
  computed_at: '2026-02-15T06:00:00Z',
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
  // For history queries (no maybeSingle), the final call in the chain is .limit()
  // We override the last `.limit` to resolve with data when there's no maybeSingle call
  return chain;
}

describe('useDailyBrief', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when restaurantId is undefined', async () => {
    const { result } = renderHook(() => useDailyBrief(undefined), { wrapper: createWrapper() });
    // Query is disabled, so data stays undefined
    expect(result.current.data).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
  });

  it('fetches a daily brief for a specific date', async () => {
    const chain = buildQueryChain({ data: mockBrief, error: null });
    mockSupabase.from.mockReturnValue(chain);

    const { result } = renderHook(
      () => useDailyBrief('rest-123', '2026-02-14'),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(mockBrief);
    expect(mockSupabase.from).toHaveBeenCalledWith('daily_brief');
    expect(chain.eq).toHaveBeenCalledWith('restaurant_id', 'rest-123');
    expect(chain.eq).toHaveBeenCalledWith('brief_date', '2026-02-14');
  });

  it('defaults to yesterday when no date is provided', async () => {
    const chain = buildQueryChain({ data: null, error: null });
    mockSupabase.from.mockReturnValue(chain);

    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

    const { result } = renderHook(
      () => useDailyBrief('rest-123'),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(chain.eq).toHaveBeenCalledWith('brief_date', yesterday);
  });

  it('throws on Supabase error', async () => {
    const chain = buildQueryChain({ data: null, error: { message: 'DB error' } });
    mockSupabase.from.mockReturnValue(chain);

    const { result } = renderHook(
      () => useDailyBrief('rest-123', '2026-02-14'),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toEqual({ message: 'DB error' });
  });
});

describe('useDailyBriefHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns undefined when restaurantId is undefined (query disabled)', async () => {
    const { result } = renderHook(() => useDailyBriefHistory(undefined), { wrapper: createWrapper() });
    expect(result.current.data).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
  });

  it('fetches brief history with default limit', async () => {
    const historyData = [
      { id: 'b1', brief_date: '2026-02-14', metrics_json: {}, narrative: 'Day 1', computed_at: '2026-02-15T06:00:00Z' },
      { id: 'b2', brief_date: '2026-02-13', metrics_json: {}, narrative: 'Day 2', computed_at: '2026-02-14T06:00:00Z' },
    ];

    const chain: Record<string, ReturnType<typeof vi.fn>> = {};
    chain.select = vi.fn().mockReturnValue(chain);
    chain.eq = vi.fn().mockReturnValue(chain);
    chain.order = vi.fn().mockReturnValue(chain);
    chain.limit = vi.fn().mockResolvedValue({ data: historyData, error: null });
    mockSupabase.from.mockReturnValue(chain);

    const { result } = renderHook(
      () => useDailyBriefHistory('rest-123'),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(historyData);
    expect(chain.limit).toHaveBeenCalledWith(14);
    expect(chain.order).toHaveBeenCalledWith('brief_date', { ascending: false });
  });

  it('respects custom limit parameter', async () => {
    const chain: Record<string, ReturnType<typeof vi.fn>> = {};
    chain.select = vi.fn().mockReturnValue(chain);
    chain.eq = vi.fn().mockReturnValue(chain);
    chain.order = vi.fn().mockReturnValue(chain);
    chain.limit = vi.fn().mockResolvedValue({ data: [], error: null });
    mockSupabase.from.mockReturnValue(chain);

    const { result } = renderHook(
      () => useDailyBriefHistory('rest-123', 7),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(chain.limit).toHaveBeenCalledWith(7);
  });

  it('returns empty array when data is null', async () => {
    const chain: Record<string, ReturnType<typeof vi.fn>> = {};
    chain.select = vi.fn().mockReturnValue(chain);
    chain.eq = vi.fn().mockReturnValue(chain);
    chain.order = vi.fn().mockReturnValue(chain);
    chain.limit = vi.fn().mockResolvedValue({ data: null, error: null });
    mockSupabase.from.mockReturnValue(chain);

    const { result } = renderHook(
      () => useDailyBriefHistory('rest-123'),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });
});
