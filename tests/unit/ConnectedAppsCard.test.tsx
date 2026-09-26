import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'u-1' } }) }));

const mockListOAuthGrants = vi.hoisted(() => vi.fn());
const mockRevokeOAuthGrant = vi.hoisted(() => vi.fn());
vi.mock('@/lib/oauthConsentApi', () => ({
  listOAuthGrants: mockListOAuthGrants,
  revokeOAuthGrant: mockRevokeOAuthGrant,
}));
const mockClient = vi.hoisted(() => ({
  SUPABASE_URL: 'https://proj.supabase.co',
  PRODUCTION_SUPABASE_URL: 'https://prod.supabase.co',
}));
vi.mock('@/integrations/supabase/client', () => mockClient);

import { ConnectedAppsCard, CLAUDE_CONNECTOR_URL } from '@/components/integrations/ConnectedAppsCard';

const GRANT = { client: { id: 'c-1', name: 'Claude' }, scopes: ['email'], granted_at: '2026-09-01T00:00:00Z' };

function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ConnectedAppsCard />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockListOAuthGrants.mockResolvedValue([GRANT]);
  mockRevokeOAuthGrant.mockResolvedValue(undefined);
});

describe('ConnectedAppsCard', () => {
  it('shows the connector URL', async () => {
    renderCard();
    expect(CLAUDE_CONNECTOR_URL).toBe('https://proj.supabase.co/functions/v1/mcp');
    expect(screen.getByText(CLAUDE_CONNECTOR_URL)).toBeInTheDocument();
    await screen.findByText('Claude');
  });

  it('uses the EasyShiftHQ domain on production', async () => {
    vi.resetModules();
    mockClient.SUPABASE_URL = mockClient.PRODUCTION_SUPABASE_URL;
    try {
      const mod = await import('@/components/integrations/ConnectedAppsCard');
      expect(mod.CLAUDE_CONNECTOR_URL).toBe('https://app.easyshifthq.com/mcp');
    } finally {
      mockClient.SUPABASE_URL = 'https://proj.supabase.co';
    }
  });

  it('copies the connector URL', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: /copy the connector url/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(CLAUDE_CONNECTOR_URL));
  });

  it('shows the loading state', () => {
    mockListOAuthGrants.mockReturnValue(new Promise(() => {}));
    renderCard();
    expect(screen.getByTestId('connected-apps-loading')).toBeInTheDocument();
  });

  it('shows the empty state', async () => {
    mockListOAuthGrants.mockResolvedValue([]);
    renderCard();
    expect(await screen.findByText(/no app has access/i)).toBeInTheDocument();
  });

  it('shows the error state', async () => {
    mockListOAuthGrants.mockRejectedValue(new Error('boom'));
    renderCard();
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not load your connected apps/i);
  });

  it('asks for a confirm and can cancel', async () => {
    renderCard();
    fireEvent.click(await screen.findByRole('button', { name: 'Revoke access for Claude' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Revoke access for Claude' })).toBeInTheDocument();
    expect(mockRevokeOAuthGrant).not.toHaveBeenCalled();
  });

  it('uses a fallback name for a client with no name', async () => {
    mockListOAuthGrants.mockResolvedValue([{ ...GRANT, client: { id: 'c-2', name: '' } }]);
    renderCard();
    expect(await screen.findByRole('button', { name: 'Revoke access for An application' })).toBeInTheDocument();
  });

  it('revokes a grant after the confirm and reloads the list', async () => {
    renderCard();
    fireEvent.click(await screen.findByRole('button', { name: 'Revoke access for Claude' }));
    expect(mockRevokeOAuthGrant).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm: revoke access for Claude' }));
    await waitFor(() => expect(mockRevokeOAuthGrant).toHaveBeenCalledWith('c-1'));
    await waitFor(() => expect(mockListOAuthGrants).toHaveBeenCalledTimes(2));
  });

  it('shows an error when the revoke fails', async () => {
    mockRevokeOAuthGrant.mockRejectedValue(new Error('boom'));
    renderCard();
    fireEvent.click(await screen.findByRole('button', { name: 'Revoke access for Claude' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm: revoke access for Claude' }));
    expect(await screen.findByText(/could not revoke the access/i)).toBeInTheDocument();
  });
});
