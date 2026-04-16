# Planner Shift-to-Template Bucketing Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the planner bug where shifts display under the wrong template row when two templates across different areas share the same time/position/days.

**Architecture:** Add a nullable `shift_template_id` foreign key to the `shifts` table. Thread the template ID through the planner's shift creation flow. Use it in `buildTemplateGridData` for deterministic bucketing, falling back to the existing fuzzy matching for legacy shifts.

**Tech Stack:** PostgreSQL migration, TypeScript, React, Vitest

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `supabase/migrations/20260416000000_add_shift_template_id.sql` | Create | Add `shift_template_id` column to `shifts` |
| `src/types/scheduling.ts` | Modify | Add `shift_template_id` to `Shift` interface |
| `src/hooks/useShiftPlanner.ts` | Modify | Update `buildTemplateGridData` to use template ID; add `shiftTemplateId` to `ShiftCreateInput` and `buildShiftPayload` |
| `src/components/scheduling/ShiftPlanner/ShiftPlannerTab.tsx` | Modify | Thread template ID through `handleAssignDay`/`handleAssignAll` |
| `tests/unit/useShiftPlanner.test.ts` | Modify | Add tests for template-ID-based bucketing |

---

### Task 1: Database migration — add `shift_template_id` to shifts

**Files:**
- Create: `supabase/migrations/20260416000000_add_shift_template_id.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Add shift_template_id to shifts for accurate planner bucketing.
-- Nullable: legacy/imported shifts won't have a template reference.
ALTER TABLE shifts
  ADD COLUMN shift_template_id UUID REFERENCES shift_templates(id) ON DELETE SET NULL;

-- Index for efficient lookups when building the planner grid
CREATE INDEX idx_shifts_shift_template_id ON shifts(shift_template_id)
  WHERE shift_template_id IS NOT NULL;
```

- [ ] **Step 2: Verify migration applies cleanly**

Run: `npm run db:reset`
Expected: All migrations apply without errors.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260416000000_add_shift_template_id.sql
git commit -m "feat(db): add shift_template_id column to shifts table"
```

---

### Task 2: Update TypeScript types

**Files:**
- Modify: `src/types/scheduling.ts:89-110` (Shift interface)

- [ ] **Step 1: Add `shift_template_id` to the Shift interface**

In `src/types/scheduling.ts`, add the field after `source`:

```typescript
  source: 'manual' | 'ai' | 'template';
  shift_template_id?: string | null; // References shift_templates.id for planner bucketing
  created_at: string;
```

- [ ] **Step 2: Regenerate Supabase types**

Run: `npx supabase gen types typescript --local > src/integrations/supabase/types.ts`
Expected: `shift_template_id` appears in the generated `shifts` table type.

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/types/scheduling.ts src/integrations/supabase/types.ts
git commit -m "feat(types): add shift_template_id to Shift interface and regenerate Supabase types"
```

---

### Task 3: Update `buildTemplateGridData` to use `shift_template_id`

**Files:**
- Modify: `src/hooks/useShiftPlanner.ts:122-151`
- Test: `tests/unit/useShiftPlanner.test.ts`

- [ ] **Step 1: Write the failing test — shift with `shift_template_id` buckets correctly**

Add this test to the `buildTemplateGridData` describe block in `tests/unit/useShiftPlanner.test.ts`:

