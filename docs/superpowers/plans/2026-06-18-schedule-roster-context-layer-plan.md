# Schedule Roster Context Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface minor status, full-time/part-time, and approved time off (as day-cell bands + a name-cell chip) on the weekly schedule grid.

**Architecture:** A new pure helper (`src/lib/scheduleTimeOff.ts`) computes per-employee approved time off for the visualized week via `yyyy-MM-dd` string overlap (TZ-safe, no `Date` math). `src/pages/Scheduling.tsx` memoizes that helper and renders three reused badge patterns plus blue time-off bands with accent bars, an sr-only state, a soft-blocked "Add anyway" affordance, and conflict escalation. A new `info` Tailwind token backs the blue.

**Tech Stack:** React 18 + TypeScript, TailwindCSS (semantic tokens), date-fns, lucide-react, Vitest.

**Design doc:** `docs/superpowers/specs/2026-06-18-schedule-roster-context-layer-design.md`

**Testing strategy:** The behavior lives in the pure helper — fully unit-tested (and it is under `src/lib`, which counts toward SonarCloud new-code coverage). The `Scheduling.tsx` JSX wiring is guarded by source-text class tests (lessons 2026-05-17: avoid mocking 30+ page hooks; `src/pages/**` is coverage-excluded). Final integration verified by `npm run typecheck` + `npm run build` in Phase 8.

---

### Task 1: Add `info` Tailwind token

**Files:**
- Modify: `tailwind.config.ts` (the `colors` extend block, near the existing `warning`/`success` entries, ~lines 43-50)
- Test: `tests/unit/tailwindInfoToken.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

describe('tailwind info token', () => {
  const src = readFileSync(resolve(__dirname, '../../tailwind.config.ts'), 'utf8');

  it('exposes an info color backed by the --info CSS vars', () => {
    expect(src).toMatch(/info:\s*\{[^}]*hsl\(var\(--info\)\)[^}]*hsl\(var\(--info-foreground\)\)/s);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/unit/tailwindInfoToken.test.ts`
Expected: FAIL (no `info:` block in config yet).

- [ ] **Step 3: Add the token**

In `tailwind.config.ts`, immediately after the `warning: { ... }` block, add:

```ts
info: {
  DEFAULT: "hsl(var(--info))",
  foreground: "hsl(var(--info-foreground))",
},
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- tests/unit/tailwindInfoToken.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tailwind.config.ts tests/unit/tailwindInfoToken.test.ts
git commit -m "feat(scheduling): add info tailwind token for time-off blue"
```

---

### Task 2: `buildWeekTimeOff` pure helper

