import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { 
  OperatingCost, 
  OperatingCostInput, 
  DEFAULT_OPERATING_COSTS,
  CostType,
  EntryType 
} from '@/types/operatingCosts';

// Map database row to domain model
function mapRowToCost(row: any): OperatingCost {
  return {
    id: row.id,
    restaurantId: row.restaurant_id,
    costType: row.cost_type as CostType,
    category: row.category,
    name: row.name,
    entryType: row.entry_type as EntryType,
    monthlyValue: row.monthly_value || 0,
    percentageValue: Number(row.percentage_value) || 0,
    isAutoCalculated: row.is_auto_calculated || false,
    manualOverride: row.manual_override || false,
    averagingMonths: row.averaging_months || 3,
    displayOrder: row.display_order || 0,
    isActive: row.is_active !== false,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function useOperatingCosts(restaurantId: string | null) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Fetch all operating costs for the restaurant
  const {
    data: costs = [],
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['operatingCosts', restaurantId],
    queryFn: async () => {
      if (!restaurantId) return [];
      
      const { data, error } = await supabase
        .from('restaurant_operating_costs')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .eq('is_active', true)
        .order('cost_type')
        .order('display_order');
      
      if (error) throw error;
      return (data || []).map(mapRowToCost);
    },
    enabled: !!restaurantId,
    staleTime: 60000, // 1 minute
    refetchOnWindowFocus: true,
  });

  // Create a new operating cost
  const createMutation = useMutation({
    mutationFn: async (input: OperatingCostInput) => {
      if (!restaurantId) throw new Error('No restaurant selected');
      
      const { data, error } = await supabase
        .from('restaurant_operating_costs')
        .insert({
          restaurant_id: restaurantId,
          cost_type: input.costType,
          category: input.category,
          name: input.name,
          entry_type: input.entryType,
          monthly_value: input.monthlyValue || 0,
          percentage_value: input.percentageValue || 0,
          is_auto_calculated: input.isAutoCalculated || false,
          manual_override: input.manualOverride || false,
          averaging_months: input.averagingMonths || 3,
          display_order: input.displayOrder || 0,
        })
        .select()
        .single();
      
      if (error) throw error;
      return mapRowToCost(data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['operatingCosts', restaurantId] });
      queryClient.invalidateQueries({ queryKey: ['breakEvenAnalysis', restaurantId] });
      toast({ title: 'Cost item added' });
    },
    onError: (err: Error) => {
      toast({ title: 'Failed to add cost item', description: err.message, variant: 'destructive' });
    },
  });

  // Update an existing operating cost
  const updateMutation = useMutation({
    mutationFn: async ({ id, ...updates }: Partial<OperatingCostInput> & { id: string }) => {
      const updateData: Record<string, any> = {};
      
      if (updates.name !== undefined) updateData.name = updates.name;
      if (updates.entryType !== undefined) updateData.entry_type = updates.entryType;
      if (updates.monthlyValue !== undefined) updateData.monthly_value = updates.monthlyValue;
      if (updates.percentageValue !== undefined) updateData.percentage_value = updates.percentageValue;
      if (updates.manualOverride !== undefined) updateData.manual_override = updates.manualOverride;
      if (updates.displayOrder !== undefined) updateData.display_order = updates.displayOrder;
      
      const { data, error } = await supabase
        .from('restaurant_operating_costs')
        .update(updateData)
        .eq('id', id)
        .select()
        .single();
      
      if (error) throw error;
      return mapRowToCost(data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['operatingCosts', restaurantId] });
      queryClient.invalidateQueries({ queryKey: ['breakEvenAnalysis', restaurantId] });
      toast({ title: 'Cost item updated' });
    },
    onError: (err: Error) => {
      toast({ title: 'Failed to update cost item', description: err.message, variant: 'destructive' });
    },
  });

  // Soft delete an operating cost
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('restaurant_operating_costs')
        .update({ is_active: false })
        .eq('id', id);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['operatingCosts', restaurantId] });
      queryClient.invalidateQueries({ queryKey: ['breakEvenAnalysis', restaurantId] });
      toast({ title: 'Cost item removed' });
    },
    onError: (err: Error) => {
      toast({ title: 'Failed to remove cost item', description: err.message, variant: 'destructive' });
    },
  });

  // Seed default costs if none exist
  const seedDefaultsMutation = useMutation({
    mutationFn: async () => {
      if (!restaurantId) throw new Error('No restaurant selected');
      
      // Check if costs already exist
      const { count } = await supabase
        .from('restaurant_operating_costs')
        .select('*', { count: 'exact', head: true })
        .eq('restaurant_id', restaurantId);
      
      if (count && count > 0) {
        return; // Already has costs, don't seed
      }
      
      // Insert all default costs
      const inserts = DEFAULT_OPERATING_COSTS.map(cost => ({
        restaurant_id: restaurantId,
        cost_type: cost.costType,
        category: cost.category,
        name: cost.name,
        entry_type: cost.entryType,
        monthly_value: cost.monthlyValue || 0,
        percentage_value: cost.percentageValue || 0,
        is_auto_calculated: cost.isAutoCalculated || false,
        display_order: cost.displayOrder || 0,
      }));
      
      const { error } = await supabase
        .from('restaurant_operating_costs')
        .insert(inserts);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['operatingCosts', restaurantId] });
    },
  });

  // Group costs by type for easier consumption
  const fixedCosts = costs.filter(c => c.costType === 'fixed');
  const semiVariableCosts = costs.filter(c => c.costType === 'semi_variable');
  const variableCosts = costs.filter(c => c.costType === 'variable');
  const customCosts = costs.filter(c => c.costType === 'custom');

  return {
    costs,
    fixedCosts,
    semiVariableCosts,
    variableCosts,
    customCosts,
    isLoading,
    error,
    refetch,
    createCost: createMutation.mutate,
    updateCost: updateMutation.mutate,
    deleteCost: deleteMutation.mutate,
    seedDefaults: seedDefaultsMutation.mutate,
    isSeeding: seedDefaultsMutation.isPending,
  };
}
