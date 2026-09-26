import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockUseAuth = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/useAuth', () => ({ useAuth: mockUseAuth }));

const mockGetAuthorization = vi.hoisted(() => vi.fn());
const mockSubmitConsent = vi.hoisted(() => vi.fn());
const mockGoToClientRedirect = vi.hoisted(() => vi.fn());
vi.mock('@/lib/oauthConsentApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/oauthConsentApi')>();
  return {
    ...actual,
    getAuthorization: mockGetAuthorization,
    submitConsent: mockSubmitConsent,
    goToClientRedirect: mockGoToClientRedirect,
  };
});

const mockUserRestaurants = vi.hoisted(() => vi.fn());
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: () => ({ select: () => ({ eq: mockUserRestaurants }) }),
  },
  SUPABASE_URL: 'https://proj.supabase.co',
  SUPABASE_ANON_KEY: 'anon-key',
}));

import OAuthConsent from '@/pages/OAuthConsent';
import { ConsentApiError } from '@/lib/oauthConsentApi';
import { peekConsentReturnPath } from '@/lib/oauthReturnPath';

const ID = 'auth-123';
const DETAILS = {
  authorization_id: ID,
  redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
  client: { id: 'c-1', name: 'Claude', uri: 'https://claude.ai', logo_uri: '' },
  user: { id: 'u-1', email: 'owner@example.com' },
  scope: 'openid email profile',
};

function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/oauth/consent" element={<OAuthConsent />} />
          <Route path="/auth" element={<div>AUTH PAGE</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const signedIn = { user: { id: 'u-1', email: 'owner@example.com' }, loading: false, signOut: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mockUseAuth.mockReturnValue(signedIn);
  mockUserRestaurants.mockResolvedValue({ data: [{ role: 'owner' }], error: null });
  mockGetAuthorization.mockResolvedValue({ kind: 'consent', details: DETAILS });
  mockSubmitConsent.mockResolvedValue('https://claude.ai/api/mcp/auth_callback?code=abc');
  mockGoToClientRedirect.mockReturnValue(true);
});

