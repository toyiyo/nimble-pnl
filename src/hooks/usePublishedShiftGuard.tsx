import { useCallback, useState } from 'react';

import { supabase } from '@/integrations/supabase/client';
import { PublishedShiftChangeDialog } from '@/components/scheduling/PublishedShiftChangeDialog';
import { useToast } from '@/hooks/use-toast';
import { invokeScheduleNotification, notificationToast } from '@/hooks/useSchedulePublish';

export interface GuardShiftChangeOptions {
  shiftId: string;
  /** Name shown in the dialog. The caller already has it from the edited shift. */
  employeeName: string;
  /** Set on a reassignment. The dialog then names both employees. */
  secondEmployeeName?: string;
  run: (options: { allowPublished: boolean }) => void | Promise<void>;
}

interface PendingChange {
  shiftId: string;
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
  const { toast } = useToast();

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

      setPending({ shiftId, employeeName, secondEmployeeName, run });
    },
    []
  );

  const handleOpenChange = useCallback((open: boolean) => {
    if (!open) setPending(null);
  }, []);

  /**
   * Looks up the change-log row the confirmed `run` just wrote, scoped so a
   * concurrent edit from another manager can never be picked, then fires the
   * notify function. Design:
   * docs/superpowers/specs/2026-08-15-quiet-publish-live-edit-design.md
   * ("Client: after the guarded mutation commits...").
   */
  const notifyShiftChange = useCallback(
    async (shiftId: string, startedAt: string, namesLabel: string) => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const { data: rows, error } = await supabase
        .from('schedule_change_logs')
        .select('id')
        .eq('shift_id', shiftId)
        .eq('changed_by', user.id)
        .gte('changed_at', startedAt)
        .order('changed_at', { ascending: false })
        .limit(1);

      if (error || !rows || rows.length === 0) return;

      const outcome = await invokeScheduleNotification('notify-shift-changed', {
        changeLogId: rows[0].id,
      });

      toast(
        notificationToast(outcome, {
          title: 'Shift updated',
          successDescription: `${namesLabel} was notified.`,
        })
      );
    },
    [toast]
  );

  const handleConfirm = useCallback(
    async ({ notify }: { notify: boolean }) => {
      if (!pending) return;
      setIsPending(true);
      try {
        const startedAt = new Date().toISOString();
        await pending.run({ allowPublished: true });
        if (notify) {
          const namesLabel = pending.secondEmployeeName
            ? `${pending.employeeName} and ${pending.secondEmployeeName}`
            : pending.employeeName;
          await notifyShiftChange(pending.shiftId, startedAt, namesLabel);
        }
        setPending(null);
      } finally {
        setIsPending(false);
      }
    },
    [pending, notifyShiftChange]
  );

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
