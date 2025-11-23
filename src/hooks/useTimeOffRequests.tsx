import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { TimeOffRequest } from '@/types/scheduling';
import { useToast } from '@/hooks/use-toast';

export const useTimeOffRequests = (restaurantId: string | null) => {
  const { data, isLoading, error } = useQuery({
    queryKey: ['time-off-requests', restaurantId],
    queryFn: async () => {
      if (!restaurantId) return [];

      const { data, error } = await supabase
        .from('time_off_requests')
        .select(`
          *,
          employee:employees(*)
        `)
        .eq('restaurant_id', restaurantId)
        .order('start_date', { ascending: false });

      if (error) throw error;
      return data as TimeOffRequest[];
    },
    enabled: !!restaurantId,
    staleTime: 30000, // 30 seconds
    refetchOnWindowFocus: true,
    refetchOnMount: true,
  });

  return {
    timeOffRequests: data || [],
    loading: isLoading,
    error,
  };
};

export const useCreateTimeOffRequest = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (request: Omit<TimeOffRequest, 'id' | 'created_at' | 'updated_at' | 'requested_at' | 'reviewed_at' | 'reviewed_by'>) => {
      const { data, error } = await supabase
        .from('time_off_requests')
        .insert(request)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['time-off-requests', data.restaurant_id] });
      toast({
        title: 'Time-off request created',
        description: 'The request has been submitted for approval.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error creating time-off request',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
};

export const useUpdateTimeOffRequest = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<TimeOffRequest> & { id: string }) => {
      const { data, error } = await supabase
        .from('time_off_requests')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['time-off-requests', data.restaurant_id] });
      toast({
        title: 'Time-off request updated',
        description: 'The request has been updated successfully.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error updating time-off request',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
};

export const useApproveTimeOffRequest = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id, restaurantId }: { id: string; restaurantId: string }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data, error } = await supabase
        .from('time_off_requests')
        .update({
          status: 'approved',
          reviewed_at: new Date().toISOString(),
          reviewed_by: user.id,
        })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['time-off-requests', variables.restaurantId] });
      toast({
        title: 'Time-off approved',
        description: 'The time-off request has been approved.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error approving time-off',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
};

export const useRejectTimeOffRequest = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id, restaurantId }: { id: string; restaurantId: string }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data, error } = await supabase
        .from('time_off_requests')
        .update({
          status: 'rejected',
          reviewed_at: new Date().toISOString(),
          reviewed_by: user.id,
        })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['time-off-requests', variables.restaurantId] });
      toast({
        title: 'Time-off rejected',
        description: 'The time-off request has been rejected.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error rejecting time-off',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
};

export const useDeleteTimeOffRequest = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id, restaurantId }: { id: string; restaurantId: string }) => {
      const { error } = await supabase
        .from('time_off_requests')
        .delete()
        .eq('id', id);

      if (error) throw error;
      return { id, restaurantId };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['time-off-requests', data.restaurantId] });
      toast({
        title: 'Time-off request deleted',
        description: 'The request has been removed.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error deleting time-off request',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
};
