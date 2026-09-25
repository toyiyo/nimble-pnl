/**
 * Placement of the "Teammates need cover" card on the employee home screen
 * (design A3): the card goes above ScheduleStatusBanner when a trade is
 * urgent, else after it and before MyShiftTradesCard. The gradient
 * "Browse Available Shifts" button hides only when the card shows.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const mocks = vi.hoisted(() => ({
  claimable: {
    trades: [] as unknown[],
    count: 0,
    loading: false,
    error: null as Error | null,
    refetch: () => undefined,
  },
  useClaimableTrades: vi.fn(),
}));

vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => ({
    selectedRestaurant: {
      restaurant_id: 'r1',
      role: 'staff',
      restaurant: { name: 'Test Cafe', timezone: 'America/Chicago' },
    },
  }),
}));

vi.mock('@/hooks/useCurrentEmployee', () => ({
  useCurrentEmployee: () => ({
    currentEmployee: { id: 'e1', name: 'Sam Rivera', position: 'Line Cook' },
    loading: false,
  }),
}));

vi.mock('@/hooks/useShifts', () => ({
  useMyShifts: () => ({ shifts: [], loading: false, error: null, refetch: vi.fn() }),
}));

vi.mock('@/hooks/useSchedulePublish', () => ({
  useWeekScheduleStatus: () => ({ state: 'published', publication: null, loading: false }),
}));

vi.mock('@/hooks/useRestaurantPublishes', () => ({
  useRestaurantPublishes: () => ({ publishes: true, isLoading: false }),
}));

vi.mock('@/hooks/useClaimableTrades', () => ({
  useClaimableTrades: mocks.useClaimableTrades,
}));

vi.mock('@/hooks/useOpenShifts', () => ({
  useOpenShifts: () => ({ openShifts: [{}, {}], loading: false, error: null, refetch: vi.fn() }),
}));

vi.mock('@/components/employee', async () => {
  const actual = await vi.importActual<typeof import('@/components/employee')>('@/components/employee');
  return {
    ...actual,
    ScheduleStatusBanner: () => <div data-testid="status-banner" />,
  };
});

vi.mock('@/components/employee/UpForGrabsCard', () => ({
  UpForGrabsCard: (props: { trades: unknown[]; loading: boolean; error: unknown; openShiftCount: number }) =>
    props.loading || (!props.error && props.trades.length === 0) ? null : (
      <div data-testid="up-for-grabs" data-open-count={props.openShiftCount} />
    ),
}));

vi.mock('@/components/schedule/MyShiftTradesCard', () => ({
  MyShiftTradesCard: () => <div data-testid="my-trades" />,
}));
vi.mock('@/components/schedule/TradeRequestDialog', () => ({
  TradeRequestDialog: () => null,
}));

import EmployeeSchedule from '@/pages/EmployeeSchedule';

function renderPage() {
  return render(
    <MemoryRouter>
      <EmployeeSchedule />
    </MemoryRouter>,
  );
}

function isBefore(a: HTMLElement, b: HTMLElement): boolean {
  return !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
}

function setClaimable(urgentFlags: boolean[], extra: Partial<typeof mocks.claimable> = {}) {
  mocks.claimable = {
    trades: urgentFlags.map((urgent, i) => ({ trade: { id: `t${i}` }, urgent })),
    count: urgentFlags.length,
    loading: false,
    error: null,
    refetch: () => undefined,
    ...extra,
  };
}

describe('EmployeeSchedule – "Teammates need cover" placement', () => {
  beforeEach(() => {
    setClaimable([]);
    mocks.useClaimableTrades.mockReset();
    mocks.useClaimableTrades.mockImplementation(() => mocks.claimable);
  });

  it('reads claimable trades for the restaurant and the employee', () => {
    renderPage();
    expect(mocks.useClaimableTrades).toHaveBeenCalledWith('r1', 'e1');
  });

  it('keeps the gradient button and shows no card with no trades', () => {
    renderPage();
    expect(screen.queryByTestId('up-for-grabs')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Browse Available Shifts/ })).toBeInTheDocument();
  });

  it('keeps the gradient button while loading', () => {
    setClaimable([], { loading: true });
    renderPage();
    expect(screen.getByRole('button', { name: /Browse Available Shifts/ })).toBeInTheDocument();
  });

  it('keeps the gradient button on error, and shows the error line', () => {
    setClaimable([], { error: new Error('boom') });
    renderPage();
    expect(screen.getByTestId('up-for-grabs')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Browse Available Shifts/ })).toBeInTheDocument();
  });

  it('hides the gradient button when the card shows', () => {
    setClaimable([false]);
    renderPage();
    expect(screen.getByTestId('up-for-grabs')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Browse Available Shifts/ })).not.toBeInTheDocument();
  });

  it('passes the open shift count to the card', () => {
    setClaimable([false]);
    renderPage();
    expect(screen.getByTestId('up-for-grabs')).toHaveAttribute('data-open-count', '2');
  });

  it('puts the card after the status banner and before my trades when no trade is urgent', () => {
    setClaimable([false, false]);
    renderPage();
    const card = screen.getByTestId('up-for-grabs');
    expect(isBefore(screen.getByTestId('status-banner'), card)).toBe(true);
    expect(isBefore(card, screen.getByTestId('my-trades'))).toBe(true);
  });

  it('puts the card above the status banner when a trade is urgent', () => {
    setClaimable([false, true]);
    renderPage();
    const card = screen.getByTestId('up-for-grabs');
    expect(isBefore(card, screen.getByTestId('status-banner'))).toBe(true);
    expect(isBefore(screen.getByRole('heading', { name: 'My Schedule' }), card)).toBe(true);
  });
});
