import { describe, it, expect, vi } from 'vitest';

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => false },
}));
vi.mock('@capacitor/browser', () => ({
  Browser: { open: vi.fn() },
}));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { auth: { signInWithOAuth: vi.fn().mockResolvedValue({ data: null, error: null }) } },
}));

import { getOAuthRedirectUrl, signInWithOAuthNative } from '@/utils/nativeRedirect';

describe('getOAuthRedirectUrl', () => {
  it('returns window.location.origin path on web', () => {
    const url = getOAuthRedirectUrl('/');
    expect(url).toContain('/');
    expect(url).not.toContain('com.easyshifthq');
  });

  it('includes the provided path', () => {
    const url = getOAuthRedirectUrl('/auth/callback');
    expect(url).toContain('/auth/callback');
  });

  it('defaults path to / when not provided', () => {
    const url = getOAuthRedirectUrl();
    expect(url).toBeTruthy();
    expect(url).not.toContain('com.easyshifthq');
  });
});

describe('signInWithOAuthNative', () => {
  it('calls supabase signInWithOAuth on web and returns no error', async () => {
    const { supabase } = await import('@/integrations/supabase/client');
    const result = await signInWithOAuthNative('google');
    expect(supabase.auth.signInWithOAuth).toHaveBeenCalled();
    expect(result.error).toBeNull();
  });

  it('passes provider and redirect options correctly', async () => {
    const { supabase } = await import('@/integrations/supabase/client');
    vi.mocked(supabase.auth.signInWithOAuth).mockClear();
    await signInWithOAuthNative('github', '/dashboard');
    const callArg = vi.mocked(supabase.auth.signInWithOAuth).mock.calls[0][0];
    expect(callArg.provider).toBe('github');
    expect(callArg.options?.redirectTo).toContain('/dashboard');
  });

  it('returns error when supabase returns an error', async () => {
    const { supabase } = await import('@/integrations/supabase/client');
    const mockError = new Error('Auth failed');
    vi.mocked(supabase.auth.signInWithOAuth).mockResolvedValueOnce({
      data: { provider: 'google', url: null },
      error: mockError,
    } as never);
    const result = await signInWithOAuthNative('google');
    expect(result.error).toBe(mockError);
  });
});