```typescript
    it('should bucket shift by shift_template_id when present, ignoring time-based matching', () => {
      // Two templates with identical time/position/days but different areas
      const cscTemplate: ShiftTemplate = {
        id: 't-csc', start_time: '10:00:00', end_time: '16:30:00', position: 'Server',
        days: [5, 6, 0], name: 'Open-weekend-csc', area: 'Cold Stone',
        restaurant_id: 'r1', break_duration: 0, capacity: 2, is_active: true, created_at: '', updated_at: '',
      };
      const wtzTemplate: ShiftTemplate = {
        id: 't-wtz', start_time: '10:00:00', end_time: '16:30:00', position: 'Server',
        days: [5, 6, 0], name: 'Open-weekend-wtz', area: "Wetzel's",
        restaurant_id: 'r1', break_duration: 0, capacity: 2, is_active: true, created_at: '', updated_at: '',
      };

      // Shift explicitly linked to wtz template
      const shift = mockShift({
        id: 's1', employee_id: 'e1',
        start_time: '2026-03-07T10:00:00', end_time: '2026-03-07T16:30:00',
        position: 'Server', status: 'scheduled',
        shift_template_id: 't-wtz',
      });

      const grid = buildTemplateGridData([shift], [cscTemplate, wtzTemplate], weekDays);

      // Should be in wtz bucket, NOT csc (which would be the .find() first-match)
      expect(grid.get('t-wtz')?.get('2026-03-07')).toHaveLength(1);
      expect(grid.get('t-csc')?.get('2026-03-07') ?? []).toHaveLength(0);
    });

    it('should fall back to time-based matching when shift_template_id is absent', () => {
      // Legacy shift without shift_template_id — should still match by time/position/day
      const shift = mockShift({
        id: 's1', employee_id: 'e1',
        start_time: '2026-03-02T06:00:00', end_time: '2026-03-02T12:00:00',
        position: 'Server', status: 'scheduled',
        // No shift_template_id
      });

      const grid = buildTemplateGridData([shift], templates, weekDays);
      expect(grid.get('t1')?.get('2026-03-02')).toHaveLength(1);
    });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- tests/unit/useShiftPlanner.test.ts`
Expected: The first new test fails because `buildTemplateGridData` doesn't check `shift_template_id`.

- [ ] **Step 3: Update `buildTemplateGridData` to check `shift_template_id` first**

In `src/hooks/useShiftPlanner.ts`, replace the `buildTemplateGridData` function (lines 122-151):

```typescript
export function buildTemplateGridData(
  shifts: Shift[],
  templates: ShiftTemplate[],
  weekDays: string[],
): Map<string, Map<string, Shift[]>> {
  const weekDaySet = new Set(weekDays);
  const grid = new Map<string, Map<string, Shift[]>>();
  const templateIds = new Set(templates.map((t) => t.id));

  for (const t of templates) {
    grid.set(t.id, new Map());
  }
  grid.set('__unmatched__', new Map());

  for (const shift of shifts) {
    if (shift.status === 'cancelled') continue;
    const shiftStartAt = new Date(shift.start_time);
    const dayStr = formatLocalDate(shiftStartAt);
    if (!weekDaySet.has(dayStr)) continue;

    // Prefer explicit template ID (set during planner assignment)
    if (shift.shift_template_id && templateIds.has(shift.shift_template_id)) {
      pushToGridBucket(grid.get(shift.shift_template_id)!, dayStr, shift);
      continue;
    }

    // Fallback: match by time/position/day for legacy shifts
    const shiftStart = formatLocalTime(shift.start_time);
    const shiftEnd = formatLocalTime(shift.end_time);
    const dayOfWeek = shiftStartAt.getDay();
    const match = findMatchingTemplate(templates, shiftStart, shiftEnd, shift.position, dayOfWeek);

    const bucketKey = match ? match.id : '__unmatched__';
    pushToGridBucket(grid.get(bucketKey)!, dayStr, shift);
  }

  return grid;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -- tests/unit/useShiftPlanner.test.ts`
