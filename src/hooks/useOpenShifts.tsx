import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Shift } from '@/types/scheduling';
import { useToast } from '@/hooks/use-toast';

export const useOpenShifts = (restaurantId: string | null, startDate?: Date, endDate?: Date) => {
  const { toast } = useToast();

  const { data, isLoading, error } = useQuery({
    queryKey: ['open-shifts', restaurantId, startDate?.toISOString(), endDate?.toISOString()],
    queryFn: async () => {
      if (!restaurantId) return [];

      let query = supabase
        .from('shifts')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .eq('is_open', true);

      if (startDate) {
        query = query.gte('start_time', startDate.toISOString());
      }
      if (endDate) {
        query = query.lte('start_time', endDate.toISOString());
      }

      const { data, error } = await query.order('start_time');

      if (error) throw error;
      return data as Shift[];
    },
    enabled: !!restaurantId,
    staleTime: 30000, // 30 seconds
    refetchOnWindowFocus: true,
    refetchOnMount: true,
  });

  return {
    openShifts: data || [],
    loading: isLoading,
    error,
  };
};

export const useCreateOpenShift = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (shift: Omit<Shift, 'id' | 'created_at' | 'updated_at' | 'employee' | 'is_open'> & { employee_id?: string | null }) => {
      const { data, error } = await supabase
        .from('shifts')
        .insert({
          ...shift,
          is_open: true,
          employee_id: shift.employee_id || null,
        })
        .select()
        .single();

      if (error) throw error;
      return data as Shift;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['open-shifts', data.restaurant_id] });
      queryClient.invalidateQueries({ queryKey: ['shifts', data.restaurant_id] });
      toast({
        title: 'Open shift created',
        description: 'The open shift has been posted and is available for employees to claim.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error creating open shift',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
};

export const useCloseOpenShift = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id, restaurantId }: { id: string; restaurantId: string }) => {
      const { data, error } = await supabase
        .from('shifts')
        .update({ is_open: false })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return { data, restaurantId };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['open-shifts', result.restaurantId] });
      queryClient.invalidateQueries({ queryKey: ['shifts', result.restaurantId] });
      toast({
        title: 'Open shift closed',
        description: 'The open shift is no longer available for claiming.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error closing open shift',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
};
