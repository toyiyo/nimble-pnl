import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fromZonedTime } from 'date-fns-tz';
import { supabase } from '@/integrations/supabase/client';
import { SchedulePublication, Shift } from '@/types/scheduling';
import { useToast } from '@/hooks/use-toast';
import { formatLocalDate } from '@/lib/shiftInterval';
import { safeTz } from '@/lib/restaurantClock';

interface PublishScheduleParams {
  restaurantId: string;
  weekStart: Date;
  weekEnd: Date;
  notes?: string;
}

interface UnpublishScheduleParams {
  restaurantId: string;
  weekStart: Date;
  weekEnd: Date;
  reason?: string;
}

/**
 * What the notification edge function actually managed to do.
 *
 * `unknown` is a real outcome, not a fallback for tidiness: the invoke can fail
 * before the function runs at all (offline, cold-start timeout), and claiming
 * "everyone was notified" in that case is the behaviour this change set exists
 * to remove.
 *
 * `error` is distinct from `unknown`: the function ran and answered non-2xx with
 * a body (a 500/4xx), so the fan-out failed on the server. The schedule change
 * itself already committed, so the manager is told to notify the team directly.
 */
export type NotificationOutcome =
  | { status: 'sent'; sent: number }
  | { status: 'partial'; sent: number; failed: number }
  | { status: 'failed'; failed: number }
  | { status: 'error' }
  | { status: 'unknown'; message: string };

interface InvokeError {
  context?: { json?: () => Promise<unknown> };
}

/**
 * Invoke a notification function and work out what really happened.
 *
 * The functions answer 502 with a structured body when any recipient failed,
 * and supabase-js turns a non-2xx into an `error` whose `context` is the raw
 * `Response` — so the counts are only reachable by re-reading it. Swallowing
 * that (which is what the old fire-and-forget `.then()` did) is what let a
 * publish where every email bounced still toast "Employees will be notified".
 */
/**
 * How long the dialog will sit with both its buttons disabled before giving up
 * on the fan-out.
 *
 * Generous on purpose: the fan-out is paced to stay under Resend's 2 req/s
 * limit, so it grows with headcount — a 60-person roster is legitimately ~30s
 * of sending, and cutting that short would report a failure that never
 * happened. But it is not unbounded: an edge function that hangs used to leave
 * Publish and Cancel disabled with no way out but a page reload.
 */
const NOTIFICATION_TIMEOUT_MS = 90_000;

