import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useRestaurantContext } from "@/contexts/RestaurantContext";

export type TransactionStatus = 'for_review' | 'categorized' | 'excluded' | 'reconciled';

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
  status: TransactionStatus;
  is_categorized: boolean;
  is_reconciled: boolean;
  is_split: boolean;
  is_transfer: boolean;
  transfer_pair_id: string | null;
  excluded_reason: string | null;
  match_confidence: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export function useBankTransactions(status?: TransactionStatus) {
  const { selectedRestaurant } = useRestaurantContext();
  const { toast } = useToast();

  return useQuery({
    queryKey: ['bank-transactions', selectedRestaurant?.restaurant_id, status],
    queryFn: async () => {
      if (!selectedRestaurant?.restaurant_id) throw new Error('No restaurant selected');

      // Fetch all transactions by removing the default limit
      let query = supabase
        .from('bank_transactions')
        .select('*', { count: 'exact' })
        .eq('restaurant_id', selectedRestaurant.restaurant_id)
        .order('transaction_date', { ascending: false })
        .limit(10000); // Set a high limit to fetch all transactions

      if (status) {
        query = query.eq('status', status as any);
      }

      const { data, error } = await query;

      if (error) throw error;
      return data as BankTransaction[];
    },
    enabled: !!selectedRestaurant?.restaurant_id,
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
    }: {
      transactionId: string;
      categoryId: string;
      description?: string;
    }) => {
      const { data, error } = await supabase.rpc('categorize_bank_transaction', {
        p_transaction_id: transactionId,
        p_category_id: categoryId,
        p_description: description,
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
      splits: Array<{
        category_id: string;
        amount: number;
        description?: string;
      }>;
    }) => {
      const { data, error } = await supabase.rpc('split_bank_transaction' as any, {
        p_transaction_id: transactionId,
        p_splits: splits as any,
      });

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bank-transactions'] });
      queryClient.invalidateQueries({ queryKey: ['bank-transactions-split'] });
      queryClient.invalidateQueries({ queryKey: ['chart-of-accounts'] });
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
