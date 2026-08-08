import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { EmployeeDialog } from '@/components/EmployeeDialog';

// Regression test for the "required blocks every save" bug: a masked pay
// field (hourly rate, salary amount, or contractor payment amount) renders
// as an empty box. The HTML5 `required` attribute then blocks every save,
// even one that never touches the pay box. The fix drops `required` from
// all three pay inputs.

const updateMock = vi.fn().mockResolvedValue({ id: 'emp-1' });
const createMock = vi.fn().mockResolvedValue({ id: 'emp-1' });

vi.mock('@/hooks/useEmployees', () => ({
  useCreateEmployee: () => ({ mutateAsync: createMock, isPending: false }),
  useUpdateEmployee: () => ({ mutateAsync: updateMock, isPending: false }),
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

function renderEdit(employee: Record<string, unknown>) {
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

describe('EmployeeDialog — masked pay boxes are not required', () => {
  it('does not mark the hourly rate box required', () => {
    renderEdit({
      id: 'emp-1',
      restaurant_id: 'r1',
      name: 'Alex Valdez',
      position: 'Server',
      status: 'active' as const,
      is_active: true,
      compensation_type: 'hourly' as const,
      hourly_rate: null,
      employment_type: 'full_time' as const,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    });

    const rateInput = screen.getByLabelText(/hourly rate in dollars/i);
    expect(rateInput).not.toBeRequired();
  });

  it('does not mark the salary amount box required', () => {
    renderEdit({
      id: 'emp-1',
      restaurant_id: 'r1',
      name: 'Alex Valdez',
      position: 'Manager',
      status: 'active' as const,
      is_active: true,
      compensation_type: 'salary' as const,
      salary_amount: null,
      employment_type: 'full_time' as const,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    });

    const salaryInput = screen.getByLabelText(/salary amount in dollars/i);
    expect(salaryInput).not.toBeRequired();
  });

  it('does not mark the contractor payment amount box required', () => {
    renderEdit({
      id: 'emp-1',
      restaurant_id: 'r1',
      name: 'Alex Valdez',
      position: 'Consultant',
      status: 'active' as const,
      is_active: true,
      compensation_type: 'contractor' as const,
      contractor_payment_amount: null,
      employment_type: 'full_time' as const,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    });

    const paymentInput = screen.getByLabelText(/payment amount in dollars/i);
    expect(paymentInput).not.toBeRequired();
  });
});
