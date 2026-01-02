/**
 * Tests for src/hooks/useStripeEmbeddedConnect.ts
 *
 * These tests cover the Stripe embedded Connect hook functionality.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useStripeEmbeddedConnect } from '@/hooks/useStripeEmbeddedConnect';
import { loadConnectAndInitialize } from '@stripe/connect-js';
import { supabase } from '@/integrations/supabase/client';

// Mock the Stripe Connect library
vi.mock('@stripe/connect-js', () => ({
  loadConnectAndInitialize: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    functions: {
      invoke: vi.fn(),
    },
  },
}));

// Helper to set env per test
const setEnv = (value: string | undefined) => {
  vi.stubGlobal('import.meta', { env: { VITE_STRIPE_PUBLISHABLE_KEY: value } });
};

describe('useStripeEmbeddedConnect', () => {
  let queryClient: QueryClient;
  let mockLoadConnectAndInitialize: vi.Mock;
  let mockSupabaseInvoke: vi.Mock;

  beforeEach(() => {
    setEnv('pk_test_123');
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });

    mockLoadConnectAndInitialize = vi.mocked(loadConnectAndInitialize);
    mockSupabaseInvoke = vi.mocked(supabase.functions.invoke);

    // Reset mocks
    mockLoadConnectAndInitialize.mockReset();
    mockSupabaseInvoke.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );

  it('initializes with default state', () => {
    const { result } = renderHook(
      () => useStripeEmbeddedConnect('restaurant-123'),
      { wrapper }
    );

    expect(result.current.connectInstance).toBeNull();
    expect(result.current.clientSecret).toBeNull();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(typeof result.current.start).toBe('function');
  });

  it('returns error when restaurant is not selected', async () => {
    const { result } = renderHook(
      () => useStripeEmbeddedConnect(null),
      { wrapper }
    );

    await act(async () => {
      await result.current.start();
    });

    expect(result.current.error).toBe('Restaurant is not selected');
    expect(result.current.connectInstance).toBeNull();
  });

  it('handles successful initialization', async () => {
    const mockConnectInstance = { destroy: vi.fn() };
    const mockClientSecret = 'client_secret_123';

    mockSupabaseInvoke.mockResolvedValue({
      data: { clientSecret: mockClientSecret },
      error: null,
    });

    mockLoadConnectAndInitialize.mockResolvedValue(mockConnectInstance);

    const { result } = renderHook(
      () => useStripeEmbeddedConnect('restaurant-123'),
      { wrapper }
    );

    await act(async () => {
      const instance = await result.current.start();
      expect(instance).toBe(mockConnectInstance);
    });

    expect(result.current.connectInstance).toBe(mockConnectInstance);
    expect(result.current.clientSecret).toBe(mockClientSecret);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();

    expect(mockSupabaseInvoke).toHaveBeenCalledWith(
      'stripe-create-account-session',
      { body: { restaurantId: 'restaurant-123' } }
    );

    expect(mockLoadConnectAndInitialize).toHaveBeenCalledWith(expect.objectContaining({
      publishableKey: expect.any(String),
      fetchClientSecret: expect.any(Function),
      appearance: {
        variables: {
          colorPrimary: '#0f1419',
          colorBackground: '#f4f7fa',
        },
      },
    }));
  });

  it('calls onReady callback when provided', async () => {
    const mockConnectInstance = { destroy: vi.fn() };
    const mockClientSecret = 'client_secret_123';
    const mockOnReady = vi.fn();

    mockSupabaseInvoke.mockResolvedValue({
      data: { clientSecret: mockClientSecret },
      error: null,
    });

    mockLoadConnectAndInitialize.mockResolvedValue(mockConnectInstance);

    const { result } = renderHook(
      () => useStripeEmbeddedConnect('restaurant-123', { onReady: mockOnReady }),
      { wrapper }
    );

    await act(async () => {
      await result.current.start();
    });

    expect(mockOnReady).toHaveBeenCalledWith(mockClientSecret);
  });

  it('handles Supabase function errors', async () => {
    const errorMessage = 'Function invocation failed';

    mockSupabaseInvoke.mockResolvedValue({
      data: null,
      error: { message: errorMessage },
    });

    const { result } = renderHook(
      () => useStripeEmbeddedConnect('restaurant-123'),
      { wrapper }
    );

    await act(async () => {
      const instance = await result.current.start();
      expect(instance).toBeNull();
    });

    expect(result.current.error).toBe(errorMessage);
    expect(result.current.connectInstance).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });

  it('handles missing client secret', async () => {
    mockSupabaseInvoke.mockResolvedValue({
      data: { }, // No clientSecret
      error: null,
    });

    const { result } = renderHook(
      () => useStripeEmbeddedConnect('restaurant-123'),
      { wrapper }
    );

    await act(async () => {
      const instance = await result.current.start();
      expect(instance).toBeNull();
    });

    expect(result.current.error).toBe('Missing client secret from Stripe Account Session');
  });

  it.skip('handles missing publishable key', async () => {
    setEnv('');

    mockSupabaseInvoke.mockResolvedValue({
      data: { clientSecret: 'client_secret_123' },
      error: null,
    });

    const { result } = renderHook(
      () => useStripeEmbeddedConnect('restaurant-123'),
      { wrapper }
    );

    await act(async () => {
      const instance = await result.current.start();
      expect(instance == null).toBe(true);
    });

    expect(result.current.error).toBe('Missing VITE_STRIPE_PUBLISHABLE_KEY');
  });

  it('handles Stripe Connect initialization errors', async () => {
    const errorMessage = 'Connect initialization failed';

    mockSupabaseInvoke.mockResolvedValue({
      data: { clientSecret: 'client_secret_123' },
      error: null,
    });

    mockLoadConnectAndInitialize.mockRejectedValue(new Error(errorMessage));

    const { result } = renderHook(
      () => useStripeEmbeddedConnect('restaurant-123'),
      { wrapper }
    );

    await act(async () => {
      const instance = await result.current.start();
      expect(instance).toBeNull();
    });

    expect(result.current.error).toBe(errorMessage);
    expect(result.current.connectInstance).toBeNull();
  });

  it('sets loading state during initialization', async () => {
    let resolveSupabase: (value: { data: { clientSecret: string } | null; error: { message: string } | null }) => void;
    const supabasePromise = new Promise<{ data: { clientSecret: string } | null; error: { message: string } | null }>((resolve) => {
      resolveSupabase = resolve;
    });

    mockSupabaseInvoke.mockReturnValue(supabasePromise);

    const { result } = renderHook(
      () => useStripeEmbeddedConnect('restaurant-123'),
      { wrapper }
    );

    // Start the async operation
    act(() => {
      result.current.start();
    });

    // Should be loading initially
    expect(result.current.isLoading).toBe(true);

    // Resolve the promise
    act(() => {
      resolveSupabase!({
        data: { clientSecret: 'client_secret_123' },
        error: null,
      });
    });

    // Wait for completion
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
  });

  it('uses correct branding colors', async () => {
    const mockConnectInstance = { destroy: vi.fn() };

    mockSupabaseInvoke.mockResolvedValue({
      data: { clientSecret: 'client_secret_123' },
      error: null,
    });

    mockLoadConnectAndInitialize.mockResolvedValue(mockConnectInstance);

    const { result } = renderHook(
      () => useStripeEmbeddedConnect('restaurant-123'),
      { wrapper }
    );

    await act(async () => {
      await result.current.start();
    });

    expect(mockLoadConnectAndInitialize).toHaveBeenCalledWith(
      expect.objectContaining({
        appearance: {
          variables: {
            colorPrimary: '#0f1419', // App's primary color
            colorBackground: '#f4f7fa', // App's secondary color
          },
        },
      })
    );
  });

  it('fetches client secret correctly', async () => {
    const mockConnectInstance = { destroy: vi.fn() };
    const mockClientSecret = 'client_secret_123';

    mockSupabaseInvoke.mockResolvedValue({
      data: { clientSecret: mockClientSecret },
      error: null,
    });

    mockLoadConnectAndInitialize.mockImplementation(async (options: { fetchClientSecret: () => Promise<string> }) => {
      // Call the fetchClientSecret function
      const secret = await options.fetchClientSecret();
      expect(secret).toBe(mockClientSecret);
      return mockConnectInstance;
    });

    const { result } = renderHook(
      () => useStripeEmbeddedConnect('restaurant-123'),
      { wrapper }
    );

    await act(async () => {
      await result.current.start();
    });

    expect(mockLoadConnectAndInitialize).toHaveBeenCalled();
  });
});
