import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { ShiftClaim } from '@/types/scheduling';
import { useToast } from '@/hooks/use-toast';

export const useShiftClaims = (restaurantId: string | null, status?: string) => {
  const { toast } = useToast();

  const { data, isLoading, error } = useQuery({
    queryKey: ['shift-claims', restaurantId, status],
    queryFn: async () => {
      if (!restaurantId) return [];

      let query = supabase
        .from('shift_claims')
        .select(`
          *,
          shift_offer:shift_offers(
            *,
            shift:shifts(*),
            offering_employee:employees(*)
          ),
          open_shift:shifts(*),
          claiming_employee:employees(*)
        `)
        .eq('restaurant_id', restaurantId);

      if (status) {
        query = query.eq('status', status);
      }

      const { data, error } = await query.order('created_at', { ascending: false });

      if (error) throw error;
      return data as ShiftClaim[];
    },
    enabled: !!restaurantId,
    staleTime: 30000, // 30 seconds
    refetchOnWindowFocus: true,
    refetchOnMount: true,
  });

  return {
    shiftClaims: data || [],
    loading: isLoading,
    error,
  };
};

export const useCreateShiftClaim = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (claim: Omit<ShiftClaim, 'id' | 'created_at' | 'updated_at' | 'status' | 'shift_offer' | 'open_shift' | 'claiming_employee'>) => {
      const { data, error } = await supabase
        .from('shift_claims')
        .insert({
          ...claim,
          status: 'pending',
        })
        .select()
        .single();

      if (error) throw error;
      return data as ShiftClaim;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['shift-claims', data.restaurant_id] });
      queryClient.invalidateQueries({ queryKey: ['shift-offers', data.restaurant_id] });
      toast({
        title: 'Shift claimed',
        description: 'Your claim request has been sent to the manager for approval.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error claiming shift',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
};

export const useUpdateShiftClaim = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<ShiftClaim> & { id: string }) => {
      // Remove joined data from updates if present
      const { shift_offer, open_shift, claiming_employee, ...claimUpdates } = updates as Partial<ShiftClaim>;
      
      const { data, error } = await supabase
        .from('shift_claims')
        .update(claimUpdates)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return data as ShiftClaim;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['shift-claims', data.restaurant_id] });
      toast({
        title: 'Shift claim updated',
        description: 'The shift claim has been updated.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error updating shift claim',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
};

export const useCancelShiftClaim = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id, restaurantId }: { id: string; restaurantId: string }) => {
      const { data, error } = await supabase
        .from('shift_claims')
        .update({ status: 'cancelled' })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return { data, restaurantId };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['shift-claims', result.restaurantId] });
      queryClient.invalidateQueries({ queryKey: ['shift-offers', result.restaurantId] });
      toast({
        title: 'Shift claim cancelled',
        description: 'Your shift claim has been cancelled.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error cancelling shift claim',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
};
