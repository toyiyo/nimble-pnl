import { useCallback, useState } from 'react';

import { supabase } from '@/integrations/supabase/client';
import { PublishedShiftChangeDialog } from '@/components/scheduling/PublishedShiftChangeDialog';
import { formatNamesLabel } from '@/lib/scheduling/formatNamesLabel';
import { useToast } from '@/hooks/use-toast';
import { invokeScheduleNotification, notificationToast } from '@/hooks/useSchedulePublish';

/**
 * A guarded write. `deferred: true` means nothing committed yet (e.g. a
 * conflict dialog opened instead) — see `GuardShiftChangeOptions.run`.
 */
type GuardedRun = (
  options: { allowPublished: boolean; notify: boolean }
) => void | Promise<void | { deferred: boolean }>;

export interface GuardShiftChangeOptions {
  shiftId: string;
  /** Scopes the fresh `shifts` read so one tenant never sees another's lock state. */
  restaurantId: string;
  /** Name shown in the dialog. The caller already has it from the edited shift. */
  employeeName: string;
  /** Set on a reassignment. The dialog then names both employees. */
  secondEmployeeName?: string;
  /**
   * `notify` carries the checkbox choice through to callers that cannot
   * commit right away (e.g. a drag/edit that surfaces a conflict dialog
   * instead of writing). Such a `run` must resolve with `{ deferred: true }`
   * instead of committing — the guard then skips its own notify step, and
   * the caller notifies itself via `notifyAfterDeferredCommit` once its own
   * later write actually lands. Omitting `deferred` (the common case) means
   * `run` performed the write itself, and the guard notifies right after.
   */
  run: GuardedRun;
  /**
   * Set for a 'following'/'all' series edit. The lock check then covers
   * every shift in scope, not only `shiftId` — an unlocked anchor with
   * locked siblings must still warn, because the series RPC touches the
   * locked rows when `allowPublished` is true.
   */
  series?: {
    parentId: string;
    scope: 'following' | 'all';
    /** Required for the 'following' scope: only shifts at or after this instant. */
    fromTime?: string;
  };
}

interface PendingChange {
  shiftId: string;
  employeeName: string;
  secondEmployeeName?: string;
  run: GuardedRun;
}

