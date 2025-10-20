import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useRestaurantContext } from "@/contexts/RestaurantContext";

export function useReconciliationBoundary() {
  const { selectedRestaurant } = useRestaurantContext();

  return useQuery({
    queryKey: ['reconciliation-boundary', selectedRestaurant?.restaurant_id],
    queryFn: async () => {
      if (!selectedRestaurant?.restaurant_id) throw new Error('No restaurant selected');

      const { data, error } = await supabase
        .from('reconciliation_boundaries')
        .select('*')
        .eq('restaurant_id', selectedRestaurant.restaurant_id)
        .maybeSingle();

      if (error) throw error;
      return data;
    },
    enabled: !!selectedRestaurant?.restaurant_id,
  });
}

export function useSetReconciliationBoundary() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({
      date,
      openingBalance,
    }: {
      date: string;
      openingBalance: number;
    }) => {
      const { data, error } = await supabase
        .rpc('set_reconciliation_boundary' as any, {
          p_date: date,
          p_opening_balance: openingBalance,
        });

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reconciliation-boundary'] });
      toast({
        title: "Reconciliation boundary set",
        description: "Opening balance has been recorded.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error setting boundary",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}

export function useReconcileTransaction() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({
      transactionId,
    }: {
      transactionId: string;
    }) => {
      const { data, error } = await supabase
        .from('bank_transactions')
        .update({
          is_reconciled: true,
          reconciled_at: new Date().toISOString(),
          reconciled_by: (await supabase.auth.getUser()).data.user?.id,
        })
        .eq('id', transactionId)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bank-transactions'] });
      toast({
        title: "Transaction reconciled",
        description: "Transaction marked as reconciled.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error reconciling transaction",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}

export function useUnreconcileTransaction() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({
      transactionId,
    }: {
      transactionId: string;
    }) => {
      const { data, error } = await supabase
        .from('bank_transactions')
        .update({
          is_reconciled: false,
          reconciled_at: null,
          reconciled_by: null,
        })
        .eq('id', transactionId)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bank-transactions'] });
      toast({
        title: "Transaction unreconciled",
        description: "Reconciliation status removed.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error unreconciling transaction",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}
