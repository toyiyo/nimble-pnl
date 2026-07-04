import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useCreateTimePunch } from '@/hooks/useTimePunches';

const {
  getUserMock,
  getSessionMock,
  insertMock,
  insertSingleMock,
  abortSignalMock,
  toastMock,
  uploadMock,
} = vi.hoisted(() => ({
  getUserMock: vi.fn(),
  getSessionMock: vi.fn(),
  insertMock: vi.fn(),
  insertSingleMock: vi.fn(),
  abortSignalMock: vi.fn(),
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
            abortSignal: (...signalArgs: unknown[]) => {
              abortSignalMock(...signalArgs);
              return {
                single: insertSingleMock,
              };
            },
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

describe('useCreateTimePunch — photo upload failure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue({ data: { session: { user: { id: 'u1' } } } });
  });

  it('runs the INSERT even when the photo upload rejects, fires no toast before the INSERT resolves, and the success toast is the photo-failure variant', async () => {
    uploadMock.mockResolvedValue({ data: null, error: new Error('upload failed') });

    // Defer the INSERT resolution so we can assert on toast state at the
    // moment insert() is invoked but before it has resolved.
    let resolveInsert!: (value: unknown) => void;
    const insertPromise = new Promise((resolve) => {
      resolveInsert = resolve;
    });
    insertSingleMock.mockReturnValue(insertPromise);

    const { result } = renderHook(() => useCreateTimePunch(), { wrapper });
    const mutatePromise = result.current.mutateAsync({
      ...validPayload(),
      photoBlob: new Blob(['x']),
    });

    // Let the photo-upload rejection and mutationFn's synchronous work flush,
    // without letting the deferred INSERT resolve yet.
    await waitFor(() => expect(insertMock).toHaveBeenCalledTimes(1));

    // The INSERT must have been invoked (punch proceeds without a photo)...
    expect(insertMock).toHaveBeenCalledTimes(1);
    // ...and no toast may have fired yet — the old behavior toasted
    // "Photo upload failed" synchronously inside mutationFn, before the
    // INSERT even ran.
    expect(toastMock).not.toHaveBeenCalled();

    resolveInsert(okInsertResponse());
    await mutatePromise;

    await waitFor(() => expect(toastMock).toHaveBeenCalled());
    expect(toastMock.mock.calls[0]?.[0]).toMatchObject({
      title: 'Punch recorded',
      description: expect.stringMatching(/photo could not be uploaded/i),
    });
  });
});

describe('useCreateTimePunch — photo upload succeeds', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue({ data: { session: { user: { id: 'u1' } } } });
  });

  it('sets photo_path from the upload result and fires the normal success toast (regression pin)', async () => {
    uploadMock.mockResolvedValue({ data: { path: 'r1/e1/punch-123.jpg' }, error: null });
    insertSingleMock.mockResolvedValue(okInsertResponse({ photo_path: 'r1/e1/punch-123.jpg' }));

    const { result } = renderHook(() => useCreateTimePunch(), { wrapper });
    await result.current.mutateAsync({
      ...validPayload(),
      photoBlob: new Blob(['x']),
    });

    // The INSERT must carry the uploaded photo's path.
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({ photo_path: 'r1/e1/punch-123.jpg' }),
    );

    // Success toast is the normal variant, not the photo-failure copy.
    await waitFor(() => expect(toastMock).toHaveBeenCalled());
    expect(toastMock.mock.calls[0]?.[0]).toMatchObject({
      title: 'Punch recorded',
      description: expect.not.stringMatching(/photo could not be uploaded/i),
    });
  });
});

describe('useCreateTimePunch — INSERT abort signal wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue({ data: { session: { user: { id: 'u1' } } } });
    insertSingleMock.mockResolvedValue(okInsertResponse());
  });

  it('chains .insert().select().abortSignal(signal).single() and passes a real AbortSignal', async () => {
    const { result } = renderHook(() => useCreateTimePunch(), { wrapper });
    await result.current.mutateAsync(validPayload());

    expect(insertMock).toHaveBeenCalledTimes(1);
    expect(abortSignalMock).toHaveBeenCalledTimes(1);
    expect(insertSingleMock).toHaveBeenCalledTimes(1);

    const [signal] = abortSignalMock.mock.calls[0];
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal.aborted).toBe(false);
  });
});

describe('useCreateTimePunch — photo upload hangs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    getSessionMock.mockResolvedValue({ data: { session: { user: { id: 'u1' } } } });
    insertSingleMock.mockResolvedValue(okInsertResponse());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('proceeds without photo_path after the 10s photo timeout when the upload never resolves', async () => {
    // Upload never resolves — simulates a hung network request.
    uploadMock.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useCreateTimePunch(), { wrapper });
    const mutatePromise = result.current.mutateAsync({
      ...validPayload(),
      photoBlob: new Blob(['x']),
    });

    // Before the timeout elapses, the INSERT must not have fired yet — the
    // hook is still waiting on the (hung) upload race.
    await vi.advanceTimersByTimeAsync(9_999);
    expect(insertMock).not.toHaveBeenCalled();

    // Cross the 10s photo-upload timeout threshold.
    await vi.advanceTimersByTimeAsync(1);

    await vi.waitFor(() => expect(insertMock).toHaveBeenCalledTimes(1));

    // The punch proceeds without a photo_path — the abandoned upload must
    // not block or fail the punch.
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({ photo_path: undefined }),
    );

    await mutatePromise;
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
