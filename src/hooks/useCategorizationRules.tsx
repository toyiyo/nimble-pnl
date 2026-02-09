import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useRestaurantContext } from "@/contexts/RestaurantContext";

export interface CategorizationRule {
  id: string;
  restaurant_id: string;
  supplier_id: string;
  default_category_id: string;
  auto_apply: boolean;
  created_at: string;
  updated_at: string;
  supplier?: {
    name: string;
  };
  category?: {
    account_name: string;
    account_code: string;
  };
}

export function useCategorizationRules() {
  const { selectedRestaurant } = useRestaurantContext();
  const { toast } = useToast();

  return useQuery({
    queryKey: ['categorization-rules', selectedRestaurant?.restaurant_id],
    queryFn: async () => {
      if (!selectedRestaurant?.restaurant_id) throw new Error('No restaurant selected');

      const { data, error } = await supabase
        .from('supplier_categorization_rules')
        .select(`
          *,
          supplier:suppliers(name),
          category:chart_of_accounts(account_name, account_code)
        `)
        .eq('restaurant_id', selectedRestaurant.restaurant_id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return (data || []) as CategorizationRule[];
    },
    enabled: !!selectedRestaurant?.restaurant_id,
  });
}

export function useCreateRule() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({
      restaurantId,
      supplierId,
      categoryId,
      autoApply,
    }: {
      restaurantId: string;
      supplierId: string;
      categoryId: string;
      autoApply: boolean;
    }) => {
      const { data, error } = await supabase
        .from('supplier_categorization_rules')
        .insert({
          restaurant_id: restaurantId,
          supplier_id: supplierId,
          default_category_id: categoryId,
          auto_apply: autoApply,
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['categorization-rules'] });
      toast({
        title: "Rule created",
        description: "Categorization rule has been created successfully.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error creating rule",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}

export function useUpdateRule() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({
      ruleId,
      categoryId,
      autoApply,
    }: {
      ruleId: string;
      categoryId?: string;
      autoApply?: boolean;
    }) => {
      const updates: any = { updated_at: new Date().toISOString() };
      if (categoryId !== undefined) updates.default_category_id = categoryId;
      if (autoApply !== undefined) updates.auto_apply = autoApply;

      const { data, error } = await supabase
        .from('supplier_categorization_rules')
        .update(updates)
        .eq('id', ruleId)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['categorization-rules'] });
      toast({
        title: "Rule updated",
        description: "Categorization rule has been updated successfully.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error updating rule",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}

export function useDeleteRule() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (ruleId: string) => {
      const { error } = await supabase
        .from('supplier_categorization_rules')
        .delete()
        .eq('id', ruleId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['categorization-rules'] });
      toast({
        title: "Rule deleted",
        description: "Categorization rule has been deleted successfully.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error deleting rule",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}

export function useApplyRules() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (restaurantId: string) => {
      // Call database RPC directly instead of Edge Function to avoid execution limits
      // This hook uses the old supplier_categorization_rules table
      // For new features, use useApplyRulesV2 instead
      
      let bankResults = { applied_count: 0, total_count: 0 };

      // Only apply rules to bank transactions for the old system
      const { data: bankData, error: bankError } = await supabase
        .rpc('apply_rules_to_bank_transactions', {
          p_restaurant_id: restaurantId,
          p_batch_limit: 100
        });

      if (bankError) {
        throw new Error(`Failed to apply rules to bank transactions: ${bankError.message}`);
      }

      if (bankData && bankData.length > 0) {
        bankResults = bankData[0];
      }

      const message = `Applied rules to ${bankResults.applied_count} of ${bankResults.total_count} bank transactions`;

      return {
        success: true,
        message,
        count: bankResults.applied_count
      };
    },
    onSuccess: (data) => {
      toast({
        title: "Rules applied",
        description: data.message || 'Categorization rules applied successfully',
      });
      queryClient.invalidateQueries({ queryKey: ['bank-transactions'] });
      queryClient.invalidateQueries({ queryKey: ['chart-of-accounts'] });
    },
    onError: (error: Error) => {
      toast({
        title: "Error applying rules",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}
