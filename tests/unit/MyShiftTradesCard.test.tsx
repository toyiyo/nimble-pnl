/**
 * Regression tests for the "My shift trades" card:
 * (1) hidden while loading / on error / when empty (no empty-looking shell)
 * (2) poster rows: stepper accessible name, Withdraw only while open
 * (3) claimant rows: status line, no stepper
 * (4) partition: poster rows never leak into "Claimed by you"
 * (5) withdraw confirm dialog wires useCancelShiftTrade with tradeId+employeeId
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockUseMyTradeActivity = vi.hoisted(() => vi.fn());
const mockCancelMutate = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/useShiftTrades', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/useShiftTrades')>();
  return {
    ...actual,
    useMyTradeActivity: mockUseMyTradeActivity,
    useCancelShiftTrade: () => ({ mutate: mockCancelMutate, isPending: false }),
  };
});

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { from: vi.fn(), rpc: vi.fn(), functions: { invoke: vi.fn() } },
}));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

import { MyShiftTradesCard } from '@/components/schedule/MyShiftTradesCard';
import type { ShiftTrade } from '@/hooks/useShiftTrades';

const ME = 'emp-me';

const makeTrade = (overrides: Partial<ShiftTrade>): ShiftTrade =>
  ({
    id: 'trade-1',
    restaurant_id: 'rest-1',
    offered_shift_id: 'shift-1',
    offered_by_employee_id: ME,
    requested_shift_id: null,
    target_employee_id: null,
    accepted_by_employee_id: null,
    status: 'open',
    reason: null,
    manager_note: null,
    reviewed_by: null,
    reviewed_at: null,
    created_at: '2026-07-01T00:00:00Z',
    updated_at: '2026-07-01T00:00:00Z',
    offered_shift: {
      id: 'shift-1',
      start_time: '2026-07-10T17:00:00Z',
      end_time: '2026-07-10T23:00:00Z',
      position: 'Server',
      break_duration: 0,
    },
    offered_by: { id: ME, name: 'Me', email: null, position: 'Server', area: null },
    ...overrides,
  }) as ShiftTrade;

const setActivity = (trades: ShiftTrade[], loading = false, isError = false) => {
  mockUseMyTradeActivity.mockReturnValue({ trades, loading, isError, error: null });
};

const renderCard = () => render(<MyShiftTradesCard restaurantId="rest-1" employeeId={ME} />);

describe('MyShiftTradesCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing while loading, on error, or with no trades', () => {
    setActivity([], true, false);
    const { container: c1 } = renderCard();
    expect(c1.firstChild).toBeNull();

    setActivity([makeTrade({})], false, true);
    const { container: c2 } = renderCard();
    expect(c2.firstChild).toBeNull();

    setActivity([], false, false);
    const { container: c3 } = renderCard();
    expect(c3.firstChild).toBeNull();
  });

  it('shows a posted open trade with the waiting stepper and a Withdraw button', () => {
    setActivity([makeTrade({ status: 'open' })]);
    renderCard();
    expect(screen.getByText('Posted by you')).toBeInTheDocument();
    expect(
      screen.getByRole('img', { name: 'Posted — waiting for a claimant' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /withdraw post/i })).toBeInTheDocument();
  });

  it('pending_approval posted trade names the claimant and hides Withdraw', () => {
    setActivity([
      makeTrade({
        status: 'pending_approval',
        accepted_by_employee_id: 'emp-2',
        accepted_by: { id: 'emp-2', name: 'Jordan', email: null, position: 'Cook' },
      }),
    ]);
    renderCard();
    expect(
      screen.getByRole('img', { name: 'Claimed by Jordan — awaiting manager review' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /withdraw post/i })).not.toBeInTheDocument();
  });

  it('rejected posted trade surfaces the manager note', () => {
    setActivity([
      makeTrade({
        status: 'rejected',
        accepted_by_employee_id: 'emp-2',
        accepted_by: { id: 'emp-2', name: 'Jordan', email: null, position: 'Cook' },
        manager_note: 'Need you on Friday',
        reviewed_at: '2026-07-02T00:00:00Z',
      }),
    ]);
    renderCard();
    expect(screen.getByText(/Manager note:/)).toBeInTheDocument();
    expect(screen.getByText(/Need you on Friday/)).toBeInTheDocument();
  });

  it('claimed trade renders in "Claimed by you" with a status line and no stepper', () => {
    setActivity([
      makeTrade({
        offered_by_employee_id: 'emp-other',
        offered_by: { id: 'emp-other', name: 'Mia', email: null, position: 'Bar', area: null },
        accepted_by_employee_id: ME,
        status: 'pending_approval',
      }),
    ]);
    renderCard();
    expect(screen.getByText('Claimed by you')).toBeInTheDocument();
    expect(screen.getByText('Awaiting manager approval')).toBeInTheDocument();
    expect(screen.getByText(/From Mia/)).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.queryByText('Posted by you')).not.toBeInTheDocument();
  });

  it('a trade I posted never leaks into the claimed section (partition)', () => {
    setActivity([
      makeTrade({
        status: 'pending_approval',
        accepted_by_employee_id: 'emp-2',
        accepted_by: { id: 'emp-2', name: 'Jordan', email: null, position: 'Cook' },
      }),
    ]);
    renderCard();
    expect(screen.getByText('Posted by you')).toBeInTheDocument();
    expect(screen.queryByText('Claimed by you')).not.toBeInTheDocument();
  });

  it('withdraw opens the confirm dialog and confirm calls cancel with tradeId + employeeId', () => {
    setActivity([makeTrade({ id: 'trade-9', status: 'open' })]);
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: /withdraw post/i }));
    expect(screen.getByText('Withdraw this post?')).toBeInTheDocument();

    const confirmBtn = screen
      .getAllByRole('button', { name: /withdraw post/i })
      .find((b) => b.closest('[role="dialog"]'));
    expect(confirmBtn).toBeDefined();
    fireEvent.click(confirmBtn!);

    expect(mockCancelMutate).toHaveBeenCalledWith(
      { tradeId: 'trade-9', employeeId: ME },
      expect.objectContaining({ onSettled: expect.any(Function) }),
    );
  });
});
