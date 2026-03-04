import { useMutation, useQueryClient } from '@tanstack/react-query';

import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { getWeekEnd } from '@/hooks/useShiftPlanner';
import { buildCopyPayload } from '@/lib/copyWeekShifts';

import type { Shift } from '@/types/scheduling';

interface CopyWeekParams {
  sourceShifts: Shift[];
  sourceMonday: Date;
  targetMonday: Date;
  restaurantId: string;
}

interface CopyWeekResult {
  copiedCount: number;
  deletedCount: number;
}

export function useCopyWeekShifts() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({
      sourceShifts,
      sourceMonday,
      targetMonday,
      restaurantId,
    }: CopyWeekParams): Promise<CopyWeekResult> => {
      const inserts = buildCopyPayload(sourceShifts, sourceMonday, targetMonday, restaurantId);

      if (inserts.length === 0) {
        throw new Error('No shifts to copy. The source week has no active shifts.');
      }

      const targetEnd = getWeekEnd(targetMonday);

      // Atomic: delete target-week unlocked shifts + insert new ones in one transaction
      const { data, error } = await supabase.rpc('copy_week_shifts', {
        p_restaurant_id: restaurantId,
        p_target_start: targetMonday.toISOString(),
        p_target_end: targetEnd.toISOString(),
        p_shifts: inserts,
      });

      if (error) throw error;

      return {
        copiedCount: (data as any)?.copied_count ?? inserts.length,
        deletedCount: (data as any)?.deleted_count ?? 0,
      };
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['shifts'] });
      queryClient.invalidateQueries({ queryKey: ['employees'] });

      const targetEnd = getWeekEnd(variables.targetMonday);
      const fmt = (d: Date) =>
        d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

      toast({
        title: 'Schedule copied',
        description: `${data.copiedCount} shifts copied to ${fmt(variables.targetMonday)} – ${fmt(targetEnd)}.`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Failed to copy schedule',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
}
