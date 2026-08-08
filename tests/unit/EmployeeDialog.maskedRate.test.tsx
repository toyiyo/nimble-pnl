import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { EmployeeDialog } from '@/components/EmployeeDialog';

// Regression test for the "fabricated zero rate" bug: a manager without
// view:pay_rates reads a masked employee row (hourly_rate: null). The dialog
// prefills the rate box as an empty string. On save, the box must NOT be
// read as a real $0.00 rate — that would overwrite the true rate on the row
// and write a permanent $0.00 entry to the compensation history.

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

// A masked row: the caller lacks view:pay_rates, so employees_secure returns
// hourly_rate: null even though the employee is paid hourly.
const MASKED_EMPLOYEE = {
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
};

function renderEdit() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, staleTime: Infinity } },
  });
  return render(
    <QueryClientProvider client={qc}>
      {/* cast: test fixture omits optional Employee fields */}
      <EmployeeDialog open onOpenChange={vi.fn()} restaurantId="r1" employee={MASKED_EMPLOYEE as any} /> {/* eslint-disable-line @typescript-eslint/no-explicit-any */}
    </QueryClientProvider>,
  );
}

describe('EmployeeDialog — masked hourly rate is not fabricated as zero', () => {
  beforeEach(() => {
    updateMock.mockClear();
    createMock.mockClear();
  });

  it('never sends hourly_rate: 0 for a masked (blank) rate box on save', async () => {
    renderEdit();

    // Confirm the fixture actually masks the rate box, as the bug requires.
    const rateInput = screen.getByLabelText(/hourly rate in dollars/i) as HTMLInputElement;
    expect(rateInput.value).toBe('');

    // Submit without touching the rate box. Use fireEvent.submit to bypass
    // the input's `required` attribute — that HTML5 gate is a separate,
    // later fix (plan Step 9) and is not what this test checks.
    // Radix Dialog renders the form into a portal on document.body, so
    // query from there rather than the render() container.
    const form = document.body.querySelector('form');
    expect(form).not.toBeNull();
    fireEvent.submit(form as HTMLFormElement);

    // An unknown (masked) rate is not a compensation change, so the dialog
    // saves the row directly and never opens the effective-date modal.
    await waitFor(() => expect(updateMock).toHaveBeenCalled());
    expect(updateMock.mock.calls[0][0].hourly_rate).not.toBe(0);
    expect(
      screen.queryByRole('heading', { name: /apply new compensation rate/i }),
    ).not.toBeInTheDocument();
  });
});