Expected: All tests pass, including the two new ones.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useShiftPlanner.ts tests/unit/useShiftPlanner.test.ts
git commit -m "fix: use shift_template_id for planner grid bucketing with fallback"
```

---

### Task 4: Thread template ID through shift creation

**Files:**
- Modify: `src/hooks/useShiftPlanner.ts:254-262` (ShiftCreateInput), `src/hooks/useShiftPlanner.ts:167-184` (buildShiftPayload)
- Modify: `src/components/scheduling/ShiftPlanner/ShiftPlannerTab.tsx:186-218` (handleAssignDay), `src/components/scheduling/ShiftPlanner/ShiftPlannerTab.tsx:221-271` (handleAssignAll)

- [ ] **Step 1: Add `shiftTemplateId` to `ShiftCreateInput`**

In `src/hooks/useShiftPlanner.ts`, update the `ShiftCreateInput` interface:

```typescript
export interface ShiftCreateInput {
  employeeId: string;
  date: string;
  startTime: string;
  endTime: string;
  position: string;
  breakDuration?: number;
  notes?: string;
  shiftTemplateId?: string;
}
```

- [ ] **Step 2: Pass it through `buildShiftPayload`**

In `src/hooks/useShiftPlanner.ts`, update the `buildShiftPayload` function:

```typescript
function buildShiftPayload(
  restaurantId: string,
  input: ShiftCreateInput,
  interval: ShiftInterval,
) {
  return {
    restaurant_id: restaurantId,
    employee_id: input.employeeId,
    start_time: interval.startAt.toISOString(),
    end_time: interval.endAt.toISOString(),
    position: input.position,
    break_duration: input.breakDuration ?? 0,
    notes: input.notes,
    status: 'scheduled' as const,
    is_published: false,
    locked: false,
    shift_template_id: input.shiftTemplateId ?? null,
  };
}
```

- [ ] **Step 3: Thread template ID in `handleAssignDay`**

In `src/components/scheduling/ShiftPlanner/ShiftPlannerTab.tsx`, update `handleAssignDay` to include `shiftTemplateId` in the input:

```typescript
    const input: ShiftCreateInput = {
      employeeId: employee.id,
      date: day,
      startTime: startHHMM,
      endTime: endHHMM,
      position: template.position,
      breakDuration: template.break_duration,
      shiftTemplateId: template.id,
    };
```

- [ ] **Step 4: Thread template ID in `handleAssignAll`**

In `src/components/scheduling/ShiftPlanner/ShiftPlannerTab.tsx`, update `handleAssignAll` to include `shiftTemplateId` in each input:

```typescript
    const allInputs: ShiftCreateInput[] = activeDays.map((day) => ({
      employeeId: employee.id,
      date: day,
      startTime: startHHMM,
      endTime: endHHMM,
      position: template.position,
      breakDuration: template.break_duration,
      shiftTemplateId: template.id,
    }));
```

- [ ] **Step 5: Run typecheck and tests**

Run: `npm run typecheck && npm run test`
Expected: Both pass without errors.

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useShiftPlanner.ts src/components/scheduling/ShiftPlanner/ShiftPlannerTab.tsx
git commit -m "fix: thread shift_template_id through planner shift creation flow"
```

---

### Task 5: Include `shift_template_id` in shift query select

**Files:**
- Modify: `src/hooks/useShifts.tsx:56-68`

- [ ] **Step 1: Verify the select includes `shift_template_id`**

The current query uses `select('*, employee:employees(*)')` which already selects all columns including the new `shift_template_id`. No code change needed — the wildcard `*` covers it.

Verify by checking `toTypedShift` handles the new field. Since it spreads `...shift` into the return object, the field passes through automatically.

- [ ] **Step 2: Run the full test suite**

Run: `npm run test`
Expected: All tests pass.

- [ ] **Step 3: No commit needed** (no code changes)

---

### Task 6: Full verification

- [ ] **Step 1: Reset database and verify migration**

Run: `npm run db:reset`
Expected: All migrations apply cleanly.

- [ ] **Step 2: Run all unit tests**

Run: `npm run test`
Expected: All pass.

- [ ] **Step 3: Run typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: No errors.

- [ ] **Step 4: Run build**

Run: `npm run build`
Expected: Successful build.

- [ ] **Step 5: Manual smoke test**

Start dev server (`npm run dev:full`). In the Planner:
1. Create two templates in different areas with identical time/position/days
2. Drag an employee onto the first template's cell
3. Verify the shift appears in the correct template row (not the other area's row)
4. Verify the toast and dialog show the correct template name
5. Repeat for the second template to confirm both work independently
