import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useSendAvailabilityReminder } from '@/hooks/useSendAvailabilityReminder';

const invokeMock = vi.fn();
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => invokeMock(...args) } },
}));

const toastMock = vi.fn();
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: toastMock }),
}));

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('useSendAvailabilityReminder', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    toastMock.mockReset();
  });

  it('invokes notify-availability-reminder with restaurant_id and employee_ids', async () => {
    invokeMock.mockResolvedValue({ data: { sent: 2, skipped_no_email: 0, errors: 0 }, error: null });
    const { result } = renderHook(() => useSendAvailabilityReminder(), { wrapper });
    await result.current.mutateAsync({ restaurantId: 'r1', employeeIds: ['e1', 'e2'] });

    expect(invokeMock).toHaveBeenCalledWith('notify-availability-reminder', {
      body: { restaurant_id: 'r1', employee_ids: ['e1', 'e2'] },
    });
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: expect.stringMatching(/reminder/i) }),
    );
  });

  it('shows destructive toast when invoke rejects', async () => {
    invokeMock.mockRejectedValue(new Error('network down'));
    const { result } = renderHook(() => useSendAvailabilityReminder(), { wrapper });
    await expect(
      result.current.mutateAsync({ restaurantId: 'r1', employeeIds: ['e1'] }),
    ).rejects.toThrow('network down');
    await waitFor(() =>
      expect(toastMock.mock.calls.some((c) => c[0].variant === 'destructive')).toBe(true),
    );
  });

  it('shows destructive toast when invoke returns { error }', async () => {
    invokeMock.mockResolvedValue({ data: null, error: { message: 'forbidden' } });
    const { result } = renderHook(() => useSendAvailabilityReminder(), { wrapper });
    await expect(
      result.current.mutateAsync({ restaurantId: 'r1', employeeIds: ['e1'] }),
    ).rejects.toThrow(/forbidden/);
    await waitFor(() =>
      expect(toastMock.mock.calls.some((c) => c[0].variant === 'destructive')).toBe(true),
    );
  });
});
