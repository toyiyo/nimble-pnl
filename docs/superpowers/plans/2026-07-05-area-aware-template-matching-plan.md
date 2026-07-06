# Area-Aware Template Matching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the shift planner grid from bucketing an employee's unlinked (no `shift_template_id`) shift into another area's template row.

**Architecture:** Single change site — `findMatchingTemplate` in `src/hooks/useShiftPlanner.ts` gains an `employeeArea` parameter and an area-compatibility predicate (`!t.area || !employeeArea || t.area === employeeArea`). Non-matching shifts fall to `__unmatched__`, which `groupUnmatchedByArea` already lanes by employee home area. Explicit `shift_template_id` bucketing is untouched.

**Tech Stack:** TypeScript, Vitest (`tests/unit/useShiftPlanner.test.ts`).

**Spec:** `docs/superpowers/specs/2026-07-05-area-aware-template-matching-design.md`

---

### Task 1: Failing tests for area-aware fallback matching

**Files:**
- Test: `tests/unit/useShiftPlanner.test.ts` (inside the existing `describe('buildTemplateGridData', ...)` block, after the `'should fall back to time-based matching when shift_template_id is absent'` test)

- [ ] **Step 1: Write the failing tests**

Add employee fixtures via the existing `mockShift` helper's `employee` override. Append inside `describe('buildTemplateGridData', ...)`:

```typescript
    describe('area-aware fallback matching', () => {
      // Josiah repro: Cold Stone template is the only exact time/position match,
      // but the shift belongs to a Wetzel's employee.
      const cscPrepWeekend: ShiftTemplate = {
        id: 't-csc-prep', start_time: '10:00:00', end_time: '16:00:00', position: 'Server',
        days: [5, 6, 0], name: 'Prep-weekend', area: 'Cold Stone',
        restaurant_id: 'r1', break_duration: 0, capacity: 1, is_active: true, created_at: '', updated_at: '',
      };
      const wtzOpenWeekend: ShiftTemplate = {
        id: 't-wtz-open', start_time: '10:00:00', end_time: '16:00:00', position: 'Server',
        days: [5, 6, 0], name: 'Open-weekend-wtz', area: "Wetzel's",
        restaurant_id: 'r1', break_duration: 0, capacity: 1, is_active: true, created_at: '', updated_at: '',
      };

      const wtzEmployee = { id: 'e-w', name: 'Josiah', area: "Wetzel's" } as Shift['employee'];
      // Saturday 2026-03-07, 10:00-16:00, Server, no shift_template_id
      const unlinkedWtzShift = (overrides: Partial<Shift> = {}) => mockShift({
        id: 's-w', employee_id: 'e-w', employee: wtzEmployee,
        start_time: '2026-03-07T10:00:00', end_time: '2026-03-07T16:00:00',
        position: 'Server', status: 'scheduled',
        ...overrides,
      });

      it('does not bucket a cross-area unlinked shift into another area\'s template row', () => {
        const grid = buildTemplateGridData([unlinkedWtzShift()], [cscPrepWeekend], weekDays);
        expect(grid.get('t-csc-prep')?.get('2026-03-07') ?? []).toHaveLength(0);
        expect(grid.get('__unmatched__')?.get('2026-03-07')).toHaveLength(1);
      });

      it('lanes the rejected cross-area shift under the employee home area via groupUnmatchedByArea', () => {
        const grid = buildTemplateGridData([unlinkedWtzShift()], [cscPrepWeekend], weekDays);
        const lanes = groupUnmatchedByArea(grid.get('__unmatched__')!);
        expect(lanes.get("Wetzel's")?.get('2026-03-07')).toHaveLength(1);
      });

      it('matches the same-area template even when a cross-area template with identical times comes first', () => {
        const grid = buildTemplateGridData([unlinkedWtzShift()], [cscPrepWeekend, wtzOpenWeekend], weekDays);
        expect(grid.get('t-wtz-open')?.get('2026-03-07')).toHaveLength(1);
        expect(grid.get('t-csc-prep')?.get('2026-03-07') ?? []).toHaveLength(0);
      });

      it('matches permissively when the employee has no area', () => {
        const noAreaEmployee = { id: 'e-n', name: 'NoArea' } as Shift['employee'];
        const shift = unlinkedWtzShift({ employee_id: 'e-n', employee: noAreaEmployee });
        const grid = buildTemplateGridData([shift], [cscPrepWeekend], weekDays);
        expect(grid.get('t-csc-prep')?.get('2026-03-07')).toHaveLength(1);
      });

      it('matches permissively when the template has no area', () => {
        const noAreaTemplate: ShiftTemplate = { ...cscPrepWeekend, id: 't-no-area', area: null };
        const grid = buildTemplateGridData([unlinkedWtzShift()], [noAreaTemplate], weekDays);
        expect(grid.get('t-no-area')?.get('2026-03-07')).toHaveLength(1);
      });
    });
```

- [ ] **Step 2: Run tests to verify the right ones fail**

Run: `npx vitest run tests/unit/useShiftPlanner.test.ts`
Expected: the first three new tests FAIL (shift currently buckets into `t-csc-prep`); the two permissive-null tests PASS (current behavior already permissive); all pre-existing tests PASS.

### Task 2: Implement area-compatible matching

**Files:**
- Modify: `src/hooks/useShiftPlanner.ts:100-167` (`findMatchingTemplate` + its caller in `buildTemplateGridData`)

- [ ] **Step 1: Add the area parameter and predicate**

Replace `findMatchingTemplate`:

```typescript
/**
 * Find the first template that matches a shift's time, position, and active
 * day, and is area-compatible with the employee: a template with an area only
 * matches an employee from the same area (or with no area). Prevents an
 * unlinked shift from rendering under another area's template row.
 */
function findMatchingTemplate(
  templates: ShiftTemplate[],
  shiftStart: string,
  shiftEnd: string,
  position: string,
  dayOfWeek: number,
  employeeArea: string | null,
): ShiftTemplate | undefined {
  return templates.find(
    (t) =>
      t.start_time === shiftStart &&
      t.end_time === shiftEnd &&
      t.position === position &&
      t.days.includes(dayOfWeek) &&
      (!t.area || !employeeArea || t.area === employeeArea),
  );
}
```

Update the caller in `buildTemplateGridData`:

```typescript
    const match = findMatchingTemplate(
      templates,
      shiftStart,
      shiftEnd,
      shift.position,
      dayOfWeek,
      shift.employee?.area ?? null,
    );
```

Also extend the `buildTemplateGridData` JSDoc line "Matches shifts to templates by comparing start_time (HH:MM:SS), end_time (HH:MM:SS), and position." to "... position, active day, and area compatibility (employee home area vs template area; null on either side is permissive)."

- [ ] **Step 2: Run tests to verify all pass**

Run: `npx vitest run tests/unit/useShiftPlanner.test.ts`
Expected: ALL tests PASS, including the five new ones.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useShiftPlanner.ts tests/unit/useShiftPlanner.test.ts
git commit -m "fix(scheduling): area-aware fallback template matching in planner grid

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 3: Full local verification

- [ ] **Step 1: Run the full unit suite, typecheck, lint**

Run: `npm run test && npm run typecheck && npm run lint`
Expected: all green. (No DB or E2E surface touched; `npm run build` runs in Phase 8.)

- [ ] **Step 2: Grep for stale comments referencing the old matching contract**

Run: `grep -rn "time/position" src/ | grep -i template`
Expected: only the updated JSDoc in `useShiftPlanner.ts`. Fix any stragglers that describe area-blind matching as current behavior; commit if changed.
