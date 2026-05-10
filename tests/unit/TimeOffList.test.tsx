import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TimeOffList } from '../../src/components/TimeOffList';
import type { TimeOffRequest } from '../../src/types/scheduling';

vi.mock('../../src/hooks/useTimeOffRequests', () => ({
  useTimeOffRequests: vi.fn(),
  useApproveTimeOffRequest: () => ({ mutate: vi.fn(), isPending: false }),
  useRejectTimeOffRequest: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteTimeOffRequest: () => ({ mutate: vi.fn() }),
}));

vi.mock('../../src/components/TimeOffRequestDialog', () => ({
  TimeOffRequestDialog: () => null,
}));

import * as hookMod from '../../src/hooks/useTimeOffRequests';

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
);

const make = (id: string, status: TimeOffRequest['status'], created_at = '2026-05-08T00:00:00Z'): TimeOffRequest => ({
  id,
  restaurant_id: 'rest-1',
  employee_id: `e-${id}`,
  start_date: '2026-05-31',
  end_date: '2026-06-07',
  status,
  requested_at: created_at,
  created_at,
  updated_at: created_at,
  employee: { id: `e-${id}`, restaurant_id: 'rest-1', name: `Emp ${id}`, user_id: `u-${id}`, is_active: true, created_at: '2026-04-01T00:00:00Z', updated_at: '2026-04-01T00:00:00Z' } as TimeOffRequest['employee'],
});

describe('TimeOffList', () => {
  it('shows the loading skeleton while data is loading', () => {
    (hookMod.useTimeOffRequests as ReturnType<typeof vi.fn>).mockReturnValue({
      timeOffRequests: [],
      loading: true,
    });
    render(<TimeOffList restaurantId="rest-1" />, { wrapper });
    expect(document.querySelector('[data-testid="time-off-loading"]')).toBeInTheDocument();
  });

  it('renders the empty hero when there are zero requests of any kind', () => {
    (hookMod.useTimeOffRequests as ReturnType<typeof vi.fn>).mockReturnValue({
      timeOffRequests: [],
      loading: false,
    });
    render(<TimeOffList restaurantId="rest-1" />, { wrapper });
    expect(screen.getByText(/no time-off requests yet/i)).toBeInTheDocument();
  });

  it('always renders PendingQueue (with empty state) when there are decided but no pending', () => {
    (hookMod.useTimeOffRequests as ReturnType<typeof vi.fn>).mockReturnValue({
      timeOffRequests: [make('a', 'approved')],
      loading: false,
    });
    render(<TimeOffList restaurantId="rest-1" />, { wrapper });
    expect(screen.getByRole('heading', { name: /action needed/i })).toBeInTheDocument();
    expect(screen.getByText(/all caught up/i)).toBeInTheDocument();
  });

  it('renders pending in a focused queue and decided in a collapsed history', () => {
    (hookMod.useTimeOffRequests as ReturnType<typeof vi.fn>).mockReturnValue({
      timeOffRequests: [make('a', 'pending'), make('b', 'approved'), make('c', 'rejected')],
      loading: false,
    });
    render(<TimeOffList restaurantId="rest-1" />, { wrapper });
    expect(screen.getByRole('heading', { name: /action needed/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /decided/i })).toBeInTheDocument();
    expect(screen.queryByText('Emp b')).not.toBeInTheDocument();
    expect(screen.queryByText('Emp c')).not.toBeInTheDocument();
    expect(screen.getByText('Emp a')).toBeInTheDocument();
  });
});
