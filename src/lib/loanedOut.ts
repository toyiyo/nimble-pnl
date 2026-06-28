import type { SlotCoverage, CoveringEmployee } from '@/types/scheduling';

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
