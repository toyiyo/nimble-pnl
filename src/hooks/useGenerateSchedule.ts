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
  preferences?: string;
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

export interface ClientSafeUnfilledSlot {
  day: string;
  position: string;
  area: string | null;
  reason: string;
  template_name: string;
}

export interface ClientSafeFairnessSummary {
  hours_assigned: number;
  days_worked: number;
  hours_budget: number;
  employee_name: string;
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
  // New:
  unfilled?: ClientSafeUnfilledSlot[];
  fairness_summary?: ClientSafeFairnessSummary[];
  applied_swaps_count?: number;
  rejected_swaps_count?: number;
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
          preferences_text: params.preferences ?? '',
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
        // brands with identical open windows).
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

      const { total_required_slots: required, applied_swaps_count = 0, rejected_swaps_count = 0 } = data.metadata;
      const filled = data.shifts.length;

      const parts: string[] = [];
      parts.push(`${filled} of ${required} slots filled`);
      if (applied_swaps_count > 0) parts.push(`${applied_swaps_count} preference swap${applied_swaps_count === 1 ? '' : 's'} applied`);
      if (rejected_swaps_count > 0) parts.push(`${rejected_swaps_count} couldn't be applied`);
      let description = parts.join(' · ') + '.';

      if (data.metadata.budget_variance_pct > 0) {
        description += ` Estimated cost is ${data.metadata.budget_variance_pct.toFixed(0)}% over budget.`;
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
