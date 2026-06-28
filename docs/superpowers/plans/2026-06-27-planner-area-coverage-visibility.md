# Planner area-coverage visibility — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every scheduled person visible on the co-branded planner — as a chip or in the coverage popover — with `area` as a first-class grouping (covering chips, loaned-out ghosts, off-template lane, area-grouped popover).

**Architecture:** Two area facets per shift — `workArea` (template area, else employee area) and `homeArea` (employee area). The pure coverage engine (`shiftCoverage.ts`) gains a `loanedOut` list and tags covering employees with both areas; counting math is unchanged. Pure helpers (`assignLoanedOutCell`, `groupUnmatchedByArea`) drive de-duped ghosts and the off-template lane. Presentational changes in `EmployeeChip`, `ShiftCell`, `TemplateGrid`, `CoverageDetail`, wired in `ShiftPlannerTab`.

**Tech Stack:** React 18 + TS, Vitest, Tailwind/shadcn, dnd-kit. No DB/SQL changes.

**Design doc:** `docs/superpowers/specs/2026-06-27-planner-area-coverage-visibility-design.md`

---

## File map

- Modify `src/types/scheduling.ts` — add `homeArea`/`workArea` to `CoverageShift`/`CoveringEmployee`; add `loanedOut` to `SlotCoverage`.
- Modify `src/lib/shiftCoverage.ts` — tag covering employees; compute `loanedOut`.
- Create `src/lib/loanedOut.ts` — pure `assignLoanedOutCell` de-dup helper.
- Modify `src/hooks/useShiftPlanner.ts` — add pure `groupUnmatchedByArea` helper.
- Modify `src/components/scheduling/ShiftPlanner/EmployeeChip.tsx` — covering badge + comparator.
- Create `src/components/scheduling/ShiftPlanner/OffTemplateRow.tsx` — read-only off-template cells.
- Modify `src/components/scheduling/ShiftPlanner/ShiftCell.tsx` — `cellArea`, `homeArea` on chips; `ghostLoanedOut` ghosts; comparator.
- Modify `src/components/scheduling/ShiftPlanner/TemplateGrid.tsx` — off-template rows; thread `ghostByCell`.
- Modify `src/components/scheduling/ShiftPlanner/CoverageDetail.tsx` — `slotArea`, area-grouped list, loaned-out group, header wording.
- Modify `src/components/scheduling/ShiftPlanner/ShiftPlannerTab.tsx` — `homeArea` in coverage shifts; build ghost map; pass `slotArea`.
- Tests: `tests/unit/shiftCoverage.test.ts`, `tests/unit/loanedOut.test.ts` (new), `tests/unit/useShiftPlanner.test.ts`, `tests/unit/coverageGrouping.test.ts` (new).

---

## Task 1: Extend coverage types

**Files:**
- Modify: `src/types/scheduling.ts` (CoverageShift ~L390, CoveringEmployee ~L410, SlotCoverage ~L418)

- [ ] **Step 1: Edit the three interfaces**

In `CoverageShift`, after the existing `area?` field, add:
```ts
  /** Employee's home area (shift.employee.area). Distinct from `area` (work area).
   *  Set by ShiftPlannerTab; used to compute covering vs loaned-out. */
  homeArea?: string | null;
```

Replace `CoveringEmployee` with:
```ts
export interface CoveringEmployee {
  employeeId: string;
  employeeName?: string | null;
  startMin: number; // clipped to [w0, w1]
  endMin: number;
  /** Employee's home area. */
  homeArea?: string | null;
  /** Where the shift is worked (slot/work area). */
  workArea?: string | null;
}
```

