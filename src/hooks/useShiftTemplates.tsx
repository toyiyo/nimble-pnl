import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';

import { supabase } from '@/integrations/supabase/client';

import { useToast } from '@/hooks/use-toast';
import { ToastAction } from '@/components/ui/toast';

import type { ShiftTemplate } from '@/types/scheduling';

import { pluralize } from '@/lib/scheduling/deletionCopy';
import { describeCascadeShortfall } from '@/lib/scheduling/hoursChangeCopy';

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

/**
 * Builds the "N pending claim(s) withdrawn" description for the delete toast.
 * Returns `undefined` when there's nothing to report (no pending claims affected).
 */
function pendingClaimsWithdrawnDescription(pendingClaimsCount: number): string | undefined {
  if (pendingClaimsCount === 0) return undefined;
  if (pendingClaimsCount === 1) return '1 pending claim withdrawn';
  return `${pendingClaimsCount} pending claims withdrawn`;
}

// ---------------------------------------------------------------------------
// The hook
// ---------------------------------------------------------------------------

export type TemplateStatusFilter = 'active' | 'inactive' | 'all';

interface UseShiftTemplatesOptions {
  status?: TemplateStatusFilter;
}

type TemplateInput = Omit<ShiftTemplate, 'id' | 'created_at' | 'updated_at'>;

/**
 * Every editable column, all required — deliberately NOT `Partial<ShiftTemplate>`.
 * `update_shift_template_with_cascade` takes the whole row positionally and has
 * no parameter defaults, so a partial payload does not update a subset: the
 * omitted keys drop out of the JSON body and PostgREST fails to resolve the
 * overload at all. A `Partial` signature would advertise a subset update that
 * cannot work.
 */
type UpdateTemplateInput = {
  id: string;
  name: string;
  position: string;
  area?: string | null;
  days: number[];
  break_duration: number;
  capacity: number;
  start_time: string;
  end_time: string;
  cascade?: boolean;
  driftedShiftIds?: string[];
  notify?: boolean;
  /** Ledger's totalAffected at the moment Save was clicked — used only to
   * detect a save-time shortfall, never sent to the RPC. */
  promisedCount?: number;
};

interface HideTemplateInput {
  id: string;
  name: string;
  keptShiftCount: number;
}

interface DeleteTemplateInput {
  id: string;
  name: string;
  /** Pending claims withdrawn by the cascade, surfaced in the confirmation toast. */
  pendingClaimsCount: number;
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

  // Shared by every mutation whose cascade RPC touches shift rows alongside
  // the template row (currently undo and update-with-cascade), so a
  // successful cascade always refreshes templates, shifts, and the
  // linked-shifts ledger together.
  const invalidateCascadeQueries = () => {
    invalidateAllStatuses();
    queryClient.invalidateQueries({ queryKey: ['shifts', restaurantId] });
    queryClient.invalidateQueries({ queryKey: ['template-linked-shifts', restaurantId] });
  };

