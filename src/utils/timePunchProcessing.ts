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

/**
 * Step 1: Normalize punch stream
 * Removes noise and prepares punches for session identification
 */
export function normalizePunches(punches: TimePunch[]): ProcessedPunch[] {
  // Sort chronologically (oldest first for processing)
  const sorted = [...punches].sort((a, b) => 
    new Date(a.punch_time).getTime() - new Date(b.punch_time).getTime()
  );

  const processed: ProcessedPunch[] = [];
  let i = 0;

  while (i < sorted.length) {
    const current = sorted[i];
    const currentTime = new Date(current.punch_time);
    
    // Look ahead for noise patterns
    const noiseGroup: TimePunch[] = [current];
    let j = i + 1;
    
    // Collect punches within 60 seconds (potential noise)
    while (j < sorted.length) {
      const next = sorted[j];
      const nextTime = new Date(next.punch_time);
      const secondsDiff = differenceInSeconds(nextTime, currentTime);
      
      if (secondsDiff < 60) {
        noiseGroup.push(next);
        j++;
      } else {
        break;
      }
    }

    // Analyze noise group
    if (noiseGroup.length > 1) {
      // Multiple punches within 60 seconds
      if (noiseGroup.length >= 3) {
        // Burst noise - keep only the first meaningful punch
        processed.push({
          id: noiseGroup[0].id,
          employee_id: noiseGroup[0].employee_id,
          punch_type: noiseGroup[0].punch_type,
          punch_time: new Date(noiseGroup[0].punch_time),
          is_noise: false,
          original_punch: noiseGroup[0],
        });

        // Mark others as noise
        for (let k = 1; k < noiseGroup.length; k++) {
          processed.push({
            id: noiseGroup[k].id,
            employee_id: noiseGroup[k].employee_id,
            punch_type: noiseGroup[k].punch_type,
            punch_time: new Date(noiseGroup[k].punch_time),
            is_noise: true,
            noise_reason: 'Burst noise (>3 punches in 60s)',
            original_punch: noiseGroup[k],
          });
        }
      } else {
        // Two punches close together - keep both but analyze pattern
        const first = noiseGroup[0];
        const second = noiseGroup[1];
        
        // Break Start → Clock In within 2 minutes = break canceled
        if (first.punch_type === 'break_start' && second.punch_type === 'clock_in') {
          processed.push({
            id: first.id,
            employee_id: first.employee_id,
            punch_type: first.punch_type,
            punch_time: new Date(first.punch_time),
            is_noise: true,
            noise_reason: 'Break canceled',
            original_punch: first,
          });
          processed.push({
            id: second.id,
            employee_id: second.employee_id,
            punch_type: second.punch_type,
            punch_time: new Date(second.punch_time),
            is_noise: false,
            original_punch: second,
          });
        } else {
          // Keep both, mark second as potential duplicate
          processed.push({
            id: first.id,
            employee_id: first.employee_id,
            punch_type: first.punch_type,
            punch_time: new Date(first.punch_time),
            is_noise: false,
            original_punch: first,
          });
          processed.push({
            id: second.id,
            employee_id: second.employee_id,
            punch_type: second.punch_type,
            punch_time: new Date(second.punch_time),
            is_noise: true,
            noise_reason: 'Duplicate punch within 60s',
            original_punch: second,
          });
        }
      }
      
      i = j;
    } else {
      // Single punch, no noise
      processed.push({
        id: current.id,
        employee_id: current.employee_id,
        punch_type: current.punch_type,
        punch_time: new Date(current.punch_time),
        is_noise: false,
        original_punch: current,
      });
      i++;
    }
  }

  return processed;
}

/**
 * Step 2: Identify work sessions from normalized punches
 */
