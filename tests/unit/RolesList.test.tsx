import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RolesList } from '../../src/components/roles/RolesList';
import type { RoleWithGrants } from '../../src/hooks/useRoles';

/**
 * Phase 4 task 9c (roles-and-areas plan, 2026-07-29): RolesList.tsx — the
 * card grid on the "Roles & areas" tab.
 *
 * Chip/badge/copy conventions asserted below (the " · manage" suffix, the
 * "No areas yet" fallback chip, "N person"/"N people", BUILT-IN vs Custom)
 * are transcribed from the approved prototype,
 * docs/design-reference/roles-and-areas.html (`renderRoles`), not invented.
 * Area *labels* ("Inventory & Purchasing", "Payroll", ...) come from the
 * already-built src/lib/permissions/areas.ts AREA_DEFINITIONS, the real
 * single source of truth, not the prototype's own (sometimes differently
 * worded) copy — see progress.md task 9a's note on this same distinction.
 */

vi.mock('../../src/hooks/useRoles');
vi.mock('../../src/hooks/useRestaurantMembers');

import { useRoles } from '../../src/hooks/useRoles';
import { useRestaurantMembers, type RestaurantMember } from '../../src/hooks/useRestaurantMembers';

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
);

/**
 * A card is two doors now (role-roster plan, 2026-08-03): the name block opens
 * the role's definition, the footer opens who holds it. So a card is addressed
 * as its `<article>` — `getByRole('button', {name: /accountant/i})` would be
 * ambiguous, both doors carry the role name.
 */
function card(name: RegExp | string) {
  return screen.getByRole('article', { name });
}

/** The definition door. Anchored so it never matches the people door's label. */
function nameDoor(roleName: string) {
  return within(card(roleName)).getByRole('button', { name: new RegExp(`^${roleName}`, 'i') });
}

function makeMember(overrides: Partial<RestaurantMember> = {}): RestaurantMember {
  return {
    membershipId: 'm-1',
    userId: 'u-1',
    role: 'chef',
    roleId: null,
    fullName: 'Dana Chef',
    email: 'dana@example.com',
    ...overrides,
  };
}

/**
 * What makes a role assignable as `collaborator_custom`: owned by *this*
 * restaurant, non-builtin, collaborator-flavored. All three are required — see
 * `isAssignableCustomRole` — so spreading them together keeps a fixture from
 * accidentally testing a row the server would reject.
 */
const CUSTOM_ROLE_FIELDS = {
  restaurant_id: 'rest-1',
  builtin: false,
  flavor: 'collaborator',
  legacy_role: null,
} satisfies Partial<RoleWithGrants>;

function makeRole(overrides: Partial<RoleWithGrants> = {}): RoleWithGrants {
  return {
    id: 'role-1',
    restaurant_id: null,
    name: 'Accountant',
    description: 'Keeps the books and closes the month',
    flavor: 'collaborator',
    builtin: true,
    // Null unless a test needs the builtin-role mapping the roster resolves
    // membership through (see lib/permissions/roleMembership.ts).
    legacy_role: null,
    created_at: '2026-07-01T00:00:00Z',
    role_areas: [],
    role_flags: [],
    memberCount: 0,
    ...overrides,
  };
}

function mockUseRoles(partial: Partial<ReturnType<typeof useRoles>>) {
  (useRoles as ReturnType<typeof vi.fn>).mockReturnValue({
    roles: [],
    isLoading: false,
    error: null,
    createRole: vi.fn(),
    updateRole: vi.fn(),
    copyRole: vi.fn(),
    isMutating: false,
    ...partial,
  });
}

function mockUseRestaurantMembers(members: RestaurantMember[] = []) {
  (useRestaurantMembers as ReturnType<typeof vi.fn>).mockReturnValue({
    data: members,
    isLoading: false,
    error: null,
  });
}

