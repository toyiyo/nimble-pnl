import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const mockUseAuth = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/useAuth', () => ({ useAuth: mockUseAuth }));
vi.mock('@/hooks/useSSO', () => ({
  useSSO: () => ({ checkSSORequired: () => null, initiateSSO: vi.fn() }),
}));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));
vi.mock('@/components/SSOProviderButtons', () => ({ SSOProviderButtons: () => null }));
vi.mock('@/components/AppLogo', () => ({ AppLogo: () => null }));
vi.mock('@/components/GoogleSignInButton', () => ({
  GoogleSignInButton: ({ onClick }: { onClick: () => void }) => (
    <button type="button" onClick={onClick}>Google</button>
  ),
}));
const mockSignInWithOAuthNative = vi.hoisted(() => vi.fn());
vi.mock('@/utils/nativeRedirect', () => ({ signInWithOAuthNative: mockSignInWithOAuthNative }));

import Auth from '@/pages/Auth';
import { peekConsentReturnPath, saveConsentReturnPath } from '@/lib/oauthReturnPath';

const CONSENT = '/oauth/consent?authorization_id=auth-123';

function renderAuth() {
  return render(
    <MemoryRouter initialEntries={['/auth']}>
      <Routes>
        <Route path="/auth" element={<Auth />} />
        <Route path="/oauth/consent" element={<div>CONSENT PAGE</div>} />
        <Route path="/" element={<div>HOME</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mockSignInWithOAuthNative.mockResolvedValue({ error: null });
});

describe('Auth page with a Claude consent return path', () => {
  it('sends a signed-in user back to the consent page once', async () => {
    saveConsentReturnPath(CONSENT);
    mockUseAuth.mockReturnValue({ user: { id: 'u-1' }, signIn: vi.fn(), signUp: vi.fn() });
    renderAuth();
    expect(await screen.findByText('CONSENT PAGE')).toBeInTheDocument();
    expect(peekConsentReturnPath()).toBeNull();
  });

  it('keeps the normal redirect when no return path exists', async () => {
    mockUseAuth.mockReturnValue({ user: { id: 'u-1' }, signIn: vi.fn(), signUp: vi.fn() });
    renderAuth();
    expect(await screen.findByText('HOME')).toBeInTheDocument();
  });

  it('asks Google to return to the consent page', async () => {
    saveConsentReturnPath(CONSENT);
    mockUseAuth.mockReturnValue({ user: null, signIn: vi.fn(), signUp: vi.fn() });
    renderAuth();
    fireEvent.click(screen.getAllByRole('button', { name: 'Google' })[0]);
    await waitFor(() => expect(mockSignInWithOAuthNative).toHaveBeenCalledWith('google', CONSENT));
  });

  it('asks Google to return to / without a return path', async () => {
    mockUseAuth.mockReturnValue({ user: null, signIn: vi.fn(), signUp: vi.fn() });
    renderAuth();
    fireEvent.click(screen.getAllByRole('button', { name: 'Google' })[0]);
    await waitFor(() => expect(mockSignInWithOAuthNative).toHaveBeenCalledWith('google', '/'));
  });
});
