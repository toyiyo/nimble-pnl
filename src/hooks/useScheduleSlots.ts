import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import { supabase } from '@/integrations/supabase/client';

import { useToast } from '@/hooks/use-toast';

import { ScheduleSlot, Shift } from '@/types/scheduling';

import { invalidateScheduleQueries, showErrorToast } from '@/hooks/scheduling-helpers';

import {
  dbShiftToState,
  buildAssignCommand,
  buildReassignCommand,
  buildUnassignCommand,
  buildPolicyContext,
  validateCommand,
  OverlapPolicy,
  RestHoursPolicy,
} from '@/domain/scheduling';
import type { ShiftPolicy } from '@/domain/scheduling';

// ---------------------------------------------------------------------------
// Query: fetch schedule slots for a restaurant + week
// ---------------------------------------------------------------------------

export function useScheduleSlots(restaurantId: string | null, weekStartDate: string | null) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['schedule-slots', restaurantId, weekStartDate],
    queryFn: async () => {
      if (!restaurantId || !weekStartDate) return [];

      const { data, error } = await supabase
        .from('schedule_slots')
        .select(`
          id, restaurant_id, week_template_slot_id, shift_id, week_start_date,
          slot_index, employee_id, status, created_at, updated_at,
          shift:shifts(id, restaurant_id, employee_id, start_time, end_time, break_duration, position, notes, status, is_published, locked, created_at, updated_at),
          employee:employees(id, restaurant_id, name, email, phone, position, status, is_active),
          week_template_slot:week_template_slots(id, week_template_id, shift_template_id, day_of_week, position, headcount, sort_order,
            shift_template:shift_templates(id, name, start_time, end_time, break_duration, position, color, description)
          )
        `)
        .eq('restaurant_id', restaurantId)
        .eq('week_start_date', weekStartDate)
        .order('slot_index');

      if (error) throw error;
      return data as unknown as ScheduleSlot[];
    },
    enabled: !!restaurantId && !!weekStartDate,
    staleTime: 30000,
    refetchOnWindowFocus: true,
  });

  return {
    slots: data || [],
    isLoading,
    error,
  };
}

// ---------------------------------------------------------------------------
// Mutation: generate schedule from template (RPC)
// ---------------------------------------------------------------------------

export function useGenerateSchedule() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({
      restaurantId,
      weekTemplateId,
      weekStartDate,
    }: {
      restaurantId: string;
      weekTemplateId: string;
      weekStartDate: string;
    }) => {
      const { data, error } = await supabase.rpc('generate_schedule_from_template', {
        p_restaurant_id: restaurantId,
        p_week_template_id: weekTemplateId,
        p_week_start_date: weekStartDate,
      });

      if (error) throw error;
      return { data, restaurantId, weekStartDate };
    },
    onSuccess: ({ restaurantId, weekStartDate }) => {
      invalidateScheduleQueries(queryClient, restaurantId, weekStartDate);
      toast({
        title: 'Schedule generated',
        description: 'Shifts and schedule slots have been created from the template.',
      });
    },
    onError: (error: Error) => showErrorToast(toast, 'Error generating schedule', error),
  });
}

// ---------------------------------------------------------------------------
// Mutation: assign an employee to a schedule slot
// ---------------------------------------------------------------------------

const ASSIGNMENT_POLICIES: ShiftPolicy[] = [new OverlapPolicy(), new RestHoursPolicy()];

export function useAssignEmployee() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({
      slotId,
      shiftId,
      employeeId,
      restaurantId,
      weekStartDate,
      silent,
    }: {
      slotId: string;
      shiftId: string | null;
      employeeId: string;
      restaurantId: string;
      weekStartDate: string;
      silent?: boolean;
    }) => {
      // Domain validation when a shift is associated
      if (shiftId) {
        const { data: shiftRow, error: fetchErr } = await supabase
          .from('shifts')
          .select('*')
          .eq('id', shiftId)
          .single();
        if (fetchErr) throw fetchErr;

        const currentShift = shiftRow as unknown as Shift;
        const state = dbShiftToState(currentShift);

        // Assign or Reassign based on whether shift already has an employee
        const cmd = state.employeeId
          ? buildReassignCommand(state, employeeId, 'system')
          : buildAssignCommand(state, employeeId, 'system');

        // Fetch sibling shifts for policy evaluation
        const { data: siblings } = await supabase
          .from('shifts')
          .select('id, start_time, end_time')
          .eq('restaurant_id', restaurantId)
          .eq('employee_id', employeeId)
          .neq('id', shiftId);

        const policyContext = buildPolicyContext(
          employeeId,
          currentShift.start_time,
          currentShift.end_time,
          state.businessDate!,
          (siblings || []) as Array<{ id: string; start_time: string; end_time: string }>,
        );

        const result = validateCommand(state, cmd, {
          context: policyContext,
          checks: ASSIGNMENT_POLICIES,
        });

        if (!result.valid) throw result.error!;

        // Surface warnings via toast but don't block
        if (result.warnings?.length) {
          for (const w of result.warnings) {
            toast({ title: 'Scheduling warning', description: w.message || w.code || '' });
          }
        }
      }

      // Update the schedule slot
      const { error: slotError } = await supabase
        .from('schedule_slots')
        .update({ employee_id: employeeId, status: 'assigned' })
        .eq('id', slotId);

      if (slotError) throw slotError;

      // Also update the associated shift if one exists
      if (shiftId) {
        const { error: shiftError } = await supabase
          .from('shifts')
          .update({ employee_id: employeeId })
          .eq('id', shiftId);

        if (shiftError) {
          // Roll back the slot update to prevent inconsistent state
          await supabase
            .from('schedule_slots')
            .update({ employee_id: null, status: 'unfilled' })
            .eq('id', slotId);
          throw shiftError;
        }
      }

      return { slotId, restaurantId, weekStartDate, silent };
    },
    onSuccess: ({ restaurantId, weekStartDate, silent }) => {
      invalidateScheduleQueries(queryClient, restaurantId, weekStartDate);
      if (!silent) {
        toast({
          title: 'Employee assigned',
          description: 'The employee has been assigned to the shift slot.',
        });
      }
    },
    onError: (error: Error) => showErrorToast(toast, 'Error assigning employee', error),
  });
}