In `SlotCoverage`, after `coveringEmployees`, add:
```ts
  /** Employees whose home area == this slot's area but who are working a
   *  different area during the window (loaned out). Empty when slot area is null.
   *  Does NOT affect minConcurrent/openSpots. */
  loanedOut: CoveringEmployee[];
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: errors only in `shiftCoverage.ts` (missing `loanedOut` in returned object) — confirms the type is now required. Proceed to Task 2 to satisfy it.

- [ ] **Step 3: Commit**

```bash
git add src/types/scheduling.ts
git commit -m "feat(scheduling): add home/work area + loanedOut to coverage types"
```

---

## Task 2: Coverage engine — tag covering employees + compute loanedOut

**Files:**
- Modify: `src/lib/shiftCoverage.ts` (Clip interface ~L73; clip loop ~L126; coveringEmployees ~L194; return ~L203)
- Test: `tests/unit/shiftCoverage.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `tests/unit/shiftCoverage.test.ts` (inside the top-level `describe`):
```ts
  describe('area facets: covering + loanedOut', () => {
    const tz = 'America/Chicago';
    // Wetzel's Close slot 16:00-23:30 on 2026-07-04 (Sat)
    const slot = ['16:00:00', '23:30:00', 2, '2026-07-04'] as const;

    function shift(over: Partial<CoverageShift>): CoverageShift {
      return {
        employee_id: 'e1', employee_name: 'Termora',
        start_time: '2026-07-04T21:00:00Z', end_time: '2026-07-05T04:30:00Z',
        position: 'Server', status: 'scheduled', area: "Wetzel's", homeArea: 'Cold Stone',
        ...over,
      };
    }

    it('tags coveringEmployees with homeArea and workArea', () => {
      const cov = computeSlotCoverage(...slot, [shift({})], { position: 'Server', tz, area: "Wetzel's" });
      expect(cov.coveringEmployees).toHaveLength(1);
      expect(cov.coveringEmployees[0].homeArea).toBe('Cold Stone');
      expect(cov.coveringEmployees[0].workArea).toBe("Wetzel's");
    });

    it('populates loanedOut for the home-area slot and excludes from openSpots', () => {
      // Cold Stone Close slot, same window. Termora homeArea=Cold Stone, workArea=Wetzel's.
      const cov = computeSlotCoverage('16:00:00', '23:30:00', 4, '2026-07-04', [shift({})], { position: 'Server', tz, area: 'Cold Stone' });
      // She does NOT fill a Cold Stone spot:
      expect(cov.coveringEmployees).toHaveLength(0);
      expect(cov.openSpots).toBe(4);
      // ...but is surfaced as loaned out:
      expect(cov.loanedOut).toHaveLength(1);
      expect(cov.loanedOut[0].employeeId).toBe('e1');
      expect(cov.loanedOut[0].workArea).toBe("Wetzel's");
      expect(cov.loanedOut[0].endMin - cov.loanedOut[0].startMin).toBeGreaterThan(0);
    });

    it('loanedOut is empty when slot area is null (whole-restaurant)', () => {
      const cov = computeSlotCoverage(...slot, [shift({})], { position: 'Server', tz });
      expect(cov.loanedOut).toEqual([]);
    });

    it('same-area shift is neither covering-tagged-cross nor loaned out', () => {
      const cov = computeSlotCoverage(...slot, [shift({ area: "Wetzel's", homeArea: "Wetzel's" })], { position: 'Server', tz, area: "Wetzel's" });
      expect(cov.coveringEmployees[0].homeArea).toBe("Wetzel's");
      expect(cov.loanedOut).toEqual([]);
    });
  });
```

- [ ] **Step 2: Run — verify fail**

Run: `npx vitest run tests/unit/shiftCoverage.test.ts`
Expected: FAIL (`loanedOut` undefined; `homeArea`/`workArea` undefined on entries).

- [ ] **Step 3: Implement**

In `src/lib/shiftCoverage.ts`:

(a) Extend `Clip` (~L73):
```ts
interface Clip {
  employeeId: string;
  employeeName?: string | null;
  homeArea?: string | null;
  workArea?: string | null;
  cs: number; // clipped start (minutes from local midnight)
  ce: number; // clipped end
}
```

(b) In the clip loop, change the push (the line `clips.push({ employeeId: s.employee_id, employeeName: s.employee_name ?? null, cs, ce });`) to:
```ts
      clips.push({
        employeeId: s.employee_id,
        employeeName: s.employee_name ?? null,
        homeArea: s.homeArea ?? null,
        workArea: s.area ?? null,
        cs,
        ce,
      });
```

(c) Build the loaned-out list. Immediately AFTER the `coveringEmployees` block (after its `.sort(...)`), add:
```ts
  // Loaned out: employees whose HOME area is this slot's area but who are
  // working a different area during the window. Only when slot area is set.
  const loanedOut: CoveringEmployee[] = [];
  if (options.area != null) {
    for (const s of shifts) {
      if (s.position !== position) continue;
      if (s.status === 'cancelled') continue;
      if ((s.homeArea ?? null) !== options.area) continue; // must be from this area
      if ((s.area ?? null) === options.area) continue;      // and working elsewhere
      const ds = isoToLocalMinutes(s.start_time, dateStr, tz);
      let de = isoToLocalMinutes(s.end_time, dateStr, tz);
      if (de <= ds) de += 1440;
      const cs = Math.max(w0, ds);
      const ce = Math.min(w1, de);
      if (cs < ce) {
        loanedOut.push({
          employeeId: s.employee_id,
          employeeName: s.employee_name ?? null,
          homeArea: s.homeArea ?? null,
          workArea: s.area ?? null,
          startMin: cs,
          endMin: ce,
        });
      }
    }
    loanedOut.sort((a, b) => a.startMin - b.startMin);
  }
```

