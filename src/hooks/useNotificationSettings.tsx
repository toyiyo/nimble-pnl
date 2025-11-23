import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { NotificationSettings } from '@/types/scheduling';
import { useToast } from '@/hooks/use-toast';

export const useNotificationSettings = (restaurantId: string | null) => {
  const { data, isLoading, error } = useQuery({
    queryKey: ['notification-settings', restaurantId],
    queryFn: async () => {
      if (!restaurantId) return null;

      const { data, error } = await supabase
        .from('notification_settings')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .single();

      if (error) {
        // If no settings exist, return defaults
        if (error.code === 'PGRST116') {
          return {
            restaurant_id: restaurantId,
            notify_time_off_request: true,
            notify_time_off_approved: true,
            notify_time_off_rejected: true,
            time_off_notify_managers: true,
            time_off_notify_employee: true,
          } as Partial<NotificationSettings>;
        }
        throw error;
      }
      return data as NotificationSettings;
    },
    enabled: !!restaurantId,
    staleTime: 60000, // 60 seconds
  });

  return {
    settings: data,
    loading: isLoading,
    error,
  };
};

export const useUpdateNotificationSettings = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ 
      restaurantId, 
      settings 
    }: { 
      restaurantId: string; 
      settings: Partial<NotificationSettings> 
    }) => {
      // Check if settings exist
      const { data: existing } = await supabase
        .from('notification_settings')
        .select('id')
        .eq('restaurant_id', restaurantId)
        .single();

      if (existing) {
        // Update existing settings
        const { data, error } = await supabase
          .from('notification_settings')
          .update(settings)
          .eq('restaurant_id', restaurantId)
          .select()
          .single();

        if (error) throw error;
        return data;
      } else {
        // Create new settings
        const { data, error } = await supabase
          .from('notification_settings')
          .insert({
            restaurant_id: restaurantId,
            ...settings,
          })
          .select()
          .single();

        if (error) throw error;
        return data;
      }
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ 
        queryKey: ['notification-settings', variables.restaurantId] 
      });
      toast({
        title: 'Settings updated',
        description: 'Notification settings have been saved.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error updating settings',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
};
