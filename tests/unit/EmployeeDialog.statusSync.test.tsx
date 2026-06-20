import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { EmployeeDialog } from '@/components/EmployeeDialog';

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
  function makeChain(): any {
    const chain: any = {};
    chain.select = () => makeChain();
    chain.eq = () => makeChain();
    chain.not = () => makeChain();
    chain.order = () => Promise.resolve({ data: [], error: null });
    chain.is = () => makeChain();
    chain.single = () => Promise.resolve({ data: null, error: null });
    chain.upsert = () => Promise.resolve({ data: null, error: null });
    chain.insert = () => makeChain();
    chain.update = () => makeChain();
    chain.then = (resolve: (v: { data: any[]; error: null }) => any) =>
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

type EmpOverrides = Partial<{ status: string; is_active: boolean }>;
const makeEmployee = (overrides: EmpOverrides) => ({
  id: 'emp-1',
  restaurant_id: 'r1',
  name: 'Alex Valdez',
  position: 'Server',
  status: 'active',
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
      <EmployeeDialog open onOpenChange={vi.fn()} restaurantId="r1" employee={employee as any} />
    </QueryClientProvider>,
  );
}

describe('EmployeeDialog — is_active is derived from status on save', () => {
  beforeEach(() => {
    updateMock.mockClear();
    createMock.mockClear();
  });

  it('sends is_active=false when status is inactive (even if the row was is_active=true)', async () => {
    renderEdit(makeEmployee({ status: 'inactive', is_active: true }));
    await userEvent.click(screen.getByRole('button', { name: /update employee/i }));
    await waitFor(() => expect(updateMock).toHaveBeenCalled());
    expect(updateMock.mock.calls[0][0]).toEqual(
      expect.objectContaining({ id: 'emp-1', status: 'inactive', is_active: false }),
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
});
