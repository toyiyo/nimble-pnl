import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fromZonedTime } from 'date-fns-tz';
import { supabase } from '@/integrations/supabase/client';
import { SchedulePublication, Shift } from '@/types/scheduling';
import { useToast } from '@/hooks/use-toast';
import { formatLocalDate } from '@/lib/shiftInterval';

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
 */
export type NotificationOutcome =
  | { status: 'sent'; sent: number }
  | { status: 'partial'; sent: number; failed: number }
  | { status: 'failed'; failed: number }
  | { status: 'unknown'; message: string };

interface InvokeError {
  message?: string;
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
export async function invokeScheduleNotification(
  functionName: string,
  body: Record<string, unknown>,
): Promise<NotificationOutcome> {
  try {
    const { data, error } = await supabase.functions.invoke(functionName, { body });

    if (!error) {
      const sent = typeof data?.sent === 'number' ? data.sent : 0;
      return { status: 'sent', sent };
    }

    const payload = (await (error as InvokeError).context?.json?.()) as
      | { sent?: number; failed?: number }
      | undefined;

    if (payload && typeof payload.failed === 'number' && payload.failed > 0) {
      const sent = typeof payload.sent === 'number' ? payload.sent : 0;
      return sent > 0
        ? { status: 'partial', sent, failed: payload.failed }
        : { status: 'failed', failed: payload.failed };
    }

    return { status: 'unknown', message: (error as InvokeError).message ?? 'Unknown error' };
  } catch (error) {
    // A body that was already consumed, or one that isn't JSON at all. We know
    // something went wrong and nothing more than that.
    return {
      status: 'unknown',
      message: error instanceof Error ? error.message : 'Unknown error',
    };
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
    case 'unknown':
      return {
        title: `${title} — notifications unconfirmed`,
        description: `We could not confirm that employees were notified: ${outcome.message}`,
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

      const shiftCount = data as number;

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
          successDescription: `${shiftCount} shift${shiftCount !== 1 ? 's' : ''} have been unlocked for editing. Affected employees have been told the week is being revised.`,
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
  shifts: Pick<Shift, 'is_published'>[]
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
  const state = deriveWeekScheduleState(isLoading, error, data ?? null, publishedCount, draftCount);

  return {
    state,
    publication: data ?? null,
    publishedCount,
    draftCount,
    loading: isLoading,
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
  const { data, isLoading } = useQuery({
    queryKey: [
      'week_publication_status',
      restaurantId,
      weekStart.toISOString(),
      weekEnd.toISOString(),
      timezone,
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
      const weekStartInstant = fromZonedTime(`${weekStartStr}T00:00:00`, timezone).toISOString();
      const weekEndInstant = fromZonedTime(`${weekEndStr}T23:59:59.999`, timezone).toISOString();

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
