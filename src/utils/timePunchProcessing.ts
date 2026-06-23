import { TimePunch } from '@/types/timeTracking';
import { differenceInMinutes, differenceInSeconds } from 'date-fns';

export interface ProcessedPunch {
  id: string;
  employee_id: string;
  punch_type: 'clock_in' | 'clock_out' | 'break_start' | 'break_end';
  punch_time: Date;
  is_noise: boolean;
  noise_reason?: string;
  original_punch: TimePunch;
}

export interface WorkSession {
  sessionId: string;
  employee_id: string;
  employee_name: string;
  clock_in: Date;
  clock_out?: Date;
  breaks: BreakPeriod[];
  total_minutes: number;
  break_minutes: number;
  worked_minutes: number;
  is_complete: boolean;
  has_anomalies: boolean;
  anomalies: string[];
}

export interface BreakPeriod {
  break_start: Date;
  break_end?: Date;
  duration_minutes: number;
  is_complete: boolean;
}

export interface DailyHoursData {
  date: Date;
  employee_id: string;
  employee_name: string;
  sessions: WorkSession[];
  total_worked_hours: number;
  total_break_hours: number;
  total_hours: number;
  punch_count: number;
}

/** Create a ProcessedPunch record with is_noise=false */
function toValidPunch(p: TimePunch): ProcessedPunch {
  return {
    id: p.id,
    employee_id: p.employee_id,
    punch_type: p.punch_type,
    punch_time: new Date(p.punch_time),
    is_noise: false,
    original_punch: p,
  };
}

/** Create a ProcessedPunch record marked as noise */
function toNoisePunch(p: TimePunch, noise_reason: string): ProcessedPunch {
  return {
    id: p.id,
    employee_id: p.employee_id,
    punch_type: p.punch_type,
    punch_time: new Date(p.punch_time),
    is_noise: true,
    noise_reason,
    original_punch: p,
  };
}

/**
 * Analyse a group of 2+ punches that arrived within 60 s and emit
 * ProcessedPunch records for them.  Called only from normalizeEmployeePunches.
 */
function processNoiseGroup(group: TimePunch[]): ProcessedPunch[] {
  const result: ProcessedPunch[] = [];

  if (group.length >= 3) {
    // Burst noise — keep first, mark the rest as noise
    result.push(toValidPunch(group[0]));
    for (let k = 1; k < group.length; k++) {
      result.push(toNoisePunch(group[k], 'Burst noise (>3 punches in 60s)'));
    }
    return result;
  }

  // Exactly two punches close together
  const [first, second] = group;

  // Break Start → Clock In within 60 s = break canceled
  if (first.punch_type === 'break_start' && second.punch_type === 'clock_in') {
    result.push(toNoisePunch(first, 'Break canceled'));
    result.push(toValidPunch(second));
  } else {
    // Keep first, mark second as a duplicate
    result.push(toValidPunch(first));
    result.push(toNoisePunch(second, 'Duplicate punch within 60s'));
  }

  return result;
}

/**
 * Step 1 (per-employee): Normalize punch stream for a SINGLE employee.
 * Removes per-employee noise (fat-finger double-taps, burst events).
 * Input punches must all belong to the same employee and be sorted
 * chronologically ascending — callers are responsible for both.
 * Internal helper: always called via normalizePunches, never directly.
 */
function normalizeEmployeePunches(punches: TimePunch[]): ProcessedPunch[] {
  const processed: ProcessedPunch[] = [];
  let i = 0;

  while (i < punches.length) {
    const current = punches[i];
    const currentTime = new Date(current.punch_time);

    // Collect punches within 60 seconds (potential noise)
    const noiseGroup: TimePunch[] = [current];
    let j = i + 1;
    while (j < punches.length) {
      const next = punches[j];
      const secondsDiff = differenceInSeconds(new Date(next.punch_time), currentTime);
      if (secondsDiff < 60) {
        noiseGroup.push(next);
        j++;
      } else {
        break;
      }
    }

    if (noiseGroup.length > 1) {
      processed.push(...processNoiseGroup(noiseGroup));
      i = j;
    } else {
      processed.push(toValidPunch(current));
      i++;
    }
  }

  return processed;
}

