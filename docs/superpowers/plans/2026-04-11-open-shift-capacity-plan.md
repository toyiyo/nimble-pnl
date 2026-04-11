# Open Shift Capacity — Implementation Plan (PR1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Managers can set staffing capacity on shift templates and see at a glance where they're short-staffed in the planner grid.

**Architecture:** Add a `capacity` column (default 1) to `shift_templates`. The planner grid compares `capacity` vs count of assigned shifts per template/day to show "assigned/needed" indicators. The publish dialog warns about unfilled spots. No new tables — this is a read-side enhancement to existing data.

**Tech Stack:** PostgreSQL migration, TypeScript/React, React Query, Vitest, pgTAP, Playwright

**Design spec:** `docs/superpowers/specs/2026-04-11-open-shift-claiming-design.md`

---

### Task 1: Add `capacity` column to `shift_templates`

**Files:**
- Create: `supabase/migrations/YYYYMMDDHHMMSS_add_capacity_to_shift_templates.sql`
- Create: `supabase/tests/shift_template_capacity.test.sql`

- [ ] **Step 1: Write the pgTAP test**

Create `supabase/tests/shift_template_capacity.test.sql`:

```sql
BEGIN;
SELECT plan(5);

-- Test 1: capacity column exists with default 1
SELECT has_column('shift_templates', 'capacity',
  'shift_templates should have a capacity column');

SELECT col_default_is('shift_templates', 'capacity', '1',
  'capacity should default to 1');

-- Test 2: capacity must be >= 1
SELECT lives_ok(
  $$INSERT INTO shift_templates (restaurant_id, name, days, start_time, end_time, position, capacity)
    VALUES ((SELECT id FROM restaurants LIMIT 1), 'Test', '{1,2}', '09:00', '17:00', 'Server', 3)$$,
  'capacity of 3 is valid'
);

SELECT throws_ok(
  $$INSERT INTO shift_templates (restaurant_id, name, days, start_time, end_time, position, capacity)
    VALUES ((SELECT id FROM restaurants LIMIT 1), 'Test Zero', '{1}', '09:00', '17:00', 'Server', 0)$$,
  '23514',
  NULL,
  'capacity of 0 violates check constraint'
);

SELECT throws_ok(
  $$INSERT INTO shift_templates (restaurant_id, name, days, start_time, end_time, position, capacity)
    VALUES ((SELECT id FROM restaurants LIMIT 1), 'Test Neg', '{1}', '09:00', '17:00', 'Server', -1)$$,
  '23514',
  NULL,
  'negative capacity violates check constraint'
);

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:db`
Expected: FAIL — column `capacity` does not exist.

- [ ] **Step 3: Write the migration**

Create the migration file (use `npx supabase migration new add_capacity_to_shift_templates` to get the timestamp):

```sql
-- Add capacity column to shift_templates
-- Represents how many employees are needed for this shift slot
ALTER TABLE shift_templates
  ADD COLUMN capacity INTEGER NOT NULL DEFAULT 1;

ALTER TABLE shift_templates
  ADD CONSTRAINT valid_capacity CHECK (capacity >= 1);
```

- [ ] **Step 4: Reset the database and run tests**

Run: `npx supabase db reset && npm run test:db`
Expected: All pgTAP tests pass, including the new capacity tests.

- [ ] **Step 5: Regenerate TypeScript types**

