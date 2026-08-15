import { useCallback, useState } from 'react';

import { supabase } from '@/integrations/supabase/client';
import { PublishedShiftChangeDialog } from '@/components/scheduling/PublishedShiftChangeDialog';

export interface GuardShiftChangeOptions {
  shiftId: string;
  /** Name shown in the dialog. The caller already has it from the edited shift. */
  employeeName: string;
  /** Set on a reassignment. The dialog then names both employees. */
  secondEmployeeName?: string;
  run: (options: { allowPublished: boolean }) => void | Promise<void>;
}

interface PendingChange {
  employeeName: string;
  secondEmployeeName?: string;
  run: (options: { allowPublished: boolean }) => void | Promise<void>;
}

/**
 * One instance per page. Renders the single `PublishedShiftChangeDialog`
 * for that page and exposes `guardShiftChange`. Each call does a fresh
 * SELECT of `shifts.locked` — never the React Query cache, since another
 * tab may have published the week seconds ago.
 *
 * Not locked: `run` fires straight away with `allowPublished: false`.
 * Locked: the dialog opens; `run` fires with `allowPublished: true` only
 * if the manager confirms.
 */
export function usePublishedShiftGuard() {
  const [pending, setPending] = useState<PendingChange | null>(null);
  const [isPending, setIsPending] = useState(false);

  const guardShiftChange = useCallback(
    async ({ shiftId, employeeName, secondEmployeeName, run }: GuardShiftChangeOptions) => {
      const { data, error } = await supabase
        .from('shifts')
        .select('locked, employee_id')
        .eq('id', shiftId)
        .single();

      if (error) throw error;

      if (!data.locked) {
        await run({ allowPublished: false });
        return;
      }

      setPending({ employeeName, secondEmployeeName, run });
    },
    []
  );

  const handleOpenChange = useCallback((open: boolean) => {
    if (!open) setPending(null);
  }, []);

  const handleConfirm = useCallback(async () => {
    if (!pending) return;
    setIsPending(true);
    try {
      await pending.run({ allowPublished: true });
      setPending(null);
    } finally {
      setIsPending(false);
    }
  }, [pending]);

  const dialog = (
    <PublishedShiftChangeDialog
      open={pending !== null}
      onOpenChange={handleOpenChange}
      employeeName={pending?.employeeName ?? ''}
      secondEmployeeName={pending?.secondEmployeeName}
      isPending={isPending}
      onConfirm={handleConfirm}
    />
  );

  return { guardShiftChange, dialog };
}
