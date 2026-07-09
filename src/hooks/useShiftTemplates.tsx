import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';

import { supabase } from '@/integrations/supabase/client';

import { useToast } from '@/hooks/use-toast';
import { ToastAction } from '@/components/ui/toast';

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

/** Builds the "N assigned shift(s) kept" description for the hide toast. */
function keptShiftDescription(keptShiftCount: number): string {
  if (keptShiftCount === 0) return 'Assigned shifts are kept';
  if (keptShiftCount === 1) return '1 assigned shift kept';
  return `${keptShiftCount} assigned shifts kept`;
}

// ---------------------------------------------------------------------------
// The hook
// ---------------------------------------------------------------------------

export type TemplateStatusFilter = 'active' | 'inactive' | 'all';

interface UseShiftTemplatesOptions {
  status?: TemplateStatusFilter;
}

type TemplateInput = Omit<ShiftTemplate, 'id' | 'created_at' | 'updated_at'>;

interface HideTemplateInput {
  id: string;
  name: string;
  keptShiftCount: number;
}

export function useShiftTemplates(
  restaurantId: string | null,
  options: UseShiftTemplatesOptions = {},
) {
  const { status = 'active' } = options;
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data, isLoading, error } = useQuery({
    queryKey: ['shift_templates', restaurantId, status],
    queryFn: async () => {
      if (!restaurantId) return [];
      // Generated types may not have the `days` column yet (migration ahead of codegen),
      // so we cast to `any` for the query and type the result manually.
      let query = (supabase
        .from('shift_templates') as any)
        .select('*')
        .eq('restaurant_id', restaurantId);

      if (status === 'active') {
        query = query.eq('is_active', true);
      } else if (status === 'inactive') {
        query = query.eq('is_active', false);
      }
      // 'all' = no is_active filter

      const { data, error } = await query.order('start_time');
      if (error) throw error;
      return data as ShiftTemplate[];
    },
    enabled: !!restaurantId,
    staleTime: 30000,
    refetchOnWindowFocus: true,
  });

  const invalidateAllStatuses = () => {
    queryClient.invalidateQueries({ queryKey: ['shift_templates', restaurantId] });
  };

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
      invalidateAllStatuses();
      toast({ title: 'Template created', description: 'Shift template has been added.' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, ...updates }: Partial<ShiftTemplate> & { id: string }) => {
      let query = (supabase
        .from('shift_templates') as any)
        .update(updates)
        .eq('id', id);
      if (restaurantId) {
        query = query.eq('restaurant_id', restaurantId);
      }
      const { data, error } = await query.select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      invalidateAllStatuses();
      toast({ title: 'Template updated' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  const restoreMutation = useMutation({
    mutationFn: async (id: string) => {
      let query = (supabase
        .from('shift_templates') as any)
        .update({ is_active: true })
        .eq('id', id);
      if (restaurantId) {
        query = query.eq('restaurant_id', restaurantId);
      }
      const { error } = await query;
      if (error) throw error;
    },
    onSuccess: () => {
      invalidateAllStatuses();
      toast({ title: 'Template restored' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  const hideMutation = useMutation({
    mutationFn: async ({ id }: HideTemplateInput) => {
      let query = (supabase
        .from('shift_templates') as any)
        .update({ is_active: false })
        .eq('id', id);
      if (restaurantId) {
        query = query.eq('restaurant_id', restaurantId);
      }
      const { error } = await query;
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      invalidateAllStatuses();
      const { id, name, keptShiftCount } = variables;
      toast({
        title: `"${name}" hidden`,
        description: keptShiftDescription(keptShiftCount),
        duration: 8000,
        action: (
          <ToastAction
            altText={`Undo hiding ${name}`}
            onClick={() => restoreMutation.mutate(id)}
          >
            Undo
          </ToastAction>
        ),
      });
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
    hideTemplate: hideMutation.mutateAsync,
    restoreTemplate: restoreMutation.mutateAsync,
  };
}
