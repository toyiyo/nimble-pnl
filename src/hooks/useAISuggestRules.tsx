import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

export interface SuggestedRule {
  rule_name: string;
  pattern_type: string;
  description_pattern?: string;
  description_match_type?: 'contains' | 'exact' | 'starts_with' | 'ends_with';
  item_name_pattern?: string;
  item_name_match_type?: 'contains' | 'exact' | 'starts_with' | 'ends_with';
  pos_category?: string;
  amount_min?: number;
  amount_max?: number;
  transaction_type?: 'debit' | 'credit' | 'any';
  account_code: string;
  category_id?: string;
  category_name?: string;
  confidence: 'high' | 'medium' | 'low';
  historical_matches: number;
  reasoning: string;
  priority: number;
  applies_to: 'bank_transactions' | 'pos_sales';
}

export interface RuleSuggestionsResponse {
  rules: SuggestedRule[];
  total_analyzed: number;
  source: 'bank' | 'pos';
  message?: string;
}

export function useAISuggestRules() {
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({
      restaurantId,
      source = 'bank',
      limit = 100
    }: {
      restaurantId: string;
      source?: 'bank' | 'pos';
      limit?: number;
    }) => {
      const { data, error } = await supabase.functions.invoke(
        'ai-suggest-categorization-rules',
        {
          body: { restaurantId, source, limit }
        }
      );

      if (error) throw error;
      return data as RuleSuggestionsResponse;
    },
    onError: (error: Error) => {
      toast({
        title: "Error getting AI suggestions",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}
