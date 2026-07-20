import React, { ReactNode } from 'react';
import { renderHook, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useNotificationChannelSettings } from '@/hooks/useNotificationChannelSettings';
import { NOTIFICATION_TYPES } from '@/lib/notificationTypes';

const mockSupabase = vi.hoisted(() => ({
  from: vi.fn(),
}));

const mockToast = vi.hoisted(() => vi.fn());

vi.mock('@/integrations/supabase/client', () => ({
  supabase: mockSupabase,
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: mockToast }),
}));

function buildSelectChain(resolvedValue: { data: unknown; error: unknown }) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockResolvedValue(resolvedValue);
  return chain;
}

/** A `supabase.from()` return that answers both the initial `.select().eq()`
 *  read and any `.upsert()` write, so a single `mockReturnValue` covers a
 *  render that loads settings and then flips a toggle. */
function buildReadWriteChain(
  read: { data: unknown; error: unknown },
  upsertMock: ReturnType<typeof vi.fn>,
) {
  return { ...buildSelectChain(read), upsert: upsertMock };
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

describe('useNotificationChannelSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('merges an empty row set into a default-ON map for all catalog types', async () => {
    mockSupabase.from.mockReturnValue(buildSelectChain({ data: [], error: null }));

    const { result } = renderHook(() => useNotificationChannelSettings('rest-1'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.settings.size).toBe(NOTIFICATION_TYPES.length);
    for (const type of NOTIFICATION_TYPES) {
      expect(result.current.settings.get(type.key)).toEqual({ email: true, push: true });
    }
  });

  it('overrides only the types present in the fetched rows, defaults elsewhere', async () => {
    mockSupabase.from.mockReturnValue(
      buildSelectChain({
        data: [
          { id: 'row-1', notification_type: 'shift_deleted', email_enabled: false, push_enabled: true },
          { id: 'row-2', notification_type: 'pin_reset', email_enabled: true, push_enabled: false },
        ],
        error: null,
      }),
    );

    const { result } = renderHook(() => useNotificationChannelSettings('rest-1'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.settings.get('shift_deleted')).toEqual({ email: false, push: true });
    expect(result.current.settings.get('pin_reset')).toEqual({ email: true, push: false });
    // Untouched type stays at the default-ON baseline.
    expect(result.current.settings.get('schedule_published')).toEqual({ email: true, push: true });
  });

  it('exposes a query error instead of silently falling back to all-ON (never a silent fail-open UI state)', async () => {
    mockSupabase.from.mockReturnValue(
      buildSelectChain({ data: null, error: { message: 'DB down' } }),
    );

    const { result } = renderHook(() => useNotificationChannelSettings('rest-1'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.isError).toBe(true);
  });

  it('setChannel upserts the full row for that one type, flipping only the touched channel', async () => {
    const upsertMock = vi.fn().mockResolvedValue({ error: null });
    mockSupabase.from.mockReturnValue(buildReadWriteChain({ data: [], error: null }, upsertMock));

    const { result } = renderHook(() => useNotificationChannelSettings('rest-1'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      result.current.setChannel('shift_deleted', 'email', false);
    });

    await waitFor(() => expect(upsertMock).toHaveBeenCalledTimes(1));
    // The untouched `push` channel keeps its current (default-ON) value.
    expect(upsertMock).toHaveBeenCalledWith(
      {
        restaurant_id: 'rest-1',
        notification_type: 'shift_deleted',
        email_enabled: false,
        push_enabled: true,
      },
      { onConflict: 'restaurant_id,notification_type' },
    );
  });

  it('setChannel updates the cache optimistically so the toggle reflects instantly (before the write resolves)', async () => {
    // A never-resolving upsert: the optimistic cache update must be visible
    // without waiting on the network round-trip.
    const upsertMock = vi.fn().mockReturnValue(new Promise(() => {}));
    mockSupabase.from.mockReturnValue(buildReadWriteChain({ data: [], error: null }, upsertMock));

    const { result } = renderHook(() => useNotificationChannelSettings('rest-1'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.settings.get('pin_reset')).toEqual({ email: true, push: true });

    act(() => {
      result.current.setChannel('pin_reset', 'push', false);
    });

    await waitFor(() =>
      expect(result.current.settings.get('pin_reset')).toEqual({ email: true, push: false }),
    );
  });

  it('a failed setChannel rolls the cache back to its prior value and reports via toast', async () => {
    const upsertMock = vi.fn().mockResolvedValue({ error: { message: 'write failed' } });
    mockSupabase.from.mockReturnValue(buildReadWriteChain({ data: [], error: null }, upsertMock));

    const { result } = renderHook(() => useNotificationChannelSettings('rest-1'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      result.current.setChannel('pin_reset', 'email', false);
    });

    await waitFor(() => expect(mockToast).toHaveBeenCalled());
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'destructive' }),
    );
    // Rolled back to the pre-toggle default-ON value (no silent phantom change).
    await waitFor(() =>
      expect(result.current.settings.get('pin_reset')).toEqual({ email: true, push: true }),
    );
  });
});
