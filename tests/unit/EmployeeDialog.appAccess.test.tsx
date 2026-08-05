/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { EmployeeDialog } from '@/components/EmployeeDialog';
import type { Employee } from '@/types/scheduling';

const createEmployeeMock = vi.fn();
// insertCompensationHistoryEntry is a local function in EmployeeDialog that calls
// supabase.from('employee_compensation_history').upsert(...) — handled by the supabase mock below.
vi.mock('@/hooks/useEmployees', () => ({
  useCreateEmployee: () => ({
    mutateAsync: createEmployeeMock,
    isPending: false,
  }),
  useUpdateEmployee: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}));

const bulkMutateMock = vi.fn();
vi.mock('@/hooks/useBulkSetAvailability', () => ({
  useBulkSetAvailability: () => ({
    mutateAsync: bulkMutateMock,
    isPending: false,
  }),
}));

vi.mock('@/hooks/useShiftTemplates', () => {
  // Stable empty array — must NOT create a new [] on every call or
  // useMemo([shiftTemplatesForDefaults]) will recompute on every render → infinite loop.
  const STABLE_TEMPLATES: never[] = [];
  return {
    useShiftTemplates: () => ({
      templates: STABLE_TEMPLATES,
      loading: false,
      error: null,
      createTemplate: () => Promise.resolve(),
      updateTemplate: () => Promise.resolve(),
      deleteTemplate: () => Promise.resolve(),
    }),
  };
});

const toastMock = vi.fn();
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: toastMock }),
}));

// A controllable mock — most tests want the default (owner, matching
// restaurant); the app-access-row tests below override it per case to
// exercise the non-internal-role and restaurant-mismatch paths.
const mockUseRestaurantContext = vi.fn(() => ({
  selectedRestaurant: {
    restaurant_id: 'r1',
    role: 'owner' as const,
    restaurant: { id: 'r1', timezone: 'UTC' },
  },
}));
vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => mockUseRestaurantContext(),
}));

// EmployeeAppAccessRow renders RolePicker in the linked-account state, which
// calls useRoles/useAssignRole directly — mocked the same way
// RolePicker.test.tsx does, rather than deepening the supabase chain mock
// above (which has no `.or()` and would crash useRoles' real query).
const mockUseRoles = vi.fn(() => ({ roles: [], isLoading: false, error: null }));
vi.mock('@/hooks/useRoles', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useRoles')>('@/hooks/useRoles');
  return { ...actual, useRoles: (...args: unknown[]) => mockUseRoles(...args) };
});

const assignRoleMutate = vi.fn();
vi.mock('@/hooks/useAssignRole', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useAssignRole')>(
    '@/hooks/useAssignRole'
  );
  return { ...actual, useAssignRole: () => ({ mutate: assignRoleMutate, isPending: false }) };
});

// Mock only the useRestaurantMembers hook (the React Query call); keep
// findMemberByEmail real since it's a pure function used by the component
// itself. Default: nobody on the roster matches — tests that need an
// existing member override this per-test (mirrors TeamInvitations.test.tsx).
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

const invokeMock = vi.fn();
const rpcMock = vi.fn();
vi.mock('@/integrations/supabase/client', () => {
  // Build a chainable supabase query mock that resolves at any terminal call.
  function makeChain(): any {
    const chain: any = {};
    chain.select = () => makeChain();
    chain.eq = () => makeChain();
    chain.not = () => makeChain();
    chain.order = () => Promise.resolve({ data: [], error: null });
    chain.is = () => makeChain();
    chain.single = () => Promise.resolve({ data: null, error: null });
    chain.upsert = () => Promise.resolve({ data: null, error: null });
    chain.insert = () => makeChain();
    chain.update = () => makeChain();
    // Make chain thenable so `await supabase.from(...).select(...).eq(...)` works
    chain.then = (resolve: (v: { data: any[]; error: null }) => any) =>
      Promise.resolve({ data: [], error: null }).then(resolve);
    chain.catch = (reject: (e: unknown) => any) =>
      Promise.resolve({ data: [], error: null }).catch(reject);
    return chain;
  }
  return {
    supabase: {
      // invokeMock/rpcMock let each test assert on send-team-invitation or
      // link_employee_to_user calls (or their absence) without caring about
      // the resolved payload by default.
      functions: { invoke: (...args: unknown[]) => invokeMock(...args) },
      from: () => makeChain(),
      rpc: (...args: unknown[]) => rpcMock(...args),
    },
  };
});

