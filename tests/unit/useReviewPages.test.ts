import React, { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockSupabase = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  auth: { getUser: vi.fn() },
  storage: { from: vi.fn() },
}));
const mockToast = vi.hoisted(() => vi.fn());

vi.mock('@/integrations/supabase/client', () => ({ supabase: mockSupabase }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mockToast }) }));

import { useReviewPages } from '@/hooks/useReviewPages';

function createWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return React.createElement(QueryClientProvider, { client }, children);
  };
}

/** `.select(...).eq(...).order(...)` resolving to a Supabase-shaped result. */
function makeListStub(data: unknown, error: unknown = null) {
  return {
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        order: vi.fn(async () => ({ data, error })),
      })),
    })),
  };
}

/** `.insert(...).select('id').single()` resolving to a Supabase-shaped result. */
function makeInsertStub(results: Array<{ data: unknown; error: unknown }>) {
  const single = vi.fn(async () => results.shift() ?? { data: null, error: null });
  const insert = vi.fn(() => ({ select: vi.fn(() => ({ single })) }));
  return { stub: { insert }, insert, single };
}

/** `.update(...).eq('id', …).eq('restaurant_id', …)` resolving to `{ error }`. */
function makeUpdateStub(results: Array<{ error: unknown }>) {
  const eqRestaurant = vi.fn(async () => results.shift() ?? { error: null });
  const eqId = vi.fn(() => ({ eq: eqRestaurant }));
  const update = vi.fn(() => ({ eq: eqId }));
  return { stub: { update }, update, eqId, eqRestaurant };
}

const PAGE_ROW = {
  id: 'page-1',
  restaurant_id: 'rest-1',
  slug: 'the-counter',
  name: 'The Counter',
  is_active: true,
  logo_path: null,
  headline: 'How was everything?',
  subheadline: null,
  promoter_threshold: 4,
  destination_url: 'https://g.page/r/abc/review',
  created_at: '2026-08-01T00:00:00Z',
  updated_at: '2026-08-01T00:00:00Z',
};

