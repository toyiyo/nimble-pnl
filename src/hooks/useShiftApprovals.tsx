import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { ShiftApproval } from '@/types/scheduling';
import { useToast } from '@/hooks/use-toast';

export const useShiftApprovals = (restaurantId: string | null) => {
  const { toast } = useToast();

  const { data, isLoading, error } = useQuery({
    queryKey: ['shift-approvals', restaurantId],
    queryFn: async () => {
      if (!restaurantId) return [];

      const { data, error } = await supabase
        .from('shift_approvals')
        .select(`
          *,
          shift_claim:shift_claims(
            *,
            shift_offer:shift_offers(
              *,
              shift:shifts(*),
              offering_employee:employees(*)
            ),
            open_shift:shifts(*),
            claiming_employee:employees(*)
          )
        `)
        .eq('restaurant_id', restaurantId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data as ShiftApproval[];
    },
    enabled: !!restaurantId,
    staleTime: 30000, // 30 seconds
    refetchOnWindowFocus: true,
    refetchOnMount: true,
  });

  return {
    shiftApprovals: data || [],
    loading: isLoading,
    error,
  };
};

export const useCreateShiftApproval = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (approval: Omit<ShiftApproval, 'id' | 'created_at' | 'shift_claim'>) => {
      const { data, error } = await supabase
        .from('shift_approvals')
        .insert(approval)
        .select()
        .single();

      if (error) throw error;
      return data as ShiftApproval;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['shift-approvals', data.restaurant_id] });
      queryClient.invalidateQueries({ queryKey: ['shift-claims', data.restaurant_id] });
      queryClient.invalidateQueries({ queryKey: ['shift-offers', data.restaurant_id] });
      queryClient.invalidateQueries({ queryKey: ['shifts', data.restaurant_id] });
      
      const action = data.decision === 'approved' ? 'approved' : 'rejected';
      toast({
        title: `Shift claim ${action}`,
        description: `The shift claim has been ${action}.`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error processing approval',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
};
