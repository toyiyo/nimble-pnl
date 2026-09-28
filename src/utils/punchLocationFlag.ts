import type { TimePunch } from '@/types/timeTracking';
import type { WorkSession } from '@/utils/timePunchProcessing';

export type PunchLocationFlag = 'offsite' | 'unavailable' | null;

export type LocationFlagIndex = Record<string, TimePunch[]>;

/**
 * Reads a punch's flag from its location field.
 * `location_unavailable` wins over the geofence check.
 */
export function getPunchLocationFlag(
  location: TimePunch['location']
): PunchLocationFlag {
  if (!location) {
    return null;
  }

  if (location.location_unavailable) {
    return 'unavailable';
  }

  if (location.within_geofence === false) {
    return 'offsite';
  }

  return null;
}

/**
 * Formats a distance in meters for display.
 * Below 1000 m, shows whole meters. From 1000 m, shows kilometers
 * with one decimal.
 */
export function formatDistance(meters: number): string {
  if (meters < 1000) {
    return `${Math.round(meters)} m`;
  }

  return `${(meters / 1000).toFixed(1)} km`;
}

/**
 * Builds an index of flagged punches, grouped by employee_id and
 * sorted by punch_time. Views use this index to avoid a scan of all
 * punches for each session.
 */
export function buildLocationFlagIndex(punches: TimePunch[]): LocationFlagIndex {
  const index: LocationFlagIndex = {};

  for (const punch of punches) {
    if (getPunchLocationFlag(punch.location) === null) {
      continue;
    }

    if (!index[punch.employee_id]) {
      index[punch.employee_id] = [];
    }

    index[punch.employee_id].push(punch);
  }

  for (const employeeId of Object.keys(index)) {
    index[employeeId].sort(
      (a, b) => new Date(a.punch_time).getTime() - new Date(b.punch_time).getTime()
    );
  }

  return index;
}

/**
 * Returns the flagged punches of one session's employee, between
 * clock_in and clock_out. An open session (no clock_out) uses now.
 */
export function sessionLocationFlags(
  session: WorkSession,
  index: LocationFlagIndex
): TimePunch[] {
  const employeePunches = index[session.employee_id];

  if (!employeePunches) {
    return [];
  }

  const start = session.clock_in.getTime();
  const end = (session.clock_out ?? new Date()).getTime();

  return employeePunches.filter((punch) => {
    const punchTime = new Date(punch.punch_time).getTime();
    return punchTime >= start && punchTime <= end;
  });
}
