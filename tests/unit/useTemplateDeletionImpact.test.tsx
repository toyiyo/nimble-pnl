import React, { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockSupabase = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: mockSupabase,
}));

import { useTemplateDeletionImpact } from '@/hooks/useTemplateDeletionImpact';

function createWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return React.createElement(QueryClientProvider, { client }, children);
  };
}

/**
 * Builds a chainable Postgrest-style mock: every filter method returns the
 * same builder object (so `.eq().eq().gte()` etc. all chain), and the
 * builder itself is thenable so `await query` resolves to `result` —
 * matching supabase-js's real PostgrestFilterBuilder shape (each chained
 * call returns `this`, which is itself awaitable).
 */
function makeQueryBuilder(result: {
  data?: unknown;
  error?: unknown;
  count?: number | null;
}) {
  const builder: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'gte', 'order', 'in']) {
    builder[method] = vi.fn(() => builder);
  }
  builder.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return builder as {
    select: ReturnType<typeof vi.fn>;
    eq: ReturnType<typeof vi.fn>;
    gte: ReturnType<typeof vi.fn>;
    order: ReturnType<typeof vi.fn>;
    in: ReturnType<typeof vi.fn>;
  };
}

function mockFromByTable(claimsBuilder: unknown, shiftsBuilder: unknown) {
  mockSupabase.from.mockImplementation((table: string) =>
    table === 'open_shift_claims' ? claimsBuilder : shiftsBuilder,
  );
}

