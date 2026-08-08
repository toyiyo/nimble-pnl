import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useCreateEmployee, useUpdateEmployee } from '@/hooks/useEmployees';

// A caller with no `view:pay_rates` or `view:employee_pii` flag reads NULL
// for the masked columns (Task 3's view). The Edit Employee form then holds
// that NULL and would write it back on save, erasing the stored value. The
// mutation hooks strip the masked keys from the payload before the write so
// the caller can only ever touch columns it can read.

const {
  hasCapabilityMock,
  isResolvedMock,
  insertMock,
  insertSingleMock,
  insertSelectArgsMock,
  updateMock,
  updateEqMock,
  updateSingleMock,
  updateSelectArgsMock,
  toastMock,
} = vi.hoisted(() => ({
  hasCapabilityMock: vi.fn(),
  isResolvedMock: vi.fn(),
  insertMock: vi.fn(),
  insertSingleMock: vi.fn(),
  insertSelectArgsMock: vi.fn(),
  updateMock: vi.fn(),
  updateEqMock: vi.fn(),
  updateSingleMock: vi.fn(),
  updateSelectArgsMock: vi.fn(),
  toastMock: vi.fn(),
}));

vi.mock('@/hooks/usePermissions', () => ({
  usePermissions: () => ({
    hasCapability: hasCapabilityMock,
    isResolved: isResolvedMock(),
  }),
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: toastMock }),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: () => ({
      insert: (...args: unknown[]) => {
        insertMock(...args);
        return {
          select: (...selectArgs: unknown[]) => {
            insertSelectArgsMock(...selectArgs);
            return { single: insertSingleMock };
          },
        };
      },
      update: (...args: unknown[]) => {
        updateMock(...args);
        return {
          eq: (...eqArgs: unknown[]) => {
            updateEqMock(...eqArgs);
            return {
              select: (...selectArgs: unknown[]) => {
                updateSelectArgsMock(...selectArgs);
                return { single: updateSingleMock };
              },
            };
          },
        };
      },
    }),
  },
}));

const wrapper = ({ children }: { children: React.ReactNode }) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
};

const okResponse = () => ({
  data: { id: 'e1', restaurant_id: 'r1', name: 'Ada' },
  error: null,
});

const fullEmployeePayload = () => ({
  restaurant_id: 'r1',
  name: 'Ada',
  hourly_rate: 25,
  salary_amount: 60000,
  contractor_payment_amount: 500,
  daily_rate_amount: 100,
  daily_rate_reference_weekly: 500,
  email: 'ada@example.com',
  phone: '555-1234',
  date_of_birth: '1990-01-01',
});

describe('useCreateEmployee — masked field strip', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertSingleMock.mockResolvedValue(okResponse());
  });

  it('strips pay-rate and PII fields when the caller holds neither flag', async () => {
    isResolvedMock.mockReturnValue(true);
    hasCapabilityMock.mockReturnValue(false);

    const { result } = renderHook(() => useCreateEmployee(), { wrapper });
    await result.current.mutateAsync(fullEmployeePayload() as any); // eslint-disable-line @typescript-eslint/no-explicit-any -- fixture omits Employee fields the mutation hook never reads

    expect(insertMock).toHaveBeenCalledTimes(1);
    const insertedRow = insertMock.mock.calls[0][0];
    expect(insertedRow).toEqual({ restaurant_id: 'r1', name: 'Ada' });
  });

  it('keeps every field when the caller holds both flags', async () => {
    isResolvedMock.mockReturnValue(true);
    hasCapabilityMock.mockReturnValue(true);

    const { result } = renderHook(() => useCreateEmployee(), { wrapper });
    const payload = fullEmployeePayload();
    await result.current.mutateAsync(payload as any); // eslint-disable-line @typescript-eslint/no-explicit-any -- fixture omits Employee fields the mutation hook never reads

    expect(insertMock).toHaveBeenCalledWith(payload);
  });

  it('treats an unresolved permission state as holding neither flag', async () => {
    isResolvedMock.mockReturnValue(false);
    hasCapabilityMock.mockReturnValue(true);

    const { result } = renderHook(() => useCreateEmployee(), { wrapper });
    await result.current.mutateAsync(fullEmployeePayload() as any); // eslint-disable-line @typescript-eslint/no-explicit-any -- fixture omits Employee fields the mutation hook never reads

    const insertedRow = insertMock.mock.calls[0][0];
    expect(insertedRow).toEqual({ restaurant_id: 'r1', name: 'Ada' });
  });

  it('selects only id, restaurant_id, name — not a bare select()', async () => {
    isResolvedMock.mockReturnValue(true);
    hasCapabilityMock.mockReturnValue(true);

    const { result } = renderHook(() => useCreateEmployee(), { wrapper });
    await result.current.mutateAsync(fullEmployeePayload() as any); // eslint-disable-line @typescript-eslint/no-explicit-any -- fixture omits Employee fields the mutation hook never reads

    expect(insertSelectArgsMock).toHaveBeenCalledWith('id, restaurant_id, name');
  });
});

describe('useUpdateEmployee — masked field strip', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateSingleMock.mockResolvedValue(okResponse());
  });

  it('strips pay-rate and PII fields when the caller holds neither flag', async () => {
    isResolvedMock.mockReturnValue(true);
    hasCapabilityMock.mockReturnValue(false);

    const { result } = renderHook(() => useUpdateEmployee(), { wrapper });
    await result.current.mutateAsync({ id: 'e1', ...fullEmployeePayload() } as any); // eslint-disable-line @typescript-eslint/no-explicit-any -- fixture omits Employee fields the mutation hook never reads

    expect(updateMock).toHaveBeenCalledTimes(1);
    const updatedRow = updateMock.mock.calls[0][0];
    expect(updatedRow).toEqual({ restaurant_id: 'r1', name: 'Ada' });
    expect(updateEqMock).toHaveBeenCalledWith('id', 'e1');
  });

  it('keeps every field when the caller holds both flags', async () => {
    isResolvedMock.mockReturnValue(true);
    hasCapabilityMock.mockReturnValue(true);

    const { result } = renderHook(() => useUpdateEmployee(), { wrapper });
    const payload = fullEmployeePayload();
    await result.current.mutateAsync({ id: 'e1', ...payload } as any); // eslint-disable-line @typescript-eslint/no-explicit-any -- fixture omits Employee fields the mutation hook never reads

    expect(updateMock).toHaveBeenCalledWith(payload);
  });

  it('selects only id, restaurant_id, name — not a bare select()', async () => {
    isResolvedMock.mockReturnValue(true);
    hasCapabilityMock.mockReturnValue(true);

    const { result } = renderHook(() => useUpdateEmployee(), { wrapper });
    await result.current.mutateAsync({ id: 'e1', ...fullEmployeePayload() } as any); // eslint-disable-line @typescript-eslint/no-explicit-any -- fixture omits Employee fields the mutation hook never reads

    expect(updateSelectArgsMock).toHaveBeenCalledWith('id, restaurant_id, name');
  });
});