**Files:**
- Create: `src/lib/scheduleTimeOff.ts`
- Test: `tests/unit/scheduleTimeOff.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { buildWeekTimeOff } from '@/lib/scheduleTimeOff';
import type { TimeOffRequest } from '@/types/scheduling';

// Mon 2026-06-22 .. Sun 2026-06-28
const WEEK = ['2026-06-22','2026-06-23','2026-06-24','2026-06-25','2026-06-26','2026-06-27','2026-06-28'];

function makeReq(o: Partial<TimeOffRequest>): TimeOffRequest {
  return {
    id: o.id ?? 'r1',
    restaurant_id: 'rest1',
    employee_id: o.employee_id ?? 'e1',
    start_date: o.start_date ?? '2026-06-24',
    end_date: o.end_date ?? '2026-06-24',
    reason: o.reason,
    status: o.status ?? 'approved',
    requested_at: '2026-06-01T00:00:00Z',
    reviewed_at: o.reviewed_at,
    reviewed_by: o.reviewed_by,
    created_at: '2026-06-01T00:00:00Z',
    updated_at: '2026-06-01T00:00:00Z',
  };
}

describe('buildWeekTimeOff', () => {
  it('marks a single approved off-day', () => {
    const map = buildWeekTimeOff([makeReq({ start_date: '2026-06-24', end_date: '2026-06-24' })], WEEK);
    const off = map.get('e1')!;
    expect([...off.offDayKeys]).toEqual(['2026-06-24']);
    expect(off.spans).toEqual([{ startKey: '2026-06-24', endKey: '2026-06-24', dayCount: 1, reasons: [] }]);
  });

  it('groups a contiguous multi-day run into one span', () => {
    const map = buildWeekTimeOff([makeReq({ start_date: '2026-06-24', end_date: '2026-06-26', reason: 'Vacation' })], WEEK);
    const off = map.get('e1')!;
    expect(off.offDayKeys.size).toBe(3);
    expect(off.spans).toEqual([{ startKey: '2026-06-24', endKey: '2026-06-26', dayCount: 3, reasons: ['Vacation'] }]);
  });

  it('excludes pending and rejected requests', () => {
    const map = buildWeekTimeOff([
      makeReq({ employee_id: 'p', status: 'pending' }),
      makeReq({ employee_id: 'x', status: 'rejected' }),
    ], WEEK);
    expect(map.has('p')).toBe(false);
    expect(map.has('x')).toBe(false);
  });

  it('omits employees with no in-week overlap', () => {
    const map = buildWeekTimeOff([makeReq({ start_date: '2026-07-01', end_date: '2026-07-03' })], WEEK);
    expect(map.has('e1')).toBe(false);
  });

  it('clips a request that straddles the week boundary to in-week days', () => {
    const map = buildWeekTimeOff([makeReq({ start_date: '2026-06-20', end_date: '2026-06-23' })], WEEK);
    const off = map.get('e1')!;
    expect([...off.offDayKeys]).toEqual(['2026-06-22','2026-06-23']);
    expect(off.spans[0].startKey).toBe('2026-06-22');
  });

  it('produces two spans for two separate same-employee requests', () => {
    const map = buildWeekTimeOff([
      makeReq({ id: 'a', start_date: '2026-06-22', end_date: '2026-06-22', reason: 'Personal' }),
      makeReq({ id: 'b', start_date: '2026-06-25', end_date: '2026-06-26', reason: 'Family' }),
    ], WEEK);
    const off = map.get('e1')!;
    expect(off.offDayKeys.size).toBe(3);
    expect(off.spans.map((s) => [s.startKey, s.endKey])).toEqual([['2026-06-22','2026-06-22'],['2026-06-25','2026-06-26']]);
  });

  it('tolerates datetime-suffixed date strings', () => {
    const map = buildWeekTimeOff([makeReq({ start_date: '2026-06-24T00:00:00Z', end_date: '2026-06-24T23:59:59Z' })], WEEK);
    expect(map.get('e1')!.offDayKeys.has('2026-06-24')).toBe(true);
  });

  it('ignores empty/whitespace reasons but keeps real ones', () => {
    const map = buildWeekTimeOff([makeReq({ start_date: '2026-06-24', end_date: '2026-06-24', reason: '   ' })], WEEK);
    expect(map.get('e1')!.spans[0].reasons).toEqual([]);
  });

  it('matches purely by string (no Date dependence in overlap)', () => {
    // weekDayKeys are arbitrary plain strings; overlap is lexicographic.
    const map = buildWeekTimeOff([makeReq({ start_date: '2026-06-23', end_date: '2026-06-25' })], WEEK);
    expect([...map.get('e1')!.offDayKeys]).toEqual(['2026-06-23','2026-06-24','2026-06-25']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/unit/scheduleTimeOff.test.ts`
Expected: FAIL ("Failed to resolve import '@/lib/scheduleTimeOff'").

- [ ] **Step 3: Implement `buildWeekTimeOff`**

Create `src/lib/scheduleTimeOff.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- tests/unit/scheduleTimeOff.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/scheduleTimeOff.ts tests/unit/scheduleTimeOff.test.ts
git commit -m "feat(scheduling): buildWeekTimeOff helper (TZ-safe string overlap)"
```

---

### Task 3: `summarizeOff` (name-cell chip label + reasons)

**Files:**
- Modify: `src/lib/scheduleTimeOff.ts`
- Test: `tests/unit/scheduleTimeOff.test.ts` (extend)

- [ ] **Step 1: Write the failing test** (append to the existing file)

