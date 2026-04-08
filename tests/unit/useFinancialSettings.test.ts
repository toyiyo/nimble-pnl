import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockToast = vi.fn();

const mockSupabase = vi.hoisted(() => ({
  from: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: mockSupabase,
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: mockToast }),
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { useFinancialSettings } from '@/hooks/useFinancialSettings';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let mockFromChain: Record<string, ReturnType<typeof vi.fn>>;

function resetChain() {
  mockFromChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: null, error: null }),
  };
  mockSupabase.from.mockReturnValue(mockFromChain);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useFinancialSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetChain();
  });

  it('returns default "inventory" when no settings exist (auto-creates)', async () => {
    // maybeSingle returns null => hook auto-creates default
    mockFromChain.maybeSingle.mockResolvedValue({ data: null, error: null });

    const defaultRow = {
      id: 'new-1',
      restaurant_id: 'rest-123',
      cogs_calculation_method: 'inventory',
      created_at: '2026-03-03T00:00:00Z',
      updated_at: '2026-03-03T00:00:00Z',
    };
    mockFromChain.single.mockResolvedValue({ data: defaultRow, error: null });

    const { result } = renderHook(() => useFinancialSettings('rest-123'));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.settings).toEqual(defaultRow);
    expect(result.current.cogsMethod).toBe('inventory');
    expect(mockFromChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        restaurant_id: 'rest-123',
        cogs_calculation_method: 'inventory',
      }),
    );
  });

  it('returns stored method when settings exist', async () => {
    const existingRow = {
      id: 'set-1',
      restaurant_id: 'rest-123',
      cogs_calculation_method: 'financials',
      created_at: '2026-03-01T00:00:00Z',
      updated_at: '2026-03-01T00:00:00Z',
    };
    mockFromChain.maybeSingle.mockResolvedValue({ data: existingRow, error: null });

    const { result } = renderHook(() => useFinancialSettings('rest-123'));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.settings).toEqual(existingRow);
    expect(result.current.cogsMethod).toBe('financials');
    // Should NOT call insert since data already exists
    expect(mockFromChain.insert).not.toHaveBeenCalled();
  });

  it('updateSettings() calls supabase update and shows success toast', async () => {
    const existingRow = {
      id: 'set-1',
      restaurant_id: 'rest-123',
      cogs_calculation_method: 'inventory',
    };
    mockFromChain.maybeSingle.mockResolvedValue({ data: existingRow, error: null });

    const updatedRow = {
      id: 'set-1',
      restaurant_id: 'rest-123',
      cogs_calculation_method: 'combined',
    };
    // After initial fetch, update call chain
    mockFromChain.single.mockResolvedValue({ data: updatedRow, error: null });

    const { result } = renderHook(() => useFinancialSettings('rest-123'));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await act(async () => {
      await result.current.updateSettings({ cogs_calculation_method: 'combined' });
    });

    expect(mockSupabase.from).toHaveBeenCalledWith('restaurant_financial_settings');
    expect(mockFromChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ cogs_calculation_method: 'combined' }),
    );
    expect(mockFromChain.eq).toHaveBeenCalledWith('restaurant_id', 'rest-123');
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Settings Updated',
        description: 'Financial settings have been saved successfully',
      }),
    );
  });

  it('loading state while fetching', async () => {
    // Use a deferred promise so we can observe the loading state
    let resolveQuery!: (value: { data: unknown; error: unknown }) => void;
    mockFromChain.maybeSingle.mockReturnValue(
      new Promise((resolve) => {
        resolveQuery = resolve;
      }),
    );

    const { result } = renderHook(() => useFinancialSettings('rest-123'));

    // Should be loading initially
    expect(result.current.isLoading).toBe(true);

    // Resolve the query
    await act(async () => {
      resolveQuery({
        data: {
          id: 'set-1',
          restaurant_id: 'rest-123',
          cogs_calculation_method: 'inventory',
        },
        error: null,
      });
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
  });

  it('returns "inventory" as cogsMethod when restaurantId is undefined', async () => {
    const { result } = renderHook(() => useFinancialSettings(undefined));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.settings).toBeNull();
    expect(result.current.cogsMethod).toBe('inventory');
    // Should never call supabase when no restaurantId
    expect(mockSupabase.from).not.toHaveBeenCalled();
  });

  it('shows destructive toast on fetch error', async () => {
    mockFromChain.maybeSingle.mockResolvedValue({
      data: null,
      error: { message: 'DB error' },
    });

    const { result } = renderHook(() => useFinancialSettings('rest-123'));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Error',
        description: 'Failed to load financial settings',
        variant: 'destructive',
      }),
    );
  });

  it('shows destructive toast on update error', async () => {
    const existingRow = {
      id: 'set-1',
      restaurant_id: 'rest-123',
      cogs_calculation_method: 'inventory',
    };
    mockFromChain.maybeSingle.mockResolvedValue({ data: existingRow, error: null });

    const { result } = renderHook(() => useFinancialSettings('rest-123'));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // Make update fail
    mockFromChain.single.mockResolvedValue({
      data: null,
      error: { message: 'Update failed' },
    });

    await act(async () => {
      await result.current.updateSettings({ cogs_calculation_method: 'combined' });
    });

    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Error',
        description: 'Failed to update settings',
        variant: 'destructive',
      }),
    );
  });
});
