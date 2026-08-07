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
export type ReviewResponseFilter = 'all' | 'needsReply' | 'silent';

/**
 * A row a manager can act on: a comment to read, or a guest who asked to hear
 * back. A silent five-star tap is neither, so it carries no status and no
 * contact card.
 *
 * Warning: this rule has three copies. Change all three together, or the
 * header badge, the `needsReply` filter, and the status chip disagree.
 * 1. This function.
 * 2. The `unread_count` FILTER in `review_response_metrics`
 *    (supabase/migrations/20260806120000_review_metrics_actionable.sql).
 * 3. The `needsReply` predicate below, in this file's queryFn.
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
      // comment past the 500-row cap. `needsReply` is the mode that
      // guarantees the full actionable list.
      //
      // Capped at 500 for the inbox *list* only. The header metrics below do
      // NOT come from this capped array; they're a separate, uncapped
      // server-side aggregate, so a restaurant past 500 comments still sees a
      // correct average/total/unread count.
      const base = supabase
        .from('review_responses')
        .select(
          'id, restaurant_id, review_page_id, rating, routed_to, comment, contact_consent, status, submitted_at, commented_at'
        )
        .eq('restaurant_id', restaurantId!);

      // `all` adds no predicate, so it reads the base query unchanged.
      // `needsReply` holds the same rule as isActionableResponse — see the
      // warning on that function.
      let scoped = base;
      if (filter === 'needsReply') {
        scoped = base.or('comment.not.is.null,contact_consent.is.true');
      } else if (filter === 'silent') {
        scoped = base.is('comment', null).eq('contact_consent', false);
      }

      // The list shows commented_at ?? submitted_at (Reviews.tsx,
      // ReviewFeedbackDetail.tsx). Order by the same key, or a late follow-up
      // reads as new but sits far down the list. NULLS LAST keeps a
      // comment-less row under its own submitted_at.
      const { data, error } = await scoped
        .order('commented_at', { ascending: false, nullsFirst: false })
        .order('submitted_at', { ascending: false })
        .limit(500);

      if (error) throw error;
      // review_responses.status and .routed_to are typed as plain `string`
      // in the generated schema; ReviewResponse narrows them to the exact
      // values this app writes and reads.
      return (data ?? []) as ReviewResponse[];
    },
  });

  const metricsQuery = useQuery({
    queryKey: ['review-response-metrics', restaurantId],
    enabled: Boolean(restaurantId),
    staleTime: 30000,
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<ReviewMetrics> => {
      const { data, error } = await supabase.rpc('review_response_metrics', {
        p_restaurant_id: restaurantId!,
      });
      if (error) throw error;
      const row: ReviewResponseMetricsRow | undefined = (data ?? [])[0];
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
        .from('review_responses')
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
        .from('review_response_contacts')
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
      return data ?? null;
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
