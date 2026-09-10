import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { AcceptInvitation } from '@/pages/AcceptInvitation';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockInvoke = vi.hoisted(() => vi.fn());
const mockSignInWithPassword = vi.hoisted(() => vi.fn());
const mockSupabaseSignOut = vi.hoisted(() => vi.fn());

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    functions: { invoke: mockInvoke },
    auth: {
      signInWithPassword: mockSignInWithPassword,
      signOut: mockSupabaseSignOut,
    },
  },
}));

const mockUseAuth = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/useAuth', () => ({
  useAuth: mockUseAuth,
}));

const mockToast = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: mockToast }),
}));

const mockStoreSignupPath = vi.hoisted(() => vi.fn());
const mockRecordTeamMemberJoined = vi.hoisted(() => vi.fn());
vi.mock('@/lib/analytics', () => ({
  storeSignupPath: mockStoreSignupPath,
  recordTeamMemberJoined: mockRecordTeamMemberJoined,
}));

vi.mock('@/lib/invitationUtils', () => ({
  classifyInvitationError: () => 'invalid' as const,
}));

vi.mock('@/utils/nativeRedirect', () => ({
  signInWithOAuthNative: vi.fn(),
}));

const mockPosthogReset = vi.hoisted(() => vi.fn());
vi.mock('posthog-js', () => ({
  default: { capture: vi.fn(), identify: vi.fn(), reset: mockPosthogReset },
}));

const INVITATION = {
  email: 'invitee@test.com',
  role: 'staff',
  restaurant: { name: 'Bar Bar' },
  invited_by: 'Owner Person',
  expires_at: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
};

function stubValidateAndAccept() {
  mockInvoke.mockImplementation((fn: string) => {
    if (fn === 'validate-invitation') {
      return Promise.resolve({ data: { success: true, invitation: INVITATION }, error: null });
    }
    if (fn === 'accept-invitation') {
      return Promise.resolve({ data: { success: true, message: 'Welcome to Bar Bar!' }, error: null });
    }
    if (fn === 'signup-with-invitation') {
      return Promise.resolve({ data: { success: true, message: 'Welcome to Bar Bar!' }, error: null });
    }
    throw new Error(`unexpected function ${fn}`);
  });
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/accept-invitation?token=tok123']}>
      <AcceptInvitation />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSignInWithPassword.mockResolvedValue({ error: null });
  mockSupabaseSignOut.mockResolvedValue({ error: null });
});

// ---------------------------------------------------------------------------
// Validation timing
// ---------------------------------------------------------------------------

describe('AcceptInvitation validation timing', () => {
  it('does not validate while auth still loads', () => {
    mockUseAuth.mockReturnValue({ user: null, loading: true });
    stubValidateAndAccept();

    renderPage();

    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('validates after auth settles and auto-accepts for a signed-in matching user', async () => {
    mockUseAuth.mockReturnValue({
      user: { id: 'u1', email: 'invitee@test.com' },
      loading: false,
    });
    stubValidateAndAccept();

    renderPage();

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('validate-invitation', expect.anything());
    });
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('accept-invitation', expect.anything());
    });
    await waitFor(() => {
      expect(mockRecordTeamMemberJoined).toHaveBeenCalledTimes(1);
    });
  });

  it('matches the invitation email case-insensitively', async () => {
    mockUseAuth.mockReturnValue({
      user: { id: 'u1', email: 'Invitee@Test.com' },
      loading: false,
    });
    stubValidateAndAccept();

    renderPage();

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('accept-invitation', expect.anything());
    });
  });

  it('auto-accepts only once when the user object identity changes', async () => {
    const firstUser = { id: 'u1', email: 'invitee@test.com' };
    mockUseAuth.mockReturnValue({ user: firstUser, loading: false });
    stubValidateAndAccept();

    const { rerender } = renderPage();

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('accept-invitation', expect.anything());
    });

    // A refreshed session delivers a new user object with the same id.
    mockUseAuth.mockReturnValue({ user: { ...firstUser }, loading: false });
    rerender(
      <MemoryRouter initialEntries={['/accept-invitation?token=tok123']}>
        <AcceptInvitation />
      </MemoryRouter>,
    );

    const acceptCalls = mockInvoke.mock.calls.filter(([fn]) => fn === 'accept-invitation');
    expect(acceptCalls).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Email mismatch
