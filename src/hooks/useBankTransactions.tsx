import { useCallback, useEffect, useMemo } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { useToast } from "@/hooks/use-toast";
import { useRestaurantContext } from "@/contexts/RestaurantContext";
import { SplitLine, invalidateSplitQueries } from "./useSplitTransactionHelpers";
import type { BankTransactionSort, TransactionFilters } from "@/types/transactions";

export type TransactionStatus = 'for_review' | 'categorized' | 'excluded' | 'reconciled';

export const BANK_TRANSACTIONS_PAGE_SIZE = 200;

export interface UseBankTransactionsOptions {
  searchTerm?: string;
  filters?: TransactionFilters;
  sortBy?: BankTransactionSort;
  sortDirection?: 'asc' | 'desc';
  pageSize?: number;
  autoLoadAll?: boolean;
}

export interface BankTransaction {
  id: string;
  restaurant_id: string;
  connected_bank_id: string;
  stripe_transaction_id: string;
  transaction_date: string;
  posted_date: string | null;
  amount: number;
  description: string;
  merchant_name: string | null;
  normalized_payee: string | null;
  category_id: string | null;
  suggested_category_id: string | null;
  suggested_payee: string | null;
  supplier_id: string | null;
  status: TransactionStatus;
  is_categorized: boolean;
  is_reconciled: boolean;
  is_split: boolean;
  is_transfer: boolean;
  transfer_pair_id: string | null;
  excluded_reason: string | null;
  match_confidence: number | null;
  ai_confidence: 'high' | 'medium' | 'low' | null;
  ai_reasoning: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  connected_bank?: {
    id: string;
    institution_name: string;
    bank_account_balances: Array<{
      id: string;
      account_mask: string | null;
      account_name: string;
      stripe_financial_account_id: string | null;
    }>;
  };
  chart_account?: {
    account_name: string;
  } | null;
  supplier?: {
    id: string;
    name: string;
  } | null;
}

interface BankTransactionsPage {
  transactions: BankTransaction[];
  totalCount: number;
  hasMore: boolean;
  nextPage?: number;
}

const SORT_COLUMN_MAP: Record<BankTransactionSort, string> = {
  date: 'transaction_date',
  payee: 'normalized_payee',
  amount: 'amount',
  category: 'category_id',
};

const buildBaseQuery = (restaurantId: string) =>
  supabase
    .from('bank_transactions')
    .select(`
      *,
      connected_bank:connected_banks(
        id,
        institution_name,
        bank_account_balances(id, account_mask, account_name, stripe_financial_account_id, is_active)
      ),
      chart_account:chart_of_accounts!category_id(
        id,
        account_name
      ),
      supplier:suppliers(
        id,
        name
      )
    `, { count: 'exact' })
    .eq('restaurant_id', restaurantId);

type SupabaseQuery = ReturnType<typeof buildBaseQuery>;
type SplitBankTransactionArgs = Database['public']['Functions']['split_bank_transaction']['Args'];

const applyStatusFilter = (query: SupabaseQuery, status?: TransactionStatus) => {
  if (status === 'for_review') return query.eq('is_categorized', false).is('excluded_reason', null);
  if (status === 'categorized') return query.eq('is_categorized', true).is('excluded_reason', null);
  if (status === 'excluded') return query.not('excluded_reason', 'is', null);
  if (status === 'reconciled') return query.eq('is_reconciled', true);
  return query;
};

const applySearchFilter = (query: SupabaseQuery, normalizedSearch: string) => {
  if (!normalizedSearch) return query;
  return query.or(
    `description.ilike.%${normalizedSearch}%,merchant_name.ilike.%${normalizedSearch}%,normalized_payee.ilike.%${normalizedSearch}%`
  );
};

const applyDateFilters = (query: SupabaseQuery, filters: TransactionFilters) => {
  if (filters.dateFrom) query = query.gte('transaction_date', filters.dateFrom);
  if (filters.dateTo) query = query.lte('transaction_date', filters.dateTo);
  return query;
};

