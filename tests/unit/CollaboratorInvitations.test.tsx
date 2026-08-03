/**
 * CollaboratorInvitations – blocking invites to existing team members.
 *
 * `useCollaborators` is mocked so we can spy on the send-invitation
 * mutation without hitting Supabase directly; `useRestaurantMembers` is
 * mocked to control the roster while `findMemberByEmail` (the pure
 * matcher under test) stays real, mirroring the TeamInvitations pattern.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ------------------------------------------------------------------
// Mock useCollaborators BEFORE importing the component (hoisting
// requirement). Only `useSendCollaboratorInvitation`'s `mutate` is
// asserted on; the rest return empty/idle data so the card renders
// without extra loading/error states getting in the way.
// ------------------------------------------------------------------
const mockSendMutate = vi.fn();

vi.mock('@/hooks/useCollaborators', () => ({
  useCollaboratorsQuery: vi.fn(() => ({ data: [], isLoading: false, error: null })),
  useCollaboratorInvitesQuery: vi.fn(() => ({ data: [], isLoading: false, error: null })),
  useSendCollaboratorInvitation: vi.fn(() => ({ mutate: mockSendMutate, isPending: false })),
  useCancelCollaboratorInvitation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useRemoveCollaborator: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useResendCollaboratorInvitation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
}));

// Also mock useToast to avoid unrelated render issues
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

// Mock only the useRestaurantMembers hook (the React Query call); keep
// findMemberByEmail real since it's a pure function and is exactly the
// logic under test in the "blocking" tests below.
const mockUseRestaurantMembers = vi.fn(() => ({ data: [], isLoading: false, isError: false }));
vi.mock('@/hooks/useRestaurantMembers', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useRestaurantMembers')>(
    '@/hooks/useRestaurantMembers'
  );
  return {
    ...actual,
    useRestaurantMembers: (...args: unknown[]) => mockUseRestaurantMembers(...args),
  };
});

// Also mock useAccountlessEmployees (the React Query call) so this file's
// tests — which render the component without a QueryClientProvider — don't
// hit the real hook. Keep findAccountlessEmployeeByEmail real; it's exercised
// separately in CollaboratorInvitations.hint.test.tsx.
const mockUseAccountlessEmployees = vi.fn(() => ({ data: [], isLoading: false, isError: false }));
vi.mock('@/hooks/useAccountlessEmployees', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useAccountlessEmployees')>(
    '@/hooks/useAccountlessEmployees'
  );
  return {
    ...actual,
    useAccountlessEmployees: (...args: unknown[]) => mockUseAccountlessEmployees(...args),
  };
});

// The picker offers the restaurant's custom roles alongside the four builtin
// presets, so it now calls useRoles. These tests render without a
// QueryClientProvider, so the real hook cannot run.
const mockUseRoles = vi.fn(() => ({ roles: [], isLoading: false, error: null }));
vi.mock('@/hooks/useRoles', () => ({
  useRoles: (...args: unknown[]) => mockUseRoles(...args),
}));

import { CollaboratorInvitations } from '@/components/CollaboratorInvitations';

const RESTAURANT_ID = 'rest-123';

/** A restaurant-scoped custom role, as `useRoles` hands it to the picker. */
const CUSTOM_ROLE_ROW = {
  id: 'role-42',
  restaurant_id: RESTAURANT_ID,
  name: 'Weekend Lead',
  description: 'Runs Saturday service',
  flavor: 'collaborator' as const,
  builtin: false,
  created_at: '2026-07-01T00:00:00Z',
  role_areas: [{ area_key: 'scheduling' as const, level: 'manage' as const }],
  role_flags: [],
  memberCount: 0,
};

function renderInvitations() {
  return render(<CollaboratorInvitations restaurantId={RESTAURANT_ID} userRole="owner" />);
}

async function pickAccountantPreset(user: ReturnType<typeof userEvent.setup>) {
  // Advances the two-step flow (role preset -> email input) to the email
  // step, where the existing-member guard lives.
  await user.click(screen.getByRole('button', { name: /accountant/i }));
}

