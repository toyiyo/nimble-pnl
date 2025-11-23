import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { ShiftTemplate } from '@/types/scheduling';
import { useToast } from '@/hooks/use-toast';

export const useShiftTemplates = (restaurantId: string | null) => {
  const { toast } = useToast();

  const { data, isLoading, error } = useQuery({
    queryKey: ['shiftTemplates', restaurantId],
    queryFn: async () => {
      if (!restaurantId) return [];

      const { data, error } = await supabase
        .from('shift_templates')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .eq('is_active', true)
        .order('day_of_week')
        .order('start_time');

      if (error) throw error;
      return data as ShiftTemplate[];
    },
    enabled: !!restaurantId,
    staleTime: 30000, // 30 seconds
    refetchOnWindowFocus: true,
    refetchOnMount: true,
  });

  return {
    templates: data || [],
    loading: isLoading,
    error,
  };
};

export const useCreateShiftTemplate = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (template: Omit<ShiftTemplate, 'id' | 'created_at' | 'updated_at'>) => {
      const { data, error } = await supabase
        .from('shift_templates')
        .insert(template)
        .select()
        .single();

      if (error) throw error;
      return data as ShiftTemplate;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['shiftTemplates', data.restaurant_id] });
      toast({
        title: 'Template created',
        description: 'The shift template has been created successfully.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error creating template',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
};

export const useUpdateShiftTemplate = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<ShiftTemplate> & { id: string }) => {
      const { data, error } = await supabase
        .from('shift_templates')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return data as ShiftTemplate;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['shiftTemplates', data.restaurant_id] });
      toast({
        title: 'Template updated',
        description: 'The shift template has been updated.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error updating template',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
};

export const useDeleteShiftTemplate = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id, restaurantId }: { id: string; restaurantId: string }) => {
      const { error } = await supabase
        .from('shift_templates')
        .delete()
        .eq('id', id);

      if (error) throw error;
      return { id, restaurantId };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['shiftTemplates', data.restaurantId] });
      toast({
        title: 'Template deleted',
        description: 'The shift template has been removed.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error deleting template',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
};

export const useApplyTemplateToWeek = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ 
      templateId, 
      weekStartDate, 
      restaurantId,
      employeeId,
    }: { 
      templateId: string; 
      weekStartDate: Date;
      restaurantId: string;
      employeeId: string;
    }) => {
      // Get the template
      const { data: template, error: templateError } = await supabase
        .from('shift_templates')
        .select('*')
        .eq('id', templateId)
        .single();

      if (templateError) throw templateError;

      // Calculate the date for this shift based on template's day_of_week
      const shiftDate = new Date(weekStartDate);
      shiftDate.setDate(shiftDate.getDate() + template.day_of_week);

      // Parse time strings and create full datetime
      const [startHours, startMinutes] = template.start_time.split(':').map(Number);
      const [endHours, endMinutes] = template.end_time.split(':').map(Number);

      const startTime = new Date(shiftDate);
      startTime.setHours(startHours, startMinutes, 0, 0);

      const endTime = new Date(shiftDate);
      endTime.setHours(endHours, endMinutes, 0, 0);

      // Create the shift
      const { data, error } = await supabase
        .from('shifts')
        .insert({
          restaurant_id: restaurantId,
          employee_id: employeeId,
          start_time: startTime.toISOString(),
          end_time: endTime.toISOString(),
          break_duration: template.break_duration,
          position: template.position,
          status: 'scheduled',
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['shifts', data.restaurant_id] });
      toast({
        title: 'Template applied',
        description: 'Shift created from template successfully.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error applying template',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
};

export const useCopyPreviousWeek = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ 
      restaurantId, 
      targetWeekStart,
    }: { 
      restaurantId: string;
      targetWeekStart: Date;
    }) => {
      // Calculate previous week start
      const previousWeekStart = new Date(targetWeekStart);
      previousWeekStart.setDate(previousWeekStart.getDate() - 7);
      
      const previousWeekEnd = new Date(previousWeekStart);
      previousWeekEnd.setDate(previousWeekEnd.getDate() + 6);
      previousWeekEnd.setHours(23, 59, 59, 999);

      // Fetch previous week's shifts
      const { data: previousShifts, error: fetchError } = await supabase
        .from('shifts')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .gte('start_time', previousWeekStart.toISOString())
        .lte('start_time', previousWeekEnd.toISOString());

      if (fetchError) throw fetchError;

      if (!previousShifts || previousShifts.length === 0) {
        throw new Error('No shifts found in previous week');
      }

      // Create new shifts for the target week
      const newShifts = previousShifts.map(shift => {
        const startTime = new Date(shift.start_time);
        const endTime = new Date(shift.end_time);
        
        // Add 7 days to move to target week
        startTime.setDate(startTime.getDate() + 7);
        endTime.setDate(endTime.getDate() + 7);

        return {
          restaurant_id: shift.restaurant_id,
          employee_id: shift.employee_id,
          start_time: startTime.toISOString(),
          end_time: endTime.toISOString(),
          break_duration: shift.break_duration,
          position: shift.position,
          status: 'scheduled',
          notes: shift.notes,
        };
      });

      const { data, error } = await supabase
        .from('shifts')
        .insert(newShifts)
        .select();

      if (error) throw error;
      return data;
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['shifts', variables.restaurantId] });
      toast({
        title: 'Week copied',
        description: `${data.length} shifts copied from previous week.`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error copying week',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
};