const applyAmountFilters = (query: SupabaseQuery, filters: TransactionFilters) => {
  if (filters.minAmount !== undefined) {
    query = query.or(`amount.lte.-${filters.minAmount},amount.gte.${filters.minAmount}`);
  }
  if (filters.maxAmount !== undefined) {
    query = query.gte('amount', -filters.maxAmount).lte('amount', filters.maxAmount);
  }
  return query;
};

const applyMetadataFilters = async (
  query: SupabaseQuery,
  filters: TransactionFilters
): Promise<SupabaseQuery> => {
  let resultQuery: SupabaseQuery = query;
  
  if (filters.status) resultQuery = resultQuery.eq('status', filters.status);
  if (filters.transactionType === 'debit') resultQuery = resultQuery.lt('amount', 0);
  if (filters.transactionType === 'credit') resultQuery = resultQuery.gt('amount', 0);
  if (filters.categoryId) resultQuery = resultQuery.eq('category_id', filters.categoryId);

  // Resolve bankAccountId to stripe_financial_account_id for filtering
  if (filters.bankAccountId) {
    try {
      // Execute a separate query to fetch the account balance
      const { data: accountBalance, error } = await supabase
        .from('bank_account_balances')
        .select('stripe_financial_account_id')
        .eq('id', filters.bankAccountId)
        .single();

      if (error) {
        console.error('[useBankTransactions] Failed to resolve bank account filter', error.message);
      } else if (accountBalance?.stripe_financial_account_id) {
        resultQuery = resultQuery.eq('raw_data->>account', accountBalance.stripe_financial_account_id);
      }
    } catch (err) {
      console.error('[useBankTransactions] Failed to resolve bank account filter', err);
    }
  }

  if (filters.showUncategorized) resultQuery = resultQuery.eq('is_categorized', false);
  return resultQuery;
};

const applySorting = (
  query: SupabaseQuery,
  sortBy: BankTransactionSort,
  sortDirection: 'asc' | 'desc'
) => {
  const sortColumn = SORT_COLUMN_MAP[sortBy] ?? SORT_COLUMN_MAP.date;
  return query
    .order(sortColumn, { ascending: sortDirection === 'asc', nullsFirst: false })
    .order('id', { ascending: false });
};