/**
 * Step 1: Normalize punch stream for ALL employees.
 * Buckets punches by employee_id, runs normalizeEmployeePunches on each
 * bucket, and concatenates results. This ensures the 60-second noise
 * window never collapses punches belonging to different employees — which
 * would happen if the whole restaurant stream were deduplicated globally.
 */
export function normalizePunches(punches: TimePunch[]): ProcessedPunch[] {
  // Bucket by employee, preserving insertion order for Map iteration
  const buckets = new Map<string, TimePunch[]>();
  for (const punch of punches) {
    const bucket = buckets.get(punch.employee_id);
    if (bucket) {
      bucket.push(punch);
    } else {
      buckets.set(punch.employee_id, [punch]);
    }
  }

  const result: ProcessedPunch[] = [];
  for (const bucket of buckets.values()) {
    // Sort each employee's punches chronologically before normalizing
    bucket.sort((a, b) => new Date(a.punch_time).getTime() - new Date(b.punch_time).getTime());
    result.push(...normalizeEmployeePunches(bucket));
  }

  return result;
}

/** Build an empty WorkSession anchored to the given clock_in punch */
function startSession(punch: ProcessedPunch): WorkSession {
  return {
    sessionId: `${punch.employee_id}-${punch.punch_time.getTime()}`,
    employee_id: punch.employee_id,
    employee_name: punch.original_punch.employee?.name || 'Unknown',
    clock_in: punch.punch_time,
    clock_out: undefined,
    breaks: [],
    total_minutes: 0,
    break_minutes: 0,
    worked_minutes: 0,
    is_complete: false,
    has_anomalies: false,
    anomalies: [],
  };
}

/** Finalize time totals and add anomalies for a completed/incomplete session */
function finalizeSession(session: WorkSession): void {
  if (session.clock_out) {
    session.total_minutes = differenceInMinutes(session.clock_out, session.clock_in);
    session.break_minutes = session.breaks.reduce((sum, b) => sum + b.duration_minutes, 0);
    session.worked_minutes = session.total_minutes - session.break_minutes;
  } else {
    session.has_anomalies = true;
    session.anomalies.push('Incomplete session (missing clock out)');
  }
}

/**
 * Scan one employee's punches starting after a clock_in and fill the session.
 * Returns the index j pointing at the next unprocessed punch.
 */
function fillSession(session: WorkSession, punches: ProcessedPunch[], startIndex: number): number {
  let j = startIndex;
  let currentBreakStart: Date | null = null;
  let foundClockOut = false;

  while (j < punches.length) {
    const next = punches[j];

    if (foundClockOut) {
      // Session is closed — a new clock_in starts a new session
      if (next.punch_type === 'clock_in') break;
      j++;
      continue;
    }

    if (next.punch_type === 'clock_out') {
      session.clock_out = next.punch_time;
      session.is_complete = true;
      foundClockOut = true;

      // Flag very short sessions (< 3 minutes)
      const sessionMinutes = differenceInMinutes(session.clock_out, session.clock_in);
      if (sessionMinutes < 3) {
        session.has_anomalies = true;
        session.anomalies.push('Very short session (< 3 min) - possible error');
      }

      j++;
      continue;
    }

    if (next.punch_type === 'break_start') {
      currentBreakStart = next.punch_time;
    } else if (next.punch_type === 'break_end' && currentBreakStart) {
      const breakDuration = differenceInMinutes(next.punch_time, currentBreakStart);
      session.breaks.push({
        break_start: currentBreakStart,
        break_end: next.punch_time,
        duration_minutes: breakDuration,
        is_complete: true,
      });
      currentBreakStart = null;
    } else if (next.punch_type === 'clock_in') {
      if (currentBreakStart) {
        // Some clients record break-end as a clock_in — treat it that way
        const breakDuration = differenceInMinutes(next.punch_time, currentBreakStart);
        session.breaks.push({
          break_start: currentBreakStart,
          break_end: next.punch_time,
          duration_minutes: breakDuration,
          is_complete: true,
        });
        currentBreakStart = null;
        j++;
        continue;
      }
      // A new clock_in with no preceding break_start means the session lacked a clock_out
      session.has_anomalies = true;
      session.anomalies.push('Missing clock out');
      break;
    }

    j++;
  }

  // Handle an incomplete break still in progress at end-of-scan
  if (currentBreakStart && session.clock_out) {
    session.breaks.push({
      break_start: currentBreakStart,
      break_end: undefined,
      duration_minutes: 0,
      is_complete: false,
    });
    session.has_anomalies = true;
    session.anomalies.push('Incomplete break (missing break end)');
  }

  return j;
}

