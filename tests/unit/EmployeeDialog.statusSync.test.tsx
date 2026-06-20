import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { EmployeeDialog } from '@/components/EmployeeDialog';
import type { EmployeeStatus } from '@/types/scheduling';

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

vi.mock('@/integrations/supabase/client', () => {
  // Recursive fluent-builder mock — must be `any` because the chain can call
  // any subset of methods in any order; a typed interface would require an
  // exhaustive intersection of all Supabase builder return types.
  function makeChain(): any { // eslint-disable-line @typescript-eslint/no-explicit-any
    // `chain` is `any` here because the recursive self-reference prevents a
    // concrete type from being declared before the object literal is complete.
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
    // `resolve` and the return type use `any` to match the overloaded
    // PromiseLike signatures Supabase's query builder emits at runtime.
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

type EmpOverrides = Partial<{ status: EmployeeStatus; is_active: boolean }>;
const makeEmployee = (overrides: EmpOverrides) => ({
  id: 'emp-1',
  restaurant_id: 'r1',
  name: 'Alex Valdez',
  position: 'Server',
  status: 'active' as EmployeeStatus,
  is_active: true,
  compensation_type: 'hourly',
  hourly_rate: 1500,
  employment_type: 'full_time',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  ...overrides,
});

function renderEdit(employee: ReturnType<typeof makeEmployee>) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, staleTime: Infinity } },
  });
  return render(
    <QueryClientProvider client={qc}>
      {/* cast: test fixture omits optional Employee fields (e.g. notes, date_of_birth) */}
      <EmployeeDialog open onOpenChange={vi.fn()} restaurantId="r1" employee={employee as any} /> {/* eslint-disable-line @typescript-eslint/no-explicit-any */}
    </QueryClientProvider>,
  );
}

function renderCreate() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, staleTime: Infinity } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <EmployeeDialog open onOpenChange={vi.fn()} restaurantId="r1" />
    </QueryClientProvider>,
  );
}

describe('EmployeeDialog — is_active is derived from status on save', () => {
  beforeEach(() => {
    updateMock.mockClear();
    createMock.mockClear();
  });

  // ── Direct update path ────────────────────────────────────────────────────

  it('sends is_active=false when status is inactive (even if the row was is_active=true)', async () => {
    renderEdit(makeEmployee({ status: 'inactive', is_active: true }));
    await userEvent.click(screen.getByRole('button', { name: /update employee/i }));
    await waitFor(() => expect(updateMock).toHaveBeenCalled());
    expect(updateMock.mock.calls[0][0]).toEqual(
      expect.objectContaining({ id: 'emp-1', status: 'inactive', is_active: false }),
    );
  });

  it('sends is_active=false when status is terminated (even if the row was is_active=true)', async () => {
    // termination_date is required when status='terminated' — include it in the
    // fixture so HTML5 form validation does not block submit.
    renderEdit(makeEmployee({ status: 'terminated', is_active: true, termination_date: '2026-01-15' } as any)); // eslint-disable-line @typescript-eslint/no-explicit-any
    await userEvent.click(screen.getByRole('button', { name: /update employee/i }));
    await waitFor(() => expect(updateMock).toHaveBeenCalled());
    expect(updateMock.mock.calls[0][0]).toEqual(
      expect.objectContaining({ id: 'emp-1', status: 'terminated', is_active: false }),
    );
  });

  it('sends is_active=true when status is active (even if the row was is_active=false)', async () => {
    renderEdit(makeEmployee({ status: 'active', is_active: false }));
    await userEvent.click(screen.getByRole('button', { name: /update employee/i }));
    await waitFor(() => expect(updateMock).toHaveBeenCalled());
    expect(updateMock.mock.calls[0][0]).toEqual(
      expect.objectContaining({ id: 'emp-1', status: 'active', is_active: true }),
    );
  });

  // ── Deferred comp-change path ─────────────────────────────────────────────
  // When compensation changes simultaneously, the dialog stores employeeData in
  // pendingCompChange.updatePayload and defers the write until the user confirms
  // an effective date. The is_active derivation must survive that deferral so a
  // future refactor of proceedWithSubmit cannot silently regress the bug.

  it('deferred comp-change path: payload sent via handleApplyCompChange still derives is_active from status', async () => {
    const user = userEvent.setup();
    // Employee is currently inactive with is_active=true (the bug scenario).
    renderEdit(makeEmployee({ status: 'inactive', is_active: true, hourly_rate: 1500 }));

    // Change the hourly rate to trigger hasCompensationChanged → comp-change modal.
    // Use $16/hr (below the $50 high-rate-warning threshold) so we don't hit the
    // separate high-rate-warning dialog.
    const rateInput = screen.getByLabelText(/hourly rate in dollars/i);
    await user.clear(rateInput);
    await user.type(rateInput, '16.00');

    // Submit → comp-change modal opens instead of saving directly.
    await user.click(screen.getByRole('button', { name: /update employee/i }));

    // The effective-date modal should now be visible.
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /apply new compensation rate/i })).toBeInTheDocument(),
    );

    // Confirm in the comp-change modal → triggers handleApplyCompChange which
    // calls updateEmployee.mutateAsync(pendingCompChange.updatePayload).
    await user.click(screen.getByRole('button', { name: /save new rate/i }));

    await waitFor(() => expect(updateMock).toHaveBeenCalled());
    expect(updateMock.mock.calls[0][0]).toEqual(
      expect.objectContaining({ id: 'emp-1', status: 'inactive', is_active: false }),
    );
  });

  // ── Create path ───────────────────────────────────────────────────────────
  // The create form starts with status='active'. Fill minimum required fields
  // and verify the payload sent to createEmployee.mutateAsync includes the
  // correct is_active derived from status.

  it('create path: new employee payload derives is_active from the selected status', async () => {
    const user = userEvent.setup();
    renderCreate();

    // Fill required name field
    await user.type(screen.getByLabelText(/name/i), 'New Employee');

    // Fill required hourly rate (default compensation type is hourly)
    const rateInput = screen.getByLabelText(/hourly rate in dollars/i);
    await user.clear(rateInput);
    await user.type(rateInput, '15.00');

    // Submit — default status is 'active'
    await user.click(screen.getByRole('button', { name: /add employee/i }));

    await waitFor(() => expect(createMock).toHaveBeenCalled());
    expect(createMock.mock.calls[0][0]).toEqual(
      expect.objectContaining({ status: 'active', is_active: true }),
    );
  });
});
