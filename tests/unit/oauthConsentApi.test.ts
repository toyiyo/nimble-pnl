import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockGetSession = vi.hoisted(() => vi.fn());
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { auth: { getSession: mockGetSession } },
  SUPABASE_URL: 'https://proj.supabase.co',
  SUPABASE_ANON_KEY: 'anon-key',
}));

import {
  ConsentApiError,
  getAuthorization,
  isTrustedRedirectHost,
  redirectHost,
  submitConsent,
} from '@/lib/oauthConsentApi';

const DETAILS = {
  authorization_id: 'auth-1',
  redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
  client: { id: 'c-1', name: 'Claude', uri: 'https://claude.ai', logo_uri: '' },
  user: { id: 'u-1', email: 'owner@example.com' },
  scope: 'openid email profile',
};

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const fetchMock = vi.fn();

beforeEach(() => {
  mockGetSession.mockResolvedValue({ data: { session: { access_token: 'user-token' } }, error: null });
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getAuthorization', () => {
  it('returns consent details and sends the apikey and bearer headers', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, DETAILS));
    await expect(getAuthorization('auth-1')).resolves.toEqual({ kind: 'consent', details: DETAILS });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://proj.supabase.co/auth/v1/oauth/authorizations/auth-1');
    expect(init.method).toBe('GET');
    expect(init.headers).toMatchObject({ apikey: 'anon-key', Authorization: 'Bearer user-token' });
  });

  it('returns a redirect when consent already exists', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { redirect_url: 'https://claude.ai/cb?code=x' }));
    await expect(getAuthorization('auth-1')).resolves.toEqual({
      kind: 'redirect',
      redirectUrl: 'https://claude.ai/cb?code=x',
    });
  });

  it('encodes the authorization id in the path', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, DETAILS));
    await getAuthorization('a/b?c');
    expect(fetchMock.mock.calls[0][0]).toBe('https://proj.supabase.co/auth/v1/oauth/authorizations/a%2Fb%3Fc');
  });

  it('throws ConsentApiError with the status for an HTTP error', async () => {
    fetchMock.mockResolvedValue(jsonResponse(404, { msg: 'authorization not found' }));
    await expect(getAuthorization('auth-1')).rejects.toMatchObject({
      name: 'ConsentApiError',
      status: 404,
      message: 'authorization not found',
    });
  });

  it('throws a 401 ConsentApiError without a session and does not fetch', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null }, error: null });
    const error = await getAuthorization('auth-1').catch((e) => e);
    expect(error).toBeInstanceOf(ConsentApiError);
    expect(error.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws for a body with neither shape', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { unexpected: true }));
    await expect(getAuthorization('auth-1')).rejects.toMatchObject({ status: 502 });
  });
});

describe('submitConsent', () => {
  it.each(['approve', 'deny'] as const)('posts action %s and returns the redirect URL', async (action) => {
    fetchMock.mockResolvedValue(jsonResponse(200, { redirect_url: 'https://claude.ai/cb?code=x' }));
    await expect(submitConsent('auth-1', action)).resolves.toBe('https://claude.ai/cb?code=x');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://proj.supabase.co/auth/v1/oauth/authorizations/auth-1/consent');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ action });
  });

  it('throws when the response has no redirect_url', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, {}));
    await expect(submitConsent('auth-1', 'approve')).rejects.toBeInstanceOf(ConsentApiError);
  });

  it('uses a generic message for an error body that is not JSON', async () => {
    fetchMock.mockResolvedValue(new Response('boom', { status: 500 }));
    await expect(submitConsent('auth-1', 'approve')).rejects.toMatchObject({
      status: 500,
      message: 'Request failed (HTTP 500)',
    });
  });
});

describe('redirect host checks', () => {
  it.each([
    ['https://claude.ai/api/mcp/auth_callback', true],
    ['https://claude.com/cb', true],
    ['https://www.claude.ai/cb', true],
    ['http://localhost:33418/callback', true],
    ['http://127.0.0.1:5000/cb', true],
    ['https://claude.ai.evil.com/cb', false],
    ['https://evilclaude.ai/cb', false],
    ['not a url', false],
  ])('%s trusted = %s', (uri, trusted) => {
    expect(isTrustedRedirectHost(uri)).toBe(trusted);
  });

  it('returns the host or null', () => {
    expect(redirectHost('https://claude.ai/x')).toBe('claude.ai');
    expect(redirectHost('nope')).toBeNull();
  });
});

describe('goToClientRedirect', () => {
  it('refuses script, data and bad URLs', async () => {
    const { goToClientRedirect } = await import('@/lib/oauthConsentApi');
    expect(goToClientRedirect('javascript:alert(1)')).toBe(false);
    expect(goToClientRedirect('data:text/html,x')).toBe(false);
    expect(goToClientRedirect('not a url')).toBe(false);
  });
});
