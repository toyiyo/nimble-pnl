import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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
      functions: { invoke: () => Promise.resolve({ data: null, error: null }) },
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

describe('EmployeeDialog — default availability section (create mode)', () => {
  beforeEach(() => {
    createEmployeeMock.mockReset().mockResolvedValue({ id: 'new-emp-1' });
    bulkMutateMock.mockReset().mockResolvedValue({ employees_updated: 1, rows_inserted: 7 });
    toastMock.mockReset();
  });

  it('renders the "Apply default template" radio selected by default in create mode', () => {
    renderDialog();
    expect(
      (screen.getByRole('radio', { name: /apply default template/i }) as HTMLInputElement).getAttribute('aria-checked'),
    ).toBe('true');
    expect(
      (screen.getByRole('radio', { name: /set later/i }) as HTMLInputElement).getAttribute('aria-checked'),
    ).toBe('false');
  });

  it('expands the in-place grid (no new dialog) when Edit is clicked', async () => {
    renderDialog();
    const dialogCountBefore = document.querySelectorAll('[role="dialog"]').length;
    await userEvent.click(screen.getByRole('button', { name: /edit/i }));
    const dialogCountAfter = document.querySelectorAll('[role="dialog"]').length;
    expect(dialogCountAfter).toBe(dialogCountBefore); // grid is inline, not a Dialog
    expect(document.getElementById('employee-avail-day-0')).not.toBeNull();
    expect(document.getElementById('employee-avail-day-6')).not.toBeNull();
  });

  it('namespaces grid ids so they cannot collide with the bulk sheet', () => {
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: /edit/i }));
    expect(document.getElementById('employee-avail-day-1')).not.toBeNull();
    expect(document.getElementById('bulk-avail-day-1')).toBeNull();
  });

  // 10C wiring — these will fail until the next sub-task is implemented
  it('after employee insert succeeds with "Apply default", calls bulk RPC with [newEmployeeId]', async () => {
    renderDialog();
    await userEvent.type(screen.getByLabelText(/name/i), 'New Hire');
    await userEvent.type(screen.getByLabelText(/hourly rate/i), '15');
    await userEvent.click(screen.getByRole('button', { name: /add employee/i }));

    await waitFor(() => expect(createEmployeeMock).toHaveBeenCalled());
    await waitFor(() => expect(bulkMutateMock).toHaveBeenCalled());
    expect(bulkMutateMock.mock.calls[0][0].employeeIds).toEqual(['new-emp-1']);
    expect(bulkMutateMock.mock.calls[0][0].restaurantId).toBe('r1');
    expect(bulkMutateMock.mock.calls[0][0].availability).toHaveLength(7);
  });

  it('with "Set later", does NOT call bulk RPC after insert', async () => {
    renderDialog();
    await userEvent.click(screen.getByRole('radio', { name: /set later/i }));
    await userEvent.type(screen.getByLabelText(/name/i), 'New Hire');
    await userEvent.type(screen.getByLabelText(/hourly rate/i), '15');
    await userEvent.click(screen.getByRole('button', { name: /add employee/i }));

    await waitFor(() => expect(createEmployeeMock).toHaveBeenCalled());
    expect(bulkMutateMock).not.toHaveBeenCalled();
  });
});
