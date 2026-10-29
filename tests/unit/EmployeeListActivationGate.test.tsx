import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { EmployeeList } from '@/components/EmployeeList';
import type { Employee } from '@/types/scheduling';

// deactivate_employee and reactivate_employee require manage:employees on
// the server. The list must not show the two actions to a role without it,
// for example collaborator_accountant, which holds only view:employees.

const activeEmployee = {
  id: 'emp-active',
  name: 'Ann Lee',
  position: 'Server',
  compensation_type: 'hourly',
  hourly_rate: 1500,
  is_active: true,
  status: 'active',
} as unknown as Employee;

const inactiveEmployee = {
  id: 'emp-inactive',
  name: 'Bo Chen',
  position: 'Cook',
  compensation_type: 'hourly',
  hourly_rate: 1600,
  is_active: false,
  status: 'inactive',
} as unknown as Employee;

vi.mock('@/hooks/useEmployees', () => ({
  useEmployees: (_restaurantId: string, opts: { status?: string }) => {
    if (opts?.status === 'active') {
      return { employees: [activeEmployee], loading: false, error: null };
    }
    if (opts?.status === 'inactive') {
      return { employees: [inactiveEmployee], loading: false, error: null };
    }
    return { employees: [activeEmployee, inactiveEmployee], loading: false, error: null };
  },
}));

const permissions = vi.hoisted(() => ({
  capabilities: [] as string[],
  isResolved: true,
}));

vi.mock('@/hooks/usePermissions', () => ({
  usePermissions: () => ({
    hasCapability: (capability: string) => permissions.capabilities.includes(capability),
    isResolved: permissions.isResolved,
  }),
}));

const renderList = () =>
  render(
    <MemoryRouter>
      <EmployeeList
        restaurantId="rest-1"
        onEmployeeDeactivate={vi.fn()}
        onEmployeeReactivate={vi.fn()}
      />
    </MemoryRouter>
  );

const openTab = async (name: RegExp) => {
  await userEvent.setup().click(screen.getByRole('tab', { name }));
};

const deactivateButton = () => screen.queryByRole('button', { name: 'Deactivate Ann Lee' });
const reactivateButton = () => screen.queryByRole('button', { name: 'Reactivate Bo Chen' });

describe('EmployeeList activation actions', () => {
  beforeEach(() => {
    permissions.capabilities = [];
    permissions.isResolved = true;
  });

  describe('without manage:employees', () => {
    beforeEach(() => {
      permissions.capabilities = ['view:employees'];
    });

    it('hides Deactivate on the Active tab', () => {
      renderList();
      expect(screen.getByText('Ann Lee')).toBeInTheDocument();
      expect(deactivateButton()).toBeNull();
    });

    it('hides Reactivate on the Inactive tab', async () => {
      renderList();
      await openTab(/Inactive/);
      expect(await screen.findByText('Bo Chen')).toBeInTheDocument();
      expect(reactivateButton()).toBeNull();
    });

    it('hides both actions on the All tab', async () => {
      renderList();
      await openTab(/All/);
      expect(await screen.findByText('Bo Chen')).toBeInTheDocument();
      expect(deactivateButton()).toBeNull();
      expect(reactivateButton()).toBeNull();
    });
  });

  it('hides both actions while the permissions are not resolved', async () => {
    permissions.capabilities = ['view:employees', 'manage:employees'];
    permissions.isResolved = false;
    renderList();
    await openTab(/All/);
    expect(await screen.findByText('Bo Chen')).toBeInTheDocument();
    expect(deactivateButton()).toBeNull();
    expect(reactivateButton()).toBeNull();
  });

  describe('with manage:employees', () => {
    beforeEach(() => {
      permissions.capabilities = ['view:employees', 'manage:employees'];
    });

    it('shows Deactivate on the Active tab', () => {
      renderList();
      expect(deactivateButton()).toBeInTheDocument();
    });

    it('shows Reactivate on the Inactive tab', async () => {
      renderList();
      await openTab(/Inactive/);
      expect(await screen.findByRole('button', { name: 'Reactivate Bo Chen' })).toBeInTheDocument();
    });

    it('shows both actions on the All tab', async () => {
      renderList();
      await openTab(/All/);
      expect(await screen.findByRole('button', { name: 'Reactivate Bo Chen' })).toBeInTheDocument();
      expect(deactivateButton()).toBeInTheDocument();
    });
  });
});
