import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export type AvailabilityWindow = {
  day_of_week: number;
  start_time: string;
  end_time: string;
  is_available: boolean;
};

export type BulkSetAvailabilityArgs = {
  restaurantId: string;
  employeeIds: string[];
  availability: AvailabilityWindow[];
};

type BulkSetAvailabilityResult = {
  employees_updated: number;
  rows_inserted: number;
};

const ERROR_MESSAGES: Record<string, string> = {
  forbidden: "You don't have permission to set availability for these employees.",
  employee_not_in_restaurant:
    "One or more employees aren't in this restaurant. Refresh and try again.",
  invalid_day_of_week: 'Invalid day. Please re-open the dialog and try again.',
  is_available_required: 'Availability data is incomplete.',
};

function friendlyMessage(supabaseError: { message?: string } | null): string {
  if (!supabaseError?.message) return "Couldn't save availability. Try again.";
  for (const key of Object.keys(ERROR_MESSAGES)) {
    if (supabaseError.message.toLowerCase().includes(key)) {
      return ERROR_MESSAGES[key];
    }
  }
  return "Couldn't save availability. Try again.";
}

export function useBulkSetAvailability(options?: { silent?: boolean }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const silent = options?.silent ?? false;

  return useMutation<BulkSetAvailabilityResult, Error, BulkSetAvailabilityArgs>({
    mutationFn: async ({ restaurantId, employeeIds, availability }) => {
      const { data, error } = await supabase.rpc('bulk_set_employee_availability', {
        p_restaurant_id: restaurantId,
        p_employee_ids: employeeIds,
        p_availability: availability,
      });
      if (error) {
        throw new Error(error.message);
      }
      const row = Array.isArray(data) ? data[0] : data;
      return (row as BulkSetAvailabilityResult) ?? {
        employees_updated: 0,
        rows_inserted: 0,
      };
    },
    onSuccess: (result, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['employee-availability', variables.restaurantId],
      });
      if (!silent) {
        toast({
          title: 'Availability saved',
          description: `Updated ${result.employees_updated} employee${result.employees_updated === 1 ? '' : 's'}.`,
        });
      }
    },
    onError: (error) => {
      toast({
        title: "Couldn't save availability",
        description: friendlyMessage({ message: error.message }),
        variant: 'destructive',
      });
    },
  });
}
