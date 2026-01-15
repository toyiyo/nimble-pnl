import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useExpenseInvoiceUpload } from '@/hooks/useExpenseInvoiceUpload';

const mockSupabase = vi.hoisted(() => ({
  from: vi.fn(),
  functions: {
    invoke: vi.fn(),
  },
  storage: {
    from: vi.fn(),
  },
}));

const toastSpy = vi.fn();

vi.mock('@/integrations/supabase/client', () => ({
  supabase: mockSupabase,
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({
    toast: toastSpy,
  }),
}));

vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => ({
    selectedRestaurant: { restaurant_id: 'rest-123' },
  }),
}));

describe('useExpenseInvoiceUpload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('handles FileReader errors when reading image files', async () => {
    class FileReaderMock {
      onloadend: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onabort: (() => void) | null = null;
      result: string | null = null;

      readAsDataURL() {
        if (this.onerror) {
          this.onerror();
        }
      }
    }

    vi.stubGlobal('FileReader', FileReaderMock as unknown as typeof FileReader);

    const file = new File(['test'], 'invoice.png', { type: 'image/png' });
    const { result } = renderHook(() => useExpenseInvoiceUpload());

    let response: Awaited<ReturnType<typeof result.current.processInvoice>> | null = null;

    await act(async () => {
      response = await result.current.processInvoice('upload-123', file);
    });

    expect(response).toBeNull();
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        description: 'Failed to process invoice',
        variant: 'destructive',
      })
    );
    expect(mockSupabase.functions.invoke).not.toHaveBeenCalled();
  });

  it('toasts when updateInvoiceUpload fails', async () => {
    const updateBuilder = {
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'Update failed' },
      }),
    };

    mockSupabase.from.mockReturnValue(updateBuilder);

    const { result } = renderHook(() => useExpenseInvoiceUpload());
    const response = await result.current.updateInvoiceUpload('upload-123', { status: 'saved' });

    expect(response).toBeNull();
    expect(updateBuilder.update).toHaveBeenCalledWith({ status: 'saved' });
    expect(updateBuilder.eq).toHaveBeenCalledWith('id', 'upload-123');
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        description: 'Failed to update invoice details',
        variant: 'destructive',
      })
    );
  });
});
