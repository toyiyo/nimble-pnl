import { describe, it, expect, vi } from 'vitest';

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => false }
}));

vi.mock('@capacitor/push-notifications', () => ({
  PushNotifications: {
    requestPermissions: vi.fn(),
    register: vi.fn(),
    addListener: vi.fn(),
    removeAllListeners: vi.fn(),
  }
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { from: vi.fn() },
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: null }),
}));

vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => ({ selectedRestaurant: null }),
}));

import { shouldRegisterForPush } from '@/hooks/useDeviceToken';

describe('useDeviceToken', () => {
  it('shouldRegisterForPush returns false on web', () => {
    expect(shouldRegisterForPush(false)).toBe(false);
  });

  it('shouldRegisterForPush returns true on native with user', () => {
    expect(shouldRegisterForPush(true)).toBe(true);
  });
});
