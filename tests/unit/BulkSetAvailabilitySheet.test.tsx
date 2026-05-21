import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BulkSetAvailabilitySheet } from '@/components/scheduling/availability/BulkSetAvailabilitySheet';

const mutateMock = vi.fn();
vi.mock('@/hooks/useBulkSetAvailability', () => ({
  useBulkSetAvailability: () => ({
    mutateAsync: mutateMock,
    isPending: false,
  }),
}));

const baseProps = {
  open: true,
  onOpenChange: vi.fn(),
  restaurantId: 'r1',
  employees: [
    { id: 'e1', name: 'Alice', status: 'active' as const, position: 'Server' },
    { id: 'e2', name: 'Bob',   status: 'active' as const, position: 'Cook' },
    { id: 'e3', name: 'Carol', status: 'active' as const, position: 'Server' },
  ],
  preCheckedIds: ['e1', 'e3'],
  defaults: [
    { day_of_week: 0, start_time: '09:00:00', end_time: '17:00:00', is_available: false },
    { day_of_week: 1, start_time: '10:00:00', end_time: '22:00:00', is_available: true },
    { day_of_week: 2, start_time: '10:00:00', end_time: '22:00:00', is_available: true },
    { day_of_week: 3, start_time: '10:00:00', end_time: '22:00:00', is_available: true },
    { day_of_week: 4, start_time: '10:00:00', end_time: '22:00:00', is_available: true },
    { day_of_week: 5, start_time: '10:00:00', end_time: '23:00:00', is_available: true },
    { day_of_week: 6, start_time: '10:00:00', end_time: '23:00:00', is_available: true },
  ],
};

function renderSheet(props = baseProps) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <BulkSetAvailabilitySheet {...props} />
    </QueryClientProvider>,
  );
}

describe('BulkSetAvailabilitySheet', () => {
  beforeEach(() => {
    mutateMock.mockReset();
    mutateMock.mockResolvedValue({ employees_updated: 2, rows_inserted: 14 });
  });

  it('pre-checks employees from preCheckedIds', () => {
    renderSheet();
    expect(
      (screen.getByRole('checkbox', { name: /Alice/ }) as HTMLInputElement).getAttribute('aria-checked'),
    ).toBe('true');
    expect(
      (screen.getByRole('checkbox', { name: /Bob/ }) as HTMLInputElement).getAttribute('aria-checked'),
    ).toBe('false');
    expect(
      (screen.getByRole('checkbox', { name: /Carol/ }) as HTMLInputElement).getAttribute('aria-checked'),
    ).toBe('true');
  });

  it('shows submit label "Apply to N employees" reflecting the selection', () => {
    renderSheet();
    expect(screen.getByRole('button', { name: /apply to 2 employees/i })).toBeEnabled();
    fireEvent.click(screen.getByRole('checkbox', { name: /Bob/ }));
    expect(screen.getByRole('button', { name: /apply to 3 employees/i })).toBeEnabled();
  });

  it('disables submit with aria-disabled when no employees are selected', () => {
    renderSheet();
    fireEvent.click(screen.getByRole('checkbox', { name: /Alice/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Carol/ }));
    const submit = screen.getByRole('button', { name: /select at least one employee/i });
    expect(submit).toHaveAttribute('aria-disabled', 'true');
  });

  it('invokes the mutation with prechecked ids and the supplied defaults', async () => {
    renderSheet();
    fireEvent.click(screen.getByRole('button', { name: /apply to 2 employees/i }));

    expect(mutateMock).toHaveBeenCalledTimes(1);
    const args = mutateMock.mock.calls[0][0];
    expect(args.restaurantId).toBe('r1');
    expect(args.employeeIds.sort()).toEqual(['e1', 'e3']);
    expect(args.availability).toHaveLength(7);
    // closed-day row must keep is_available=false
    expect(args.availability.find((a: { day_of_week: number; is_available: boolean }) => a.day_of_week === 0).is_available).toBe(false);
  });

  it('renders the 7-day grid with namespaced ids', () => {
    renderSheet();
    expect(document.getElementById('bulk-avail-day-0')).not.toBeNull();
    expect(document.getElementById('bulk-avail-day-6')).not.toBeNull();
    // namespace must NOT collide with the employee-dialog version
    expect(document.getElementById('employee-avail-day-0')).toBeNull();
  });
});
