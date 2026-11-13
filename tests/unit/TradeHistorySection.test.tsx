import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

type HookState = Record<string, unknown>;
let state: HookState;
const hookMock = vi.fn();

vi.mock('@/hooks/useShiftTradeHistory', () => ({
  useShiftTradeHistory: (...args: unknown[]) => {
    hookMock(...args);
    return state;
  },
}));

import { TradeHistorySection } from '@/components/schedule/TradeHistorySection';

const fetchNextPage = vi.fn();
const refetch = vi.fn();

function makeRow(over: Record<string, unknown> = {}) {
  return {
    id: 't1',
    status: 'approved',
    manager_note: null,
    reviewed_at: '2026-03-10T02:30:00.000Z',
    updated_at: '2026-03-10T02:30:00.000Z',
    reviewer_name: 'Pat Manager',
    offered_shift: {
      id: 's1',
      start_time: '2026-03-12T01:00:00.000Z',
      end_time: '2026-03-12T05:00:00.000Z',
      position: 'Server',
    },
    offered_by: { id: 'e1', name: 'Alice Giver' },
    accepted_by: { id: 'e2', name: 'Bob Taker' },
    target_employee: null,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  state = {
    trades: [],
    isLoading: false,
    isFetching: false,
    isFetchingNextPage: false,
    hasNextPage: false,
    fetchNextPage,
    refetch,
    error: null,
  };
});

const renderSection = () =>
  render(<TradeHistorySection restaurantId="r1" timezone="America/New_York" />);

describe('TradeHistorySection', () => {
  it('shows skeleton rows while loading', () => {
    state.isLoading = true;
    const { container } = renderSection();
    expect(container.querySelectorAll('[data-testid="history-skeleton"]')).toHaveLength(3);
  });

  it('shows an alert and retry on first-load error', () => {
    state.error = new Error('boom');
    renderSection();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(refetch).toHaveBeenCalled();
  });

  it('disables retry while fetching', () => {
    state.error = new Error('boom');
    state.isFetching = true;
    renderSection();
    expect(screen.getByRole('button', { name: /try again/i })).toBeDisabled();
  });

  it('keeps rows and shows the error under them on next-page error', () => {
    state.trades = [makeRow()];
    state.error = new Error('boom');
    renderSection();
    expect(screen.getByText('Alice Giver')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it('shows an empty message for each filter', () => {
    renderSection();
    expect(screen.getByTestId('history-empty')).toBeInTheDocument();
    const first = screen.getByTestId('history-empty').textContent;
    fireEvent.mouseDown(screen.getByRole('tab', { name: /rejected/i }), { button: 0 });
    fireEvent.click(screen.getByRole('tab', { name: /rejected/i }));
    expect(screen.getByTestId('history-empty').textContent).not.toBe(first);
  });

  it('shows the manager note unless it is the auto-expired marker', () => {
    state.trades = [
      makeRow({ id: 't1', status: 'rejected', manager_note: 'Not enough cover' }),
      makeRow({ id: 't2', status: 'cancelled', manager_note: 'auto_expired', accepted_by: null }),
    ];
    renderSection();
    expect(screen.getByText(/Not enough cover/)).toBeInTheDocument();
    expect(screen.queryByText(/auto_expired/)).not.toBeInTheDocument();
  });

  it('shows rows in the restaurant time zone', () => {
    state.trades = [makeRow()];
    renderSection();
    // 2026-03-12T01:00Z is Wed Mar 11, 9:00 PM in New York (EDT).
    expect(screen.getByText(/Wed, Mar 11/)).toBeInTheDocument();
    expect(screen.getByText(/9:00 PM/)).toBeInTheDocument();
    expect(screen.getByText('Alice Giver')).toBeInTheDocument();
    expect(screen.getByText('Bob Taker')).toBeInTheDocument();
    expect(within(screen.getByRole('listitem')).getByText('Approved')).toBeInTheDocument();
    expect(screen.getByText(/Approved by Pat Manager/)).toBeInTheDocument();
  });

  it('passes the selected filter to the hook', () => {
    renderSection();
    expect(hookMock).toHaveBeenLastCalledWith('r1', 'all');
    fireEvent.mouseDown(screen.getByRole('tab', { name: /cancelled/i }), { button: 0 });
    fireEvent.click(screen.getByRole('tab', { name: /cancelled/i }));
    expect(hookMock).toHaveBeenLastCalledWith('r1', 'cancelled');
  });

  it('shows Load more only when a next page exists and calls fetchNextPage', () => {
    state.trades = [makeRow()];
    const { rerender } = renderSection();
    expect(screen.queryByRole('button', { name: /load more/i })).toBeNull();
    state.hasNextPage = true;
    rerender(<TradeHistorySection restaurantId="r1" timezone="America/New_York" />);
    fireEvent.click(screen.getByRole('button', { name: /load more/i }));
    expect(fetchNextPage).toHaveBeenCalled();
  });

  it('keeps Load more when a page has no visible rows but a next page exists', () => {
    state.hasNextPage = true;
    renderSection();
    expect(screen.queryByTestId('history-empty')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /load more/i }));
    expect(fetchNextPage).toHaveBeenCalled();
  });

  it('puts the results in the tab panel of the selected tab', () => {
    state.trades = [makeRow()];
    renderSection();
    const tab = screen.getByRole('tab', { name: /^all$/i });
    const panel = screen.getByRole('tabpanel');
    expect(tab.getAttribute('aria-controls')).toBe(panel.id);
    expect(within(panel).getByText('Alice Giver')).toBeInTheDocument();
  });

  it('points each tab to a panel in the DOM before and after a filter change', () => {
    state.trades = [makeRow()];
    renderSection();
    const check = () => {
      for (const tab of screen.getAllByRole('tab')) {
        const id = tab.getAttribute('aria-controls');
        expect(id).toBeTruthy();
        const panel = document.getElementById(id as string);
        expect(panel).not.toBeNull();
        expect(panel?.hidden).toBe(tab.getAttribute('aria-selected') !== 'true');
      }
    };
    check();
    const rejected = screen.getByRole('tab', { name: /rejected/i });
    fireEvent.mouseDown(rejected);
    fireEvent.click(rejected);
    expect(rejected.getAttribute('aria-selected')).toBe('true');
    check();
  });

  it('shows Former employee when the poster is not readable', () => {
    state.trades = [makeRow({ offered_by: null })];
    renderSection();
    expect(screen.getByText('Former employee')).toBeInTheDocument();
  });

  it('shows Loading... and disables the button while the next page loads', () => {
    state.trades = [makeRow()];
    state.hasNextPage = true;
    state.isFetchingNextPage = true;
    renderSection();
    expect(screen.getByRole('button', { name: /loading\.\.\./i })).toBeDisabled();
  });
});
