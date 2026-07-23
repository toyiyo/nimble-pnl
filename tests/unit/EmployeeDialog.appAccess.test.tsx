import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { EmployeeDialog } from '@/components/EmployeeDialog';

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

vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => ({
    selectedRestaurant: { restaurant: { id: 'r1', timezone: 'UTC' } },
  }),
}));

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
