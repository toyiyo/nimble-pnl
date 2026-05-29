import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ---------------------------------------------------------------------------
// Mocks — must be hoisted before any imports that use them
// ---------------------------------------------------------------------------

const upsertMock = vi.hoisted(() => vi.fn());

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: () => ({
      upsert: upsertMock,
    }),
  },
}));

const toastMock = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: toastMock }) }));

// ---------------------------------------------------------------------------
// Import after mocks are set up
// ---------------------------------------------------------------------------

import { useApplySuggestedShifts } from '@/hooks/useApplySuggestedShifts';
import type { TemplateInsert } from '@/lib/staffingApply';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

const makeRow = (overrides: Partial<TemplateInsert> = {}): TemplateInsert => ({
  restaurant_id: 'r1',
  name: 'Suggested · Server 17:00-22:00',
  days: [5],
  start_time: '17:00:00',
  end_time: '22:00:00',
  break_duration: 0,
  position: 'Server',
  capacity: 2,
  is_active: true,
  ...overrides,
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useApplySuggestedShifts', () => {
  beforeEach(() => {
    upsertMock.mockReset();
    toastMock.mockReset();
  });

  it('upserts rows and returns created/skipped counts', async () => {
    // upsert returns one row -> created=1, skipped=0
    upsertMock.mockReturnValue({
      select: () => Promise.resolve({ data: [{ id: 'uuid-1' }], error: null }),
    });

    const { result } = renderHook(() => useApplySuggestedShifts('r1'), {
      wrapper: createWrapper(),
    });

    let res: { created: number; skipped: number } | undefined;
    await act(async () => {
      res = await result.current.applyShifts([makeRow()]);
    });

    expect(upsertMock).toHaveBeenCalledOnce();
    expect(res).toEqual({ created: 1, skipped: 0 });
  });

  it('reports skipped when ON CONFLICT drops a row', async () => {
    // upsert returns no rows (all conflicted) -> created=0, skipped=1
    upsertMock.mockReturnValue({
      select: () => Promise.resolve({ data: [], error: null }),
    });

    const { result } = renderHook(() => useApplySuggestedShifts('r1'), {
      wrapper: createWrapper(),
    });

    let res: { created: number; skipped: number } | undefined;
    await act(async () => {
      res = await result.current.applyShifts([makeRow()]);
    });

    expect(res).toEqual({ created: 0, skipped: 1 });
  });

  it('calls upsert in chunks of 200 for large inputs', async () => {
    // Every chunk returns all rows as created
    upsertMock.mockReturnValue({
      select: (fields: string) => {
        void fields;
        return Promise.resolve({ data: Array(200).fill({ id: 'x' }), error: null });
      },
    });

    const rows = Array.from({ length: 201 }, (_, i) => makeRow({ name: `row-${i}` }));

    const { result } = renderHook(() => useApplySuggestedShifts('r1'), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.applyShifts(rows);
    });

    // 201 rows / 200 chunk size → 2 calls
    expect(upsertMock).toHaveBeenCalledTimes(2);
  });

  it('fires a success toast with created + skipped counts', async () => {
    upsertMock.mockReturnValue({
      select: () => Promise.resolve({ data: [{ id: 'a' }, { id: 'b' }], error: null }),
    });

    const { result } = renderHook(() => useApplySuggestedShifts('r1'), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.applyShifts([makeRow(), makeRow({ name: 'row2' })]);
    });

    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: '2 open shifts created' }),
    );
  });

  it('fires a destructive toast on upsert error', async () => {
    const dbError = new Error('duplicate key value violates unique constraint');
    upsertMock.mockReturnValue({
      select: () => Promise.resolve({ data: null, error: dbError }),
    });

    const { result } = renderHook(() => useApplySuggestedShifts('r1'), {
      wrapper: createWrapper(),
    });

    // mutateAsync rejects; the onError callback also fires in the same flush
    await act(async () => {
      await result.current.applyShifts([makeRow()]).catch(() => {});
    });

    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'destructive' }),
    );
  });

  it('isApplying is false before and after the mutation', async () => {
    upsertMock.mockReturnValue({
      select: () => Promise.resolve({ data: [{ id: 'x' }], error: null }),
    });

    const { result } = renderHook(() => useApplySuggestedShifts('r1'), {
      wrapper: createWrapper(),
    });

    expect(result.current.isApplying).toBe(false);

    await act(async () => {
      await result.current.applyShifts([makeRow()]);
    });

    expect(result.current.isApplying).toBe(false);
  });
});
