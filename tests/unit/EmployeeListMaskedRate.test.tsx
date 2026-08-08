import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { EmployeeList } from '@/components/EmployeeList';
import type { Employee } from '@/types/scheduling';

// A masked column arrives as null (the row policy strips it). The card must
// read "Hidden", never a fabricated "$0.00/hr" or similar.
const maskedHourlyEmployee = {
  id: 'emp-1',
  name: 'Ann Lee',
  position: 'Server',
  compensation_type: 'hourly',
  hourly_rate: null,
  is_active: true,
  status: 'active',
} as unknown as Employee;

vi.mock('@/hooks/useEmployees', () => ({
  useEmployees: (_restaurantId: string, opts: { status?: string }) => {
    if (opts?.status === 'active') {
      return { employees: [maskedHourlyEmployee], loading: false, error: null };
    }
    return { employees: [], loading: false, error: null };
  },
}));

const renderList = () =>
  render(
    <MemoryRouter>
      <EmployeeList restaurantId="rest-1" />
    </MemoryRouter>
  );

describe('EmployeeList compensation display for a masked rate', () => {
  it('shows "Hidden" for a null hourly_rate', () => {
    renderList();
    expect(screen.getByText('Hidden')).toBeInTheDocument();
  });

  it('never renders a fabricated $0.00 rate', () => {
    renderList();
    expect(screen.queryByText(/\$0\.00/)).toBeNull();
  });
});
