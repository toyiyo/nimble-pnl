import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import { supabase } from '@/integrations/supabase/client';

import { useToast } from '@/hooks/use-toast';

import { ShiftTemplate } from '@/types/scheduling';

import { showErrorToast } from '@/hooks/scheduling-helpers';

// ---------------------------------------------------------------------------
// Query: fetch all shift definitions (shift_templates) for a restaurant
// ---------------------------------------------------------------------------

export function useShiftDefinitions(restaurantId: string | null) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['shift-definitions', restaurantId],
    queryFn: async () => {
      if (!restaurantId) return [];

      const { data, error } = await supabase
        .from('shift_templates')
        .select('id, restaurant_id, name, day_of_week, start_time, end_time, break_duration, position, is_active, color, description, created_at, updated_at')
        .eq('restaurant_id', restaurantId)
        .order('name');

      if (error) throw error;
      return data as ShiftTemplate[];
    },
    enabled: !!restaurantId,
    staleTime: 30000,
    refetchOnWindowFocus: true,
  });

  return {
    definitions: data || [],
    isLoading,
    error,
  };
}

// ---------------------------------------------------------------------------
// Mutation: create a shift definition
// ---------------------------------------------------------------------------

type CreateShiftDefinitionInput = Omit<ShiftTemplate, 'id' | 'created_at' | 'updated_at'>;

export function useCreateShiftDefinition() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (input: CreateShiftDefinitionInput) => {
      const { data, error } = await supabase
        .from('shift_templates')
        .insert(input)
        .select()
        .single();

      if (error) throw error;
      return data as ShiftTemplate;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['shift-definitions', data.restaurant_id] });
      toast({
        title: 'Shift definition created',
        description: `"${data.name}" has been added.`,
      });
    },
    onError: (error: Error) => showErrorToast(toast, 'Error creating shift definition', error),
  });
}

// ---------------------------------------------------------------------------
// Mutation: update a shift definition
// ---------------------------------------------------------------------------

export function useUpdateShiftDefinition() {
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
      queryClient.invalidateQueries({ queryKey: ['shift-definitions', data.restaurant_id] });
      toast({
        title: 'Shift definition updated',
        description: `"${data.name}" has been updated.`,
      });
    },
    onError: (error: Error) => showErrorToast(toast, 'Error updating shift definition', error),
  });
}

// ---------------------------------------------------------------------------
// Mutation: delete a shift definition
// ---------------------------------------------------------------------------

export function useDeleteShiftDefinition() {
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
      queryClient.invalidateQueries({ queryKey: ['shift-definitions', data.restaurantId] });
      toast({
        title: 'Shift definition deleted',
        description: 'The shift definition has been removed.',
      });
    },
    onError: (error: Error) => showErrorToast(toast, 'Error deleting shift definition', error),
  });
}
