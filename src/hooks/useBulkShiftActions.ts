import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { supabase } from '@/integrations/supabase/client';

import { useToast } from '@/hooks/use-toast';
import { buildShiftChangeDescription } from '@/hooks/useShifts';

interface BulkDeleteResult {
  deletedCount: number;
  lockedCount: number;
}

interface BulkEditResult {
  updatedCount: number;
  lockedCount: number;
}

/**
 * Fetch locked status for a batch of shift IDs.
 * Returns the subset of IDs that are unlocked plus a count of locked ones.
 */
async function partitionByLocked(
  shiftIds: string[],
  restaurantId: string,
): Promise<{ unlockedIds: string[]; lockedCount: number }> {
  const { data, error } = await supabase
    .from('shifts')
    .select('id, locked')
    .eq('restaurant_id', restaurantId)
    .in('id', shiftIds);

  if (error) throw error;

  const rows = data ?? [];
  const unlockedIds = rows.filter((r) => !r.locked).map((r) => r.id);
  const lockedCount = rows.filter((r) => r.locked).length;

  return { unlockedIds, lockedCount };
}

export function useBulkShiftActions(restaurantId: string) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const bulkDelete = useCallback(
    async (shiftIds: string[]): Promise<BulkDeleteResult> => {
      const { error } = await supabase
        .from('shifts')
        .delete()
        .in('id', shiftIds)
        .eq('restaurant_id', restaurantId);

      if (error) throw error;

      queryClient.invalidateQueries({ queryKey: ['shifts', restaurantId] });

      toast({
        title: 'Shifts deleted',
        description: `${shiftIds.length} shift${shiftIds.length !== 1 ? 's' : ''} deleted.`,
      });

      return { deletedCount: shiftIds.length, lockedCount: 0 };
    },
    [restaurantId, queryClient, toast],
  );

  const bulkEdit = useCallback(
    async (shiftIds: string[], changes: Record<string, unknown>): Promise<BulkEditResult> => {
      const { unlockedIds, lockedCount } = await partitionByLocked(shiftIds, restaurantId);

      if (unlockedIds.length === 0) {
        toast({
          title: 'No shifts updated',
          description: buildShiftChangeDescription(0, lockedCount, 'updated'),
        });
        return { updatedCount: 0, lockedCount };
      }

      const { error } = await supabase
        .from('shifts')
        .update(changes)
        .in('id', unlockedIds)
        .eq('locked', false);

      if (error) throw error;

      const updatedCount = unlockedIds.length;

      queryClient.invalidateQueries({ queryKey: ['shifts', restaurantId] });

      toast({
        title: 'Shifts updated',
        description: buildShiftChangeDescription(updatedCount, lockedCount, 'updated'),
      });

      return { updatedCount, lockedCount };
    },
    [restaurantId, queryClient, toast],
  );

  return { bulkDelete, bulkEdit };
}
