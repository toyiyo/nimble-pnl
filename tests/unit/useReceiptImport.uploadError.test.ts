import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useReceiptImport } from '@/hooks/useReceiptImport';
import { UPLOAD_ERROR_TOAST_DURATION } from '@/lib/storageError';

const mockSupabase = vi.hoisted(() => ({
  from: vi.fn(),
  storage: { from: vi.fn() },
  functions: { invoke: vi.fn() },
}));

const toastSpy = vi.fn();

vi.mock('@/integrations/supabase/client', () => ({ supabase: mockSupabase }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: toastSpy }) }));
vi.mock('@/components/ui/use-toast', () => ({ useToast: () => ({ toast: toastSpy }) }));
vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => ({
    selectedRestaurant: { restaurant_id: 'rest-123' },
  }),
}));

function makeSelectBuilder(resultData: unknown) {
  const builder: Record<string, ReturnType<typeof vi.fn>> = {};
  builder.select = vi.fn(() => builder);
  builder.eq = vi.fn(() => builder);
  builder.order = vi.fn(() => builder);
  builder.limit = vi.fn(() => builder);
  builder.maybeSingle = vi.fn().mockResolvedValue({ data: resultData, error: null });
  return builder;
}

function mockInsertOk(row: object) {
  return {
    insert: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: row, error: null }),
  };
}

// Mimics @supabase/storage-js StorageApiError (status: number, statusCode: string).
function apiError(status: number, message: string) {
  return { name: 'StorageApiError', message, status, statusCode: String(status) };
}

describe('useReceiptImport — uploadReceipt error diagnostics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sets uploadErrorMessage to the curated code-keyed message and toasts with the diagnostics duration', async () => {
    const file = new File(['hello'], 'r.png', { type: 'image/png' });
    mockSupabase.from.mockReturnValue(makeSelectBuilder(null));
    const upload = vi.fn().mockResolvedValue({
      data: null,
      error: apiError(413, 'The object exceeded the maximum allowed size'),
    });
    mockSupabase.storage.from.mockReturnValue({ upload });

    const { result } = renderHook(() => useReceiptImport());
    let res: unknown;
    await act(async () => {
      res = await result.current.uploadReceipt(file);
    });

    expect(res).toBeNull();
    expect(result.current.uploadErrorMessage).toBe('This file is too large to upload.');
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Upload failed',
        description: 'This file is too large to upload.',
        variant: 'destructive',
        duration: UPLOAD_ERROR_TOAST_DURATION,
      }),
    );
  });

  it('logs a stringified logLine carrying the raw server body, but never leaks it into the toast', async () => {
    const file = new File(['hello'], 'r.png', { type: 'image/png' });
    mockSupabase.from.mockReturnValue(makeSelectBuilder(null));
    const rls = 'new row violates row-level security policy for table "objects"';
    const upload = vi.fn().mockResolvedValue({ data: null, error: apiError(400, rls) });
    mockSupabase.storage.from.mockReturnValue({ upload });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { result } = renderHook(() => useReceiptImport());
    await act(async () => {
      await result.current.uploadReceipt(file);
    });

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('[400]'));
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining(rls));
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({ description: expect.not.stringContaining('row-level') }),
    );

    errorSpy.mockRestore();
  });

  it('clears uploadErrorMessage on a subsequent successful attempt', async () => {
    const file = new File(['hello'], 'r.png', { type: 'image/png' });

    mockSupabase.from.mockReturnValueOnce(makeSelectBuilder(null));
    const failUpload = vi.fn().mockResolvedValue({ data: null, error: apiError(500, 'boom') });
    mockSupabase.storage.from.mockReturnValue({ upload: failUpload });

    const { result } = renderHook(() => useReceiptImport());
    await act(async () => {
      await result.current.uploadReceipt(file);
    });
    expect(result.current.uploadErrorMessage).not.toBeNull();

    const insertBuilder = mockInsertOk({ id: 'new-id', restaurant_id: 'rest-123' });
    mockSupabase.from
      .mockReturnValueOnce(makeSelectBuilder(null))
      .mockReturnValueOnce(insertBuilder);
    const okUpload = vi.fn().mockResolvedValue({ data: { path: 'p' }, error: null });
    mockSupabase.storage.from.mockReturnValue({ upload: okUpload });

    await act(async () => {
      await result.current.uploadReceipt(file);
    });

    expect(result.current.uploadErrorMessage).toBeNull();
  });

  it('clearUploadError resets the message directly', async () => {
    const file = new File(['hello'], 'r.png', { type: 'image/png' });
    mockSupabase.from.mockReturnValue(makeSelectBuilder(null));
    const upload = vi.fn().mockResolvedValue({ data: null, error: apiError(500, 'boom') });
    mockSupabase.storage.from.mockReturnValue({ upload });

    const { result } = renderHook(() => useReceiptImport());
    await act(async () => {
      await result.current.uploadReceipt(file);
    });
    expect(result.current.uploadErrorMessage).not.toBeNull();

    act(() => {
      result.current.clearUploadError();
    });

    expect(result.current.uploadErrorMessage).toBeNull();
  });
});
