import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useRestaurantContext } from "@/contexts/RestaurantContext";

export type MatchType = 'exact' | 'contains' | 'starts_with' | 'ends_with' | 'regex';
export type TransactionType = 'debit' | 'credit' | 'any';
export type AppliesTo = 'bank_transactions' | 'pos_sales' | 'both';

export interface CategorizationRule {
  id: string;
  restaurant_id: string;
  rule_name: string;
  applies_to: AppliesTo;
  
  // Pattern matching fields
  description_pattern?: string;
  description_match_type?: MatchType;
  amount_min?: number;
  amount_max?: number;
  supplier_id?: string;
  transaction_type?: TransactionType;
  pos_category?: string;
  item_name_pattern?: string;
  item_name_match_type?: MatchType;
  
  // Target category
  category_id: string;
  
  // Settings
  priority: number;
  is_active: boolean;
  auto_apply: boolean;
  
  // Statistics
  apply_count: number;
  last_applied_at?: string;
  
  created_at: string;
  updated_at: string;
  
  // Joined data
  supplier?: {
    name: string;
  };
  category?: {
    account_name: string;
    account_code: string;
  };
}

export interface CreateRuleParams {
  restaurantId: string;
  ruleName: string;
  appliesTo: AppliesTo;
  descriptionPattern?: string;
  descriptionMatchType?: MatchType;
  amountMin?: number;
  amountMax?: number;
  supplierId?: string;
  transactionType?: TransactionType;
  posCategory?: string;
  itemNamePattern?: string;
  itemNameMatchType?: MatchType;
  categoryId: string;
  priority?: number;
  isActive?: boolean;
  autoApply?: boolean;
}

export interface UpdateRuleParams {
  ruleId: string;
  ruleName?: string;
  descriptionPattern?: string;
  descriptionMatchType?: MatchType;
  amountMin?: number;
  amountMax?: number;
  supplierId?: string;
  transactionType?: TransactionType;
  posCategory?: string;
  itemNamePattern?: string;
  itemNameMatchType?: MatchType;
  categoryId?: string;
  priority?: number;
  isActive?: boolean;
  autoApply?: boolean;
}

export function useCategorizationRulesV2(appliesTo?: AppliesTo) {
  const { selectedRestaurant } = useRestaurantContext();

  return useQuery({
    queryKey: ['categorization-rules-v2', selectedRestaurant?.restaurant_id, appliesTo],
    queryFn: async () => {
      if (!selectedRestaurant?.restaurant_id) throw new Error('No restaurant selected');

      let query = (supabase as any)
        .from('categorization_rules')
        .select(`
          *,
          supplier:suppliers(name),
          category:chart_of_accounts(account_name, account_code)
        `)
        .eq('restaurant_id', selectedRestaurant.restaurant_id);

      if (appliesTo) {
        query = query.or(`applies_to.eq.${appliesTo},applies_to.eq.both`);
      }

      const { data, error } = await query.order('priority', { ascending: false });

      if (error) throw error;
      return (data || []) as CategorizationRule[];
    },
    enabled: !!selectedRestaurant?.restaurant_id,
  });
}

export function useCreateRuleV2() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (params: CreateRuleParams) => {
      const { data, error } = await (supabase as any)
        .from('categorization_rules')
        .insert({
          restaurant_id: params.restaurantId,
          rule_name: params.ruleName,
          applies_to: params.appliesTo,
          description_pattern: params.descriptionPattern,
          description_match_type: params.descriptionMatchType,
          amount_min: params.amountMin,
          amount_max: params.amountMax,
          supplier_id: params.supplierId,
          transaction_type: params.transactionType,
          pos_category: params.posCategory,
          item_name_pattern: params.itemNamePattern,
          item_name_match_type: params.itemNameMatchType,
          category_id: params.categoryId,
          priority: params.priority ?? 0,
          is_active: params.isActive ?? true,
          auto_apply: params.autoApply ?? false,
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['categorization-rules-v2'] });
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

export function useUpdateRuleV2() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (params: UpdateRuleParams) => {
      const updates: any = { updated_at: new Date().toISOString() };
      
      if (params.ruleName !== undefined) updates.rule_name = params.ruleName;
      if (params.descriptionPattern !== undefined) updates.description_pattern = params.descriptionPattern;
      if (params.descriptionMatchType !== undefined) updates.description_match_type = params.descriptionMatchType;
      if (params.amountMin !== undefined) updates.amount_min = params.amountMin;
      if (params.amountMax !== undefined) updates.amount_max = params.amountMax;
      if (params.supplierId !== undefined) updates.supplier_id = params.supplierId;
      if (params.transactionType !== undefined) updates.transaction_type = params.transactionType;
      if (params.posCategory !== undefined) updates.pos_category = params.posCategory;
      if (params.itemNamePattern !== undefined) updates.item_name_pattern = params.itemNamePattern;
      if (params.itemNameMatchType !== undefined) updates.item_name_match_type = params.itemNameMatchType;
      if (params.categoryId !== undefined) updates.category_id = params.categoryId;
      if (params.priority !== undefined) updates.priority = params.priority;
      if (params.isActive !== undefined) updates.is_active = params.isActive;
      if (params.autoApply !== undefined) updates.auto_apply = params.autoApply;

      const { data, error } = await (supabase as any)
        .from('categorization_rules')
        .update(updates)
        .eq('id', params.ruleId)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['categorization-rules-v2'] });
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

export function useDeleteRuleV2() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (ruleId: string) => {
      const { error } = await (supabase as any)
        .from('categorization_rules')
        .delete()
        .eq('id', ruleId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['categorization-rules-v2'] });
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

export function useApplyRulesV2() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ 
      restaurantId, 
      applyTo = 'both',
      batchLimit = 100
    }: { 
      restaurantId: string; 
      applyTo?: 'bank_transactions' | 'pos_sales' | 'both';
      batchLimit?: number;
    }) => {
      const { data, error } = await supabase.functions.invoke(
        'apply-categorization-rules',
        {
          body: { restaurantId, applyTo, batchLimit }
        }
      );

      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      const result = data as { message: string; count: number; details?: any };
      
      let description = result?.message || 'Categorization rules applied successfully';
      
      // Add note if processing was limited
      if (result?.details) {
        const bank = result.details.bank;
        const pos = result.details.pos;
        const totalProcessed = (bank?.total_count || 0) + (pos?.total_count || 0);
        
        if (totalProcessed >= 1000) {
          description += '\n\nNote: Processed in batches. Click "Apply Rules" again to continue processing remaining records.';
        }
      }
      
      toast({
        title: "Rules applied",
        description,
      });
      queryClient.invalidateQueries({ queryKey: ['bank-transactions'] });
      queryClient.invalidateQueries({ queryKey: ['unified-sales'] });
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
