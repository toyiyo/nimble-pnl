import { useMutation, useQueryClient } from '@tanstack/react-query';

import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import type { TemplateInsert } from '@/lib/staffingApply';

const CHUNK = 200;

/**
 * Upserts an array of shift_templates rows (from shiftBlocksToTemplates) using
 * ON CONFLICT DO NOTHING so re-applying the same week is a safe no-op.
 *
 * Returns `{ created, skipped }` counts used to populate the success toast.
 * Invalidates the three query keys that surface open/template shifts in the UI.
 */
export function useApplySuggestedShifts(restaurantId: string | null) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const mutation = useMutation({
    mutationFn: async (rows: TemplateInsert[]) => {
      let created = 0;

      for (let i = 0; i < rows.length; i += CHUNK) {
        const chunk = rows.slice(i, i + CHUNK);

        // ignoreDuplicates: true generates `ON CONFLICT DO NOTHING` (no column target),
        // which works with the partial unique index (uq_shift_templates_active_slot).
        // We omit onConflict here because PostgREST requires the partial predicate
        // (WHERE is_active = true) to be part of the target, which supabase-js v2
        // does not support in the onConflict option. A bare DO NOTHING is equivalent
        // and safe: it ignores violations of ANY unique constraint, including ours.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (supabase.from('shift_templates') as any)
          .upsert(chunk, { ignoreDuplicates: true })
          .select('id');

        if (error) throw error;
        created += data?.length ?? 0;
      }

      return { created, skipped: rows.length - created };
    },

    onSettled: () => {
      // Invalidate on settle (success OR error): the upsert persists chunks
      // incrementally, so a later chunk failing still leaves earlier chunks
      // written — caches must refresh regardless of overall outcome.
      queryClient.invalidateQueries({ queryKey: ['shift_templates', restaurantId] });
      queryClient.invalidateQueries({ queryKey: ['open_shifts', restaurantId] });
      queryClient.invalidateQueries({ queryKey: ['shifts', restaurantId] });
    },

    onSuccess: ({ created, skipped }) => {
      toast({
        title: `${created} open shift${created === 1 ? '' : 's'} created`,
        description:
          skipped > 0
            ? `${skipped} already existed and were skipped.`
            : undefined,
      });
    },

    onError: (error: Error) => {
      // Log full error (may contain schema details from PostgREST) and show generic message
      console.error('[useApplySuggestedShifts] failed to apply suggestions:', error);
      toast({
        title: 'Could not apply suggestions',
        description: 'Something went wrong. Please try again.',
        variant: 'destructive',
      });
    },
  });

  return {
    applyShifts: mutation.mutateAsync,
    isApplying: mutation.isPending,
  };
}
