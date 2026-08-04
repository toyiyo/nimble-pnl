import { useMemo } from 'react';

import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useTemplateLinkedShifts } from '@/hooks/useTemplateLinkedShifts';

import type { ShiftTemplate } from '@/types/scheduling';

import { buildHoursChangeLedger, type HoursChangeLedger } from '@/lib/scheduling/hoursChangeCopy';
import { bucketTemplateShifts, type TemplateHoursBuckets } from '@/lib/scheduling/templateHoursBuckets';

interface UseTemplateHoursLedgerResult {
  impact: ReturnType<typeof useTemplateLinkedShifts>;
  buckets: TemplateHoursBuckets | null;
  ledger: HoursChangeLedger | null;
  /** Settled preview of `startTime`/`endTime` — see the hook body for why. */
  debouncedStart: string;
  debouncedEnd: string;
  affectedCount: number;
  /**
   * Published shifts among the shifts that will actually move: the moving
   * bucket's published ids plus any opted-in drifted row that is itself
   * published. The single source of truth for both the ledger's severity
   * and the "Notify N staff" checkbox — see `buildHoursChangeLedger`'s
   * `publishedCount` doc for why this can't be `buckets.publishedMovingIds`
   * alone.
   */
  publishedCount: number;
  hoursChanged: boolean;
  showCascadeChoice: boolean;
}

/**
 * Derives the hours-change ledger a manager sees while editing a template's
 * time range: fetches the shifts linked to the template, settles the typed
 * times into a debounced preview, buckets those shifts against old vs. new
 * hours, and turns the buckets into display-ready ledger copy.
 *
 * `template` undefined means "creating a new template" — every derived value
 * degenerates to its empty/false form in that case.
 */
export function useTemplateHoursLedger(
  restaurantId: string | null,
  template: ShiftTemplate | undefined,
  startTime: string,
  endTime: string,
  restaurantTimezone: string,
  selectedDriftIds: Set<string>,
): UseTemplateHoursLedgerResult {
  const impact = useTemplateLinkedShifts(restaurantId, template?.id ?? null);

  // Debounce the DERIVED state, never the controlled input — the field itself
  // must stay instant or it feels broken. <input type="time"> fires change per
  // component (hour, then minute), so an undebounced ledger would announce two
  // or three incoherent intermediate states per edit.
  const debouncedStart = useDebouncedValue(startTime, 300);
  const debouncedEnd = useDebouncedValue(endTime, 300);

  const buckets = useMemo(() => {
    if (!template) return null;
    return bucketTemplateShifts({
      shifts: impact.shifts,
      oldStart: template.start_time.substring(0, 5),
      oldEnd: template.end_time.substring(0, 5),
      newStart: debouncedStart,
      newEnd: debouncedEnd,
      tz: restaurantTimezone,
      now: new Date(),
    });
  }, [template, impact.shifts, debouncedStart, debouncedEnd, restaurantTimezone]);

  // Shared by the ledger's publishedCount/hoursDelta below and by the
  // standalone publishedCount this hook exposes to the "Notify" checkbox —
  // one filter, not two copies that could drift apart.
  const selectedDrift = useMemo(() => {
    if (!buckets) return [];
    return buckets.drifted.filter((d) => selectedDriftIds.has(d.shiftId));
  }, [buckets, selectedDriftIds]);

  // Published shifts among the shifts that will actually move: the moving
  // bucket's published ids plus any opted-in drifted row that is itself
  // published. `buckets.publishedMovingIds` alone would miss a manager
  // opting a posted drifted shift in — see hoursChangeCopy.ts's
  // publishedCount doc.
  const publishedCount = buckets
    ? buckets.publishedMovingIds.length + selectedDrift.filter((d) => d.isPublished).length
    : 0;

  const ledger = useMemo(() => {
    if (!template || !buckets) return null;
    return buildHoursChangeLedger({
      oldStart: template.start_time.substring(0, 5),
      oldEnd: template.end_time.substring(0, 5),
      newStart: debouncedStart,
      newEnd: debouncedEnd,
      movingCount: buckets.moving.length,
      publishedCount,
      // Sum, not double-count: impact.pastCount is shifts excluded up front
      // by the hook's server-side cutoff (never fetched as rows), while
      // buckets.past is shifts that were fetched as future but crossed `now`
      // before this memo recomputed. The two cutoffs share the same instant
      // per fetch, so a given shift can only ever land in one of the two.
      pastCount: buckets.past.length + impact.pastCount,
      lockedCount: buckets.locked.length,
      driftedCount: buckets.drifted.length,
      selectedDriftCount: selectedDrift.length,
      hoursDelta:
        buckets.movingHoursDelta + selectedDrift.reduce((sum, d) => sum + d.hoursDelta, 0),
    });
  }, [template, buckets, selectedDrift, publishedCount, debouncedStart, debouncedEnd, impact.pastCount]);

  const affectedCount = ledger?.totalAffected ?? 0;
  const hoursChanged = !!template &&
    (startTime !== template.start_time.substring(0, 5) || endTime !== template.end_time.substring(0, 5));
  // `hoursChanged` already implies `template` is set, so no separate isEdit check is needed here.
  const showCascadeChoice = hoursChanged && affectedCount > 0 && !impact.isLoading && !impact.error;

  return {
    impact,
    buckets,
    ledger,
    debouncedStart,
    debouncedEnd,
    affectedCount,
    publishedCount,
    hoursChanged,
    showCascadeChoice,
  };
}