function renderDialog() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false, staleTime: Infinity },
    },
  });
  return render(
    <QueryClientProvider client={qc}>
      <EmployeeDialog open onOpenChange={vi.fn()} restaurantId="r1" />
    </QueryClientProvider>,
  );
}

function renderDialogEdit(employee: Employee) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false, staleTime: Infinity },
    },
  });
  return render(
    <QueryClientProvider client={qc}>
      <EmployeeDialog open onOpenChange={vi.fn()} restaurantId="r1" employee={employee} />
    </QueryClientProvider>,
  );
}

describe('EmployeeDialog — opt-in app access switch (create mode)', () => {
  beforeEach(() => {
    createEmployeeMock.mockReset().mockResolvedValue({ id: 'new-emp-1' });
    bulkMutateMock.mockReset().mockResolvedValue({ employees_updated: 1, rows_inserted: 7 });
    toastMock.mockReset();
    invokeMock.mockReset().mockResolvedValue({ data: null, error: null });
    rpcMock.mockReset().mockResolvedValue({ data: null, error: null });
    mockUseRestaurantMembers.mockReset().mockReturnValue({ data: [], isError: false });
  });

  it('does not invite anyone when the access switch is off, even with an email', async () => {
    renderDialog();
    await userEvent.type(screen.getByLabelText(/name/i), 'New Hire');
    await userEvent.type(screen.getByLabelText(/hourly rate/i), '15');
    await userEvent.type(screen.getByLabelText(/email/i), 'newhire@example.com');
    await userEvent.click(screen.getByRole('button', { name: /add employee/i }));

    await waitFor(() => expect(createEmployeeMock).toHaveBeenCalled());
    expect(invokeMock).not.toHaveBeenCalledWith(
      'send-team-invitation',
      expect.anything(),
    );
  });

  it('invites only when the switch is deliberately turned on', async () => {
    renderDialog();
    await userEvent.type(screen.getByLabelText(/name/i), 'New Hire');
    await userEvent.type(screen.getByLabelText(/hourly rate/i), '15');
    await userEvent.type(screen.getByLabelText(/email/i), 'newhire@example.com');
    await userEvent.click(screen.getByRole('switch', { name: /invite to the employee app/i }));
    await userEvent.click(screen.getByRole('button', { name: /add employee/i }));

    await waitFor(() => expect(createEmployeeMock).toHaveBeenCalled());
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        'send-team-invitation',
        expect.objectContaining({ body: expect.objectContaining({ role: 'staff' }) }),
      ),
    );
  });

  it('disarms the access switch when the email is edited afterward', async () => {
    // The switch is a decision about a specific address. Editing the email
    // after arming it must reset the switch so access is never granted to an
    // address the user didn't deliberately opt in for.
    renderDialog();
    await userEvent.type(screen.getByLabelText(/name/i), 'New Hire');
    await userEvent.type(screen.getByLabelText(/hourly rate/i), '15');
    await userEvent.type(screen.getByLabelText(/email/i), 'newhire@example.com');
    const toggle = screen.getByRole('switch', { name: /invite to the employee app/i });
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'true');

    // Append a character to the email — the switch resets to off.
    await userEvent.type(screen.getByLabelText(/email/i), 'x');
    expect(toggle).toHaveAttribute('aria-checked', 'false');

    await userEvent.click(screen.getByRole('button', { name: /add employee/i }));
    await waitFor(() => expect(createEmployeeMock).toHaveBeenCalled());
    expect(invokeMock).not.toHaveBeenCalledWith('send-team-invitation', expect.anything());
  });

  it('defaults the access switch to off', async () => {
    renderDialog();
    const toggle = await screen.findByRole('switch', { name: /invite to the employee app/i });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
  });

  it('keeps the switch focusable and explained while the email is empty', async () => {
    renderDialog();
    const toggle = await screen.findByRole('switch', { name: /invite to the employee app/i });
    expect(toggle).toHaveAttribute('aria-disabled', 'true');
    expect(toggle).not.toHaveAttribute('disabled'); // must stay in the tab order
    expect(toggle).toHaveAccessibleDescription(/add an email address/i);

    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'false'); // guard holds
  });
});

