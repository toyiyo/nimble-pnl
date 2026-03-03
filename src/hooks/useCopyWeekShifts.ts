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
      // 1. Build insert payloads from source shifts
      const inserts = buildCopyPayload(sourceShifts, sourceMonday, targetMonday, restaurantId);

      if (inserts.length === 0) {
        throw new Error('No shifts to copy. The source week has no active shifts.');
      }

      // 2. Delete existing non-locked shifts in target week
      const targetEnd = getWeekEnd(targetMonday);
      const { data: deletedData, error: deleteError } = await supabase
        .from('shifts')
        .delete()
        .eq('restaurant_id', restaurantId)
        .eq('locked', false)
        .gte('start_time', targetMonday.toISOString())
        .lte('start_time', targetEnd.toISOString())
        .select('id');

      if (deleteError) throw deleteError;

      // 3. Bulk insert cloned shifts (chunked at 500)
      const chunkSize = 500;
      let totalInserted = 0;

      for (let i = 0; i < inserts.length; i += chunkSize) {
        const chunk = inserts.slice(i, i + chunkSize);
        const { error: insertError } = await supabase
          .from('shifts')
          .insert(chunk);

        if (insertError) throw insertError;
        totalInserted += chunk.length;
      }

      return {
        copiedCount: totalInserted,
        deletedCount: deletedData?.length ?? 0,
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
