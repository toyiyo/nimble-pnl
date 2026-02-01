import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useRestaurantContext } from '@/contexts/RestaurantContext';
import type {
  Asset,
  AssetFormData,
  AssetDisposalData,
  AssetStatus,
  AssetWithDetails,
  calculateNetBookValue,
  calculateMonthlyDepreciation,
} from '@/types/assets';

interface UseAssetsOptions {
  status?: AssetStatus | 'all';
}

export function useAssets(options: UseAssetsOptions = {}) {
  const { status = 'all' } = options;
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { selectedRestaurant } = useRestaurantContext();
  const restaurantId = selectedRestaurant?.restaurant_id;

  // Fetch assets with optional status filter
  const {
    data: assets = [],
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['assets', restaurantId, status],
    queryFn: async () => {
      if (!restaurantId) return [];

      let query = supabase
        .from('assets')
        .select(
          `
          *,
          inventory_locations!location_id (
            id,
            name
          )
        `
        )
        .eq('restaurant_id', restaurantId)
        .order('created_at', { ascending: false });

      if (status !== 'all') {
        query = query.eq('status', status);
      }

      const { data, error } = await query;

      if (error) throw error;

      // Transform to AssetWithDetails with computed fields
      return (data || []).map((asset: Asset & { inventory_locations?: { id: string; name: string } }) => {
        const netBookValue = asset.purchase_cost - asset.accumulated_depreciation;
        const depreciableAmount = asset.purchase_cost - asset.salvage_value;
        const monthlyDepreciation = depreciableAmount / asset.useful_life_months;

        // Calculate remaining useful life
        const monthsDepreciated = monthlyDepreciation > 0
          ? Math.floor(asset.accumulated_depreciation / monthlyDepreciation)
          : 0;
        const remainingUsefulLifeMonths = Math.max(0, asset.useful_life_months - monthsDepreciated);

        // Calculate depreciation percentage
        const depreciationPercentage = depreciableAmount > 0
          ? (asset.accumulated_depreciation / depreciableAmount) * 100
          : 0;

        return {
          ...asset,
          net_book_value: netBookValue,
          monthly_depreciation: monthlyDepreciation,
          remaining_useful_life_months: remainingUsefulLifeMonths,
          depreciation_percentage: Math.min(100, depreciationPercentage),
          location_name: asset.inventory_locations?.name,
        } as AssetWithDetails;
      });
    },
    enabled: !!restaurantId,
    staleTime: 30000,
    refetchOnWindowFocus: true,
  });

  // Create asset mutation
  const createAsset = useMutation({
    mutationFn: async (data: AssetFormData) => {
      if (!restaurantId) throw new Error('No restaurant selected');

      const { data: asset, error } = await supabase
        .from('assets')
        .insert({
          restaurant_id: restaurantId,
          name: data.name,
          description: data.description || null,
          category: data.category,
          serial_number: data.serial_number || null,
          purchase_date: data.purchase_date,
          quantity: data.quantity || 1,
          unit_cost: data.unit_cost,
          // purchase_cost is synced by DB trigger from unit_cost * quantity
          purchase_cost: data.unit_cost * (data.quantity || 1),
          salvage_value: data.salvage_value,
          useful_life_months: data.useful_life_months,
          location_id: data.location_id || null,
          asset_account_id: data.asset_account_id || null,
          accumulated_depreciation_account_id: data.accumulated_depreciation_account_id || null,
          depreciation_expense_account_id: data.depreciation_expense_account_id || null,
          notes: data.notes || null,
          status: 'active',
          accumulated_depreciation: 0,
        })
        .select()
        .single();

      if (error) throw error;
      return asset;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['assets', restaurantId] });
      toast({
        title: 'Asset created',
        description: 'The asset has been added successfully.',
      });
    },
    onError: (error) => {
      console.error('Error creating asset:', error);
      toast({
        title: 'Error',
        description: 'Failed to create asset. Please try again.',
        variant: 'destructive',
      });
    },
  });

  // Update asset mutation
  const updateAsset = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<AssetFormData> }) => {
      // Build update object, only including fields that are provided
      const updateData: Record<string, unknown> = {};
      if (data.name !== undefined) updateData.name = data.name;
      if (data.description !== undefined) updateData.description = data.description;
      if (data.category !== undefined) updateData.category = data.category;
      if (data.serial_number !== undefined) updateData.serial_number = data.serial_number;
      if (data.purchase_date !== undefined) updateData.purchase_date = data.purchase_date;
      if (data.quantity !== undefined) updateData.quantity = Math.max(1, data.quantity);
      if (data.unit_cost !== undefined) updateData.unit_cost = data.unit_cost;
      // Note: purchase_cost is synced by DB trigger based on unit_cost * quantity
      // If either is updated, the trigger will recalculate purchase_cost
      if (data.salvage_value !== undefined) updateData.salvage_value = data.salvage_value;
      if (data.useful_life_months !== undefined) updateData.useful_life_months = data.useful_life_months;
      if (data.location_id !== undefined) updateData.location_id = data.location_id || null;
      if (data.asset_account_id !== undefined) updateData.asset_account_id = data.asset_account_id || null;
      if (data.accumulated_depreciation_account_id !== undefined) updateData.accumulated_depreciation_account_id = data.accumulated_depreciation_account_id || null;
      if (data.depreciation_expense_account_id !== undefined) updateData.depreciation_expense_account_id = data.depreciation_expense_account_id || null;
      if (data.notes !== undefined) updateData.notes = data.notes;

      const { data: asset, error } = await supabase
        .from('assets')
        .update(updateData)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return asset;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['assets', restaurantId] });
      toast({
        title: 'Asset updated',
        description: 'The asset has been updated successfully.',
      });
    },
    onError: (error) => {
      console.error('Error updating asset:', error);
      toast({
        title: 'Error',
        description: 'Failed to update asset. Please try again.',
        variant: 'destructive',
      });
    },
  });

  // Dispose asset mutation
  const disposeAsset = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: AssetDisposalData }) => {
      const { data: asset, error } = await supabase
        .from('assets')
        .update({
          status: 'disposed' as AssetStatus,
          disposal_date: data.disposal_date,
          disposal_proceeds: data.disposal_proceeds || null,
          disposal_notes: data.disposal_notes || null,
        })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return asset;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['assets', restaurantId] });
      toast({
        title: 'Asset disposed',
        description: 'The asset has been marked as disposed.',
      });
    },
    onError: (error) => {
      console.error('Error disposing asset:', error);
      toast({
        title: 'Error',
        description: 'Failed to dispose asset. Please try again.',
        variant: 'destructive',
      });
    },
  });

  // Delete asset mutation
  const deleteAsset = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('assets').delete().eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['assets', restaurantId] });
      toast({
        title: 'Asset deleted',
        description: 'The asset has been deleted.',
      });
    },
    onError: (error) => {
      console.error('Error deleting asset:', error);
      toast({
        title: 'Error',
        description: 'Failed to delete asset. Please try again.',
        variant: 'destructive',
      });
    },
  });

  // Get single asset by ID
  const getAsset = async (id: string): Promise<Asset | null> => {
    const { data, error } = await supabase
      .from('assets')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      console.error('Error fetching asset:', error);
      return null;
    }

    return data;
  };

  // Calculate summary statistics (counting units, not just records)
  const summary = {
    totalAssets: assets.reduce((sum, a) => sum + (a.quantity || 1), 0), // Count units
    totalRecords: assets.length, // Count records for reference
    activeAssets: assets.filter((a) => a.status === 'active').reduce((sum, a) => sum + (a.quantity || 1), 0),
    totalCost: assets.reduce((sum, a) => sum + a.purchase_cost, 0),
    totalNetBookValue: assets.reduce((sum, a) => sum + a.net_book_value, 0),
    totalAccumulatedDepreciation: assets.reduce((sum, a) => sum + a.accumulated_depreciation, 0),
  };

  return {
    assets,
    isLoading,
    error,
    refetch,
    createAsset: createAsset.mutate,
    createAssetAsync: createAsset.mutateAsync,
    updateAsset: updateAsset.mutate,
    updateAssetAsync: updateAsset.mutateAsync,
    disposeAsset: disposeAsset.mutate,
    deleteAsset: deleteAsset.mutate,
    getAsset,
    isCreating: createAsset.isPending,
    isUpdating: updateAsset.isPending,
    isDisposing: disposeAsset.isPending,
    isDeleting: deleteAsset.isPending,
    summary,
  };
}

// Hook to get capitalize threshold
export function useCapitalizeThreshold() {
  const { selectedRestaurant } = useRestaurantContext();
  const restaurantId = selectedRestaurant?.restaurant_id;

  const { data: threshold, isLoading } = useQuery({
    queryKey: ['capitalize-threshold', restaurantId],
    queryFn: async () => {
      if (!restaurantId) return 250000; // Default $2500 in cents

      const { data, error } = await supabase
        .from('restaurants')
        .select('capitalize_threshold_cents')
        .eq('id', restaurantId)
        .single();

      if (error) throw error;
      return data?.capitalize_threshold_cents ?? 250000;
    },
    enabled: !!restaurantId,
    staleTime: 60000,
  });

  return {
    thresholdCents: threshold ?? 250000,
    thresholdDollars: (threshold ?? 250000) / 100,
    isLoading,
  };
}
