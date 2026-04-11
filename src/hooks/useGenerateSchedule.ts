import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface GenerateScheduleParams {
  restaurantId: string;
  weekStart: string; // YYYY-MM-DD
  lockedShiftIds: string[];
  excludedEmployeeIds: string[];
}

interface GeneratedShift {
  employee_id: string;
  template_id: string;
  day: string;
  start_time: string;
  end_time: string;
  position: string;
}

interface GenerateScheduleResponse {
  shifts: GeneratedShift[];
  metadata: {
    estimated_cost: number;
    budget_variance_pct: number;
    notes: string;
    model_used: string;
    total_generated: number;
    total_valid: number;
    total_dropped: number;
    dropped_reasons: string[];
  };
}

export function useGenerateSchedule() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (params: GenerateScheduleParams): Promise<GenerateScheduleResponse> => {
      // 1. Call edge function
      const { data, error } = await supabase.functions.invoke('generate-schedule', {
        body: {
          restaurant_id: params.restaurantId,
          week_start: params.weekStart,
          locked_shift_ids: params.lockedShiftIds,
          excluded_employee_ids: params.excludedEmployeeIds,
        },
      });

      if (error) throw new Error(error.message || 'Failed to generate schedule');
      if (data.error) throw new Error(data.error);

      const response = data as GenerateScheduleResponse;

      if (response.shifts.length === 0) {
        throw new Error('AI generated no valid shifts. Check templates and availability.');
      }

      // 2. Batch-insert shifts
      const shiftsToInsert = response.shifts.map((shift) => {
        // Build proper local-time Date objects and serialize as ISO strings
        // to match how useCreateShift sends timestamps (with timezone info)
        const [y, m, d] = shift.day.split('-').map(Number);
        const [sh, sm] = shift.start_time.split(':').map(Number);
        const [eh, em] = shift.end_time.split(':').map(Number);
        const startDate = new Date(y, m - 1, d, sh, sm, 0);
        const endDate = new Date(y, m - 1, d, eh, em, 0);

        return {
        restaurant_id: params.restaurantId,
        employee_id: shift.employee_id,
        start_time: startDate.toISOString(),
        end_time: endDate.toISOString(),
        break_duration: 0,
        position: shift.position,
        status: 'scheduled' as const,
        is_published: false,
        locked: false,
        is_recurring: false,
        source: 'ai',
      };
      });

      const { error: insertError } = await supabase.from('shifts').insert(shiftsToInsert);
      if (insertError) throw insertError;

      return response;
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['shifts', variables.restaurantId] });

      let description = `${data.shifts.length} shifts created — review and publish when ready.`;
      if (data.metadata.budget_variance_pct > 0) {
        description += ` Estimated cost is ${data.metadata.budget_variance_pct.toFixed(0)}% over budget.`;
      }
      if (data.metadata.total_dropped > 0) {
        description += ` ${data.metadata.total_dropped} suggestions were filtered out.`;
      }

      toast({ title: 'Schedule Generated', description });
    },
    onError: (error: Error) => {
      toast({
        title: "Couldn't generate schedule",
        description: error.message || 'Try again or build manually.',
        variant: 'destructive',
      });
    },
  });
}
