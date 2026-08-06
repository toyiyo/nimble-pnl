import { useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import type { ReviewMetrics } from '@/lib/reviews/reviewMetrics';

export type ReviewResponseStatus = 'new' | 'in_progress' | 'resolved';

export interface ReviewResponse {
  id: string;
  restaurant_id: string;
  review_page_id: string;
  rating: number;
  routed_to: 'destination' | 'feedback';
  comment: string | null;
  contact_consent: boolean;
  status: ReviewResponseStatus;
  submitted_at: string;
  commented_at: string | null;
}

export interface ReviewResponseContact {
  contact_name: string | null;
  contact_email: string | null;
}

/** Which rows the inbox list asks for. The predicate runs server-side. */
export type ReviewResponseFilter = 'all' | 'commented' | 'silent';

/**
 * A row a manager can act on: a comment to read, or a guest who asked to hear
 * back. A silent five-star tap is neither, so it carries no status and no
 * contact card.
 *
 * The `unread_count` FILTER in `review_response_metrics` holds the same rule
 * in SQL (supabase/migrations/20260806120000_review_metrics_actionable.sql).
 * Change both together, or the header badge and the rows disagree.
 */
export function isActionableResponse(response: ReviewResponse): boolean {
  return response.comment !== null || response.contact_consent;
}

interface ReviewResponseMetricsRow {
  average_rating: number | null;
  total_ratings: number;
  comment_count: number;
  unread_count: number;
}

// review_responses / review_response_contacts / review_response_metrics
// aren't in the generated Supabase types yet (added by migrations after the
// last `npm run sync-types`) — every `.from('table' as any)` /
// `.rpc('review_response_metrics' as any)` cast in this file is for that
// gap; the real shapes are the interfaces above.

export function useReviewResponses(
  restaurantId?: string,
  filter: ReviewResponseFilter = 'all'
) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const query = useQuery({
    // The filter joins the key, so each mode caches on its own. A shared key
    // would answer `silent` from the `all` cache.
    queryKey: ['review-responses', restaurantId, filter],
    enabled: Boolean(restaurantId),
    staleTime: 30000,
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<ReviewResponse[]> => {
      // The filter is applied SERVER-side, before the cap. A filter after a
      // `.limit(500)` would mean a location that takes 500 silent star taps
      // after a written complaint fetches 500 silent rows and shows an empty
      // inbox — the complaint dropped off the end of a window it was never in.
      //
      // Known limit: in `all` mode a heavy run of silent taps can push an old
      // comment past the 500-row cap. `With comments` is the mode that
      // guarantees the full comment list.
      //
      // Capped at 500 for the inbox *list* only. The header metrics below do
      // NOT come from this capped array; they're a separate, uncapped
      // server-side aggregate, so a restaurant past 500 comments still sees a
      // correct average/total/unread count.
      const base = supabase
        .from('review_responses' as any)
        .select(
          'id, restaurant_id, review_page_id, rating, routed_to, comment, contact_consent, status, submitted_at, commented_at'
        )
        .eq('restaurant_id', restaurantId!);

      // `all` adds no predicate, so it reads the base query unchanged.
      let scoped = base;
      if (filter === 'commented') scoped = base.not('comment', 'is', null);
      else if (filter === 'silent') scoped = base.is('comment', null);

      const { data, error } = await scoped
        .order('submitted_at', { ascending: false })
        .limit(500);

      if (error) throw error;
      return (data ?? []) as unknown as ReviewResponse[];
    },
  });

  const metricsQuery = useQuery({
    queryKey: ['review-response-metrics', restaurantId],
    enabled: Boolean(restaurantId),
    staleTime: 30000,
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<ReviewMetrics> => {
      // review_response_metrics isn't in the generated Supabase types yet
      // (added by 20260804110000_review_response_aggregates.sql, after the
      // last `npm run sync-types`) — hence the `as any` cast.
      const { data, error } = await supabase.rpc('review_response_metrics' as any, {
        p_restaurant_id: restaurantId!,
      });
      if (error) throw error;
      const row = ((data ?? []) as unknown as ReviewResponseMetricsRow[])[0];
      return {
        averageRating: row?.average_rating ?? null,
        totalRatings: row?.total_ratings ?? 0,
        commentCount: row?.comment_count ?? 0,
        unreadCount: row?.unread_count ?? 0,
      };
    },
  });

  const responses = query.data ?? [];
  const metrics: ReviewMetrics =
    metricsQuery.data ?? { averageRating: null, totalRatings: 0, commentCount: 0, unreadCount: 0 };

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: ReviewResponseStatus }) => {
      if (!restaurantId) throw new Error('No restaurant selected');
      // `.select('id').maybeSingle()` is what makes this a confirmed write.
      // A zero-row UPDATE resolves without an error in PostgREST, so an id
      // from a stale cache — or a row RLS filters away — would report success,
      // the status control would settle on the new value, and the next
      // refetch would silently snap it back with no explanation.
      const { data, error } = await supabase
        .from('review_responses' as any)
        .update({ status })
        .eq('id', id)
        .eq('restaurant_id', restaurantId)
        .select('id')
        .maybeSingle();
      if (error) throw error;
      if (!data) {
        throw new Error('That feedback is no longer available — it may have just been removed.');
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['review-responses', restaurantId] });
      // A status change (e.g. clearing "new") moves unreadCount, which comes
      // from the separate aggregate query, not the list above.
      queryClient.invalidateQueries({ queryKey: ['review-response-metrics', restaurantId] });
    },
    onError: (error: Error) => {
      toast({ title: 'Could not update', description: error.message, variant: 'destructive' });
    },
  });

  // Contact details live in their own table so that RLS — which is row-level,
  // not column-level — can hold them to manage:reviews while the comment
  // itself stays readable at view:reviews. A viewer's fetch is filtered by
  // RLS to zero rows, NOT rejected: `data === null` with no error is the
  // ordinary "you may not see this, or the guest left nothing" answer, and
  // the caller renders nothing.
  //
  // An actual error is therefore not that case — it is a network or PostgREST
  // failure, and swallowing it would render "no contact details" over a guest
  // who did leave them. Say so, and still return null so the pane renders.
  const fetchContact = useCallback(
    async (responseId: string): Promise<ReviewResponseContact | null> => {
      if (!restaurantId) throw new Error('No restaurant selected');
      const { data, error } = await supabase
        .from('review_response_contacts' as any)
        .select('contact_name, contact_email')
        .eq('review_response_id', responseId)
        .eq('restaurant_id', restaurantId)
        .maybeSingle();

      if (error) {
        // Dev only: in production this line would put a PostgREST error —
        // which carries the failing table, column and filter — into the
        // browser console of a page that is showing guest PII. The toast is
        // the user-facing signal; the console is for whoever is debugging.
        if (import.meta.env.DEV) {
          console.error('useReviewResponses: contact fetch failed', error);
        }
        toast({
          title: 'Could not load contact details',
          description: 'This guest may have left a name and email. Try again in a moment.',
          variant: 'destructive',
        });
        return null;
      }
      return (data as unknown as ReviewResponseContact) ?? null;
    },
    [restaurantId, toast]
  );

  return {
    responses,
    metrics,
    isLoading: query.isLoading || metricsQuery.isLoading,
    error: (query.error ?? metricsQuery.error) as Error | null,
    updateStatus: updateStatus.mutateAsync,
    fetchContact,
  };
}