describe('EmployeeDialog — link to an existing account instead of double-provisioning', () => {
  const EXISTING_MEMBER = {
    userId: 'u1',
    email: 'alexis@rushbowls.com',
    fullName: 'Alexis Sanchez',
    role: 'manager',
  };

  beforeEach(() => {
    createEmployeeMock.mockReset().mockResolvedValue({ id: 'new-emp-1' });
    bulkMutateMock.mockReset().mockResolvedValue({ employees_updated: 1, rows_inserted: 7 });
    toastMock.mockReset();
    invokeMock.mockReset().mockResolvedValue({ data: null, error: null });
    rpcMock.mockReset().mockResolvedValue({ data: null, error: null });
    // Default: nobody on the roster matches — each test below opts in by
    // returning EXISTING_MEMBER for the email it types.
    mockUseRestaurantMembers.mockReset().mockReturnValue({ data: [], isError: false });
  });

  async function fillEmployeeBasics(email: string) {
    await userEvent.type(screen.getByLabelText(/name/i), 'New Hire');
    await userEvent.type(screen.getByLabelText(/hourly rate/i), '15');
    await userEvent.type(screen.getByLabelText(/email/i), email);
  }

  it('offers linking instead of inviting when the email is already a member', async () => {
    mockUseRestaurantMembers.mockReturnValue({ data: [EXISTING_MEMBER], isError: false });
    renderDialog();
    await fillEmployeeBasics('alexis@rushbowls.com');

    expect(
      await screen.findByRole('switch', { name: /link this employee record/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('switch', { name: /invite to the employee app/i }),
    ).not.toBeInTheDocument();
  });

  it('links rather than inviting when the link switch is on', async () => {
    mockUseRestaurantMembers.mockReturnValue({ data: [EXISTING_MEMBER], isError: false });
    rpcMock.mockResolvedValue({
      data: [{ success: true, message: 'Linked', employee_name: 'New Hire', employee_email: 'alexis@rushbowls.com' }],
      error: null,
    });
    renderDialog();
    await fillEmployeeBasics('alexis@rushbowls.com');
    await userEvent.click(
      await screen.findByRole('switch', { name: /link this employee record/i }),
    );
    await userEvent.click(screen.getByRole('button', { name: /add employee/i }));

    await waitFor(() => expect(createEmployeeMock).toHaveBeenCalled());
    await waitFor(() =>
      expect(rpcMock).toHaveBeenCalledWith('link_employee_to_user', {
        p_employee_id: expect.any(String),
        p_user_id: 'u1',
      }),
    );
    expect(invokeMock).not.toHaveBeenCalledWith('send-team-invitation', expect.anything());
  });

  it('still creates the employee when the link switch is left off', async () => {
    // Declining to link is a first-class outcome — no second account, no invite.
    mockUseRestaurantMembers.mockReturnValue({ data: [EXISTING_MEMBER], isError: false });
    renderDialog();
    await fillEmployeeBasics('alexis@rushbowls.com');
    // Link switch left off (default false) — do not click it.
    await userEvent.click(screen.getByRole('button', { name: /add employee/i }));

    await waitFor(() => expect(createEmployeeMock).toHaveBeenCalled());
    expect(rpcMock).not.toHaveBeenCalled();
    expect(invokeMock).not.toHaveBeenCalledWith('send-team-invitation', expect.anything());
    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ title: 'Employee created' })),
    );
  });

  it('treats "already linked" as a success, not a failure toast', async () => {
    // A double-click or retry must not report failure for work that already
    // landed. The RPC returns success = TRUE for an idempotent re-link, so the
    // client trusts `success` alone — no message string-matching.
    mockUseRestaurantMembers.mockReturnValue({ data: [EXISTING_MEMBER], isError: false });
    rpcMock.mockResolvedValue({
      data: [{ success: true, message: 'Employee is already linked to this account' }],
      error: null,
    });
    renderDialog();
    await fillEmployeeBasics('alexis@rushbowls.com');
    await userEvent.click(
      await screen.findByRole('switch', { name: /link this employee record/i }),
    );
    await userEvent.click(screen.getByRole('button', { name: /add employee/i }));

    await waitFor(() => expect(rpcMock).toHaveBeenCalled());
    expect(toastMock).not.toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive' }));
  });

  it('surfaces a real link failure without losing the employee record', async () => {
    mockUseRestaurantMembers.mockReturnValue({ data: [EXISTING_MEMBER], isError: false });
    rpcMock.mockResolvedValue({
      data: [{ success: false, message: 'Employee not found, or you are not authorized to manage it' }],
      error: null,
    });
    renderDialog();
    await fillEmployeeBasics('alexis@rushbowls.com');
    await userEvent.click(
      await screen.findByRole('switch', { name: /link this employee record/i }),
    );
    await userEvent.click(screen.getByRole('button', { name: /add employee/i }));

    await waitFor(() => expect(rpcMock).toHaveBeenCalled());
    // The employee record itself must still have been created — a failed
    // link must not roll back or block employee creation.
    expect(createEmployeeMock).toHaveBeenCalled();
    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive' }));
  });
});