export function identifyWorkSessions(processedPunches: ProcessedPunch[]): WorkSession[] {
  // Filter out noise punches
  const validPunches = processedPunches.filter(p => !p.is_noise);
  
  // Group by employee
  const employeeGroups = new Map<string, ProcessedPunch[]>();
  validPunches.forEach(punch => {
    const existing = employeeGroups.get(punch.employee_id) || [];
    existing.push(punch);
    employeeGroups.set(punch.employee_id, existing);
  });

  const sessions: WorkSession[] = [];

  // Process each employee's punches
  employeeGroups.forEach((punches, employeeId) => {
    let i = 0;
    
    while (i < punches.length) {
      const punch = punches[i];
      
      // Sessions must start with clock_in
      if (punch.punch_type === 'clock_in') {
        const session: WorkSession = {
          sessionId: `${employeeId}-${punch.punch_time.getTime()}`,
          employee_id: employeeId,
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

        // Look for corresponding clock_out and breaks
        let j = i + 1;
        let currentBreakStart: Date | null = null;
        // foundClockOut ensures we only accept the first clock_out that closes this session
        let foundClockOut = false;

        while (j < punches.length) {
          const nextPunch = punches[j];

          // If we've already closed the session with a clock_out, stop scanning —
          // further clock_outs belong to either noise or a separate action and should not reopen this session.
          if (foundClockOut) {
            if (nextPunch.punch_type === 'clock_in') {
              // next clock_in starts a new session — stop scanning for this one
              break;
            }
            // ignore other punch types after a clock out for this session
            j++;
            continue;
          }

          if (nextPunch.punch_type === 'clock_out') {
            session.clock_out = nextPunch.punch_time;
            session.is_complete = true;
            foundClockOut = true;

            // Check for very short sessions (< 3 minutes)
            const sessionMinutes = differenceInMinutes(session.clock_out, session.clock_in);
            if (sessionMinutes < 3 && sessions.length > 0) {
              session.has_anomalies = true;
              session.anomalies.push('Very short session (< 3 min) - possible error');
            }

            // don't break immediately; keep loop semantics consistent — we will stop on next iteration
            // or when a new clock_in is encountered (handled above)
            j++;
            continue;
          } else if (nextPunch.punch_type === 'break_start') {
            currentBreakStart = nextPunch.punch_time;
          } else if (nextPunch.punch_type === 'break_end' && currentBreakStart) {
            // Only record break if it's within this session
            const breakDuration = differenceInMinutes(nextPunch.punch_time, currentBreakStart);
            session.breaks.push({
              break_start: currentBreakStart,
              break_end: nextPunch.punch_time,
              duration_minutes: breakDuration,
              is_complete: true,
            });
            currentBreakStart = null;
          } else if (nextPunch.punch_type === 'clock_in') {
            // If we're currently tracking a break start, a subsequent 'clock_in'
            // is often the break-ending action (some clients record break end as clock_in).
            // Treat that as a break_end here rather than starting a new session.
            if (currentBreakStart) {
              const breakDuration = differenceInMinutes(nextPunch.punch_time, currentBreakStart);
              session.breaks.push({
                break_start: currentBreakStart,
                break_end: nextPunch.punch_time,
                duration_minutes: breakDuration,
                is_complete: true,
              });
              currentBreakStart = null;
              // continue scanning for a clock_out for the current session
              j++;
              continue;
            }

            // Otherwise this is a new clock_in and the previous session had no clock_out
            session.has_anomalies = true;
            session.anomalies.push('Missing clock out');
            break;
          }
          
          j++;
        }

        // Handle incomplete break
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

        // Calculate totals
        if (session.clock_out) {
          session.total_minutes = differenceInMinutes(session.clock_out, session.clock_in);
          session.break_minutes = session.breaks.reduce((sum, b) => sum + b.duration_minutes, 0);
          session.worked_minutes = session.total_minutes - session.break_minutes;
        } else {
          session.has_anomalies = true;
          session.anomalies.push('Incomplete session (missing clock out)');
        }

        sessions.push(session);
        i = j + 1;
      } else {
        // Skip punches that don't start a session
        i++;
      }
    }
  });

  return sessions;
}

/**
 * Step 3: Calculate daily hours by employee
 */
export function calculateDailyHours(sessions: WorkSession[], date: Date): Map<string, DailyHoursData> {
  const dailyData = new Map<string, DailyHoursData>();

  sessions.forEach(session => {
    // Only include sessions from the specified date
    const sessionDate = new Date(session.clock_in);
    if (sessionDate.toDateString() !== date.toDateString()) {
      return;
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
  });

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
