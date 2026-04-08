import { describe, it, expect, vi, beforeEach } from 'vitest';

let _isNative = false;

const mockBrowserOpen = vi.fn();
const mockSignInWithOAuth = vi.fn();

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => _isNative,
  },
}));

vi.mock('@capacitor/browser', () => ({
  Browser: {
    open: (...args: unknown[]) => mockBrowserOpen(...args),
  },
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      signInWithOAuth: (...args: unknown[]) => mockSignInWithOAuth(...args),
    },
  },
}));

import { getOAuthRedirectUrl, signInWithOAuthNative } from '@/utils/nativeRedirect';

// ---------------------------------------------------------------------------
// getOAuthRedirectUrl
// ---------------------------------------------------------------------------
describe('getOAuthRedirectUrl', () => {
  it('returns window.location.origin + path on web', () => {
    _isNative = false;
    const url = getOAuthRedirectUrl('/');
    expect(url).toContain('/');
    expect(url).not.toContain('com.easyshifthq');
  });

  it('includes the provided path on web', () => {
    _isNative = false;
    const url = getOAuthRedirectUrl('/auth/callback');
    expect(url).toContain('/auth/callback');
  });

  it('defaults path to / when not provided', () => {
    _isNative = false;
    const url = getOAuthRedirectUrl();
    expect(url).toBeTruthy();
    expect(url).not.toContain('com.easyshifthq');
  });

  it('returns native deep link scheme on native', () => {
    _isNative = true;
    const url = getOAuthRedirectUrl('/');
    expect(url).toContain('com.easyshifthq.employee://callback/');
  });

  it('strips leading slash from path in native scheme', () => {
    _isNative = true;
    const url = getOAuthRedirectUrl('/auth/callback');
    expect(url).toBe('com.easyshifthq.employee://callback/auth/callback');
  });

  it('handles path without leading slash on native', () => {
    _isNative = true;
    const url = getOAuthRedirectUrl('dashboard');
    expect(url).toBe('com.easyshifthq.employee://callback/dashboard');
  });
});

// ---------------------------------------------------------------------------
// signInWithOAuthNative – web platform
// ---------------------------------------------------------------------------
describe('signInWithOAuthNative – web platform', () => {
  beforeEach(() => {
    _isNative = false;
    vi.clearAllMocks();
    mockSignInWithOAuth.mockResolvedValue({ data: null, error: null });
  });

  it('calls supabase.auth.signInWithOAuth on web', async () => {
    await signInWithOAuthNative('google');
    expect(mockSignInWithOAuth).toHaveBeenCalledTimes(1);
  });

  it('passes correct provider to supabase on web', async () => {
    await signInWithOAuthNative('github', '/dashboard');
    const callArg = mockSignInWithOAuth.mock.calls[0][0];
    expect(callArg.provider).toBe('github');
  });

  it('passes redirectTo containing the path on web', async () => {
    await signInWithOAuthNative('google', '/auth/callback');
    const callArg = mockSignInWithOAuth.mock.calls[0][0];
    expect(callArg.options?.redirectTo).toContain('/auth/callback');
  });

  it('does NOT pass skipBrowserRedirect on web', async () => {
    await signInWithOAuthNative('google');
    const callArg = mockSignInWithOAuth.mock.calls[0][0];
    expect(callArg.options?.skipBrowserRedirect).toBeFalsy();
  });

  it('returns { error: null } on success', async () => {
    const result = await signInWithOAuthNative('google');
    expect(result.error).toBeNull();
  });

  it('returns the error when supabase returns one', async () => {
    const mockError = new Error('Auth failed');
    mockSignInWithOAuth.mockResolvedValueOnce({
      data: { provider: 'google', url: null },
      error: mockError,
    });
    const result = await signInWithOAuthNative('google');
    expect(result.error).toBe(mockError);
  });

  it('does NOT call Browser.open on web', async () => {
    await signInWithOAuthNative('google');
    expect(mockBrowserOpen).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// signInWithOAuthNative – native platform
// ---------------------------------------------------------------------------
describe('signInWithOAuthNative – native platform', () => {
  beforeEach(() => {
    _isNative = true;
    vi.clearAllMocks();
    mockBrowserOpen.mockResolvedValue(undefined);
  });

  it('calls supabase.auth.signInWithOAuth with skipBrowserRedirect=true', async () => {
    mockSignInWithOAuth.mockResolvedValue({
      data: { url: 'https://accounts.google.com/o/oauth2/...' },
      error: null,
    });
    await signInWithOAuthNative('google');
    const callArg = mockSignInWithOAuth.mock.calls[0][0];
    expect(callArg.options?.skipBrowserRedirect).toBe(true);
  });

  it('calls Browser.open with the returned auth URL', async () => {
    const authUrl = 'https://accounts.google.com/o/oauth2/auth?client_id=...';
    mockSignInWithOAuth.mockResolvedValue({
      data: { url: authUrl },
      error: null,
    });
    await signInWithOAuthNative('google');
    expect(mockBrowserOpen).toHaveBeenCalledWith({ url: authUrl, windowName: '_self' });
  });

  it('returns error when supabase returns an error (native)', async () => {
    const mockError = new Error('OAuth failed');
    mockSignInWithOAuth.mockResolvedValue({ data: null, error: mockError });
    const result = await signInWithOAuthNative('google');
    expect(result.error).toBe(mockError);
    expect(mockBrowserOpen).not.toHaveBeenCalled();
  });

  it('returns error when supabase returns no URL', async () => {
    mockSignInWithOAuth.mockResolvedValue({ data: { url: null }, error: null });
    const result = await signInWithOAuthNative('google');
    expect(result.error).toBeInstanceOf(Error);
    expect(mockBrowserOpen).not.toHaveBeenCalled();
  });

  it('uses native deep link as redirectTo', async () => {
    mockSignInWithOAuth.mockResolvedValue({
      data: { url: 'https://example.com/auth' },
      error: null,
    });
    await signInWithOAuthNative('google', '/callback');
    const callArg = mockSignInWithOAuth.mock.calls[0][0];
    expect(callArg.options?.redirectTo).toContain('com.easyshifthq.employee://callback/');
  });
});
