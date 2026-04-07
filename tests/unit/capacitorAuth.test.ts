import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- We need two independent describe groups with different isNativePlatform values.
// Since vi.mock is hoisted we use a mutable flag.
let _isNative = false;

const mockAddListener = vi.fn();
const mockBrowserClose = vi.fn();
const mockSetSession = vi.fn();
const mockExchangeCodeForSession = vi.fn();

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => _isNative,
  },
}));

vi.mock('@capacitor/app', () => ({
  App: {
    addListener: (...args: unknown[]) => mockAddListener(...args),
  },
}));

vi.mock('@capacitor/browser', () => ({
  Browser: {
    close: (...args: unknown[]) => mockBrowserClose(...args),
  },
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      setSession: (...args: unknown[]) => mockSetSession(...args),
      exchangeCodeForSession: (...args: unknown[]) => mockExchangeCodeForSession(...args),
    },
  },
}));

import { setupDeepLinkAuth } from '@/utils/capacitorAuth';

// ---------------------------------------------------------------------------
// Web platform
// ---------------------------------------------------------------------------
describe('setupDeepLinkAuth – web platform', () => {
  beforeEach(() => {
    _isNative = false;
    vi.clearAllMocks();
  });

  it('does nothing (App.addListener not called)', () => {
    setupDeepLinkAuth();
    expect(mockAddListener).not.toHaveBeenCalled();
  });

  it('returns without throwing when called multiple times', () => {
    expect(() => {
      setupDeepLinkAuth();
      setupDeepLinkAuth();
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Native platform – listener registration
// ---------------------------------------------------------------------------
describe('setupDeepLinkAuth – native platform', () => {
  beforeEach(() => {
    _isNative = true;
    vi.clearAllMocks();
    mockAddListener.mockResolvedValue(undefined);
    mockBrowserClose.mockResolvedValue(undefined);
    mockSetSession.mockResolvedValue({ data: {}, error: null });
    mockExchangeCodeForSession.mockResolvedValue({ data: {}, error: null });
  });

  it('registers an "appUrlOpen" listener', () => {
    setupDeepLinkAuth();
    expect(mockAddListener).toHaveBeenCalledTimes(1);
    expect(mockAddListener.mock.calls[0][0]).toBe('appUrlOpen');
  });

  it('listener is a function', () => {
    setupDeepLinkAuth();
    const listener = mockAddListener.mock.calls[0][1];
    expect(typeof listener).toBe('function');
  });

  it('listener ignores URLs that do not start with custom scheme', async () => {
    setupDeepLinkAuth();
    const listener = mockAddListener.mock.calls[0][1] as (e: { url: string }) => Promise<void>;
    await listener({ url: 'https://evil.example.com/auth' });
    expect(mockBrowserClose).not.toHaveBeenCalled();
    expect(mockSetSession).not.toHaveBeenCalled();
    expect(mockExchangeCodeForSession).not.toHaveBeenCalled();
  });

  it('calls Browser.close when a valid deep link arrives', async () => {
    setupDeepLinkAuth();
    const listener = mockAddListener.mock.calls[0][1] as (e: { url: string }) => Promise<void>;
    const url = 'com.easyshifthq.employee://callback/#access_token=tok123&refresh_token=ref456';
    await listener({ url });
    expect(mockBrowserClose).toHaveBeenCalledTimes(1);
  });

  it('calls supabase.auth.setSession with tokens from fragment', async () => {
    setupDeepLinkAuth();
    const listener = mockAddListener.mock.calls[0][1] as (e: { url: string }) => Promise<void>;
    const url = 'com.easyshifthq.employee://callback/#access_token=tok123&refresh_token=ref456';
    await listener({ url });
    expect(mockSetSession).toHaveBeenCalledWith({
      access_token: 'tok123',
      refresh_token: 'ref456',
    });
    expect(mockExchangeCodeForSession).not.toHaveBeenCalled();
  });

  it('calls supabase.auth.exchangeCodeForSession when URL has ?code= param', async () => {
    setupDeepLinkAuth();
    const listener = mockAddListener.mock.calls[0][1] as (e: { url: string }) => Promise<void>;
    const url = 'com.easyshifthq.employee://callback/?code=pkce_code_abc';
    await listener({ url });
    expect(mockExchangeCodeForSession).toHaveBeenCalledWith('pkce_code_abc');
    expect(mockSetSession).not.toHaveBeenCalled();
  });

  it('does not call setSession when fragment is present but tokens are missing', async () => {
    setupDeepLinkAuth();
    const listener = mockAddListener.mock.calls[0][1] as (e: { url: string }) => Promise<void>;
    // Fragment has no access_token / refresh_token
    const url = 'com.easyshifthq.employee://callback/#state=xyz';
    await listener({ url });
    expect(mockSetSession).not.toHaveBeenCalled();
  });

  it('does not call exchangeCodeForSession when query has no code param', async () => {
    setupDeepLinkAuth();
    const listener = mockAddListener.mock.calls[0][1] as (e: { url: string }) => Promise<void>;
    const url = 'com.easyshifthq.employee://callback/?state=xyz';
    await listener({ url });
    expect(mockExchangeCodeForSession).not.toHaveBeenCalled();
    expect(mockSetSession).not.toHaveBeenCalled();
  });

  it('survives Browser.close throwing (already closed)', async () => {
    mockBrowserClose.mockRejectedValue(new Error('already closed'));
    setupDeepLinkAuth();
    const listener = mockAddListener.mock.calls[0][1] as (e: { url: string }) => Promise<void>;
    const url = 'com.easyshifthq.employee://callback/#access_token=t&refresh_token=r';
    await expect(listener({ url })).resolves.not.toThrow();
    expect(mockSetSession).toHaveBeenCalled();
  });
});
