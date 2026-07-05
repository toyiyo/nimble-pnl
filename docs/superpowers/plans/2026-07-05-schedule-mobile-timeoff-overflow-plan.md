# Schedule Mobile Time-Off Overflow Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the /scheduling page from rendering zoomed-out/left-squeezed on phones by containing the absolutely positioned `sr-only` time-off spans inside the schedule grid's scroll container.

**Architecture:** Two Tailwind class additions establish positioning contexts: `relative` on the day-cell `<td>` (`DroppableDayCell`) so every abspos descendant of a cell resolves its containing block inside the `overflow-x-auto` scroller, and `relative` on the scroller itself as defense in depth for the rest of the table. Regression tests pin the structural containment invariant (not class-string presence). See design doc: `docs/superpowers/specs/2026-07-05-schedule-mobile-timeoff-overflow-design.md`.

**Tech Stack:** React 18, Tailwind, @dnd-kit/core, Vitest + @testing-library/react (jsdom).

---

### Task 1: Containment regression test + fix for `DroppableDayCell`

**Files:**
- Test: `tests/unit/droppableDayCell.containment.test.tsx` (create)
- Modify: `src/components/scheduling/DroppableDayCell.tsx:30-35`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/droppableDayCell.containment.test.tsx`:

```tsx
/**
 * Containment regression test for DroppableDayCell.
 *
 * Bug history: Tailwind `sr-only` is position:absolute. An absolutely
 * positioned element is clipped by an overflow ancestor ONLY if that
 * ancestor is also its containing block (i.e. positioned). The schedule
 * grid renders sr-only time-off markers inside day cells; when the cell
 * <td> was unpositioned, the spans escaped the grid's overflow-x-auto
 * scroller and inflated documentElement.scrollWidth to ~951px on a 375px
 * viewport, so phones zoomed out and the page looked squeezed left.
 *
 * jsdom has no layout engine, so this test pins the structural invariant:
 * walking up from the sr-only span, the nearest ancestor carrying a
 * positioning class must be the <td> itself — the cell is the containing
 * block that keeps abspos descendants inside the scroller.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { DndContext } from '@dnd-kit/core';
import { DroppableDayCell } from '@/components/scheduling/DroppableDayCell';

const POSITIONING_CLASSES = new Set(['relative', 'absolute', 'sticky', 'fixed']);

const hasPositioningClass = (el: Element) =>
  el.className
    .toString()
    .split(/\s+/)
    .some((cls) => POSITIONING_CLASSES.has(cls));

describe('DroppableDayCell containment', () => {
  it('the <td> is the nearest positioned ancestor of sr-only descendants', () => {
    const { container } = render(
      <DndContext>
        <table>
          <tbody>
            <tr>
              <DroppableDayCell
                employeeId="e1"
                day="2026-07-01"
                isToday={false}
                isHighlighted={false}
              >
                {/* Mirrors the production off-day markup in Scheduling.tsx */}
                <div className="space-y-1 min-h-[48px]">
                  <span className="sr-only">Approved time off</span>
                </div>
              </DroppableDayCell>
            </tr>
          </tbody>
        </table>
      </DndContext>
    );

    const srOnly = container.querySelector('span.sr-only');
    expect(srOnly).not.toBeNull();

    let ancestor: Element | null = srOnly!.parentElement;
    while (ancestor && !hasPositioningClass(ancestor)) {
      ancestor = ancestor.parentElement;
    }

    expect(ancestor).not.toBeNull();
    expect(ancestor!.tagName).toBe('TD');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/droppableDayCell.containment.test.tsx`
Expected: FAIL — the walk exhausts ancestors (`ancestor` is null) because no element between the sr-only span and the document root carries a positioning class.

- [ ] **Step 3: Add `relative` to the `<td>` in `DroppableDayCell.tsx`**

In `src/components/scheduling/DroppableDayCell.tsx`, change the `<td>`'s class list (the string literal inside `cn(...)`):

```tsx
    <td
      ref={setNodeRef}
      className={cn(
        // `relative` makes this cell the containing block for absolutely
        // positioned descendants (e.g. sr-only markers), so they stay
        // clipped inside the grid's overflow-x-auto scroller instead of
        // widening the document on mobile.
        'relative p-2 align-top transition-colors',
        dayIsToday && 'bg-primary/5',
        isOver && 'bg-primary/5 ring-1 ring-inset ring-primary/30 rounded-lg',
        isHighlighted && 'bg-success/10 transition-colors duration-500',
      )}
    >
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/droppableDayCell.containment.test.tsx`
Expected: PASS (1 test)

- [ ] **Step 5: Commit**

```bash
git add tests/unit/droppableDayCell.containment.test.tsx src/components/scheduling/DroppableDayCell.tsx
git commit -m "fix(scheduling): day cell contains abspos sr-only spans (mobile squeeze)"
```

### Task 2: Scroller defense-in-depth test + fix in `Scheduling.tsx`

**Files:**
- Test: `tests/unit/schedulingGridScroller.test.ts` (create)
- Modify: `src/pages/Scheduling.tsx:1478`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/schedulingGridScroller.test.ts`:

