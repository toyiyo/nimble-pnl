import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export interface DeletedBankTransaction {
  id: string;
  restaurant_id: string;
  connected_bank_id: string;
  source: string;
  external_transaction_id: string | null;
  fingerprint: string;
  transaction_date: string;
  amount: number;
  currency: string;
  description: string | null;
  merchant_name: string | null;
  deleted_at: string;
  deleted_by: string | null;
}

export function useDeletedBankTransactions(restaurantId: string | undefined) {
  return useQuery({
    queryKey: ['deleted-bank-transactions', restaurantId],
    queryFn: async () => {
      if (!restaurantId) return [];
      const { data, error } = await supabase
        .from('deleted_bank_transactions')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .order('deleted_at', { ascending: false });

      if (error) throw error;
      return (data || []) as DeletedBankTransaction[];
    },
    enabled: !!restaurantId,
    staleTime: 30000,
    refetchOnWindowFocus: true,
  });
}

export function useRestoreTransaction() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({
      tombstoneId,
      restaurantId,
    }: {
      tombstoneId: string;
      restaurantId: string;
    }) => {
      const { data, error } = await supabase.rpc('restore_deleted_transaction', {
        p_tombstone_id: tombstoneId,
        p_restaurant_id: restaurantId,
      });
      if (error) throw error;
      const result = data as { success: boolean; error?: string };
      if (!result.success) throw new Error(result.error || 'Failed to restore');
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['deleted-bank-transactions'] });
      queryClient.invalidateQueries({ queryKey: ['bank-transactions'] });
      toast({
        title: "Transaction restored",
        description: "The transaction has been moved back to active.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error restoring",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}

export function usePermanentlyDeleteTombstone() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({
      tombstoneId,
      restaurantId,
    }: {
      tombstoneId: string;
      restaurantId: string;
    }) => {
      const { data, error } = await supabase.rpc('permanently_delete_tombstone', {
        p_tombstone_id: tombstoneId,
        p_restaurant_id: restaurantId,
      });
      if (error) throw error;
      const result = data as { success: boolean; error?: string };
      if (!result.success) throw new Error(result.error || 'Failed to permanently delete');
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['deleted-bank-transactions'] });
      toast({
        title: "Permanently deleted",
        description: "The transaction record has been permanently removed.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}
