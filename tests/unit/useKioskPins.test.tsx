import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useUpsertEmployeePin } from '@/hooks/useKioskPins';

const { upsertSelectMock, functionsInvokeMock } = vi.hoisted(() => ({
  upsertSelectMock: vi.fn(),
  functionsInvokeMock: vi.fn().mockResolvedValue({ data: { ok: true }, error: null }),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: () => ({
      upsert: () => ({
        select: () => ({
          single: upsertSelectMock,
        }),
      }),
    }),
    functions: {
      invoke: functionsInvokeMock,
    },
  },
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

const wrapper = ({ children }: { children: React.ReactNode }) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
};

describe('useUpsertEmployeePin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    upsertSelectMock.mockResolvedValue({
      data: {
        id: 'pin-1',
        restaurant_id: 'r1',
        employee_id: 'e1',
        pin_hash: 'h',
        min_length: 4,
        force_reset: false,
        last_used_at: null,
        created_at: '2026-05-16T00:00:00Z',
        updated_at: '2026-05-16T00:00:00Z',
      },
      error: null,
    });
  });

  it('invokes notify-pin-changed when actor is manager', async () => {
    const { result } = renderHook(() => useUpsertEmployeePin(), { wrapper });
    await result.current.mutateAsync({
      restaurant_id: 'r1',
      employee_id: 'e1',
      pin: '1357',
      actor: 'manager',
    });
    await waitFor(() => {
      expect(functionsInvokeMock).toHaveBeenCalledWith('notify-pin-changed', {
        body: { restaurantId: 'r1', employeeId: 'e1', action: 'reset', actor: 'manager' },
      });
    });
  });

  it('does NOT invoke notify-pin-changed when actor is self', async () => {
    const { result } = renderHook(() => useUpsertEmployeePin(), { wrapper });
    await result.current.mutateAsync({
      restaurant_id: 'r1',
      employee_id: 'e1',
      pin: '1357',
      actor: 'self',
    });
    expect(functionsInvokeMock).not.toHaveBeenCalled();
  });

  it('defaults to actor=manager when omitted (back-compat)', async () => {
    const { result } = renderHook(() => useUpsertEmployeePin(), { wrapper });
    await result.current.mutateAsync({
      restaurant_id: 'r1',
      employee_id: 'e1',
      pin: '1357',
    });
    await waitFor(() => expect(functionsInvokeMock).toHaveBeenCalled());
  });
});