// ---------------------------------------------------------------------------

describe('AcceptInvitation email mismatch', () => {
  it('shows the mismatch screen with a sign-out action', async () => {
    mockUseAuth.mockReturnValue({
      user: { id: 'u2', email: 'someone-else@test.com' },
      loading: false,
    });
    stubValidateAndAccept();

    renderPage();

    await waitFor(() => {
      expect(screen.getByText(/invitee@test\.com/)).toBeInTheDocument();
      expect(screen.getByText(/someone-else@test\.com/)).toBeInTheDocument();
    });

    const signOutButton = screen.getByRole('button', { name: /sign out and switch account/i });
    fireEvent.click(signOutButton);

    await waitFor(() => {
      expect(mockSupabaseSignOut).toHaveBeenCalledWith({ scope: 'local' });
    });
    // The next account in this browser must not merge into this PostHog
    // person — same rule as useAuth.signOut.
    expect(mockPosthogReset).toHaveBeenCalled();
    expect(mockInvoke).not.toHaveBeenCalledWith('accept-invitation', expect.anything());
  });

  it('still resets the identity when the sign-out rejects', async () => {
    mockUseAuth.mockReturnValue({
      user: { id: 'u2', email: 'someone-else@test.com' },
      loading: false,
    });
    stubValidateAndAccept();
    mockSupabaseSignOut.mockRejectedValueOnce(new Error('403'));

    renderPage();

    const signOutButton = await screen.findByRole('button', {
      name: /sign out and switch account/i,
    });
    fireEvent.click(signOutButton);

    // A 403 from GoTrue must not strand the "Wrong Account" card:
    // the reset and the reload still run.
    await waitFor(() => {
      expect(mockPosthogReset).toHaveBeenCalled();
    });
  });
});

// ---------------------------------------------------------------------------
// Session arrival while the auth forms show
// ---------------------------------------------------------------------------

describe('AcceptInvitation session arrival on needs_auth', () => {
  it('promotes needs_auth to valid and accepts when a matching user arrives', async () => {
    mockUseAuth.mockReturnValue({ user: null, loading: false });
    stubValidateAndAccept();

    const { rerender } = renderPage();

    await waitFor(() => {
      expect(screen.getByLabelText('Full Name')).toBeInTheDocument();
    });

    // A sign-in from another tab delivers the session.
    mockUseAuth.mockReturnValue({
      user: { id: 'u1', email: 'invitee@test.com' },
      loading: false,
    });
    rerender(
      <MemoryRouter initialEntries={['/accept-invitation?token=tok123']}>
        <AcceptInvitation />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('accept-invitation', expect.anything());
    });
  });
});

// ---------------------------------------------------------------------------
// Signup auto sign-in
// ---------------------------------------------------------------------------

describe('AcceptInvitation signup auto sign-in', () => {
  it('signs in with the typed password after the signup succeeds', async () => {
    mockUseAuth.mockReturnValue({ user: null, loading: false });
    stubValidateAndAccept();

    renderPage();

    await waitFor(() => {
      expect(screen.getByLabelText('Full Name')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText('Full Name'), { target: { value: 'Ada Invitee' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Join Team' }));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('signup-with-invitation', expect.anything());
    });
    await waitFor(() => {
      expect(mockSignInWithPassword).toHaveBeenCalledWith({
        email: 'invitee@test.com',
        password: 'secret123',
      });
    });

    // The manual sign-in form must not appear on the happy path.
    expect(screen.queryByRole('button', { name: 'Sign In & Join Team' })).toBeNull();
  });

  it('falls back to the manual sign-in form when the auto sign-in fails', async () => {
    mockUseAuth.mockReturnValue({ user: null, loading: false });
    stubValidateAndAccept();
    mockSignInWithPassword.mockResolvedValue({ error: { message: 'invalid credentials' } });

    renderPage();

    await waitFor(() => {
      expect(screen.getByLabelText('Full Name')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText('Full Name'), { target: { value: 'Ada Invitee' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Join Team' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Sign In & Join Team' })).toBeInTheDocument();
    });
  });
});
