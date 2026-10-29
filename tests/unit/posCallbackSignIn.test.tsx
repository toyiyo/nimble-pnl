import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const mockGetSession = vi.hoisted(() => vi.fn());
const mockInvoke = vi.hoisted(() => vi.fn());
const mockToast = vi.hoisted(() => vi.fn());
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { auth: { getSession: mockGetSession }, functions: { invoke: mockInvoke } },
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mockToast }) }));
vi.mock('posthog-js', () => ({ default: {} }));
vi.mock('@/lib/analytics', () => ({ recordPosIntegrationCompleted: vi.fn() }));

import SquareCallback from '@/pages/SquareCallback';
import CloverCallback from '@/pages/CloverCallback';
import ToastCallback from '@/pages/ToastCallback';
import { peekConsentReturnPath } from '@/lib/oauthReturnPath';
import { redirectToSignInIfSignedOut } from '@/lib/posCallbackSignIn';

const CODE = 'qa-code-123';
const STATE = 'eyJwIjoic3F1YXJlIn0.c2lnbmF0dXJl';

const PAGES = [
  ['square', 'Square', SquareCallback],
  ['clover', 'Clover', CloverCallback],
  ['toast', 'Toast', ToastCallback],
] as const;

function renderAt(slug: string, Page: React.ComponentType, search = `?code=${CODE}&state=${STATE}`) {
  return render(
    <MemoryRouter initialEntries={[`/${slug}/callback${search}`]}>
      <Routes>
        <Route path={`/${slug}/callback`} element={<Page />} />
        <Route path="/auth" element={<div>AUTH PAGE</div>} />
        <Route path="/integrations" element={<div>INTEGRATIONS</div>} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

describe.each(PAGES)('%s callback page', (slug, name, Page) => {
  it('should save the callback URL and open sign-in when there is no session', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } });
    renderAt(slug, Page);
    expect(await screen.findByText('AUTH PAGE')).toBeInTheDocument();
    expect(peekConsentReturnPath()).toBe(`/${slug}/callback?code=${CODE}&state=${STATE}`);
    expect(mockInvoke).not.toHaveBeenCalled();
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ description: `Sign in to finish the ${name} connection.` })
    );
  });

  it('should call the edge function with the code and state when a session exists', async () => {
    mockGetSession.mockResolvedValue({ data: { session: { access_token: 't' } } });
    mockInvoke.mockResolvedValue({ data: { success: true }, error: null });
    renderAt(slug, Page);
    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith(`${slug}-oauth`, {
        body: { action: 'callback', code: CODE, state: STATE },
      })
    );
    expect(peekConsentReturnPath()).toBeNull();
  });
});

describe('redirectToSignInIfSignedOut', () => {
  const navigate = vi.fn();

  beforeEach(() => {
    navigate.mockClear();
  });

  it('should return false and do nothing when a session exists', async () => {
    const result = await redirectToSignInIfSignedOut({
      provider: 'square',
      code: CODE,
      state: STATE,
      getSession: async () => ({ data: { session: { access_token: 't' } } }),
      navigate,
    });
    expect(result).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
    expect(peekConsentReturnPath()).toBeNull();
  });

  it('should not open sign-in when the state is not safe, so the callback can reject it', async () => {
    const result = await redirectToSignInIfSignedOut({
      provider: 'square',
      code: CODE,
      state: 'not-a-signed-state',
      getSession: async () => ({ data: { session: null } }),
      navigate,
    });
    expect(result).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
    expect(peekConsentReturnPath()).toBeNull();
  });

  it('should not open sign-in when storage refuses the return path', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    try {
      const result = await redirectToSignInIfSignedOut({
        provider: 'square',
        code: CODE,
        state: STATE,
        getSession: async () => ({ data: { session: null } }),
        navigate,
      });
      expect(result).toBe(false);
      expect(navigate).not.toHaveBeenCalled();
    } finally {
      setItem.mockRestore();
    }
  });

  it('should treat a getSession failure as signed out', async () => {
    const result = await redirectToSignInIfSignedOut({
      provider: 'toast',
      code: CODE,
      state: STATE,
      getSession: async () => {
        throw new Error('storage blocked');
      },
      navigate,
    });
    expect(result).toBe(true);
    expect(peekConsentReturnPath()).toBe(`/toast/callback?code=${CODE}&state=${STATE}`);
  });
});
