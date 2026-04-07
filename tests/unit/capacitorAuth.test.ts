import { describe, it, expect, vi } from 'vitest';

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => false },
}));
vi.mock('@capacitor/app', () => ({
  App: { addListener: vi.fn() },
}));
vi.mock('@capacitor/browser', () => ({
  Browser: { close: vi.fn() },
}));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      setSession: vi.fn(),
      exchangeCodeForSession: vi.fn(),
    },
  },
}));

import { setupDeepLinkAuth } from '@/utils/capacitorAuth';

describe('setupDeepLinkAuth', () => {
  it('does nothing on web (App.addListener not called)', async () => {
    const { App } = await import('@capacitor/app');
    setupDeepLinkAuth();
    expect(App.addListener).not.toHaveBeenCalled();
  });

  it('returns without side effects when called multiple times on web', () => {
    expect(() => {
      setupDeepLinkAuth();
      setupDeepLinkAuth();
    }).not.toThrow();
  });
});