describe('EmployeeDialog — app access row: visibility gate and the linked-account state', () => {
  const EMPLOYEE_WITH_ACCOUNT: Employee = {
    id: 'emp-1',
    restaurant_id: 'r1',
    name: 'Jamie Rivera',
    email: 'jamie@example.com',
    position: 'Server',
    status: 'active',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    user_id: 'u1',
    is_active: true,
    compensation_type: 'hourly',
    hourly_rate: 1500,
  };

  const LINKED_MEMBER = {
    membershipId: 'mem-1',
    userId: 'u1',
    email: 'jamie@example.com',
    fullName: 'Jamie Rivera',
    role: 'manager',
    roleId: null,
  };

  beforeEach(() => {
    createEmployeeMock.mockReset().mockResolvedValue({ id: 'new-emp-1' });
    bulkMutateMock.mockReset().mockResolvedValue({ employees_updated: 1, rows_inserted: 7 });
    toastMock.mockReset();
    invokeMock.mockReset().mockResolvedValue({ data: null, error: null });
    rpcMock.mockReset().mockResolvedValue({ data: null, error: null });
    mockUseRestaurantMembers.mockReset().mockReturnValue({ data: [], isLoading: false, isError: false });
    mockUseRoles.mockReset().mockReturnValue({ roles: [], isLoading: false, error: null });
    assignRoleMutate.mockReset();
    mockUseRestaurantContext.mockReset().mockReturnValue({
      selectedRestaurant: {
        restaurant_id: 'r1',
        role: 'owner' as const,
        restaurant: { id: 'r1', timezone: 'UTC' },
      },
    });
  });

  it('shows the linked account and its role, not a role on the employee row', async () => {
    mockUseRestaurantMembers.mockReturnValue({ data: [LINKED_MEMBER], isLoading: false, isError: false });
    renderDialogEdit(EMPLOYEE_WITH_ACCOUNT);

    expect(await screen.findByText(/signed in as/i)).toBeInTheDocument();
    expect(screen.getByText(/jamie@example\.com/i)).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /jamie rivera/i })).toBeInTheDocument();
  });

  it('says nothing at all to a caller who cannot see the roster', async () => {
    // RLS returns only the collaborator_accountant's own row, so a roster
    // miss means "can't see", not "no account" — the row must be absent
    // entirely, not a confident "No access" about someone fully provisioned.
    mockUseRestaurantContext.mockReturnValue({
      selectedRestaurant: {
        restaurant_id: 'r1',
        role: 'collaborator_accountant' as const,
        restaurant: { id: 'r1', timezone: 'UTC' },
      },
    });
    mockUseRestaurantMembers.mockReturnValue({ data: [], isLoading: false, isError: false });
    renderDialogEdit(EMPLOYEE_WITH_ACCOUNT);

    await screen.findByLabelText(/^name/i);
    expect(screen.queryByText(/app access/i)).not.toBeInTheDocument();
  });

  it('offers the invite when the account is linked to no membership here', async () => {
    // employee.user_id is set, but the roster has no matching userId — state
    // 3 folds into 2.
    mockUseRestaurantMembers.mockReturnValue({ data: [], isLoading: false, isError: false });
    renderDialogEdit(EMPLOYEE_WITH_ACCOUNT);

    expect(await screen.findByText(/no access/i)).toBeInTheDocument();
    // Edit mode (Task 5) replaces the create-mode switch with the
    // "Send invite" button flow — there is no `onSendInvite`-less switch
    // once a dialog is editing an existing employee record.
    expect(screen.getByRole('button', { name: /invite to the app/i })).toBeInTheDocument();
    // Position/Area also render as `combobox` — scope to the RolePicker's
    // accessible name (it never appears here) rather than any combobox.
    expect(screen.queryByRole('combobox', { name: /jamie rivera/i })).not.toBeInTheDocument();
  });

  it('waits rather than guessing while the roster loads', async () => {
    mockUseRestaurantMembers.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    renderDialogEdit(EMPLOYEE_WITH_ACCOUNT);

    await screen.findByLabelText(/^name/i);
    expect(screen.queryByRole('switch', { name: /invite/i })).not.toBeInTheDocument();
  });

  it('renders the role read-only when the caller role cannot be established', async () => {
    // selectedRestaurant.restaurant_id !== the dialog's restaurantId prop
    // ("r1") — callerRole resolves to null. The linked-member data already
    // came back (proof it was safe to fetch), so it's still shown, just
    // without the RolePicker combobox that needs a definite callerRole.
    mockUseRestaurantContext.mockReturnValue({
      selectedRestaurant: {
        restaurant_id: 'other-restaurant',
        role: 'owner' as const,
        restaurant: { id: 'other-restaurant', timezone: 'UTC' },
      },
    });
    mockUseRestaurantMembers.mockReturnValue({ data: [LINKED_MEMBER], isLoading: false, isError: false });
    renderDialogEdit(EMPLOYEE_WITH_ACCOUNT);

    expect(await screen.findByText(/manager/i)).toBeInTheDocument();
    // Position/Area also render as `combobox` — scope to the RolePicker's
    // accessible name (it never appears here) rather than any combobox.
    expect(screen.queryByRole('combobox', { name: /jamie rivera/i })).not.toBeInTheDocument();
  });
});

