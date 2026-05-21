import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GenerateScheduleDialog } from '@/components/scheduling/ShiftPlanner/GenerateScheduleDialog';

vi.mock('@/hooks/useSendAvailabilityReminder', () => ({
  useSendAvailabilityReminder: () => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}));

vi.mock('@/hooks/useBulkSetAvailability', () => ({
  useBulkSetAvailability: () => ({
    mutateAsync: vi.fn().mockResolvedValue({ employees_updated: 1, rows_inserted: 7 }),
    isPending: false,
  }),
}));

const employees = [
  { id: 'e1', name: 'Alice', position: 'Server', status: 'active' as const },
  { id: 'e2', name: 'Bob',   position: 'Cook',   status: 'active' as const },
  { id: 'e3', name: 'Carol', position: 'Server', status: 'active' as const },
];
const availability = [
  // Only Alice has availability — Bob and Carol are missing
  {
    id: 'av1', restaurant_id: 'r1', employee_id: 'e1', day_of_week: 1,
    start_time: '09:00:00', end_time: '17:00:00', is_available: true,
    notes: null, created_at: '', updated_at: '',
  },
] as never;

function makeProps(overrides = {}) {
  return {
    open: true,
    onOpenChange: vi.fn(),
    employees,
    existingShifts: [],
    weekStart: new Date('2026-05-25T00:00:00Z'),
    weekEnd:   new Date('2026-05-31T23:59:59Z'),
    isGenerating: false,
    onGenerate: vi.fn(),
    templates: [],
    availability,
    generationResult: null,
    generationError: null,
    onRetry: vi.fn(),
    restaurantId: 'r1',
    ...overrides,
  };
}

function renderDialog(props = makeProps()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <GenerateScheduleDialog {...props} />
    </QueryClientProvider>,
  );
}

describe('GenerateScheduleDialog — missing availability banner', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('shows banner with the correct count when employees are missing availability', () => {
    renderDialog();
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/2 employees can.+t be scheduled/i);
  });

  it('does not render the banner when all employees have availability', () => {
    renderDialog(
      makeProps({
        availability: employees.map((e, i) => ({
          id: `av-${e.id}`,
          restaurant_id: 'r1',
          employee_id: e.id,
          day_of_week: 1,
          start_time: '09:00:00',
          end_time: '17:00:00',
          is_available: true,
          notes: null,
          created_at: '',
          updated_at: '',
        })),
      }),
    );
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('omits the no_availability group from Section 3 when the banner is visible', () => {
    renderDialog();
    // Section 3 header is rendered for OTHER warnings; "No availability set" must not appear
    expect(screen.queryByText(/no availability set/i)).toBeNull();
  });

  it('opens the BulkSetAvailabilitySheet when "Set defaults" is clicked', () => {
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: /set defaults/i }));
    // Sheet's title acts as our hook
    expect(screen.getByText(/set default availability/i)).toBeInTheDocument();
  });
});
