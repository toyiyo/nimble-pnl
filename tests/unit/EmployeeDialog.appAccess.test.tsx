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

const invokeMock = vi.fn();
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
      // invokeMock lets each test assert on send-team-invitation calls (or their absence)
      // without caring about the resolved payload.
      functions: { invoke: (...args: unknown[]) => invokeMock(...args) },
      from: () => makeChain(),
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
