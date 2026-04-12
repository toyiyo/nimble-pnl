import { useMutation, useQueryClient } from '@tanstack/react-query';
import { fromZonedTime } from 'date-fns-tz';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface GenerateScheduleParams {
  restaurantId: string;
  restaurantTimezone: string;
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

export interface GenerateScheduleMetadata {
  estimated_cost: number;
  budget_variance_pct: number;
  notes: string;
  model_used: string;
  total_generated: number;
  total_valid: number;
  total_dropped: number;
  dropped_reasons: string[];
}

export interface GenerateScheduleResponse {
  shifts: GeneratedShift[];
  metadata: GenerateScheduleMetadata;
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
        return response;
      }

      // 2. Batch-insert shifts using restaurant timezone for correct UTC conversion
      const shiftsToInsert = response.shifts.map((shift) => {
        const startUtc = fromZonedTime(
          `${shift.day}T${shift.start_time}`,
          params.restaurantTimezone,
        ).toISOString();
        const endUtc = fromZonedTime(
          `${shift.day}T${shift.end_time}`,
          params.restaurantTimezone,
        ).toISOString();

        return {
          restaurant_id: params.restaurantId,
          employee_id: shift.employee_id,
          start_time: startUtc,
          end_time: endUtc,
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
      if (data.shifts.length === 0) return;

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
