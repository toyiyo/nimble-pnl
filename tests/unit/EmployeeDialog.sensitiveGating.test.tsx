import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { EmployeeDialog } from '@/components/EmployeeDialog';

// Per-test control of the capability check: some tests grant view:employee_pii,
// some grant view:pay_rates, some grant nothing. vi.hoisted lets the factory
// below close over one shared mock function.
const { mockHasCapability } = vi.hoisted(() => ({ mockHasCapability: vi.fn() }));

vi.mock('@/hooks/useEmployees', () => ({
  useCreateEmployee: () => ({ mutateAsync: vi.fn().mockResolvedValue({ id: 'emp-1' }), isPending: false }),
  useUpdateEmployee: () => ({ mutateAsync: vi.fn().mockResolvedValue({ id: 'emp-1' }), isPending: false }),
}));

vi.mock('@/hooks/useBulkSetAvailability', () => ({
  useBulkSetAvailability: () => ({ mutateAsync: vi.fn().mockResolvedValue({}), isPending: false }),
}));

vi.mock('@/hooks/useShiftTemplates', () => {
  const STABLE_TEMPLATES: never[] = [];
  return {
    useShiftTemplates: () => ({
      templates: STABLE_TEMPLATES,
      loading: false,
      error: null,
      createTemplate: () => Promise.resolve(),
      updateTemplate: () => Promise.resolve(),
      deleteTemplate: () => Promise.resolve(),
    }),
  };
});

vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => ({ selectedRestaurant: { restaurant: { id: 'r1', timezone: 'UTC' } } }),
}));

// EmployeeAppAccessRow (mounted by every EmployeeDialog render) calls useAuth,
// which throws without an AuthProvider by design. Nothing here asserts on app
// access — this just keeps the dialog mountable.
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'caller-1' } }) }));

vi.mock('@/hooks/usePermissions', () => ({
  usePermissions: () => ({ hasCapability: mockHasCapability, isResolved: true }),
}));

vi.mock('@/integrations/supabase/client', () => {
  // Recursive fluent-builder mock — must be `any` because the chain can call
  // any subset of methods in any order; a typed interface would require an
  // exhaustive intersection of all Supabase builder return types.
  function makeChain(): any { // eslint-disable-line @typescript-eslint/no-explicit-any
    const chain: any = {}; // eslint-disable-line @typescript-eslint/no-explicit-any
    chain.select = () => makeChain();
    chain.eq = () => makeChain();
    chain.not = () => makeChain();
    chain.order = () => Promise.resolve({ data: [], error: null });
    chain.is = () => makeChain();
    chain.single = () => Promise.resolve({ data: null, error: null });
    chain.upsert = () => Promise.resolve({ data: null, error: null });
    chain.insert = () => makeChain();
    chain.update = () => makeChain();
    chain.then = (resolve: (v: { data: any[]; error: null }) => any) => // eslint-disable-line @typescript-eslint/no-explicit-any
      Promise.resolve({ data: [], error: null }).then(resolve);
    chain.catch = () => Promise.resolve({ data: [], error: null });
    return chain;
  }
  return {
    supabase: {
      functions: { invoke: () => Promise.resolve({ data: null, error: null }) },
      from: () => makeChain(),
    },
  };
});

const BASE_EMPLOYEE = {
  id: 'emp-1',
  restaurant_id: 'r1',
  name: 'Alex Valdez',
  position: 'Server',
  status: 'active' as const,
  is_active: true,
  employment_type: 'full_time' as const,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

// One fixture per compensation type — the pay-schedule controls each render
// only under their type: salary → Pay Period + Allocate Daily; contractor →
// Payment Interval; daily_rate → Standard Work Days.
const HOURLY_EMPLOYEE = { ...BASE_EMPLOYEE, compensation_type: 'hourly' as const, hourly_rate: 2000 };
const SALARY_EMPLOYEE = { ...BASE_EMPLOYEE, compensation_type: 'salary' as const };
const CONTRACTOR_EMPLOYEE = { ...BASE_EMPLOYEE, compensation_type: 'contractor' as const };
const DAILY_RATE_EMPLOYEE = { ...BASE_EMPLOYEE, compensation_type: 'daily_rate' as const };

function renderEdit(employee: typeof BASE_EMPLOYEE) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, staleTime: Infinity } },
  });
  return render(
    <QueryClientProvider client={qc}>
      {/* cast: test fixture omits optional Employee fields */}
      <EmployeeDialog open onOpenChange={vi.fn()} restaurantId="r1" employee={employee as any} /> {/* eslint-disable-line @typescript-eslint/no-explicit-any */}
    </QueryClientProvider>,
  );
}

describe('EmployeeDialog — sensitive-data input gating', () => {
  beforeEach(() => {
    mockHasCapability.mockReset();
  });

  it('disables email, phone, and date of birth when the caller lacks view:employee_pii', () => {
    mockHasCapability.mockReturnValue(false);
    renderEdit(HOURLY_EMPLOYEE);

    expect(screen.getByLabelText(/employee email/i)).toBeDisabled();
    expect(screen.getByLabelText(/employee phone number/i)).toBeDisabled();
    expect(screen.getByLabelText(/date of birth/i)).toBeDisabled();
  });

  it('enables email, phone, and date of birth when the caller holds view:employee_pii', () => {
    mockHasCapability.mockImplementation((c: string) => c === 'view:employee_pii');
    renderEdit(HOURLY_EMPLOYEE);

    expect(screen.getByLabelText(/employee email/i)).not.toBeDisabled();
    expect(screen.getByLabelText(/employee phone number/i)).not.toBeDisabled();
    expect(screen.getByLabelText(/date of birth/i)).not.toBeDisabled();
  });

  it('disables the salary pay-schedule controls when the caller lacks view:pay_rates', () => {
    mockHasCapability.mockReturnValue(false);
    renderEdit(SALARY_EMPLOYEE);

    expect(screen.getByRole('combobox', { name: /pay period/i })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: /allocate to daily/i })).toBeDisabled();
  });

  it('disables the contractor payment interval when the caller lacks view:pay_rates', () => {
    mockHasCapability.mockReturnValue(false);
    renderEdit(CONTRACTOR_EMPLOYEE);

    expect(screen.getByRole('combobox', { name: /payment interval/i })).toBeDisabled();
  });

  it('disables the daily-rate standard work days when the caller lacks view:pay_rates', () => {
    mockHasCapability.mockReturnValue(false);
    renderEdit(DAILY_RATE_EMPLOYEE);

    expect(screen.getByRole('combobox', { name: /standard work days/i })).toBeDisabled();
  });

  it('enables the salary pay-schedule controls when the caller holds view:pay_rates', () => {
    mockHasCapability.mockImplementation((c: string) => c === 'view:pay_rates');
    renderEdit(SALARY_EMPLOYEE);

    expect(screen.getByRole('combobox', { name: /pay period/i })).not.toBeDisabled();
    expect(screen.getByRole('checkbox', { name: /allocate to daily/i })).not.toBeDisabled();
  });
});
