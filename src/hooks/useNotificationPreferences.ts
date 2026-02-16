import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

// Table not yet in generated types -- helper avoids repeating the cast
function notificationPrefsTable() {
  return supabase.from('notification_preferences' as never) as ReturnType<typeof supabase.from>;
}

export interface NotificationPreferences {
  id: string;
  user_id: string;
  restaurant_id: string;
  daily_brief_email: boolean;
  brief_send_time: string;
  inbox_digest_email: boolean;
}

export function useNotificationPreferences(restaurantId: string | undefined) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['notification-preferences', restaurantId, user?.id],
    queryFn: async () => {
      if (!restaurantId || !user?.id) return null;
      const { data, error } = await notificationPrefsTable()
        .select('*')
        .eq('user_id', user.id)
        .eq('restaurant_id', restaurantId)
        .maybeSingle();
      if (error) throw error;
      return data as unknown as NotificationPreferences | null;
    },
    enabled: !!restaurantId && !!user?.id,
  });

  const upsert = useMutation({
    mutationFn: async (prefs: { daily_brief_email?: boolean; brief_send_time?: string }) => {
      if (!restaurantId || !user?.id) throw new Error('Missing context');
      const { error } = await notificationPrefsTable()
        .upsert({
          user_id: user.id,
          restaurant_id: restaurantId,
          ...prefs,
        }, { onConflict: 'user_id,restaurant_id' } as never);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notification-preferences', restaurantId] });
    },
  });

  return {
    preferences: query.data,
    isLoading: query.isLoading,
    updatePreferences: upsert.mutate,
    isUpdating: upsert.isPending,
  };
}
