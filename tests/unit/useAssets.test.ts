import { describe, it, expect, vi, beforeEach } from 'vitest';
import React, { ReactNode } from 'react';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAssets } from '@/hooks/useAssets';
import type { AssetFormData, AssetDisposalData } from '@/types/assets';

// Mock Supabase client
const mockSupabase = vi.hoisted(() => ({
  from: vi.fn(),
}));

const mockToast = vi.hoisted(() => ({
  toast: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: mockSupabase,
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => mockToast,
}));

vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => ({
    selectedRestaurant: { restaurant_id: 'rest-123' },
  }),
}));

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return function Wrapper({ children }: { children: ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
};

// Mock data - using the actual database schema fields
const mockAssetFromDB = {
  id: 'asset-1',
  restaurant_id: 'rest-123',
  name: 'Test Asset',
  description: 'Test Description',
  category: 'equipment',
  serial_number: null,
  purchase_date: '2024-01-01',
  purchase_cost: 1000,
  salvage_value: 0,
  useful_life_months: 60,
  location_id: null,
  asset_account_id: null,
  accumulated_depreciation_account_id: null,
  depreciation_expense_account_id: null,
  notes: null,
  status: 'active',
  accumulated_depreciation: 100,
  disposal_date: null,
  disposal_proceeds: null,
  disposal_notes: null,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
  inventory_locations: null,
};

const mockAssetWithDetails = {
  ...mockAssetFromDB,
  net_book_value: 900, // purchase_cost - accumulated_depreciation
  monthly_depreciation: 16.67, // (purchase_cost - salvage_value) / useful_life_months
  remaining_useful_life_months: 54, // useful_life_months - months depreciated
  depreciation_percentage: 10, // (accumulated_depreciation / depreciable_amount) * 100
  location_name: undefined,
};

const mockAssetsFromDB = [mockAssetFromDB];

describe('useAssets Hook', () => {
  let mockFromChain: any;

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup mock chain for all operations
    mockFromChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
      single: vi.fn().mockReturnThis(),
      data: null,
      error: null,
    };

    mockSupabase.from.mockReturnValue(mockFromChain);
  });

  describe('Query functionality', () => {
    it('should fetch assets successfully', async () => {
      mockFromChain.data = mockAssetsFromDB;

      const { result } = renderHook(() => useAssets(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.assets).toHaveLength(1);
        expect(result.current.assets[0]).toMatchObject({
          id: 'asset-1',
          name: 'Test Asset',
          net_book_value: 900,
          monthly_depreciation: 16.666666666666668, // Exact calculation
        });
        expect(result.current.isLoading).toBe(false);
        expect(result.current.error).toBe(null);
      });

      expect(mockSupabase.from).toHaveBeenCalledWith('assets');
      expect(mockFromChain.select).toHaveBeenCalled();
      expect(mockFromChain.eq).toHaveBeenCalledWith('restaurant_id', 'rest-123');
      expect(mockFromChain.order).toHaveBeenCalledWith('created_at', { ascending: false });
    });

    it('should handle loading state', () => {
      mockFromChain.data = null;

      const { result } = renderHook(() => useAssets(), {
        wrapper: createWrapper(),
      });

      expect(result.current.isLoading).toBe(true);
      expect(result.current.assets).toEqual([]);
    });

    it('should handle error state', async () => {
      mockFromChain.error = new Error('Database error');

      const { result } = renderHook(() => useAssets(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.error).toBeInstanceOf(Error);
        expect(result.current.error?.message).toBe('Database error');
        expect(result.current.isLoading).toBe(false);
      });
    });
  });

  describe('Summary calculations', () => {
    it('should calculate asset summary correctly', async () => {
      const assetsWithValues = [
        { ...mockAssetFromDB, purchase_cost: 1000, accumulated_depreciation: 100, status: 'active' },
        { ...mockAssetFromDB, id: 'asset-2', purchase_cost: 2000, accumulated_depreciation: 200, status: 'active' },
      ];
      mockFromChain.data = assetsWithValues;

      const { result } = renderHook(() => useAssets(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.assets).toHaveLength(2);
        expect(result.current.summary).toEqual({
          totalAssets: 2,
          activeAssets: 2,
          totalCost: 3000,
          totalNetBookValue: 2700,
          totalAccumulatedDepreciation: 300,
        });
      });
    });

    it('should handle empty assets array', async () => {
      mockFromChain.data = [];

      const { result } = renderHook(() => useAssets(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.summary).toEqual({
          totalAssets: 0,
          activeAssets: 0,
          totalCost: 0,
          totalNetBookValue: 0,
          totalAccumulatedDepreciation: 0,
        });
      });
    });
  });

  describe('Create mutation', () => {
    it('should create asset successfully', async () => {
      const newAsset: AssetFormData = {
        name: 'New Asset',
        description: 'New Description',
        category: 'equipment',
        serial_number: 'SN123',
        purchase_date: '2024-01-01',
        purchase_cost: 500,
        salvage_value: 50,
        useful_life_months: 60,
        location_id: 'loc-1',
        asset_account_id: 'acc-1',
        accumulated_depreciation_account_id: 'acc-2',
        depreciation_expense_account_id: 'acc-3',
        notes: 'Test notes',
      };

      mockFromChain.data = { ...mockAssetFromDB, ...newAsset, id: 'new-asset-id' };

      const { result } = renderHook(() => useAssets(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.createAsset(newAsset);
      });

      await waitFor(() => {
        expect(mockSupabase.from).toHaveBeenCalledWith('assets');
        expect(mockFromChain.insert).toHaveBeenCalledWith({
          restaurant_id: 'rest-123',
          name: 'New Asset',
          description: 'New Description',
          category: 'equipment',
          serial_number: 'SN123',
          purchase_date: '2024-01-01',
          purchase_cost: 500,
          salvage_value: 50,
          useful_life_months: 60,
          location_id: 'loc-1',
          asset_account_id: 'acc-1',
          accumulated_depreciation_account_id: 'acc-2',
          depreciation_expense_account_id: 'acc-3',
          notes: 'Test notes',
          status: 'active',
          accumulated_depreciation: 0,
        });
        expect(mockToast.toast).toHaveBeenCalledWith({
          title: 'Asset created',
          description: 'The asset has been added successfully.',
        });
      });
    });

    it('should handle create error', async () => {
      const newAsset: AssetFormData = {
        name: 'New Asset',
        category: 'equipment',
        purchase_date: '2024-01-01',
        purchase_cost: 500,
        salvage_value: 0,
        useful_life_months: 60,
      };

      mockFromChain.error = new Error('Create failed');

      const { result } = renderHook(() => useAssets(), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        result.current.createAsset(newAsset);
      });

      await waitFor(() => {
        expect(mockToast.toast).toHaveBeenCalledWith({
          title: 'Error',
          description: 'Failed to create asset. Please try again.',
          variant: 'destructive',
        });
      });
    });
  });

  describe('Update mutation', () => {
    it('should update asset successfully', async () => {
      const updates: Partial<AssetFormData> = {
        name: 'Updated Asset',
        purchase_cost: 800,
      };

      mockFromChain.data = { ...mockAssetFromDB, ...updates };

      const { result } = renderHook(() => useAssets(), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        result.current.updateAsset({ id: 'asset-1', data: updates });
      });

      await waitFor(() => {
        expect(mockSupabase.from).toHaveBeenCalledWith('assets');
        expect(mockFromChain.update).toHaveBeenCalledWith({
          name: 'Updated Asset',
          description: undefined,
          category: undefined,
          serial_number: undefined,
          purchase_date: undefined,
          purchase_cost: 800,
          salvage_value: undefined,
          useful_life_months: undefined,
          location_id: null,
          asset_account_id: null,
          accumulated_depreciation_account_id: null,
          depreciation_expense_account_id: null,
          notes: undefined,
        });
        expect(mockToast.toast).toHaveBeenCalledWith({
          title: 'Asset updated',
          description: 'The asset has been updated successfully.',
        });
      });
    });

    it('should handle update error', async () => {
      const updates: Partial<AssetFormData> = { name: 'Updated Asset' };
      mockFromChain.error = new Error('Update failed');

      const { result } = renderHook(() => useAssets(), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        result.current.updateAsset({ id: 'asset-1', data: updates });
      });

      await waitFor(() => {
        expect(mockToast.toast).toHaveBeenCalledWith({
          title: 'Error',
          description: 'Failed to update asset. Please try again.',
          variant: 'destructive',
        });
      });
    });
  });

  describe('Dispose mutation', () => {
    it('should dispose asset successfully', async () => {
      const disposalData: AssetDisposalData = {
        disposal_date: '2024-12-31',
        disposal_proceeds: 100,
        disposal_notes: 'Sold asset',
      };

      mockFromChain.data = { ...mockAssetFromDB, status: 'disposed', ...disposalData };

      const { result } = renderHook(() => useAssets(), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        result.current.disposeAsset({ id: 'asset-1', data: disposalData });
      });

      await waitFor(() => {
        expect(mockSupabase.from).toHaveBeenCalledWith('assets');
        expect(mockFromChain.update).toHaveBeenCalledWith({
          status: 'disposed',
          disposal_date: '2024-12-31',
          disposal_proceeds: 100,
          disposal_notes: 'Sold asset',
        });
        expect(mockToast.toast).toHaveBeenCalledWith({
          title: 'Asset disposed',
          description: 'The asset has been marked as disposed.',
        });
      });
    });

    it('should handle dispose error', async () => {
      const disposalData: AssetDisposalData = {
        disposal_date: '2024-12-31',
      };

      mockFromChain.error = new Error('Dispose failed');

      const { result } = renderHook(() => useAssets(), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        result.current.disposeAsset({ id: 'asset-1', data: disposalData });
      });

      await waitFor(() => {
        expect(mockToast.toast).toHaveBeenCalledWith({
          title: 'Error',
          description: 'Failed to dispose asset. Please try again.',
          variant: 'destructive',
        });
      });
    });
  });

  describe('Delete mutation', () => {
    it('should delete asset successfully', async () => {
      mockFromChain.data = null;

      const { result } = renderHook(() => useAssets(), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        result.current.deleteAsset('asset-1');
      });

      await waitFor(() => {
        expect(mockSupabase.from).toHaveBeenCalledWith('assets');
        expect(mockFromChain.delete).toHaveBeenCalledWith();
        expect(mockFromChain.eq).toHaveBeenCalledWith('id', 'asset-1');
        expect(mockToast.toast).toHaveBeenCalledWith({
          title: 'Asset deleted',
          description: 'The asset has been deleted.',
        });
      });
    });

    it('should handle delete error', async () => {
      mockFromChain.error = new Error('Delete failed');

      const { result } = renderHook(() => useAssets(), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        result.current.deleteAsset('asset-1');
      });

      await waitFor(() => {
        expect(mockToast.toast).toHaveBeenCalledWith({
          title: 'Error',
          description: 'Failed to delete asset. Please try again.',
          variant: 'destructive',
        });
      });
    });
  });

  describe('Refetch functionality', () => {
    it('should refetch assets', async () => {
      mockFromChain.data = mockAssetsFromDB;

      const { result } = renderHook(() => useAssets(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.assets).toHaveLength(1);
      });

      // Reset mock call count
      vi.clearAllMocks();
      mockSupabase.from.mockReturnValue(mockFromChain);
      mockFromChain.data = mockAssetsFromDB;

      // Call refetch
      await act(async () => {
        await result.current.refetch();
      });

      // Should have been called again for refetch
      expect(mockSupabase.from).toHaveBeenCalledWith('assets');
    });
  });
});