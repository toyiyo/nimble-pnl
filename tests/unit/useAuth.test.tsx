import { renderHook, waitFor, act } from '@testing-library/react';
import React from 'react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AuthProvider, useAuth } from '@/hooks/useAuth';

// Mock Supabase client
const mockGetSession = vi.fn();
const mockRefreshSession = vi.fn();
const mockOnAuthStateChange = vi.fn();
const mockSupabaseSignOut = vi.fn();

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      getSession: (...args: any[]) => mockGetSession(...args),
      onAuthStateChange: (...args: any[]) => mockOnAuthStateChange(...args),
      refreshSession: (...args: any[]) => mockRefreshSession(...args),
      signOut: (...args: any[]) => mockSupabaseSignOut(...args), // any: passthrough mock, matches this file's mock pattern
    },
  },
}));

// Mock posthog-js so signOut can be asserted against posthog.reset().
const mockPosthogReset = vi.fn();
vi.mock('posthog-js', () => ({
  default: {
    identify: vi.fn(),
    capture: vi.fn(),
    reset: (...args: any[]) => mockPosthogReset(...args), // any: passthrough mock, matches this file's mock pattern
  },
}));

describe('useAuth Hook - Visibility Change', () => {
  let originalVisibilityState: DocumentVisibilityState;

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Default mocks
    mockGetSession.mockResolvedValue({ 
      data: { session: null }, 
      error: null 
    });
    
    mockOnAuthStateChange.mockReturnValue({
      data: { subscription: { unsubscribe: vi.fn() } },
    });

    // Save original visibility state
    originalVisibilityState = document.visibilityState;
  });

  afterEach(() => {
    // Restore visibility state
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => originalVisibilityState,
    });
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <AuthProvider>{children}</AuthProvider>
  );

  it('should proactively check session when tab becomes visible', async () => {
    // 1. Initial State: Hidden
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    });

    // Setup: We have an existing session
    const mockSession = { 
      access_token: 'token-123', 
      user: { id: 'user-1' } 
    };
    
    // Initial load
    mockGetSession.mockResolvedValue({ 
      data: { session: mockSession }, 
      error: null 
    });

    const { result } = renderHook(() => useAuth(), { wrapper });

    // Wait for initial load
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // Clear initial calls
    mockGetSession.mockClear();

    // 2. Action: Tab becomes visible
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });

    // Simulate event
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    // 3. Asset: Session checked
    await waitFor(() => {
      expect(mockGetSession).toHaveBeenCalledTimes(1);
    });
  });

  it('should not check session when tab becomes hidden', async () => {
     // 1. Initial State: Visible
     Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });

    const { result } = renderHook(() => useAuth(), { wrapper });
    
    await waitFor(() => expect(result.current.loading).toBe(false));
    
    mockGetSession.mockClear();

    // 2. Action: Tab becomes hidden
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    });

    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    // 3. Assert: No check
    expect(mockGetSession).not.toHaveBeenCalled();
  });

  it('should update session if new token is detected on visibility change', async () => {
    // 1. Initial State
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    });

    const initialSession = { 
      access_token: 'old-token', 
      user: { id: 'user-1' } 
    };

    mockGetSession.mockResolvedValueOnce({ 
      data: { session: initialSession }, 
      error: null 
    });

    const { result } = renderHook(() => useAuth(), { wrapper });
    
    await waitFor(() => {
      expect(result.current.session?.access_token).toBe('old-token');
    });

    mockGetSession.mockClear();

    // 2. Setup new session for next call
    const newSession = { 
      access_token: 'new-refreshed-token', 
      user: { id: 'user-1' } 
    };
    mockGetSession.mockResolvedValueOnce({ 
      data: { session: newSession }, 
      error: null 
    });

    // 3. Action: Become visible
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });

    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    // 4. Assert: Session updated
    await waitFor(() => {
      expect(result.current.session?.access_token).toBe('new-refreshed-token');
    });
  });
});

describe('useAuth signOut — PostHog identity reset', () => {
  let originalLocation: Location;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue({ data: { session: null }, error: null });
    mockOnAuthStateChange.mockReturnValue({
      data: { subscription: { unsubscribe: vi.fn() } },
    });
    mockSupabaseSignOut.mockResolvedValue({ error: null });

    // jsdom cannot navigate; replace window.location with a writable stub.
    originalLocation = window.location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...originalLocation, href: 'http://localhost/' },
    });
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: originalLocation,
    });
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <AuthProvider>{children}</AuthProvider>
  );

  it('calls posthog.reset() before the redirect', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.signOut();
    });

    // Without the reset, the next account in the same browser merges into
    // the previous PostHog person (posthog-js ignores a second identify).
    expect(mockPosthogReset).toHaveBeenCalledTimes(1);
    expect(window.location.href).toBe('/auth');
  });

  it('still redirects when posthog.reset() throws', async () => {
    // Once, not always: vi.clearAllMocks() keeps implementations, so a
    // persistent throw would leak into the next test.
    mockPosthogReset.mockImplementationOnce(() => {
      throw new Error('storage blocked');
    });

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.signOut();
    });

    // Telemetry must never block the sign-out redirect.
    expect(window.location.href).toBe('/auth');
  });

  it('calls posthog.reset() even when supabase signOut rejects', async () => {
    mockSupabaseSignOut.mockRejectedValue(new Error('403'));

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.signOut();
    });

    expect(mockPosthogReset).toHaveBeenCalled();
    expect(window.location.href).toBe('/auth');
  });
});
