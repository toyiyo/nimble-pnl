import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AssignPeopleDialog } from '@/components/roles/AssignPeopleDialog';
import type { RestaurantMember } from '@/hooks/useRestaurantMembers';
import type { RoleWithGrants } from '@/hooks/useRoles';

const mockUseRestaurantMembers = vi.fn();
vi.mock('@/hooks/useRestaurantMembers', () => ({
  useRestaurantMembers: (...a: unknown[]) => mockUseRestaurantMembers(...a),
}));

const assignMembershipRole = vi.fn();
const refresh = vi.fn();
vi.mock('@/hooks/useAssignRole', async () => {
  const actual =
    await vi.importActual<typeof import('@/hooks/useAssignRole')>('@/hooks/useAssignRole');
  return {
    ...actual,
    assignMembershipRole: (...a: unknown[]) => assignMembershipRole(...a),
    useRefreshAfterAssign: () => refresh,
  };
});

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'u-caller' } }) }));

const toast = vi.fn();
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast }) }));

const role: RoleWithGrants = {
  id: 'role-weekend',
  restaurant_id: 'r1',
  name: 'Weekend Lead',
  description: null,
  flavor: 'collaborator',
  builtin: false,
  legacy_role: null,
  created_at: '',
  role_areas: [],
  role_flags: [],
  memberCount: 0,
} as unknown as RoleWithGrants;

const member = (over: Partial<RestaurantMember>): RestaurantMember => ({
  membershipId: 'm1',
  userId: 'u1',
  email: 'dana@example.com',
  fullName: 'Dana Reyes',
  role: 'staff',
  roleId: null,
  ...over,
});

const props = {
  role,
  restaurantId: 'r1',
  callerRole: 'owner' as const,
  open: true,
  onOpenChange: vi.fn(),
};

const loaded = (members: RestaurantMember[]) => ({ data: members, isLoading: false, error: null });

describe('AssignPeopleDialog', () => {
  beforeEach(() => {
    mockUseRestaurantMembers.mockReset();
    assignMembershipRole.mockReset();
    refresh.mockReset();
    toast.mockReset();
    props.onOpenChange.mockReset();
    assignMembershipRole.mockResolvedValue(undefined);
  });

  // The row is a <label> wrapping a Radix Checkbox, which renders a <button
  // role="checkbox"> rather than a native input. A review flagged that as
  // possibly inert. <button> is a labelable element, so the label's activation
  // behaviour forwards the click — this pins it, because if it ever stops
  // being true the row text goes dead and nothing else would notice.
  it('ticks the row when you click the person, not just the checkbox', async () => {
    mockUseRestaurantMembers.mockReturnValue(loaded([member({})]));
    render(<AssignPeopleDialog {...props} />);

    expect(screen.getByText('Nobody selected')).toBeInTheDocument();
    await userEvent.click(screen.getByText('Dana Reyes'));

    expect(screen.getByRole('checkbox')).toBeChecked();
    expect(screen.getByText('1 person selected')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Assign 1' })).toBeEnabled();
  });

  it('assigns the ticked people, refreshes once, and closes', async () => {
    mockUseRestaurantMembers.mockReturnValue(
      loaded([member({}), member({ membershipId: 'm2', userId: 'u2', fullName: 'Sam Ortiz' })])
    );
    render(<AssignPeopleDialog {...props} />);

    await userEvent.click(screen.getByText('Dana Reyes'));
    await userEvent.click(screen.getByText('Sam Ortiz'));
    await userEvent.click(screen.getByRole('button', { name: 'Assign 2' }));

    await waitFor(() => expect(assignMembershipRole).toHaveBeenCalledTimes(2));
    // A custom role sends the bare literal plus its id, never its own name.
    expect(assignMembershipRole).toHaveBeenCalledWith({
      membershipId: 'm1',
      role: 'collaborator_custom',
      roleId: 'role-weekend',
    });
    // Once for the batch, not once per person.
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: '2 people are now Weekend Lead' })
    );
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
  });

  // The boundary the batch path gets wrong if the drop check sits after the
  // early return: everyone ticked leaves the candidate list, so no row is left
  // to untick, and a stale `selected` keeps "Assign 1" enabled forever.
  it('recovers when everyone ticked was assigned elsewhere first', async () => {
    mockUseRestaurantMembers.mockReturnValue(loaded([member({})]));
    const { rerender } = render(<AssignPeopleDialog {...props} />);

    await userEvent.click(screen.getByText('Dana Reyes'));
    expect(screen.getByRole('button', { name: 'Assign 1' })).toBeEnabled();

    // Another admin put Dana in this role while the dialog sat open, so the
    // background refetch drops her from the candidates.
    mockUseRestaurantMembers.mockReturnValue(
      loaded([member({ role: 'collaborator_custom', roleId: 'role-weekend' })])
    );
    rerender(<AssignPeopleDialog {...props} />);
    expect(screen.getByText('Everyone already holds this role.')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Assign 1' }));

    expect(assignMembershipRole).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith({
      title: 'Nothing left to assign',
      description: 'One person was already handled elsewhere and was skipped.',
    });
    // Back to a button that means what it says, rather than a permanent no-op.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Assign' })).toBeDisabled()
    );
    expect(props.onOpenChange).not.toHaveBeenCalled();
  });

  it('keeps the failed rows ticked and the dialog open on a partial failure', async () => {
    mockUseRestaurantMembers.mockReturnValue(
      loaded([member({}), member({ membershipId: 'm2', userId: 'u2', fullName: 'Sam Ortiz' })])
    );
    assignMembershipRole.mockImplementation(({ membershipId }: { membershipId: string }) =>
      membershipId === 'm2' ? Promise.reject(new Error('nope')) : Promise.resolve(undefined)
    );
    render(<AssignPeopleDialog {...props} />);

    await userEvent.click(screen.getByText('Dana Reyes'));
    await userEvent.click(screen.getByText('Sam Ortiz'));
    await userEvent.click(screen.getByRole('button', { name: 'Assign 2' }));

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ title: '1 assigned, 1 failed', variant: 'destructive' })
      )
    );
    // Only the failure stays ticked, so a retry cannot re-assign the one that landed.
    expect(screen.getByText('1 person selected')).toBeInTheDocument();
    expect(props.onOpenChange).not.toHaveBeenCalled();
  });
});
