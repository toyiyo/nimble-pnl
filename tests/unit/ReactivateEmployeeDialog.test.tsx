import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { ReactivateEmployeeDialog } from '@/components/ReactivateEmployeeDialog';
import type { Employee } from '@/types/scheduling';

const mockMutate = vi.fn();

vi.mock('@/hooks/useEmployees', () => ({
  useReactivateEmployee: () => ({
    mutate: mockMutate,
    isPending: false,
  }),
}));

const employee = {
  id: 'emp-1',
  name: 'Bob Johnson',
  position: 'Server',
  hourly_rate: 1500,
  is_active: false,
  status: 'inactive',
  deactivation_reason: 'seasonal',
} as unknown as Employee;

const renderDialog = () =>
  render(
    <ReactivateEmployeeDialog open onOpenChange={() => {}} employee={employee} />
  );

describe('ReactivateEmployeeDialog', () => {
  beforeEach(() => {
    mockMutate.mockClear();
  });

  it('does not render an "Enable kiosk PIN" checkbox', () => {
    renderDialog();
    expect(screen.queryByRole('checkbox', { name: /kiosk PIN/i })).toBeNull();
    expect(screen.queryByText(/Enable kiosk PIN/i)).toBeNull();
  });

  it('reactivates with only employeeId and hourlyRate (no confirmPin)', () => {
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: /Reactivate Employee/i }));

    expect(mockMutate).toHaveBeenCalledTimes(1);
    const [vars] = mockMutate.mock.calls[0];
    expect(vars).not.toHaveProperty('confirmPin');
    expect(vars.employeeId).toBe('emp-1');
    // updateRate defaults to false, so no rate override is sent.
    expect(vars.hourlyRate).toBeUndefined();
  });

  it('top info alert mentions the existing kiosk PIN', () => {
    renderDialog();
    expect(screen.getByText(/kiosk PIN/i)).toBeInTheDocument();
  });
});
