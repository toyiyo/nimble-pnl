import { clipShiftToWindow, parseTimeToMinutes } from '@/lib/shiftCoverage';
import type { CoverageShift, SlotCoverage, CoveringEmployee } from '@/types/scheduling';

/**
 * Options bag for computeLoanedOut. Mirrors the retired `ComputeSlotCoverageOptions`
 * (position/tz/area, formerly in shiftCoverage.ts), plus the window fields it no
 * longer receives positionally.
 */
export interface ComputeLoanedOutOptions {
  /** The position the slot requires (e.g. "Server"). */
  position: string;
  /** IANA timezone of the restaurant. */
  tz: string;
  /** "YYYY-MM-DD" — the local calendar date of the slot. */
  dateStr: string;
  /** "HH:MM:SS" or "HH:MM" — local start of the slot. */
  windowStart: string;
  /** "HH:MM:SS" or "HH:MM" — local end of the slot (may be < start for overnight). */
  windowEnd: string;
  /**
   * The template's own area. null / undefined => no loaned-out detection
   * (whole-restaurant, back-compat) — always returns [].
   */
  area?: string | null;
}

/**
 * Ghosts: employees whose home area is this slot's area but who are working a
 * *different* area during the window (loaned out elsewhere). Extracted
 * verbatim from `computeSlotCoverage`'s loaned-out branch — unlike
 * `computeCellFill`, this needs the **whole-floor** shift set for the day
 * (not just the template's own bucket), since the loan is only visible by
 * comparing home area against work area across all of that day's shifts.
 *
 * Never counted toward `openSpots` — purely informational.
 */
export function computeLoanedOut(shiftsForDay: CoverageShift[], options: ComputeLoanedOutOptions): CoveringEmployee[] {
  const { position, tz, dateStr, windowStart, windowEnd, area } = options;
  if (area === null || area === undefined) return [];

  const w0 = parseTimeToMinutes(windowStart);
  const w1raw = parseTimeToMinutes(windowEnd);
  // Overnight window: if end ≤ start, treat end as next-day (+1440)
  const w1 = w1raw <= w0 ? w1raw + 1440 : w1raw;

  const loanedOut: CoveringEmployee[] = [];
  for (const s of shiftsForDay) {
    if (s.position !== position) continue;
    if (s.status === 'cancelled') continue;
    if ((s.homeArea ?? null) !== area || (s.area ?? null) === area) continue;

    const clip = clipShiftToWindow(s, dateStr, tz, w0, w1);
    if (!clip) continue;

    loanedOut.push({
      employeeId: s.employee_id,
      employeeName: s.employee_name ?? null,
      homeArea: s.homeArea ?? null,
      workArea: s.area ?? null,
      startMin: clip.cs,
      endMin: clip.ce,
    });
  }
  loanedOut.sort((a, b) => a.startMin - b.startMin);
  return loanedOut;
}

/**
 * De-dup loaned-out ghosts to a single cell per (employee, day).
 *
 * Input: the per-cell coverage map (Map<templateId, Map<day, SlotCoverage>>),
 * whose `loanedOut` lists may repeat the same employee across overlapping
 * templates, plus a Map of templateId → start_time ("HH:MM:SS") for tie-breaks.
 *
 * Output: Map<`${templateId}:${day}`, CoveringEmployee[]> — each loaned-out
 * employee appears in exactly one cell: greatest clipped overlap, tie-break by
 * earliest template start, then templateId lexicographic.
 */
interface Candidate {
  templateId: string;
  day: string;
  emp: CoveringEmployee;
  overlap: number;
}

export function assignLoanedOutCell(
  coverageByTemplateDay: Map<string, Map<string, SlotCoverage>>,
  templateStartById: Map<string, string>,
): Map<string, CoveringEmployee[]> {
  // Group candidates by employee+day.
  const byEmpDay = new Map<string, Candidate[]>();
  for (const [templateId, byDay] of coverageByTemplateDay) {
    for (const [day, slot] of byDay) {
      for (const emp of slot.loanedOut) {
        const key = `${emp.employeeId}:${day}`;
        const cand: Candidate = { templateId, day, emp, overlap: emp.endMin - emp.startMin };
        const list = byEmpDay.get(key);
        if (list) list.push(cand);
        else byEmpDay.set(key, [cand]);
      }
    }
  }

  const result = new Map<string, CoveringEmployee[]>();
  for (const candidates of byEmpDay.values()) {
    let best = candidates[0];
    for (let i = 1; i < candidates.length; i++) {
      const c = candidates[i];
      if (c.overlap > best.overlap) { best = c; continue; }
      if (c.overlap < best.overlap) continue;
      // Use a high sentinel for missing starts so known-start templates win
      // the tie-break over templates with no start time recorded.
      const cs = templateStartById.get(c.templateId) ?? '\xFF';
      const bs = templateStartById.get(best.templateId) ?? '\xFF';
      if (cs < bs) { best = c; continue; }
      if (cs > bs) continue;
      if (c.templateId < best.templateId) best = c;
    }
    const cellKey = `${best.templateId}:${best.day}`;
    const list = result.get(cellKey);
    if (list) list.push(best.emp);
    else result.set(cellKey, [best.emp]);
  }
  return result;
}
