import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RoleEditor, type RoleEditorTab } from '../../src/components/roles/RoleEditor';
import type { RoleWithGrants } from '../../src/hooks/useRoles';
import type { UserRestaurant } from '../../src/hooks/useRestaurants';
import type { Role } from '../../src/lib/permissions/types';

/**
 * Phase 4 task 9d (roles-and-areas plan, 2026-07-29): RoleEditor.tsx — the
 * full-page, two-column role editor.
 *
 * This pins the same accessibility contract tests/e2e/roles-and-areas.spec.ts
 * already locks in at the browser level (RadioGroup semantics, capped-level
 * disabled + aria-describedby, Switch roles, the "N granted" counter, the
 * "← All roles" back button, labeled Role name / What this person does
 * inputs, "Save role" button text) — transcribed from that spec and from
 * docs/superpowers/specs/2026-07-29-roles-and-areas-design.md's "The role
 * editor" / "The live preview" / "Copy role to other restaurants" sections,
 * not invented. Area *labels* come from the already-built
 * src/lib/permissions/areas.ts AREA_DEFINITIONS (the real single source of
 * truth), same distinction progress.md's task 9a/9c notes already made.
 *
 * The per-area lock reasons ("Sales come from your POS — nobody edits them
 * here.", "Nothing there is editable.", "Owners and Managers only.",
 * "Owners and Managers only — a collaborator can never grant access.") are
 * transcribed from the approved prototype's AREAS array
 * (docs/design-reference/roles-and-areas.html) and the design doc's per-area
 * cap table, keyed onto AREA_DEFINITIONS' row keys, which line up 1:1 with
 * the prototype's own area keys.
 */

vi.mock('../../src/hooks/useRoles');
vi.mock('../../src/hooks/useRestaurants');

const toastMock = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: toastMock }) }));

import { useRoles } from '../../src/hooks/useRoles';
import { useRestaurants } from '../../src/hooks/useRestaurants';

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
);

/**
 * The Areas|People tab props, spread into every render below. Every assertion
 * in this file is about the Areas tab, so it is pinned open rather than left to
 * whatever the editor would default to — the People tab is `RoleRoster`'s own
 * test surface. `callerRole` is what the People tab hands to `RolePicker`.
 */
const editorProps = {
  callerRole: 'owner' as Role,
  activeTab: 'areas' as RoleEditorTab,
  onTabChange: vi.fn(),
};

function makeRole(overrides: Partial<RoleWithGrants> = {}): RoleWithGrants {
  return {
    id: 'role-1',
    restaurant_id: 'rest-1',
    name: 'Weekend Supervisor',
    description: 'Covers weekend shifts',
    flavor: 'collaborator',
    builtin: false,
    created_at: '2026-07-01T00:00:00Z',
    role_areas: [],
    role_flags: [],
    memberCount: 0,
    ...overrides,
  };
}

function makeUserRestaurant(overrides: Partial<UserRestaurant> = {}): UserRestaurant {
  return {
    id: 'ur-1',
    user_id: 'user-1',
    restaurant_id: 'rest-2',
    role: 'owner',
    roleRecord: null,
    created_at: '2026-07-01T00:00:00Z',
    restaurant: {
      id: 'rest-2',
      name: 'Cold Stone — Alamo Ranch',
      created_at: '2026-07-01T00:00:00Z',
      updated_at: '2026-07-01T00:00:00Z',
    },
    ...overrides,
  } as UserRestaurant;
}

function mockUseRoles(partial: Partial<ReturnType<typeof useRoles>> = {}) {
  (useRoles as ReturnType<typeof vi.fn>).mockReturnValue({
    roles: [],
    isLoading: false,
    error: null,
    createRole: vi.fn().mockResolvedValue('new-role-id'),
    updateRole: vi.fn().mockResolvedValue('role-1'),
    copyRole: vi.fn().mockResolvedValue({ copied: [], name_collisions: [] }),
    isMutating: false,
    ...partial,
  });
}

