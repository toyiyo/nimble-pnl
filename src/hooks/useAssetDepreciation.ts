import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useRestaurantContext } from '@/contexts/RestaurantContext';
import type { AssetDepreciationSchedule, DepreciationCalculation } from '@/types/assets';

interface UseAssetDepreciationOptions {
  assetId: string | null;
}

export function useAssetDepreciation({ assetId }: UseAssetDepreciationOptions) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { selectedRestaurant } = useRestaurantContext();
  const restaurantId = selectedRestaurant?.restaurant_id;

  // Fetch depreciation history for an asset
  const {
    data: history = [],
    isLoading: isLoadingHistory,
    error,
  } = useQuery({
    queryKey: ['asset-depreciation-history', assetId, restaurantId],
    queryFn: async () => {
      if (!assetId || !restaurantId) return [];

      const { data, error } = await supabase
        .from('asset_depreciation_schedule')
        .select(
          `
          *,
          journal_entries (
            id,
            entry_number,
            entry_date
          )
        `
        )
        .eq('asset_id', assetId)
        .eq('restaurant_id', restaurantId)
        .order('period_end_date', { ascending: false });

      if (error) throw error;
      return data as (AssetDepreciationSchedule & {
        journal_entries?: { id: string; entry_number: string; entry_date: string };
      })[];
    },
    enabled: !!assetId && !!restaurantId,
    staleTime: 30000,
    refetchOnWindowFocus: true,
  });

  // Calculate depreciation preview (does not post)
  const calculateDepreciation = useMutation({
    mutationFn: async ({
      assetId,
      periodStart,
      periodEnd,
    }: {
      assetId: string;
      periodStart: string;
      periodEnd: string;
    }): Promise<DepreciationCalculation> => {
      const { data, error } = await supabase.rpc('calculate_asset_depreciation', {
        p_asset_id: assetId,
        p_period_start: periodStart,
        p_period_end: periodEnd,
      });

      if (error) throw error;

      // The function returns a single row as an array
      const result = Array.isArray(data) ? data[0] : data;

      return {
        monthly_depreciation: Number(result.monthly_depreciation),
        months_in_period: Number(result.months_in_period),
        depreciation_amount: Number(result.depreciation_amount),
        new_accumulated: Number(result.new_accumulated),
        net_book_value: Number(result.net_book_value),
        is_fully_depreciated: Boolean(result.is_fully_depreciated),
      };
    },
    onError: (error: Error) => {
      console.error('Error calculating depreciation:', error);
      toast({
        title: 'Calculation Error',
        description: error.message || 'Failed to calculate depreciation.',
        variant: 'destructive',
      });
    },
  });

  // Post depreciation (creates journal entry and updates asset)
  const postDepreciation = useMutation({
    mutationFn: async ({
      assetId,
      periodStart,
      periodEnd,
    }: {
      assetId: string;
      periodStart: string;
      periodEnd: string;
    }): Promise<string> => {
      const { data, error } = await supabase.rpc('post_asset_depreciation', {
        p_asset_id: assetId,
        p_period_start: periodStart,
        p_period_end: periodEnd,
      });

      if (error) throw error;

      // Returns the journal entry ID
      return data as string;
    },
    onSuccess: (journalEntryId) => {
      // Invalidate relevant queries
      queryClient.invalidateQueries({ queryKey: ['asset-depreciation-history', assetId] });
      queryClient.invalidateQueries({ queryKey: ['assets', restaurantId] });
      queryClient.invalidateQueries({ queryKey: ['journal-entries'] });

      toast({
        title: 'Depreciation Posted',
        description: 'The depreciation has been recorded and journal entry created.',
      });
    },
    onError: (error: Error) => {
      console.error('Error posting depreciation:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to post depreciation.',
        variant: 'destructive',
      });
    },
  });

  // Get the last depreciation date for determining next period
  const lastDepreciationDate = history.length > 0 ? history[0].period_end_date : null;

  // Calculate suggested next period based on last depreciation
  const getSuggestedNextPeriod = (): { start: string; end: string } | null => {
    if (!lastDepreciationDate) {
      // If no previous depreciation, suggest current month
      const now = new Date();
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      return {
        start: start.toISOString().split('T')[0],
        end: end.toISOString().split('T')[0],
      };
    }

    // Suggest the month after the last depreciation
    const lastDate = new Date(lastDepreciationDate);
    const nextMonth = new Date(lastDate.getFullYear(), lastDate.getMonth() + 1, 1);
    const nextMonthEnd = new Date(nextMonth.getFullYear(), nextMonth.getMonth() + 1, 0);

    return {
      start: nextMonth.toISOString().split('T')[0],
      end: nextMonthEnd.toISOString().split('T')[0],
    };
  };

  // Total depreciation posted
  const totalDepreciated = history.reduce((sum, h) => sum + h.depreciation_amount, 0);

  return {
    history,
    isLoadingHistory,
    error,
    calculateDepreciation: calculateDepreciation.mutateAsync,
    isCalculating: calculateDepreciation.isPending,
    calculationResult: calculateDepreciation.data,
    postDepreciation: postDepreciation.mutateAsync,
    isPosting: postDepreciation.isPending,
    lastDepreciationDate,
    getSuggestedNextPeriod,
    totalDepreciated,
  };
}

// Hook to get all assets pending depreciation
export function useAssetsPendingDepreciation() {
  const { selectedRestaurant } = useRestaurantContext();
  const restaurantId = selectedRestaurant?.restaurant_id;

  const { data: assetsPendingDepreciation = [], isLoading } = useQuery({
    queryKey: ['assets-pending-depreciation', restaurantId],
    queryFn: async () => {
      if (!restaurantId) return [];

      // Get active assets that haven't been deprecated this month
      const now = new Date();
      const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1)
        .toISOString()
        .split('T')[0];

      const { data, error } = await supabase
        .from('assets')
        .select(
          `
          id,
          name,
          purchase_cost,
          accumulated_depreciation,
          last_depreciation_date,
          useful_life_months,
          salvage_value
        `
        )
        .eq('restaurant_id', restaurantId)
        .eq('status', 'active')
        .or(`last_depreciation_date.is.null,last_depreciation_date.lt.${currentMonthStart}`);

      if (error) throw error;

      return data || [];
    },
    enabled: !!restaurantId,
    staleTime: 30000,
  });

  return {
    assetsPendingDepreciation,
    isLoading,
    count: assetsPendingDepreciation.length,
  };
}