export async function invokeScheduleNotification(
  functionName: string,
  body: Record<string, unknown>,
  timeoutMs: number = NOTIFICATION_TIMEOUT_MS,
): Promise<NotificationOutcome> {
  // A race, not an AbortSignal: this repo's `FunctionInvokeOptions` has only
  // `headers | method | region | body`, so there is nothing to pass a signal
  // to. The request carries on in the background after we stop waiting —
  // acceptable, because the send may well be succeeding and the alternative is
  // a stuck dialog. The outcome is 'unknown', which is exactly true.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<NotificationOutcome>((resolve) => {
    timer = setTimeout(
      () =>
        resolve({
          status: 'unknown',
          message: `Notifications did not confirm within ${Math.round(timeoutMs / 1000)}s. They may still be sending.`,
        }),
      timeoutMs,
    );
  });

  try {
    return await Promise.race([invokeAndInterpret(functionName, body), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function invokeAndInterpret(
  functionName: string,
  body: Record<string, unknown>,
): Promise<NotificationOutcome> {
  // Curated fallback for "we cannot say what happened": the invoke never
  // reached the function (offline, DNS, cold-start), or its response body was
  // already consumed or was not JSON. Both cases below return this same value,
  // so the manager-facing copy cannot drift between them. Never the raw SDK
  // string (e.g. "Failed to fetch"), which is engineering noise.
  const unreachableOutcome: NotificationOutcome = {
    status: 'unknown',
    message: 'We could not reach the notification service.',
  };

  try {
    const { data, error } = await supabase.functions.invoke(functionName, { body });

    if (!error) {
      const sent = typeof data?.sent === 'number' ? data.sent : 0;
      return { status: 'sent', sent };
    }

    const payload = (await (error as InvokeError).context?.json?.()) as
      | { sent?: number; failed?: number }
      | undefined;

    // `context.json()` returns undefined only when the body was unreadable
    // (already consumed, or not JSON). A body that parsed -- even to a falsy
    // value -- means the function answered, so the branches below treat it as an
    // error, not as "unreachable".
    if (payload === undefined) {
      return unreachableOutcome;
    }

    if (payload && typeof payload.failed === 'number' && payload.failed > 0) {
      const sent = typeof payload.sent === 'number' ? payload.sent : 0;
      return sent > 0
        ? { status: 'partial', sent, failed: payload.failed }
        : { status: 'failed', failed: payload.failed };
    }

    // The function answered with a body, but not the { sent, failed } shape -- a
    // 500/4xx. The fan-out failed on the server; the schedule RPC already
    // committed. Report an actionable error, never the raw SDK string
    // ("Edge Function returned a non-2xx status code"), which the manager can do
    // nothing with.
    return { status: 'error' };
  } catch {
    return unreachableOutcome;
  }
}

interface NotificationToastCopy {
  title: string;
  successDescription: string;
}

interface ToastPayload {
  title: string;
  description: string;
  variant?: 'destructive';
}

/**
 * The mutation itself has already committed by the time notifications run, so
 * every branch reports the schedule change as done. Only the notification half
 * varies — and a manager who knows three people weren't emailed can go tell
 * them, which is the entire point.
 */
function notificationToast(
  outcome: NotificationOutcome,
  { title, successDescription }: NotificationToastCopy,
): ToastPayload {
  switch (outcome.status) {
    case 'sent':
      return { title, description: successDescription };
    case 'partial':
      return {
        title: `${title} — some employees not notified`,
        description: `${outcome.sent} notified, ${outcome.failed} could not be reached. Please contact them directly.`,
        variant: 'destructive',
      };
    case 'failed':
      return {
        title: `${title} — nobody was notified`,
        description: `All ${outcome.failed} notification${outcome.failed !== 1 ? 's' : ''} failed to send. Please tell your team directly.`,
        variant: 'destructive',
      };
    case 'error':
      // The title already states the schedule change committed
      // ("Schedule Published — ...") -- same as partial/failed. The description
      // stays path-neutral (this toast serves publish AND unpublish) and gives
      // the one action left: tell the team by hand.
      return {
        title: `${title} — notifications not sent`,
        description: 'We could not send the notifications. Please tell your team directly.',
        variant: 'destructive',
      };
    case 'unknown':
      // Delivery is uncertain, not known-failed (offline, or a timeout where the
      // send may still be in flight), so the action is softer: check, do not
      // assume. `outcome.message` is always curated copy, never a raw SDK string.
      return {
        title: `${title} — notifications unconfirmed`,
        description: `${outcome.message} Please check with your team.`,
        variant: 'destructive',
      };
  }
}

export const useSchedulePublications = (restaurantId: string | null) => {
  const { data, isLoading, error } = useQuery({
    queryKey: ['schedule_publications', restaurantId],
    queryFn: async () => {
      if (!restaurantId) return [];

      const { data, error } = await supabase
        .from('schedule_publications')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .order('published_at', { ascending: false });

      if (error) throw error;
      return data as SchedulePublication[];
    },
    enabled: !!restaurantId,
    staleTime: 30000,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
  });

  return {
    publications: data || [],
    loading: isLoading,
    error,
  };
};

export const usePublishSchedule = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ restaurantId, weekStart, weekEnd, notes }: PublishScheduleParams) => {
      // Format dates as YYYY-MM-DD (local calendar day, not UTC)
      const weekStartStr = formatLocalDate(weekStart);
      const weekEndStr = formatLocalDate(weekEnd);

      // Call the publish_schedule function
      const { data, error } = await supabase.rpc('publish_schedule', {
        p_restaurant_id: restaurantId,
        p_week_start: weekStartStr,
        p_week_end: weekEndStr,
        p_notes: notes || null,
      });

      if (error) throw error;

      const publicationId = data;

      // Awaited, unlike before. The old call was fire-and-forget with a
      // console.error, so a fan-out that reached nobody still produced a
      // "Employees will be notified" toast and the manager had no way to know.
      const notification = await invokeScheduleNotification('notify-schedule-published', {
        publicationId,
        restaurantId,
        weekStart: weekStartStr,
        weekEnd: weekEndStr,
      });

      return { publicationId, restaurantId, notification };
    },
    onSuccess: ({ restaurantId, notification }) => {
      // Invalidate relevant queries
      queryClient.invalidateQueries({ queryKey: ['shifts', restaurantId] });
      queryClient.invalidateQueries({ queryKey: ['schedule_publications', restaurantId] });

      toast(
        notificationToast(notification, {
          title: 'Schedule Published',
          successDescription:
            'The schedule has been published and locked. Employees have been notified.',
        }),
      );
    },
    onError: (error: Error) => {
      toast({
        title: 'Error Publishing Schedule',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
};

export const useUnpublishSchedule = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ restaurantId, weekStart, weekEnd, reason }: UnpublishScheduleParams) => {
      // Format dates as YYYY-MM-DD (local calendar day, not UTC)
      const weekStartStr = formatLocalDate(weekStart);
      const weekEndStr = formatLocalDate(weekEnd);

      // Call the unpublish_schedule function
      const { data, error } = await supabase.rpc('unpublish_schedule', {
        p_restaurant_id: restaurantId,
        p_week_start: weekStartStr,
        p_week_end: weekEndStr,
        p_reason: reason || null,
      });

      if (error) throw error;

      // PostgREST types the RPC return as nullable. A null here would make
      // `shiftCount > 0` false and quietly skip the notification, so it is
      // pinned to 0 rather than asserted away.
      const shiftCount = (data as number | null) ?? 0;

      // Nothing was actually retracted, so there is nobody to tell. Skipping
      // the invoke keeps a double-tap on Unpublish off the error path.
      const notification: NotificationOutcome =
        shiftCount > 0
          ? await invokeScheduleNotification('notify-schedule-unpublished', {
              restaurantId,
              weekStart: weekStartStr,
            })
          : { status: 'sent', sent: 0 };

      return { shiftCount, restaurantId, notification };
    },
    onSuccess: ({ shiftCount, restaurantId, notification }) => {
      // Invalidate relevant queries
      queryClient.invalidateQueries({ queryKey: ['shifts', restaurantId] });
      queryClient.invalidateQueries({ queryKey: ['schedule_publications', restaurantId] });
      queryClient.invalidateQueries({ queryKey: ['schedule_change_logs', restaurantId] });

      toast(
        notificationToast(notification, {
          title: 'Schedule Unpublished',
          // Nothing was retracted means nothing was sent -- the mutation skips
          // the invoke entirely on that path. Promising a notification anyway
          // is how a manager ends up believing their team was told.
          successDescription:
            shiftCount > 0
              ? `${shiftCount} shift${shiftCount !== 1 ? 's' : ''} have been unlocked for editing. Affected employees have been told the week is being revised.`
              : 'Nothing was published for this week, so no shifts changed and nobody was notified.',
        }),
      );
    },
    onError: (error: Error) => {
      toast({
        title: 'Error Unpublishing Schedule',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
};

/**
 * What an employee's week actually is, as opposed to what it looks like.
 *
 * `useWeekPublicationStatus` collapses "was published, now fully retracted" into
 * the same `null` it returns for "never published" — fine for the manager, who
 * has the Publish button's own state to go by, but it is exactly the distinction
 * an employee needs. That is the incident: a week was announced, then pulled back
 * for edits, and the employee's view was indistinguishable from a week that had
 * simply never been published.
 */
export type WeekScheduleState =
  | 'not_published'
  | 'published'
  | 'published_revising'
  | 'retracted';

interface WeekScheduleStatus {
  state: WeekScheduleState | null;
  publication: SchedulePublication | null;
  publishedCount: number;
  draftCount: number;
  loading: boolean;
  error: unknown;
}

/**
 * A wrong banner is worse than no banner, so an errored or in-flight lookup
 * reports no state at all rather than guessing "not published".
 */
function deriveWeekScheduleState(
  isLoading: boolean,
  error: unknown,
  publication: SchedulePublication | null,
  publishedCount: number,
  draftCount: number
): WeekScheduleState | null {
  if (isLoading || error) return null;
  if (!publication) return 'not_published';
  // No shifts of any kind means this employee simply isn't on the roster this
  // week — not that anything was pulled back. Unpublishing flips shifts to
  // draft, it never deletes them, so a real retraction always leaves drafts
  // behind. Without this, every unscheduled employee at a published restaurant
  // would be told their schedule was withdrawn, every week they have off.
  if (publishedCount === 0 && draftCount === 0) return 'published';
  if (publishedCount === 0) return 'retracted';
  if (draftCount > 0) return 'published_revising';
  return 'published';
}

/**
 * Counts come from shifts the caller already has — `EmployeeSchedule` filters
 * the week down to `myShifts`, and the state model is defined over that
 * employee's own shifts, not the restaurant's. Passing them in also keeps this
 * query off the critical path: the day grid renders from `useShifts` while the
 * banner resolves a beat later from its own single-row lookup.
 */
export const useWeekScheduleStatus = (
  restaurantId: string | null,
  weekStart: Date,
  shifts: Pick<Shift, 'is_published'>[],
  /**
   * Whether `shifts` is still loading. Load-bearing, not cosmetic: an empty
   * array reads identically whether the employee has no shifts or the query
   * hasn't answered yet, and those map to opposite banners. With the
   * publication row already in the React Query cache, `isLoading` below is
   * false, so a retracted week would render the quiet "Published …" line and
   * then flip to the red banner once the shifts arrived.
   */
  shiftsLoading = false
): WeekScheduleStatus => {
  const weekStartStr = formatLocalDate(weekStart);

  const { data, isLoading, error } = useQuery({
    queryKey: ['week_schedule_status', restaurantId, weekStartStr],
    queryFn: async () => {
      if (!restaurantId) return null;

      // Keyed on week_start_date alone and ordered newest-first on purpose. A
      // week can carry several publication rows (every republish inserts one),
      // and unlike useWeekPublicationStatus this lookup is NOT gated on shifts
      // still being published — a retracted week has to stay findable, or state
      // D collapses back into state A and the whole distinction is lost.
      const { data, error } = await supabase
        .from('schedule_publications')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .eq('week_start_date', weekStartStr)
        .order('published_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      return (data as SchedulePublication | null) ?? null;
    },
    enabled: !!restaurantId,
    staleTime: 30000,
    refetchOnWindowFocus: true,
  });

  const publishedCount = shifts.filter((s) => s.is_published).length;
  const draftCount = shifts.length - publishedCount;
  const loading = isLoading || shiftsLoading;
  const state = deriveWeekScheduleState(loading, error, data ?? null, publishedCount, draftCount);

  return {
    state,
    publication: data ?? null,
    publishedCount,
    draftCount,
    loading,
    error,
  };
};

/**
 * The reason a manager gave when pulling a week back, if they gave one.
 *
 * Gated on `enabled` so the overwhelmingly common case — a published week —
 * costs nothing. `schedule_retractions` is the right source rather than
 * `schedule_change_logs`: it is scoped to the week, carries the SELECT policy
 * and grant employees actually have, and stores the reason verbatim instead of
 * the RPC's `COALESCE(...)` boilerplate.
 */
export const useWeekRetractionReason = (
  restaurantId: string | null,
  weekStart: Date,
  enabled: boolean
): string | null => {
  const weekStartStr = formatLocalDate(weekStart);

  const { data } = useQuery({
    queryKey: ['week_retraction_reason', restaurantId, weekStartStr],
    queryFn: async () => {
      if (!restaurantId) return null;

      const { data, error } = await supabase
        .from('schedule_retractions')
        .select('reason')
        .eq('restaurant_id', restaurantId)
        .eq('week_start_date', weekStartStr)
        .order('retracted_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      return data?.reason ?? null;
    },
    enabled: !!restaurantId && enabled,
    staleTime: 30000,
  });

  return data ?? null;
};

export const useWeekPublicationStatus = (
  restaurantId: string | null,
  weekStart: Date,
  weekEnd: Date,
  timezone: string
) => {
  // `restaurants.timezone` is nullable and free-text, and callers may hand this
  // through before the restaurant has loaded. `fromZonedTime` answers an invalid
  // zone with an Invalid Date, whose `.toISOString()` throws — so the whole
  // badge would disappear behind a query error rather than fall back to UTC the
  // way publish_schedule itself does. Resolved once, before the key, so a
  // '' -> 'UTC' correction doesn't split the cache across two entries.
  const tz = safeTz(timezone);

  const { data, isLoading } = useQuery({
    queryKey: [
      'week_publication_status',
      restaurantId,
      weekStart.toISOString(),
      weekEnd.toISOString(),
      tz,
    ],
    queryFn: async () => {
      if (!restaurantId) return null;

      const weekStartStr = formatLocalDate(weekStart);
      const weekEndStr = formatLocalDate(weekEnd);

      // Count the same shifts publish_schedule acted on. It buckets by
      // `(start_time AT TIME ZONE restaurant_tz)::date`; this used to send the
      // browser-local midnight instants instead, so a manager in a different
      // zone from the restaurant — or anyone looking at a Sunday-evening shift,
      // which is already Monday in UTC — could see "Published" disagree with
      // what publish actually did at the week edges.
      const weekStartInstant = fromZonedTime(`${weekStartStr}T00:00:00`, tz).toISOString();
      const weekEndInstant = fromZonedTime(`${weekEndStr}T23:59:59.999`, tz).toISOString();

      const { count: publishedShiftCount, error: shiftError } = await supabase
        .from('shifts')
        .select('id', { count: 'exact', head: true })
        .eq('restaurant_id', restaurantId)
        .gte('start_time', weekStartInstant)
        .lte('start_time', weekEndInstant)
        .eq('is_published', true);

      if (shiftError) throw shiftError;

      // If no published shifts, return null (not published)
      if (!publishedShiftCount || publishedShiftCount === 0) {
        return null;
      }

      // Get the publication record if shifts are published
      const { data, error } = await supabase
        .from('schedule_publications')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .eq('week_start_date', weekStartStr)
        .eq('week_end_date', weekEndStr)
        .order('published_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      return data as SchedulePublication | null;
    },
    enabled: !!restaurantId,
    staleTime: 30000,
    refetchOnWindowFocus: true,
  });

  return {
    publication: data,
    isPublished: !!data,
    loading: isLoading,
  };
};
