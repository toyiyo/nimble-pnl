import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useRestaurantContext } from "@/contexts/RestaurantContext";
import { toast } from "sonner";
import type { PendingOutflow, PendingOutflowMatch, CreatePendingOutflowInput, UpdatePendingOutflowInput } from "@/types/pending-outflows";

export function usePendingOutflows() {
  const { selectedRestaurant } = useRestaurantContext();

  return useQuery({
    queryKey: ['pending-outflows', selectedRestaurant?.restaurant_id],
    queryFn: async () => {
      if (!selectedRestaurant?.restaurant_id) throw new Error('No restaurant selected');

      const { data, error } = await supabase
        .from('pending_outflows')
        .select(`
          *,
          chart_account:chart_of_accounts!category_id(
            id,
            account_name
          )
        `)
        .eq('restaurant_id', selectedRestaurant.restaurant_id)
        .order('issue_date', { ascending: false });

      if (error) throw error;
      return data as PendingOutflow[];
    },
    enabled: !!selectedRestaurant?.restaurant_id,
    staleTime: 30000, // 30 seconds
    refetchOnWindowFocus: true,
    refetchOnMount: true,
  });
}

export function usePendingOutflowMatches(pendingOutflowId?: string) {
  const { selectedRestaurant } = useRestaurantContext();

  return useQuery({
    queryKey: ['pending-outflow-matches', selectedRestaurant?.restaurant_id, pendingOutflowId],
    queryFn: async () => {
      if (!selectedRestaurant?.restaurant_id) throw new Error('No restaurant selected');

      const { data, error } = await supabase.rpc('suggest_pending_outflow_matches', {
        p_restaurant_id: selectedRestaurant.restaurant_id,
        p_pending_outflow_id: pendingOutflowId || null,
      });

      if (error) throw error;
      return (data || []) as PendingOutflowMatch[];
    },
    enabled: !!selectedRestaurant?.restaurant_id,
    staleTime: 30000,
  });
}

export function usePendingOutflowMutations() {
  const { selectedRestaurant } = useRestaurantContext();
  const queryClient = useQueryClient();

  const createPendingOutflow = useMutation({
    mutationFn: async (input: CreatePendingOutflowInput) => {
      if (!selectedRestaurant?.restaurant_id) throw new Error('No restaurant selected');

      const { data, error } = await supabase
        .from('pending_outflows')
        .insert({
          restaurant_id: selectedRestaurant.restaurant_id,
          ...input,
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pending-outflows'] });
      toast.success('Pending payment added successfully');
    },
    onError: (error) => {
      toast.error(`Failed to add pending payment: ${error.message}`);
    },
  });

  const updatePendingOutflow = useMutation({
    mutationFn: async ({ id, input }: { id: string; input: UpdatePendingOutflowInput }) => {
      const { data, error } = await supabase
        .from('pending_outflows')
        .update(input)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pending-outflows'] });
      toast.success('Pending payment updated successfully');
    },
    onError: (error) => {
      toast.error(`Failed to update pending payment: ${error.message}`);
    },
  });

  const voidPendingOutflow = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      const { data, error } = await supabase
        .from('pending_outflows')
        .update({
          status: 'voided',
          voided_at: new Date().toISOString(),
          voided_reason: reason,
        })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pending-outflows'] });
      toast.success('Pending payment voided');
    },
    onError: (error) => {
      toast.error(`Failed to void pending payment: ${error.message}`);
    },
  });

  const confirmMatch = useMutation({
    mutationFn: async ({ 
      pendingOutflowId, 
      bankTransactionId 
    }: { 
      pendingOutflowId: string; 
      bankTransactionId: string;
    }) => {
      // Update pending outflow
      const { error: poError } = await supabase
        .from('pending_outflows')
        .update({
          status: 'cleared',
          linked_bank_transaction_id: bankTransactionId,
          cleared_at: new Date().toISOString(),
        })
        .eq('id', pendingOutflowId);

      if (poError) throw poError;

      // Mark bank transaction as categorized
      const { error: btError } = await supabase
        .from('bank_transactions')
        .update({
          is_categorized: true,
          matched_at: new Date().toISOString(),
        })
        .eq('id', bankTransactionId);

      if (btError) throw btError;

      return { pendingOutflowId, bankTransactionId };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pending-outflows'] });
      queryClient.invalidateQueries({ queryKey: ['bank-transactions'] });
      queryClient.invalidateQueries({ queryKey: ['pending-outflow-matches'] });
      toast.success('Payment matched and cleared');
    },
    onError: (error) => {
      toast.error(`Failed to confirm match: ${error.message}`);
    },
  });

  const deletePendingOutflow = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('pending_outflows')
        .delete()
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pending-outflows'] });
      toast.success('Pending payment deleted');
    },
    onError: (error) => {
      toast.error(`Failed to delete pending payment: ${error.message}`);
    },
  });

  return {
    createPendingOutflow,
    updatePendingOutflow,
    voidPendingOutflow,
    confirmMatch,
    deletePendingOutflow,
  };
}
