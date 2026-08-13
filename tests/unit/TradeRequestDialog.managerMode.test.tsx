import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const createSelf = vi.hoisted(() => vi.fn());
const createForEmployee = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/useShiftTrades', () => ({
  useCreateShiftTrade: () => ({ mutate: createSelf, isPending: false }),
  useCreateShiftTradeForEmployee: () => ({ mutate: createForEmployee, isPending: false }),
}));

vi.mock('@/hooks/useEmployees', () => ({
  useEmployees: () => ({
    employees: [
      { id: 'e-a', name: 'Alex Absent', position: 'Server', is_active: true, user_id: 'u-a' },
      { id: 'e-b', name: 'Bailey Backup', position: 'Server', is_active: true, user_id: 'u-b' },
    ],
    loading: false,
  }),
}));

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
});
