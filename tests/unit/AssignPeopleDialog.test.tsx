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

// The batch mutation is mocked at the hook boundary; useAssignRole.test.ts
// covers the loop, the failure capture and the single onSettled refresh.
const assignPeople = vi.fn();
vi.mock('@/hooks/useAssignRole', async () => {
  const actual =
    await vi.importActual<typeof import('@/hooks/useAssignRole')>('@/hooks/useAssignRole');
  return {
    ...actual,
    useAssignPeopleToRole: () => ({ mutateAsync: assignPeople, isPending: false }),
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
    assignPeople.mockReset();
    toast.mockReset();
    props.onOpenChange.mockReset();
    assignPeople.mockResolvedValue({ landed: 0, failures: [] });
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

  it('hands the whole selection to the batch mutation in one call, and closes', async () => {
    const dana = member({});
    const sam = member({ membershipId: 'm2', userId: 'u2', fullName: 'Sam Ortiz' });
    mockUseRestaurantMembers.mockReturnValue(loaded([dana, sam]));
    assignPeople.mockResolvedValue({ landed: 2, failures: [] });
    render(<AssignPeopleDialog {...props} />);

    await userEvent.click(screen.getByText('Dana Reyes'));
    await userEvent.click(screen.getByText('Sam Ortiz'));
    await userEvent.click(screen.getByRole('button', { name: 'Assign 2' }));

    // One call for the batch, not one per person — the invalidation storm this
    // dialog would otherwise cause is the reason the mutation takes a list.
    await waitFor(() => expect(assignPeople).toHaveBeenCalledTimes(1));
    // A custom role sends the bare literal plus its id, never its own name.
    expect(assignPeople).toHaveBeenCalledWith({
      members: [dana, sam],
      role: 'collaborator_custom',
      roleId: 'role-weekend',
    });
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: '2 people are now Weekend Lead' })
    );
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
  });

  it('sends a builtin role by name with no role id', async () => {
    const dana = member({});
    mockUseRestaurantMembers.mockReturnValue(loaded([dana]));
    assignPeople.mockResolvedValue({ landed: 1, failures: [] });
    render(
      <AssignPeopleDialog
        {...props}
        role={{ ...role, id: 'role-manager', name: 'Manager', legacy_role: 'manager' }}
      />
    );

    await userEvent.click(screen.getByText('Dana Reyes'));
    await userEvent.click(screen.getByRole('button', { name: 'Assign 1' }));

    await waitFor(() =>
      expect(assignPeople).toHaveBeenCalledWith({
        members: [dana],
        role: 'manager',
        roleId: undefined,
      })
    );
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

    expect(assignPeople).not.toHaveBeenCalled();
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
    const sam = member({ membershipId: 'm2', userId: 'u2', fullName: 'Sam Ortiz' });
    mockUseRestaurantMembers.mockReturnValue(loaded([member({}), sam]));
    assignPeople.mockResolvedValue({
      landed: 1,
      failures: [{ member: sam, message: 'Only an owner can change an owner.' }],
    });
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