/** Args for {@link usePublishedShiftGuard}'s `notifyAfterDeferredCommit`. */
export interface NotifyAfterDeferredCommitArgs {
  shiftId: string;
  employeeName: string;
  secondEmployeeName?: string;
  /** ISO instant captured right before the caller's own deferred write. */
  startedAt: string;
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
    async ({
      shiftId,
      restaurantId,
      employeeName,
      secondEmployeeName,
      run,
      series,
    }: GuardShiftChangeOptions) => {
      // None of this function's callers await/catch it (the Save button's
      // onClick is synchronous), so a rejection here becomes an unhandled
      // promise rejection with no visible error. Every exit below resolves
      // instead of throwing.
      let locked: boolean;
      try {
        if (series) {
          // Any locked shift in scope means the warning must show.
          let query = supabase
            .from('shifts')
            .select('id', { count: 'exact', head: true })
            .eq('restaurant_id', restaurantId)
            .eq('locked', true)
            .or(`id.eq.${series.parentId},recurrence_parent_id.eq.${series.parentId}`);
          if (series.scope === 'following' && series.fromTime) {
            query = query.gte('start_time', series.fromTime);
          }
          const { count, error } = await query;
          if (error) throw error;
          locked = (count ?? 0) > 0;
        } else {
          // Scoped to restaurantId too, not just id — RLS already isolates
          // tenants, but a stray cross-tenant id must read as "not found"
          // here, not fall through to another restaurant's lock state.
          const { data, error } = await supabase
            .from('shifts')
            .select('locked, employee_id')
            .eq('id', shiftId)
            .eq('restaurant_id', restaurantId)
            .single();

          if (error) throw error;
          locked = data.locked;
        }
      } catch (error) {
        toast({
          title: 'Could not check the shift',
          description: error instanceof Error ? error.message : 'Please try again.',
          variant: 'destructive',
        });
        return;
      }

      if (!locked) {
        try {
          // No dialog shown, so no notify choice exists to carry through.
          await run({ allowPublished: false, notify: false });
        } catch {
          // The mutation's own onError toast already told the user.
        }
        return;
      }

      setPending({ shiftId, employeeName, secondEmployeeName, run });
    },
    [toast]
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
   *
   * Never throws. Both callers (`handleConfirm` and
   * `notifyAfterDeferredCommit`) run after the shift write already
   * committed, so a rejection here must not read as a failed save. Every
   * exit resolves; a lookup failure gets its own toast instead of an
   * unhandled promise rejection.
   */
  const notifyShiftChange = useCallback(
    async (shiftId: string, startedAt: string, namesLabel: string) => {
      try {
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

        if (error || !rows || rows.length === 0) {
          // The shift write committed; only the notification cannot go out.
          // Silence here would break the manager's expectation that the
          // employee was told.
          toast({
            title: 'Shift updated — notification not sent',
            description: `We could not find the change record. Please tell ${namesLabel} directly.`,
            variant: 'destructive',
          });
          return;
        }

        const outcome = await invokeScheduleNotification('notify-shift-changed', {
          changeLogId: rows[0].id,
        });

        toast(
          notificationToast(outcome, {
            title: 'Shift updated',
            successDescription: `${namesLabel} was notified.`,
          })
        );
      } catch (error) {
        // The shift write already committed. Only the notify step failed —
        // tell the manager to notify the team by hand, do not imply the
        // save itself failed.
        toast({
          title: 'Shift updated — could not notify',
          description:
            error instanceof Error ? error.message : 'Please tell the team directly.',
          variant: 'destructive',
        });
      }
    },
    [toast]
  );

  const handleConfirm = useCallback(
    async ({ notify }: { notify: boolean }) => {
      if (!pending) return;
      setIsPending(true);
      try {
        const startedAt = new Date().toISOString();
        const result = await pending.run({ allowPublished: true, notify });
        // A deferred `run` (e.g. it surfaced a conflict dialog instead of
        // writing) has not committed anything yet — nothing to notify about
        // here. The caller notifies itself later via
        // `notifyAfterDeferredCommit`, once its own write actually lands.
        // `result` can be `void` (most callers) — narrow with a runtime
        // check instead of `?.`, which does not treat `void` as absent.
        const deferred = typeof result === 'object' && result !== null && result.deferred === true;
        if (notify && !deferred) {
          const namesLabel = formatNamesLabel(pending.employeeName, pending.secondEmployeeName);
          await notifyShiftChange(pending.shiftId, startedAt, namesLabel);
        }
        setPending(null);
      } catch {
        // The mutation's own onError toast already told the user. Leave
        // `pending` set so the dialog stays open and the manager can retry
        // or cancel, instead of the confirm silently going nowhere.
      } finally {
        setIsPending(false);
      }
    },
    [pending, notifyShiftChange]
  );

  /**
   * For a `run` that deferred instead of committing (returned
   * `{ deferred: true }`): the caller invokes this itself once its own later
   * write actually succeeds, so the notify step still reflects a real
   * commit. `startedAt` must be captured right before that write, not
   * before the original guard confirm, or the change-log lookup can miss
   * the row (or pick up an unrelated earlier one).
   */
  const notifyAfterDeferredCommit = useCallback(
    async ({ shiftId, employeeName, secondEmployeeName, startedAt }: NotifyAfterDeferredCommitArgs) => {
      const namesLabel = formatNamesLabel(employeeName, secondEmployeeName);
      await notifyShiftChange(shiftId, startedAt, namesLabel);
    },
    [notifyShiftChange]
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

  return { guardShiftChange, dialog, notifyAfterDeferredCommit };
}
