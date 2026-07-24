/**
 * CollaboratorInvitations – accountless-employee "will link" inform panel.
 *
 * Mirrors tests/unit/TeamInvitations.hint.test.tsx: precedence under test is
 * existing member (block) beats accountless-employee (inform hint) beats
 * normal. The hint must also stay suppressed while the members query hasn't
 * settled yet, so it never flashes before a block that lands a moment later
 * (both queries fail open to null while loading).
 *
 * `useCollaborators` is mocked so we can spy on the send-invitation mutation
 * without hitting Supabase directly; `useRestaurantMembers` /
 * `useAccountlessEmployees` are mocked to control the rosters while
 * `findMemberByEmail` / `findAccountlessEmployeeByEmail` (the pure matchers
 * under test) stay real, mirroring the TeamInvitations pattern.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockSendMutate = vi.fn();

vi.mock('@/hooks/useCollaborators', () => ({
  useCollaboratorsQuery: vi.fn(() => ({ data: [], isLoading: false, error: null })),
  useCollaboratorInvitesQuery: vi.fn(() => ({ data: [], isLoading: false, error: null })),
  useSendCollaboratorInvitation: vi.fn(() => ({ mutate: mockSendMutate, isPending: false })),
  useCancelCollaboratorInvitation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useRemoveCollaborator: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useResendCollaboratorInvitation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

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

import { CollaboratorInvitations } from '@/components/CollaboratorInvitations';

const RESTAURANT_ID = 'rest-123';

function renderInvitations() {
  return render(<CollaboratorInvitations restaurantId={RESTAURANT_ID} userRole="owner" />);
}

async function pickAccountantPreset(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /accountant/i }));
}

describe('CollaboratorInvitations – accountless-employee inform hint', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseRestaurantMembers.mockReturnValue({ data: [], isLoading: false, isError: false });
    mockUseAccountlessEmployees.mockReturnValue({ data: [], isLoading: false, isError: false });
  });

  it('shows the member block, not the hint, when the email matches both an existing member and an accountless employee', async () => {
    mockUseRestaurantMembers.mockReturnValue({
      data: [{ userId: 'u1', email: 'book@cpa.example', fullName: 'Dana Books', role: 'staff' }],
      isLoading: false,
      isError: false,
    });
    mockUseAccountlessEmployees.mockReturnValue({
      data: [{ id: 'emp-1', name: 'Dana Books', email: 'book@cpa.example' }],
      isLoading: false,
      isError: false,
    });

    const user = userEvent.setup();
    renderInvitations();
    await pickAccountantPreset(user);
    await user.type(screen.getByLabelText(/email address/i), 'book@cpa.example');

    const panel = await screen.findByRole('status');
    expect(panel).toHaveTextContent(/already on your team/i);
    expect(screen.queryByText(/is already set up for scheduling here/i)).toBeNull();
    expect(screen.getAllByRole('status')).toHaveLength(1);
  });

  it('suppresses the hint while the members query is still loading, even if the accountless query already resolved', async () => {
    mockUseRestaurantMembers.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    mockUseAccountlessEmployees.mockReturnValue({
      data: [{ id: 'emp-1', name: 'Jordan Lee', email: 'jordan@cpa.example' }],
      isLoading: false,
      isError: false,
    });

    const user = userEvent.setup();
    renderInvitations();
    await pickAccountantPreset(user);
    await user.type(screen.getByLabelText(/email address/i), 'jordan@cpa.example');

    expect(screen.queryByText(/is already set up for scheduling here/i)).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows the inform hint, keeps Send enabled, and includes employeeId in the mutation for an accountless-only match', async () => {
    mockUseRestaurantMembers.mockReturnValue({ data: [], isLoading: false, isError: false });
    mockUseAccountlessEmployees.mockReturnValue({
      data: [{ id: 'emp-1', name: 'Jordan Lee', email: 'jordan@cpa.example' }],
      isLoading: false,
      isError: false,
    });

    const user = userEvent.setup();
    renderInvitations();
    await pickAccountantPreset(user);
    await user.type(screen.getByLabelText(/email address/i), 'jordan@cpa.example');

    const panel = await screen.findByRole('status');
    expect(panel).toHaveTextContent(/Jordan Lee/);
    expect(panel).toHaveTextContent(/is already set up for scheduling here/i);

    const send = screen.getByRole('button', { name: /send invite/i });
    expect(send).not.toHaveAttribute('aria-disabled', 'true');
    const emailInput = screen.getByLabelText(/email address/i);
    expect(emailInput.getAttribute('aria-describedby')).toBe(panel.id);

    await user.click(send);

    expect(mockSendMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        restaurantId: RESTAURANT_ID,
        email: 'jordan@cpa.example',
        employeeId: 'emp-1',
      }),
      expect.anything()
    );
  });
});
