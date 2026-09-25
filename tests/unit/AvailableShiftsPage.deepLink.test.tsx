/**
 * The marketplace deep link (design A5): the page copies `trade`, `restaurant`
 * and `from` into state, deletes them from the URL, then scrolls to the trade
 * and highlights it, or shows a toast when it cannot.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';

const mocks = vi.hoisted(() => {
  const dayIso = (offsetDays: number) =>
    new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
  const DAY_A = dayIso(7);
  const DAY_B = dayIso(8);
  const trade = (id: string, day: string, name: string) => ({
    key: `trade-${id}`,
    type: 'trade' as const,
    date: day,
    trade: {
      id,
      status: 'open',
      offered_shift: {
        id: `shift-${id}`,
        start_time: `${day}T14:00:00Z`,
        end_time: `${day}T20:00:00Z`,
        position: 'Server',
        break_duration: 0,
        is_published: true,
      },
      offered_by: { id: `emp-${id}`, name, position: 'Server', area: null },
      reason: null,
      target_employee_id: null,
    },
  });
  return {
    items: [trade('trade-a', DAY_A, 'Ana Poster'), trade('trade-b', DAY_B, 'Ben Poster')],
    feed: { loading: false, error: null as Error | null },
    employee: { id: 'emp-me', name: 'Me', area: null, position: 'Server' } as Record<string, unknown> | null,
    refetch: vi.fn(),
    toast: vi.fn(),
    setSelectedRestaurant: vi.fn(),
    scrollToIndex: vi.fn(),
    restaurants: [
      { restaurant_id: 'rest-1', role: 'staff', restaurant: { id: 'rest-1', name: 'One' } },
      { restaurant_id: 'rest-2', role: 'staff', restaurant: { id: 'rest-2', name: 'Two' } },
    ],
  };
});

vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => ({
    selectedRestaurant: mocks.restaurants[0],
    setSelectedRestaurant: mocks.setSelectedRestaurant,
    restaurants: mocks.restaurants,
    loading: false,
  }),
}));

vi.mock('@/hooks/useCurrentEmployee', () => ({
  useCurrentEmployee: () => ({
    currentEmployee: mocks.employee,
    loading: false,
  }),
}));

vi.mock('@/hooks/useAvailableShifts', () => ({
  useAvailableShifts: () => ({
    items: mocks.items,
    loading: mocks.feed.loading,
    error: mocks.feed.error,
    refetch: mocks.refetch,
    openShiftCount: 0,
    tradeCount: mocks.items.length,
  }),
}));

vi.mock('@/hooks/useOpenShiftClaims', () => ({
  useOpenShiftClaims: () => ({ claims: [], loading: false }),
  useClaimOpenShift: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('@/hooks/useShifts', () => ({
  useMyShifts: () => ({ shifts: [], loading: false }),
}));

vi.mock('@/hooks/useShiftTrades', () => ({
  useAcceptShiftTrade: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

vi.mock('@/hooks/useShiftProtection', () => import('../helpers/mockShiftProtection'));

vi.mock('@/components/employee', () => ({
  EmployeePageHeader: ({ title }: { title: string }) => <div>{title}</div>,
  NoRestaurantState: () => <div>no restaurant</div>,
  EmployeePageSkeleton: () => <div>skeleton</div>,
  EmployeeNotLinkedState: () => <div>not linked</div>,
}));

vi.mock('@/components/scheduling/OpenShiftCard', () => ({
  OpenShiftCard: () => <div>open-shift-card</div>,
}));

vi.mock('@/components/scheduling/ClaimConfirmDialog', () => ({
  ClaimConfirmDialog: () => null,
}));

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 100,
    getVirtualItems: () => Array.from({ length: count }, (_, i) => ({ index: i, start: i * 100 })),
    measureElement: () => undefined,
    scrollToIndex: mocks.scrollToIndex,
  }),
}));

import AvailableShiftsPage from '@/pages/AvailableShiftsPage';

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname + location.search}</div>;
}

function renderAt(search: string, { strict = false }: { strict?: boolean } = {}) {
  const tree = (
    <MemoryRouter initialEntries={[`/employee/shifts${search}`]}>
      <AvailableShiftsPage />
      <LocationProbe />
    </MemoryRouter>
  );
  return render(strict ? <React.StrictMode>{tree}</React.StrictMode> : tree);
}

function card(tradeId: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-trade-id="${tradeId}"]`);
  if (!el) throw new Error(`no card for ${tradeId}`);
  return el;
}

describe('AvailableShiftsPage – deep link', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.feed = { loading: false, error: null };
    mocks.employee = { id: 'emp-me', name: 'Me', area: null, position: 'Server' };
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('deletes the link params from the URL', () => {
    renderAt('?trade=trade-b&restaurant=rest-1&from=home');
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/employee\/shifts$/);
  });

  it('keeps other params in the URL', () => {
    renderAt('?trade=trade-b&restaurant=rest-1&from=home&tab=x');
    expect(screen.getByTestId('location')).toHaveTextContent('/employee/shifts?tab=x');
  });

  it('highlights the trade with the "From your home screen" label', () => {
    renderAt('?trade=trade-b&restaurant=rest-1&from=home');
    const highlighted = card('trade-b');
    expect(highlighted).toHaveAttribute('aria-current', 'true');
    expect(highlighted).toHaveAttribute('tabindex', '-1');
    expect(highlighted).toHaveClass('ring-2', 'ring-inset', 'ring-foreground');
    expect(highlighted).toHaveTextContent('From your home screen');
    expect(card('trade-a')).not.toHaveAttribute('aria-current');
    expect(card('trade-a')).not.toHaveTextContent('From your');
  });

  it('shows "From your reminder" for from=reminder', () => {
    renderAt('?trade=trade-b&restaurant=rest-1&from=reminder');
    expect(card('trade-b')).toHaveTextContent('From your reminder');
  });

  it('shows no source label without a known source', () => {
    renderAt('?trade=trade-b');
    expect(card('trade-b')).toHaveAttribute('aria-current', 'true');
    expect(card('trade-b')).not.toHaveTextContent('From your');
  });

  it('scrolls to the trade once, centered', () => {
    renderAt('?trade=trade-b&restaurant=rest-1&from=home');
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
    expect(mocks.scrollToIndex).toHaveBeenCalledTimes(1);
    expect(mocks.scrollToIndex).toHaveBeenCalledWith(1, { align: 'center' });
  });

  it('focuses the card after the next frame', async () => {
    renderAt('?trade=trade-b&restaurant=rest-1&from=home');
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    });
    expect(document.activeElement).toBe(card('trade-b'));
  });

  it('clears the highlight after 4 s', () => {
    vi.useFakeTimers();
    renderAt('?trade=trade-b&restaurant=rest-1&from=home');
    expect(card('trade-b')).toHaveAttribute('aria-current', 'true');
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(card('trade-b')).not.toHaveAttribute('aria-current');
    expect(card('trade-b')).not.toHaveTextContent('From your');
  });

  it('clears the highlight on the first user scroll of the list', () => {
    renderAt('?trade=trade-b&restaurant=rest-1&from=home');
    const list = card('trade-b').closest('.overflow-y-auto') as HTMLElement;
    fireEvent.wheel(list);
    expect(card('trade-b')).not.toHaveAttribute('aria-current');
  });

  it('shows the "no longer open" toast when the trade is gone', () => {
    renderAt('?trade=trade-x&restaurant=rest-1&from=reminder');
    expect(mocks.toast).toHaveBeenCalledTimes(1);
    expect(mocks.toast).toHaveBeenCalledWith({
      title: 'That shift is no longer open',
      description: 'A teammate took it, or it was withdrawn. The shifts below are still open.',
    });
    expect(document.querySelector('[aria-current="true"]')).toBeNull();
  });

  it('switches to another restaurant of the user', () => {
    renderAt('?trade=trade-b&restaurant=rest-2&from=reminder');
    expect(mocks.setSelectedRestaurant).toHaveBeenCalledWith(mocks.restaurants[1]);
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  it('shows a toast for a restaurant the user cannot open', () => {
    renderAt('?trade=trade-b&restaurant=rest-9&from=reminder');
    expect(mocks.setSelectedRestaurant).not.toHaveBeenCalled();
    expect(mocks.toast).toHaveBeenCalledWith({ title: 'This shift is at a restaurant you cannot open.' });
    expect(document.querySelector('[aria-current="true"]')).toBeNull();
  });

  it('shows an error state with "Try again" and no "gone" toast', () => {
    mocks.feed = { loading: false, error: new Error('boom') };
    renderAt('?trade=trade-x&restaurant=rest-1&from=home');
    expect(screen.getByText('Could not load shifts.')).toBeInTheDocument();
    expect(screen.queryByText('No shifts available')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(mocks.refetch).toHaveBeenCalledTimes(1);
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  it('shows the "no longer open" toast once in StrictMode', () => {
    renderAt('?trade=trade-x&restaurant=rest-1&from=reminder', { strict: true });
    expect(mocks.toast).toHaveBeenCalledTimes(1);
  });

  it('shows the foreign restaurant toast once in StrictMode', () => {
    renderAt('?trade=trade-b&restaurant=rest-9&from=reminder', { strict: true });
    expect(mocks.toast).toHaveBeenCalledTimes(1);
  });

  it('ends the wait with the foreign restaurant toast when the user has no employee row', () => {
    mocks.employee = null;
    renderAt('?trade=trade-b&restaurant=rest-1&from=reminder');
    expect(screen.getByText('not linked')).toBeInTheDocument();
    expect(mocks.toast).toHaveBeenCalledTimes(1);
    expect(mocks.toast).toHaveBeenCalledWith({ title: 'This shift is at a restaurant you cannot open.' });
  });
});