describe('useReviewPages', () => {
  beforeEach(() => {
    mockSupabase.from.mockReset();
    mockSupabase.rpc.mockReset();
    mockSupabase.auth.getUser.mockReset();
    mockSupabase.storage.from.mockReset();
    mockToast.mockReset();
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
  });

  it('does not query until a restaurant is selected', async () => {
    const { result } = renderHook(() => useReviewPages(undefined), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.pages).toEqual([]);
    expect(mockSupabase.from).not.toHaveBeenCalled();
    expect(mockSupabase.rpc).not.toHaveBeenCalled();
  });

  it('joins each page to its server-side stats row', async () => {
    mockSupabase.from.mockReturnValue(makeListStub([PAGE_ROW, { ...PAGE_ROW, id: 'page-2' }]));
    mockSupabase.rpc.mockResolvedValue({
      data: [
        { review_page_id: 'page-1', average_rating: 4.5, rating_count: 8, comment_count: 3 },
      ],
      error: null,
    });

    const { result } = renderHook(() => useReviewPages('rest-1'), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.pages).toHaveLength(2));
    expect(mockSupabase.rpc).toHaveBeenCalledWith('review_page_stats', {
      p_restaurant_id: 'rest-1',
    });
    expect(result.current.pages[0]).toMatchObject({
      id: 'page-1',
      averageRating: 4.5,
      ratingCount: 8,
      commentCount: 3,
    });
  });

  it('reports a page with no responses as null average and zero counts', async () => {
    mockSupabase.from.mockReturnValue(makeListStub([PAGE_ROW]));
    mockSupabase.rpc.mockResolvedValue({ data: [], error: null });

    const { result } = renderHook(() => useReviewPages('rest-1'), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.pages).toHaveLength(1));
    expect(result.current.pages[0]).toMatchObject({
      averageRating: null,
      ratingCount: 0,
      commentCount: 0,
    });
  });

  it('surfaces a failing stats query as an error', async () => {
    mockSupabase.from.mockReturnValue(makeListStub([PAGE_ROW]));
    mockSupabase.rpc.mockResolvedValue({ data: null, error: new Error('rpc down') });

    const { result } = renderHook(() => useReviewPages('rest-1'), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.error?.message).toBe('rpc down');
    expect(result.current.pages).toEqual([]);
  });

  it('creates a page scoped to the restaurant and the signed-in author', async () => {
    mockSupabase.from.mockReturnValue(makeListStub([]));
    mockSupabase.rpc.mockResolvedValue({ data: [], error: null });
    const { stub, insert } = makeInsertStub([{ data: { id: 'page-9' }, error: null }]);

    const { result } = renderHook(() => useReviewPages('rest-1'), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    mockSupabase.from.mockReturnValue(stub);
    await result.current.createPage({
      name: 'The Counter',
      slug: 'the-counter',
      headline: 'How was everything?',
      subheadline: null,
      promoter_threshold: 4,
      destination_url: null,
    });

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        slug: 'the-counter',
        restaurant_id: 'rest-1',
        created_by: 'user-1',
      })
    );
    expect(mockToast).toHaveBeenCalledWith({ title: 'Page created' });
  });

  it('retries with a suffixed slug instead of reporting the collision', async () => {
    mockSupabase.from.mockReturnValue(makeListStub([]));
    mockSupabase.rpc.mockResolvedValue({ data: [], error: null });
    const { stub, insert } = makeInsertStub([
      { data: null, error: { message: 'duplicate key value violates unique constraint "review_pages_slug_key"' } },
      { data: { id: 'page-9' }, error: null },
    ]);

    const { result } = renderHook(() => useReviewPages('rest-1'), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    mockSupabase.from.mockReturnValue(stub);
    await result.current.createPage({
      name: 'The Counter',
      slug: 'the-counter',
      headline: 'How was everything?',
      subheadline: null,
      promoter_threshold: 4,
      destination_url: null,
    });

    expect(insert).toHaveBeenCalledTimes(2);
    const retriedSlug = insert.mock.calls[1][0].slug as string;
    expect(retriedSlug).not.toBe('the-counter');
    expect(retriedSlug).toMatch(/^the-counter-[a-z0-9]{4}$/);
    // A collision must never reach the user as "that link is taken" — a
    // per-slug answer would let anyone probe other tenants' slugs.
    expect(mockToast).not.toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'destructive' })
    );
  });

  it('gives up after the bounded retry budget rather than looping', async () => {
    mockSupabase.from.mockReturnValue(makeListStub([]));
    mockSupabase.rpc.mockResolvedValue({ data: [], error: null });
    const collision = { data: null, error: { message: 'review_pages_slug_key' } };
    const { stub, insert } = makeInsertStub(Array.from({ length: 6 }, () => ({ ...collision })));

    const { result } = renderHook(() => useReviewPages('rest-1'), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    mockSupabase.from.mockReturnValue(stub);
    await expect(
      result.current.createPage({
        name: 'The Counter',
        slug: 'the-counter',
        headline: 'How was everything?',
        subheadline: null,
        promoter_threshold: 4,
        destination_url: null,
      })
    ).rejects.toThrow(/available link/i);

    expect(insert).toHaveBeenCalledTimes(5);
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'destructive', title: 'Could not create the page' })
    );
  });

  it('rejects when a non-collision error comes back from the insert', async () => {
    mockSupabase.from.mockReturnValue(makeListStub([]));
    mockSupabase.rpc.mockResolvedValue({ data: [], error: null });
    const { stub } = makeInsertStub([{ data: null, error: { message: 'boom' } }]);

    const { result } = renderHook(() => useReviewPages('rest-1'), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    mockSupabase.from.mockReturnValue(stub);
    await expect(
      result.current.createPage({
        name: 'The Counter',
        slug: 'the-counter',
        headline: 'How was everything?',
        subheadline: null,
        promoter_threshold: 4,
        destination_url: null,
      })
    ).rejects.toMatchObject({ message: 'boom' });
  });

  it('constrains an update by restaurant_id as well as id', async () => {
    mockSupabase.from.mockReturnValue(makeListStub([]));
    mockSupabase.rpc.mockResolvedValue({ data: [], error: null });
    const { stub, update, eqId, eqRestaurant } = makeUpdateStub([{ error: null }]);

    const { result } = renderHook(() => useReviewPages('rest-1'), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    mockSupabase.from.mockReturnValue(stub);
    await result.current.updatePage({ id: 'page-1', headline: 'New headline' });

    expect(update).toHaveBeenCalledWith({ headline: 'New headline' });
    expect(eqId).toHaveBeenCalledWith('id', 'page-1');
    expect(eqRestaurant).toHaveBeenCalledWith('restaurant_id', 'rest-1');
    expect(mockToast).toHaveBeenCalledWith({ title: 'Saved' });
  });

  it('retries a slug rename that collides', async () => {
    mockSupabase.from.mockReturnValue(makeListStub([]));
    mockSupabase.rpc.mockResolvedValue({ data: [], error: null });
    const { stub, update } = makeUpdateStub([
      { error: { message: 'review_pages_slug_key' } },
      { error: null },
    ]);

    const { result } = renderHook(() => useReviewPages('rest-1'), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    mockSupabase.from.mockReturnValue(stub);
    await result.current.updatePage({ id: 'page-1', slug: 'the-counter' });

    expect(update).toHaveBeenCalledTimes(2);
    expect((update.mock.calls[1][0] as { slug: string }).slug).toMatch(/^the-counter-[a-z0-9]{4}$/);
  });

  it('refuses to mutate when no restaurant is selected', async () => {
    const { result } = renderHook(() => useReviewPages(undefined), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await expect(
      result.current.updatePage({ id: 'page-1', headline: 'x' })
    ).rejects.toThrow('No restaurant selected');
    await expect(result.current.uploadLogo('page-1', new File([''], 'a.png'))).rejects.toThrow(
      'No restaurant selected'
    );
  });

  it('uploads a logo under the restaurant/page prefix and records the path', async () => {
    mockSupabase.from.mockReturnValue(makeListStub([]));
    mockSupabase.rpc.mockResolvedValue({ data: [], error: null });
    const upload = vi.fn(async () => ({ error: null }));
    mockSupabase.storage.from.mockReturnValue({ upload });
    const { stub, update } = makeUpdateStub([{ error: null }]);

    const { result } = renderHook(() => useReviewPages('rest-1'), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    mockSupabase.from.mockReturnValue(stub);
    const file = new File(['logo'], 'Logo.PNG', { type: 'image/png' });
    const path = await result.current.uploadLogo('page-1', file);

    expect(mockSupabase.storage.from).toHaveBeenCalledWith('review-page-logos');
    expect(path).toMatch(/^rest-1\/page-1\/[0-9a-f-]{36}\.png$/);
    expect(upload).toHaveBeenCalledWith(path, file, { contentType: 'image/png', upsert: false });
    expect(update).toHaveBeenCalledWith({ logo_path: path });
  });

  it('propagates a failed logo upload without touching the page row', async () => {
    mockSupabase.from.mockReturnValue(makeListStub([]));
    mockSupabase.rpc.mockResolvedValue({ data: [], error: null });
    const upload = vi.fn(async () => ({ error: new Error('storage full') }));
    mockSupabase.storage.from.mockReturnValue({ upload });

    const { result } = renderHook(() => useReviewPages('rest-1'), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const { stub, update } = makeUpdateStub([{ error: null }]);
    mockSupabase.from.mockReturnValue(stub);

    await expect(
      result.current.uploadLogo('page-1', new File([''], 'a.png', { type: 'image/png' }))
    ).rejects.toThrow('storage full');
    expect(update).not.toHaveBeenCalled();
  });
});