```ts
/**
 * Source-level guard for the schedule grid scroller in Scheduling.tsx.
 *
 * The grid's overflow-x-auto wrapper must also be `relative` so that ANY
 * absolutely positioned descendant of the table (current or future)
 * resolves its containing block at or below the scroller and gets clipped
 * by it, instead of leaking into documentElement scroll width on mobile.
 *
 * Rendering Scheduling.tsx is prohibitively hook-heavy (see
 * memory/lessons.md — PR #504), so this parses the single className token
 * that contains overflow-x-auto and asserts `relative` is one of its
 * whitespace-split class tokens (same element — not a loose file regex).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Scheduling grid scroller', () => {
  it('pairs overflow-x-auto with relative on the same element', () => {
    const src = readFileSync(
      resolve(__dirname, '../../src/pages/Scheduling.tsx'),
      'utf8'
    );

    const classAttrs = [...src.matchAll(/className="([^"]*)"/g)]
      .map((m) => m[1])
      .filter((cls) => cls.split(/\s+/).includes('overflow-x-auto'));

    // Exactly one grid scroller exists in this page today; if that changes,
    // every one of them must carry `relative`.
    expect(classAttrs.length).toBeGreaterThan(0);
    for (const cls of classAttrs) {
      expect(cls.split(/\s+/)).toContain('relative');
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/schedulingGridScroller.test.ts`
Expected: FAIL — `expect(cls.split(/\s+/)).toContain('relative')` fails for `"overflow-x-auto"`.

- [ ] **Step 3: Add `relative` to the scroller div**

In `src/pages/Scheduling.tsx` line 1478, change:

```tsx
            <div className="overflow-x-auto">
```

to:

```tsx
            {/* relative: clip abspos descendants of the table inside this scroller (mobile squeeze fix) */}
            <div className="relative overflow-x-auto">
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/schedulingGridScroller.test.ts`
Expected: PASS (1 test)

- [ ] **Step 5: Commit**

```bash
git add tests/unit/schedulingGridScroller.test.ts src/pages/Scheduling.tsx
git commit -m "fix(scheduling): make grid scroller a containing block (defense in depth)"
```

### Task 3: Full-suite + live mobile verification

**Files:** none created; verification only.

- [ ] **Step 1: Run the full unit suite**

Run: `npm run test`
Expected: all tests pass (both new tests included).

- [ ] **Step 2: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: clean exit for both.

- [ ] **Step 3: Live mobile verification (evidence, not assertion)**

The main checkout's dev server (port 8080) and local Supabase already have
the repro data seeded (restaurant `a1e1d70c-236f-4f85-b51f-edcda986d7dd`,
user mobiletest@example.com, employee "Termora Johnson" with an approved
Mon–Sun time-off in the current week). This task's changes live in the
worktree, so serve the worktree on port 8081:

```bash
ln -sf /Users/josedelgado/Documents/GitHub/nimble-pnl/.env.local .env.local
ln -sfn /Users/josedelgado/Documents/GitHub/nimble-pnl/node_modules node_modules
npx vite --port 8081
```

Then in a 375px-wide browser context, log in as mobiletest@example.com /
testpass123! and load `http://localhost:8081/scheduling`. Measure:

```js
({ docW: document.documentElement.scrollWidth, innerW: window.innerWidth })
```

Expected: `docW === innerW === 375` (before the fix, docW ≈ 951–956) and no
horizontal scrolling (`window.scrollTo(600,0); window.scrollX === 0`).

- [ ] **Step 4: Update progress.md** with verification evidence (numbers observed).
