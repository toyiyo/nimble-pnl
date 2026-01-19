import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useRestaurantContext } from "@/contexts/RestaurantContext";
import { toast } from "sonner";
import { useMemo } from "react";
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
      toast.success('Expense added successfully');
    },
    onError: (error) => {
      toast.error(`Failed to add expense: ${error.message}`);
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
      toast.success('Expense updated successfully');
    },
    onError: (error) => {
      toast.error(`Failed to update expense: ${error.message}`);
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
      toast.success('Expense voided');
    },
    onError: (error) => {
      toast.error(`Failed to void expense: ${error.message}`);
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
      // Fetch pending outflow with invoice uploads
      const { data: pendingOutflow, error: fetchError } = await supabase
        .from('pending_outflows')
        .select(`
          *,
          expense_invoice_uploads(
            id,
            ai_category,
            ai_confidence,
            ai_reasoning
          )
        `)
        .eq('id', pendingOutflowId)
        .single();

      if (fetchError) throw fetchError;
      if (!pendingOutflow) throw new Error('Pending outflow not found');

      // Fetch current bank transaction to merge notes
      const { data: bankTransaction, error: btFetchError } = await supabase
        .from('bank_transactions')
        .select('notes, category_id, suggested_category_id')
        .eq('id', bankTransactionId)
        .single();

      if (btFetchError) throw btFetchError;
      if (!bankTransaction) throw new Error('Bank transaction not found');

      // Prepare updates for bank transaction
      const bankTransactionUpdates: any = {
        is_categorized: true,
        matched_at: new Date().toISOString(),
      };

      // Copy category_id if pending outflow has one and bank transaction doesn't
      if (pendingOutflow.category_id && !bankTransaction.category_id) {
        bankTransactionUpdates.category_id = pendingOutflow.category_id;
      }

      // Copy suggested_category_id from pending outflow's category as AI suggestion
      if (pendingOutflow.category_id && !bankTransaction.suggested_category_id) {
        bankTransactionUpdates.suggested_category_id = pendingOutflow.category_id;
        // Set AI confidence and reasoning if available from invoice upload
        const invoiceUpload = pendingOutflow.expense_invoice_uploads?.[0];
        if (invoiceUpload) {
          bankTransactionUpdates.ai_confidence = invoiceUpload.ai_confidence;
          bankTransactionUpdates.ai_reasoning = invoiceUpload.ai_reasoning;
        }
      }

      // Merge notes: append pending outflow notes to existing bank transaction notes
      const mergedNotes = [bankTransaction.notes, pendingOutflow.notes]
        .filter(Boolean)
        .join('\n\n');
      if (mergedNotes) {
        bankTransactionUpdates.notes = mergedNotes;
      }

      // Link expense invoice upload if present
      const invoiceUpload = pendingOutflow.expense_invoice_uploads?.[0];
      if (invoiceUpload) {
        bankTransactionUpdates.expense_invoice_upload_id = invoiceUpload.id;
      }

      // Update bank transaction
      const { error: btError } = await supabase
        .from('bank_transactions')
        .update(bankTransactionUpdates)
        .eq('id', bankTransactionId);

      if (btError) throw btError;

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

      return { pendingOutflowId, bankTransactionId };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pending-outflows'] });
      queryClient.invalidateQueries({ queryKey: ['bank-transactions'] });
      queryClient.invalidateQueries({ queryKey: ['pending-outflow-matches'] });
      toast.success('Expense matched and cleared');
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
      toast.success('Expense deleted');
    },
    onError: (error) => {
      toast.error(`Failed to delete expense: ${error.message}`);
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

// Hook to get pending outflows summary
export function usePendingOutflowsSummary() {
  const { data: pendingOutflows } = usePendingOutflows();

  return useMemo(() => {
    if (!pendingOutflows) {
      return {
        totalPending: 0,
        pendingCount: 0,
        byCategory: {} as Record<string, number>,
      };
    }

    const activePending = pendingOutflows.filter(
      (outflow) => ['pending', 'stale_30', 'stale_60', 'stale_90'].includes(outflow.status)
    );

    const totalPending = activePending.reduce((sum, outflow) => sum + outflow.amount, 0);
    const pendingCount = activePending.length;

    // Group by category
    const byCategory: Record<string, number> = {};
    activePending.forEach((outflow) => {
      const categoryName = outflow.chart_account?.account_name || 'Uncategorized';
      byCategory[categoryName] = (byCategory[categoryName] || 0) + outflow.amount;
    });

    return {
      totalPending,
      pendingCount,
      byCategory,
    };
  }, [pendingOutflows]);
}
