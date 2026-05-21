import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useBulkSetAvailability } from '@/hooks/useBulkSetAvailability';

const rpcMock = vi.fn();
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc: (...args: unknown[]) => rpcMock(...args) },
}));

const toastMock = vi.fn();
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: toastMock }),
}));

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('useBulkSetAvailability', () => {
  beforeEach(() => {
    rpcMock.mockReset();
    toastMock.mockReset();
  });

  it('calls the RPC with restaurant_id, employee_ids, availability and invalidates the query', async () => {
    rpcMock.mockResolvedValue({
      data: [{ employees_updated: 2, rows_inserted: 14 }],
      error: null,
    });

    const { result } = renderHook(() => useBulkSetAvailability(), { wrapper });

    await result.current.mutateAsync({
      restaurantId: 'r1',
      employeeIds: ['e1', 'e2'],
      availability: [
        { day_of_week: 1, start_time: '10:00:00', end_time: '22:00:00', is_available: true },
      ],
    });

    expect(rpcMock).toHaveBeenCalledWith('bulk_set_employee_availability', {
      p_restaurant_id: 'r1',
      p_employee_ids: ['e1', 'e2'],
      p_availability: [
        { day_of_week: 1, start_time: '10:00:00', end_time: '22:00:00', is_available: true },
      ],
    });
    expect(toastMock).toHaveBeenCalled();
    expect(toastMock.mock.calls[0][0].variant).not.toBe('destructive');
  });

  it('suppresses the success toast when silent: true', async () => {
    rpcMock.mockResolvedValue({
      data: [{ employees_updated: 1, rows_inserted: 7 }],
      error: null,
    });
    const { result } = renderHook(() => useBulkSetAvailability({ silent: true }), {
      wrapper,
    });
    await result.current.mutateAsync({
      restaurantId: 'r1',
      employeeIds: ['e1'],
      availability: [
        { day_of_week: 1, start_time: '09:00:00', end_time: '17:00:00', is_available: true },
      ],
    });
    expect(toastMock).not.toHaveBeenCalled();
  });

  it('surfaces RPC errors with a destructive toast', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'forbidden', code: '42501' } });
    const { result } = renderHook(() => useBulkSetAvailability(), { wrapper });

    await expect(
      result.current.mutateAsync({
        restaurantId: 'r1',
        employeeIds: ['e1'],
        availability: [
          { day_of_week: 1, start_time: '10:00:00', end_time: '22:00:00', is_available: true },
        ],
      }),
    ).rejects.toThrow();

    await waitFor(() =>
      expect(toastMock.mock.calls.some((c) => c[0].variant === 'destructive')).toBe(true),
    );
  });
});
