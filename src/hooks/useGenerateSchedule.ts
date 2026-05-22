import { useMutation, useQueryClient } from '@tanstack/react-query';
import { fromZonedTime } from 'date-fns-tz';
import { FunctionsHttpError } from '@supabase/functions-js';
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
  /** May be empty or missing from older bundles / strict-schema fallbacks. */
  template_id: string | null | undefined;
  day: string;
  start_time: string;
  end_time: string;
  position: string;
}

/** Server returned a 422 with a diagnostic body. drop_reason_summary uses
 *  DropCode keys (UPPER_SNAKE) and never contains employee UUIDs. */
export interface ScheduleDiagnostic {
  total_employees: number;
  total_templates: number;
  total_required_slots: number;
  total_generated: number;
  total_dropped: number;
  drop_reason_summary: Record<string, number>;
  model_used: string;
}

export interface GenerateScheduleMetadata {
  estimated_cost: number;
  budget_variance_pct: number;
  notes: string;
  model_used: string;
  /** Shifts the AI produced (raw count) */
  total_generated: number;
  /** Shifts that passed validation (= shifts.length) */
  total_valid: number;
  total_dropped: number;
  /** Sum of required headcount across (template, day). Zero when staffing
   *  settings are absent and no patterns exist. */
  total_required_slots: number;
  drop_reason_summary: Record<string, number>;
  dropped_reasons: string[];
}

export interface GenerateScheduleResponse {
  shifts: GeneratedShift[];
  metadata: GenerateScheduleMetadata;
}

export class ScheduleGenerationError extends Error {
  diagnostic?: ScheduleDiagnostic;
  constructor(message: string, diagnostic?: ScheduleDiagnostic) {
    super(message);
    this.name = 'ScheduleGenerationError';
    this.diagnostic = diagnostic;
  }
}

export function useGenerateSchedule() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (params: GenerateScheduleParams): Promise<GenerateScheduleResponse> => {
      const { data, error } = await supabase.functions.invoke('generate-schedule', {
        body: {
          restaurant_id: params.restaurantId,
          week_start: params.weekStart,
          locked_shift_ids: params.lockedShiftIds,
          excluded_employee_ids: params.excludedEmployeeIds,
        },
      });

      if (error) {
        // FunctionsHttpError carries the Response in `error.context`.
        if (error instanceof FunctionsHttpError) {
          const body = await (error.context as Response).json().catch(() => null);
          if (body?.diagnostic) {
            throw new ScheduleGenerationError(
              body.error ?? 'No valid shifts generated',
              body.diagnostic as ScheduleDiagnostic,
            );
          }
        }
        throw new Error(error.message || 'Failed to generate schedule');
      }
      if (data?.error) throw new Error(data.error);

      const response = data as GenerateScheduleResponse;
      if (response.shifts.length === 0) {
        // With Bug 8 fixed the server returns 422 in this case, so this branch
        // is defensive only. Skip insert and return the response.
        return response;
      }

      const shiftsToInsert = response.shifts.map((shift) => {
        const startUtc = fromZonedTime(
          `${shift.day}T${shift.start_time}`,
          params.restaurantTimezone,
        ).toISOString();
        const endUtc = fromZonedTime(
          `${shift.day}T${shift.end_time}`,
          params.restaurantTimezone,
        ).toISOString();
        // Persist the template the AI bound this shift to. Without this,
        // the planner's template-bucket lookup falls back to (start, end,
        // position, day) matching, which collides across areas (e.g. two
        // brands with identical open windows). Coerce empty/whitespace to
        // null so the FK constraint stays happy.
        const templateId = shift.template_id?.trim() || null;
        return {
          restaurant_id: params.restaurantId,
          employee_id: shift.employee_id,
          shift_template_id: templateId,
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
      // Always invalidate so the planner re-fetches even if the AI returned zero
      // shifts (shouldn't happen with the 422 guardrail, but stays safe).
      queryClient.invalidateQueries({ queryKey: ['shifts', variables.restaurantId] });

      if (data.shifts.length === 0) return;

      const { total_required_slots: required, total_dropped: dropped } = data.metadata;
      const filled = data.shifts.length;
      // Surface underfill prominently — covers the user-reported "slots left open"
      // case where the AI returns a partial schedule.
      let description =
        required > 0 && filled < required
          ? `Filled ${filled} of ${required} required slots — review and publish when ready.`
          : `${filled} shifts created — review and publish when ready.`;
      if (data.metadata.budget_variance_pct > 0) {
        description += ` Estimated cost is ${data.metadata.budget_variance_pct.toFixed(0)}% over budget.`;
      }
      if (dropped > 0) {
        description += ` ${dropped} suggestions were filtered out.`;
      }
      toast({ title: 'Schedule Generated', description });
    },
    onError: (error: Error) => {
      const diag = error instanceof ScheduleGenerationError ? error.diagnostic : undefined;
      const top =
        diag?.drop_reason_summary && Object.keys(diag.drop_reason_summary).length > 0
          ? Object.entries(diag.drop_reason_summary).sort((a, b) => b[1] - a[1])[0]
          : null;
      // total_generated may be > 0 when the AI produced shifts but every one
      // was rejected by validation (e.g. wrong position, outside availability).
      // Surfacing that count helps the user distinguish "AI returned nothing" from
      // "AI returned plenty, all invalid".
      const generated = diag?.total_generated ?? 0;
      const description = diag
        ? `Filled 0 of ${diag.total_required_slots} required slots` +
          (generated > 0 ? ` (AI proposed ${generated}, all dropped).` : '.') +
          (top ? ` Top reason: ${top[0]} (${top[1]}).` : '') +
          ' Check employee positions, availability, and templates.'
        : error.message || 'Try again or build manually.';
      toast({
        title: "Couldn't generate schedule",
        description,
        variant: 'destructive',
      });
    },
  });
}
