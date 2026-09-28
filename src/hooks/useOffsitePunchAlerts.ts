import { createElement, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';

import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { ToastAction, type ToastActionElement } from '@/components/ui/toast';
import { useRestaurantClock } from '@/hooks/useRestaurantClock';
import { formatDistance } from '@/utils/punchLocationFlag';

interface OffsitePunchAlertRow {
  id: string;
  punch_type: string;
  punch_time: string;
  location: { distance_meters?: number; within_geofence?: boolean } | null;
  employee: { name: string } | null;
}

async function fetchOffsitePunches(
  restaurantId: string,
  dayStart: string,
): Promise<OffsitePunchAlertRow[]> {
  const { data, error } = await supabase
    .from('time_punches')
    .select('id, punch_type, punch_time, location, employee:employees(name)')
    .eq('restaurant_id', restaurantId)
    .gte('punch_time', dayStart)
    .eq('location->>within_geofence', 'false')
    .order('punch_time', { ascending: true });

  if (error) {
    throw error;
  }

  return (data ?? []) as unknown as OffsitePunchAlertRow[];
}

/**
 * Polls for off-site punches from the start of the restaurant's business
 * day and shows one toast per newly seen punch. The first result of any
 * restaurant seeds the seen set without a toast (memory/lessons.md: do not
 * toast for state that already existed before the hook mounted).
 */
export function useOffsitePunchAlerts(
  restaurantId: string | undefined,
  onViewPunch: (punchId: string) => void,
) {
  const { toast } = useToast();
  const { today, tz, formatInstant, parseWallClock } = useRestaurantClock();
  const dayStart = parseWallClock(`${today}T00:00`);

  const seenIds = useRef<Set<string> | null>(null);
  const seenRestaurantId = useRef<string | undefined>(undefined);

  const query = useQuery({
    queryKey: ['offsitePunchAlerts', restaurantId, dayStart],
    queryFn: () => fetchOffsitePunches(restaurantId as string, dayStart),
    enabled: Boolean(restaurantId),
    staleTime: 10000,
    refetchInterval: 15000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });

  // A restaurant change must reset the seen set, not carry it forward: the
  // new restaurant's punches are all unseen from this hook's point of view,
  // but they are not NEW off-site punches — do not toast for them.
  if (seenRestaurantId.current !== restaurantId) {
    seenRestaurantId.current = restaurantId;
    seenIds.current = null;
  }

  useEffect(() => {
    const rows = query.data;
    if (!rows) {
      return;
    }

    if (seenIds.current === null) {
      seenIds.current = new Set(rows.map((row) => row.id));
      return;
    }

    for (const row of rows) {
      if (seenIds.current.has(row.id)) {
        continue;
      }
      seenIds.current.add(row.id);

      const employeeName = row.employee?.name ?? 'An employee';
      const verb = row.punch_type === 'clock_out' ? 'clocked out' : 'clocked in';
      const distanceMeters = row.location?.distance_meters;
      const distanceLabel =
        distanceMeters != null
          ? `${formatDistance(distanceMeters)} from the restaurant`
          : 'Off-site';
      const timeLabel = formatInstant(row.punch_time, 'h:mm a');

      toast({
        title: `${employeeName} ${verb} off-site`,
        description: `${distanceLabel} · ${timeLabel}`,
        action: createElement(
          ToastAction,
          {
            altText: `View the off-site punch of ${employeeName}`,
            onClick: () => onViewPunch(row.id),
          },
          'View punch',
        ) as unknown as ToastActionElement,
      });
    }
    // Only new rows drive new toasts; toast/onViewPunch/formatInstant are
    // stable enough per render and re-running on them would re-scan rows
    // already marked seen without changing the outcome.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.data]);

  return query;
}
