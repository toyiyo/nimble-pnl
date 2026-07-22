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
const mockUseRestaurantMembers = vi.fn(() => ({ data: [], isError: false }));
vi.mock('@/hooks/useRestaurantMembers', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useRestaurantMembers')>(
    '@/hooks/useRestaurantMembers'
  );
  return {
    ...actual,
    useRestaurantMembers: (...args: unknown[]) => mockUseRestaurantMembers(...args),
  };
});

import { CollaboratorInvitations } from '@/components/CollaboratorInvitations';

const RESTAURANT_ID = 'rest-123';

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
    mockUseRestaurantMembers.mockReturnValue({ data: [], isError: false });
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

  it('describes the blocked button with the explanation panel', async () => {
    mockUseRestaurantMembers.mockReturnValue({
      data: [{ userId: 'u1', email: 'book@cpa.example', fullName: 'Dana Books', role: 'staff' }],
      isError: false,
    });

    const user = userEvent.setup();
    renderInvitations();
    await pickAccountantPreset(user);
    await user.type(screen.getByLabelText(/email address/i), 'book@cpa.example');

    const panel = await screen.findByRole('status');
    const send = screen.getByRole('button', { name: /send invite/i });
    expect(send.getAttribute('aria-describedby')).toBe(panel.id);
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
