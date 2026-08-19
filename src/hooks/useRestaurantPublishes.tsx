import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import {
  isPublishingRestaurant,
  publishWindowStart,
  type PublicationWeek,
} from '@/lib/schedulePublisher';

/**
 * Does this restaurant publish its schedule right now?
 *
 * Warning: do not reuse `useSchedulePublications`. That hook selects `*` with
 * no week filter and no limit, so it reads the whole publish history on every
 * page load. This query is bounded, and the range scan uses
 * `idx_schedule_publications_week_lookup`.
 *
 * The key keeps the `['schedule_publications', restaurantId]` prefix. Publish
 * and unpublish invalidate that prefix, and React Query matches an
 * invalidation by prefix, so this key stays fresh.
 */
export function useRestaurantPublishes(
  restaurantId: string | null,
  tz: string
): { publishes: boolean; isLoading: boolean } {
  // Recomputed once per calendar day, not once per render. An unstable value
  // here would make a new query key on every render.
  const windowStart = useMemo(() => publishWindowStart(new Date(), tz), [tz]);

  const { data, isLoading } = useQuery({
    queryKey: ['schedule_publications', restaurantId, 'window', windowStart],
    queryFn: async (): Promise<PublicationWeek[]> => {
      if (!restaurantId) return [];

      const { data, error } = await supabase
        .from('schedule_publications')
        .select('week_start_date')
        .eq('restaurant_id', restaurantId)
        .gte('week_start_date', windowStart);

      if (error) throw error;
      return (data ?? []) as PublicationWeek[];
    },
    enabled: !!restaurantId,
    staleTime: 30000,
  });

  // While the query loads, report false. A shift row must render something, so
  // it cannot wait. A false draft hue caused a no-show. A late draft hue did
  // not.
  const publishes = data ? isPublishingRestaurant(data, new Date(), tz) : false;

  return { publishes, isLoading };
}
