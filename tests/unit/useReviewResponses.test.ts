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

import {
  isActionableResponse,
  useReviewResponses,
  type ReviewResponseFilter,
} from '@/hooks/useReviewResponses';

function createWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return React.createElement(QueryClientProvider, { client }, children);
  };
}

/**
 * `.select(...).eq(...)` then, per filter, `.or(...)` / `.is(...).eq(...)` /
 * neither, then two chained `.order(...)` calls and `.limit(...)`. The `all`
 * mode adds no predicate, so `eq` carries `order` directly. Both `.order()`
 * calls resolve to the same chain object, so `order` records both calls in
 * sequence and `limit` is reachable no matter which branch ran.
 */
function makeListStub(data: unknown, error: unknown = null) {
  const limit = vi.fn(async () => ({ data, error }));
  interface OrderChain {
    order: (...args: unknown[]) => OrderChain;
    limit: typeof limit;
  }
  const orderChain = {} as OrderChain;
  const order = vi.fn(() => orderChain);
  orderChain.order = order;
  orderChain.limit = limit;

  const or = vi.fn(() => orderChain);
  const eqContactConsent = vi.fn(() => orderChain);
  const is = vi.fn(() => ({ eq: eqContactConsent }));
  const eq = vi.fn(() => ({ or, is, order }));
  const select = vi.fn(() => ({ eq }));
  return { stub: { select }, select, eq, or, is, eqContactConsent, order, limit };
}

/**
 * `.update(...).eq('id', …).eq('restaurant_id', …).select('id').maybeSingle()`.
 *
 * The trailing `.select().maybeSingle()` is what makes a zero-row UPDATE
 * distinguishable: without it PostgREST answers a filtered-away write with
 * success and no error, so `data` is the only evidence anything was written.
 */
