import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { ShiftOffer } from '@/types/scheduling';
import { useToast } from '@/hooks/use-toast';

export const useShiftOffers = (restaurantId: string | null, status?: string) => {
  const { toast } = useToast();

  const { data, isLoading, error } = useQuery({
    queryKey: ['shift-offers', restaurantId, status],
    queryFn: async () => {
      if (!restaurantId) return [];

      let query = supabase
        .from('shift_offers')
        .select(`
          *,
          shift:shifts(*),
          offering_employee:employees(*)
        `)
        .eq('restaurant_id', restaurantId);

      if (status) {
        query = query.eq('status', status);
      }

      const { data, error } = await query.order('created_at', { ascending: false });

      if (error) throw error;
      return data as ShiftOffer[];
    },
    enabled: !!restaurantId,
    staleTime: 30000, // 30 seconds
    refetchOnWindowFocus: true,
    refetchOnMount: true,
  });

  return {
    shiftOffers: data || [],
    loading: isLoading,
    error,
  };
};

export const useCreateShiftOffer = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (offer: Omit<ShiftOffer, 'id' | 'created_at' | 'updated_at' | 'status' | 'shift' | 'offering_employee'>) => {
      const { data, error } = await supabase
        .from('shift_offers')
        .insert({
          ...offer,
          status: 'open',
        })
        .select()
        .single();

      if (error) throw error;
      return data as ShiftOffer;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['shift-offers', data.restaurant_id] });
      toast({
        title: 'Shift offered',
        description: 'Your shift has been posted to the marketplace.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error creating shift offer',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
};

export const useUpdateShiftOffer = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<ShiftOffer> & { id: string }) => {
      // Remove joined data from updates if present
      const { shift, offering_employee, ...offerUpdates } = updates as Partial<ShiftOffer>;
      
      const { data, error } = await supabase
        .from('shift_offers')
        .update(offerUpdates)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return data as ShiftOffer;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['shift-offers', data.restaurant_id] });
      toast({
        title: 'Shift offer updated',
        description: 'The shift offer has been updated.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error updating shift offer',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
};

export const useCancelShiftOffer = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id, restaurantId }: { id: string; restaurantId: string }) => {
      const { data, error } = await supabase
        .from('shift_offers')
        .update({ status: 'cancelled' })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return { data, restaurantId };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['shift-offers', result.restaurantId] });
      toast({
        title: 'Shift offer cancelled',
        description: 'Your shift offer has been cancelled.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error cancelling shift offer',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
};
