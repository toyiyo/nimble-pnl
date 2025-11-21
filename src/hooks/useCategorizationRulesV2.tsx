import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useRestaurantContext } from "@/contexts/RestaurantContext";

export type MatchType = 'exact' | 'contains' | 'starts_with' | 'ends_with' | 'regex';
export type TransactionType = 'debit' | 'credit' | 'any';
export type AppliesTo = 'bank_transactions' | 'pos_sales' | 'both';

export interface SplitCategory {
  category_id: string;
  amount?: number;
  percentage?: number;
  description?: string;
}

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
  
  // Target category (for simple rules, required for non-split rules)
  category_id?: string;
  
  // Split support
  is_split_rule: boolean;
  split_categories?: SplitCategory[];
  
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
    is_active: boolean;
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
  categoryId?: string; // Optional for split rules
  isSplitRule?: boolean;
  splitCategories?: SplitCategory[];
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
  isSplitRule?: boolean;
  splitCategories?: SplitCategory[];
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
          category:chart_of_accounts(account_name, account_code, is_active)
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
    staleTime: 30_000, // 30 seconds - categorization rules are configuration data
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
          is_split_rule: params.isSplitRule ?? false,
          split_categories: params.isSplitRule && params.splitCategories ? JSON.stringify(params.splitCategories) : null,
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
      if (params.isSplitRule !== undefined) updates.is_split_rule = params.isSplitRule;
      if (params.splitCategories !== undefined) updates.split_categories = params.isSplitRule && params.splitCategories ? JSON.stringify(params.splitCategories) : null;
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
    onMutate: async (params) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['categorization-rules-v2'] });

      // Snapshot previous value
      const previousRules = queryClient.getQueriesData({ queryKey: ['categorization-rules-v2'] });

      // Optimistically update all matching queries
      queryClient.setQueriesData<CategorizationRule[]>(
        { queryKey: ['categorization-rules-v2'] },
        (old) => {
          if (!old) return old;
          return old.map((rule) => {
            if (rule.id !== params.ruleId) return rule;
            return {
              ...rule,
              ...(params.ruleName !== undefined && { rule_name: params.ruleName }),
              ...(params.descriptionPattern !== undefined && { description_pattern: params.descriptionPattern }),
              ...(params.descriptionMatchType !== undefined && { description_match_type: params.descriptionMatchType }),
              ...(params.amountMin !== undefined && { amount_min: params.amountMin }),
              ...(params.amountMax !== undefined && { amount_max: params.amountMax }),
              ...(params.supplierId !== undefined && { supplier_id: params.supplierId }),
              ...(params.transactionType !== undefined && { transaction_type: params.transactionType }),
              ...(params.posCategory !== undefined && { pos_category: params.posCategory }),
              ...(params.itemNamePattern !== undefined && { item_name_pattern: params.itemNamePattern }),
              ...(params.itemNameMatchType !== undefined && { item_name_match_type: params.itemNameMatchType }),
              ...(params.categoryId !== undefined && { category_id: params.categoryId }),
              ...(params.isSplitRule !== undefined && { is_split_rule: params.isSplitRule }),
              ...(params.splitCategories !== undefined && { split_categories: params.splitCategories }),
              ...(params.priority !== undefined && { priority: params.priority }),
              ...(params.isActive !== undefined && { is_active: params.isActive }),
              ...(params.autoApply !== undefined && { auto_apply: params.autoApply }),
              updated_at: new Date().toISOString(),
            };
          });
        }
      );

      return { previousRules };
    },
    onError: (error: Error, _, context) => {
      // Rollback on error
      if (context?.previousRules) {
        context.previousRules.forEach(([queryKey, data]) => {
          queryClient.setQueryData(queryKey, data);
        });
      }
      toast({
        title: "Error updating rule",
        description: error.message,
        variant: "destructive",
      });
    },
    onSuccess: () => {
      toast({
        title: "Rule updated",
        description: "Categorization rule has been updated successfully.",
      });
    },
    onSettled: () => {
      // Always refetch to ensure correctness
      queryClient.invalidateQueries({ queryKey: ['categorization-rules-v2'] });
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
    onSuccess: (data, variables) => {
      const result = data as { message: string; count: number; details?: any };
      const batchLimit = variables.batchLimit || 100; // Fallback to 100 if not provided
      
      let description = result?.message || 'Categorization rules applied successfully';
      
      // Add note if processing was limited
      if (result?.details) {
        const bank = result.details.bank;
        const pos = result.details.pos;
        const totalProcessed = (bank?.total_count || 0) + (pos?.total_count || 0);
        
        if (totalProcessed >= batchLimit) {
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