describe('RolesList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseRestaurantMembers();
  });

  it('shows a loading skeleton while roles are loading', () => {
    mockUseRoles({ isLoading: true });
    render(<RolesList restaurantId="rest-1" callerRole="owner" onSelectRole={vi.fn()} onNewRole={vi.fn()} onOpenPeople={vi.fn()} />, { wrapper });
    expect(screen.getByTestId('roles-list-loading')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /new role/i })).not.toBeInTheDocument();
  });

  it('shows an error message when the roles query fails', () => {
    mockUseRoles({ error: new Error('boom') });
    render(<RolesList restaurantId="rest-1" callerRole="owner" onSelectRole={vi.fn()} onNewRole={vi.fn()} onOpenPeople={vi.fn()} />, { wrapper });
    expect(screen.getByText(/failed to load roles/i)).toBeInTheDocument();
  });

  it('always renders the dashed "New role" card, even with zero roles', () => {
    mockUseRoles({ roles: [] });
    render(<RolesList restaurantId="rest-1" callerRole="owner" onSelectRole={vi.fn()} onNewRole={vi.fn()} onOpenPeople={vi.fn()} />, { wrapper });
    expect(screen.getByRole('button', { name: /new role/i })).toBeInTheDocument();
  });

  it('calls onNewRole when the "New role" card is clicked', async () => {
    const user = userEvent.setup();
    const onNewRole = vi.fn();
    mockUseRoles({ roles: [] });
    render(<RolesList restaurantId="rest-1" callerRole="owner" onSelectRole={vi.fn()} onNewRole={onNewRole} onOpenPeople={vi.fn()} />, { wrapper });
    await user.click(screen.getByRole('button', { name: /new role/i }));
    expect(onNewRole).toHaveBeenCalledTimes(1);
  });

  it('shows a BUILT-IN badge for a builtin role and a Custom badge for a custom role', () => {
    mockUseRoles({
      roles: [
        makeRole({ id: 'r-builtin', name: 'Accountant', builtin: true }),
        makeRole({ id: 'r-custom', name: 'Weekend Supervisor', builtin: false }),
      ],
    });
    render(<RolesList restaurantId="rest-1" callerRole="owner" onSelectRole={vi.fn()} onNewRole={vi.fn()} onOpenPeople={vi.fn()} />, { wrapper });

    expect(card(/accountant/i)).toHaveTextContent(/built-in/i);
    expect(card(/accountant/i)).not.toHaveTextContent(/custom/i);
    expect(card(/weekend supervisor/i)).toHaveTextContent(/custom/i);
  });

  it('shows "No areas yet" when a role has zero area grants', () => {
    mockUseRoles({ roles: [makeRole({ name: 'Empty Role', role_areas: [] })] });
    render(<RolesList restaurantId="rest-1" callerRole="owner" onSelectRole={vi.fn()} onNewRole={vi.fn()} onOpenPeople={vi.fn()} />, { wrapper });
    expect(card(/empty role/i)).toHaveTextContent(/no areas yet/i);
  });

  it('renders a manage-level chip with the " · manage" suffix, and a view-level chip without it', () => {
    mockUseRoles({
      roles: [
        makeRole({
          name: 'Operations Manager',
          role_areas: [
            { area_key: 'inventory', level: 'manage' },
            { area_key: 'reports', level: 'view' },
          ],
        }),
      ],
    });
    render(<RolesList restaurantId="rest-1" callerRole="owner" onSelectRole={vi.fn()} onNewRole={vi.fn()} onOpenPeople={vi.fn()} />, { wrapper });
    const opsCard = card(/operations manager/i);

    // Post menu-mirror re-cut, `inventory` and `reports` are separate rows —
    // no more "Inventory & Purchasing"/"Dashboard & Reports" bundle labels.
    expect(opsCard).toHaveTextContent(/inventory\s*·\s*manage/i);
    // The view-level chip carries the area label but never the "· manage" suffix.
    expect(opsCard).toHaveTextContent(/reports/i);
    expect(opsCard).not.toHaveTextContent(/reports\s*·\s*manage/i);
  });

  it('shows singular/plural member counts, and an action instead of a dead zero', () => {
    mockUseRoles({
      roles: [
        makeRole({ id: 'r0', name: 'Zero People', ...CUSTOM_ROLE_FIELDS, memberCount: 0 }),
        makeRole({ id: 'r1', name: 'One Person', memberCount: 1 }),
        makeRole({ id: 'r3', name: 'Three People', memberCount: 3 }),
      ],
    });
    render(<RolesList restaurantId="rest-1" callerRole="owner" onSelectRole={vi.fn()} onNewRole={vi.fn()} onOpenPeople={vi.fn()} />, { wrapper });

    expect(card(/one person/i)).toHaveTextContent('1 person');
    expect(card(/three people/i)).toHaveTextContent('3 people');
    // The bug this move exists to fix: an empty role used to read "0 people"
    // and go nowhere.
    expect(card(/zero people/i)).not.toHaveTextContent('0 people');
    expect(card(/zero people/i)).toHaveTextContent(/assign people/i);
  });

  it('counts from the server, not from the members it managed to load', () => {
    // A slow or denied members query costs avatars, not the count: the card
    // quotes role.memberCount, the same number the editor's save banner uses.
    mockUseRestaurantMembers([]);
    mockUseRoles({ roles: [makeRole({ id: 'r3', name: 'Three People', memberCount: 3 })] });
    render(<RolesList restaurantId="rest-1" callerRole="owner" onSelectRole={vi.fn()} onNewRole={vi.fn()} onOpenPeople={vi.fn()} />, { wrapper });

    expect(card(/three people/i)).toHaveTextContent('3 people');
  });

  it('shows initials for the people in a role, hidden from screen readers', () => {
    const role = makeRole({ id: 'r-chef', name: 'Chef', legacy_role: 'chef', memberCount: 1 });
    mockUseRestaurantMembers([makeMember({ role: 'chef', fullName: 'Dana Chef' })]);
    mockUseRoles({ roles: [role] });
    render(<RolesList restaurantId="rest-1" callerRole="owner" onSelectRole={vi.fn()} onNewRole={vi.fn()} onOpenPeople={vi.fn()} />, { wrapper });

    // Decoration beside a count that already says the same thing, so the face
    // pile is aria-hidden — the button's own label carries the meaning.
    expect(card(/^chef$/i)).toHaveTextContent('DC');
    expect(
      within(card(/^chef$/i)).getByRole('button', { name: /1 person in chef/i })
    ).toBeInTheDocument();
  });

  it('calls onSelectRole with the role when a card is clicked, including builtin roles (read-only open)', async () => {
    const user = userEvent.setup();
    const onSelectRole = vi.fn();
    const builtin = makeRole({ id: 'r-builtin', name: 'Accountant', builtin: true });
    mockUseRoles({ roles: [builtin] });
    render(<RolesList restaurantId="rest-1" callerRole="owner" onSelectRole={onSelectRole} onNewRole={vi.fn()} onOpenPeople={vi.fn()} />, { wrapper });

    await user.click(nameDoor('Accountant'));
    expect(onSelectRole).toHaveBeenCalledTimes(1);
    expect(onSelectRole).toHaveBeenCalledWith(builtin);
  });

  it('calls onOpenPeople — not onSelectRole — when a populated role\'s count is clicked', async () => {
    const user = userEvent.setup();
    const onOpenPeople = vi.fn();
    const onSelectRole = vi.fn();
    const role = makeRole({ id: 'r3', name: 'Three People', memberCount: 3 });
    mockUseRoles({ roles: [role] });
    render(
      <RolesList
        restaurantId="rest-1"
        callerRole="owner"
        onSelectRole={onSelectRole}
        onNewRole={vi.fn()}
        onOpenPeople={onOpenPeople}
      />,
      { wrapper }
    );

    await user.click(screen.getByRole('button', { name: /3 people in three people/i }));
    expect(onOpenPeople).toHaveBeenCalledWith(role);
    expect(onSelectRole).not.toHaveBeenCalled();
  });

  it('calls onOpenPeople when an empty role\'s "Assign people" action is clicked', async () => {
    const user = userEvent.setup();
    const onOpenPeople = vi.fn();
    const role = makeRole({ id: 'r0', name: 'Weekend Supervisor', ...CUSTOM_ROLE_FIELDS, memberCount: 0 });
    mockUseRoles({ roles: [role] });
    render(
      <RolesList
        restaurantId="rest-1"
        callerRole="owner"
        onSelectRole={vi.fn()}
        onNewRole={vi.fn()}
        onOpenPeople={onOpenPeople}
      />,
      { wrapper }
    );

    await user.click(
      screen.getByRole('button', { name: /nobody is in weekend supervisor yet\. assign people/i })
    );
    expect(onOpenPeople).toHaveBeenCalledWith(role);
  });

  it('offers no action on an empty role this caller cannot assign into', () => {
    // Kiosk is in no inviter's row — not even an owner's — because a kiosk is
    // provisioned from device setup, never handed to a person. Offering
    // "Assign people" here would open a panel that could not offer it either.
    mockUseRoles({
      roles: [makeRole({ id: 'rk', name: 'Kiosk', legacy_role: 'kiosk', memberCount: 0 })],
    });
    render(
      <RolesList
        restaurantId="rest-1"
        callerRole="owner"
        onSelectRole={vi.fn()}
        onNewRole={vi.fn()}
        onOpenPeople={vi.fn()}
      />,
      { wrapper }
    );

    expect(within(card('Kiosk')).getByText('Nobody yet')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /nobody is in kiosk yet\. assign people/i })
    ).not.toBeInTheDocument();
  });

  it('offers no action on a platform-flavored role the restaurant happens to own', () => {
    // `copy_role_to_restaurants` copies the source row's flavor verbatim and
    // inserts with builtin = false and no legacy_role, so this row is
    // indistinguishable from a custom role by legacy_role alone — and
    // `assign_membership_role` still refuses it. Offering "Assign people" here
    // buys a 42501 for every person picked.
    mockUseRoles({
      roles: [
        makeRole({
          id: 'rp',
          name: 'Regional Ops',
          ...CUSTOM_ROLE_FIELDS,
          flavor: 'platform',
          memberCount: 0,
        }),
      ],
    });
    render(
      <RolesList
        restaurantId="rest-1"
        callerRole="owner"
        onSelectRole={vi.fn()}
        onNewRole={vi.fn()}
        onOpenPeople={vi.fn()}
      />,
      { wrapper }
    );

    expect(within(card('Regional Ops')).getByText('Nobody yet')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /assign people/i })
    ).not.toBeInTheDocument();
  });

  it('names the people door for what the caller can do there', () => {
    // A manager may not assign anyone to Owner, so the Owner roster is a
    // read-only list for them: every picker in it is disabled and there is no
    // assign action. Promising "Manage" would be a label the panel cannot honor.
    const owners = makeRole({ id: 'ro', name: 'Owner', legacy_role: 'owner', memberCount: 2 });
    mockUseRoles({ roles: [owners] });

    const { rerender } = render(
      <RolesList restaurantId="rest-1" callerRole="manager" onSelectRole={vi.fn()} onNewRole={vi.fn()} onOpenPeople={vi.fn()} />,
      { wrapper }
    );
    expect(
      within(card('Owner')).getByRole('button', { name: /2 people in owner\. see who's in this role/i })
    ).toBeInTheDocument();

    // Same card, a caller who can act on it.
    rerender(
      <RolesList restaurantId="rest-1" callerRole="owner" onSelectRole={vi.fn()} onNewRole={vi.fn()} onOpenPeople={vi.fn()} />
    );
    expect(
      within(card('Owner')).getByRole('button', { name: /2 people in owner\. manage who's in this role/i })
    ).toBeInTheDocument();
  });

  it('renders role cards before the "New role" card, in query order', () => {
    mockUseRoles({ roles: [makeRole({ id: 'r1', name: 'Accountant' })] });
    render(<RolesList restaurantId="rest-1" callerRole="owner" onSelectRole={vi.fn()} onNewRole={vi.fn()} onOpenPeople={vi.fn()} />, { wrapper });
    const buttons = screen.getAllByRole('button');
    expect(buttons[buttons.length - 1]).toHaveAccessibleName(/new role/i);
  });
});
