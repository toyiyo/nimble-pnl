/**
 * Unit Tests: useWebPushSubscription hook + pure helpers
 *
 * Tests:
 * - Pure helper functions (isWebPushSupported, shouldShowBanner)
 * - renderHook tests for the React hook with browser API mocking
 * - subscribe / unsubscribe / dismiss flows
 * - Backend failure rollback
 */

import React, { ReactNode } from 'react';
import { renderHook, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ── Hoisted mocks ──────────────────────────────────────────────────
const mockSupabaseFunctions = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

const mockSupabase = vi.hoisted(() => ({
  functions: mockSupabaseFunctions,
}));

const mockUser = vi.hoisted(() => ({
  current: { id: 'test-user', email: 'test@example.com' } as { id: string; email: string } | null,
}));

const mockRestaurant = vi.hoisted(() => ({
  current: { restaurant_id: 'test-restaurant' } as { restaurant_id: string } | null,
}));

// ── Module mocks ───────────────────────────────────────────────────
vi.mock('@/integrations/supabase/client', () => ({
  supabase: mockSupabase,
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: mockUser.current }),
}));

vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => ({ selectedRestaurant: mockRestaurant.current }),
}));

// ── Browser API mock helpers ───────────────────────────────────────
const mockUnsubscribe = vi.fn().mockResolvedValue(true);

const mockSubscription = {
  endpoint: 'https://push.example.com/sub/abc123',
  unsubscribe: mockUnsubscribe,
  toJSON: () => ({
    endpoint: 'https://push.example.com/sub/abc123',
    keys: { p256dh: 'test-p256dh', auth: 'test-auth' },
  }),
};

const mockPushManager = {
  getSubscription: vi.fn().mockResolvedValue(null),
  subscribe: vi.fn().mockResolvedValue(mockSubscription),
};

const mockRegistration = {
  pushManager: mockPushManager,
};

/** Install browser mocks (PushManager, Notification, serviceWorker) */
function setupBrowserMocks() {
  Object.defineProperty(window, 'PushManager', {
    value: class PushManager {},
    writable: true,
    configurable: true,
  });

  Object.defineProperty(window, 'Notification', {
    value: {
      permission: 'default' as NotificationPermission,
      requestPermission: vi.fn().mockResolvedValue('granted'),
    },
    writable: true,
    configurable: true,
  });

  const swReady = Promise.resolve(mockRegistration);
  Object.defineProperty(navigator, 'serviceWorker', {
    value: {
      ready: swReady,
      register: vi.fn().mockResolvedValue(mockRegistration),
    },
    writable: true,
    configurable: true,
  });
}

function removeBrowserMocks() {
  // @ts-expect-error - cleaning up test mock
  delete window.PushManager;
  // @ts-expect-error - cleaning up test mock
  delete navigator.serviceWorker;
}

// Set up browser mocks BEFORE importing the hook module, because
// isWebPushSupported() is evaluated at useState init time.
setupBrowserMocks();

