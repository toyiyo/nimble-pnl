# Manual Timeline Overnight-Shift Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** The Time Clock **Manual** view must count an overnight shift (clock out next day) on its clock-in day and render it correctly, matching the Cards view and the page header total.

**Architecture:** Extract the timeline block-building into a pure, tested `buildTimelineBlocks(punches, date)` that pairs across midnight and attributes by clock-in day (reusing `isWithinWindow`); feed `ManualTimelineEditor` the buffered punch set; clip + tag the cross-midnight bar and make it view-only on the canvas.

**Tech Stack:** React + TS, date-fns, Vitest, Playwright. Design: `docs/superpowers/specs/2026-07-11-manual-timeline-overnight-design.md`.

**Scope:** `src/components/time-tracking/ManualTimelineEditor.tsx`, one prop in `src/pages/TimePunchesManager.tsx`, new `src/utils/manualTimelineBlocks.ts`. No other surface (page total/Cards/payroll already correct via #599).

---

## Task 1: Extract `buildTimelineBlocks` pure util + tests

**Files:**
- Create: `src/utils/manualTimelineBlocks.ts`
- Test: `tests/unit/manualTimelineBlocks.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/manualTimelineBlocks.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { buildTimelineBlocks } from '@/utils/manualTimelineBlocks';
import type { TimePunch } from '@/types/timeTracking';

const p = (type: string, iso: string, id = `${type}-${iso}`): TimePunch => ({
  id, employee_id: 'e1', restaurant_id: 'r1',
  punch_type: type as TimePunch['punch_type'], punch_time: iso,
  created_at: iso, updated_at: iso,
} as TimePunch);

// Local calendar day under test: Jul 10 2026 (constructed local to be TZ-portable)
const day = new Date(2026, 6, 10);

describe('buildTimelineBlocks', () => {
  it('pairs a cross-midnight shift into ONE block on the clock-in day', () => {
    const punches = [
      p('clock_in', new Date(2026, 6, 10, 16, 45).toISOString()),
      p('clock_out', new Date(2026, 6, 11, 0, 37).toISOString()),
    ];
    const blocks = buildTimelineBlocks(punches, day);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].startTime.getTime()).toBe(new Date(2026, 6, 10, 16, 45).getTime());
    expect(blocks[0].endTime.getTime()).toBe(new Date(2026, 6, 11, 0, 37).getTime());
    expect(blocks[0].hasClockInTime).toBe(true);
    expect(blocks[0].hasClockOutTime).toBe(true);
  });

  it('excludes the prior night tail (clock-out lands on this day, clock-in was yesterday)', () => {
    const punches = [
      p('clock_in', new Date(2026, 6, 9, 20, 0).toISOString()),   // Jul 9 clock-in
      p('clock_out', new Date(2026, 6, 10, 0, 7).toISOString()),  // Jul 10 00:07 → belongs to Jul 9
    ];
    expect(buildTimelineBlocks(punches, day)).toHaveLength(0);
  });

  it('keeps normal same-day shifts and split shifts unchanged', () => {
    const punches = [
      p('clock_in', new Date(2026, 6, 10, 9, 0).toISOString()),
      p('clock_out', new Date(2026, 6, 10, 13, 0).toISOString()),
      p('clock_in', new Date(2026, 6, 10, 17, 0).toISOString()),
      p('clock_out', new Date(2026, 6, 10, 22, 0).toISOString()),
    ];
    const blocks = buildTimelineBlocks(punches, day);
    expect(blocks).toHaveLength(2);
  });

  it('ignores a shift that starts the NEXT day (pulled in by the buffer)', () => {
    const punches = [
      p('clock_in', new Date(2026, 6, 11, 10, 0).toISOString()),
      p('clock_out', new Date(2026, 6, 11, 18, 0).toISOString()),
    ];
    expect(buildTimelineBlocks(punches, day)).toHaveLength(0);
  });

  it('drops an unpaired lone clock-in (no block)', () => {
    const punches = [p('clock_in', new Date(2026, 6, 10, 16, 0).toISOString())];
    expect(buildTimelineBlocks(punches, day)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run — expect RED** (`@/utils/manualTimelineBlocks` unresolved).

Run: `npx vitest run tests/unit/manualTimelineBlocks.test.ts`

- [ ] **Step 3: Implement the util**

Create `src/utils/manualTimelineBlocks.ts` — move `TimeBlock` and `getImportSource` here (verbatim from `ManualTimelineEditor.tsx` L17-31 and L55-... ) and add `buildTimelineBlocks`:
```ts
import { startOfDay, endOfDay } from 'date-fns';
import { TimePunch } from '@/types/timeTracking';
import { isWithinWindow } from '@/utils/punchWindow';

export interface TimeBlock {
  id: string;
  startTime: Date;
  endTime: Date;
  breakMinutes?: number;
  notes?: string;
  clockInPunchId?: string;
  clockOutPunchId?: string;
  hasClockInTime?: boolean;
  hasClockOutTime?: boolean;
  isNew?: boolean;
  isSaving?: boolean;
  isImported?: boolean;
  importSource?: string;
}

// Moved verbatim from ManualTimelineEditor (same logic that read source_type/notes).
export function getImportSource(punch: TimePunch | undefined): string | null {
  // ... exact body copied from the component ...
}

/**
 * Pair an employee's punches into clock_in→clock_out blocks WITHOUT a per-day
 * pre-filter (so a shift crossing midnight pairs whole), then keep only blocks
 * whose clock-in (startTime) falls on `date` — attributing each shift to the day
 * it began. Pass the ±18h buffered punch set so the next-day clock-out is present.
 */
export function buildTimelineBlocks(punches: TimePunch[], date: Date): TimeBlock[] {
  const sorted = [...punches].sort(
    (a, b) => new Date(a.punch_time).getTime() - new Date(b.punch_time).getTime()
  );
  const blocks: TimeBlock[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const punch = sorted[i];
    if (punch.punch_type !== 'clock_in') continue;
    const next = sorted[i + 1];
    if (next?.punch_type === 'clock_out') {
      const importSource = getImportSource(punch) || getImportSource(next);
      blocks.push({
        id: `${punch.id}-${next.id}`,
        startTime: new Date(punch.punch_time),
        endTime: new Date(next.punch_time),
        clockInPunchId: punch.id,
        clockOutPunchId: next.id,
        notes: punch.notes || next.notes || undefined,
        hasClockInTime: true,
        hasClockOutTime: true,
        isImported: Boolean(importSource),
        importSource: importSource || undefined,
      });
      i++;
    }
  }
  // Attribute by clock-in day (reuse the centralized window rule).
  const s = startOfDay(date);
  const e = endOfDay(date);
  return blocks.filter((b) => isWithinWindow(b.startTime, s, e));
}
```
(Copy `getImportSource`'s real body from the component so behaviour is identical.)

- [ ] **Step 4: Run — expect GREEN** (5 tests).

- [ ] **Step 5: Commit** — `git add src/utils/manualTimelineBlocks.ts tests/unit/manualTimelineBlocks.test.ts && git commit -m "feat(time-clock): buildTimelineBlocks — clock-in-day attribution for the Manual view"`

---

## Task 2: Wire `ManualTimelineEditor` to the util + buffered punches

**Files:**
- Modify: `src/components/time-tracking/ManualTimelineEditor.tsx`
- Modify: `src/pages/TimePunchesManager.tsx`

- [ ] **Step 1: Feed buffered punches**

In `src/pages/TimePunchesManager.tsx`, the `<ManualTimelineEditor>` render (~L733): change
`existingPunches={windowPunches}` → `existingPunches={filteredPunches}` (the ±18h buffered set; the component now attributes to the clock-in day itself). Leave the other consumers on `windowPunches`.

- [ ] **Step 2: Replace local defs + init pairing**

In `ManualTimelineEditor.tsx`:
- Remove the local `TimeBlock` interface (L17-31) and `getImportSource` (L55-...); import both from `@/utils/manualTimelineBlocks`. Keep the `EmployeeDay` interface.
- In the init `useEffect` (L91-147), replace the per-employee body that filtered by `isSameDay` and inline-paired with:
```ts
    employees.forEach(employee => {
      const employeePunches = existingPunches.filter(p => p.employee_id === employee.id);
      const blocks = buildTimelineBlocks(employeePunches, date);
      const totalHours = blocks.reduce((sum, b) => sum + getBlockDurationMinutes(b) / 60, 0);
      const hasWarning = totalHours > 12;
      dayMap.set(employee.id, {
        employee, date, blocks, totalHours, hasWarning,
        warningText: hasWarning ? 'Over 12 hours' : undefined, expanded: false,
      });
    });
```
Import: `import { TimeBlock, getImportSource, buildTimelineBlocks } from '@/utils/manualTimelineBlocks';` (drop `getImportSource` from the import if unused elsewhere — check; it's only used in the extracted code).

- [ ] **Step 3: Verify** — `npx vitest run tests/unit/manualTimelineBlocks.test.ts && npx tsc --noEmit -p tsconfig.app.json 2>&1 | head`
Expected: green, no type errors (confirms the local defs are fully removed and imports resolve).

- [ ] **Step 4: Commit** — `git commit -am "fix(time-clock): Manual view pairs overnight shifts via buildTimelineBlocks + buffered punches"`

---

## Task 3: Cross-midnight render — clip, min-width, "+1d" tag, view-only

**Files:** Modify: `src/components/time-tracking/ManualTimelineEditor.tsx`

- [ ] **Step 1: Add a helper + constant near the render**
```ts
const MIN_CROSS_MIDNIGHT_WIDTH_PCT = 4;
// A block crosses midnight when its clock-out is not on the viewed day.
const crossesMidnight = (block: TimeBlock) => !isSameDay(block.endTime, date);
```
(`isSameDay` is already imported.)

- [ ] **Step 2: Clamp position + min width in the block map (L711-714)**
```ts
{employeeDay.blocks.map((block) => {
  const startPos = getPositionFromTime(block.startTime);
  const overnight = crossesMidnight(block);
  const endPos = overnight ? 100 : getPositionFromTime(block.endTime);
  const width = overnight
    ? Math.max(endPos - startPos, MIN_CROSS_MIDNIGHT_WIDTH_PCT)
    : endPos - startPos;
  // ...
```

- [ ] **Step 3: Block body swallows clicks + gate the right handle for overnight blocks**

On the block wrapper `<div>` (L717), add for overnight blocks:
```ts
  onPointerDown={overnight ? (e) => e.stopPropagation() : undefined}
```
For the right-edge handle (L748-754): when `overnight`, render it non-interactive — `cursor-not-allowed`, no `onPointerDown` (or a no-op), and `title="Ends next day — edit the clock-out in the Punch List"`. Keep the left-edge (clock-in) handle active. When not overnight, unchanged.

- [ ] **Step 4: "+1d" end marker inside the bar (semantic tokens, a11y)**

Inside the block `<div>`, when `overnight`, add an absolutely-positioned marker anchored to the right edge, above siblings, that can't overflow into the Hours column:
```tsx
{overnight && (
  <span
    className="absolute right-1 top-0 bottom-0 flex items-center text-[10px] px-1 rounded bg-muted text-muted-foreground pointer-events-none z-20"
    aria-label={`Ends ${format(block.endTime, 'h:mm a')} the next day`}
  >
    ↳ {format(block.endTime, 'h:mm a')} +1d
  </span>
)}
```

- [ ] **Step 5: Verify build + typecheck** — `npx tsc --noEmit -p tsconfig.app.json 2>&1 | head && npm run build 2>&1 | tail -3`

- [ ] **Step 6: Commit** — `git commit -am "fix(time-clock): render cross-midnight blocks clipped with +1d tag, view-only on canvas"`

---

## Task 4: Expanded Block List — date-qualify cross-midnight end time

**Files:** Modify: `src/components/time-tracking/ManualTimelineEditor.tsx`

- [ ] **Step 1: Date-qualify the end time (L862-869 region)**

Where the block list renders `format(block.startTime,'h:mm a') → format(block.endTime,'h:mm a')`, append a `+1d` suffix when `crossesMidnight(block)`:
```tsx
{format(block.endTime, 'h:mm a')}{crossesMidnight(block) ? ' +1d' : ''}
```
Delete stays enabled (removing a whole shift is legitimate).

- [ ] **Step 2: Verify** — `npx tsc --noEmit -p tsconfig.app.json 2>&1 | head`

- [ ] **Step 3: Commit** — `git commit -am "fix(time-clock): +1d suffix on cross-midnight rows in the block list"`

---

## Task 5: E2E — Manual view counts the overnight shift

**Files:** Modify: `tests/e2e/overnight-shift-hours.spec.ts`

- [ ] **Step 1: Add a test** seeding Rakiyah's pattern (clock-in yesterday 16:45, clock-out today 00:37) + a same-day contrast employee, navigate `/time-punches` (default Day + Manual), click "Previous" to yesterday, and assert:
  - the Manual footer "Total hours for <day>" is NOT the same-day-only total — it includes the overnight hours (e.g. contains the sum of both, ~15.9h);
  - the overnight employee's row is not `0h` (assert their row shows ~7–8h, not `/^0h$/`).
  (Model on the existing tests in this file + the throwaway repro used during design.)

- [ ] **Step 2: Run** — `npx playwright test --project=e2e tests/e2e/overnight-shift-hours.spec.ts` (kill any stale server on 4173 first). Expected: all pass.

- [ ] **Step 3: Commit** — `git commit -am "test(e2e): Manual view counts overnight shift on its clock-in day"`

---

## Final verification (Phase 8)
- `npm run test` (unit incl. new `manualTimelineBlocks`), `npm run typecheck`, `npm run lint` (changed files), `npm run build`, e2e spec — all green.

## Spec coverage
Design §1 (buffered punches) → Task 2. §2 (buildTimelineBlocks) → Task 1. §3 (clip+tag+view-only) → Task 3. §4 (drag safety) → Task 3. Review resolutions: body-click → T3S3; sliver/min-width → T3S2; block-list "+1d" → Task 4; getImportSource move + isWithinWindow → Task 1; disabled-handle affordance → T3S3. Tests → Tasks 1 & 5.