Run: `npx supabase gen types typescript --local > src/integrations/supabase/types.ts`

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/*_add_capacity_to_shift_templates.sql supabase/tests/shift_template_capacity.test.sql src/integrations/supabase/types.ts
git commit -m "feat: add capacity column to shift_templates"
```

---

### Task 2: Update `ShiftTemplate` TypeScript type and hook

**Files:**
- Modify: `src/types/scheduling.ts:111-123`
- Modify: `src/hooks/useShiftTemplates.ts:25-33` (TemplateInput type) and mutation

- [ ] **Step 1: Write the failing unit test**

Create `tests/unit/shiftTemplateCapacity.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';

// We're testing the type + a pure helper that computes open spots
import { computeOpenSpots } from '@/lib/openShiftHelpers';

describe('computeOpenSpots', () => {
  it('returns capacity minus assigned count', () => {
    expect(computeOpenSpots(3, 1)).toBe(2);
  });

  it('returns 0 when fully staffed', () => {
    expect(computeOpenSpots(2, 2)).toBe(0);
  });

  it('returns 0 when over-staffed (clamped)', () => {
    expect(computeOpenSpots(2, 3)).toBe(0);
  });

  it('returns full capacity when nobody assigned', () => {
    expect(computeOpenSpots(3, 0)).toBe(3);
  });

  it('defaults capacity to 1 when undefined', () => {
    expect(computeOpenSpots(undefined, 0)).toBe(1);
    expect(computeOpenSpots(undefined, 1)).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/shiftTemplateCapacity.test.ts`
Expected: FAIL — `computeOpenSpots` does not exist.

- [ ] **Step 3: Add `capacity` to the ShiftTemplate type**

In `src/types/scheduling.ts`, add `capacity` to the `ShiftTemplate` interface:

```typescript
export interface ShiftTemplate {
  id: string;
  restaurant_id: string;
  name: string;
  days: number[];
  start_time: string;
  end_time: string;
  break_duration: number;
  position: string;
  capacity: number; // How many employees needed (default 1)
  is_active: boolean;
  created_at: string;
  updated_at: string;
}
```

- [ ] **Step 4: Create the `openShiftHelpers` module**

Create `src/lib/openShiftHelpers.ts`:

```typescript
/**
 * Compute how many open spots remain for a template on a given day.
 * Clamps to 0 (never negative).
 */
