import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useRestaurantContext } from "@/contexts/RestaurantContext";

export interface CategorizationRule {
  id: string;
  restaurant_id: string;
  rule_name: string;
  match_type: 'payee_exact' | 'payee_contains' | 'description_contains' | 'amount_range' | 'amount_exact';
  match_value: string;
  match_value_lower?: string;
  amount_min?: number;
  amount_max?: number;
  category_id: string;
  priority: number;
  is_active: boolean;
  auto_apply: boolean;
  created_at: string;
  updated_at: string;
  last_applied_at?: string;
  apply_count: number;
}

export function useCategorizationRules() {
  const { selectedRestaurant } = useRestaurantContext();
  const { toast } = useToast();

  return useQuery({
    queryKey: ['categorization-rules', selectedRestaurant?.restaurant_id],
    queryFn: async () => {
      if (!selectedRestaurant?.restaurant_id) throw new Error('No restaurant selected');

      const { data, error } = await supabase
        .from('transaction_categorization_rules')
        .select('*')
        .eq('restaurant_id', selectedRestaurant.restaurant_id)
        .order('priority', { ascending: false })
        .order('apply_count', { ascending: false });

      if (error) throw error;
      return data as unknown as CategorizationRule[];
    },
    enabled: !!selectedRestaurant?.restaurant_id,
  });
}

export function useCreateRule() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (rule: Partial<CategorizationRule>) => {
      const { match_value_lower, ...ruleData } = rule;
      const { data, error } = await supabase
        .from('transaction_categorization_rules')
        .insert([ruleData as any])
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
    mutationFn: async ({ id, ...updates }: Partial<CategorizationRule> & { id: string }) => {
      const { match_value_lower, ...updateData } = updates;
      const { data, error } = await supabase
        .from('transaction_categorization_rules')
        .update(updateData)
        .eq('id', id)
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
        .from('transaction_categorization_rules')
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
      // This would call an edge function to apply rules to all uncategorized transactions
      const { data, error } = await supabase.functions.invoke('apply-categorization-rules', {
        body: { restaurant_id: restaurantId }
      });

      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['bank-transactions'] });
      toast({
        title: "Rules applied",
        description: `${data?.applied_count || 0} transactions were automatically categorized.`,
      });
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