// Stub the VAPID key env var before the module reads it
vi.stubEnv('VITE_VAPID_PUBLIC_KEY', 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkGs-GDq6QAK8JF8galcZ2rcQ4A50NZ1-8Mbz2sLiQ');

// Static import — coverage instrumentation works correctly
import {
  useWebPushSubscription,
  isWebPushSupported,
  shouldShowBanner,
} from '@/hooks/useWebPushSubscription';

// ── Wrapper ────────────────────────────────────────────────────────
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

// ── Pure helper function tests ─────────────────────────────────────
describe('isWebPushSupported (exported)', () => {
  it('returns true when browser mocks are active', () => {
    // With our mocks set up, it should be true
    expect(isWebPushSupported()).toBe(true);
  });

  it('returns false when PushManager is removed', () => {
    const saved = window.PushManager;
    // @ts-expect-error - temporarily removing for test
    delete window.PushManager;
    expect(isWebPushSupported()).toBe(false);
    Object.defineProperty(window, 'PushManager', {
      value: saved,
      writable: true,
      configurable: true,
    });
  });
});

describe('shouldShowBanner (exported)', () => {
  it('shows banner when supported, default permission, not subscribed, not dismissed', () => {
    expect(shouldShowBanner(true, 'default', false, null)).toBe(true);
  });

  it('shows banner when permission is granted but not yet subscribed', () => {
    expect(shouldShowBanner(true, 'granted', false, null)).toBe(true);
  });

  it('hides banner when not supported', () => {
    expect(shouldShowBanner(false, 'default', false, null)).toBe(false);
  });

  it('hides banner when permission is denied', () => {
    expect(shouldShowBanner(true, 'denied', false, null)).toBe(false);
  });

  it('hides banner when already subscribed', () => {
    expect(shouldShowBanner(true, 'default', true, null)).toBe(false);
  });

  it('hides banner when dismissed less than 30 days ago', () => {
    const tenDaysAgo = Date.now() - 10 * 24 * 60 * 60 * 1000;
    expect(shouldShowBanner(true, 'default', false, tenDaysAgo)).toBe(false);
  });

  it('shows banner when dismissed more than 30 days ago', () => {
    const fortyDaysAgo = Date.now() - 40 * 24 * 60 * 60 * 1000;
    expect(shouldShowBanner(true, 'default', false, fortyDaysAgo)).toBe(true);
  });
});

// ── Hook renderHook tests ──────────────────────────────────────────
describe('useWebPushSubscription hook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockUser.current = { id: 'test-user', email: 'test@example.com' };
    mockRestaurant.current = { restaurant_id: 'test-restaurant' };
    mockPushManager.getSubscription.mockResolvedValue(null);
    mockPushManager.subscribe.mockResolvedValue(mockSubscription);
    mockUnsubscribe.mockResolvedValue(true);
    mockSupabaseFunctions.invoke.mockResolvedValue({ data: {}, error: null });

    // Ensure browser mocks are active
    setupBrowserMocks();
  });

  afterEach(() => {
    // Leave browser mocks active since module is already loaded
    // Only clean up test-specific overrides
  });

  it('returns correct initial state with browser support', async () => {
    const { result } = renderHook(() => useWebPushSubscription(), {
      wrapper: createWrapper(),
    });

    expect(result.current.isSupported).toBe(true);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.permission).toBe('default');
    expect(result.current.shouldShowBanner).toBe(true);

    await waitFor(() => {
      expect(result.current.isSubscribed).toBe(false);
    });
  });

  it('detects existing subscription on mount', async () => {
    mockPushManager.getSubscription.mockResolvedValue(mockSubscription);

    const { result } = renderHook(() => useWebPushSubscription(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isSubscribed).toBe(true);
    });
    expect(result.current.shouldShowBanner).toBe(false);
  });

  it('subscribe() requests permission and registers push subscription', async () => {
    const { result } = renderHook(() => useWebPushSubscription(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isSubscribed).toBe(false);
    });

    await act(async () => {
      await result.current.subscribe();
    });

    expect(window.Notification.requestPermission).toHaveBeenCalled();

    expect(mockPushManager.subscribe).toHaveBeenCalledWith({
      userVisibleOnly: true,
      applicationServerKey: expect.any(Uint8Array),
    });

    expect(mockSupabaseFunctions.invoke).toHaveBeenCalledWith(
      'manage-web-push-subscription',
      {
        method: 'POST',
        body: {
          endpoint: 'https://push.example.com/sub/abc123',
          keys: { p256dh: 'test-p256dh', auth: 'test-auth' },
          restaurant_id: 'test-restaurant',
        },
      }
    );

    expect(result.current.isSubscribed).toBe(true);
  });

  it('subscribe() does nothing when permission is denied', async () => {
    (window.Notification.requestPermission as ReturnType<typeof vi.fn>).mockResolvedValue('denied');

    const { result } = renderHook(() => useWebPushSubscription(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isSubscribed).toBe(false);
    });

    await act(async () => {
      await result.current.subscribe();
    });

    expect(mockPushManager.subscribe).not.toHaveBeenCalled();
    expect(result.current.isSubscribed).toBe(false);
  });

  it('subscribe() rolls back browser subscription on backend failure', async () => {
    mockSupabaseFunctions.invoke.mockResolvedValue({
      data: null,
      error: new Error('Backend error'),
    });

    const { result } = renderHook(() => useWebPushSubscription(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isSubscribed).toBe(false);
    });

    await act(async () => {
      await result.current.subscribe();
    });

    expect(mockUnsubscribe).toHaveBeenCalled();
    expect(result.current.isSubscribed).toBe(false);
  });

  it('unsubscribe() calls subscription.unsubscribe and backend DELETE', async () => {
    mockPushManager.getSubscription.mockResolvedValue(mockSubscription);

    const { result } = renderHook(() => useWebPushSubscription(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isSubscribed).toBe(true);
    });

    await act(async () => {
      await result.current.unsubscribe();
    });

    expect(mockUnsubscribe).toHaveBeenCalled();

    expect(mockSupabaseFunctions.invoke).toHaveBeenCalledWith(
      'manage-web-push-subscription',
      {
        method: 'DELETE',
        body: { endpoint: 'https://push.example.com/sub/abc123' },
      }
    );

    expect(result.current.isSubscribed).toBe(false);
  });

  it('dismiss() writes timestamp to localStorage', async () => {
    const { result } = renderHook(() => useWebPushSubscription(), {
      wrapper: createWrapper(),
    });

    const beforeDismiss = Date.now();
    act(() => {
      result.current.dismiss();
    });

    const stored = localStorage.getItem('push_banner_dismissed_at');
    expect(stored).not.toBeNull();
    expect(Number(stored)).toBeGreaterThanOrEqual(beforeDismiss);
    expect(Number(stored)).toBeLessThanOrEqual(Date.now());
  });

  it('shouldShowBanner is false after dismiss', async () => {
    localStorage.setItem('push_banner_dismissed_at', String(Date.now()));

    const { result } = renderHook(() => useWebPushSubscription(), {
      wrapper: createWrapper(),
    });

    expect(result.current.shouldShowBanner).toBe(false);
  });

  it('subscribe() does nothing without user', async () => {
    mockUser.current = null;

    const { result } = renderHook(() => useWebPushSubscription(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.subscribe();
    });

    expect(window.Notification.requestPermission).not.toHaveBeenCalled();
    expect(result.current.isSubscribed).toBe(false);
  });

  it('subscribe() does nothing without restaurant', async () => {
    mockRestaurant.current = null;

    const { result } = renderHook(() => useWebPushSubscription(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.subscribe();
    });

    expect(window.Notification.requestPermission).not.toHaveBeenCalled();
    expect(result.current.isSubscribed).toBe(false);
  });

  it('isLoading becomes true during subscribe and false after', async () => {
    // Make the subscribe take time
    let resolvePermission: (value: NotificationPermission) => void;
    (window.Notification.requestPermission as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise<NotificationPermission>((resolve) => { resolvePermission = resolve; })
    );

    const { result } = renderHook(() => useWebPushSubscription(), {
      wrapper: createWrapper(),
    });

    // Start subscribe (don't await)
    let subscribePromise: Promise<void>;
    act(() => {
      subscribePromise = result.current.subscribe();
    });

    // Should be loading
    expect(result.current.isLoading).toBe(true);

    // Resolve permission
    await act(async () => {
      resolvePermission!('granted');
      await subscribePromise;
    });

    expect(result.current.isLoading).toBe(false);
  });

  it('unsubscribe() when no existing subscription is a no-op', async () => {
    // getSubscription returns null (no subscription)
    mockPushManager.getSubscription.mockResolvedValue(null);

    const { result } = renderHook(() => useWebPushSubscription(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isSubscribed).toBe(false);
    });

    await act(async () => {
      await result.current.unsubscribe();
    });

    // Should not have called unsubscribe on any subscription
    expect(mockUnsubscribe).not.toHaveBeenCalled();
    // Should not have called the backend
    expect(mockSupabaseFunctions.invoke).not.toHaveBeenCalled();
    expect(result.current.isSubscribed).toBe(false);
  });
});
