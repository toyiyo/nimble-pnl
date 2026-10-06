import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { buildTemplateSnapshot, buildShiftsFromTemplate } from '@/lib/schedulePlanTemplates';
import { getWeekEnd } from '@/hooks/useShiftPlanner';

import type { Json } from '@/integrations/supabase/types';
import type {
  Shift,
  SchedulePlanTemplate,
  ApplyTemplateResult,
  TemplateMergeMode,
  TemplateShiftSnapshot,
} from '@/types/scheduling';

/** Mirrors the limit in save_schedule_plan_template. */
export const MAX_SCHEDULE_PLAN_TEMPLATES = 20;

const TEMPLATE_COLUMNS = 'id, restaurant_id, name, shifts, shift_count, created_at, updated_at';

// Interfaces have no index signature, so TypeScript does not accept them as Json.
const toJson = (shifts: TemplateShiftSnapshot[]) => shifts as unknown as Json;

export function useSchedulePlanTemplates(restaurantId: string | null) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const queryKey = ['schedule-plan-templates', restaurantId];

  const { data: templates = [], isLoading, error, refetch } = useQuery({
    queryKey,
    queryFn: async () => {
      if (!restaurantId) return [];
      const { data, error } = await supabase
        .from('schedule_plan_templates')
        .select(TEMPLATE_COLUMNS)
        .eq('restaurant_id', restaurantId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data as unknown as SchedulePlanTemplate[];
    },
    enabled: !!restaurantId,
    staleTime: 30000,
  });

  const saveTemplate = useMutation({
    mutationFn: async ({ name, shifts, weekStart }: { name: string; shifts: Shift[]; weekStart: Date }) => {
      if (!restaurantId) throw new Error('No restaurant selected');
      const snapshot = buildTemplateSnapshot(shifts, weekStart);

      const { data, error } = await supabase.rpc('save_schedule_plan_template', {
        p_restaurant_id: restaurantId,
        p_name: name,
        p_shifts: toJson(snapshot),
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

  // createTemplate and updateTemplate share the same result handling.
  const draftSaveCallbacks = {
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey });
      toast({ title: 'Template saved' });
    },
    onError: (error: Error) => {
      toast({ title: 'Failed to save template', description: error.message, variant: 'destructive' });
    },
  };

  const createTemplate = useMutation({
    mutationFn: async ({ name, shifts }: { name: string; shifts: TemplateShiftSnapshot[] }): Promise<SchedulePlanTemplate> => {
      if (!restaurantId) throw new Error('No restaurant selected');

      const { data, error } = await supabase.rpc('save_schedule_plan_template', {
        p_restaurant_id: restaurantId,
        p_name: name,
        p_shifts: toJson(shifts),
      });

      if (error) throw error;
      // The RPC returns the full row, the same shape as the SELECT above.
      return data as unknown as SchedulePlanTemplate;
    },
    ...draftSaveCallbacks,
  });

  const updateTemplate = useMutation({
    mutationFn: async ({
      id, name, shifts, expectedUpdatedAt,
    }: {
      id: string; name: string; shifts: TemplateShiftSnapshot[]; expectedUpdatedAt: string;
    }): Promise<SchedulePlanTemplate> => {
      if (!restaurantId) throw new Error('No restaurant selected');

      // expectedUpdatedAt must be the raw string from the server. A JS Date
      // drops microseconds and the server compare then never matches.
      const { data, error } = await supabase.rpc('update_schedule_plan_template', {
        p_restaurant_id: restaurantId,
        p_template_id: id,
        p_name: name,
        p_shifts: toJson(shifts),
        p_expected_updated_at: expectedUpdatedAt,
      });

      if (error) throw error;
      return data as unknown as SchedulePlanTemplate;
    },
    ...draftSaveCallbacks,
  });

  const applyTemplate = useMutation({
    mutationFn: async ({
      template, targetMonday, mergeMode,
    }: {
      template: SchedulePlanTemplate; targetMonday: Date; mergeMode: TemplateMergeMode;
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
      queryClient.invalidateQueries({ queryKey: ['shifts', restaurantId] });
      queryClient.invalidateQueries({ queryKey: ['employees', restaurantId] });

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

      const { error } = await supabase.rpc('delete_schedule_plan_template', {
        p_restaurant_id: restaurantId,
        p_template_id: templateId,
      });

      if (error) throw error;
    },
    onSuccess: (_data, templateId) => {
      // Drop the row from the cache now. Until the refetch returns, a stale
      // copy could otherwise be selected again by the Week Templates tab.
      queryClient.setQueryData<SchedulePlanTemplate[]>(queryKey, (old) => old?.filter((t) => t.id !== templateId));
      void queryClient.invalidateQueries({ queryKey });
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
    refetch,
    saveTemplate,
    createTemplate,
    updateTemplate,
    applyTemplate,
    deleteTemplate,
  };
}
