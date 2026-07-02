import { useMemo } from 'react';
import { buildTimelineModel } from '@/lib/timelineModel';
import { type GroupByMode } from '@/lib/scheduleGrouping';
import type { Shift, Employee, HourlyStaffingRecommendation } from '@/types/scheduling';

// Pure logic lives in @/lib/timelineModel (measured by coverage). Re-exported
// here so existing component/test imports of these symbols keep resolving.
export {
  deriveWindow,
  buildLanes,
  expandDemand,
  computeGaps,
  buildTimelineModel,
  STEP_MIN,
} from '@/lib/timelineModel';
export type {
  TimelineWindow,
  TimelineBar,
  TimelineLane,
  TimelineGap,
  TimelineModel,
} from '@/lib/timelineModel';

/**
 * Derive the full timeline model for a single day, memoized so the object
 * reference is stable when inputs haven't changed. Thin hook over the pure
 * `buildTimelineModel` transform.
 */
export function useTimelineModel(
  shifts: Shift[],
  employees: Employee[],
  dateStr: string,
  tz: string,
  groupBy: GroupByMode,
  recommendations: HourlyStaffingRecommendation[],
) {
  return useMemo(
    () => buildTimelineModel(shifts, employees, dateStr, tz, groupBy, recommendations),
    [shifts, employees, dateStr, tz, groupBy, recommendations],
  );
}