  // Shared by every mutation below that has no special-cased error copy
  // (update-with-cascade is the one exception, since it maps a unique-index
  // violation to a friendlier message).
  const showErrorToast = (error: Error) => {
    toast({ title: 'Error', description: error.message, variant: 'destructive' });
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
    onError: showErrorToast,
  });

  const undoMutation = useMutation({
    mutationFn: async (batchId: string) => {
      if (!restaurantId) throw new Error('No restaurant selected');
      const { data, error } = await supabase.rpc('undo_template_hours_cascade', {
        p_batch_id: batchId,
        p_restaurant_id: restaurantId,
      });
      if (error) throw error;
      return data as {
        restored_count: number;
        changed_since_count: number;
        deleted_count: number;
        protected_count: number;
        template_restored: boolean;
        template_changed_since: boolean;
        template_slot_conflict: boolean;
      };
    },
    onSuccess: (result) => {
      invalidateCascadeQueries();

      const shiftsWord = pluralize(result.restored_count, 'shift', 'shifts');
      // The skip reasons are not interchangeable: "changed since" tells a
      // manager someone re-edited the shift and their edit was respected,
      // "deleted" tells them there is no shift left to restore, and "now
      // locked or started" tells them Undo declined on purpose rather than
      // failing. Summing any of them under one label misreports the others.
      const skippedReasons = [
        result.changed_since_count > 0 ? `${result.changed_since_count} changed since` : null,
        result.deleted_count > 0 ? `${result.deleted_count} deleted` : null,
        result.protected_count > 0 ? `${result.protected_count} now locked or started` : null,
        // Restoring the template is the expected case and is not narrated -- saying so
        // on every Undo would be noise. This is the case where the manager's mental
        // model and the data disagree, so it gets said out loud.
        result.template_changed_since ? 'template hours changed since' : null,
        // Not folded in with the line above: nobody edited this template, so
        // "changed since" would send the manager to inspect the wrong record.
        // Another active template now sits in the hours this one is trying to
        // return to, and that is the thing they have to resolve.
        result.template_slot_conflict
          ? 'template hours taken by another template'
          : null,
      ].filter(Boolean);
      toast({
        title: 'Cascade undone',
        description: skippedReasons.length > 0
          ? `Restored ${result.restored_count} ${shiftsWord} · skipped ${skippedReasons.join(', ')}`
          : `Restored ${result.restored_count} ${shiftsWord}.`,
      });
    },
    onError: showErrorToast,
  });

  const updateMutation = useMutation({
    mutationFn: async ({
      id,
      cascade = false,
      driftedShiftIds = [],
      notify = false,
      promisedCount = 0,
      ...updates
    }: UpdateTemplateInput) => {
      if (!restaurantId) throw new Error('No restaurant selected');

      // One RPC, not a client-side loop: the template row and the shift rows
      // land in the same transaction, so there is no window where one has
      // applied and the other has not — which is the whole complaint being
      // fixed here, under a different trigger.
      const { data, error } = await supabase.rpc('update_shift_template_with_cascade', {
        p_template_id: id,
        p_restaurant_id: restaurantId,
        p_name: updates.name,
        p_position: updates.position,
        p_area: updates.area ?? null,
        p_days: updates.days,
        p_break_duration: updates.break_duration,
        p_capacity: updates.capacity,
        p_start_time: updates.start_time,
        p_end_time: updates.end_time,
        p_cascade: cascade,
        p_drifted_shift_ids: driftedShiftIds,
      });
      if (error) throw error;

      const result = data as {
        batch_id: string | null;
        updated_count: number;
        published_shifts: Array<{
          id: string;
          previous_start_time: string;
          previous_end_time: string;
          previous_position: string;
        }>;
        skipped_count: number;
      };
      return { ...result, notify, promisedCount };
    },
    onSuccess: (result) => {
      invalidateCascadeQueries();

      // Fire-and-forget, one invoke per moved published shift. `invoke`
      // RESOLVES with { data, error } on HTTP failure rather than rejecting,
      // so both branches are handled and neither surfaces: the cascade already
      // succeeded, and a failed email must not read as a failed save.
      if (result.notify) {
        for (const s of result.published_shifts ?? []) {
          supabase.functions
            .invoke('send-shift-notification', {
              body: {
                shiftId: s.id,
                action: 'modified',
                previousShift: {
                  start_time: s.previous_start_time,
                  end_time: s.previous_end_time,
                  position: s.previous_position,
                },
              },
            })
            // Dev-only. A failed staff notification must not break the save
            // that already committed, but it must not ship console noise to
            // production either.
            .then(({ error }) => {
              if (error && import.meta.env.DEV) {
                console.warn('template-cascade notify failed', { shiftId: s.id, error });
              }
            })
            .catch((error) => {
              if (import.meta.env.DEV) {
                console.warn('template-cascade notify failed', { shiftId: s.id, error });
              }
            });
        }
      }

      if (result.updated_count === 0 || !result.batch_id) {
        // A cascading save that moved nothing still owes an explanation:
        // clicking "Save & update 3 shifts" and getting a bare "Template
        // updated" reads as if the shifts moved. No Undo action here — with
        // no batch id there is nothing to undo. `promisedCount` is 0 for a
        // template-only save, so the sentence stays absent for it.
        toast({
          title: 'Template updated',
          description: describeCascadeShortfall(result.promisedCount, result.updated_count),
        });
        return;
      }

      const batchId = result.batch_id;
      const baseDescription = `${result.updated_count} ${pluralize(result.updated_count, 'shift', 'shifts')} moved to the new hours.`;
      const shortfall = describeCascadeShortfall(result.promisedCount, result.updated_count);
      toast({
        title: 'Template updated',
        description: shortfall ? `${baseDescription} ${shortfall}` : baseDescription,
        action: (
          <ToastAction
            altText="Undo the shift hour changes"
            onClick={() => undoMutation.mutate(batchId)}
          >
            Undo
          </ToastAction>
        ),
        duration: 8000,
      });
    },
    // Widened (not `as any`) so the Postgres error code Supabase attaches to
    // the thrown error is visible here — `tsconfig.app.json` has
    // `strict: false`, so this narrow structural type is enough.
    onError: (error: Error & { code?: string }) => {
      const description = error.code === '23505'
        ? 'Another active template already uses these hours for this position. Pick a different time or position, or update that template instead.'
        : error.message;
      toast({ title: 'Error', description, variant: 'destructive' });
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
    onError: showErrorToast,
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
    onError: showErrorToast,
  });

  // Hard delete — irreversible cascade (open_shift_claims). No Undo action;
  // Hide (above) is the reversible alternative. `.select('id')` confirms the
  // row actually existed so a 0-row result reports "already removed" instead
  // of lying about success (this is a NEW hook with no sibling mocks, so it's
  // safe to add `.select()` here — contrast the shared delete-chain lesson).
  const deleteMutation = useMutation({
    mutationFn: async ({ id }: DeleteTemplateInput) => {
      if (!restaurantId) {
        throw new Error('Restaurant context is required to delete a template');
      }
      const { data, error } = await supabase
        .from('shift_templates')
        .delete()
        .eq('id', id)
        .eq('restaurant_id', restaurantId)
        .select('id');
      if (error) throw error;
      return { deletedCount: data?.length ?? 0 };
    },
    onSuccess: ({ deletedCount }, variables) => {
      const { name, pendingClaimsCount } = variables;
      if (deletedCount === 0) {
        toast({
          title: 'Template already removed',
          description: 'It looks like this template was already deleted.',
        });
        return;
      }
      invalidateAllStatuses();
      toast({
        title: `"${name}" deleted`,
        description: pendingClaimsWithdrawnDescription(pendingClaimsCount),
      });
    },
    onError: showErrorToast,
  });

  return {
    templates: data || [],
    loading: isLoading,
    error,
    createTemplate: createMutation.mutateAsync,
    updateTemplate: updateMutation.mutateAsync,
    isUndoingCascade: undoMutation.isPending,
    hideTemplate: hideMutation.mutateAsync,
    isHiding: hideMutation.isPending,
    restoreTemplate: restoreMutation.mutateAsync,
    deleteTemplate: deleteMutation.mutateAsync,
    isDeleting: deleteMutation.isPending,
  };
}