/** A custom role, overridable field by field. Shared by both invite suites so
 * they can't drift into testing subtly different role shapes. */
const roleRow = (over: Record<string, unknown>) => ({
  id: 'x',
  restaurant_id: 'r1',
  name: 'Role',
  description: null,
  flavor: 'collaborator',
  builtin: false,
  legacy_role: null,
  created_at: '',
  role_areas: [],
  role_flags: [],
  memberCount: 0,
  ...over,
});

describe('EmployeeDialog — create-mode invite carries the chosen role', () => {
  beforeEach(() => {
    createEmployeeMock.mockReset().mockResolvedValue({ id: 'new-emp' });
    bulkMutateMock.mockReset().mockResolvedValue({ employees_updated: 1, rows_inserted: 7 });
    toastMock.mockReset();
    invokeMock.mockReset().mockResolvedValue({ data: null, error: null });
    rpcMock.mockReset().mockResolvedValue({ data: null, error: null });
    mockUseRestaurantMembers.mockReset().mockReturnValue({ data: [], isLoading: false, isError: false });
    mockUseRoles.mockReset().mockReturnValue({
      roles: [
        roleRow({ id: 'c1', name: 'Operations Lead', description: 'Runs the floor day to day.' }),
        roleRow({
          id: 'chef-role',
          name: 'Chef',
          legacy_role: 'chef',
          builtin: true,
          restaurant_id: null,
          description: 'Manage recipes and inventory',
        }),
      ],
      isLoading: false,
      error: null,
    });
    mockUseRestaurantContext.mockReset().mockReturnValue({
      selectedRestaurant: {
        restaurant_id: 'r1',
        role: 'owner' as const,
        restaurant: { id: 'r1', timezone: 'UTC' },
      },
    });
  });

  async function fillAndArm() {
    renderDialog();
    await userEvent.type(screen.getByLabelText(/name/i), 'New Hire');
    await userEvent.type(screen.getByLabelText(/hourly rate/i), '15');
    await userEvent.type(screen.getByLabelText(/email/i), 'newhire@example.com');
    await userEvent.click(screen.getByRole('switch', { name: /invite to the employee app/i }));
  }

  it('still invites as staff when nobody touches the picker', async () => {
    await fillAndArm();
    await userEvent.click(screen.getByRole('button', { name: /add employee/i }));

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        'send-team-invitation',
        expect.objectContaining({
          body: expect.objectContaining({ role: 'staff', employeeId: 'new-emp' }),
        }),
      ),
    );
    expect(invokeMock.mock.calls[0][1].body).not.toHaveProperty('roleId');
  });

  it('invites as the chosen custom role, carrying its roleId', async () => {
    await fillAndArm();
    await userEvent.click(screen.getByRole('combobox', { name: /invite as/i }));
    await userEvent.click(await screen.findByRole('option', { name: /Operations Lead/i }));
    // Selecting an option commits the value but leaves the popover open (no
    // separate confirm step here, unlike RolePicker's footer flow) — close it
    // before reaching for controls it would otherwise cover.
    await userEvent.keyboard('{Escape}');
    await userEvent.click(screen.getByRole('button', { name: /add employee/i }));

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        'send-team-invitation',
        expect.objectContaining({
          body: expect.objectContaining({ role: 'collaborator_custom', roleId: 'c1' }),
        }),
      ),
    );
  });

  it('invites as a chosen built-in role without a roleId', async () => {
    await fillAndArm();
    await userEvent.click(screen.getByRole('combobox', { name: /invite as/i }));
    await userEvent.click(await screen.findByRole('option', { name: /Chef/i }));
    await userEvent.keyboard('{Escape}');
    await userEvent.click(screen.getByRole('button', { name: /add employee/i }));

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        'send-team-invitation',
        expect.objectContaining({
          body: expect.objectContaining({ role: 'chef' }),
        }),
      ),
    );
    expect(invokeMock.mock.calls[0][1].body).not.toHaveProperty('roleId');
  });

  it('describes the role it will actually grant, not always staff', async () => {
    await fillAndArm();
    await userEvent.click(screen.getByRole('combobox', { name: /invite as/i }));
    await userEvent.click(await screen.findByRole('option', { name: /Operations Lead/i }));
    await userEvent.keyboard('{Escape}');

    expect(await screen.findByText(/runs the floor day to day/i)).toBeInTheDocument();
    expect(screen.queryByText(/will not see sales, costs, payroll/i)).not.toBeInTheDocument();
  });
});

