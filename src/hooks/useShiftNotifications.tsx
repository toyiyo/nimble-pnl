import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { ShiftNotification } from '@/types/scheduling';
import { useToast } from '@/hooks/use-toast';

export const useShiftNotifications = (restaurantId: string | null, unreadOnly: boolean = false) => {
  const { data, isLoading, error } = useQuery({
    queryKey: ['shift-notifications', restaurantId, unreadOnly],
    queryFn: async () => {
      if (!restaurantId) return [];

      let query = supabase
        .from('shift_notifications')
        .select('*')
        .eq('restaurant_id', restaurantId);

      if (unreadOnly) {
        query = query.eq('is_read', false);
      }

      const { data, error } = await query.order('created_at', { ascending: false });

      if (error) throw error;
      return data as ShiftNotification[];
    },
    enabled: !!restaurantId,
    staleTime: 10000, // 10 seconds for notifications
    refetchOnWindowFocus: true,
    refetchOnMount: true,
  });

  return {
    notifications: data || [],
    unreadCount: data?.filter(n => !n.is_read).length || 0,
    loading: isLoading,
    error,
  };
};

export const useMarkNotificationRead = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id, restaurantId }: { id: string; restaurantId: string }) => {
      const { data, error } = await supabase
        .from('shift_notifications')
        .update({ is_read: true })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return { data, restaurantId };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['shift-notifications', result.restaurantId] });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error marking notification as read',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
};

export const useMarkAllNotificationsRead = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (restaurantId: string) => {
      const { error } = await supabase
        .from('shift_notifications')
        .update({ is_read: true })
        .eq('restaurant_id', restaurantId)
        .eq('is_read', false);

      if (error) throw error;
      return restaurantId;
    },
    onSuccess: (restaurantId) => {
      queryClient.invalidateQueries({ queryKey: ['shift-notifications', restaurantId] });
      toast({
        title: 'All notifications marked as read',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error marking notifications as read',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
};

export const useDeleteNotification = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id, restaurantId }: { id: string; restaurantId: string }) => {
      const { error } = await supabase
        .from('shift_notifications')
        .delete()
        .eq('id', id);

      if (error) throw error;
      return restaurantId;
    },
    onSuccess: (restaurantId) => {
      queryClient.invalidateQueries({ queryKey: ['shift-notifications', restaurantId] });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error deleting notification',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
};
