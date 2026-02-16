import React, { ReactNode } from 'react';
import { renderHook, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useNotificationPreferences } from '@/hooks/useNotificationPreferences';

const mockSupabase = vi.hoisted(() => ({
  from: vi.fn(),
}));

const mockAuth = vi.hoisted(() => ({
  user: { id: 'user-123', email: 'test@example.com' } as { id: string; email: string } | null,
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: mockSupabase,
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => mockAuth,
}));

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
};

function buildSelectChain(resolvedValue: { data: unknown; error: unknown }) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.maybeSingle = vi.fn().mockResolvedValue(resolvedValue);
  chain.upsert = vi.fn().mockResolvedValue({ error: null });
  return chain;
}

const mockPrefs = {
  id: 'pref-1',
  user_id: 'user-123',
  restaurant_id: 'rest-123',
  weekly_brief_email: true,
  brief_send_time: '06:00',
  inbox_digest_email: false,
};

describe('useNotificationPreferences', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.user = { id: 'user-123', email: 'test@example.com' };
  });

  it('returns undefined when restaurantId is undefined (query disabled)', async () => {
    const { result } = renderHook(() => useNotificationPreferences(undefined), {
      wrapper: createWrapper(),
    });
    expect(result.current.preferences).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
  });

  it('returns undefined when user is null (query disabled)', async () => {
    mockAuth.user = null;
    const { result } = renderHook(() => useNotificationPreferences('rest-123'), {
      wrapper: createWrapper(),
    });
    expect(result.current.preferences).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
  });

  it('fetches preferences for a user and restaurant', async () => {
    const chain = buildSelectChain({ data: mockPrefs, error: null });
    mockSupabase.from.mockReturnValue(chain);

    const { result } = renderHook(() => useNotificationPreferences('rest-123'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.preferences).toEqual(mockPrefs);
    expect(mockSupabase.from).toHaveBeenCalledWith('notification_preferences');
    expect(chain.eq).toHaveBeenCalledWith('user_id', 'user-123');
    expect(chain.eq).toHaveBeenCalledWith('restaurant_id', 'rest-123');
  });

  it('returns null when no preferences exist', async () => {
    const chain = buildSelectChain({ data: null, error: null });
    mockSupabase.from.mockReturnValue(chain);

    const { result } = renderHook(() => useNotificationPreferences('rest-123'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.preferences).toBeNull();
  });

  it('throws on Supabase error', async () => {
    const chain = buildSelectChain({ data: null, error: { message: 'DB error' } });
    mockSupabase.from.mockReturnValue(chain);

    const { result } = renderHook(() => useNotificationPreferences('rest-123'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    // Query error state - preferences stays undefined
    expect(result.current.preferences).toBeUndefined();
  });

  it('upserts preferences via updatePreferences', async () => {
    // First call is for the initial query, subsequent for mutation
    const selectChain = buildSelectChain({ data: mockPrefs, error: null });
    const upsertChain = {
      upsert: vi.fn().mockResolvedValue({ error: null }),
    };

    mockSupabase.from.mockImplementation(() => {
      // Return both select and upsert capabilities
      return { ...selectChain, ...upsertChain };
    });

    const { result } = renderHook(() => useNotificationPreferences('rest-123'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      result.current.updatePreferences({ weekly_brief_email: false });
    });

    await waitFor(() => expect(result.current.isUpdating).toBe(false));
    expect(upsertChain.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'user-123',
        restaurant_id: 'rest-123',
        weekly_brief_email: false,
      }),
      expect.anything(),
    );
  });

  it('updatePreferences throws when context is missing', async () => {
    mockAuth.user = null;
    const selectChain = buildSelectChain({ data: null, error: null });
    mockSupabase.from.mockReturnValue(selectChain);

    const { result } = renderHook(() => useNotificationPreferences('rest-123'), {
      wrapper: createWrapper(),
    });

    let mutationError: Error | null = null;
    await act(async () => {
      result.current.updatePreferences(
        { weekly_brief_email: true },
        {
          onError: (err: Error) => {
            mutationError = err;
          },
        },
      );
    });

    await waitFor(() => expect(result.current.isUpdating).toBe(false));
    expect(mutationError).toBeTruthy();
    expect(mutationError!.message).toBe('Missing context');
  });
});