// ---------------------------------------------------------------------------
// Mutation: bulk-assign an employee to multiple schedule slots at once
// ---------------------------------------------------------------------------

export function useBulkAssignEmployee() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({
      assignments,
      restaurantId,
      weekStartDate,
    }: {
      assignments: Array<{ slotId: string; shiftId: string | null; employeeId: string }>;
      restaurantId: string;
      weekStartDate: string;
    }) => {
      for (const { slotId, shiftId, employeeId } of assignments) {
        const { error: slotError } = await supabase
          .from('schedule_slots')
          .update({ employee_id: employeeId, status: 'assigned' })
          .eq('id', slotId);

        if (slotError) throw slotError;

        if (shiftId) {
          const { error: shiftError } = await supabase
            .from('shifts')
            .update({ employee_id: employeeId })
            .eq('id', shiftId);

          if (shiftError) throw shiftError;
        }
      }

      return { count: assignments.length, restaurantId, weekStartDate };
    },
    onSuccess: ({ count, restaurantId, weekStartDate }) => {
      invalidateScheduleQueries(queryClient, restaurantId, weekStartDate);
      toast({
        title: 'Applied to all days',
        description: `Assigned to ${count} additional slot${count === 1 ? '' : 's'}.`,
      });
    },
    onError: (error: Error) => showErrorToast(toast, 'Error applying assignments', error),
  });
}

// ---------------------------------------------------------------------------
// Mutation: unassign an employee from a schedule slot
// ---------------------------------------------------------------------------

export function useUnassignEmployee() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({
      slotId,
      shiftId,
      restaurantId,
      weekStartDate,
    }: {
      slotId: string;
      shiftId: string | null;
      restaurantId: string;
      weekStartDate: string;
    }) => {
      // Domain validation when a shift is associated
      let previousEmployeeId: string | null = null;
      if (shiftId) {
        const { data: shiftRow, error: fetchErr } = await supabase
          .from('shifts')
          .select('*')
          .eq('id', shiftId)
          .single();
        if (fetchErr) throw fetchErr;

        const currentShift = shiftRow as unknown as Shift;
        previousEmployeeId = currentShift.employee_id;
        const state = dbShiftToState(currentShift);
        const cmd = buildUnassignCommand(state, 'system');
        const result = validateCommand(state, cmd);
        if (!result.valid) throw result.error!;
      }

      // Clear employee from the schedule slot
      const { error: slotError } = await supabase
        .from('schedule_slots')
        .update({ employee_id: null, status: 'unfilled' })
        .eq('id', slotId);

      if (slotError) throw slotError;

      // Also clear from the associated shift if one exists
      if (shiftId) {
        const { error: shiftError } = await supabase
          .from('shifts')
          .update({ employee_id: null })
          .eq('id', shiftId);

        if (shiftError) {
          // Roll back the slot update to prevent inconsistent state
          await supabase
            .from('schedule_slots')
            .update({ employee_id: previousEmployeeId, status: 'assigned' })
            .eq('id', slotId);
          throw shiftError;
        }
      }

      return { slotId, restaurantId, weekStartDate };
    },
    onSuccess: ({ restaurantId, weekStartDate }) => {
      invalidateScheduleQueries(queryClient, restaurantId, weekStartDate);
      toast({
        title: 'Employee unassigned',
        description: 'The employee has been removed from the shift slot.',
      });
    },
    onError: (error: Error) => showErrorToast(toast, 'Error unassigning employee', error),
  });
}

// ---------------------------------------------------------------------------
// Mutation: delete generated schedule for a week (RPC)
// ---------------------------------------------------------------------------

export function useDeleteGeneratedSchedule() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({
      restaurantId,
      weekStartDate,
    }: {
      restaurantId: string;
      weekStartDate: string;
    }) => {
      const { data, error } = await supabase.rpc('delete_generated_schedule', {
        p_restaurant_id: restaurantId,
        p_week_start_date: weekStartDate,
      });

      if (error) throw error;
      return { data, restaurantId, weekStartDate };
    },
    onSuccess: ({ restaurantId, weekStartDate }) => {
      invalidateScheduleQueries(queryClient, restaurantId, weekStartDate);
      toast({
        title: 'Schedule deleted',
        description: 'All generated shifts and slots for this week have been removed.',
      });
    },
    onError: (error: Error) => showErrorToast(toast, 'Error deleting schedule', error),
  });
}
