import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { TaxRate, TaxRateWithCategories, CreateTaxRateInput, UpdateTaxRateInput, TaxCalculationResult } from '@/types/taxRates';
import { useToast } from '@/hooks/use-toast';

export const useTaxRates = (restaurantId: string | null) => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Fetch all tax rates for a restaurant
  const { data: taxRates = [], isLoading, error, refetch } = useQuery({
    queryKey: ['taxRates', restaurantId],
    queryFn: async () => {
      if (!restaurantId) return [];
      
      const { data, error } = await supabase
        .from('tax_rates')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .order('name');

      if (error) throw error;
      return data as TaxRate[];
    },
    enabled: !!restaurantId,
    staleTime: 30000, // 30 seconds
    refetchOnWindowFocus: true,
  });

  // Fetch a single tax rate with categories
  const getTaxRateWithCategories = async (taxRateId: string): Promise<TaxRateWithCategories | null> => {
    const { data, error } = await supabase.rpc('get_tax_rate_with_categories', {
      p_tax_rate_id: taxRateId,
    });

    if (error) throw error;
    return data && data.length > 0 ? data[0] : null;
  };

  // Create tax rate mutation
  const createTaxRate = useMutation({
    mutationFn: async (input: CreateTaxRateInput) => {
      // Insert tax rate
      const { data: taxRateData, error: taxRateError } = await supabase
        .from('tax_rates')
        .insert({
          restaurant_id: input.restaurant_id,
          name: input.name,
          rate: input.rate,
          description: input.description,
        })
        .select()
        .single();

      if (taxRateError) throw taxRateError;

      // Insert category associations if provided
      if (input.category_ids && input.category_ids.length > 0) {
        const categoryInserts = input.category_ids.map(categoryId => ({
          tax_rate_id: taxRateData.id,
          category_id: categoryId,
        }));

        const { error: categoriesError } = await supabase
          .from('tax_rate_categories')
          .insert(categoryInserts);

        if (categoriesError) throw categoriesError;
      }

      return taxRateData;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['taxRates', restaurantId] });
      toast({
        title: 'Tax Rate Created',
        description: 'The tax rate has been successfully created.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error Creating Tax Rate',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  // Update tax rate mutation
  const updateTaxRate = useMutation({
    mutationFn: async ({ id, input }: { id: string; input: UpdateTaxRateInput }) => {
      // Update tax rate
      const updateData: any = {};
      if (input.name !== undefined) updateData.name = input.name;
      if (input.rate !== undefined) updateData.rate = input.rate;
      if (input.description !== undefined) updateData.description = input.description;
      if (input.is_active !== undefined) updateData.is_active = input.is_active;

      const { data: taxRateData, error: taxRateError } = await supabase
        .from('tax_rates')
        .update(updateData)
        .eq('id', id)
        .select()
        .single();

      if (taxRateError) throw taxRateError;

      // Update category associations if provided
      if (input.category_ids !== undefined) {
        // Delete existing associations
        const { error: deleteError } = await supabase
          .from('tax_rate_categories')
          .delete()
          .eq('tax_rate_id', id);

        if (deleteError) throw deleteError;

        // Insert new associations
        if (input.category_ids.length > 0) {
          const categoryInserts = input.category_ids.map(categoryId => ({
            tax_rate_id: id,
            category_id: categoryId,
          }));

          const { error: categoriesError } = await supabase
            .from('tax_rate_categories')
            .insert(categoryInserts);

          if (categoriesError) throw categoriesError;
        }
      }

      return taxRateData;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['taxRates', restaurantId] });
      toast({
        title: 'Tax Rate Updated',
        description: 'The tax rate has been successfully updated.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error Updating Tax Rate',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  // Delete tax rate mutation
  const deleteTaxRate = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('tax_rates')
        .delete()
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['taxRates', restaurantId] });
      toast({
        title: 'Tax Rate Deleted',
        description: 'The tax rate has been successfully deleted.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error Deleting Tax Rate',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  // Calculate taxes for a period
  const calculateTaxes = async (startDate: string, endDate: string): Promise<TaxCalculationResult[]> => {
    if (!restaurantId) return [];

    const { data, error } = await supabase.rpc('calculate_taxes_for_period', {
      p_restaurant_id: restaurantId,
      p_start_date: startDate,
      p_end_date: endDate,
    });

    if (error) throw error;
    return data || [];
  };

  return {
    taxRates,
    isLoading,
    error,
    refetch,
    getTaxRateWithCategories,
    createTaxRate: createTaxRate.mutate,
    updateTaxRate: updateTaxRate.mutate,
    deleteTaxRate: deleteTaxRate.mutate,
    isCreating: createTaxRate.isPending,
    isUpdating: updateTaxRate.isPending,
    isDeleting: deleteTaxRate.isPending,
    calculateTaxes,
  };
};
