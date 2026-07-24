import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAssetImport } from '@/hooks/useAssetImport';
import { useAssetPhotos } from '@/hooks/useAssetPhotos';
import { useAttachments } from '@/hooks/useAttachments';
import { UPLOAD_ERROR_TOAST_DURATION } from '@/lib/storageError';

// Shared Supabase mock. storage.from().upload is what each hook awaits first; a
// non-null error there drives every catch block under test. from() returns a
// chainable thenable so the hooks' mount-time React Query fetches resolve empty
// instead of throwing.
const mockSupabase = vi.hoisted(() => ({
  from: vi.fn(),
  storage: { from: vi.fn() },
}));

const toastSpy = vi.fn();

vi.mock('@/integrations/supabase/client', () => ({ supabase: mockSupabase }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: toastSpy }) }));
vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => ({
    selectedRestaurant: { restaurant_id: 'rest-123' },
  }),
}));
// useAssetImport pulls createAssetAsync from useAssets — never reached on the
// upload-error path, but the hook calls useAssets() at render time.
vi.mock('@/hooks/useAssets', () => ({
  useAssets: () => ({ createAssetAsync: vi.fn() }),
}));

// A chainable builder that is also a thenable, so `await from(...).select()...`
// resolves to an empty result set for the hooks' mount queries.
function emptyResultBuilder() {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  for (const m of ['select', 'eq', 'order', 'limit', 'insert', 'update', 'single', 'maybeSingle']) {
    builder[m] = vi.fn(chain);
  }
  (builder as { then: unknown }).then = (resolve: (v: unknown) => unknown) =>
    resolve({ data: [], error: null });
  return builder;
}

// Mimics @supabase/storage-js StorageApiError (status: number, statusCode: string).
function apiError(status: number, message: string) {
  return { name: 'StorageApiError', message, status, statusCode: String(status) };
}

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return createElement(QueryClientProvider, { client: queryClient }, children);
}

const imageFile = () => new File(['x'], 'photo.png', { type: 'image/png' });

beforeEach(() => {
  vi.clearAllMocks();
  mockSupabase.from.mockImplementation(() => emptyResultBuilder());
});

describe('useAssetImport.uploadDocument — upload error diagnostics', () => {
  it('surfaces the curated 413 message with the diagnostics toast duration', async () => {
    const upload = vi.fn().mockResolvedValue({
      data: null,
      error: apiError(413, 'The object exceeded the maximum allowed size'),
    });
    mockSupabase.storage.from.mockReturnValue({ upload });

    const { result } = renderHook(() => useAssetImport(), { wrapper });
    let res: unknown;
    await act(async () => {
      res = await result.current.uploadDocument(imageFile());
    });

    expect(res).toBeNull();
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Upload failed',
        description: 'This file is too large to upload.',
        variant: 'destructive',
        duration: UPLOAD_ERROR_TOAST_DURATION,
      }),
    );
  });

  it('logs the raw 400 RLS body but never leaks it into the toast', async () => {
    const rls = 'new row violates row-level security policy for table "objects"';
    const upload = vi.fn().mockResolvedValue({ data: null, error: apiError(400, rls) });
    mockSupabase.storage.from.mockReturnValue({ upload });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { result } = renderHook(() => useAssetImport(), { wrapper });
    await act(async () => {
      await result.current.uploadDocument(imageFile());
    });

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('[400]'));
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining(rls));
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({ description: expect.not.stringContaining('row-level') }),
    );
    errorSpy.mockRestore();
  });
});

describe('useAssetPhotos.uploadPhoto — upload error diagnostics', () => {
  it('surfaces the curated 413 message with the diagnostics toast duration', async () => {
    const upload = vi.fn().mockResolvedValue({
      data: null,
      error: apiError(413, 'The object exceeded the maximum allowed size'),
    });
    mockSupabase.storage.from.mockReturnValue({ upload });

    const { result } = renderHook(() => useAssetPhotos({ assetId: 'asset-1' }), { wrapper });
    let res: unknown;
    await act(async () => {
      res = await result.current.uploadPhoto(imageFile());
    });

    expect(res).toBeNull();
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Upload failed',
        description: 'This file is too large to upload.',
        variant: 'destructive',
        duration: UPLOAD_ERROR_TOAST_DURATION,
      }),
    );
  });

  it('logs the raw 400 RLS body but never leaks it into the toast', async () => {
    const rls = 'new row violates row-level security policy for table "objects"';
    const upload = vi.fn().mockResolvedValue({ data: null, error: apiError(400, rls) });
    mockSupabase.storage.from.mockReturnValue({ upload });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { result } = renderHook(() => useAssetPhotos({ assetId: 'asset-1' }), { wrapper });
    await act(async () => {
      await result.current.uploadPhoto(imageFile());
    });

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('[400]'));
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining(rls));
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({ description: expect.not.stringContaining('row-level') }),
    );
    errorSpy.mockRestore();
  });
});

describe('useAttachments.uploadAttachment — upload error diagnostics', () => {
  const options = { context: { type: 'expense' as const, expenseId: 'exp-1' } };

  it('surfaces the curated 413 message with the diagnostics toast duration', async () => {
    const upload = vi.fn().mockResolvedValue({
      data: null,
      error: apiError(413, 'The object exceeded the maximum allowed size'),
    });
    mockSupabase.storage.from.mockReturnValue({ upload });

    const { result } = renderHook(() => useAttachments(options), { wrapper });
    let res: unknown;
    await act(async () => {
      res = await result.current.uploadAttachment(imageFile());
    });

    expect(res).toBeNull();
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Upload failed',
        description: 'This file is too large to upload.',
        variant: 'destructive',
        duration: UPLOAD_ERROR_TOAST_DURATION,
      }),
    );
  });

  it('logs the raw 400 RLS body but never leaks it into the toast', async () => {
    const rls = 'new row violates row-level security policy for table "objects"';
    const upload = vi.fn().mockResolvedValue({ data: null, error: apiError(400, rls) });
    mockSupabase.storage.from.mockReturnValue({ upload });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { result } = renderHook(() => useAttachments(options), { wrapper });
    await act(async () => {
      await result.current.uploadAttachment(imageFile());
    });

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('[400]'));
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining(rls));
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({ description: expect.not.stringContaining('row-level') }),
    );
    errorSpy.mockRestore();
  });
});
