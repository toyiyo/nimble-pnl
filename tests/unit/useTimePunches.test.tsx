import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useCreateTimePunch } from '@/hooks/useTimePunches';

const {
  getUserMock,
  getSessionMock,
  insertMock,
  insertSingleMock,
  toastMock,
  uploadMock,
} = vi.hoisted(() => ({
  getUserMock: vi.fn(),
  getSessionMock: vi.fn(),
  insertMock: vi.fn(),
  insertSingleMock: vi.fn(),
  toastMock: vi.fn(),
  uploadMock: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      getUser: getUserMock,
      getSession: getSessionMock,
    },
    from: () => ({
      insert: (...args: unknown[]) => {
        insertMock(...args);
        return {
          select: () => ({
            single: insertSingleMock,
          }),
        };
      },
    }),
    storage: {
      from: () => ({
        upload: uploadMock,
      }),
    },
  },
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: toastMock }),
}));

const wrapper = ({ children }: { children: React.ReactNode }) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
};

const okInsertResponse = (overrides: Record<string, unknown> = {}) => ({
  data: {
    id: 'p1',
    restaurant_id: 'r1',
    employee_id: 'e1',
    punch_type: 'clock_in',
    punch_time: '2026-05-17T12:00:00Z',
    created_by: 'u1',
    ...overrides,
  },
  error: null,
});

const validPayload = () => ({
  restaurant_id: 'r1',
  employee_id: 'e1',
  punch_type: 'clock_in' as const,
  punch_time: '2026-05-17T12:00:00Z',
});

describe('useCreateTimePunch — auth source', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue({ data: { session: { user: { id: 'u1' } } } });
    getUserMock.mockResolvedValue({ data: { user: { id: 'u1' } } });
    insertSingleMock.mockResolvedValue(okInsertResponse());
  });

  it('uses supabase.auth.getSession() (no auth.getUser network call) in the hot path', async () => {
    const { result } = renderHook(() => useCreateTimePunch(), { wrapper });
    await result.current.mutateAsync(validPayload());

    expect(getSessionMock).toHaveBeenCalled();
    expect(getUserMock).not.toHaveBeenCalled();
  });

  it('still passes created_by=user.id through to the INSERT', async () => {
    const { result } = renderHook(() => useCreateTimePunch(), { wrapper });
    await result.current.mutateAsync(validPayload());

    // The hook composes the insert as { ...punchData, photo_path, created_by: user?.id }.
    // Assert the actual row passed to insert() carries created_by = the session user
    // id — the previous version only checked that INSERT fired, which would pass even
    // if created_by were undefined.
    expect(insertMock).toHaveBeenCalledTimes(1);
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({ created_by: 'u1' }),
    );
  });
});

describe('useCreateTimePunch — silent toast', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue({ data: { session: { user: { id: 'u1' } } } });
    insertSingleMock.mockResolvedValue(okInsertResponse());
  });

  it('fires the success toast by default', async () => {
    const { result } = renderHook(() => useCreateTimePunch(), { wrapper });
    await result.current.mutateAsync(validPayload());
    await waitFor(() => expect(toastMock).toHaveBeenCalled());
    expect(toastMock.mock.calls[0]?.[0]?.title).toBe('Punch recorded');
  });

  it('suppresses the global success toast when silent: true', async () => {
    const { result } = renderHook(() => useCreateTimePunch(), { wrapper });
    await result.current.mutateAsync({ ...validPayload(), silent: true });
    // Allow onSuccess to flush
    await new Promise((r) => setTimeout(r, 0));
    expect(toastMock).not.toHaveBeenCalled();
  });
});