(d) Update the `coveringEmployees` map to carry the new fields:
```ts
  const coveringEmployees: CoveringEmployee[] = clips
    .map((c) => ({
      employeeId: c.employeeId,
      employeeName: c.employeeName ?? null,
      homeArea: c.homeArea ?? null,
      workArea: c.workArea ?? null,
      startMin: c.cs,
      endMin: c.ce,
    }))
    .sort((a, b) => a.startMin - b.startMin);
```

(e) Add `loanedOut` to the returned object (after `coveringEmployees,`):
```ts
    loanedOut,
```

- [ ] **Step 4: Run — verify pass (incl. all pre-existing)**

Run: `npx vitest run tests/unit/shiftCoverage.test.ts`
Expected: PASS — all new + 20 pre-existing tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/shiftCoverage.ts tests/unit/shiftCoverage.test.ts
git commit -m "feat(scheduling): coverage engine tags covering + computes loanedOut"
```

---

## Task 3: `assignLoanedOutCell` de-dup helper

**Files:**
- Create: `src/lib/loanedOut.ts`
- Test: `tests/unit/loanedOut.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/unit/loanedOut.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { assignLoanedOutCell } from '@/lib/loanedOut';
import type { SlotCoverage, CoveringEmployee } from '@/types/scheduling';

function cov(loaned: CoveringEmployee[]): SlotCoverage {
  return { minConcurrent: 0, openSpots: 0, coveragePct: 0, segments: [], coveringEmployees: [], loanedOut: loaned };
}
const e = (over: Partial<CoveringEmployee>): CoveringEmployee => ({
  employeeId: 'e1', employeeName: 'Termora', startMin: 960, endMin: 1410, workArea: "Wetzel's", ...over,
});

