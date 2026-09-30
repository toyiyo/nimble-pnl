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

const FLAG_RANK: Record<NonNullable<PunchLocationFlag>, number> = {
  unavailable: 1,
  offsite: 2,
};

/**
 * Returns true when the candidate distance is larger than the current one.
 * A missing distance must never win, and must never lose to a real
 * (even tiny) distance by comparing against a 0 default.
 */
function isFarther(candidate?: number | null, current?: number | null): boolean {
  if (candidate === null || candidate === undefined) {
    return false;
  }
  return current === null || current === undefined || candidate > current;
}

/**
 * Picks the one punch to show as a chip from a list of flagged punches.
 * Off-site outranks unavailable. Among off-site punches, the largest
 * distance wins. Returns null when the list has no flagged punch.
 */
export function worstLocationFlag(punches: TimePunch[]): TimePunch | null {
  let worst: TimePunch | null = null;
  let worstRank = 0;

  for (const punch of punches) {
    const flag = getPunchLocationFlag(punch.location);
    const rank = flag ? FLAG_RANK[flag] : 0;

    if (rank > worstRank) {
      worst = punch;
      worstRank = rank;
    } else if (
      flag === 'offsite' &&
      rank === worstRank &&
      isFarther(punch.location?.distance_meters, worst?.location?.distance_meters)
    ) {
      worst = punch;
    }
  }

  return worst;
}

/**
 * Picks the one punch to show as a chip for a group of sessions
 * (for example, all sessions of one employee on one day).
 */
export function worstLocationFlagForSessions(
  sessions: WorkSession[],
  index: LocationFlagIndex
): TimePunch | null {
  const flaggedPunches = sessions.flatMap((session) => sessionLocationFlags(session, index));
  return worstLocationFlag(flaggedPunches);
}
