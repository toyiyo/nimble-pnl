import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { buildTemplateSnapshot, buildShiftsFromTemplate } from '@/lib/schedulePlanTemplates';
import { getWeekEnd } from '@/hooks/useShiftPlanner';

import type { Shift, SchedulePlanTemplate, ApplyTemplateResult } from '@/types/scheduling';

export function useSchedulePlanTemplates(restaurantId: string | null) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const queryKey = ['schedule-plan-templates', restaurantId];

  const { data: templates = [], isLoading, error } = useQuery({
    queryKey,
    queryFn: async () => {
      if (!restaurantId) return [];
      const { data, error } = await supabase
        .from('schedule_plan_templates')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data as SchedulePlanTemplate[];
    },
    enabled: !!restaurantId,
    staleTime: 30000,
  });

  const saveTemplate = useMutation({
    mutationFn: async ({ name, shifts, weekStart }: { name: string; shifts: Shift[]; weekStart: Date }) => {
      if (!restaurantId) throw new Error('No restaurant selected');
      const snapshot = buildTemplateSnapshot(shifts, weekStart);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.rpc as any)('save_schedule_plan_template', {
        p_restaurant_id: restaurantId,
        p_name: name,
        p_shifts: snapshot,
      });

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      toast({ title: 'Template saved', description: 'Schedule saved as a reusable template.' });
    },
    onError: (error: Error) => {
      toast({ title: 'Failed to save template', description: error.message, variant: 'destructive' });
    },
  });

  const applyTemplate = useMutation({
    mutationFn: async ({
      template, targetMonday, mergeMode,
    }: {
      template: SchedulePlanTemplate; targetMonday: Date; mergeMode: 'replace' | 'merge';
    }): Promise<ApplyTemplateResult> => {
      if (!restaurantId) throw new Error('No restaurant selected');

      const shiftsPayload = buildShiftsFromTemplate(template.shifts, targetMonday, restaurantId);

      if (shiftsPayload.length === 0) {
        throw new Error('No valid shifts in template. All referenced employees may be inactive.');
      }

      const targetEnd = getWeekEnd(targetMonday);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.rpc as any)('apply_schedule_plan_template', {
        p_restaurant_id: restaurantId,
        p_target_start: targetMonday.toISOString(),
        p_target_end: targetEnd.toISOString(),
        p_shifts: shiftsPayload,
        p_merge_mode: mergeMode,
      });

      if (error) throw error;
      return data as unknown as ApplyTemplateResult;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['shifts'] });
      queryClient.invalidateQueries({ queryKey: ['employees'] });

      const parts: string[] = [];
      if (data.inserted_count > 0) parts.push(`${data.inserted_count} shifts created`);
      if (data.skipped_count > 0) parts.push(`${data.skipped_count} skipped`);
      if (data.deleted_count > 0) parts.push(`${data.deleted_count} replaced`);

      toast({ title: 'Template applied', description: parts.length > 0 ? parts.join(', ') + '.' : 'No changes made.' });
    },
    onError: (error: Error) => {
      toast({ title: 'Failed to apply template', description: error.message, variant: 'destructive' });
    },
  });

  const deleteTemplate = useMutation({
    mutationFn: async (templateId: string) => {
      if (!restaurantId) throw new Error('No restaurant selected');

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase.rpc as any)('delete_schedule_plan_template', {
        p_restaurant_id: restaurantId,
        p_template_id: templateId,
      });

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      toast({ title: 'Template deleted' });
    },
    onError: (error: Error) => {
      toast({ title: 'Failed to delete template', description: error.message, variant: 'destructive' });
    },
  });

  return {
    templates,
    isLoading,
    error,
    saveTemplate,
    applyTemplate,
    deleteTemplate,
  };
}