```ts
import { summarizeOff } from '@/lib/scheduleTimeOff';

describe('summarizeOff', () => {
  it('labels a single off-day with the weekday abbr', () => {
    const map = buildWeekTimeOff([makeReq({ start_date: '2026-06-22', end_date: '2026-06-22' })], WEEK);
    expect(summarizeOff(map.get('e1')!).label).toBe('Off Mon');
  });

  it('labels a contiguous run as first–last', () => {
    const map = buildWeekTimeOff([makeReq({ start_date: '2026-06-24', end_date: '2026-06-26' })], WEEK);
    expect(summarizeOff(map.get('e1')!).label).toBe('Off Wed–Fri');
  });

  it('labels non-contiguous off-days by total count', () => {
    const map = buildWeekTimeOff([
      makeReq({ id: 'a', start_date: '2026-06-22', end_date: '2026-06-22' }),
      makeReq({ id: 'b', start_date: '2026-06-25', end_date: '2026-06-26' }),
    ], WEEK);
    expect(summarizeOff(map.get('e1')!).label).toBe('Off 3 days');
  });

  it('collects distinct reasons across spans', () => {
    const map = buildWeekTimeOff([
      makeReq({ id: 'a', start_date: '2026-06-22', end_date: '2026-06-22', reason: 'Personal' }),
      makeReq({ id: 'b', start_date: '2026-06-25', end_date: '2026-06-25', reason: 'Personal' }),
      makeReq({ id: 'c', start_date: '2026-06-26', end_date: '2026-06-26', reason: 'Family' }),
    ], WEEK);
    expect(summarizeOff(map.get('e1')!).reasons.sort()).toEqual(['Family', 'Personal']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/unit/scheduleTimeOff.test.ts`
Expected: FAIL ("summarizeOff is not a function").

- [ ] **Step 3: Implement `summarizeOff`** (append to `src/lib/scheduleTimeOff.ts`)

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- tests/unit/scheduleTimeOff.test.ts`
Expected: PASS (13 tests total).

- [ ] **Step 5: Commit**

```bash
git add src/lib/scheduleTimeOff.ts tests/unit/scheduleTimeOff.test.ts
git commit -m "feat(scheduling): summarizeOff chip label + reasons"
```

---

### Task 4: Wire helper + memoized derivations into Scheduling.tsx

**Files:**
- Modify: `src/pages/Scheduling.tsx` (imports ~line 64-96; memos near `weekDays` ~line 371; employee map ~line 1542)
- Test: `tests/unit/scheduleRosterContext.classes.test.ts` (create)

- [ ] **Step 1: Write the failing source-text test**

```ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

const SRC = readFileSync(resolve(__dirname, '../../src/pages/Scheduling.tsx'), 'utf8');