describe('EmployeeDialog — the edit-mode invite', () => {
  const EMPLOYEE_NO_ACCOUNT: Employee = {
    id: 'e1',
    restaurant_id: 'r1',
    name: 'Sam Rivera',
    email: 'sam@x.com',
    position: 'Server',
    status: 'active',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    is_active: true,
    compensation_type: 'hourly',
    hourly_rate: 1500,
  };

  beforeEach(() => {
    createEmployeeMock.mockReset().mockResolvedValue({ id: 'new-emp' });
    bulkMutateMock.mockReset().mockResolvedValue({ employees_updated: 1, rows_inserted: 7 });
    toastMock.mockReset();
    invokeMock.mockReset().mockResolvedValue({ data: null, error: null });
    rpcMock.mockReset().mockResolvedValue({ data: null, error: null });
    mockUseRestaurantMembers.mockReset().mockReturnValue({ data: [], isLoading: false, isError: false });
    mockUseRoles.mockReset().mockReturnValue({
      roles: [
        roleRow({ id: 'c1', name: 'Operations Lead', description: 'Runs the floor day to day.' }),
      ],
      isLoading: false,
      error: null,
    });
    mockUseRestaurantContext.mockReset().mockReturnValue({
      selectedRestaurant: {
        restaurant_id: 'r1',
        role: 'owner' as const,
        restaurant: { id: 'r1', timezone: 'UTC' },
      },
    });
  });

  it('sends the invite with the saved email and the chosen role', async () => {
    renderDialogEdit(EMPLOYEE_NO_ACCOUNT);

    await userEvent.click(await screen.findByRole('button', { name: /invite to the app/i }));
    await userEvent.click(screen.getByRole('combobox', { name: /invite as/i }));
    await userEvent.click(await screen.findByRole('option', { name: /Operations Lead/i }));
    await userEvent.keyboard('{Escape}');
    await userEvent.click(screen.getByRole('button', { name: /send invite/i }));

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith('send-team-invitation', {
        body: {
          restaurantId: 'r1',
          email: 'sam@x.com',
          role: 'collaborator_custom',
          roleId: 'c1',
          employeeId: 'e1',
        },
      }),
    );
  });

  it('refuses to invite an address the user is still typing', async () => {
    renderDialogEdit(EMPLOYEE_NO_ACCOUNT);

    const emailInput = await screen.findByLabelText(/email/i);
    await userEvent.clear(emailInput);
    await userEvent.type(emailInput, 'other@x.com');

    await userEvent.click(screen.getByRole('button', { name: /invite to the app/i }));
    const sendButton = screen.getByRole('button', { name: /send invite/i });
    expect(sendButton).toBeDisabled();

    await userEvent.click(sendButton);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('starts the next employee fresh instead of carrying the last one\'s role', async () => {
    const qc = new QueryClient({
      defaultOptions: {
        queries: { retry: false, refetchOnWindowFocus: false, staleTime: Infinity },
      },
    });
    const { rerender } = render(
      <QueryClientProvider client={qc}>
        <EmployeeDialog
          open
          onOpenChange={vi.fn()}
          restaurantId="r1"
          employee={EMPLOYEE_NO_ACCOUNT}
        />
      </QueryClientProvider>,
    );

    await userEvent.click(await screen.findByRole('button', { name: /invite to the app/i }));
    await userEvent.click(screen.getByRole('combobox', { name: /invite as/i }));
    await userEvent.click(await screen.findByRole('option', { name: /Operations Lead/i }));
    await userEvent.keyboard('{Escape}');

    const OTHER: Employee = {
      ...EMPLOYEE_NO_ACCOUNT,
      id: 'e2',
      name: 'Dana Cruz',
      email: 'dana@x.com',
    };
    rerender(
      <QueryClientProvider client={qc}>
        <EmployeeDialog open onOpenChange={vi.fn()} restaurantId="r1" employee={OTHER} />
      </QueryClientProvider>,
    );

    // The panel collapses back to its entry point, so the next person starts at
    // the same place the first one did rather than mid-decision.
    await userEvent.click(await screen.findByRole('button', { name: /invite to the app/i }));
    await userEvent.click(screen.getByRole('button', { name: /send invite/i }));

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith('send-team-invitation', {
        body: {
          restaurantId: 'r1',
          email: 'dana@x.com',
          role: 'staff',
          employeeId: 'e2',
        },
      }),
    );
  });

  it('keeps the chosen role when the restaurant timezone changes underneath', async () => {
    const qc = new QueryClient({
      defaultOptions: {
        queries: { retry: false, refetchOnWindowFocus: false, staleTime: Infinity },
      },
    });
    // A FUNCTION, not a stored element: re-rendering the identical element
    // object makes React bail out of the subtree entirely, and the component
    // would never re-read the (mocked) restaurant context.
    const tree = () => (
      <QueryClientProvider client={qc}>
        <EmployeeDialog open onOpenChange={vi.fn()} restaurantId="r1" employee={EMPLOYEE_NO_ACCOUNT} />
      </QueryClientProvider>
    );
    const { rerender } = render(tree());

    await userEvent.click(await screen.findByRole('button', { name: /invite to the app/i }));
    await userEvent.click(screen.getByRole('combobox', { name: /invite as/i }));
    await userEvent.click(await screen.findByRole('option', { name: /Operations Lead/i }));
    await userEvent.keyboard('{Escape}');

    // Someone else changes the restaurant's zone while this dialog sits open.
    // It re-seeds the compensation effective date and nothing else — the admin
    // is mid-decision about a person, and the zone is not the person.
    mockUseRestaurantContext.mockReturnValue({
      selectedRestaurant: {
        restaurant_id: 'r1',
        role: 'owner' as const,
        restaurant: { id: 'r1', timezone: 'America/New_York' },
      },
    });
    rerender(tree());

    await userEvent.click(screen.getByRole('button', { name: /send invite/i }));

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith('send-team-invitation', {
        body: {
          restaurantId: 'r1',
          email: 'sam@x.com',
          role: 'collaborator_custom',
          roleId: 'c1',
          employeeId: 'e1',
        },
      }),
    );
  });

  it('names the invite trigger by the role it is about to send', async () => {
    renderDialogEdit(EMPLOYEE_NO_ACCOUNT);

    await userEvent.click(await screen.findByRole('button', { name: /invite to the app/i }));

    // WCAG 2.5.3: the accessible name has to contain the visible chip text, so
    // a voice-control user can say what they see.
    // ROLE_METADATA.staff.label, not the raw role key — the chip says what the
    // admin sees everywhere else in the app.
    const trigger = screen.getByRole('combobox', { name: /invite as/i });
    expect(trigger.getAttribute('aria-label')).toBe('Invite as Employee (self-service). Change role');
    expect(trigger).toHaveTextContent('Employee (self-service)');

    await userEvent.click(trigger);
    await userEvent.click(await screen.findByRole('option', { name: /Operations Lead/i }));

    const updated = screen.getByRole('combobox', { name: /invite as/i });
    expect(updated.getAttribute('aria-label')).toBe('Invite as Operations Lead. Change role');
    expect(updated).toHaveTextContent('Operations Lead');
  });

  it('says the roster failed rather than claiming no access', async () => {
    mockUseRestaurantMembers.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    renderDialogEdit(EMPLOYEE_NO_ACCOUNT);

    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn't load access details/i);
    // Offering an invite off a roster we couldn't read risks double-provisioning
    // someone who already has an account.
    expect(screen.queryByRole('button', { name: /invite to the app/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/no access/i)).not.toBeInTheDocument();
  });

  it('asks for an email first when the employee has none saved', async () => {
    renderDialogEdit({ ...EMPLOYEE_NO_ACCOUNT, email: undefined });

    await screen.findByLabelText(/^name/i);
    expect(screen.queryByRole('button', { name: /send invite/i })).not.toBeInTheDocument();
    expect(screen.getByText(/add an email address/i)).toBeInTheDocument();
  });
});
