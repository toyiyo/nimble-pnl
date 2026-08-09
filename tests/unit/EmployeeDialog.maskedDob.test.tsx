import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { EmployeeDialog } from '@/components/EmployeeDialog';

// Regression test for the "erased date of birth" bug: a manager without
// view:employee_pii reads a masked employee row (date_of_birth: null). The
// dialog prefills the date box as an empty string. On save, the box must NOT
// be read as an explicit null — that would erase the stored date of birth.

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

// A masked row: the caller lacks view:employee_pii, so employees_secure
// returns date_of_birth: null even though a date of birth is on file.
const MASKED_EMPLOYEE = {
  id: 'emp-1',
  restaurant_id: 'r1',
  name: 'Alex Valdez',
  position: 'Server',
  status: 'active' as const,
  is_active: true,
  compensation_type: 'hourly' as const,
  hourly_rate: 2000,
  date_of_birth: null,
  employment_type: 'full_time' as const,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

// An unmasked row: the caller holds view:employee_pii, so the real date of
// birth arrives and is visible in the box.
const VISIBLE_DOB_EMPLOYEE = {
  ...MASKED_EMPLOYEE,
  date_of_birth: '2000-01-01',
};

function renderEdit(employee: typeof MASKED_EMPLOYEE = MASKED_EMPLOYEE) {
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

describe('EmployeeDialog — masked date of birth is not erased', () => {
  beforeEach(() => {
    updateMock.mockClear();
    createMock.mockClear();
  });

  it('never sends date_of_birth: null for a masked (blank) date box on save', async () => {
    renderEdit();

    // Confirm the fixture actually masks the date box, as the bug requires.
    const dobInput = screen.getByLabelText(/date of birth/i) as HTMLInputElement;
    expect(dobInput.value).toBe('');

    const form = document.body.querySelector('form');
    expect(form).not.toBeNull();
    fireEvent.submit(form as HTMLFormElement);

    await waitFor(() => expect(updateMock).toHaveBeenCalled());
    expect(updateMock.mock.calls[0][0].date_of_birth).not.toBe(null);
  });

  // Regression test for the companion bug Codex found in the fix above: a
  // caller who CAN see the date of birth clears it on purpose. The box did
  // not start empty this time, so the clear must send an explicit null, not
  // silently keep the old value.
  it('sends date_of_birth: null when a caller who can see the date clears it', async () => {
    renderEdit(VISIBLE_DOB_EMPLOYEE);

    const dobInput = screen.getByLabelText(/date of birth/i) as HTMLInputElement;
    expect(dobInput.value).toBe('2000-01-01');

    fireEvent.change(dobInput, { target: { value: '' } });
    expect(dobInput.value).toBe('');

    const form = document.body.querySelector('form');
    expect(form).not.toBeNull();
    fireEvent.submit(form as HTMLFormElement);

    await waitFor(() => expect(updateMock).toHaveBeenCalled());
    expect(updateMock.mock.calls[0][0].date_of_birth).toBe(null);
  });
});