/**
 * Step 2: Identify work sessions from normalized punches
 */
export function identifyWorkSessions(processedPunches: ProcessedPunch[]): WorkSession[] {
  // Filter out noise punches
  const validPunches = processedPunches.filter(p => !p.is_noise);

  // Group by employee
  const employeeGroups = new Map<string, ProcessedPunch[]>();
  for (const punch of validPunches) {
    const group = employeeGroups.get(punch.employee_id);
    if (group) {
      group.push(punch);
    } else {
      employeeGroups.set(punch.employee_id, [punch]);
    }
  }

  const sessions: WorkSession[] = [];

  for (const [, punches] of employeeGroups) {
    let i = 0;

    while (i < punches.length) {
      const punch = punches[i];

      if (punch.punch_type === 'clock_in') {
        const session = startSession(punch);
        // Use i = j (not j + 1): when fillSession breaks, j already points
        // at the next unprocessed punch (e.g. the next clock_in). Advancing
        // with j + 1 would skip it, losing back-to-back sessions.
        i = fillSession(session, punches, i + 1);
        finalizeSession(session);
        sessions.push(session);
      } else {
        // Skip punches that don't start a session
        i++;
      }
    }
  }

  return sessions;
}

/**
 * Step 3: Calculate daily hours by employee
 */
export function calculateDailyHours(sessions: WorkSession[], date: Date): Map<string, DailyHoursData> {
  const dailyData = new Map<string, DailyHoursData>();

  for (const session of sessions) {
    // Only include sessions from the specified date
    const sessionDate = new Date(session.clock_in);
    if (sessionDate.toDateString() !== date.toDateString()) {
      continue;
    }

    const existing = dailyData.get(session.employee_id);

    if (existing) {
      existing.sessions.push(session);
      existing.total_worked_hours += session.worked_minutes / 60;
      existing.total_break_hours += session.break_minutes / 60;
      existing.total_hours += session.total_minutes / 60;
      existing.punch_count += 2; // At minimum clock in/out
      existing.punch_count += session.breaks.length * 2; // Break start/end
    } else {
      dailyData.set(session.employee_id, {
        date,
        employee_id: session.employee_id,
        employee_name: session.employee_name,
        sessions: [session],
        total_worked_hours: session.worked_minutes / 60,
        total_break_hours: session.break_minutes / 60,
        total_hours: session.total_minutes / 60,
        punch_count: 2 + (session.breaks.length * 2),
      });
    }
  }

  return dailyData;
}

/**
 * Process all punches for a given date range
 */
export function processPunchesForPeriod(punches: TimePunch[]): {
  processedPunches: ProcessedPunch[];
  sessions: WorkSession[];
  totalNoisePunches: number;
  totalAnomalies: number;
} {
  const processedPunches = normalizePunches(punches);
  const sessions = identifyWorkSessions(processedPunches);

  const totalNoisePunches = processedPunches.filter(p => p.is_noise).length;
  const totalAnomalies = sessions.filter(s => s.has_anomalies).length;

  return {
    processedPunches,
    sessions,
    totalNoisePunches,
    totalAnomalies,
  };
}