function makeUpdateStub(error: unknown = null, data: unknown = { id: 'resp-1' }) {
  const maybeSingle = vi.fn(async () => ({ data: error ? null : data, error }));
  const select = vi.fn(() => ({ maybeSingle }));
  const eqRestaurant = vi.fn(() => ({ select }));
  const eqId = vi.fn(() => ({ eq: eqRestaurant }));
  const update = vi.fn(() => ({ eq: eqId }));
  return { stub: { update }, update, eqId, eqRestaurant, select, maybeSingle };
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

  it('adds no comment predicate by default, then caps at 500, newest first', async () => {
    const list = makeListStub([RESPONSE_ROW]);
    mockSupabase.from.mockReturnValue(list.stub);
    mockSupabase.rpc.mockResolvedValue({ data: [METRICS_ROW], error: null });

    const { result } = renderHook(() => useReviewResponses('rest-1'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.responses).toHaveLength(1));
    expect(mockSupabase.from).toHaveBeenCalledWith('review_responses');
    expect(list.eq).toHaveBeenCalledWith('restaurant_id', 'rest-1');
    // A silent rating is a rating. The default mode hides nothing.
    expect(list.or).not.toHaveBeenCalled();
    expect(list.is).not.toHaveBeenCalled();
    // The list shows commented_at ?? submitted_at, so it must order by the
    // same key first, with submitted_at as the tiebreaker.
    expect(list.order).toHaveBeenNthCalledWith(1, 'commented_at', {
      ascending: false,
      nullsFirst: false,
    });
    expect(list.order).toHaveBeenNthCalledWith(2, 'submitted_at', { ascending: false });
    expect(list.limit).toHaveBeenCalledWith(500);
  });

  it('filters to rows that need a reply server-side, before the cap', async () => {
    const list = makeListStub([RESPONSE_ROW]);
    mockSupabase.from.mockReturnValue(list.stub);
    mockSupabase.rpc.mockResolvedValue({ data: [METRICS_ROW], error: null });

    const { result } = renderHook(() => useReviewResponses('rest-1', 'needsReply'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.responses).toHaveLength(1));
    // The predicate must precede the cap. A client-side filter after a
    // 500-row fetch loses a written complaint behind 500 newer silent taps.
    // This is the same rule as isActionableResponse — see the warning there.
    expect(list.or).toHaveBeenCalledWith('comment.not.is.null,contact_consent.is.true');
    // The two arms exclude each other. A stub that ran the silent branch too
    // would call is/eqContactConsent here, and this assertion would catch it.
    expect(list.is).not.toHaveBeenCalled();
    expect(list.eqContactConsent).not.toHaveBeenCalled();
    expect(list.limit).toHaveBeenCalledWith(500);
  });

  it('filters to silent rows server-side, before the cap', async () => {
    const list = makeListStub([RESPONSE_ROW]);
    mockSupabase.from.mockReturnValue(list.stub);
    mockSupabase.rpc.mockResolvedValue({ data: [METRICS_ROW], error: null });

    const { result } = renderHook(() => useReviewResponses('rest-1', 'silent'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.responses).toHaveLength(1));
    expect(list.is).toHaveBeenCalledWith('comment', null);
    expect(list.eqContactConsent).toHaveBeenCalledWith('contact_consent', false);
    // The two arms exclude each other. A stub that ran the needsReply branch
    // too would call or here, and this assertion would catch it.
    expect(list.or).not.toHaveBeenCalled();
    expect(list.limit).toHaveBeenCalledWith(500);
  });

  it('never lets a single fetch match both the needsReply and the silent rule', () => {
    // Mirrors the two query-builder branches as plain predicates. A future
    // edit that lets the branches overlap — so a stub applying both filters
    // could still return a row — fails this test before it reaches the UI.
    const matchesNeedsReply = (row: { comment: string | null; contact_consent: boolean }) =>
      row.comment !== null || row.contact_consent;
    const matchesSilent = (row: { comment: string | null; contact_consent: boolean }) =>
      row.comment === null && row.contact_consent === false;

    const rowShapes = [
      { comment: 'hi', contact_consent: false },
      { comment: 'hi', contact_consent: true },
      { comment: null, contact_consent: true },
      { comment: null, contact_consent: false },
    ];

    for (const row of rowShapes) {
      expect(matchesNeedsReply(row) && matchesSilent(row)).toBe(false);
      expect(matchesNeedsReply(row) !== matchesSilent(row)).toBe(true);
    }
  });

  it('caches each filter on its own key, so a filter change refetches', async () => {
    const list = makeListStub([RESPONSE_ROW]);
    mockSupabase.from.mockReturnValue(list.stub);
    mockSupabase.rpc.mockResolvedValue({ data: [METRICS_ROW], error: null });

    const { rerender } = renderHook(
      ({ filter }: { filter: ReviewResponseFilter }) => useReviewResponses('rest-1', filter),
      { wrapper: createWrapper(), initialProps: { filter: 'all' as ReviewResponseFilter } }
    );
    await waitFor(() => expect(list.limit).toHaveBeenCalledTimes(1));

    // A shared query key would answer `silent` from the `all` cache and show
    // commented rows under a filter that excludes them.
    rerender({ filter: 'silent' });
    await waitFor(() => expect(list.limit).toHaveBeenCalledTimes(2));
    expect(list.is).toHaveBeenCalledWith('comment', null);
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

  it('treats a status change that matched no row as a failure, not a success', async () => {
    mockSupabase.from.mockReturnValue(makeListStub([RESPONSE_ROW]).stub);
    mockSupabase.rpc.mockResolvedValue({ data: [METRICS_ROW], error: null });

    const { result } = renderHook(() => useReviewResponses('rest-1'), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // RLS filtered the row, or the id is from a stale cache: PostgREST reports
    // no error either way. Reporting "Updated" over a write that never landed
    // is how a manager marks a complaint resolved that stays open.
    mockSupabase.from.mockReturnValue(makeUpdateStub(null, null).stub);
    await expect(
      result.current.updateStatus({ id: 'resp-1', status: 'resolved' })
    ).rejects.toThrow(/no longer available/);

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

  it('calls a row actionable when it holds a comment or contact consent', () => {
    expect(isActionableResponse({ ...RESPONSE_ROW, comment: 'x', contact_consent: false })).toBe(
      true
    );
    // The guest asked to hear back. That is a chore, comment or not.
    expect(isActionableResponse({ ...RESPONSE_ROW, comment: null, contact_consent: true })).toBe(
      true
    );
    // A silent five-star tap needs no triage.
    expect(isActionableResponse({ ...RESPONSE_ROW, comment: null, contact_consent: false })).toBe(
      false
    );
  });
});
