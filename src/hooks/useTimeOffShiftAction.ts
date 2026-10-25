import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { invalidateShiftTradeQueries, sendShiftTradeNotification } from '@/hooks/useShiftTrades';

/**
 * One choice for all the shifts in an approved time-off request:
 * post each shift for trade (with a note) or delete each shift.
 */
export type TimeOffShiftAction =
  | { kind: 'trade'; note: string }
  | { kind: 'delete' };

export interface ShiftActionSummary {
  done: number;
  skipped: number;
  failed: number;
}

export interface ApplyTimeOffShiftActionInput {
  restaurantId: string;
  employeeId: string;
  shiftIds: string[];
  action: TimeOffShiftAction;
}

type ShiftOutcome = 'done' | 'skipped';

export const DEFAULT_TRADE_NOTE = 'Approved PTO';
const ACTIVE_TRADE_MESSAGE = 'This shift already has an active trade';

export function tradeNote(note: string): string {
  return note.trim() || DEFAULT_TRADE_NOTE;
}

export function summarizeShiftResults(
  results: PromiseSettledResult<ShiftOutcome>[]
): ShiftActionSummary {
  const summary: ShiftActionSummary = { done: 0, skipped: 0, failed: 0 };
  for (const result of results) {
    if (result.status === 'rejected') summary.failed += 1;
    else summary[result.value] += 1;
  }
  return summary;
}

export const shiftCount = (n: number) => `${n} ${n === 1 ? 'shift' : 'shifts'}`;

/** Toast for a shift action that threw after the approval was saved. */
export const TIME_OFF_SHIFT_ERROR_TOAST = {
  title: 'Shifts not changed',
  description: 'The request is approved. Change the shifts from the schedule.',
  variant: 'destructive' as const,
};

export function timeOffShiftToastText(
  action: TimeOffShiftAction,
  summary: ShiftActionSummary
): { title: string; description: string; variant?: 'destructive' } {
  const isTrade = action.kind === 'trade';
  const parts = [`${shiftCount(summary.done)} ${isTrade ? 'posted for trade' : 'deleted'}.`];
  if (summary.skipped > 0) {
    const verb = summary.skipped === 1 ? 'is' : 'are';
    parts.push(
      isTrade
        ? `${shiftCount(summary.skipped)} ${verb} already on the trade board.`
        : `${shiftCount(summary.skipped)} ${verb} already gone.`
    );
  }
  if (summary.failed > 0) {
    const pronoun = summary.failed === 1 ? 'it' : 'them';
    parts.push(
      `${shiftCount(summary.failed)} failed. ${isTrade ? 'Post' : 'Delete'} ${pronoun} from the schedule.`
    );
  }
  const description = parts.join(' ');
  if (summary.failed > 0) {
    return {
      title: isTrade ? 'Some shifts were not posted' : 'Some shifts were not deleted',
      description,
      variant: 'destructive',
    };
  }
  if (summary.done === 0) return { title: 'No shifts changed', description };
  return { title: isTrade ? 'Shifts posted for trade' : 'Shifts deleted', description };
}

async function postShiftForTrade(
  restaurantId: string,
  employeeId: string,
  shiftId: string,
  note: string
): Promise<ShiftOutcome> {
  const { data, error } = await supabase.rpc('create_shift_trade_for_employee', {
    p_restaurant_id: restaurantId,
    p_offered_shift_id: shiftId,
    p_offered_by_employee_id: employeeId,
    p_target_employee_id: null,
    p_reason: tradeNote(note),
  });
  if (error) {
    if (error.message?.includes(ACTIVE_TRADE_MESSAGE)) return 'skipped';
    throw error;
  }
  await sendShiftTradeNotification(data as string, 'created');
  return 'done';
}

async function deleteShift(
  restaurantId: string,
  employeeId: string,
  shiftId: string
): Promise<ShiftOutcome> {
  // The employee_id filter stops a delete of a shift that moved to a
  // different employee after the fetch. A delete that RLS filters, or a
  // shift that is already gone, returns error:null with zero rows.
  const { data, error } = await supabase
    .from('shifts')
    .delete()
    .eq('id', shiftId)
    .eq('restaurant_id', restaurantId)
    .eq('employee_id', employeeId)
    .select('id');
  if (error) throw error;
  return (data?.length ?? 0) > 0 ? 'done' : 'skipped';
}

/**
 * Applies one TimeOffShiftAction to every shift. One failure does not
 * stop the others (Promise.allSettled). Shows one summary toast.
 */
export function useApplyTimeOffShiftAction() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({
      restaurantId,
      employeeId,
      shiftIds,
      action,
    }: ApplyTimeOffShiftActionInput): Promise<ShiftActionSummary> => {
      const results = await Promise.allSettled(
        shiftIds.map((shiftId) =>
          action.kind === 'trade'
            ? postShiftForTrade(restaurantId, employeeId, shiftId, action.note)
            : deleteShift(restaurantId, employeeId, shiftId)
        )
      );
      return summarizeShiftResults(results);
    },
    onSuccess: (summary, { restaurantId, action }) => {
      queryClient.invalidateQueries({ queryKey: ['shifts', restaurantId] });
      queryClient.invalidateQueries({ queryKey: ['timeoff-coverage-impact'] });
      invalidateShiftTradeQueries(queryClient);
      toast(timeOffShiftToastText(action, summary));
    },
  });
}
