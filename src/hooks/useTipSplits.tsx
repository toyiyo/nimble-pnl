import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import type { TipShare } from '@/utils/tipPooling';
import type { ShareMethod, TipSource } from './useTipPoolSettings';

export interface TipSplit {
  id: string;
  restaurant_id: string;
  split_date: string;
  total_amount: number;
  status: 'draft' | 'approved' | 'archived';
  share_method: ShareMethod | null;
  tip_source: TipSource | null;
  notes: string | null;
  created_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TipSplitItem {
  id: string;
  tip_split_id: string;
  employee_id: string;
  amount: number;
  hours_worked: number | null;
  role: string | null;
  role_weight: number | null;
  manually_edited: boolean;
  created_at: string;
}

export interface TipSplitWithItems extends TipSplit {
  items: (TipSplitItem & {
    employee?: {
      name: string;
      position: string;
    };
  })[];
}

export interface CreateTipSplitInput {
  split_date: string;
  total_amount: number;
  share_method: ShareMethod;
  tip_source: TipSource;
  shares: TipShare[];
  notes?: string;
  status?: 'draft' | 'approved';
}

/**
 * Hook to manage tip splits (daily/weekly splits)
 */
export function useTipSplits(restaurantId: string | null, startDate?: string, endDate?: string) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Fetch tip splits for a date range
  const { data: splits, isLoading, error } = useQuery({
    queryKey: ['tip-splits', restaurantId, startDate, endDate],
    queryFn: async () => {
      if (!restaurantId) return [];

      let query = supabase
        .from('tip_splits')
        .select(`
          *,
          items:tip_split_items(
            *,
            employee:employees(name, position)
          )
        `)
        .eq('restaurant_id', restaurantId)
        .order('split_date', { ascending: false });

      if (startDate) {
        query = query.gte('split_date', startDate);
      }
      if (endDate) {
        query = query.lte('split_date', endDate);
      }

      const { data, error } = await query;

      if (error) throw error;
      return data as TipSplitWithItems[];
    },
    enabled: !!restaurantId,
    staleTime: 30000,
  });

  // Get split for a specific date
  const getSplitForDate = (date: string) => {
    return splits?.find(s => s.split_date === date);
  };

  // Create or update tip split
  const { mutate: saveTipSplit, isPending: isSaving } = useMutation({
    mutationFn: async (input: CreateTipSplitInput) => {
      if (!restaurantId) throw new Error('No restaurant selected');

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Check if split already exists for this date
      const existing = getSplitForDate(input.split_date);

      let splitId: string;

      if (existing) {
        // Update existing split (draft or approved)
        const { data: updatedSplit, error: updateError } = await supabase
          .from('tip_splits')
          .update({
            total_amount: input.total_amount,
            share_method: input.share_method,
            tip_source: input.tip_source,
            notes: input.notes,
            status: input.status || 'draft',
            approved_by: input.status === 'approved' ? user.id : null,
            approved_at: input.status === 'approved' ? new Date().toISOString() : null,
          })
          .eq('id', existing.id)
          .select()
          .single();

        if (updateError) throw updateError;
        splitId = updatedSplit.id;

        // Delete old items
        const { error: deleteError } = await supabase
          .from('tip_split_items')
          .delete()
          .eq('tip_split_id', splitId);

        if (deleteError) throw deleteError;
      } else {
        // Create new split
        const { data: newSplit, error: insertError } = await supabase
          .from('tip_splits')
          .insert({
            restaurant_id: restaurantId,
            split_date: input.split_date,
            total_amount: input.total_amount,
            share_method: input.share_method,
            tip_source: input.tip_source,
            notes: input.notes,
            status: input.status || 'draft',
            created_by: user.id,
            approved_by: input.status === 'approved' ? user.id : null,
            approved_at: input.status === 'approved' ? new Date().toISOString() : null,
          })
          .select()
          .single();

        if (insertError) throw insertError;
        splitId = newSplit.id;
      }

      // Insert items
      const items = input.shares.map(share => ({
        tip_split_id: splitId,
        employee_id: share.employeeId,
        amount: share.amountCents,
        hours_worked: share.hours || null,
        role: share.role || null,
        role_weight: null, // Could be added if needed
        manually_edited: false,
      }));

      const { error: itemsError } = await supabase
        .from('tip_split_items')
        .insert(items);

      if (itemsError) throw itemsError;

      return splitId;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['tip-splits', restaurantId] });
      
      // Also update employee_tips for payroll integration
      if (variables.status === 'approved') {
        queryClient.invalidateQueries({ queryKey: ['payroll'] });
      }

      toast({
        title: variables.status === 'approved' ? 'Tips approved' : 'Draft saved',
        description: variables.status === 'approved' 
          ? 'Tip split has been finalized and recorded.'
          : 'Tip split saved as draft.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error saving tip split',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  // Delete a draft split
  const { mutate: deleteTipSplit, isPending: isDeleting } = useMutation({
    mutationFn: async (splitId: string) => {
      const { error } = await supabase
        .from('tip_splits')
        .delete()
        .eq('id', splitId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tip-splits', restaurantId] });
      toast({
        title: 'Split deleted',
        description: 'The tip split has been removed.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error deleting split',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  return {
    splits,
    isLoading,
    error,
    getSplitForDate,
    saveTipSplit,
    isSaving,
    deleteTipSplit,
    isDeleting,
  };
}