export function computeOpenSpots(
  capacity: number | undefined,
  assignedCount: number,
): number {
  const cap = capacity ?? 1;
  return Math.max(0, cap - assignedCount);
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/unit/shiftTemplateCapacity.test.ts`
Expected: PASS

- [ ] **Step 6: Update `useShiftTemplates` to include `capacity` in mutations**

In `src/hooks/useShiftTemplates.ts`, the `TemplateInput` type (line 33) already uses `Omit<ShiftTemplate, 'id' | 'created_at' | 'updated_at'>`, so it will automatically include `capacity` from the updated type. No code change needed in the hook itself — the type flows through.

Verify by checking the existing `createMutation` and `updateMutation` — they pass through the input object directly, so `capacity` will be included when provided.

- [ ] **Step 7: Commit**

```bash
git add src/types/scheduling.ts src/lib/openShiftHelpers.ts tests/unit/shiftTemplateCapacity.test.ts
git commit -m "feat: add capacity to ShiftTemplate type and open spot helper"
```

---

### Task 3: Add "Staff Needed" field to `TemplateFormDialog`

**Files:**
- Modify: `src/components/scheduling/ShiftPlanner/TemplateFormDialog.tsx`

- [ ] **Step 1: Add `capacity` state and form field**

In `TemplateFormDialog.tsx`, add a `capacity` state variable alongside the existing form state (after line 50):

```typescript
const [capacity, setCapacity] = useState(1);
```

In the `useEffect` that pre-fills the form (lines 54-71), add capacity handling:

```typescript
// Inside the if (template) block, after setBreakDuration:
setCapacity(template.capacity ?? 1);

// Inside the else block, after setBreakDuration(0):
setCapacity(1);
```

- [ ] **Step 2: Add the capacity field to the form UI**

Add this block after the Break Duration field (after line 246) and before the Footer:

```tsx
{/* Staff Needed */}
<div className="space-y-1.5">
  <Label
    htmlFor="capacity"
    className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider"
  >
    Staff Needed
  </Label>
  <Input
    id="capacity"
    type="number"
    min={1}
    value={capacity}
    onChange={(e) => setCapacity(Math.max(1, Number.parseInt(e.target.value, 10) || 1))}
    className="h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg focus-visible:ring-1 focus-visible:ring-border"
  />
  <p className="text-[11px] text-muted-foreground">
    How many employees are needed for this shift
  </p>
</div>
```

- [ ] **Step 3: Include `capacity` in the onSubmit call**

Update the `handleSubmit` function's `onSubmit` call (lines 87-94) to include capacity:

```typescript
await onSubmit({
  name: name.trim(),
  start_time: startTime,
  end_time: endTime,
  position: position.trim(),
  days,
  break_duration: breakDuration,
  capacity,
});
```

- [ ] **Step 4: Update the `onSubmit` prop type to include `capacity`**

In the `TemplateFormDialogProps` interface (lines 25-31), add `capacity` to the data shape:

```typescript
onSubmit: (data: {
  name: string;
  start_time: string;
  end_time: string;
  position: string;
  days: number[];
  break_duration: number;
  capacity: number;
}) => void | Promise<void>;
```

- [ ] **Step 5: Run typecheck to confirm no type errors**

Run: `npm run typecheck`
Expected: No new errors. The callers of `TemplateFormDialog` pass `onSubmit` through to `createTemplate`/`updateTemplate`, which accept `TemplateInput`. Since `TemplateInput` now includes `capacity`, the types align.

- [ ] **Step 6: Commit**

```bash
git add src/components/scheduling/ShiftPlanner/TemplateFormDialog.tsx
git commit -m "feat: add Staff Needed field to template form dialog"
```

---

### Task 4: Show capacity indicators in the planner grid

**Files:**
- Modify: `src/components/scheduling/ShiftPlanner/ShiftCell.tsx`
- Modify: `src/components/scheduling/ShiftPlanner/TemplateGrid.tsx`
- Create: `tests/unit/openShiftHelpers.test.ts` (already created in Task 2, extend)

- [ ] **Step 1: Write the failing test for the capacity indicator logic**

Extend `tests/unit/shiftTemplateCapacity.test.ts` with indicator classification:

```typescript
import { computeOpenSpots, classifyCapacity } from '@/lib/openShiftHelpers';

describe('classifyCapacity', () => {
  it('returns "full" when no open spots', () => {
    expect(classifyCapacity(3, 3)).toBe('full');
  });

  it('returns "partial" when some spots filled', () => {
    expect(classifyCapacity(3, 1)).toBe('partial');
  });

  it('returns "empty" when no spots filled', () => {
    expect(classifyCapacity(3, 0)).toBe('empty');
  });

  it('returns "full" for default capacity of 1 with 1 assigned', () => {
    expect(classifyCapacity(1, 1)).toBe('full');
  });

  it('returns "full" when over-staffed', () => {
    expect(classifyCapacity(2, 3)).toBe('full');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/shiftTemplateCapacity.test.ts`
Expected: FAIL — `classifyCapacity` does not exist.

- [ ] **Step 3: Implement `classifyCapacity`**

Add to `src/lib/openShiftHelpers.ts`:

```typescript
export type CapacityStatus = 'full' | 'partial' | 'empty';

/**
 * Classify how filled a template slot is on a given day.
 */
export function classifyCapacity(
  capacity: number | undefined,
  assignedCount: number,
): CapacityStatus {
  const open = computeOpenSpots(capacity, assignedCount);
  if (open === 0) return 'full';
  if (assignedCount > 0) return 'partial';
  return 'empty';
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/shiftTemplateCapacity.test.ts`
Expected: PASS

- [ ] **Step 5: Pass `capacity` through `TemplateGrid` to `ShiftCell`**

In `src/components/scheduling/ShiftPlanner/TemplateGrid.tsx`, update `ShiftCell` usage (line 96-105) to pass capacity:

```tsx
<ShiftCell
  templateId={template.id}
  day={day}
  isActiveDay={isActiveDay}
  shifts={shifts}
  capacity={template.capacity ?? 1}
  onRemoveShift={onRemoveShift}
  isHighlighted={highlightCellId === `${template.id}:${day}`}
  onMobileTap={onMobileCellTap}
  hasMobileSelection={hasMobileSelection}
/>
```

- [ ] **Step 6: Add capacity indicator to `ShiftCell`**

In `src/components/scheduling/ShiftPlanner/ShiftCell.tsx`:

Add import at top:
```typescript
import { computeOpenSpots, classifyCapacity } from '@/lib/openShiftHelpers';
```

Add `capacity` to the `ShiftCellProps` interface (after line 15):
```typescript
capacity: number;
```

Add the indicator inside the active-day return (after the shifts map, before the closing `</div>`, around line 70):

```tsx
{/* Capacity indicator — only show when capacity > 1 */}
{capacity > 1 && (
  <div
    className={cn(
      'text-[10px] font-medium px-1.5 py-0.5 rounded text-center',
      classifyCapacity(capacity, shifts.length) === 'full'
        ? 'text-emerald-600 bg-emerald-500/10'
        : classifyCapacity(capacity, shifts.length) === 'partial'
          ? 'text-amber-600 bg-amber-500/10'
          : 'text-red-500 bg-red-500/10',
    )}
  >
    {shifts.length}/{capacity}
  </div>
)}
```

Update the memo comparison (lines 74-82) to include `capacity`:
```typescript
(prev, next) =>
  prev.templateId === next.templateId &&
  prev.day === next.day &&
  prev.isActiveDay === next.isActiveDay &&
  prev.shifts === next.shifts &&
  prev.capacity === next.capacity &&
  prev.onRemoveShift === next.onRemoveShift &&
  prev.isHighlighted === next.isHighlighted &&
  prev.hasMobileSelection === next.hasMobileSelection &&
  prev.onMobileTap === next.onMobileTap,
```

- [ ] **Step 7: Run typecheck**

Run: `npm run typecheck`
Expected: No errors.

- [ ] **Step 8: Commit**

```bash
git add src/lib/openShiftHelpers.ts src/components/scheduling/ShiftPlanner/ShiftCell.tsx src/components/scheduling/ShiftPlanner/TemplateGrid.tsx tests/unit/shiftTemplateCapacity.test.ts
git commit -m "feat: show capacity indicators in planner grid cells"
```

---

### Task 5: Add open shift count to publish dialog

**Files:**
- Modify: `src/components/PublishScheduleDialog.tsx`

- [ ] **Step 1: Add `openShiftCount` prop**

In `PublishScheduleDialogProps` (lines 23-33), add:

```typescript
openShiftCount: number;
```

- [ ] **Step 2: Add the info alert when there are open shifts**

After the Summary Stats grid (after line 98) and before the Warning Alert (line 101), add:

```tsx
{openShiftCount > 0 && (
  <Alert className="border-amber-500/50 bg-amber-500/10">
    <AlertTriangle className="h-4 w-4 text-amber-600" />
    <AlertDescription className="text-sm">
      <strong>{openShiftCount} {openShiftCount === 1 ? 'shift' : 'shifts'} still {openShiftCount === 1 ? 'needs' : 'need'} staff.</strong>{' '}
      You can fill these now or broadcast to your team later.
    </AlertDescription>
  </Alert>
)}
```

- [ ] **Step 3: Compute `openShiftCount` at the call site**

Find where `PublishScheduleDialog` is rendered in `src/pages/Scheduling.tsx`. Add a `useMemo` that computes total open spots for the week:

```typescript
import { computeOpenSpots } from '@/lib/openShiftHelpers';

const openShiftCount = useMemo(() => {
  if (!templates.length) return 0;
  let total = 0;
  for (const template of templates) {
    for (const day of weekDays) {
      if (!templateAppliesToDay(template, day)) continue;
      const assigned = templateGridData.get(template.id)?.get(day)?.length ?? 0;
      total += computeOpenSpots(template.capacity, assigned);
    }
  }
  return total;
}, [templates, weekDays, templateGridData]);
```

Pass it to the dialog:

```tsx
<PublishScheduleDialog
  // ...existing props
  openShiftCount={openShiftCount}
/>
```

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/PublishScheduleDialog.tsx src/pages/Scheduling.tsx
git commit -m "feat: show open shift count in publish schedule dialog"
```

---

### Task 6: E2E test — manager sets capacity and sees indicators

**Files:**
- Create: `tests/e2e/shift-template-capacity.spec.ts`

- [ ] **Step 1: Write the E2E test**

Create `tests/e2e/shift-template-capacity.spec.ts`:

```typescript
import { test, expect } from '@playwright/test';
import {
  generateTestUser,
  signUpAndOnboard,
  cleanupTestUser,
} from '../helpers/e2e-supabase';

test.describe('Shift template capacity', () => {
  let testUser: ReturnType<typeof generateTestUser>;

  test.beforeEach(async ({ page }) => {
    testUser = generateTestUser();
    await signUpAndOnboard(page, testUser);
  });

  test.afterEach(async () => {
    await cleanupTestUser(testUser.email);
  });

  test('manager can set staff needed on a template and see capacity indicator', async ({ page }) => {
    // Navigate to scheduling
    await page.goto('/scheduling');
    await page.waitForLoadState('networkidle');

    // Click "Add Shift Template"
    await page.getByRole('button', { name: /add shift template/i }).click();

    // Fill out the template form
    const dialog = page.getByRole('dialog', { name: /add shift template/i });
    await dialog.getByLabel(/template name/i).fill('Closing Server');
    await dialog.getByLabel(/start time/i).fill('16:00');
    await dialog.getByLabel(/end time/i).fill('22:00');
    await dialog.getByLabel(/position/i).fill('Server');

    // Select Monday
    await dialog.getByRole('button', { name: 'Monday' }).click();

    // Set staff needed to 3
    await dialog.getByLabel(/staff needed/i).clear();
    await dialog.getByLabel(/staff needed/i).fill('3');

    // Submit
    await dialog.getByRole('button', { name: /add template/i }).click();

    // Verify template was created (row header should show)
    await expect(page.getByText('Closing Server')).toBeVisible();

    // Verify capacity indicator shows 0/3 on Monday (no one assigned yet)
    await expect(page.getByText('0/3')).toBeVisible();
  });

  test('capacity defaults to 1 and no indicator shown', async ({ page }) => {
    // Navigate to scheduling
    await page.goto('/scheduling');
    await page.waitForLoadState('networkidle');

    // Click "Add Shift Template"
    await page.getByRole('button', { name: /add shift template/i }).click();

    // Fill out the template form without changing capacity
    const dialog = page.getByRole('dialog', { name: /add shift template/i });
    await dialog.getByLabel(/template name/i).fill('Morning Cashier');
    await dialog.getByLabel(/start time/i).fill('06:00');
    await dialog.getByLabel(/end time/i).fill('14:00');
    await dialog.getByLabel(/position/i).fill('Cashier');
    await dialog.getByRole('button', { name: 'Tuesday' }).click();

    // Verify staff needed defaults to 1
    await expect(dialog.getByLabel(/staff needed/i)).toHaveValue('1');

    // Submit
    await dialog.getByRole('button', { name: /add template/i }).click();

    // Verify template was created
    await expect(page.getByText('Morning Cashier')).toBeVisible();

    // No capacity indicator should show (capacity=1 is hidden)
    await expect(page.getByText(/0\/1/)).not.toBeVisible();
  });
});
```

- [ ] **Step 2: Run the E2E test**

Run: `npx playwright test tests/e2e/shift-template-capacity.spec.ts`
Expected: PASS (all previous tasks must be implemented first).

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/shift-template-capacity.spec.ts
git commit -m "test: E2E for shift template capacity and indicators"
```

---

### Task 7: Update `TemplateRowHeader` to show capacity

**Files:**
- Modify: `src/components/scheduling/ShiftPlanner/TemplateRowHeader.tsx`

- [ ] **Step 1: Add capacity display to the desktop header**

In `src/components/scheduling/ShiftPlanner/TemplateRowHeader.tsx`, the desktop layout (lines 37-48) shows name, time range, and position. Add a "Need N" label after the position line (after line 47, inside the `hidden md:block` div):

```tsx
{/* Desktop: full name + time + position */}
<div className="hidden md:block min-w-0">
  <div className="text-[14px] font-medium text-foreground truncate">
    {template.name}
  </div>
  <div className="text-[12px] text-muted-foreground">
    {formatCompactTemplateTime(template.start_time)}-
    {formatCompactTemplateTime(template.end_time)}
  </div>
  <div className="text-[12px] text-muted-foreground">
    {template.position}
  </div>
  {template.capacity > 1 && (
    <div className="text-[10px] font-medium text-amber-600">
      Need {template.capacity}
    </div>
  )}
</div>
```

- [ ] **Step 2: Update the memo comparison to include capacity**

The current memo comparison (lines 83-88) only checks `template.id` and `template.updated_at`. Since `capacity` is part of the template object and `updated_at` changes when capacity is modified, this already works correctly. No change needed.

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: No errors (capacity is already on the ShiftTemplate type).

- [ ] **Step 4: Commit**

```bash
git add src/components/scheduling/ShiftPlanner/TemplateRowHeader.tsx
git commit -m "feat: show capacity in template row header"
```