function mockUseRestaurants(partial: Partial<ReturnType<typeof useRestaurants>> = {}) {
  (useRestaurants as ReturnType<typeof vi.fn>).mockReturnValue({
    restaurants: [],
    loading: false,
    createRestaurant: vi.fn(),
    updateRestaurant: vi.fn(),
    refetch: vi.fn(),
    ...partial,
  });
}

describe('RoleEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseRoles();
    mockUseRestaurants();
  });

  it('renders a "All roles" back button and calls onBack when clicked', async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    render(<RoleEditor {...editorProps} restaurantId="rest-1" role={null} onBack={onBack} />, { wrapper });

    const back = screen.getByRole('button', { name: /all roles/i });
    await user.click(back);
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('renders labeled Role name / What this person does inputs, pre-filled when editing', () => {
    const role = makeRole({ name: 'Weekend Supervisor', description: 'Covers weekend shifts' });
    render(<RoleEditor {...editorProps} restaurantId="rest-1" role={role} onBack={vi.fn()} />, { wrapper });

    expect(screen.getByLabelText(/role name/i)).toHaveValue('Weekend Supervisor');
    expect(screen.getByLabelText(/what this person does/i)).toHaveValue('Covers weekend shifts');
  });

  it('shows the member-count warning banner with the exact copy for an existing role with members', () => {
    const role = makeRole({ memberCount: 2 });
    render(<RoleEditor {...editorProps} restaurantId="rest-1" role={role} onBack={vi.fn()} />, { wrapper });
    expect(
      screen.getByText(/2 people have this role\. saving changes what they can reach the next time they load a page\./i)
    ).toBeInTheDocument();
  });

  it('uses singular phrasing for a one-person member count', () => {
    const role = makeRole({ memberCount: 1 });
    render(<RoleEditor {...editorProps} restaurantId="rest-1" role={role} onBack={vi.fn()} />, { wrapper });
    expect(screen.getByText(/1 person has this role\./i)).toBeInTheDocument();
  });

  it('shows no member-count banner for a brand-new draft', () => {
    render(<RoleEditor {...editorProps} restaurantId="rest-1" role={null} onBack={vi.fn()} />, { wrapper });
    expect(screen.queryByText(/people have this role/i)).not.toBeInTheDocument();
  });

  it('shows no member-count banner for an existing role with zero members', () => {
    const role = makeRole({ memberCount: 0 });
    render(<RoleEditor {...editorProps} restaurantId="rest-1" role={role} onBack={vi.fn()} />, { wrapper });
    expect(screen.queryByText(/people have this role/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/person has this role/i)).not.toBeInTheDocument();
  });

  it('shows the built-in notice and disables Save with a describing hint for a builtin role', () => {
    const role = makeRole({ builtin: true, name: 'Accountant', memberCount: 3 });
    render(<RoleEditor {...editorProps} restaurantId="rest-1" role={role} onBack={vi.fn()} />, { wrapper });

    expect(screen.getByText(/built-in role/i)).toBeInTheDocument();
    expect(screen.getByText(/duplicate it to make a version you control/i)).toBeInTheDocument();
    // The builtin notice replaces the member-count one, even though this
    // builtin has members.
    expect(screen.queryByText(/people have this role/i)).not.toBeInTheDocument();

    const save = screen.getByRole('button', { name: /^save role$/i });
    expect(save).toBeDisabled();
    const describedBy = save.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)).toHaveTextContent(/read-only/i);
  });

  it('renders all ten area rows as RadioGroups with the "{Area} access" aria-label', () => {
    render(<RoleEditor {...editorProps} restaurantId="rest-1" role={null} onBack={vi.fn()} />, { wrapper });

    for (const label of [
      'Dashboard & Reports',
      'Sales',
      'Inventory & Purchasing',
      'Recipes',
      'Scheduling',
      'Money & Books',
      'Payroll',
      'Employees',
      'Team & Access',
      'Settings & Integrations',
    ]) {
      expect(screen.getByRole('radiogroup', { name: new RegExp(`^${label} access$`, 'i') })).toBeInTheDocument();
    }
  });

  it('caps Payroll at View: Manage is disabled with an aria-describedby reason mentioning owners and managers', () => {
    render(<RoleEditor {...editorProps} restaurantId="rest-1" role={null} onBack={vi.fn()} />, { wrapper });

    const payrollGroup = screen.getByRole('radiogroup', { name: /^payroll access$/i });
    const manage = within(payrollGroup).getByRole('radio', { name: /^manage$/i });
    expect(manage).toBeDisabled();
    expect(manage).toHaveAttribute('aria-disabled', 'true');
    const describedBy = manage.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)).toHaveTextContent(/owners and managers only/i);

    // View is not capped.
    expect(within(payrollGroup).getByRole('radio', { name: /^view$/i })).not.toBeDisabled();
  });

  it('makes Team & Access fully ungrantable: both View and Manage disabled with the same reason', () => {
    render(<RoleEditor {...editorProps} restaurantId="rest-1" role={null} onBack={vi.fn()} />, { wrapper });

    const teamGroup = screen.getByRole('radiogroup', { name: /^team & access access$/i });
    const view = within(teamGroup).getByRole('radio', { name: /^view$/i });
    const manage = within(teamGroup).getByRole('radio', { name: /^manage$/i });

    expect(view).toBeDisabled();
    expect(manage).toBeDisabled();

    const viewDescribedBy = view.getAttribute('aria-describedby');
    const manageDescribedBy = manage.getAttribute('aria-describedby');
    expect(viewDescribedBy).toBeTruthy();
    expect(manageDescribedBy).toBeTruthy();
    expect(document.getElementById(viewDescribedBy!)).toHaveTextContent(
      /owners and managers only.*collaborator can never grant access/i
    );
    expect(document.getElementById(manageDescribedBy!)).toHaveTextContent(
      /owners and managers only.*collaborator can never grant access/i
    );
  });

  it('does not cap Inventory & Purchasing or Scheduling at all', () => {
    render(<RoleEditor {...editorProps} restaurantId="rest-1" role={null} onBack={vi.fn()} />, { wrapper });

    const inventoryGroup = screen.getByRole('radiogroup', { name: /^inventory & purchasing access$/i });
    expect(within(inventoryGroup).getByRole('radio', { name: /^manage$/i })).not.toBeDisabled();

    const schedulingGroup = screen.getByRole('radiogroup', { name: /^scheduling access$/i });
    expect(within(schedulingGroup).getByRole('radio', { name: /^manage$/i })).not.toBeDisabled();
  });

  it('starts the grant counter at "0 granted" and updates it as areas are toggled', async () => {
    const user = userEvent.setup();
    render(<RoleEditor {...editorProps} restaurantId="rest-1" role={null} onBack={vi.fn()} />, { wrapper });

    const counter = screen.getByText(/^\d+\s+granted$/i);
    expect(counter).toHaveTextContent(/^0 granted$/i);

    const inventoryGroup = screen.getByRole('radiogroup', { name: /^inventory & purchasing access$/i });
    await user.click(within(inventoryGroup).getByRole('radio', { name: /^manage$/i }));

    expect(screen.getByText(/^\d+\s+granted$/i)).not.toHaveTextContent(/^0 granted$/i);
  });

  it('renders the three sensitive-data Switches with accessible names for costs and pay rates', () => {
    render(<RoleEditor {...editorProps} restaurantId="rest-1" role={null} onBack={vi.fn()} />, { wrapper });
    expect(screen.getByRole('switch', { name: /costs/i })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /pay rates/i })).toBeInTheDocument();
    expect(screen.getAllByRole('switch')).toHaveLength(3);
  });

  it('disables a sensitive-data switch with a "Needs access to" hint until a requiring area is granted', async () => {
    const user = userEvent.setup();
    render(<RoleEditor {...editorProps} restaurantId="rest-1" role={null} onBack={vi.fn()} />, { wrapper });

    const payRatesSwitch = screen.getByRole('switch', { name: /pay rates/i });
    expect(payRatesSwitch).toBeDisabled();
    // Every sensitive-data switch is unavailable on a blank draft, so scope
    // to the pay-rates row specifically rather than asserting on the page as
    // a whole (all three rows legitimately show a "Needs access to" hint at
    // once here).
    const payRatesRow = screen.getByTestId('flag-row-view:pay_rates');
    expect(within(payRatesRow).getByText(/needs access to/i)).toBeInTheDocument();

    const employeesGroup = screen.getByRole('radiogroup', { name: /^employees access$/i });
    await user.click(within(employeesGroup).getByRole('radio', { name: /^manage$/i }));

    expect(screen.getByRole('switch', { name: /pay rates/i })).not.toBeDisabled();
  });

  it('calls createRole with the assembled draft and onBack on Save for a new role', async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    const createRole = vi.fn().mockResolvedValue('new-role-id');
    mockUseRoles({ createRole });
    render(<RoleEditor {...editorProps} restaurantId="rest-1" role={null} onBack={onBack} />, { wrapper });

    await user.type(screen.getByLabelText(/role name/i), 'Weekend Supervisor');
    const inventoryGroup = screen.getByRole('radiogroup', { name: /^inventory & purchasing access$/i });
    await user.click(within(inventoryGroup).getByRole('radio', { name: /^manage$/i }));

    await user.click(screen.getByRole('button', { name: /^save role$/i }));

    expect(createRole).toHaveBeenCalledTimes(1);
    const draft = createRole.mock.calls[0][0];
    expect(draft.name).toBe('Weekend Supervisor');
    expect(draft.areas).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ area_key: 'inventory', level: 'manage' }),
        expect.objectContaining({ area_key: 'purchasing', level: 'manage' }),
      ])
    );
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('calls updateRole with the role id on Save when editing an existing custom role', async () => {
    const user = userEvent.setup();
    const updateRole = vi.fn().mockResolvedValue('role-1');
    mockUseRoles({ updateRole });
    const role = makeRole({ id: 'role-1' });
    render(<RoleEditor {...editorProps} restaurantId="rest-1" role={role} onBack={vi.fn()} />, { wrapper });

    await user.click(screen.getByRole('button', { name: /^save role$/i }));

    expect(updateRole).toHaveBeenCalledTimes(1);
    expect(updateRole.mock.calls[0][0]).toEqual(expect.objectContaining({ id: 'role-1' }));
  });

  it('disables Save with a describing hint when the role name is empty', () => {
    const role = makeRole({ name: '' });
    render(<RoleEditor {...editorProps} restaurantId="rest-1" role={role} onBack={vi.fn()} />, { wrapper });

    const save = screen.getByRole('button', { name: /^save role$/i });
    expect(save).toBeDisabled();
    const describedBy = save.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)).toHaveTextContent(/role name is required/i);
  });

  it('shows a "Partial" marker instead of a control for a builtin row whose underlying areas split levels', () => {
    const role = makeRole({
      builtin: true,
      name: 'Operations Manager',
      role_areas: [{ area_key: 'settings', level: 'view' }],
    });
    render(<RoleEditor {...editorProps} restaurantId="rest-1" role={role} onBack={vi.fn()} />, { wrapper });

    expect(screen.queryByRole('radiogroup', { name: /^settings & integrations access$/i })).not.toBeInTheDocument();
    expect(screen.getByText(/partial/i)).toBeInTheDocument();
  });

  it('renders a fully-disabled control (not a Partial marker) for a builtin row whose areas agree', () => {
    const role = makeRole({
      builtin: true,
      name: 'Accountant',
      role_areas: [{ area_key: 'books', level: 'manage' }, { area_key: 'chart_of_accounts', level: 'manage' }],
    });
    render(<RoleEditor {...editorProps} restaurantId="rest-1" role={role} onBack={vi.fn()} />, { wrapper });

    const booksGroup = screen.getByRole('radiogroup', { name: /^money & books access$/i });
    expect(within(booksGroup).getByRole('radio', { name: /^manage$/i })).toBeDisabled();
    expect(within(booksGroup).getByRole('radio', { name: /^no access$/i })).toBeDisabled();
  });

  it('shows the copy-to-restaurants listbox only for an existing, non-builtin role', () => {
    mockUseRestaurants({
      restaurants: [
        makeUserRestaurant({ restaurant_id: 'rest-2', restaurant: { id: 'rest-2', name: 'Cold Stone', created_at: '', updated_at: '' } }),
        makeUserRestaurant({ restaurant_id: 'rest-1', restaurant: { id: 'rest-1', name: 'This one', created_at: '', updated_at: '' } }),
      ],
    });

    const { rerender } = render(<RoleEditor {...editorProps} restaurantId="rest-1" role={null} onBack={vi.fn()} />, { wrapper });
    expect(screen.queryByRole('listbox', { name: /other restaurants/i })).not.toBeInTheDocument();

    rerender(<RoleEditor {...editorProps} restaurantId="rest-1" role={makeRole({ builtin: true })} onBack={vi.fn()} />);
    expect(screen.queryByRole('listbox', { name: /other restaurants/i })).not.toBeInTheDocument();

    rerender(<RoleEditor {...editorProps} restaurantId="rest-1" role={makeRole({ builtin: false })} onBack={vi.fn()} />);
    const listbox = screen.getByRole('listbox', { name: /other restaurants/i });
    expect(within(listbox).getByRole('option', { name: /cold stone/i })).toBeInTheDocument();
    // The currently-selected restaurant is not offered as a copy target.
    expect(within(listbox).queryByRole('option', { name: /this one/i })).not.toBeInTheDocument();
  });

  it('offers only restaurants where the caller can manage collaborators', () => {
    mockUseRestaurants({
      restaurants: [
        makeUserRestaurant({ restaurant_id: 'rest-2', role: 'owner', restaurant: { id: 'rest-2', name: 'Owned', created_at: '', updated_at: '' } }),
        // Works there, does not administer it. copy_role_to_restaurants
        // authorizes every target before inserting anywhere and raises on the
        // first failure, so offering this one would fail the copy into
        // "Owned" as well — the picker filters instead of letting the RPC
        // teach that.
        makeUserRestaurant({ restaurant_id: 'rest-3', role: 'staff', restaurant: { id: 'rest-3', name: 'Just Works There', created_at: '', updated_at: '' } }),
        // Custom role with no ROLE_CAPABILITIES entry at all: resolved from
        // its embedded area grants, which do not include team management.
        makeUserRestaurant({
          restaurant_id: 'rest-4',
          role: 'collaborator_custom',
          roleRecord: {
            id: 'role-x',
            name: 'Weekend Floor Lead',
            flavor: 'collaborator',
            builtin: false,
            role_areas: [{ area_key: 'scheduling', level: 'manage' }],
            role_flags: [],
          },
          restaurant: { id: 'rest-4', name: 'Custom Role There', created_at: '', updated_at: '' },
        }),
      ],
    });

    render(<RoleEditor {...editorProps} restaurantId="rest-1" role={makeRole({ builtin: false })} onBack={vi.fn()} />, { wrapper });

    const listbox = screen.getByRole('listbox', { name: /other restaurants/i });
    expect(within(listbox).getByRole('option', { name: /owned/i })).toBeInTheDocument();
    expect(within(listbox).queryByRole('option', { name: /just works there/i })).not.toBeInTheDocument();
    expect(within(listbox).queryByRole('option', { name: /custom role there/i })).not.toBeInTheDocument();
  });

  it('calls copyRole with the selected restaurant ids and reports name collisions', async () => {
    const user = userEvent.setup();
    const copyRole = vi.fn().mockResolvedValue({ copied: ['rest-2'], name_collisions: [{ restaurant_id: 'rest-3', name: 'Weekend Supervisor' }] });
    mockUseRoles({ copyRole });
    mockUseRestaurants({
      restaurants: [
        makeUserRestaurant({ restaurant_id: 'rest-2', restaurant: { id: 'rest-2', name: 'Cold Stone', created_at: '', updated_at: '' } }),
        makeUserRestaurant({ restaurant_id: 'rest-3', restaurant: { id: 'rest-3', name: 'Wetzels', created_at: '', updated_at: '' } }),
      ],
    });

    render(<RoleEditor {...editorProps} restaurantId="rest-1" role={makeRole({ id: 'role-1' })} onBack={vi.fn()} />, { wrapper });

    const listbox = screen.getByRole('listbox', { name: /other restaurants/i });
    await user.selectOptions(listbox, ['rest-2']);
    await user.click(screen.getByRole('button', { name: /^copy role$/i }));

    expect(copyRole).toHaveBeenCalledWith({ roleId: 'role-1', targetRestaurantIds: ['rest-2'] });
    expect(await screen.findByText(/already exists/i)).toBeInTheDocument();
  });

  /**
   * Regression guards for two Phase 7a fixes that the Phase 7d re-review found
   * untested: the save payload is `effectiveFlags` (a flag whose backing areas
   * were revoked after it was switched on must not persist as granted), and a
   * rejected mutation surfaces a toast instead of leaving the editor sitting
   * there. Both would pass every other test in this file if reverted.
   */
  it('drops a sensitive flag from the save payload once its backing area is revoked', async () => {
    const user = userEvent.setup();
    const createRole = vi.fn().mockResolvedValue('new-role-id');
    mockUseRoles({ createRole });
    render(<RoleEditor {...editorProps} restaurantId="rest-1" role={null} onBack={vi.fn()} />, { wrapper });

    await user.type(screen.getByLabelText(/role name/i), 'Weekend Supervisor');

    // `view:employee_pii` requires only the Employees area, so revoking that
    // one area is enough to make the flag unavailable.
    const employeesGroup = screen.getByRole('radiogroup', { name: /^employees access$/i });
    await user.click(within(employeesGroup).getByRole('radio', { name: /^manage$/i }));

    const piiSwitch = screen.getByRole('switch', { name: /contact details/i });
    await user.click(piiSwitch);
    expect(piiSwitch).toBeChecked();

    await user.click(within(employeesGroup).getByRole('radio', { name: /^no access$/i }));
    // The switch renders off and disabled, so the payload must agree with it.
    const afterRevoke = screen.getByRole('switch', { name: /contact details/i });
    expect(afterRevoke).not.toBeChecked();
    expect(afterRevoke).toBeDisabled();

    await user.click(screen.getByRole('button', { name: /^save role$/i }));

    expect(createRole).toHaveBeenCalledTimes(1);
    expect(createRole.mock.calls[0][0].flags).not.toContain('view:employee_pii');
  });

  it('keeps a sensitive flag when its backing area is re-granted in the same session', async () => {
    const user = userEvent.setup();
    const createRole = vi.fn().mockResolvedValue('new-role-id');
    mockUseRoles({ createRole });
    render(<RoleEditor {...editorProps} restaurantId="rest-1" role={null} onBack={vi.fn()} />, { wrapper });

    await user.type(screen.getByLabelText(/role name/i), 'Weekend Supervisor');
    const employeesGroup = screen.getByRole('radiogroup', { name: /^employees access$/i });
    await user.click(within(employeesGroup).getByRole('radio', { name: /^manage$/i }));
    await user.click(screen.getByRole('switch', { name: /contact details/i }));

    // Off and back on: the raw toggle is remembered rather than pruned, which
    // is the whole reason the reconciliation is a derivation and not a
    // mutation of the flag set.
    await user.click(within(employeesGroup).getByRole('radio', { name: /^no access$/i }));
    await user.click(within(employeesGroup).getByRole('radio', { name: /^view$/i }));
    expect(screen.getByRole('switch', { name: /contact details/i })).toBeChecked();

    await user.click(screen.getByRole('button', { name: /^save role$/i }));
    expect(createRole.mock.calls[0][0].flags).toContain('view:employee_pii');
  });

  it('toasts and stays on the editor when the save mutation rejects', async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    const createRole = vi.fn().mockRejectedValue(new Error('new row violates row-level security policy'));
    mockUseRoles({ createRole });
    render(<RoleEditor {...editorProps} restaurantId="rest-1" role={null} onBack={onBack} />, { wrapper });

    await user.type(screen.getByLabelText(/role name/i), 'Weekend Supervisor');
    await user.click(screen.getByRole('button', { name: /^save role$/i }));

    expect(createRole).toHaveBeenCalledTimes(1);
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: expect.stringMatching(/couldn't create this role/i),
        description: 'new row violates row-level security policy',
        variant: 'destructive',
      })
    );
    // Navigating back would discard the draft the owner just lost.
    expect(onBack).not.toHaveBeenCalled();
  });
});
