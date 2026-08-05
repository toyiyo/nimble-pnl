import React, { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockSupabase = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
}));
const mockToast = vi.hoisted(() => vi.fn());

vi.mock('@/integrations/supabase/client', () => ({ supabase: mockSupabase }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mockToast }) }));

import { useReviewResponses } from '@/hooks/useReviewResponses';

function createWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return React.createElement(QueryClientProvider, { client }, children);
  };
}

/** `.select(...).eq(...).not(...).order(...).limit(...)` → a Supabase result. */
function makeListStub(data: unknown, error: unknown = null) {
  const limit = vi.fn(async () => ({ data, error }));
  const order = vi.fn(() => ({ limit }));
  const not = vi.fn(() => ({ order }));
  const eq = vi.fn(() => ({ not }));
  const select = vi.fn(() => ({ eq }));
  return { stub: { select }, select, eq, not, order, limit };
}

/** `.update(...).eq('id', …).eq('restaurant_id', …)` resolving to `{ error }`. */
function makeUpdateStub(error: unknown = null) {
  const eqRestaurant = vi.fn(async () => ({ error }));
  const eqId = vi.fn(() => ({ eq: eqRestaurant }));
  const update = vi.fn(() => ({ eq: eqId }));
  return { stub: { update }, update, eqId, eqRestaurant };
}

/** `.select(...).eq(...).eq(...).maybeSingle()` resolving to a Supabase result. */
function makeContactStub(data: unknown, error: unknown = null) {
  const maybeSingle = vi.fn(async () => ({ data, error }));
  const eqRestaurant = vi.fn(() => ({ maybeSingle }));
  const eqResponse = vi.fn(() => ({ eq: eqRestaurant }));
  const select = vi.fn(() => ({ eq: eqResponse }));
  return { stub: { select }, select, eqResponse, eqRestaurant, maybeSingle };
}

const RESPONSE_ROW = {
  id: 'resp-1',
  restaurant_id: 'rest-1',
  review_page_id: 'page-1',
  rating: 2,
  routed_to: 'feedback' as const,
  comment: 'The wait was long.',
  contact_consent: true,
  status: 'new' as const,
  submitted_at: '2026-08-01T12:00:00Z',
  commented_at: '2026-08-01T12:01:00Z',
};

const METRICS_ROW = {
  average_rating: 4.2,
  total_ratings: 310,
  comment_count: 47,
  unread_count: 5,
};

