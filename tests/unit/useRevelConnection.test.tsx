import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useRevelConnection } from '@/hooks/useRevelConnection';
import { supabase } from '@/integrations/supabase/client';
import {
  disconnectIntegration,
  notifyIntegrationDisconnect,
  AlreadyDisconnectedError,
} from '@/lib/integrationDisconnect';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(),
    rpc: vi.fn(),
    functions: { invoke: vi.fn() },
  },
}));

const toastMock = vi.fn();
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: toastMock }),
}));

vi.mock('@/lib/integrationDisconnect', async () => {
  const actual = await vi.importActual<typeof import('@/lib/integrationDisconnect')>(
    '@/lib/integrationDisconnect',
  );
  return {
    ...actual,
    disconnectIntegration: vi.fn(),
    notifyIntegrationDisconnect: vi.fn(),
  };
});

describe('useRevelConnection disconnect', () => {
  let queryClient: QueryClient;

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.clearAllMocks();
    (supabase.from as ReturnType<typeof vi.fn>).mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }),
      }),
    });
  });

  it('disconnectRevel calls the helper, invalidates, toasts once, and notifies without await', async () => {
    vi.mocked(disconnectIntegration).mockResolvedValue('evt-1');
    let notifyResolve: () => void = () => {};
    vi.mocked(notifyIntegrationDisconnect).mockImplementation(
      () => new Promise<void>((r) => { notifyResolve = r; }),
    );
    const spy = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useRevelConnection('rest-1'), { wrapper });

    await act(async () => {
      await result.current.disconnectRevel('rest-1', { reason: 'no_value', reasonText: 'x' });
    });

    expect(disconnectIntegration).toHaveBeenCalledWith({
      restaurantId: 'rest-1',
      integration: 'revel',
      reason: 'no_value',
      reasonText: 'x',
    });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['revel-connection', 'rest-1'] });
    expect(notifyIntegrationDisconnect).toHaveBeenCalledWith('evt-1');
    expect(toastMock).toHaveBeenCalledTimes(1);
    expect(toastMock.mock.calls[0][0].variant).toBeUndefined();
    notifyResolve();
  });

  it('disconnectRevel rethrows and shows no error toast', async () => {
    vi.mocked(disconnectIntegration).mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useRevelConnection('rest-1'), { wrapper });

    await act(async () => {
      await expect(result.current.disconnectRevel('rest-1')).rejects.toThrow('boom');
    });
    expect(toastMock).not.toHaveBeenCalled();
    expect(notifyIntegrationDisconnect).not.toHaveBeenCalled();
  });

  it('disconnectRevel treats AlreadyDisconnectedError as success', async () => {
    vi.mocked(disconnectIntegration).mockRejectedValue(new AlreadyDisconnectedError());
    const spy = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useRevelConnection('rest-1'), { wrapper });

    await act(async () => {
      await result.current.disconnectRevel('rest-1');
    });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['revel-connection', 'rest-1'] });
    expect(toastMock).toHaveBeenCalledTimes(1);
    expect(toastMock.mock.calls[0][0].title).toBe('Already disconnected');
    expect(notifyIntegrationDisconnect).not.toHaveBeenCalled();
  });

  it('rollbackRevelConnection does the direct UPDATE, no toast, no RPC', async () => {
    const eq = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn().mockReturnValue({ eq });
    (supabase.from as ReturnType<typeof vi.fn>).mockReturnValue({
      update,
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }),
      }),
    });
    const spy = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useRevelConnection('rest-1'), { wrapper });

    await act(async () => {
      await result.current.rollbackRevelConnection('rest-1');
    });

    expect(supabase.from).toHaveBeenCalledWith('revel_connections');
    expect(update).toHaveBeenCalledWith({ is_active: false });
    expect(eq).toHaveBeenCalledWith('restaurant_id', 'rest-1');
    expect(spy).toHaveBeenCalledWith({ queryKey: ['revel-connection', 'rest-1'] });
    expect(toastMock).not.toHaveBeenCalled();
    expect(supabase.rpc).not.toHaveBeenCalled();
    expect(disconnectIntegration).not.toHaveBeenCalled();
  });
});
