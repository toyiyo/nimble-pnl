import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

let _isNative = false;

const mockRequestPermissions = vi.fn();
const mockRegister = vi.fn();
const mockAddListener = vi.fn();
const mockRemoveAllListeners = vi.fn();

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => _isNative,
    getPlatform: () => 'ios',
  },
}));

vi.mock('@capacitor/push-notifications', () => ({
  PushNotifications: {
    requestPermissions: (...args: unknown[]) => mockRequestPermissions(...args),
    register: (...args: unknown[]) => mockRegister(...args),
    addListener: (...args: unknown[]) => mockAddListener(...args),
    removeAllListeners: (...args: unknown[]) => mockRemoveAllListeners(...args),
  },
}));

const mockFrom = vi.fn();
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { from: (...args: unknown[]) => mockFrom(...args) },
}));

let _user: { id: string } | null = null;
let _restaurant: { id: string } | null = null;

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: _user }),
}));

vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => ({ selectedRestaurant: _restaurant }),
}));

import { shouldRegisterForPush, useDeviceToken } from '@/hooks/useDeviceToken';

// ---------------------------------------------------------------------------
// Pure helper
// ---------------------------------------------------------------------------
describe('shouldRegisterForPush', () => {
  it('returns false on web', () => {
    expect(shouldRegisterForPush(false)).toBe(false);
  });

  it('returns false on native when PUSH_NOTIFICATIONS_ENABLED is false', () => {
    // Firebase is not configured yet – function is always false
    expect(shouldRegisterForPush(true)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Hook – PUSH_NOTIFICATIONS_ENABLED = false means no side-effects ever
// ---------------------------------------------------------------------------
describe('useDeviceToken hook – push disabled', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRemoveAllListeners.mockResolvedValue(undefined);
    _user = { id: 'user-1' };
    _restaurant = { id: 'rest-1' };
  });

  it('does not call requestPermissions on web', () => {
    _isNative = false;
    renderHook(() => useDeviceToken());
    expect(mockRequestPermissions).not.toHaveBeenCalled();
  });

  it('does not call requestPermissions on native (push disabled)', () => {
    _isNative = true;
    renderHook(() => useDeviceToken());
    expect(mockRequestPermissions).not.toHaveBeenCalled();
  });

  it('does not call PushNotifications.register on web', () => {
    _isNative = false;
    renderHook(() => useDeviceToken());
    expect(mockRegister).not.toHaveBeenCalled();
  });

  it('does not call PushNotifications.addListener on web', () => {
    _isNative = false;
    renderHook(() => useDeviceToken());
    expect(mockAddListener).not.toHaveBeenCalled();
  });

  it('does not call supabase.from on web', () => {
    _isNative = false;
    renderHook(() => useDeviceToken());
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('does nothing when user is null (web)', () => {
    _isNative = false;
    _user = null;
    renderHook(() => useDeviceToken());
    expect(mockRequestPermissions).not.toHaveBeenCalled();
  });

  it('does nothing when selectedRestaurant is null (web)', () => {
    _isNative = false;
    _restaurant = null;
    renderHook(() => useDeviceToken());
    expect(mockRequestPermissions).not.toHaveBeenCalled();
  });
});
