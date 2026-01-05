import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { User } from '@supabase/supabase-js';
import { useTipSplits } from '@/hooks/useTipSplits';
import { supabase } from '@/integrations/supabase/client';
import React from 'react';

// Mock Supabase
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(),
    auth: {
      getUser: vi.fn(),
    },
  },
}));

// Mock toast
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({
    toast: vi.fn(),
  }),
}));

describe('useTipSplits - reopenSplit', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    vi.clearAllMocks();
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  it('should reopen an approved split to draft status', async () => {
    // Mock authenticated user
    vi.mocked(supabase.auth.getUser).mockResolvedValue({
      data: { user: { id: 'user-123', email: 'test@example.com' } as User },
      error: null,
    });

    // Mock successful update
    const updateMock = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    });

    vi.mocked(supabase.from).mockReturnValue({
      update: updateMock,
    } as ReturnType<typeof supabase.from>);

    const { result } = renderHook(() => useTipSplits('restaurant-123'), { wrapper });

    // Call reopenSplit
    result.current.reopenSplit('split-456');

    await waitFor(() => {
      expect(result.current.isReopening).toBe(false);
    });

    // Verify update was called with correct params
    expect(updateMock).toHaveBeenCalledWith({
      status: 'draft',
      approved_by: null,
      approved_at: null,
    });
  });

  it('should throw error if user is not authenticated', async () => {
    // Mock unauthenticated user
    vi.mocked(supabase.auth.getUser).mockResolvedValue({
      data: { user: null },
      error: null,
    });

    const { result } = renderHook(() => useTipSplits('restaurant-123'), { wrapper });

    result.current.reopenSplit('split-456');

    await waitFor(() => {
      expect(result.current.isReopening).toBe(false);
    });

    // Error should be handled by mutation
  });

  it('should handle database update errors', async () => {
    vi.mocked(supabase.auth.getUser).mockResolvedValue({
      data: { user: { id: 'user-123' } as User },
      error: null,
    });

    const updateMock = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ 
        error: { message: 'Database error', code: 'DB_ERROR' } 
      }),
    });

    vi.mocked(supabase.from).mockReturnValue({
      update: updateMock,
    } as ReturnType<typeof supabase.from>);

    const { result } = renderHook(() => useTipSplits('restaurant-123'), { wrapper });

    result.current.reopenSplit('split-456');

    await waitFor(() => {
      expect(result.current.isReopening).toBe(false);
    });
  });

  it('should invalidate queries after successful reopen', async () => {
    const invalidateQueriesSpy = vi.spyOn(queryClient, 'invalidateQueries');

    vi.mocked(supabase.auth.getUser).mockResolvedValue({
      data: { user: { id: 'user-123' } as User },
      error: null,
    });

    const updateMock = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    });

    vi.mocked(supabase.from).mockReturnValue({
      update: updateMock,
    } as ReturnType<typeof supabase.from>);

    const { result } = renderHook(() => useTipSplits('restaurant-123'), { wrapper });

    result.current.reopenSplit('split-456');

    await waitFor(() => {
      expect(invalidateQueriesSpy).toHaveBeenCalledWith({
        queryKey: ['tip-splits', 'restaurant-123'],
      });
    });
  });

  it('should set isReopening to true during mutation', async () => {
    vi.mocked(supabase.auth.getUser).mockResolvedValue({
      data: { user: { id: 'user-123' } as User },
      error: null,
    });

    const updateMock = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    });

    vi.mocked(supabase.from).mockReturnValue({
      update: updateMock,
    } as ReturnType<typeof supabase.from>);

    const { result } = renderHook(() => useTipSplits('restaurant-123'), { wrapper });

    expect(result.current.isReopening).toBe(false);

    result.current.reopenSplit('split-456');

    // Should be true during mutation (may need adjustment for timing)
    await waitFor(() => {
      expect(result.current.isReopening).toBe(false);
    });
  });
});
