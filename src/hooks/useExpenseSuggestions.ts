import { useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { fetchExpenseData } from '@/lib/expenseDataFetcher';
import { useOperatingCosts } from '@/hooks/useOperatingCosts';
import { detectRecurringExpenses } from '@/lib/expenseSuggestions';
import type { DismissalRecord } from '@/lib/expenseSuggestions';
import { useToast } from '@/hooks/use-toast';
import type { ExpenseSuggestion, SuggestionAction } from '@/types/operatingCosts';
import { subDays } from 'date-fns';

/** Number of days of bank transaction history to analyse for recurring expenses. */
const LOOKBACK_DAYS = 90;

export function useExpenseSuggestions(restaurantId: string | null) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // 1. Reuse existing operating costs (already cached by useOperatingCosts)
  const { costs, isLoading: costsLoading } = useOperatingCosts(restaurantId);

  // 2. Fetch dismissal records
  const {
    data: dismissals = [],
    isLoading: dismissalsLoading,
  } = useQuery({
    queryKey: ['expenseSuggestionDismissals', restaurantId],
    queryFn: async (): Promise<DismissalRecord[]> => {
      const { data, error } = await supabase
        .from('expense_suggestion_dismissals')
        .select('suggestion_key, action, snoozed_until')
        .eq('restaurant_id', restaurantId!);

      if (error) throw error;
      return (data ?? []) as DismissalRecord[];
    },
    enabled: !!restaurantId,
    staleTime: 60000,
  });

  // 3. Fetch bank transactions (last 90 days)
  const now = new Date();
  const dateFrom = subDays(now, LOOKBACK_DAYS);

  const {
    data: expenseData,
    isLoading: transactionsLoading,
  } = useQuery({
    queryKey: ['expenseSuggestionTransactions', restaurantId],
    queryFn: async () => {
      return fetchExpenseData({
        restaurantId: restaurantId!,
        startDate: dateFrom,
        endDate: now,
      });
    },
    enabled: !!restaurantId,
    staleTime: 300000, // 5 minutes
  });

  // 4. Compute suggestions via pure detection logic (memoized)
  const suggestions: ExpenseSuggestion[] = useMemo(() => {
    if (!expenseData?.transactions) return [];
    return detectRecurringExpenses(
      expenseData.transactions,
      costs,
      dismissals,
    );
  }, [expenseData?.transactions, costs, dismissals]);

  // 5. Mutation: upsert a dismissal record
  const upsertDismissal = useMutation({
    mutationFn: async ({
      suggestionKey,
      action,
      snoozedUntil,
    }: {
      suggestionKey: string;
      action: SuggestionAction;
      snoozedUntil?: string | null;
    }) => {
      if (!restaurantId) throw new Error('No restaurant selected');

      const { error } = await supabase
        .from('expense_suggestion_dismissals')
        .upsert(
          {
            restaurant_id: restaurantId,
            suggestion_key: suggestionKey,
            action,
            snoozed_until: snoozedUntil ?? null,
          },
          { onConflict: 'restaurant_id,suggestion_key' },
        );

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['expenseSuggestionDismissals', restaurantId],
      });
    },
    onError: (err: Error) => {
      toast({
        title: 'Failed to update suggestion',
        description: err.message,
        variant: 'destructive',
      });
    },
  });

  // 6. Convenience action helpers
  function dismissSuggestion(suggestionKey: string) {
    upsertDismissal.mutate({
      suggestionKey,
      action: 'dismissed',
    });
  }

  function snoozeSuggestion(suggestionKey: string) {
    const snoozedUntil = new Date(
      Date.now() + 30 * 24 * 60 * 60 * 1000,
    ).toISOString();

    upsertDismissal.mutate({
      suggestionKey,
      action: 'snoozed',
      snoozedUntil,
    });
  }

  function acceptSuggestion(suggestionKey: string) {
    upsertDismissal.mutate({
      suggestionKey,
      action: 'accepted',
    });
  }

  const isLoading = costsLoading || dismissalsLoading || transactionsLoading;

  return {
    suggestions,
    isLoading,
    dismissSuggestion,
    snoozeSuggestion,
    acceptSuggestion,
  };
}
