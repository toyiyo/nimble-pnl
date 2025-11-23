import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { TimeOffRequest } from '@/types/scheduling';
import { useToast } from '@/hooks/use-toast';
import { useCreateEntity, useUpdateEntity, useDeleteEntity } from './useCRUDEntity';

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
    mutationFn: async (entity: Omit<TimeOffRequest, 'id' | 'created_at' | 'updated_at'>) => {
      const { data, error } = await supabase
        .from('time_off_requests')
        .insert(entity)
        .select()
        .single();

      if (error) throw error;
      return data as TimeOffRequest;
    },
    onSuccess: async (data) => {
      // Invalidate queries
      queryClient.invalidateQueries({ queryKey: ['time-off-requests', data.restaurant_id] });
      
      // Show success toast
      toast({
        title: 'Time-off request created',
        description: 'The time-off request has been created successfully.',
      });

      // Send notification
      try {
        await supabase.functions.invoke('send-time-off-notification', {
          body: {
            timeOffRequestId: data.id,
            action: 'created',
          },
        });
      } catch (error) {
        console.error('Failed to send notification:', error);
        // Don't fail the mutation if notification fails
      }
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
  return useUpdateEntity<TimeOffRequest>({
    tableName: 'time_off_requests',
    queryKey: 'time-off-requests',
    entityName: 'Time-off request',
    getRestaurantId: (data) => data.restaurant_id,
  });
};

// Shared hook for approving/rejecting time-off requests
const useReviewTimeOffRequest = (action: 'approved' | 'rejected') => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const actionLabel = action === 'approved' ? 'approved' : 'rejected';
  const actionPastTense = action === 'approved' ? 'approved' : 'rejected';

  return useMutation({
    mutationFn: async ({ id, restaurantId }: { id: string; restaurantId: string }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data, error } = await supabase
        .from('time_off_requests')
        .update({
          status: action,
          reviewed_at: new Date().toISOString(),
          reviewed_by: user.id,
        })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: async (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['time-off-requests', variables.restaurantId] });
      toast({
        title: `Time-off ${actionPastTense}`,
        description: `The time-off request has been ${actionPastTense}.`,
      });

      // Send notification
      try {
        await supabase.functions.invoke('send-time-off-notification', {
          body: {
            timeOffRequestId: data.id,
            action: action,
          },
        });
      } catch (error) {
        console.error('Failed to send notification:', error);
        // Don't fail the mutation if notification fails
      }
    },
    onError: (error: Error) => {
      toast({
        title: `Error ${actionLabel} time-off`,
        description: error.message,
        variant: 'destructive',
      });
    },
  });
};

export const useApproveTimeOffRequest = () => {
  return useReviewTimeOffRequest('approved');
};

export const useRejectTimeOffRequest = () => {
  return useReviewTimeOffRequest('rejected');
};

export const useDeleteTimeOffRequest = () => {
  return useDeleteEntity<TimeOffRequest>({
    tableName: 'time_off_requests',
    queryKey: 'time-off-requests',
    entityName: 'Time-off request',
    getRestaurantId: (data) => data.restaurant_id,
  });
};
