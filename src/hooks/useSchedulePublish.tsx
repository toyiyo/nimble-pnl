import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fromZonedTime } from 'date-fns-tz';
import { supabase } from '@/integrations/supabase/client';
import { SchedulePublication } from '@/types/scheduling';
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
export const invokeScheduleNotification = async (
  functionName: string,
  body: Record<string, unknown>,
): Promise<NotificationOutcome> => {
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
};

/**
 * The mutation itself has already committed by the time notifications run, so
 * every branch reports the schedule change as done. Only the notification half
 * varies — and a manager who knows three people weren't emailed can go tell
 * them, which is the entire point.
 */
const notificationToast = (
  outcome: NotificationOutcome,
  { title, successDescription }: { title: string; successDescription: string },
) => {
  switch (outcome.status) {
    case 'sent':
      return { title, description: successDescription } as const;
    case 'partial':
      return {
        title: `${title} — some employees not notified`,
        description: `${outcome.sent} notified, ${outcome.failed} could not be reached. Please contact them directly.`,
        variant: 'destructive',
      } as const;
    case 'failed':
      return {
        title: `${title} — nobody was notified`,
        description: `All ${outcome.failed} notification${outcome.failed !== 1 ? 's' : ''} failed to send. Please tell your team directly.`,
        variant: 'destructive',
      } as const;
    case 'unknown':
      return {
        title: `${title} — notifications unconfirmed`,
        description: `We could not confirm that employees were notified: ${outcome.message}`,
        variant: 'destructive',
      } as const;
  }
};

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