export function useBankTransactions(
  status?: TransactionStatus,
  options: UseBankTransactionsOptions = {}
) {
  const { selectedRestaurant } = useRestaurantContext();
  const { toast } = useToast();

  const pageSize = options.pageSize ?? BANK_TRANSACTIONS_PAGE_SIZE;
  const normalizedSearch = options.searchTerm?.trim() ?? '';
  const filtersKey = useMemo(() => JSON.stringify(options.filters || {}), [options.filters]);
  const parsedFilters = useMemo<TransactionFilters>(() => JSON.parse(filtersKey), [filtersKey]);
  const sortBy = options.sortBy ?? 'date';
  const sortDirection = options.sortDirection ?? 'desc';

  const fetchTransactionsPage = useCallback(async ({ pageParam = 0 }): Promise<BankTransactionsPage> => {
    if (!selectedRestaurant?.restaurant_id) {
      return { transactions: [], totalCount: 0, hasMore: false, nextPage: undefined };
    }

    const from = Number(pageParam) || 0;
    const to = from + pageSize - 1;

    let query = buildBaseQuery(selectedRestaurant.restaurant_id);
    query = applyStatusFilter(query, status);
    query = applySearchFilter(query, normalizedSearch);
    query = applyDateFilters(query, parsedFilters);
    query = applyAmountFilters(query, parsedFilters);
    query = await applyMetadataFilters(query, parsedFilters);
    query = applySorting(query, sortBy, sortDirection);

    const { data, count, error } = await query.range(from, to);

    if (error) throw error;

    const received = data?.length ?? 0;
    const totalCount = count ?? received;
    const nextPage = to + 1;
    const hasMore = typeof count === 'number' ? count > nextPage : received === pageSize;

    return {
      transactions: (data || []) as BankTransaction[],
      totalCount,
      hasMore,
      nextPage: hasMore ? nextPage : undefined,
    };
  }, [selectedRestaurant?.restaurant_id, status, normalizedSearch, parsedFilters, sortBy, sortDirection, pageSize]);

  const {
    data,
    isLoading,
    isFetchingNextPage,
    fetchNextPage,
    hasNextPage,
    error,
    refetch,
    isRefetching,
  } = useInfiniteQuery({
    queryKey: [
      'bank-transactions',
      selectedRestaurant?.restaurant_id,
      status || 'all',
      normalizedSearch,
      filtersKey,
      sortBy,
      sortDirection,
      pageSize,
    ],
    queryFn: ({ pageParam = 0 }) => fetchTransactionsPage({ pageParam }),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => (lastPage?.hasMore ? lastPage.nextPage : undefined),
    enabled: !!selectedRestaurant?.restaurant_id,
    staleTime: 60000,
    gcTime: 300000,
  });

  const transactions = useMemo(
    () => data?.pages?.flatMap((page) => page.transactions) ?? [],
    [data]
  );

  const totalCount = data?.pages?.[0]?.totalCount ?? 0;

  // Automatically hydrate full dataset when requested (metrics views)
  useEffect(() => {
    if (options.autoLoadAll && hasNextPage && !isFetchingNextPage && !isLoading) {
      fetchNextPage();
    }
  }, [options.autoLoadAll, hasNextPage, isFetchingNextPage, isLoading, fetchNextPage]);

  // Surface errors to users
  useEffect(() => {
    if (error) {
      toast({
        title: "Error fetching transactions",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    }
  }, [error, toast]);

  return {
    data: transactions,
    transactions,
    totalCount,
    isLoading,
    isRefetching,
    loadingMore: isFetchingNextPage,
    hasMore: !!hasNextPage,
    loadMore: fetchNextPage,
    refetch,
  };
}

export function useBankTransactionsWithRelations(restaurantId: string | null | undefined) {
  return useQuery({
    queryKey: ['bank-transactions', restaurantId],
    queryFn: async () => {
      if (!restaurantId) return [];

      const { data, error } = await supabase
        .from('bank_transactions')
        .select(`
          *,
          connected_bank:connected_banks!inner(
            id,
            institution_name,
            bank_account_balances(id, account_mask, account_name)
          ),
          chart_account:chart_of_accounts!category_id(
            account_name
          ),
          supplier:suppliers(
            id,
            name
          )
        `)
        .eq('restaurant_id', restaurantId)
        .order('transaction_date', { ascending: false })
        .order('id', { ascending: false }) // Stable secondary sort
        .limit(1000);

      if (error) throw error;
      return (data || []) as BankTransaction[];
    },
    enabled: !!restaurantId,
    staleTime: 60000,
  });
}

export function useCategorizeTransaction() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({
      transactionId,
      categoryId,
      description,
      normalizedPayee,
      supplierId,
    }: {
      transactionId: string;
      categoryId: string;
      description?: string;
      normalizedPayee?: string;
      supplierId?: string;
    }) => {
      const { data, error } = await supabase.rpc('categorize_bank_transaction', {
        p_transaction_id: transactionId,
        p_category_id: categoryId,
        p_description: description ?? null,
        p_normalized_payee: normalizedPayee ?? null,
        p_supplier_id: supplierId ?? null,
      });

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bank-transactions'] });
      queryClient.invalidateQueries({ queryKey: ['chart-of-accounts'] });
      toast({
        title: "Transaction categorized",
        description: "The transaction has been successfully categorized.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error categorizing transaction",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}

export function useExcludeTransaction() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({
      transactionId,
      reason,
    }: {
      transactionId: string;
      reason?: string;
    }) => {
      const { data, error } = await supabase.rpc('exclude_bank_transaction', {
        p_transaction_id: transactionId,
        p_reason: reason,
      });

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bank-transactions'] });
      toast({
        title: "Transaction excluded",
        description: "The transaction has been excluded from accounting.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error excluding transaction",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}

export function useMarkAsTransfer() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({
      transactionId1,
      transactionId2,
    }: {
      transactionId1: string;
      transactionId2: string;
    }) => {
      const { data, error } = await supabase.rpc('mark_as_transfer', {
        p_transaction_id_1: transactionId1,
        p_transaction_id_2: transactionId2,
      });

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bank-transactions'] });
      queryClient.invalidateQueries({ queryKey: ['chart-of-accounts'] });
      toast({
        title: "Transfer recorded",
        description: "The transactions have been linked as a transfer.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error recording transfer",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}

export function useCategorizedTransactionsSplit() {
  const { selectedRestaurant } = useRestaurantContext();

  return useQuery({
    queryKey: ['bank-transactions-split', selectedRestaurant?.restaurant_id],
    queryFn: async () => {
      if (!selectedRestaurant?.restaurant_id) throw new Error('No restaurant selected');

      const { data: splits, error } = await supabase
        .from('bank_transaction_splits')
        .select('*, transaction:bank_transactions(*)')
        .eq('bank_transactions.restaurant_id', selectedRestaurant.restaurant_id);

      if (error) throw error;
      return splits;
    },
    enabled: !!selectedRestaurant?.restaurant_id,
  });
}

export function useSplitTransaction() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({
      transactionId,
      splits,
    }: {
      transactionId: string;
      splits: SplitLine[];
    }) => {
      const splitPayload = {
        p_transaction_id: transactionId,
        p_splits: splits,
      } satisfies SplitBankTransactionArgs;

      const { data, error } = await supabase.rpc('split_bank_transaction', splitPayload);

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      invalidateSplitQueries(queryClient);
      toast({
        title: "Transaction split",
        description: "The transaction has been successfully split across categories.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error splitting transaction",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}

export function useRevertBankTransactionSplit() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ transactionId }: { transactionId: string }) => {
      // Delete child splits
      const { error: deleteSplitsError } = await supabase
        .from('bank_transaction_splits')
        .delete()
        .eq('transaction_id', transactionId);

      if (deleteSplitsError) throw deleteSplitsError;

      // Update parent to mark as not split
      const { error: updateError } = await supabase
        .from('bank_transactions')
        .update({ 
          is_split: false,
          is_categorized: false,
          category_id: null,
          updated_at: new Date().toISOString()
        })
        .eq('id', transactionId);

      if (updateError) throw updateError;

      return { success: true };
    },
    onSuccess: () => {
      invalidateSplitQueries(queryClient);
      toast({
        title: "Split reverted",
        description: "The transaction split has been reverted successfully.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error reverting split",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}

export function useUpdateBankTransactionSplit() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({
      transactionId,
      splits,
    }: {
      transactionId: string;
      splits: SplitLine[];
    }) => {
      // Re-split by calling the split function (it handles existing splits)
      const splitPayload = {
        p_transaction_id: transactionId,
        p_splits: splits,
      } satisfies SplitBankTransactionArgs;

      const { data, error } = await supabase.rpc('split_bank_transaction', splitPayload);

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      invalidateSplitQueries(queryClient);
      toast({
        title: "Split updated",
        description: "The transaction split has been updated successfully.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error updating split",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}

export interface BankTransactionSplit {
  id: string;
  transaction_id: string;
  category_id: string;
  amount: number;
  description: string | null;
  chart_account?: {
    id: string;
    account_name: string;
    account_code: string;
  };
}

export function useBankTransactionSplits(transactionId: string | null) {
  return useQuery({
    queryKey: ['bank-transaction-splits', transactionId],
    queryFn: async () => {
      if (!transactionId) return [];

      const { data, error } = await supabase
        .from('bank_transaction_splits')
        .select(`
          id,
          transaction_id,
          category_id,
          amount,
          description,
          chart_account:chart_of_accounts!category_id(
            id,
            account_name,
            account_code
          )
        `)
        .eq('transaction_id', transactionId)
        .order('amount', { ascending: false });

      if (error) throw error;
      return data as BankTransactionSplit[];
    },
    enabled: !!transactionId,
  });
}
