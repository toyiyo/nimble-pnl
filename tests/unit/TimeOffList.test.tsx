import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TimeOffList } from '../../src/components/TimeOffList';
import type { TimeOffRequest } from '../../src/types/scheduling';
import { PolicyWarningError } from '../../src/lib/shiftProtection';

const mockApproveAsync = vi.hoisted(() => vi.fn());
const mockApplyAsync = vi.hoisted(() => vi.fn());
const mockFetchImpact = vi.hoisted(() => vi.fn());
const mockToast = vi.hoisted(() => vi.fn());

vi.mock('../../src/hooks/useTimeOffRequests', () => ({
  useTimeOffRequests: vi.fn(),
  useApproveTimeOffRequest: () => ({ mutate: vi.fn(), mutateAsync: mockApproveAsync, isPending: false }),
  useRejectTimeOffRequest: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteTimeOffRequest: () => ({ mutate: vi.fn() }),
}));

vi.mock('../../src/hooks/useShiftProtection', () => ({
  timeoffCoverageImpactKey: (id: string | null) => ['timeoff-coverage-impact', id],
  fetchTimeoffCoverageImpact: mockFetchImpact,
  useTimeoffCoverageImpact: () => ({ isLoading: false, error: null, data: undefined }),
}));

vi.mock('../../src/hooks/useTimeOffShiftAction', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/hooks/useTimeOffShiftAction')>()),
  useApplyTimeOffShiftAction: () => ({ mutateAsync: mockApplyAsync, isPending: false }),
}));

vi.mock('../../src/hooks/use-toast', () => ({ useToast: () => ({ toast: mockToast }) }));

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
  beforeEach(() => { vi.clearAllMocks(); });

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

  const impactShift = (id: string) => ({
    shift_id: id, shift_date: '2026-06-01', position: 'Server',
    start_time: '2026-06-01T16:00:00Z', end_time: '2026-06-01T23:00:00Z',
    required: 2, current_count: 2, after_count: 1,
  });

  function renderPending() {
    (hookMod.useTimeOffRequests as ReturnType<typeof vi.fn>).mockReturnValue({
      timeOffRequests: [make('p1', 'pending')],
      loading: false,
    });
    render(<TimeOffList restaurantId="rest-1" />, { wrapper });
    fireEvent.click(screen.getByRole('button', { name: /approve time-off for emp p1/i }));
  }

  it('approves at once when the employee has no shifts', async () => {
    mockFetchImpact.mockResolvedValue({ shifts: [], overlapping_approved: 0 });
    mockApproveAsync.mockResolvedValue({ id: 'p1' });
    renderPending();
    await waitFor(() =>
      expect(mockApproveAsync).toHaveBeenCalledWith({ id: 'p1', restaurantId: 'rest-1', override: false })
    );
    expect(screen.queryByRole('heading', { name: 'Approve time off' })).not.toBeInTheDocument();
    expect(mockApplyAsync).not.toHaveBeenCalled();
  });

  it('approves and names the gap when the shift fetch fails', async () => {
    mockFetchImpact.mockRejectedValue(new Error('network'));
    mockApproveAsync.mockResolvedValue({ id: 'p1' });
    renderPending();
    await waitFor(() => expect(mockApproveAsync).toHaveBeenCalled());
    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith({
        title: 'Could not check shifts',
        description: 'The request is approved without a shift action.',
      })
    );
  });

  it('opens the dialog, approves first, then posts the shifts', async () => {
    mockFetchImpact.mockResolvedValue({ shifts: [impactShift('s1'), impactShift('s2')], overlapping_approved: 0 });
    mockApproveAsync.mockResolvedValue({ id: 'p1' });
    mockApplyAsync.mockResolvedValue({ done: 2, skipped: 0, failed: 0 });
    renderPending();

    const confirm = await screen.findByRole('button', { name: 'Approve and post 2 shifts' });
    expect(mockApproveAsync).not.toHaveBeenCalled();
    fireEvent.click(confirm);

    await waitFor(() =>
      expect(mockApplyAsync).toHaveBeenCalledWith({
        restaurantId: 'rest-1',
        employeeId: 'e-p1',
        shiftIds: ['s1', 's2'],
        action: { kind: 'trade', note: 'Approved PTO' },
      })
    );
    expect(mockApproveAsync.mock.invocationCallOrder[0]).toBeLessThan(mockApplyAsync.mock.invocationCallOrder[0]);
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Approve time off' })).not.toBeInTheDocument()
    );
  });

  it('runs the shift action once on a double click', async () => {
    mockFetchImpact.mockResolvedValue({ shifts: [impactShift('s1')], overlapping_approved: 0 });
    let resolveApprove: (v: unknown) => void = () => {};
    mockApproveAsync.mockReturnValue(new Promise((r) => { resolveApprove = r; }));
    mockApplyAsync.mockResolvedValue({ done: 1, skipped: 0, failed: 0 });
    renderPending();

    const confirm = await screen.findByRole('button', { name: 'Approve and post 1 shift' });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    resolveApprove({ id: 'p1' });

    await waitFor(() => expect(mockApplyAsync).toHaveBeenCalledTimes(1));
    expect(mockApproveAsync).toHaveBeenCalledTimes(1);
  });

  it('keeps the shift choice through a policy warning', async () => {
    mockFetchImpact.mockResolvedValue({ shifts: [impactShift('s1'), impactShift('s2')], overlapping_approved: 0 });
    mockApproveAsync
      .mockRejectedValueOnce(new PolicyWarningError([{ rule: 'min_staffing', message: 'Staffing drops below 2.' } as never]))
      .mockResolvedValueOnce({ id: 'p1' });
    mockApplyAsync.mockResolvedValue({ done: 2, skipped: 0, failed: 0 });
    renderPending();

    fireEvent.click(await screen.findByLabelText('Delete the shifts'));
    fireEvent.click(screen.getByRole('button', { name: 'Approve and delete 2 shifts' }));

    expect(await screen.findByText('After approval: delete 2 shifts.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Approve time off' })).not.toBeInTheDocument();
    expect(document.body.style.pointerEvents).not.toBe('none');

    fireEvent.click(screen.getByRole('button', { name: 'Approve anyway and delete 2 shifts' }));
    await waitFor(() =>
      expect(mockApproveAsync).toHaveBeenLastCalledWith({ id: 'p1', restaurantId: 'rest-1', override: true })
    );
    await waitFor(() =>
      expect(mockApplyAsync).toHaveBeenCalledWith(expect.objectContaining({ action: { kind: 'delete' } }))
    );
  });

  it('changes nothing when the manager cancels the policy dialog', async () => {
    mockFetchImpact.mockResolvedValue({ shifts: [impactShift('s1')], overlapping_approved: 0 });
    mockApproveAsync.mockRejectedValueOnce(
      new PolicyWarningError([{ rule: 'min_staffing', message: 'Staffing drops below 2.' } as never])
    );
    renderPending();

    fireEvent.click(await screen.findByRole('button', { name: 'Approve and post 1 shift' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(mockToast).toHaveBeenCalledWith({ title: 'Nothing changed' }));
    expect(mockApplyAsync).not.toHaveBeenCalled();
  });
});
