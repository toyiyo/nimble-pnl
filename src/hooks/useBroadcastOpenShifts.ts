import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export interface BroadcastResult {
  success: boolean;
  open_shifts: number;
  push_sent: number;
  push_failed: number;
  email_sent: number;
  email_failed: number;
  total_employees: number;
  /**
   * Employees who actually have an address — the denominator the email counts
   * range over. `total_employees` counts everyone, so it is the wrong number to
   * report a failure against.
   *
   * Optional because the function and the bundle do not deploy together: a
   * freshly-loaded client can briefly talk to a function that predates these.
   */
  email_recipients?: number;
  email_rate_limited?: number;
  email_failed_reason?: string;
}

export interface BroadcastToast {
  title: string;
  description: string;
  variant?: 'destructive';
}

export function buildBroadcastToast(data: BroadcastResult): BroadcastToast {
  const recipients = data.email_recipients ?? 0;
  const failed = data.email_failed ?? 0;
  const base = `Notified ${data.total_employees} team members about ${data.open_shifts} open shifts.`;

  // Nothing was emailed at all. Push may still have landed, so this isn't an
  // outright failure — but "Broadcast sent" on its own would read as delivery.
  if (failed > 0 && failed >= recipients) {
    return {
      title: 'Broadcast sent, but no emails went out',
      description: `Push notifications were sent. All ${recipients} emails failed to send.`,
      variant: 'destructive',
    };
  }

  if (failed > 0) {
    // "1 of 12 emails failed to send" is grammatical at every n, so the count
    // needs no pluralization branch.
    return {
      title: 'Broadcast sent',
      description: `${base} ${failed} of ${recipients} emails failed to send.`,
    };
  }

  return { title: 'Broadcast sent', description: base };
}

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
      return data as BroadcastResult;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['week_publication_status'] });
      queryClient.invalidateQueries({ queryKey: ['schedule_publications'] });
      toast(buildBroadcastToast(data));
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