describe('useReviewResponses', () => {
  beforeEach(() => {
    mockSupabase.from.mockReset();
    mockSupabase.rpc.mockReset();
    mockToast.mockReset();
  });

  it('does not query until a restaurant is selected', async () => {
    const { result } = renderHook(() => useReviewResponses(undefined), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.responses).toEqual([]);
    expect(mockSupabase.from).not.toHaveBeenCalled();
    expect(mockSupabase.rpc).not.toHaveBeenCalled();
  });

  it('filters to commented rows server-side, then caps at 500, newest first', async () => {
    const list = makeListStub([RESPONSE_ROW]);
    mockSupabase.from.mockReturnValue(list.stub);
    mockSupabase.rpc.mockResolvedValue({ data: [METRICS_ROW], error: null });

    const { result } = renderHook(() => useReviewResponses('rest-1'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.responses).toHaveLength(1));
    expect(mockSupabase.from).toHaveBeenCalledWith('review_responses');
    expect(list.eq).toHaveBeenCalledWith('restaurant_id', 'rest-1');
    // The comment filter must precede the cap. Filtering client-side after a
    // 500-row fetch loses a written complaint behind 500 newer silent taps.
    expect(list.not).toHaveBeenCalledWith('comment', 'is', null);
    expect(list.order).toHaveBeenCalledWith('submitted_at', { ascending: false });
    expect(list.limit).toHaveBeenCalledWith(500);
  });

  it('takes metrics from the uncapped aggregate, not the capped list', async () => {
    mockSupabase.from.mockReturnValue(makeListStub([RESPONSE_ROW]).stub);
    mockSupabase.rpc.mockResolvedValue({ data: [METRICS_ROW], error: null });

    const { result } = renderHook(() => useReviewResponses('rest-1'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.metrics.totalRatings).toBe(310));
    expect(mockSupabase.rpc).toHaveBeenCalledWith('review_response_metrics', {
      p_restaurant_id: 'rest-1',
    });
    // 310 ratings behind a list capped at 500 rows: the header must not be a
    // fold over `responses`.
    expect(result.current.metrics).toEqual({
      averageRating: 4.2,
      totalRatings: 310,
      commentCount: 47,
      unreadCount: 5,
    });
  });

  it('reports a null average rather than zero when nothing has been rated', async () => {
    mockSupabase.from.mockReturnValue(makeListStub([]).stub);
    mockSupabase.rpc.mockResolvedValue({ data: [], error: null });

    const { result } = renderHook(() => useReviewResponses('rest-1'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.metrics).toEqual({
      averageRating: null,
      totalRatings: 0,
      commentCount: 0,
      unreadCount: 0,
    });
  });

  it('surfaces a failing list query as an error', async () => {
    mockSupabase.from.mockReturnValue(makeListStub(null, new Error('list down')).stub);
    mockSupabase.rpc.mockResolvedValue({ data: [METRICS_ROW], error: null });

    const { result } = renderHook(() => useReviewResponses('rest-1'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.error?.message).toBe('list down');
  });

  it('surfaces a failing metrics query as an error', async () => {
    mockSupabase.from.mockReturnValue(makeListStub([RESPONSE_ROW]).stub);
    mockSupabase.rpc.mockResolvedValue({ data: null, error: new Error('metrics down') });

    const { result } = renderHook(() => useReviewResponses('rest-1'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.error?.message).toBe('metrics down');
  });

  it('constrains a status change by restaurant_id as well as id', async () => {
    mockSupabase.from.mockReturnValue(makeListStub([RESPONSE_ROW]).stub);
    mockSupabase.rpc.mockResolvedValue({ data: [METRICS_ROW], error: null });

    const { result } = renderHook(() => useReviewResponses('rest-1'), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const upd = makeUpdateStub();
    mockSupabase.from.mockReturnValue(upd.stub);
    await result.current.updateStatus({ id: 'resp-1', status: 'resolved' });

    expect(upd.update).toHaveBeenCalledWith({ status: 'resolved' });
    expect(upd.eqId).toHaveBeenCalledWith('id', 'resp-1');
    expect(upd.eqRestaurant).toHaveBeenCalledWith('restaurant_id', 'rest-1');
  });

  it('toasts and rejects when a status change fails', async () => {
    mockSupabase.from.mockReturnValue(makeListStub([RESPONSE_ROW]).stub);
    mockSupabase.rpc.mockResolvedValue({ data: [METRICS_ROW], error: null });

    const { result } = renderHook(() => useReviewResponses('rest-1'), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    mockSupabase.from.mockReturnValue(makeUpdateStub(new Error('denied')).stub);
    await expect(
      result.current.updateStatus({ id: 'resp-1', status: 'resolved' })
    ).rejects.toThrow('denied');

    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Could not update', variant: 'destructive' })
    );
  });

  it('refuses to change status when no restaurant is selected', async () => {
    const { result } = renderHook(() => useReviewResponses(undefined), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await expect(
      result.current.updateStatus({ id: 'resp-1', status: 'resolved' })
    ).rejects.toThrow('No restaurant selected');
    await expect(result.current.fetchContact('resp-1')).rejects.toThrow('No restaurant selected');
  });

  it('fetches guest contact details scoped to the restaurant', async () => {
    mockSupabase.from.mockReturnValue(makeListStub([RESPONSE_ROW]).stub);
    mockSupabase.rpc.mockResolvedValue({ data: [METRICS_ROW], error: null });

    const { result } = renderHook(() => useReviewResponses('rest-1'), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const contact = makeContactStub({ contact_name: 'Ada', contact_email: 'ada@example.com' });
    mockSupabase.from.mockReturnValue(contact.stub);

    await expect(result.current.fetchContact('resp-1')).resolves.toEqual({
      contact_name: 'Ada',
      contact_email: 'ada@example.com',
    });
    expect(mockSupabase.from).toHaveBeenLastCalledWith('review_response_contacts');
    expect(contact.eqResponse).toHaveBeenCalledWith('review_response_id', 'resp-1');
    expect(contact.eqRestaurant).toHaveBeenCalledWith('restaurant_id', 'rest-1');
  });

  it('returns null silently for a view-only reader, whose RLS-filtered read is empty', async () => {
    mockSupabase.from.mockReturnValue(makeListStub([RESPONSE_ROW]).stub);
    mockSupabase.rpc.mockResolvedValue({ data: [METRICS_ROW], error: null });

    const { result } = renderHook(() => useReviewResponses('rest-1'), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // RLS filters the row out rather than rejecting the read: zero rows, no
    // error. Indistinguishable from "the guest left nothing", and correctly
    // so — the pane renders nothing and says nothing.
    mockSupabase.from.mockReturnValue(makeContactStub(null).stub);
    await expect(result.current.fetchContact('resp-1')).resolves.toBeNull();
    expect(mockToast).not.toHaveBeenCalled();
  });

  it('surfaces a failed contact fetch instead of passing it off as no contact', async () => {
    mockSupabase.from.mockReturnValue(makeListStub([RESPONSE_ROW]).stub);
    mockSupabase.rpc.mockResolvedValue({ data: [METRICS_ROW], error: null });

    const { result } = renderHook(() => useReviewResponses('rest-1'), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // A genuine transport failure is NOT the empty case: rendering "no
    // contact details" over a guest who did leave them loses the reply.
    mockSupabase.from.mockReturnValue(makeContactStub(null, new Error('fetch failed')).stub);
    await expect(result.current.fetchContact('resp-1')).resolves.toBeNull();
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Could not load contact details',
        variant: 'destructive',
      })
    );
  });
});
