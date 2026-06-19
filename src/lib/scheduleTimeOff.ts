import { format, parseISO } from 'date-fns';
import type { TimeOffRequest } from '@/types/scheduling';

/** A contiguous run of approved time-off days within the visualized week. */
export interface TimeOffSpan {
  startKey: string; // 'yyyy-MM-dd' first off-day of the run (within the week)
  endKey: string;   // 'yyyy-MM-dd' last off-day of the run
  dayCount: number;
  reasons: string[]; // distinct, non-empty reasons covering the run
}

/** Per-employee approved time off for the visualized week. */
export interface EmployeeWeekTimeOff {
  offDayKeys: Set<string>; // all in-week 'yyyy-MM-dd' that are off
  spans: TimeOffSpan[];    // contiguous runs, in weekDayKeys order
}

/** Normalize a DB date (DATE or accidental datetime) to 'yyyy-MM-dd'. */
const dayPart = (d: string): string => d.slice(0, 10);

/**
 * Build per-employee approved-time-off context for the visualized week.
 *
 * Overlap is computed by lexicographic comparison of 'yyyy-MM-dd' strings —
 * which sort identically to chronological order — so the result is timezone-safe
 * and never constructs a Date for matching (see lessons 2026-05-03 / 2026-05-10).
 *
 * @param requests    all time-off requests for the restaurant (any status)
 * @param weekDayKeys ordered 'yyyy-MM-dd' for the 7 visualized days, produced by
 *                    the SAME format(day,'yyyy-MM-dd') the grid uses to key cells
 * @returns Map keyed by employee_id; only employees with >=1 in-week off-day appear
 */
export function buildWeekTimeOff(
  requests: TimeOffRequest[],
  weekDayKeys: string[],
): Map<string, EmployeeWeekTimeOff> {
  // employee_id -> (dayKey -> set of reasons)
  const offByEmployee = new Map<string, Map<string, Set<string>>>();

  for (const req of requests) {
    if (req.status !== 'approved') continue;
    const start = dayPart(req.start_date);
    const end = dayPart(req.end_date);
    if (start > end) continue; // defensive; DB CHECK enforces end >= start
    for (const dayKey of weekDayKeys) {
      if (start <= dayKey && dayKey <= end) {
        let days = offByEmployee.get(req.employee_id);
        if (!days) {
          days = new Map();
          offByEmployee.set(req.employee_id, days);
        }
        let reasons = days.get(dayKey);
        if (!reasons) {
          reasons = new Set();
          days.set(dayKey, reasons);
        }
        const reason = req.reason?.trim();
        if (reason) reasons.add(reason);
      }
    }
  }

  const result = new Map<string, EmployeeWeekTimeOff>();
  for (const [employeeId, days] of offByEmployee) {
    result.set(employeeId, {
      offDayKeys: new Set(days.keys()),
      spans: buildSpans(weekDayKeys, days),
    });
  }
  return result;
}

function buildSpans(weekDayKeys: string[], days: Map<string, Set<string>>): TimeOffSpan[] {
  const spans: TimeOffSpan[] = [];
  let current: { startKey: string; endKey: string; dayCount: number; reasons: Set<string> } | null = null;

  const flush = () => {
    if (current) {
      spans.push({
        startKey: current.startKey,
        endKey: current.endKey,
        dayCount: current.dayCount,
        reasons: [...current.reasons],
      });
      current = null;
    }
  };

  for (const dayKey of weekDayKeys) {
    const reasons = days.get(dayKey);
    if (reasons) {
      if (current) {
        current.endKey = dayKey;
        current.dayCount += 1;
        reasons.forEach((r) => current!.reasons.add(r));
      } else {
        current = { startKey: dayKey, endKey: dayKey, dayCount: 1, reasons: new Set(reasons) };
      }
    } else {
      flush();
    }
  }
  flush();
  return spans;
}

/**
 * Summary for the name-cell chip + tooltip/AT text.
 * label: "Off Mon" (single) | "Off Wed–Fri" (one run) | "Off 3 days" (multiple runs).
 * Weekday abbr via parseISO (LOCAL midnight) + format('EEE') — used only for the
 * label, never for overlap. parseISO of a date-only string anchors to the correct
 * calendar weekday in any timezone (unlike `new Date(dateString)` which is UTC).
 */
export function summarizeOff(off: EmployeeWeekTimeOff): { label: string; reasons: string[] } {
  const reasons = [...new Set(off.spans.flatMap((s) => s.reasons))];
  let label: string;
  if (off.spans.length === 1) {
    const span = off.spans[0];
    const startAbbr = format(parseISO(span.startKey), 'EEE');
    label = span.dayCount === 1
      ? `Off ${startAbbr}`
      : `Off ${startAbbr}–${format(parseISO(span.endKey), 'EEE')}`; // en dash
  } else {
    label = `Off ${off.offDayKeys.size} days`;
  }
  return { label, reasons };
}
