import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Shift } from '@/types/scheduling';
import { useToast } from '@/hooks/use-toast';

export const useShifts = (restaurantId: string | null, startDate?: Date, endDate?: Date) => {
  const { toast } = useToast();

  const { data, isLoading, error } = useQuery({
    queryKey: ['shifts', restaurantId, startDate?.toISOString(), endDate?.toISOString()],
    queryFn: async () => {
      if (!restaurantId) return [];

      let query = supabase
        .from('shifts')
        .select('*, employee:employees(*)')
        .eq('restaurant_id', restaurantId);

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
    shifts: data || [],
    loading: isLoading,
    error,
  };
};

export const useCreateShift = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (shift: Omit<Shift, 'id' | 'created_at' | 'updated_at' | 'employee'>) => {
      const { data, error } = await supabase
        .from('shifts')
        .insert(shift)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['shifts', data.restaurant_id] });
      toast({
        title: 'Shift created',
        description: 'The shift has been added to the schedule.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error creating shift',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
};

export const useUpdateShift = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<Shift> & { id: string }) => {
      // Remove employee data from updates if present
      const { employee, ...shiftUpdates } = updates as Partial<Shift>;
      
      const { data, error } = await supabase
        .from('shifts')
        .update(shiftUpdates)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['shifts', data.restaurant_id] });
      toast({
        title: 'Shift updated',
        description: 'The shift has been updated.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error updating shift',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
};

export const useDeleteShift = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id, restaurantId }: { id: string; restaurantId: string }) => {
      const { error } = await supabase
        .from('shifts')
        .delete()
        .eq('id', id);

      if (error) throw error;
      return { id, restaurantId };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['shifts', data.restaurantId] });
      toast({
        title: 'Shift deleted',
        description: 'The shift has been removed from the schedule.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error deleting shift',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
};
