import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import { supabase } from '@/integrations/supabase/client';

import { useToast } from '@/hooks/use-toast';

import { WeekTemplate, WeekTemplateSlot } from '@/types/scheduling';

// ---------------------------------------------------------------------------
// Query: fetch all week templates for a restaurant
// ---------------------------------------------------------------------------

export function useWeekTemplates(restaurantId: string | null) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['week-templates', restaurantId],
    queryFn: async () => {
      if (!restaurantId) return [];

      const { data, error } = await supabase
        .from('week_templates')
        .select('id, restaurant_id, name, description, is_active, created_at, updated_at')
        .eq('restaurant_id', restaurantId)
        .order('name');

      if (error) throw error;
      return data as WeekTemplate[];
    },
    enabled: !!restaurantId,
    staleTime: 30000,
    refetchOnWindowFocus: true,
  });

  return {
    templates: data || [],
    isLoading,
    error,
  };
}

// ---------------------------------------------------------------------------
// Mutation: create a week template
// ---------------------------------------------------------------------------

type CreateWeekTemplateInput = Omit<WeekTemplate, 'id' | 'created_at' | 'updated_at'>;

export function useCreateWeekTemplate() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (input: CreateWeekTemplateInput) => {
      const { data, error } = await supabase
        .from('week_templates')
        .insert(input)
        .select()
        .single();

      if (error) throw error;
      return data as WeekTemplate;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['week-templates', data.restaurant_id] });
      toast({
        title: 'Week template created',
        description: `"${data.name}" has been added.`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error creating week template',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
}

// ---------------------------------------------------------------------------
// Mutation: update a week template
// ---------------------------------------------------------------------------

export function useUpdateWeekTemplate() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<WeekTemplate> & { id: string }) => {
      const { data, error } = await supabase
        .from('week_templates')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return data as WeekTemplate;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['week-templates', data.restaurant_id] });
      toast({
        title: 'Week template updated',
        description: `"${data.name}" has been updated.`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error updating week template',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
}

// ---------------------------------------------------------------------------
// Mutation: delete a week template
// ---------------------------------------------------------------------------

export function useDeleteWeekTemplate() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id, restaurantId }: { id: string; restaurantId: string }) => {
      const { error } = await supabase
        .from('week_templates')
        .delete()
        .eq('id', id);

      if (error) throw error;
      return { id, restaurantId };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['week-templates', data.restaurantId] });
      toast({
        title: 'Week template deleted',
        description: 'The week template has been removed.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error deleting week template',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
}

// ---------------------------------------------------------------------------
// Mutation: set active template (deactivate all, then activate selected)
// ---------------------------------------------------------------------------

export function useSetActiveTemplate() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id, restaurantId }: { id: string; restaurantId: string }) => {
      // Deactivate all templates for this restaurant
      const { error: deactivateError } = await supabase
        .from('week_templates')
        .update({ is_active: false })
        .eq('restaurant_id', restaurantId);

      if (deactivateError) throw deactivateError;

      // Activate the selected template
      const { data, error } = await supabase
        .from('week_templates')
        .update({ is_active: true })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return data as WeekTemplate;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['week-templates', data.restaurant_id] });
      toast({
        title: 'Active template updated',
        description: `"${data.name}" is now the active template.`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error setting active template',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
}

// ---------------------------------------------------------------------------
// Query: fetch slots for a week template (with joined shift_template data)
// ---------------------------------------------------------------------------

export function useWeekTemplateSlots(weekTemplateId: string | null) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['week-template-slots', weekTemplateId],
    queryFn: async () => {
      if (!weekTemplateId) return [];

      const { data, error } = await supabase
        .from('week_template_slots')
        .select('id, week_template_id, shift_template_id, day_of_week, position, headcount, sort_order, created_at, updated_at, shift_template:shift_templates(id, restaurant_id, name, day_of_week, start_time, end_time, break_duration, position, is_active, color, description, created_at, updated_at)')
        .eq('week_template_id', weekTemplateId)
        .order('day_of_week')
        .order('sort_order');

      if (error) throw error;
      return data as unknown as WeekTemplateSlot[];
    },
    enabled: !!weekTemplateId,
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
// Mutation: add a slot to a week template
// ---------------------------------------------------------------------------

type AddTemplateSlotInput = Omit<WeekTemplateSlot, 'id' | 'created_at' | 'updated_at' | 'shift_template'>;

export function useAddTemplateSlot() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (input: AddTemplateSlotInput) => {
      const { data, error } = await supabase
        .from('week_template_slots')
        .insert(input)
        .select()
        .single();

      if (error) throw error;
      return data as WeekTemplateSlot;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['week-template-slots', data.week_template_id] });
      toast({
        title: 'Slot added',
        description: 'A new shift slot has been added to the template.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error adding slot',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
}

// ---------------------------------------------------------------------------
// Mutation: update a template slot (headcount, position, etc.)
// ---------------------------------------------------------------------------

export function useUpdateTemplateSlot() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({
      id,
      weekTemplateId,
      ...updates
    }: { id: string; weekTemplateId: string } & Partial<Pick<WeekTemplateSlot, 'headcount' | 'position' | 'sort_order' | 'day_of_week' | 'shift_template_id'>>) => {
      const { data, error } = await supabase
        .from('week_template_slots')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return { ...data, weekTemplateId } as WeekTemplateSlot & { weekTemplateId: string };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['week-template-slots', data.weekTemplateId] });
      toast({
        title: 'Slot updated',
        description: 'The shift slot has been updated.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error updating slot',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
}

// ---------------------------------------------------------------------------
// Mutation: remove a slot from a week template
// ---------------------------------------------------------------------------

export function useRemoveTemplateSlot() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id, weekTemplateId }: { id: string; weekTemplateId: string }) => {
      const { error } = await supabase
        .from('week_template_slots')
        .delete()
        .eq('id', id);

      if (error) throw error;
      return { id, weekTemplateId };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['week-template-slots', data.weekTemplateId] });
      toast({
        title: 'Slot removed',
        description: 'The shift slot has been removed from the template.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error removing slot',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
}
