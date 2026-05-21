import { useMutation } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

type Args = { restaurantId: string; employeeIds: string[] };
type Result = { sent: number; skipped_no_email: number; errors: number };

export function useSendAvailabilityReminder() {
  const { toast } = useToast();
  return useMutation<Result, Error, Args>({
    mutationFn: async ({ restaurantId, employeeIds }) => {
      const { data, error } = await supabase.functions.invoke(
        'notify-availability-reminder',
        { body: { restaurant_id: restaurantId, employee_ids: employeeIds } },
      );
      if (error) {
        throw new Error(error.message || 'Failed to send reminders');
      }
      return data as Result;
    },
    onSuccess: (result) => {
      const headline =
        result.sent > 0
          ? `Sent ${result.sent} reminder${result.sent === 1 ? '' : 's'}`
          : 'No reminders sent';
      const skipped = result.skipped_no_email > 0
        ? ` ${result.skipped_no_email} employee${result.skipped_no_email === 1 ? '' : 's'} had no email on file.`
        : '';
      toast({ title: headline, description: skipped.trim() || undefined });
    },
    onError: (error) => {
      toast({
        title: "Couldn't send reminders",
        description: error.message,
        variant: 'destructive',
      });
    },
  });
}