describe('OAuthConsent page', () => {
  it('shows an error when authorization_id is missing', async () => {
    renderAt('/oauth/consent');
    expect(await screen.findByRole('alert')).toHaveTextContent(/start the connection again in Claude/i);
    expect(mockGetAuthorization).not.toHaveBeenCalled();
  });

  it('waits while the session loads and does not go to /auth', () => {
    mockUseAuth.mockReturnValue({ user: null, loading: true, signOut: vi.fn() });
    renderAt(`/oauth/consent?authorization_id=${ID}`);
    expect(screen.getByTestId('oauth-consent-loading')).toBeInTheDocument();
    expect(screen.queryByText('AUTH PAGE')).not.toBeInTheDocument();
  });

  it('saves the return path and goes to /auth when signed out', async () => {
    mockUseAuth.mockReturnValue({ user: null, loading: false, signOut: vi.fn() });
    renderAt(`/oauth/consent?authorization_id=${ID}`);
    expect(await screen.findByText('AUTH PAGE')).toBeInTheDocument();
    expect(peekConsentReturnPath()).toBe(`/oauth/consent?authorization_id=${ID}`);
  });

  it('shows the client, the redirect host and the account', async () => {
    renderAt(`/oauth/consent?authorization_id=${ID}`);
    expect(await screen.findByRole('heading', { level: 1, name: /connect claude to easyshifthq/i })).toBeInTheDocument();
    expect(screen.getByText('claude.ai')).toBeInTheDocument();
    expect(screen.getByText('owner@example.com')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Allow' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Deny' })).toBeEnabled();
    expect(screen.queryByTestId('oauth-untrusted-host')).not.toBeInTheDocument();
  });

  it('refuses Allow when the redirect host is not a Claude host', async () => {
    mockGetAuthorization.mockResolvedValue({
      kind: 'consent',
      details: { ...DETAILS, client: { ...DETAILS.client, name: 'Claude' }, redirect_uri: 'https://evil.example/cb' },
    });
    renderAt(`/oauth/consent?authorization_id=${ID}`);
    expect(await screen.findByTestId('oauth-untrusted-host')).toHaveTextContent('evil.example');
    expect(screen.queryByRole('button', { name: 'Allow' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Deny' })).toBeEnabled();
  });

  it('shows a note and keeps Allow for a loopback redirect (Claude Code)', async () => {
    mockGetAuthorization.mockResolvedValue({
      kind: 'consent',
      details: { ...DETAILS, redirect_uri: 'http://localhost:33418/callback' },
    });
    renderAt(`/oauth/consent?authorization_id=${ID}`);
    expect(await screen.findByTestId('oauth-loopback-host')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Allow' })).toBeEnabled();
  });

  it('shows a note when the restaurant check fails', async () => {
    mockUserRestaurants.mockResolvedValue({ data: null, error: new Error('db') });
    renderAt(`/oauth/consent?authorization_id=${ID}`);
    expect(await screen.findByTestId('oauth-restaurants-error')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Allow' })).toBeEnabled();
  });

  it('shows an error when the client redirect URL is refused', async () => {
    mockGoToClientRedirect.mockReturnValue(false);
    mockGetAuthorization.mockResolvedValue({ kind: 'redirect', redirectUrl: 'javascript:alert(1)' });
    renderAt(`/oauth/consent?authorization_id=${ID}`);
    expect(await screen.findByRole('alert')).toHaveTextContent(/return address is not valid/i);
  });

  it('refuses to work inside a frame', async () => {
    const spy = vi.spyOn(window, 'top', 'get').mockReturnValue({} as Window);
    try {
      renderAt(`/oauth/consent?authorization_id=${ID}`);
      expect(await screen.findByRole('alert')).toHaveTextContent(/own window/i);
      expect(mockGetAuthorization).not.toHaveBeenCalled();
      expect(screen.queryByText('AUTH PAGE')).not.toBeInTheDocument();
    } finally {
      spy.mockRestore();
    }
  });

  it('shows an error when sign-out fails for a different account', async () => {
    const signOut = vi.fn().mockRejectedValue(new Error('offline'));
    mockUseAuth.mockReturnValue({ ...signedIn, signOut });
    renderAt(`/oauth/consent?authorization_id=${ID}`);
    fireEvent.click(await screen.findByRole('button', { name: /use a different account/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not sign you out/i);
    expect(screen.queryByText('AUTH PAGE')).not.toBeInTheDocument();
  });

  it('warns when the user has no restaurant that the connector can read', async () => {
    mockUserRestaurants.mockResolvedValue({ data: [{ role: 'staff' }], error: null });
    renderAt(`/oauth/consent?authorization_id=${ID}`);
    expect(await screen.findByTestId('oauth-no-restaurants')).toBeInTheDocument();
  });

  it.each([
    ['Allow', 'approve'],
    ['Deny', 'deny'],
  ])('%s posts %s and goes to the redirect URL', async (label, action) => {
    renderAt(`/oauth/consent?authorization_id=${ID}`);
    fireEvent.click(await screen.findByRole('button', { name: label }));
    await waitFor(() => expect(mockSubmitConsent).toHaveBeenCalledWith(ID, action));
    await waitFor(() =>
      expect(mockGoToClientRedirect).toHaveBeenCalledWith('https://claude.ai/api/mcp/auth_callback?code=abc'),
    );
    expect(screen.getByRole('button', { name: /allow/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /deny/i })).toBeDisabled();
  });

  it('disables both buttons while the decision is pending', async () => {
    mockSubmitConsent.mockReturnValue(new Promise(() => {}));
    renderAt(`/oauth/consent?authorization_id=${ID}`);
    fireEvent.click(await screen.findByRole('button', { name: 'Allow' }));
    expect(await screen.findByRole('button', { name: /allowing/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Deny' })).toBeDisabled();
  });

  it('goes to the redirect URL at once when consent already exists', async () => {
    mockGetAuthorization.mockResolvedValue({ kind: 'redirect', redirectUrl: 'https://claude.ai/cb?code=z' });
    renderAt(`/oauth/consent?authorization_id=${ID}`);
    await waitFor(() => expect(mockGoToClientRedirect).toHaveBeenCalledWith('https://claude.ai/cb?code=z'));
  });

  it('tells the user to start again for an expired or used authorization', async () => {
    mockGetAuthorization.mockRejectedValue(new ConsentApiError('authorization not found', 404));
    renderAt(`/oauth/consent?authorization_id=${ID}`);
    expect(await screen.findByRole('alert')).toHaveTextContent(/expired or it was used/i);
    expect(screen.getByRole('button', { name: /go to easyshifthq/i })).toBeInTheDocument();
  });

  it('sends only one decision on a double click', async () => {
    mockSubmitConsent.mockReturnValue(new Promise(() => {}));
    renderAt(`/oauth/consent?authorization_id=${ID}`);
    const allow = await screen.findByRole('button', { name: 'Allow' });
    fireEvent.click(allow);
    fireEvent.click(allow);
    await waitFor(() => expect(mockSubmitConsent).toHaveBeenCalledTimes(1));
  });

  it('says start again when the decision fails because the request expired', async () => {
    mockSubmitConsent.mockRejectedValue(new ConsentApiError('used', 400));
    renderAt(`/oauth/consent?authorization_id=${ID}`);
    fireEvent.click(await screen.findByRole('button', { name: 'Allow' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/start the connection again in claude/i);
  });

  it('offers a sign-in again for a lapsed session', async () => {
    mockGetAuthorization.mockRejectedValue(new ConsentApiError('Your session ended. Sign in again.', 401));
    renderAt(`/oauth/consent?authorization_id=${ID}`);
    expect(await screen.findByRole('alert')).toHaveTextContent(/session ended/i);
    expect(screen.getByRole('button', { name: /sign in again/i })).toBeInTheDocument();
  });

  it('shows an error when the decision fails', async () => {
    mockSubmitConsent.mockRejectedValue(new ConsentApiError('boom', 500));
    renderAt(`/oauth/consent?authorization_id=${ID}`);
    fireEvent.click(await screen.findByRole('button', { name: 'Allow' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not save your decision/i);
    expect(screen.getByRole('button', { name: 'Allow' })).toBeEnabled();
  });

  it('signs out, keeps the return path and goes to /auth for a different account', async () => {
    const signOut = vi.fn().mockResolvedValue(undefined);
    mockUseAuth.mockReturnValue({ ...signedIn, signOut });
    renderAt(`/oauth/consent?authorization_id=${ID}`);
    fireEvent.click(await screen.findByRole('button', { name: /use a different account/i }));
    expect(await screen.findByText('AUTH PAGE')).toBeInTheDocument();
    expect(signOut).toHaveBeenCalled();
    expect(peekConsentReturnPath()).toBe(`/oauth/consent?authorization_id=${ID}`);
  });
});
