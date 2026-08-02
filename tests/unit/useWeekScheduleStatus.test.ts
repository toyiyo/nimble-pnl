import React, { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockSupabase = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  functions: { invoke: vi.fn() },
}));

vi.mock('@/integrations/supabase/client', () => ({ supabase: mockSupabase }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

import { useWeekScheduleStatus } from '@/hooks/useSchedulePublish';

const WEEK_START = new Date(2026, 7, 3); // Mon 2026-08-03, TZ-portable

/** Postgrest-style chainable builder terminating in maybeSingle(). */
function makeBuilder(result: { data?: unknown; error?: unknown }) {
  const builder: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'order', 'limit']) {
    builder[m] = vi.fn(() => builder);
  }
  builder.maybeSingle = vi.fn(() => Promise.resolve(result));
  return builder;
}

function publicationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pub-1',
    restaurant_id: 'r1',
    week_start_date: '2026-08-03',
    week_end_date: '2026-08-09',
    published_at: '2026-08-01T15:00:00Z',
    notification_sent: true,
    ...overrides,
  };
}

function shifts(published: number, draft: number) {
  return [
    ...Array.from({ length: published }, () => ({ is_published: true })),
    ...Array.from({ length: draft }, () => ({ is_published: false })),
  ];
}

function createWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return React.createElement(QueryClientProvider, { client }, children);
  };
}

function renderStatus(result: { data?: unknown; error?: unknown }, weekShifts: { is_published: boolean }[]) {
  const builder = makeBuilder(result);
  mockSupabase.from.mockReturnValue(builder);
  const rendered = renderHook(() => useWeekScheduleStatus('r1', WEEK_START, weekShifts), {
    wrapper: createWrapper(),
  });
  return { ...rendered, builder };
}

describe('useWeekScheduleStatus', () => {
  beforeEach(() => {
    mockSupabase.from.mockReset();
  });

  it('reports not_published when the week was never announced', async () => {
    const { result } = renderStatus({ data: null, error: null }, shifts(0, 6));

    await waitFor(() => expect(result.current.loading).toBe(false));

    // Six drafts on the grid and still "not published" -- a draft-only week is
    // exactly the case employees were reading as their schedule.
    expect(result.current.state).toBe('not_published');
    expect(result.current.draftCount).toBe(6);
    expect(result.current.publication).toBeNull();
  });

  it('reports published when every shift this employee has is locked in', async () => {
    const { result } = renderStatus({ data: publicationRow(), error: null }, shifts(4, 0));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.state).toBe('published');
    expect(result.current.publishedCount).toBe(4);
    expect(result.current.publication?.id).toBe('pub-1');
  });

  it('reports published_revising when confirmed shifts sit next to unconfirmed ones', async () => {
    const { result } = renderStatus({ data: publicationRow(), error: null }, shifts(3, 2));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.state).toBe('published_revising');
    expect(result.current.publishedCount).toBe(3);
    expect(result.current.draftCount).toBe(2);
  });

  it('reports retracted for the incident: announced week, now zero published shifts', async () => {
    // The Aug 3-9 case exactly -- 63 shifts unpublished after the week had
    // already been announced. useWeekPublicationStatus returns null here, which
    // is indistinguishable from a week nobody ever published.
    const { result } = renderStatus(
      { data: publicationRow({ notification_sent: true }), error: null },
      shifts(0, 5),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.state).toBe('retracted');
    expect(result.current.publishedCount).toBe(0);
    expect(result.current.draftCount).toBe(5);
    expect(result.current.publication?.notification_sent).toBe(true);
  });

  it('does not cry retraction at an employee who simply has no shifts this week', async () => {
    const { result } = renderStatus({ data: publicationRow(), error: null }, []);

    await waitFor(() => expect(result.current.loading).toBe(false));

    // Unpublishing flips shifts to draft, it never deletes them, so zero shifts
    // of any kind is "not on the roster", not "pulled back". Reading it as a
    // retraction would tell every part-timer their schedule was withdrawn on
    // every week they have off.
    expect(result.current.state).toBe('published');
  });

  it('withholds a state rather than guessing when the lookup fails', async () => {
    const { result } = renderStatus({ data: null, error: { message: 'boom' } }, shifts(2, 1));

    await waitFor(() => expect(result.current.error).toBeTruthy());

    // A wrong banner is worse than no banner: claiming "not published" over a
    // week that is in fact published would tell people to ignore real shifts.
    expect(result.current.state).toBeNull();
    // The counts still come from shifts the caller already holds, so the grid
    // does not degrade just because this query did.
    expect(result.current.publishedCount).toBe(2);
    expect(result.current.draftCount).toBe(1);
  });

  it('withholds a state while the lookup is still in flight', () => {
    const { result } = renderStatus({ data: publicationRow(), error: null }, shifts(2, 0));

    expect(result.current.loading).toBe(true);
    expect(result.current.state).toBeNull();
  });

  it('looks up by week_start_date alone, newest publication first', async () => {
    const { result, builder } = renderStatus({ data: publicationRow(), error: null }, shifts(1, 0));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(mockSupabase.from).toHaveBeenCalledWith('schedule_publications');
    expect(builder.eq).toHaveBeenCalledWith('week_start_date', '2026-08-03');
    // A republished week has several rows; the stale one must not win.
    expect(builder.order).toHaveBeenCalledWith('published_at', { ascending: false });
  });
});