describe('Scheduling roster context — wiring', () => {
  it('imports the time-off helper and isMinor', () => {
    expect(SRC).toMatch(/from '@\/lib\/scheduleTimeOff'/);
    expect(SRC).toMatch(/buildWeekTimeOff/);
    expect(SRC).toMatch(/summarizeOff/);
    expect(SRC).toMatch(/isMinor/);
  });
  it('imports the CalendarOff icon', () => {
    expect(SRC).toMatch(/\bCalendarOff\b/);
  });
  it('memoizes weekDayKeys and weekTimeOff', () => {
    expect(SRC).toMatch(/const weekDayKeys = useMemo\(/);
    expect(SRC).toMatch(/const weekTimeOff = useMemo\(\s*\(\)\s*=>\s*buildWeekTimeOff\(/s);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/unit/scheduleRosterContext.classes.test.ts`
Expected: FAIL.

- [ ] **Step 3: Add imports**

In `src/pages/Scheduling.tsx`:
- Add `CalendarOff,` to the `lucide-react` import block (where `AlertTriangle,` is, ~line 78).
- After the `cn` import (line 64), add:
```ts
import { isMinor } from '@/lib/employeeUtils';
import { buildWeekTimeOff, summarizeOff } from '@/lib/scheduleTimeOff';
```

- [ ] **Step 4: Add memoized derivations**

Immediately after `const weekDays = eachDayOfInterval({ start: currentWeekStart, end: weekEnd });` (line 371), add:

```ts
const weekDayKeys = useMemo(() => weekDays.map((d) => format(d, 'yyyy-MM-dd')), [weekDays]);
const weekTimeOff = useMemo(
  () => buildWeekTimeOff(timeOffRequests, weekDayKeys),
  [timeOffRequests, weekDayKeys],
);
```

(Confirm `timeOffRequests` is in scope at this point — it comes from `useTimeOffRequests`. If it is declared below line 371, place these two memos immediately after that declaration instead.)

- [ ] **Step 5: Convert the employee map to a block body with per-row reads**

Find (line ~1542):
```tsx
{!isCollapsed && group.employees.map((employee, idx) => (
  <tr
    key={employee.id}
```
Replace the `=> (` with a block body that computes the row context, and add a matching `)` / `}` at the row's close. Concretely:

```tsx
{!isCollapsed && group.employees.map((employee, idx) => {
  const empOff = weekTimeOff.get(employee.id);
  const off = empOff ? summarizeOff(empOff) : null;
  const isMinorEmployee = isMinor(employee.date_of_birth);
  return (
    <tr
      key={employee.id}
```
…and at the end of this row (the existing `</tr>` that closes the employee row, line ~1696), change the closing `))}` to `);})}` — i.e. close the `<tr>`, then `);` for the return, then `}` for the arrow block, then `}` for the JSX expression. Run typecheck after this step to confirm the braces balance.

- [ ] **Step 6: Run tests + typecheck**

Run: `npm run test -- tests/unit/scheduleRosterContext.classes.test.ts && npm run typecheck`
Expected: test PASS; typecheck PASS (no unbalanced-brace / unused-var errors — `empOff`/`off`/`isMinorEmployee` are consumed in Tasks 5-7; if typecheck flags them as unused before then, proceed — they are wired up in the next task and the workflow runs tasks in order).

> Note: if running this task in isolation trips `noUnusedLocals`, add the three consumers (Task 5) in the same commit. The dev-build-and-ship workflow runs tasks sequentially, so prefer committing Task 4 + Task 5 together if the linter blocks.

- [ ] **Step 7: Commit**

```bash
git add src/pages/Scheduling.tsx tests/unit/scheduleRosterContext.classes.test.ts
git commit -m "feat(scheduling): wire memoized week time-off context into grid"
```

---

### Task 5: Desktop identity cell — Minor pill, FT/PT tag, Off chip

**Files:**
- Modify: `src/pages/Scheduling.tsx` (name line ~1562-1580, meta line ~1581-1588)
- Test: `tests/unit/scheduleRosterContext.classes.test.ts` (extend)

- [ ] **Step 1: Write the failing source-text test** (append)

```ts
describe('Scheduling roster context — identity cell', () => {
  it('renders the amber Minor pill from isMinor', () => {
    expect(SRC).toMatch(/isMinorEmployee && \(/);
    expect(SRC).toMatch(/bg-amber-500\/10 text-amber-600/);
    expect(SRC).toContain('Minor');
  });
  it('renders the FT/PT tag with muted styling', () => {
    expect(SRC).toMatch(/employment_type === 'part_time' \? 'PT' : 'FT'/);
    expect(SRC).toMatch(/bg-muted text-muted-foreground/);
  });
  it('renders the Off chip with the info token and CalendarOff, not a title tooltip', () => {
    expect(SRC).toMatch(/bg-info\/10 text-info/);
    expect(SRC).toMatch(/off\.label/);
    expect(SRC).toMatch(/sr-only/);
    // negative: no hardcoded blue, no title-attr tooltip on the chip
    expect(SRC).not.toMatch(/bg-blue-/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/unit/scheduleRosterContext.classes.test.ts`
Expected: FAIL (identity-cell block).

- [ ] **Step 3: Add Minor pill + Off chip to the name line**

In the name-line `<div className="font-medium text-sm flex items-center gap-2">`, after the Inactive-badge block (after line 1579 `)}`, before the closing `</div>` at 1580), insert:

```tsx
{isMinorEmployee && (
  <span className="text-[11px] px-1.5 py-0.5 rounded-md bg-amber-500/10 text-amber-600 font-medium shrink-0">
    Minor
  </span>
)}
{off && (
  <TooltipProvider>
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-md bg-info/10 text-info font-medium shrink-0">
          <CalendarOff className="h-3 w-3" aria-hidden="true" />
          {off.label}
          <span className="sr-only">
            {` — approved time off${off.reasons.length ? `: ${off.reasons.join(', ')}` : ''}`}
          </span>
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">
        {off.reasons.length ? off.reasons.join(', ') : 'Approved time off'}
      </TooltipContent>
    </Tooltip>
  </TooltipProvider>
)}
```

(`Tooltip*` primitives are already imported at line 9.)

- [ ] **Step 4: Add FT/PT tag to the meta line**

In the meta-line `<div className="text-xs text-muted-foreground flex items-center gap-1.5">`, immediately after `{employee.position}` (line 1582) and before the hours-pill block (1583), insert:

```tsx
<span className="text-[11px] px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground shrink-0">
  {employee.employment_type === 'part_time' ? 'PT' : 'FT'}
</span>
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npm run test -- tests/unit/scheduleRosterContext.classes.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/pages/Scheduling.tsx tests/unit/scheduleRosterContext.classes.test.ts
git commit -m "feat(scheduling): minor pill, FT/PT tag, time-off chip on schedule rows"
```

---

### Task 6: Day-cell time-off bands, soft-block, conflict escalation

**Files:**
- Modify: `src/pages/Scheduling.tsx` (day cell map ~1639-1695)
- Test: `tests/unit/scheduleRosterContext.classes.test.ts` (extend)

- [ ] **Step 1: Write the failing source-text test** (append)

```ts
describe('Scheduling roster context — day cells', () => {
  it('computes per-day off state and run-start', () => {
    expect(SRC).toMatch(/offDayKeys\.has\(/);
    expect(SRC).toMatch(/isRunStart/);
  });
  it('renders accent bars (info normally, destructive on conflict) and sr-only state', () => {
    expect(SRC).toMatch(/border-l-2 border-info/);
    expect(SRC).toMatch(/border-l-2 border-destructive/);
    expect(SRC).toMatch(/Approved time off/);
    expect(SRC).toMatch(/Scheduling conflict/);
  });
  it('soft-blocks add on off-days with a contextual aria-label', () => {
    expect(SRC).toMatch(/Add anyway/);
    expect(SRC).toMatch(/despite approved time off/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/unit/scheduleRosterContext.classes.test.ts`
Expected: FAIL (day-cells block).

- [ ] **Step 3: Compute per-day state inside the `weekDays.map`**

Find (line ~1639-1641):
```tsx
{weekDays.map((day) => {
  const dayShifts = getShiftsForEmployee(employee.id, day);
  const dayIsToday = isToday(day);
```
Add below those two lines:
```tsx
  const dayKey = format(day, 'yyyy-MM-dd');
  const isOff = !!empOff?.offDayKeys.has(dayKey);
  const hasShift = dayShifts.length > 0;
  const isRunStart = !!empOff?.spans.some((s) => s.startKey === dayKey);
```

- [ ] **Step 4: Apply band styling + sr-only + first-day label to the cell content**

Find the cell content wrapper (line ~1650):
```tsx
<div className="space-y-1 md:space-y-1.5 min-h-[48px] md:min-h-[60px]">
```
Replace with:
```tsx
<div className={cn(
  "space-y-1 md:space-y-1.5 min-h-[48px] md:min-h-[60px]",
  isOff && "bg-info/10 -m-1 md:-m-1.5 p-1 md:p-1.5 rounded-md border-l-2",
  isOff && (hasShift ? "border-destructive" : "border-info"),
)}>
  {isOff && (
    <span className="sr-only">
      {hasShift ? 'Scheduling conflict: shift scheduled during approved time off' : 'Approved time off'}
    </span>
  )}
  {isOff && isRunStart && (
    <div className="flex items-center gap-1 text-[11px] text-info font-medium">
      <CalendarOff className="h-3 w-3" aria-hidden="true" />
      Time off
    </div>
  )}
```

(The negative margin + matching padding lets the tint/accent fill the cell padding so consecutive off-days read as one continuous band. The existing shift cards and Add button remain the following children.)

- [ ] **Step 5: Soft-block the Add affordance on off-days**

Find the Add button block (lines ~1677-1691):
```tsx
{!selectionMode && (
  <Button
    variant="ghost"
    size="sm"
    className={cn(
      "w-full h-8 text-xs border border-dashed border-border/50",
      "opacity-0 group-hover:opacity-100 transition-all duration-200",
      "hover:border-primary/50 hover:bg-primary/5 hover:text-primary"
    )}
    onClick={() => handleAddShift(day, employee)}
  >
    <Plus className="h-3 w-3 mr-1" />
    Add
  </Button>
)}
```
Replace with:
```tsx
{!selectionMode && (
  <Button
    variant="ghost"
    size="sm"
    className={cn(
      "w-full h-8 text-xs border border-dashed",
      "opacity-0 group-hover:opacity-100 transition-all duration-200",
      isOff
        ? "border-warning/50 text-warning hover:bg-warning/10"
        : "border-border/50 hover:border-primary/50 hover:bg-primary/5 hover:text-primary",
    )}
    aria-label={
      isOff
        ? `Add shift for ${employee.name} on ${format(day, 'EEE MMM d')} despite approved time off`
        : `Add shift for ${employee.name} on ${format(day, 'EEE MMM d')}`
    }
    onClick={() => handleAddShift(day, employee)}
  >
    <Plus className="h-3 w-3 mr-1" />
    {isOff ? 'Add anyway' : 'Add'}
  </Button>
)}
```

- [ ] **Step 6: Run tests + typecheck + lint**

Run: `npm run test -- tests/unit/scheduleRosterContext.classes.test.ts && npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/pages/Scheduling.tsx tests/unit/scheduleRosterContext.classes.test.ts
git commit -m "feat(scheduling): time-off bands, soft-block add, conflict accent on day cells"
```

---

### Task 7: Mobile degradation — avatar dots + aria-label + tooltip

**Files:**
- Modify: `src/pages/Scheduling.tsx` (mobile branch ~1604-1637)
- Test: `tests/unit/scheduleRosterContext.classes.test.ts` (extend)

- [ ] **Step 1: Write the failing source-text test** (append)

```ts
describe('Scheduling roster context — mobile', () => {
  it('extends the mobile avatar aria-label with minor/off state', () => {
    expect(SRC).toMatch(/isMinorEmployee \? ', minor'/);
  });
  it('shows minor/FT-PT/off in the mobile tooltip and marks dots aria-hidden', () => {
    expect(SRC).toMatch(/aria-hidden="true"/);
    expect(SRC).toMatch(/relative/); // avatar wrapper hosts the corner dots
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/unit/scheduleRosterContext.classes.test.ts`
Expected: FAIL (mobile block).

- [ ] **Step 3: Add corner dots + extend the avatar aria-label**

In the mobile branch, the avatar button (lines 1608-1619) — wrap the button in a `relative` span so dots can be absolutely positioned, add the dots, and extend `aria-label`:

Replace the `<button ...>{initials}</button>` (1608-1619) with:
```tsx
<span className="relative">
  <button
    onClick={() => selectionMode ? selectShiftsForEmployee(employee.id) : handleEditEmployee(employee)}
    className={cn(
      "w-9 h-9 rounded-lg flex items-center justify-center text-xs font-semibold shadow-sm cursor-pointer",
      employee.is_active
        ? "bg-gradient-to-br from-primary/20 to-primary/10 text-primary"
        : "bg-muted text-muted-foreground"
    )}
    aria-label={`${employee.name}, ${employee.position}${isMinorEmployee ? ', minor' : ''}${off ? `, ${off.label.toLowerCase()}` : ''}`}
  >
    {employee.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
  </button>
  {isMinorEmployee && (
    <span aria-hidden="true" className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-amber-500 ring-1 ring-background" />
  )}
  {off && (
    <span aria-hidden="true" className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full bg-info ring-1 ring-background" />
  )}
</span>
```

- [ ] **Step 4: Add minor/FT-PT/off line to the mobile tooltip**

In the mobile `<TooltipContent>` (1621-1629), after the `<div className="text-muted-foreground">{employee.position}</div>` line (1628), add:

```tsx
<div className="text-muted-foreground">
  {isMinorEmployee ? 'Minor · ' : ''}{employee.employment_type === 'part_time' ? 'Part-time' : 'Full-time'}{off ? ` · ${off.label}` : ''}
</div>
```

- [ ] **Step 5: Run tests + typecheck + lint**

Run: `npm run test -- tests/unit/scheduleRosterContext.classes.test.ts && npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/pages/Scheduling.tsx tests/unit/scheduleRosterContext.classes.test.ts
git commit -m "feat(scheduling): mobile avatar dots + a11y labels for minor/FT-PT/off"
```

---

## Self-review checklist (done while writing)

- **Spec coverage:** info token (T1), buildWeekTimeOff (T2), summarizeOff (T3), memo wiring (T4), Minor pill + FT/PT tag + Off chip (T5), day-cell bands + soft-block + conflict (T6), mobile degradation (T7). All design sections mapped.
- **Types consistent:** `EmployeeWeekTimeOff { offDayKeys, spans }`, `TimeOffSpan { startKey, endKey, dayCount, reasons }`, `summarizeOff → { label, reasons }` — used identically across T2-T7.
- **No placeholders:** every code step shows full code.
- **TZ-safety:** overlap is string-only (T2); label uses `parseISO` (local), documented (T3).
- **a11y:** accent bar + sr-only (not color-alone), contextual aria-labels, Tooltip not `title`, mobile labels — all from Phase 2.5 review.
- **Perf:** `useMemo` for `weekDayKeys` + `weekTimeOff` (T4).
