import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';

import { supabase } from '@/integrations/supabase/client';

import { useToast } from '@/hooks/use-toast';

import type { ShiftTemplate } from '@/types/scheduling';

// ---------------------------------------------------------------------------
// Pure helpers (exported for testing)
// ---------------------------------------------------------------------------

/** Convert JS Date.getDay() value to template day_of_week (same mapping: 0=Sun). */
export function jsDateToDayOfWeek(jsDay: number): number {
  return jsDay;
}

/** Check if a template applies to a given YYYY-MM-DD date string. */
export function templateAppliesToDay(
  template: Pick<ShiftTemplate, 'days'>,
  dateStr: string,
): boolean {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const dayOfWeek = jsDateToDayOfWeek(date.getDay());
  return template.days.includes(dayOfWeek);
}

// ---------------------------------------------------------------------------
// The hook
// ---------------------------------------------------------------------------

type TemplateInput = Omit<ShiftTemplate, 'id' | 'created_at' | 'updated_at'>;

export function useShiftTemplates(restaurantId: string | null) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data, isLoading, error } = useQuery({
    queryKey: ['shift_templates', restaurantId],
    queryFn: async () => {
      if (!restaurantId) return [];
      // Generated types may not have the `days` column yet (migration ahead of codegen),
      // so we cast to `any` for the query and type the result manually.
      const { data, error } = await (supabase
        .from('shift_templates') as any)
        .select('*')
        .eq('restaurant_id', restaurantId)
        .eq('is_active', true)
        .order('start_time');
      if (error) throw error;
      return data as ShiftTemplate[];
    },
    enabled: !!restaurantId,
    staleTime: 30000,
    refetchOnWindowFocus: true,
  });

  const createMutation = useMutation({
    mutationFn: async (input: TemplateInput) => {
      const { data, error } = await (supabase
        .from('shift_templates') as any)
        .insert(input)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shift_templates', restaurantId] });
      toast({ title: 'Template created', description: 'Shift template has been added.' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, ...updates }: Partial<ShiftTemplate> & { id: string }) => {
      const { data, error } = await (supabase
        .from('shift_templates') as any)
        .update(updates)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shift_templates', restaurantId] });
      toast({ title: 'Template updated' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase
        .from('shift_templates') as any)
        .update({ is_active: false })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shift_templates', restaurantId] });
      toast({ title: 'Template removed' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  return {
    templates: data || [],
    loading: isLoading,
    error,
    createTemplate: createMutation.mutateAsync,
    updateTemplate: updateMutation.mutateAsync,
    deleteTemplate: deleteMutation.mutateAsync,
  };
}
