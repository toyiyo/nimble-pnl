import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export function useBroadcastOpenShifts() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (params: { restaurantId: string; publicationId: string }) => {
      const { data, error } = await supabase.functions.invoke('broadcast-open-shifts', {
        body: {
          restaurant_id: params.restaurantId,
          publication_id: params.publicationId,
        },
      });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error ?? 'Broadcast failed');
      return data as {
        success: boolean;
        open_shifts: number;
        push_sent: number;
        push_failed: number;
        email_sent: number;
        email_failed: number;
        total_employees: number;
      };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['week_publication_status'] });
      queryClient.invalidateQueries({ queryKey: ['schedule_publications'] });
      toast({
        title: 'Broadcast sent',
        description: `Notified ${data.total_employees} team members about ${data.open_shifts} open shifts.`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Broadcast failed',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
}
