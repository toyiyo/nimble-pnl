import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

import { PendingInvitationsCard } from '@/components/PendingInvitationsCard';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockUsePendingInvitations = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/usePendingInvitations', () => ({
  usePendingInvitations: mockUsePendingInvitations,
}));

const INVITATION = {
  invitationId: 'inv-1',
  restaurantName: 'Bar Bar',
  role: 'staff',
  expiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PendingInvitationsCard', () => {
  it('renders a loading placeholder while the query loads', () => {
    mockUsePendingInvitations.mockReturnValue({
      invitations: [],
      isLoading: true,
      error: null,
      accept: vi.fn(),
      accepting: false,
    });

    render(<PendingInvitationsCard />);

    expect(screen.getByTestId('pending-invitations-loading')).toBeInTheDocument();
  });

  it('renders nothing when there are no invitations', () => {
    mockUsePendingInvitations.mockReturnValue({
      invitations: [],
      isLoading: false,
      error: null,
      accept: vi.fn(),
      accepting: false,
    });

    const { container } = render(<PendingInvitationsCard />);

    expect(container.firstChild).toBeNull();
  });

  it('renders nothing on a query error (the email link stays the fallback)', () => {
    mockUsePendingInvitations.mockReturnValue({
      invitations: [],
      isLoading: false,
      error: new Error('boom'),
      accept: vi.fn(),
      accepting: false,
    });

    const { container } = render(<PendingInvitationsCard />);

    expect(container.firstChild).toBeNull();
  });

  it('lists the restaurant, the role, and an accessible Accept button', () => {
    mockUsePendingInvitations.mockReturnValue({
      invitations: [INVITATION],
      isLoading: false,
      error: null,
      accept: vi.fn(),
      accepting: false,
    });

    render(<PendingInvitationsCard />);

    expect(screen.getByText('Bar Bar')).toBeInTheDocument();
    // The role renders through ROLE_METADATA, the same label source as the
    // Team page — 'staff' maps to "Employee (self-service)".
    expect(screen.getByText(/Employee \(self-service\)/)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Accept invitation to Bar Bar' }),
    ).toBeInTheDocument();
  });

  it('calls accept with the invitation id on click', () => {
    const accept = vi.fn();
    mockUsePendingInvitations.mockReturnValue({
      invitations: [INVITATION],
      isLoading: false,
      error: null,
      accept,
      accepting: false,
    });

    render(<PendingInvitationsCard />);

    fireEvent.click(screen.getByRole('button', { name: 'Accept invitation to Bar Bar' }));

    expect(accept).toHaveBeenCalledWith('inv-1');
  });

  it('disables the button and shows Accepting... on the accepted row only', () => {
    const second = {
      invitationId: 'inv-2',
      restaurantName: 'Second Spot',
      role: 'staff',
      expiresAt: INVITATION.expiresAt,
    };
    mockUsePendingInvitations.mockReturnValue({
      invitations: [INVITATION, second],
      isLoading: false,
      error: null,
      accept: vi.fn(),
      accepting: true,
      acceptingId: 'inv-1',
    });

    render(<PendingInvitationsCard />);

    const clicked = screen.getByRole('button', { name: 'Accept invitation to Bar Bar' });
    expect(clicked).toBeDisabled();
    expect(clicked).toHaveTextContent('Accepting...');

    const other = screen.getByRole('button', { name: 'Accept invitation to Second Spot' });
    expect(other).toBeDisabled();
    expect(other).toHaveTextContent('Accept');
  });
});
