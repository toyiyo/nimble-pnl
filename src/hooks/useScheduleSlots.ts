import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import { supabase } from '@/integrations/supabase/client';

import { useToast } from '@/hooks/use-toast';

import { ScheduleSlot } from '@/types/scheduling';

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
      queryClient.invalidateQueries({ queryKey: ['schedule-slots', restaurantId, weekStartDate] });
      queryClient.invalidateQueries({ queryKey: ['shifts'] });
      toast({
        title: 'Schedule generated',
        description: 'Shifts and schedule slots have been created from the template.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error generating schedule',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
}

// ---------------------------------------------------------------------------
// Mutation: assign an employee to a schedule slot
// ---------------------------------------------------------------------------

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
    }: {
      slotId: string;
      shiftId: string | null;
      employeeId: string;
      restaurantId: string;
      weekStartDate: string;
    }) => {
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

        if (shiftError) throw shiftError;
      }

      return { slotId, restaurantId, weekStartDate };
    },
    onSuccess: ({ restaurantId, weekStartDate }) => {
      queryClient.invalidateQueries({ queryKey: ['schedule-slots', restaurantId, weekStartDate] });
      queryClient.invalidateQueries({ queryKey: ['shifts'] });
      toast({
        title: 'Employee assigned',
        description: 'The employee has been assigned to the shift slot.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error assigning employee',
        description: error.message,
        variant: 'destructive',
      });
    },
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

        if (shiftError) throw shiftError;
      }

      return { slotId, restaurantId, weekStartDate };
    },
    onSuccess: ({ restaurantId, weekStartDate }) => {
      queryClient.invalidateQueries({ queryKey: ['schedule-slots', restaurantId, weekStartDate] });
      queryClient.invalidateQueries({ queryKey: ['shifts'] });
      toast({
        title: 'Employee unassigned',
        description: 'The employee has been removed from the shift slot.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error unassigning employee',
        description: error.message,
        variant: 'destructive',
      });
    },
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
      queryClient.invalidateQueries({ queryKey: ['schedule-slots', restaurantId, weekStartDate] });
      queryClient.invalidateQueries({ queryKey: ['shifts'] });
      toast({
        title: 'Schedule deleted',
        description: 'All generated shifts and slots for this week have been removed.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error deleting schedule',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
}
