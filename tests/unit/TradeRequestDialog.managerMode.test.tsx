import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

const createSelf = vi.hoisted(() => vi.fn());
const createForEmployee = vi.hoisted(() => vi.fn());

// Shared stub: the real hooks need a QueryClientProvider these tests lack.
vi.mock('@/hooks/useShiftProtection', () => import('../helpers/mockShiftProtection'));

// usePermissions reads RestaurantContext; these renders have no provider.
vi.mock('@/hooks/usePermissions', () => ({
  usePermissions: () => ({
    hasCapability: () => true,
    isResolved: true,
  }),
}));

vi.mock('@/hooks/useShiftTrades', () => ({
  useCreateShiftTrade: () => ({ mutate: createSelf, isPending: false }),
  useCreateShiftTradeForEmployee: () => ({ mutate: createForEmployee, isPending: false }),
}));

// The useEmployees return is mutable per test. This lets one test drive the
// coworker picker into its loading state and another into its error state.
type EmployeesReturn = {
  employees: Array<{
    id: string;
    name: string;
    position: string;
    is_active: boolean;
    user_id: string | null;
  }>;
  loading: boolean;
  error: Error | null;
};
const employeesMock = vi.hoisted(() => ({ value: null as unknown as EmployeesReturn }));

vi.mock('@/hooks/useEmployees', () => ({
  useEmployees: () => employeesMock.value,
}));

const ACTIVE_EMPLOYEES = [
  { id: 'e-a', name: 'Alex Absent', position: 'Server', is_active: true, user_id: 'u-a' },
  { id: 'e-b', name: 'Bailey Backup', position: 'Server', is_active: true, user_id: 'u-b' },
];

import { TradeRequestDialog } from '@/components/schedule/TradeRequestDialog';

const shift = {
  id: 's-1',
  start_time: '2026-09-01T16:00:00.000Z',
  end_time: '2026-09-01T22:00:00.000Z',
  position: 'Server',
  employee_id: 'e-a',
};

describe('TradeRequestDialog manager mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    employeesMock.value = {
      employees: [...ACTIVE_EMPLOYEES],
      loading: false,
      error: null,
    };
  });

  it('shows the employee name in the title when posting on their behalf', () => {
    render(
      <TradeRequestDialog
        open
        onOpenChange={() => {}}
        shift={shift}
        restaurantId="r-1"
        onBehalfOfEmployee={{ id: 'e-a', name: 'Alex Absent' }}
      />,
    );

    expect(screen.getByText(/Alex Absent/)).toBeInTheDocument();
  });

  it('posts a marketplace trade through the RPC hook with the offerer id', async () => {
    render(
      <TradeRequestDialog
        open
        onOpenChange={() => {}}
        shift={shift}
        restaurantId="r-1"
        onBehalfOfEmployee={{ id: 'e-a', name: 'Alex Absent' }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /post trade/i }));

    await waitFor(() => {
      expect(createForEmployee).toHaveBeenCalledTimes(1);
    });
    expect(createForEmployee).toHaveBeenCalledWith(
      expect.objectContaining({
        restaurant_id: 'r-1',
        offered_shift_id: 's-1',
        offered_by_employee_id: 'e-a',
        target_employee_id: null,
      }),
      expect.any(Object),
    );
    expect(createSelf).not.toHaveBeenCalled();
  });

  it('uses the self-service hook when currentEmployeeId is given', async () => {
    render(
      <TradeRequestDialog
        open
        onOpenChange={() => {}}
        shift={shift}
        restaurantId="r-1"
        currentEmployeeId="e-a"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /post trade/i }));

    await waitFor(() => {
      expect(createSelf).toHaveBeenCalledTimes(1);
    });
    expect(createForEmployee).not.toHaveBeenCalled();
  });

  it('shows a loading row in the coworker picker while employees load', async () => {
    employeesMock.value = { employees: [], loading: true, error: null };
    const user = userEvent.setup();
    render(
      <TradeRequestDialog
        open
        onOpenChange={() => {}}
        shift={shift}
        restaurantId="r-1"
        onBehalfOfEmployee={{ id: 'e-a', name: 'Alex Absent' }}
      />,
    );

    // The picker only appears after the manager selects a specific coworker.
    await user.click(screen.getByRole('radio', { name: /specific coworker/i }));
    await user.click(screen.getByRole('combobox'));

    expect(screen.getByText(/loading employees/i)).toBeInTheDocument();
  });

  it('shows an error row in the coworker picker when the employee load fails', async () => {
    employeesMock.value = { employees: [], loading: false, error: new Error('boom') };
    const user = userEvent.setup();
    render(
      <TradeRequestDialog
        open
        onOpenChange={() => {}}
        shift={shift}
        restaurantId="r-1"
        onBehalfOfEmployee={{ id: 'e-a', name: 'Alex Absent' }}
      />,
    );

    await user.click(screen.getByRole('radio', { name: /specific coworker/i }));
    await user.click(screen.getByRole('combobox'));

    expect(screen.getByText(/couldn't load coworkers/i)).toBeInTheDocument();
  });
});