describe('CollaboratorInvitations – blocking invites to existing members', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: nobody on the roster matches — every test below overrides
    // this when it needs an existing member (or a lookup error).
    mockUseRestaurantMembers.mockReturnValue({ data: [], isLoading: false, isError: false });
    mockUseAccountlessEmployees.mockReturnValue({ data: [], isLoading: false, isError: false });
    mockUseRoles.mockReturnValue({ roles: [], isLoading: false, error: null });
  });

  it('blocks a collaborator invite for an email that is already a member', async () => {
    mockUseRestaurantMembers.mockReturnValue({
      data: [{ userId: 'u1', email: 'book@cpa.example', fullName: 'Dana Books', role: 'staff' }],
      isError: false,
    });

    const user = userEvent.setup();
    renderInvitations();
    await pickAccountantPreset(user);
    await user.type(screen.getByLabelText(/email address/i), 'book@cpa.example');

    const panel = await screen.findByRole('status');
    expect(panel).toHaveTextContent(/already on your team/i);

    const send = screen.getByRole('button', { name: /send invite/i });
    expect(send).toHaveAttribute('aria-disabled', 'true');
    // Must stay focusable — a natively disabled button leaves the tab order
    // and announces nothing, stranding keyboard users.
    expect(send).not.toHaveAttribute('disabled');

    await user.click(send);
    expect(mockSendMutate).not.toHaveBeenCalled();
  });

  it('describes the email field with the explanation panel', async () => {
    mockUseRestaurantMembers.mockReturnValue({
      data: [{ userId: 'u1', email: 'book@cpa.example', fullName: 'Dana Books', role: 'staff' }],
      isError: false,
    });

    const user = userEvent.setup();
    renderInvitations();
    await pickAccountantPreset(user);
    await user.type(screen.getByLabelText(/email address/i), 'book@cpa.example');

    const panel = await screen.findByRole('status');
    const emailInput = screen.getByLabelText(/email address/i);
    expect(emailInput.getAttribute('aria-describedby')).toBe(panel.id);
  });

  it('sends normally for a non-member email', async () => {
    mockUseRestaurantMembers.mockReturnValue({
      data: [
        { userId: 'u1', email: 'someoneelse@cpa.example', fullName: 'Someone Else', role: 'staff' },
      ],
      isError: false,
    });

    const user = userEvent.setup();
    renderInvitations();
    await pickAccountantPreset(user);
    await user.type(screen.getByLabelText(/email address/i), 'stranger@example.com');

    const send = screen.getByRole('button', { name: /send invite/i });
    await user.click(send);

    expect(mockSendMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        restaurantId: RESTAURANT_ID,
        email: 'stranger@example.com',
        role: 'collaborator_accountant',
      }),
      expect.anything()
    );
  });

  it('fails open when the roster lookup errors', async () => {
    // undefined data (still-loading or failed) — findMemberByEmail treats
    // this as "proceed normally" per its own contract.
    mockUseRestaurantMembers.mockReturnValue({ data: undefined, isError: true });

    const user = userEvent.setup();
    renderInvitations();
    await pickAccountantPreset(user);
    await user.type(screen.getByLabelText(/email address/i), 'book@cpa.example');

    const send = screen.getByRole('button', { name: /send invite/i });
    expect(send).not.toHaveAttribute('aria-disabled', 'true');
  });
});

describe('CollaboratorInvitations – custom roles in the picker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseRestaurantMembers.mockReturnValue({ data: [], isLoading: false, isError: false });
    mockUseAccountlessEmployees.mockReturnValue({ data: [], isLoading: false, isError: false });
    mockUseRoles.mockReturnValue({ roles: [CUSTOM_ROLE_ROW], isLoading: false, error: null });
  });

  it('sends the shared literal plus the role id when a custom role is picked', async () => {
    const user = userEvent.setup();
    renderInvitations();
    await user.click(screen.getByRole('button', { name: /weekend lead/i }));
    await user.type(screen.getByLabelText(/email address/i), 'lead@example.com');
    await user.click(screen.getByRole('button', { name: /send invite/i }));

    // The bare literal without the id would be rejected by the endpoint; the
    // id without the literal would be read as a builtin role.
    expect(mockSendMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        restaurantId: RESTAURANT_ID,
        email: 'lead@example.com',
        role: 'collaborator_custom',
        roleId: 'role-42',
        roleLabel: 'Weekend Lead',
      }),
      expect.anything()
    );
  });

  it('shows the custom role\'s granted areas as chips instead of a feature list', async () => {
    const user = userEvent.setup();
    renderInvitations();
    await user.click(screen.getByRole('button', { name: /weekend lead/i }));

    // A custom role has no hand-written feature list, so its own grants have
    // to be what the inviter reads before sending.
    expect(await screen.findByText(/scheduling · manage/i)).toBeInTheDocument();
  });

  it('offers only custom collaborator roles — not builtins, not platform roles', async () => {
    // useRoles returns every role the restaurant can see, including the global
    // builtins and the platform-flavored ones (Owner, Manager, Chef...).
    // Offering those here would let an owner hand out staff-side access from
    // the collaborator picker, and would double the four preset cards.
    mockUseRoles.mockReturnValue({
      roles: [
        CUSTOM_ROLE_ROW,
        { ...CUSTOM_ROLE_ROW, id: 'role-b', name: 'Accountant', builtin: true, restaurant_id: null },
        { ...CUSTOM_ROLE_ROW, id: 'role-c', name: 'Kitchen Manager', flavor: 'platform' as const },
      ],
      isLoading: false,
      error: null,
    });

    render(<CollaboratorInvitations restaurantId={RESTAURANT_ID} userRole="owner" />);

    expect(screen.getByRole('button', { name: /weekend lead/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /kitchen manager/i })).not.toBeInTheDocument();
    // The builtin row shares its name with a preset card, so the preset must
    // remain the only "Accountant" button.
    expect(screen.getAllByRole('button', { name: /accountant/i })).toHaveLength(1);
  });

  it('keeps the builtin presets usable when the roles query fails', async () => {
    mockUseRoles.mockReturnValue({ roles: [], isLoading: false, error: new Error('boom') });

    const user = userEvent.setup();
    renderInvitations();
    expect(screen.getByText(/failed to load your custom roles/i)).toBeInTheDocument();

    await pickAccountantPreset(user);
    await user.type(screen.getByLabelText(/email address/i), 'stranger@example.com');
    await user.click(screen.getByRole('button', { name: /send invite/i }));

    expect(mockSendMutate).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'collaborator_accountant' }),
      expect.anything()
    );
  });
});
