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
            raw_file_url,
            file_name,
            raw_ocr_data,
            field_confidence
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

      // Merge notes. A retry that already ran the merge must not duplicate
      // the outflow notes, so skip the merge when the bank notes already
      // contain them.
      const bankNotes = bankTransaction.notes as string | null;
      const outflowNotes = pendingOutflow.notes as string | null;
      const mergedNotes = (bankNotes && outflowNotes && bankNotes.includes(outflowNotes))
        ? bankNotes
        : ([bankNotes, outflowNotes].filter(Boolean).join('\n\n') || null);

      // A bank transaction can carry a category_id with no journal entry,
      // from a write path outside categorize_bank_transaction. Any code
      // path that treats the transaction's existing category as ledger-
      // backed must check this first, or it recreates a journal-less
      // categorized state.
      const hasJournalEntry = async () => {
        const { data: existingEntry, error: journalCheckError } = await supabase
          .from('journal_entries')
          .select('id')
          .eq('reference_type', 'bank_transaction')
          .eq('reference_id', bankTransactionId)
          .maybeSingle();

        if (journalCheckError) throw journalCheckError;
        return !!existingEntry;
      };

      // Prepare the metadata-only update for bank_transactions.
      const bankTransactionUpdates: any = {
        matched_at: new Date().toISOString(),
      };

      let categorized = false;

      if (pendingOutflow.category_id) {
        // The RPC returns journal_entry_id: null when the transaction
        // already has this exact category
        // (supabase/migrations/20260709120000_categorize_preserve_metadata_on_noop.sql:90-113).
        // That skip assumes a journal entry already exists from the first
        // categorize. Block the match when one does not.
        if (bankTransaction.category_id === pendingOutflow.category_id && !(await hasJournalEntry())) {
          throw new Error(
            'This transaction is already categorized but has no journal entry. Recategorize it on the Banking page, then match again.'
          );
        }

        // The RPC applies the category, writes the merged notes, and posts
        // the matching journal entry in one database transaction. It also
        // blocks a reconciled transaction and a closed fiscal period — the
        // guard text in onError matches
        // supabase/migrations/20260709120000_categorize_preserve_metadata_on_noop.sql.
        const { error: categorizeError } = await supabase.rpc('categorize_bank_transaction', {
          p_transaction_id: bankTransactionId,
          p_category_id: pendingOutflow.category_id,
          p_description: mergedNotes,
          p_normalized_payee: null,
          p_supplier_id: null,
        });

        if (categorizeError) throw categorizeError;

        // Copy the category as the AI suggestion. Do not set category_id
        // or is_categorized here — the RPC above already wrote them.
        bankTransactionUpdates.suggested_category_id = pendingOutflow.category_id;
        categorized = true;
      } else if (mergedNotes) {
        // No category to apply through the RPC. Write the merged notes directly.
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
      const pendingOutflowUpdates: Record<string, unknown> = {
        status: 'cleared',
        linked_bank_transaction_id: bankTransactionId,
        cleared_at: new Date().toISOString(),
      };

      // The outflow's own category_id drives the "Needs category" badge on
      // the cleared card (PendingOutflowCard.tsx). When the outflow had no
      // category but the matched transaction was already categorized, copy
      // that category onto the outflow so the badge does not show a false
      // "needs category" state. Only copy it when a journal entry backs
      // the transaction's category — otherwise the badge would hide the
      // same journal-less state this task fixes.
      if (!pendingOutflow.category_id && bankTransaction.category_id && (await hasJournalEntry())) {
        pendingOutflowUpdates.category_id = bankTransaction.category_id;
        categorized = true;
      }

      const { error: poError } = await supabase
        .from('pending_outflows')
        .update(pendingOutflowUpdates)
        .eq('id', pendingOutflowId);

      if (poError) throw poError;

      return {
        pendingOutflowId,
        bankTransactionId,
        categorized,
      };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['pending-outflows'] });
      queryClient.invalidateQueries({ queryKey: ['bank-transactions'] });
      queryClient.invalidateQueries({ queryKey: ['pending-outflow-matches'] });
      queryClient.invalidateQueries({ queryKey: ['income-statement'] });
      queryClient.invalidateQueries({ queryKey: ['balance-sheet'] });
      queryClient.invalidateQueries({ queryKey: ['chart-of-accounts'] });
      toast.success(
        data.categorized
          ? 'Expense matched and cleared'
          : 'Expense matched. Categorize the transaction on the Banking page.'
      );
    },
    onError: (error) => {
      // Map the categorize_bank_transaction guard errors to Banking-page
      // copy. The raw text comes from
      // supabase/migrations/20260709120000_categorize_preserve_metadata_on_noop.sql.
      if (error.message.includes('reconciled')) {
        toast.error('This transaction is reconciled. Reclassify it from the Banking page instead.');
      } else if (error.message.includes('closed fiscal period')) {
        toast.error('This transaction is in a closed fiscal period. Reopen the period before you match it.');
      } else {
        toast.error(`Failed to confirm match: ${error.message}`);
      }
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
