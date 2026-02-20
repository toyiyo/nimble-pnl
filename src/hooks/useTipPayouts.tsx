import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TipPayout {
  id: string;
  restaurant_id: string;
  employee_id: string;
  payout_date: string;
  amount: number; // cents
  tip_split_id: string | null;
  notes: string | null;
  paid_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface TipPayoutWithEmployee extends TipPayout {
  employee?: {
    name: string;
    position: string;
  };
}

export interface CreatePayoutsInput {
  tip_split_id?: string | null;
  payout_date: string;
  payouts: {
    employee_id: string;
    amount: number; // cents
    notes?: string | null;
  }[];
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Hook to manage tip payouts (daily cash tip disbursements).
 *
 * Uses a delete-then-insert pattern for payouts linked to a tip_split_id
 * because the unique index uses COALESCE which makes standard upsert unreliable.
 */
export function useTipPayouts(
  restaurantId: string | null,
  startDate: string,
  endDate: string,
) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // -----------------------------------------------------------------------
  // Fetch payouts for the date range
  // -----------------------------------------------------------------------

  const {
    data: payouts = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ['tip-payouts', restaurantId, startDate, endDate],
    queryFn: async (): Promise<TipPayoutWithEmployee[]> => {
      if (!restaurantId) return [];

      const { data, error: fetchError } = await supabase
        .from('tip_payouts')
        .select(`
          *,
          employee:employees(name, position)
        `)
        .eq('restaurant_id', restaurantId)
        .gte('payout_date', startDate)
        .lte('payout_date', endDate)
        .order('payout_date', { ascending: false });

      if (fetchError) throw fetchError;
      return (data ?? []) as TipPayoutWithEmployee[];
    },
    enabled: !!restaurantId,
    staleTime: 30000,
  });

  // -----------------------------------------------------------------------
  // Batch create payouts (delete-then-insert for a given split)
  // -----------------------------------------------------------------------

  const { mutateAsync: createPayouts, isPending: isCreating } = useMutation({
    mutationFn: async (input: CreatePayoutsInput) => {
      if (!restaurantId) throw new Error('No restaurant selected');

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Filter out zero-amount entries
      const nonZero = input.payouts.filter((p) => p.amount > 0);
      if (nonZero.length === 0) {
        throw new Error('No payouts to create (all amounts are zero)');
      }

      // If linked to a split, delete existing payouts for that split first
      if (input.tip_split_id) {
        const { error: deleteError } = await supabase
          .from('tip_payouts')
          .delete()
          .eq('restaurant_id', restaurantId)
          .eq('tip_split_id', input.tip_split_id);

        if (deleteError) throw deleteError;
      }

      // Insert new payouts
      const rows = nonZero.map((p) => ({
        restaurant_id: restaurantId,
        employee_id: p.employee_id,
        payout_date: input.payout_date,
        amount: p.amount,
        tip_split_id: input.tip_split_id ?? null,
        notes: p.notes ?? null,
        paid_by: user.id,
      }));

      const { data, error: insertError } = await supabase
        .from('tip_payouts')
        .insert(rows)
        .select();

      if (insertError) throw insertError;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tip-payouts', restaurantId] });
      queryClient.invalidateQueries({ queryKey: ['payroll', restaurantId] });

      toast({
        title: 'Payouts recorded',
        description: 'Tip payouts have been saved successfully.',
      });
    },
    onError: (err: Error) => {
      toast({
        title: 'Error recording payouts',
        description: err.message,
        variant: 'destructive',
      });
    },
  });

  // -----------------------------------------------------------------------
  // Delete a single payout
  // -----------------------------------------------------------------------

  const { mutateAsync: deletePayout, isPending: isDeleting } = useMutation({
    mutationFn: async (payoutId: string) => {
      if (!restaurantId) throw new Error('No restaurant selected');

      const { error: deleteError } = await supabase
        .from('tip_payouts')
        .delete()
        .eq('id', payoutId)
        .eq('restaurant_id', restaurantId);

      if (deleteError) throw deleteError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tip-payouts', restaurantId] });
      queryClient.invalidateQueries({ queryKey: ['payroll', restaurantId] });

      toast({
        title: 'Payout deleted',
        description: 'The tip payout has been removed.',
      });
    },
    onError: (err: Error) => {
      toast({
        title: 'Error deleting payout',
        description: err.message,
        variant: 'destructive',
      });
    },
  });

  // -----------------------------------------------------------------------
  // Filter / sum helpers
  // -----------------------------------------------------------------------

  /** Return all payouts linked to a specific tip split. */
  const getPayoutsForSplit = (tipSplitId: string): TipPayoutWithEmployee[] => {
    return payouts.filter((p) => p.tip_split_id === tipSplitId);
  };

  /** Return the total amount (in cents) paid out for a specific tip split. */
  const getTotalPaidForSplit = (tipSplitId: string): number => {
    return payouts
      .filter((p) => p.tip_split_id === tipSplitId)
      .reduce((sum, p) => sum + p.amount, 0);
  };

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  return {
    payouts,
    isLoading,
    error,
    createPayouts,
    isCreating,
    deletePayout,
    isDeleting,
    getPayoutsForSplit,
    getTotalPaidForSplit,
  };
}
