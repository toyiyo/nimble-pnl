import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockGetAuthorization = vi.hoisted(() => vi.fn());
const mockSubmitConsent = vi.hoisted(() => vi.fn());
vi.mock('@/lib/oauthConsentApi', () => ({
  getAuthorization: mockGetAuthorization,
  submitConsent: mockSubmitConsent,
}));

const mockEq = vi.hoisted(() => vi.fn());
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { from: () => ({ select: () => ({ eq: mockEq }) }) },
}));

import { useOAuthConsent } from '@/hooks/useOAuthConsent';

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient();
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAuthorization.mockResolvedValue({ kind: 'redirect', redirectUrl: 'https://claude.ai/cb' });
  mockEq.mockResolvedValue({ data: [{ role: 'owner' }, { role: 'staff' }, { role: 'kiosk' }, { role: null }], error: null });
});

describe('useOAuthConsent', () => {
  it('does not fetch without an authorization id or a user', () => {
    renderHook(() => useOAuthConsent(null, 'u-1'), { wrapper });
    renderHook(() => useOAuthConsent('a-1', null), { wrapper });
    expect(mockGetAuthorization).not.toHaveBeenCalled();
    expect(mockEq).not.toHaveBeenCalled();
  });

  it('counts only the restaurants that the connector can read', async () => {
    const { result } = renderHook(() => useOAuthConsent('a-1', 'u-1'), { wrapper });
    await waitFor(() => expect(result.current.connectorRestaurantCount.data).toBe(1));
    expect(mockEq).toHaveBeenCalledWith('user_id', 'u-1');
  });

  it('does not retry a failed authorization lookup', async () => {
    mockGetAuthorization.mockRejectedValue(new Error('gone'));
    const { result } = renderHook(() => useOAuthConsent('a-1', 'u-1'), { wrapper });
    await waitFor(() => expect(result.current.authorization.isError).toBe(true));
    expect(mockGetAuthorization).toHaveBeenCalledTimes(1);
  });

  it('sends the decision for the authorization id', async () => {
    mockSubmitConsent.mockResolvedValue('https://claude.ai/cb?code=1');
    const { result } = renderHook(() => useOAuthConsent('a-1', 'u-1'), { wrapper });
    await expect(result.current.decision.mutateAsync('approve')).resolves.toBe('https://claude.ai/cb?code=1');
    expect(mockSubmitConsent).toHaveBeenCalledWith('a-1', 'approve');
  });
});
