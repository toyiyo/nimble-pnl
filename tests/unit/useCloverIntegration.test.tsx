import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

import { useCloverIntegration } from '@/hooks/useCloverIntegration';
import { supabase } from '@/integrations/supabase/client';
import {
  disconnectIntegration,
  notifyIntegrationDisconnect,
  AlreadyDisconnectedError,
} from '@/lib/integrationDisconnect';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(),
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

const mockConnection = {
  id: 'conn-1',
  restaurant_id: 'rest-1',
  merchant_id: 'merchant-1',
  connected_at: '2024-01-01T00:00:00Z',
  scopes: [],
  region: 'us',
};

async function renderConnected() {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  builder.select = vi.fn(chain);
  builder.eq = vi.fn(() => Object.assign(Promise.resolve({ count: 1, error: null }), builder));
  builder.order = vi.fn(chain);
  builder.limit = vi.fn(chain);
  builder.maybeSingle = vi.fn().mockResolvedValue({ data: mockConnection, error: null });
  (supabase.from as ReturnType<typeof vi.fn>).mockReturnValue(builder);
  const hook = renderHook(() => useCloverIntegration('rest-1'));
  await waitFor(() => expect(hook.result.current.isConnected).toBe(true));
  return hook;
}

describe('useCloverIntegration disconnectClover', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (notifyIntegrationDisconnect as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  });

  it('calls the helper, resets state, and shows one success toast', async () => {
    (disconnectIntegration as ReturnType<typeof vi.fn>).mockResolvedValue('evt-1');
    const { result } = await renderConnected();

    await act(async () => {
      await result.current.disconnectClover({ reason: 'no_value', reasonText: 'x' });
    });

    expect(disconnectIntegration).toHaveBeenCalledWith({
      restaurantId: 'rest-1',
      integration: 'clover',
      reason: 'no_value',
      reasonText: 'x',
    });
    expect(notifyIntegrationDisconnect).toHaveBeenCalledWith('evt-1');
    expect(result.current.isConnected).toBe(false);
    expect(result.current.connection).toBeNull();
    expect(toastMock).toHaveBeenCalledTimes(1);
    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ title: 'Disconnected' }));
  });

  it('disconnects the restaurant named by targetId and keeps the current state', async () => {
    (disconnectIntegration as ReturnType<typeof vi.fn>).mockResolvedValue('evt-2');
    const { result } = await renderConnected();

    await act(async () => {
      await result.current.disconnectClover({ reason: 'no_value' }, 'rest-2');
    });

    expect(disconnectIntegration).toHaveBeenCalledWith({
      restaurantId: 'rest-2',
      integration: 'clover',
      reason: 'no_value',
      reasonText: null,
    });
    expect(result.current.isConnected).toBe(true);
  });

  it('rethrows the error and shows no error toast', async () => {
    (disconnectIntegration as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('boom'));
    const { result } = await renderConnected();

    await expect(result.current.disconnectClover()).rejects.toThrow('boom');

    expect(toastMock).not.toHaveBeenCalled();
    expect(notifyIntegrationDisconnect).not.toHaveBeenCalled();
    expect(result.current.isConnected).toBe(true);
  });

  it('treats AlreadyDisconnectedError as success', async () => {
    (disconnectIntegration as ReturnType<typeof vi.fn>).mockRejectedValue(
      new AlreadyDisconnectedError(),
    );
    const { result } = await renderConnected();

    await act(async () => {
      await result.current.disconnectClover();
    });

    expect(result.current.isConnected).toBe(false);
    expect(result.current.connection).toBeNull();
    expect(toastMock).toHaveBeenCalledTimes(1);
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Already disconnected' }),
    );
    expect(notifyIntegrationDisconnect).not.toHaveBeenCalled();
  });
});