describe('assignLoanedOutCell', () => {
  it('places a loaned employee in exactly one cell (greatest overlap wins)', () => {
    // 'open' cell: 30 min overlap; 'close' cell: 450 min overlap. Same day.
    const map = new Map<string, Map<string, SlotCoverage>>([
      ['open', new Map([['2026-07-04', cov([e({ startMin: 960, endMin: 990 })])]])],
      ['close', new Map([['2026-07-04', cov([e({ startMin: 960, endMin: 1410 })])]])],
    ]);
    const starts = new Map([['open', '10:00:00'], ['close', '16:00:00']]);
    const result = assignLoanedOutCell(map, starts);
    expect(result.get('open:2026-07-04')).toBeUndefined();
    expect(result.get('close:2026-07-04')?.map((x) => x.employeeId)).toEqual(['e1']);
  });

  it('tie-breaks equal overlap by earliest template start', () => {
    const map = new Map<string, Map<string, SlotCoverage>>([
      ['b', new Map([['2026-07-04', cov([e({ startMin: 960, endMin: 1410 })])]])],
      ['a', new Map([['2026-07-04', cov([e({ startMin: 960, endMin: 1410 })])]])],
    ]);
    const starts = new Map([['a', '08:00:00'], ['b', '16:00:00']]);
    const result = assignLoanedOutCell(map, starts);
    expect(result.get('a:2026-07-04')).toHaveLength(1);
    expect(result.get('b:2026-07-04')).toBeUndefined();
  });

  it('keeps different employees and different days independent', () => {
    const map = new Map<string, Map<string, SlotCoverage>>([
      ['close', new Map([
        ['2026-07-04', cov([e({ employeeId: 'e1' }), e({ employeeId: 'e2', employeeName: 'Sam' })])],
        ['2026-07-05', cov([e({ employeeId: 'e1' })])],
      ])],
    ]);
    const starts = new Map([['close', '16:00:00']]);
    const result = assignLoanedOutCell(map, starts);
    expect(result.get('close:2026-07-04')).toHaveLength(2);
    expect(result.get('close:2026-07-05')).toHaveLength(1);
  });

  it('returns empty map when there is no loaned-out data', () => {
    const map = new Map<string, Map<string, SlotCoverage>>([
      ['open', new Map([['2026-07-04', cov([])]])],
    ]);
    expect(assignLoanedOutCell(map, new Map()).size).toBe(0);
  });
});
```

- [ ] **Step 2: Run — verify fail**

Run: `npx vitest run tests/unit/loanedOut.test.ts`
Expected: FAIL (`assignLoanedOutCell` not found).

- [ ] **Step 3: Implement**

Create `src/lib/loanedOut.ts`:
```ts
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
export function assignLoanedOutCell(
  coverageByTemplateDay: Map<string, Map<string, SlotCoverage>>,
  templateStartById: Map<string, string>,
): Map<string, CoveringEmployee[]> {
  interface Candidate {
    templateId: string;
    day: string;
    emp: CoveringEmployee;
    overlap: number;
  }
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
    for (const c of candidates.slice(1)) {
      if (c.overlap > best.overlap) { best = c; continue; }
      if (c.overlap < best.overlap) continue;
      const cs = templateStartById.get(c.templateId) ?? '';
      const bs = templateStartById.get(best.templateId) ?? '';
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
```

- [ ] **Step 4: Run — verify pass**

Run: `npx vitest run tests/unit/loanedOut.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/loanedOut.ts tests/unit/loanedOut.test.ts
git commit -m "feat(scheduling): assignLoanedOutCell de-dup helper for ghost placement"
```

---

## Task 4: `groupUnmatchedByArea` helper

**Files:**
- Modify: `src/hooks/useShiftPlanner.ts` (add export near `buildTemplateGridData`)
- Test: `tests/unit/useShiftPlanner.test.ts`

- [ ] **Step 1: Write failing test**

Append to `tests/unit/useShiftPlanner.test.ts`:
```ts
  describe('groupUnmatchedByArea', () => {
    const mk = (id: string, area: string | undefined): Shift => ({
      id, restaurant_id: 'r', employee_id: id, start_time: '2026-06-30T15:00:00Z',
      end_time: '2026-06-30T19:30:00Z', break_duration: 0, position: 'Server',
      status: 'scheduled', is_published: false, locked: false, source: 'manual',
      created_at: '', updated_at: '',
      employee: { id, name: id, area, position: 'Server' } as Shift['employee'],
    });

    it('groups unmatched shifts by employee area; null area under Unassigned', () => {
      const unmatched = new Map<string, Shift[]>([
        ['2026-06-30', [mk('a', 'Cold Stone'), mk('b', "Wetzel's"), mk('c', undefined)]],
      ]);
      const out = groupUnmatchedByArea(unmatched);
      expect(out.get('Cold Stone')?.get('2026-06-30')?.map((s) => s.id)).toEqual(['a']);
      expect(out.get("Wetzel's")?.get('2026-06-30')?.map((s) => s.id)).toEqual(['b']);
      expect(out.get('Unassigned')?.get('2026-06-30')?.map((s) => s.id)).toEqual(['c']);
    });

    it('returns empty map for empty input', () => {
      expect(groupUnmatchedByArea(new Map()).size).toBe(0);
    });
  });
```

Ensure the file imports `Shift` (it already imports from `@/types/scheduling` — confirm `Shift` is in the import; add if missing). Add `groupUnmatchedByArea` to the existing import from `@/hooks/useShiftPlanner`.

- [ ] **Step 2: Run — verify fail**

Run: `npx vitest run tests/unit/useShiftPlanner.test.ts`
Expected: FAIL (`groupUnmatchedByArea` not exported).

- [ ] **Step 3: Implement**

In `src/hooks/useShiftPlanner.ts`, after `buildTemplateGridData`, add (reuse `UNASSIGNED`):
```ts
import { UNASSIGNED } from '@/lib/templateAreaGrouping';

/**
 * Group the '__unmatched__' bucket (Map<day, Shift[]>) by employee work area.
 * Shifts with no employee area fall under UNASSIGNED. Returns
 * Map<area, Map<day, Shift[]>>. Pure; drives the off-template lane rows.
 */
export function groupUnmatchedByArea(
  unmatchedByDay: Map<string, Shift[]>,
): Map<string, Map<string, Shift[]>> {
  const out = new Map<string, Map<string, Shift[]>>();
  for (const [day, shifts] of unmatchedByDay) {
    for (const shift of shifts) {
      const area = shift.employee?.area ?? UNASSIGNED;
      let byDay = out.get(area);
      if (!byDay) { byDay = new Map(); out.set(area, byDay); }
      const list = byDay.get(day);
      if (list) list.push(shift);
      else byDay.set(day, [shift]);
    }
  }
  return out;
}
```
(Place the `import { UNASSIGNED }` with the other imports at the top of the file.)

- [ ] **Step 4: Run — verify pass**

Run: `npx vitest run tests/unit/useShiftPlanner.test.ts`
Expected: PASS — new tests + all 43 pre-existing green.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useShiftPlanner.ts tests/unit/useShiftPlanner.test.ts
git commit -m "feat(scheduling): groupUnmatchedByArea helper for off-template lane"
```

---

## Task 5: Covering badge in `EmployeeChip`

**Files:**
- Modify: `src/components/scheduling/ShiftPlanner/EmployeeChip.tsx`

- [ ] **Step 1: Add props, badge, dashed border, comparator**

(a) Extend `EmployeeChipProps`:
```ts
interface EmployeeChipProps {
  employeeName: string;
  shiftId: string;
  position: string;
  source?: Shift['source'];
  /** Employee's home area. */
  homeArea?: string | null;
  /** The area of the cell this chip renders in (template area). */
  cellArea?: string | null;
  onRemove: (shiftId: string) => void;
}
```

(b) In the component params add `homeArea`, `cellArea`. Compute covering:
```ts
    const colors = getColors(position);
    const isCovering = !!homeArea && !!cellArea && homeArea !== cellArea;
```

(c) Add `isCovering && 'border-dashed'` to the chip container `cn(...)` (after the color classes). Insert the origin badge right before the `<span className="truncate">`:
```tsx
        {isCovering && (
          <span
            className="shrink-0 truncate max-w-[72px] text-[10px] px-1 rounded bg-muted/50 text-muted-foreground"
            title={`Covering from ${homeArea}`}
          >
            {homeArea}
          </span>
        )}
```

(d) Update the Remove button `aria-label`:
```tsx
          aria-label={isCovering
            ? `Remove ${employeeName} from shift (covering from ${homeArea})`
            : `Remove ${employeeName} from shift`}
```

(e) Add to the memo comparator (inside the `(prev, next) => ...` return):
```ts
    prev.homeArea === next.homeArea &&
    prev.cellArea === next.cellArea &&
```

- [ ] **Step 2: Typecheck + lint**

Run: `npx tsc --noEmit && npx eslint src/components/scheduling/ShiftPlanner/EmployeeChip.tsx`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/scheduling/ShiftPlanner/EmployeeChip.tsx
git commit -m "feat(scheduling): covering badge + dashed border on EmployeeChip"
```

---

## Task 6: `OffTemplateRow` read-only component

**Files:**
- Create: `src/components/scheduling/ShiftPlanner/OffTemplateRow.tsx`

- [ ] **Step 1: Implement (no useDroppable — read-only)**

Create `src/components/scheduling/ShiftPlanner/OffTemplateRow.tsx`:
```tsx
import { Clock, X } from 'lucide-react';

import type { Shift } from '@/types/scheduling';
import { cn } from '@/lib/utils';
import { formatLocalTime } from '@/hooks/useShiftPlanner';

interface OffTemplateRowProps {
  area: string;
  weekDays: string[];
  /** Map<day, Shift[]> for this area's unmatched shifts. */
  shiftsByDay: Map<string, Shift[]>;
  onRemoveShift: (shiftId: string) => void;
}

/** Compact 12h label from "HH:MM:SS", e.g. "13:00:00" -> "1:00p". */
function compact(t: string): string {
  const [h, m] = t.split(':').map(Number);
  const ampm = h >= 12 ? 'p' : 'a';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${h12}${ampm}` : `${h12}:${String(m).padStart(2, '0')}${ampm}`;
}

/** Read-only lane that surfaces shifts not bound to any active template.
 *  Renders the row label + 7 day cells; NOT a drag target. */
export function OffTemplateRow({ area, weekDays, shiftsByDay, onRemoveShift }: Readonly<OffTemplateRowProps>) {
  return (
    <div className="contents">
      <div className="border-t border-border/40 p-2 md:p-3 flex flex-col justify-center">
        <div className="flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground">
          <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">Off-template</span>
        </div>
        <span className="text-[11px] text-muted-foreground/70">odd hours · no plan</span>
      </div>
      {weekDays.map((day) => {
        const shifts = shiftsByDay.get(day) ?? [];
        return (
          <div key={day} className="border-t border-l border-border/40 min-h-[64px] p-1.5 space-y-1">
            {shifts.map((s) => (
              <div
                key={s.id}
                className={cn(
                  'flex items-center gap-1 px-2 py-1 rounded-md border border-dashed border-border/60',
                  'bg-muted/30 text-[12px] text-foreground',
                )}
              >
                <span className="truncate">{s.employee?.name ?? 'Unassigned'}</span>
                <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums">
                  {compact(formatLocalTime(s.start_time))}–{compact(formatLocalTime(s.end_time))}
                </span>
                <button
                  type="button"
                  onClick={() => onRemoveShift(s.id)}
                  aria-label={`Remove off-template shift for ${s.employee?.name ?? 'employee'}`}
                  className="shrink-0 ml-auto rounded hover:bg-foreground/10 p-0.5"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + lint**

Run: `npx tsc --noEmit && npx eslint src/components/scheduling/ShiftPlanner/OffTemplateRow.tsx`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/scheduling/ShiftPlanner/OffTemplateRow.tsx
git commit -m "feat(scheduling): OffTemplateRow read-only lane component"
```

---

## Task 7: `ShiftCell` — chip areas + loaned-out ghosts

**Files:**
- Modify: `src/components/scheduling/ShiftPlanner/ShiftCell.tsx`

- [ ] **Step 1: Add props, render ghosts, pass chip areas, comparator**

(a) Extend `ShiftCellProps` with:
```ts
  /** Area of this cell's template (for covering detection on chips). */
  cellArea?: string | null;
  /** De-duped loaned-out ghosts for this cell (employees from this area working elsewhere). */
  ghostLoanedOut?: import('@/types/scheduling').CoveringEmployee[];
```

(b) Destructure `cellArea`, `ghostLoanedOut` in the component params.

(c) Pass areas to each `EmployeeChip`:
```tsx
          <EmployeeChip
            key={shift.id}
            shiftId={shift.id}
            employeeName={shift.employee?.name ?? 'Unassigned'}
            position={shift.position}
            source={shift.source}
            homeArea={shift.employee?.area ?? null}
            cellArea={cellArea ?? null}
            onRemove={onRemoveShift}
          />
```

(d) Render ghost rows immediately AFTER the `{shifts.map(...)}` block and BEFORE the coverage indicator:
```tsx
        {ghostLoanedOut?.map((g) => (
          <div
            key={`ghost-${g.employeeId}`}
            aria-label={`${g.employeeName ?? 'Employee'} working ${g.workArea ?? 'another area'} this slot`}
            className="flex items-center gap-1 px-2 py-1 rounded-md border border-dashed border-border/50 text-[11px] text-muted-foreground"
          >
            <ArrowRight className="h-3 w-3 shrink-0" aria-hidden="true" />
            <span className="truncate">{g.employeeName ?? 'Employee'}</span>
            <span className="shrink-0 text-[10px]">· at {g.workArea ?? '—'}</span>
          </div>
        ))}
```

(e) Add `ArrowRight` to the lucide import: change `import { AlertTriangle, Check } from 'lucide-react';` to `import { AlertTriangle, ArrowRight, Check } from 'lucide-react';`.

(f) Add to the memo comparator:
```ts
    prev.cellArea === next.cellArea &&
    prev.ghostLoanedOut === next.ghostLoanedOut &&
```

- [ ] **Step 2: Typecheck + lint**

Run: `npx tsc --noEmit && npx eslint src/components/scheduling/ShiftPlanner/ShiftCell.tsx`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/scheduling/ShiftPlanner/ShiftCell.tsx
git commit -m "feat(scheduling): ShiftCell threads cell area to chips + renders loaned-out ghosts"
```

---

## Task 8: `TemplateGrid` — thread areas/ghosts + off-template rows

**Files:**
- Modify: `src/components/scheduling/ShiftPlanner/TemplateGrid.tsx`

- [ ] **Step 1: Add props + render**

(a) Extend `TemplateGridProps`:
```ts
  /** De-duped loaned-out ghosts keyed `${templateId}:${day}`. */
  ghostByCell?: Map<string, import('@/types/scheduling').CoveringEmployee[]>;
  /** Unmatched shifts grouped by area → day (off-template lane). */
  offTemplateByArea?: Map<string, Map<string, Shift[]>>;
```

(b) Destructure `ghostByCell`, `offTemplateByArea` in params.

(c) Import the row component: `import { OffTemplateRow } from './OffTemplateRow';`

(d) Pass to each `ShiftCell` (add two props):
```tsx
                          cellArea={template.area ?? null}
                          ghostLoanedOut={ghostByCell?.get(`${template.id}:${day}`)}
```

(e) Render the off-template row at the END of each area group, after the templates map. Inside the `{groups.map((group) => ( ... ))}` block, after the `group.templates.map(...)` closes (and still inside the group's `<div className="contents">`), add:
```tsx
            {(!showSectionHeaders || !collapsed[group.area]) &&
              (offTemplateByArea?.get(group.area)?.size ?? 0) > 0 && (
                <OffTemplateRow
                  area={group.area}
                  weekDays={weekDays}
                  shiftsByDay={offTemplateByArea!.get(group.area)!}
                  onRemoveShift={onRemoveShift}
                />
              )}
```

- [ ] **Step 2: Typecheck + lint**

Run: `npx tsc --noEmit && npx eslint src/components/scheduling/ShiftPlanner/TemplateGrid.tsx`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/scheduling/ShiftPlanner/TemplateGrid.tsx
git commit -m "feat(scheduling): TemplateGrid threads ghosts + renders off-template rows"
```

---

## Task 9: `CoverageDetail` — area-grouped list + loaned-out + header

**Files:**
- Modify: `src/components/scheduling/ShiftPlanner/CoverageDetail.tsx`
- Test: `tests/unit/coverageGrouping.test.ts` (new — tests the pure grouping helper)

- [ ] **Step 1: Write failing test for the grouping helper**

Create `tests/unit/coverageGrouping.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { groupCoveringByArea } from '@/components/scheduling/ShiftPlanner/CoverageDetail';
import type { CoveringEmployee } from '@/types/scheduling';

const e = (over: Partial<CoveringEmployee>): CoveringEmployee => ({
  employeeId: 'x', employeeName: 'x', startMin: 0, endMin: 60, homeArea: null, workArea: null, ...over,
});

describe('groupCoveringByArea', () => {
  it('splits home-area vs covering-from when slotArea is set', () => {
    const list = [
      e({ employeeId: 'a', homeArea: 'Cold Stone' }),
      e({ employeeId: 'b', homeArea: "Wetzel's" }),
      e({ employeeId: 'c', homeArea: null }),
    ];
    const { onArea, coveringFrom } = groupCoveringByArea(list, 'Cold Stone');
    expect(onArea.map((x) => x.employeeId)).toEqual(['a', 'c']); // null homeArea counts as on-area
    expect([...coveringFrom.keys()]).toEqual(["Wetzel's"]);
    expect(coveringFrom.get("Wetzel's")?.map((x) => x.employeeId)).toEqual(['b']);
  });

  it('returns all under onArea with empty coveringFrom when slotArea is null', () => {
    const list = [e({ employeeId: 'a', homeArea: 'Cold Stone' })];
    const { onArea, coveringFrom } = groupCoveringByArea(list, null);
    expect(onArea).toHaveLength(1);
    expect(coveringFrom.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run — verify fail**

Run: `npx vitest run tests/unit/coverageGrouping.test.ts`
Expected: FAIL (`groupCoveringByArea` not exported).

- [ ] **Step 3: Implement helper + UI**

In `src/components/scheduling/ShiftPlanner/CoverageDetail.tsx`:

(a) Export the pure helper (top-level, above `CoverageList`):
```ts
import type { SlotCoverage, CoveringEmployee } from '@/types/scheduling';

export function groupCoveringByArea(
  list: CoveringEmployee[],
  slotArea: string | null | undefined,
): { onArea: CoveringEmployee[]; coveringFrom: Map<string, CoveringEmployee[]> } {
  const onArea: CoveringEmployee[] = [];
  const coveringFrom = new Map<string, CoveringEmployee[]>();
  for (const emp of list) {
    const home = emp.homeArea ?? null;
    if (slotArea == null || home == null || home === slotArea) {
      onArea.push(emp);
    } else {
      const g = coveringFrom.get(home);
      if (g) g.push(emp);
      else coveringFrom.set(home, [emp]);
    }
  }
  return { onArea, coveringFrom };
}
```
(Adjust the existing `import type { SlotCoverage } ...` line to also import `CoveringEmployee`.)

(b) Add `slotArea` to props:
```ts
interface CoverageDetailProps {
  open: boolean;
  coverage: SlotCoverage | null;
  slotLabel?: string;
  slotArea?: string | null;
  anchorRect?: DOMRect;
  onClose: () => void;
}
```
Destructure `slotArea` in `CoverageDetail({ ... })` and pass it to both `<CoverageList coverage={coverage} slotArea={slotArea} />` call sites (mobile + desktop).

(c) Replace the `CoverageList` employee section. Change its signature to `function CoverageList({ coverage, slotArea }: { coverage: SlotCoverage; slotArea?: string | null })`. Replace the `coveringEmployees.length === 0 ? ... : <ul>...</ul>` block with a grouped renderer. Define a small row + section helper inside the file:
```tsx
  const { coveringEmployees, segments, loanedOut } = coverage;
  const gapSegments = segments.filter((s) => !s.covered);
  const { onArea, coveringFrom } = groupCoveringByArea(coveringEmployees, slotArea);
  const nothing = coveringEmployees.length === 0 && loanedOut.length === 0;

  const Row = (emp: CoveringEmployee, key: string) => (
    <li key={key} className="flex items-center justify-between text-[13px]">
      <span className="font-medium text-foreground">{emp.employeeName ?? 'Employee'}</span>
      <span className="text-muted-foreground tabular-nums">
        {minutesToCompact(emp.startMin)}–{minutesToCompact(emp.endMin)}
      </span>
    </li>
  );
  const Heading = (text: string) => (
    <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">{text}</p>
  );

  return (
    <div className="space-y-3">
      {nothing ? (
        <p className="text-[13px] text-muted-foreground">No employees scheduled for this slot.</p>
      ) : (
        <div className="space-y-3">
          {onArea.length > 0 && (
            <ul className="space-y-1.5" aria-label="On this area">
              {slotArea ? Heading(`On ${slotArea}`) : null}
              {onArea.map((emp, i) => Row(emp, `on-${emp.employeeId}-${i}`))}
            </ul>
          )}
          {[...coveringFrom.entries()].map(([home, emps]) => (
            <ul key={`cf-${home}`} className="space-y-1.5">
              {Heading(`Covering from ${home}`)}
              {emps.map((emp, i) => Row(emp, `cov-${emp.employeeId}-${i}`))}
            </ul>
          ))}
          {loanedOut.length > 0 && (
            <ul className="space-y-1.5">
              {Heading('Covering elsewhere')}
              {loanedOut.map((emp, i) => (
                <li key={`loaned-${emp.employeeId}-${i}`} className="flex items-center justify-between text-[13px]">
                  <span className="font-medium text-foreground">{emp.employeeName ?? 'Employee'}</span>
                  <span className="text-muted-foreground">at {emp.workArea ?? '—'}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {gapSegments.length > 0 && (
        /* keep the existing Gaps block unchanged */
      )}
    </div>
  );
```
Keep the existing `gapSegments` JSX exactly as-is (do not delete it). The `Heading`/`Row` are defined inside `CoverageList`.

(d) Update header wording in BOTH layouts: change the desktop `PopoverContent` `aria-label="Covering employees for this slot"` and the `<p>` title text "Covering employees for this slot" and the mobile `DrawerTitle` text to **"Staff for this slot"**.

- [ ] **Step 4: Run — verify pass**

Run: `npx vitest run tests/unit/coverageGrouping.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Typecheck + lint**

Run: `npx tsc --noEmit && npx eslint src/components/scheduling/ShiftPlanner/CoverageDetail.tsx`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/components/scheduling/ShiftPlanner/CoverageDetail.tsx tests/unit/coverageGrouping.test.ts
git commit -m "feat(scheduling): area-grouped coverage popover + loaned-out group"
```

---

## Task 10: Wire it up in `ShiftPlannerTab`

**Files:**
- Modify: `src/components/scheduling/ShiftPlanner/ShiftPlannerTab.tsx`

- [ ] **Step 1: homeArea in coverage shifts**

In the `coverageByTemplateDay` memo, in the `cov: CoverageShift[] = shifts.map((s) => ({ ... }))` object, add after the `area:` line:
```ts
      homeArea: s.employee?.area ?? null,
```

- [ ] **Step 2: Build the ghost map (memo) + templateStart lookup**

After `coverageByTemplateDay` is defined, add:
```ts
  const ghostByCell = useMemo(() => {
    const startById = new Map(templates.map((t) => [t.id, t.start_time]));
    return assignLoanedOutCell(coverageByTemplateDay, startById);
  }, [coverageByTemplateDay, templates]);

  const offTemplateByArea = useMemo(
    () => groupUnmatchedByArea(templateGridData.get('__unmatched__') ?? new Map()),
    [templateGridData],
  );
```
Add imports:
```ts
import { assignLoanedOutCell } from '@/lib/loanedOut';
```
and add `groupUnmatchedByArea` to the existing `@/hooks/useShiftPlanner` import, and `buildTemplateGridData, getActiveDaysForWeek` already there.

- [ ] **Step 3: Pass to TemplateGrid**

Add to the `<TemplateGrid ... />` props:
```tsx
                  ghostByCell={ghostByCell}
                  offTemplateByArea={offTemplateByArea}
```

- [ ] **Step 4: Pass slotArea to CoverageDetail**

In the `<CoverageDetail ... />` instance add:
```tsx
        slotArea={coverageDetailTemplate?.area ?? null}
```

- [ ] **Step 5: Typecheck + lint + targeted build sanity**

Run: `npx tsc --noEmit && npx eslint src/components/scheduling/ShiftPlanner/ShiftPlannerTab.tsx`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/components/scheduling/ShiftPlanner/ShiftPlannerTab.tsx
git commit -m "feat(scheduling): wire covering chips, loaned-out ghosts, off-template lane, grouped popover"
```

---

## Task 11: Full verify

- [ ] **Step 1: Run the whole relevant suite + checks**

```bash
npx vitest run tests/unit/shiftCoverage.test.ts tests/unit/loanedOut.test.ts tests/unit/useShiftPlanner.test.ts tests/unit/coverageGrouping.test.ts
npm run typecheck
npm run lint
npm run build
```
Expected: all green.

- [ ] **Step 2: Commit any fixups, then proceed to UI review (Phase 5) and onward**

---

## Self-review notes

- **Spec coverage:** F1 covering chip → Task 5/7; F2 ghost → Task 2 (engine loanedOut) + Task 3 (de-dup) + Task 7 (render) + Task 10 (wire); F3 off-template → Task 4 + Task 6 + Task 8 + Task 10; F4 popover → Task 2 + Task 9 + Task 10. Types → Task 1.
- **Type consistency:** `CoveringEmployee.homeArea/workArea`, `SlotCoverage.loanedOut`, `CoverageShift.homeArea`, `ghostByCell` key `${templateId}:${day}`, `offTemplateByArea` `Map<area, Map<day, Shift[]>>`, helper names `assignLoanedOutCell`, `groupUnmatchedByArea`, `groupCoveringByArea` are used identically across tasks.
- **No DB/SQL changes.** Counting math (minConcurrent/openSpots) untouched — pre-existing engine tests must stay green (asserted in Task 2 Step 4).