describe('useTemplateDeletionImpact', () => {
  beforeEach(() => {
    mockSupabase.from.mockReset();
    mockSupabase.rpc.mockReset();
  });

  it('does not fetch when restaurantId is null (enabled gating)', async () => {
    const { result } = renderHook(() => useTemplateDeletionImpact(null, 't1'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(mockSupabase.from).not.toHaveBeenCalled();
    expect(mockSupabase.rpc).not.toHaveBeenCalled();
    expect(result.current.pendingClaims).toEqual({ count: 0, names: [] });
    expect(result.current.scheduledShiftsKept).toBe(0);
    expect(result.current.upcomingOpenSpots).toBe(0);
  });

  it('does not fetch when templateId is null (enabled gating)', async () => {
    const { result } = renderHook(() => useTemplateDeletionImpact('r1', null), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(mockSupabase.from).not.toHaveBeenCalled();
    expect(mockSupabase.rpc).not.toHaveBeenCalled();
  });

  it('aggregates pending-claim count and names from the employees join', async () => {
    const claimsBuilder = makeQueryBuilder({
      data: [
        { employee: { name: 'Alex Rivera' } },
        { employee: { name: 'Jordan Lee' } },
      ],
      error: null,
    });
    const shiftsBuilder = makeQueryBuilder({ count: 0, error: null });
    mockFromByTable(claimsBuilder, shiftsBuilder);
    mockSupabase.rpc.mockResolvedValue({ data: [], error: null });

    const { result } = renderHook(() => useTemplateDeletionImpact('r1', 't1'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.pendingClaims).toEqual({
      count: 2,
      names: ['Alex Rivera', 'Jordan Lee'],
    });
    expect(claimsBuilder.eq).toHaveBeenCalledWith('restaurant_id', 'r1');
    expect(claimsBuilder.eq).toHaveBeenCalledWith('shift_template_id', 't1');
    expect(claimsBuilder.eq).toHaveBeenCalledWith('status', 'pending_approval');
  });

  it('counts every pending-claim row but only names the ones with a resolvable employee join', async () => {
    const claimsBuilder = makeQueryBuilder({
      data: [{ employee: { name: 'Alex Rivera' } }, { employee: null }],
      error: null,
    });
    const shiftsBuilder = makeQueryBuilder({ count: 0, error: null });
    mockFromByTable(claimsBuilder, shiftsBuilder);
    mockSupabase.rpc.mockResolvedValue({ data: [], error: null });

    const { result } = renderHook(() => useTemplateDeletionImpact('r1', 't1'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.pendingClaims.count).toBe(2);
    expect(result.current.pendingClaims.names).toEqual(['Alex Rivera']);
  });

  it('returns scheduledShiftsKept from a head-count query on shifts, scoped to today-forward', async () => {
    const claimsBuilder = makeQueryBuilder({ data: [], error: null });
    const shiftsBuilder = makeQueryBuilder({ count: 5, error: null });
    mockFromByTable(claimsBuilder, shiftsBuilder);
    mockSupabase.rpc.mockResolvedValue({ data: [], error: null });

    const { result } = renderHook(() => useTemplateDeletionImpact('r1', 't1'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.scheduledShiftsKept).toBe(5);
    expect(shiftsBuilder.select).toHaveBeenCalledWith('id', { count: 'exact', head: true });
    expect(shiftsBuilder.eq).toHaveBeenCalledWith('restaurant_id', 'r1');
    expect(shiftsBuilder.eq).toHaveBeenCalledWith('shift_template_id', 't1');
    expect(shiftsBuilder.gte).toHaveBeenCalledWith('start_time', expect.any(String));
  });

  it('treats a null count from the shifts query as zero kept shifts', async () => {
    const claimsBuilder = makeQueryBuilder({ data: [], error: null });
    const shiftsBuilder = makeQueryBuilder({ count: null, error: null });
    mockFromByTable(claimsBuilder, shiftsBuilder);
    mockSupabase.rpc.mockResolvedValue({ data: [], error: null });

    const { result } = renderHook(() => useTemplateDeletionImpact('r1', 't1'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.scheduledShiftsKept).toBe(0);
  });

  it('sums upcomingOpenSpots from get_open_shifts, filtered client-side to this template_id', async () => {
    const claimsBuilder = makeQueryBuilder({ data: [], error: null });
    const shiftsBuilder = makeQueryBuilder({ count: 0, error: null });
    mockFromByTable(claimsBuilder, shiftsBuilder);
    mockSupabase.rpc.mockResolvedValue({
      data: [
        { template_id: 't1', open_spots: 2 },
        { template_id: 't1', open_spots: 3 },
        { template_id: 'other-template', open_spots: 100 },
      ],
      error: null,
    });

    const { result } = renderHook(() => useTemplateDeletionImpact('r1', 't1'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.upcomingOpenSpots).toBe(5);
    expect(mockSupabase.rpc).toHaveBeenCalledWith('get_open_shifts', {
      p_restaurant_id: 'r1',
      p_week_start: expect.any(String),
      p_week_end: expect.any(String),
    });
  });

  it('surfaces an error when the pending-claims read fails', async () => {
    const claimsBuilder = makeQueryBuilder({ data: null, error: { message: 'claims boom' } });
    const shiftsBuilder = makeQueryBuilder({ count: 0, error: null });
    mockFromByTable(claimsBuilder, shiftsBuilder);
    mockSupabase.rpc.mockResolvedValue({ data: [], error: null });

    const { result } = renderHook(() => useTemplateDeletionImpact('r1', 't1'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.error?.message).toBe('claims boom');
  });

  it('surfaces an error when the scheduled-shifts count read fails', async () => {
    const claimsBuilder = makeQueryBuilder({ data: [], error: null });
    const shiftsBuilder = makeQueryBuilder({ count: null, error: { message: 'shifts boom' } });
    mockFromByTable(claimsBuilder, shiftsBuilder);
    mockSupabase.rpc.mockResolvedValue({ data: [], error: null });

    const { result } = renderHook(() => useTemplateDeletionImpact('r1', 't1'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.error?.message).toBe('shifts boom');
  });

  it('surfaces an error when the get_open_shifts RPC fails', async () => {
    const claimsBuilder = makeQueryBuilder({ data: [], error: null });
    const shiftsBuilder = makeQueryBuilder({ count: 0, error: null });
    mockFromByTable(claimsBuilder, shiftsBuilder);
    mockSupabase.rpc.mockResolvedValue({ data: null, error: { message: 'rpc boom' } });

    const { result } = renderHook(() => useTemplateDeletionImpact('r1', 't1'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.error?.message).toBe('rpc boom');
  });

  it('exposes a refetch function (for the ledger\'s error-state Retry affordance)', async () => {
    const claimsBuilder = makeQueryBuilder({ data: [], error: null });
    const shiftsBuilder = makeQueryBuilder({ count: 0, error: null });
    mockFromByTable(claimsBuilder, shiftsBuilder);
    mockSupabase.rpc.mockResolvedValue({ data: [], error: null });

    const { result } = renderHook(() => useTemplateDeletionImpact('r1', 't1'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(typeof result.current.refetch).toBe('function');
  });

  it('scopes the query cache key to templateId', async () => {
    const claimsBuilder = makeQueryBuilder({ data: [], error: null });
    const shiftsBuilder = makeQueryBuilder({ count: 0, error: null });
    mockFromByTable(claimsBuilder, shiftsBuilder);
    mockSupabase.rpc.mockResolvedValue({ data: [], error: null });

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) =>
      React.createElement(QueryClientProvider, { client }, children);

    renderHook(() => useTemplateDeletionImpact('r1', 't1'), { wrapper });

    await waitFor(() => {
      expect(client.getQueryState(['template-deletion-impact', 'r1', 't1'])).toBeDefined();
    });
  });
});
