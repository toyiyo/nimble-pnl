# Allow Deleting Published Shifts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hard block on deleting published shifts with a warning confirmation dialog.

**Architecture:** Remove lock checks from delete paths (hooks, SQL RPC), keep them for edit paths. Add a `p_include_locked` parameter to the `delete_shift_series` SQL function. Update UI dialogs to show published-shift warnings instead of blocking.

**Tech Stack:** React, TypeScript, Supabase PostgreSQL (pgTAP for SQL tests), Vitest

**Design doc:** `docs/plans/2026-04-08-allow-delete-published-shifts-design.md`

---

### Task 1: Add `p_include_locked` parameter to `delete_shift_series` SQL function

**Files:**
- Create: `supabase/migrations/20260408000000_allow_delete_locked_shifts.sql`
- Test: `supabase/tests/allow_delete_locked_shifts.test.sql`

- [ ] **Step 1: Write the pgTAP test**

```sql
-- supabase/tests/allow_delete_locked_shifts.test.sql
BEGIN;
SELECT plan(4);

-- Setup: create a restaurant and some shifts
INSERT INTO restaurants (id, name) VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 'Test Restaurant');

-- Create a parent shift (locked/published)
INSERT INTO shifts (id, restaurant_id, employee_id, start_time, end_time, locked, is_published, recurrence_parent_id)
VALUES (
  'bbbbbbbb-0000-0000-0000-000000000001',
  'aaaaaaaa-0000-0000-0000-000000000001',
  NULL, '2026-04-10 09:00:00+00', '2026-04-10 17:00:00+00',
  true, true, NULL
);

-- Create a child shift (also locked)
INSERT INTO shifts (id, restaurant_id, employee_id, start_time, end_time, locked, is_published, recurrence_parent_id)
VALUES (
  'bbbbbbbb-0000-0000-0000-000000000002',
  'aaaaaaaa-0000-0000-0000-000000000001',
  NULL, '2026-04-17 09:00:00+00', '2026-04-17 17:00:00+00',
  true, true, 'bbbbbbbb-0000-0000-0000-000000000001'
);

-- Create an unlocked child shift
INSERT INTO shifts (id, restaurant_id, employee_id, start_time, end_time, locked, is_published, recurrence_parent_id)
VALUES (
  'bbbbbbbb-0000-0000-0000-000000000003',
  'aaaaaaaa-0000-0000-0000-000000000001',
  NULL, '2026-04-24 09:00:00+00', '2026-04-24 17:00:00+00',
  false, false, 'bbbbbbbb-0000-0000-0000-000000000001'
);

-- Test 1: Default behavior (p_include_locked = false) skips locked shifts
SELECT results_eq(
  $$SELECT deleted_count, locked_count FROM delete_shift_series(
    'bbbbbbbb-0000-0000-0000-000000000001',
    'aaaaaaaa-0000-0000-0000-000000000001',
    'all', NULL, false
  )$$,
  $$VALUES (1, 2)$$,
  'Default: only unlocked shift deleted, 2 locked reported'
);

-- Verify locked shifts still exist
SELECT is(
  (SELECT COUNT(*)::int FROM shifts WHERE restaurant_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  2,
  'Two locked shifts remain after default delete'
);

-- Test 3: p_include_locked = true deletes everything
SELECT results_eq(
  $$SELECT deleted_count, locked_count FROM delete_shift_series(
    'bbbbbbbb-0000-0000-0000-000000000001',
    'aaaaaaaa-0000-0000-0000-000000000001',
    'all', NULL, true
  )$$,
  $$VALUES (2, 0)$$,
  'Force: all remaining shifts deleted, 0 locked reported'
);

-- Verify no shifts remain
SELECT is(
  (SELECT COUNT(*)::int FROM shifts WHERE restaurant_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  0,
  'No shifts remain after force delete'
);

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:db`
Expected: FAIL — function signature doesn't accept 5th parameter

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260408000000_allow_delete_locked_shifts.sql
CREATE OR REPLACE FUNCTION delete_shift_series(
  p_parent_id UUID,
  p_restaurant_id UUID,
  p_scope TEXT,
  p_from_time TIMESTAMPTZ DEFAULT NULL,
  p_include_locked BOOLEAN DEFAULT false
)
RETURNS TABLE(deleted_count INT, locked_count INT)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_deleted_count INT := 0;
  v_locked_count INT := 0;
BEGIN
  IF p_scope = 'following' THEN
    -- Count locked shifts
    SELECT COUNT(*) INTO v_locked_count
    FROM shifts
    WHERE (id = p_parent_id OR recurrence_parent_id = p_parent_id)
      AND restaurant_id = p_restaurant_id
      AND start_time >= p_from_time
      AND locked = true;

    -- Delete shifts (include locked if forced)
    WITH deleted AS (
      DELETE FROM shifts
      WHERE (id = p_parent_id OR recurrence_parent_id = p_parent_id)
        AND restaurant_id = p_restaurant_id
        AND start_time >= p_from_time
        AND (locked = false OR p_include_locked = true)
      RETURNING id
    )
    SELECT COUNT(*) INTO v_deleted_count FROM deleted;

  ELSE -- 'all'
    SELECT COUNT(*) INTO v_locked_count
    FROM shifts
    WHERE (id = p_parent_id OR recurrence_parent_id = p_parent_id)
      AND restaurant_id = p_restaurant_id
      AND locked = true;

    WITH deleted AS (
      DELETE FROM shifts
      WHERE (id = p_parent_id OR recurrence_parent_id = p_parent_id)
        AND restaurant_id = p_restaurant_id
        AND (locked = false OR p_include_locked = true)
      RETURNING id
    )
    SELECT COUNT(*) INTO v_deleted_count FROM deleted;
  END IF;

  -- When force-deleting, report 0 locked (they were all deleted)
  IF p_include_locked THEN
    v_locked_count := 0;
  END IF;

  RETURN QUERY SELECT v_deleted_count, v_locked_count;
END;
$$;

GRANT EXECUTE ON FUNCTION delete_shift_series TO authenticated;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:db`
Expected: PASS — all 4 assertions pass

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260408000000_allow_delete_locked_shifts.sql supabase/tests/allow_delete_locked_shifts.test.sql
git commit -m "feat: add p_include_locked param to delete_shift_series RPC"
```

---

### Task 2: Remove lock guard from `useDeleteShift` hook

**Files:**
- Modify: `src/hooks/useShifts.tsx:236-264` (useDeleteShift)
- Test: `tests/unit/useDeleteShift.test.ts` (new)

- [ ] **Step 1: Write the unit test**

```typescript
// tests/unit/useDeleteShift.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock supabase before importing the hook
const mockDelete = vi.fn().mockReturnThis();
const mockEq = vi.fn().mockReturnThis();
const mockSelect = vi.fn().mockResolvedValue({ data: [{ id: 'shift-1', locked: true }], error: null });

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(() => ({
      delete: () => ({ eq: mockEq }),
      select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: { locked: true }, error: null }) }) }),
    })),
  },
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { useDeleteShift } from '@/hooks/useShifts';

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

describe('useDeleteShift', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEq.mockResolvedValue({ error: null });
  });

  it('should delete a shift without checking locked status', async () => {
    const { result } = renderHook(() => useDeleteShift(), { wrapper: createWrapper() });

    act(() => {
      result.current.mutate({ id: 'shift-1', restaurantId: 'rest-1' });
    });

    await waitFor(() => expect(result.current.isSuccess || result.current.isError).toBe(true));
    // The key assertion: no select query to check locked status should happen
    // The mutation should proceed directly to delete
    expect(result.current.isSuccess).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/useDeleteShift.test.ts`
Expected: FAIL — `assertShiftNotLocked` throws for locked shift

- [ ] **Step 3: Remove the lock guard from useDeleteShift**

In `src/hooks/useShifts.tsx`, modify `useDeleteShift` (line 241-244):

```typescript
// BEFORE (line 241-244):
    mutationFn: async ({ id, restaurantId }: { id: string; restaurantId: string }) => {
      await assertShiftNotLocked(id);

      const { error } = await supabase.from('shifts').delete().eq('id', id);

// AFTER:
    mutationFn: async ({ id, restaurantId }: { id: string; restaurantId: string }) => {
      const { error } = await supabase.from('shifts').delete().eq('id', id);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/useDeleteShift.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useShifts.tsx tests/unit/useDeleteShift.test.ts
git commit -m "feat: remove lock guard from useDeleteShift hook"
```

---

### Task 3: Remove lock guard from `useDeleteShiftSeries` and pass `includePublished`

**Files:**
- Modify: `src/hooks/useShifts.tsx:285-360` (useDeleteShiftSeries)

- [ ] **Step 1: Update SeriesOperationParams to accept includePublished**

In `src/hooks/useShifts.tsx`, modify the `SeriesOperationParams` interface (line 266-270):

```typescript
// BEFORE:
interface SeriesOperationParams {
  shift: Shift;
  scope: RecurringActionScope;
  restaurantId: string;
}

// AFTER:
interface SeriesOperationParams {
  shift: Shift;
  scope: RecurringActionScope;
  restaurantId: string;
  includePublished?: boolean;
}
```

- [ ] **Step 2: Remove lock check from 'this' scope and pass param to RPC**

In `useDeleteShiftSeries` mutationFn (lines 291-312):

```typescript
// BEFORE (lines 291-303):
      if (scope === 'this') {
        if (shift.locked) {
          throw new Error('Cannot delete a locked shift. The schedule has been published.');
        }

        const { error } = await supabase
          .from('shifts')
          .delete()
          .eq('id', shift.id)
          .eq('restaurant_id', restaurantId);

        if (error) throw error;
        return { deletedCount: 1, lockedCount: 0, restaurantId };
      }

// AFTER:
      if (scope === 'this') {
        const { error } = await supabase
          .from('shifts')
          .delete()
          .eq('id', shift.id)
          .eq('restaurant_id', restaurantId);

        if (error) throw error;
        return { deletedCount: 1, lockedCount: 0, restaurantId };
      }
```

Pass `p_include_locked` to the RPC call (lines 307-312):

```typescript
// BEFORE:
      const { data, error } = await supabase.rpc('delete_shift_series', {
        p_parent_id: parentId,
        p_restaurant_id: restaurantId,
        p_scope: scope,
        p_from_time: scope === 'following' ? shift.start_time : null,
      });

// AFTER:
      const { data, error } = await supabase.rpc('delete_shift_series', {
        p_parent_id: parentId,
        p_restaurant_id: restaurantId,
        p_scope: scope,
        p_from_time: scope === 'following' ? shift.start_time : null,
        p_include_locked: includePublished ?? false,
      });
```

- [ ] **Step 3: Update optimistic update to not skip locked shifts when includePublished**

In the `onMutate` callback (lines 330-348), update the filter:

```typescript
// BEFORE (line 334):
          if (s.locked) return true;

// AFTER:
          if (s.locked && !includePublished) return true;
```

Note: `includePublished` needs to be destructured from the mutation variables. Update the `onMutate` signature:

```typescript
// BEFORE (line 323):
    onMutate: async ({ shift, scope, restaurantId }) => {

// AFTER:
    onMutate: async ({ shift, scope, restaurantId, includePublished }) => {
```

- [ ] **Step 4: Run existing tests**

Run: `npm run test`
Expected: PASS — no existing tests should break

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useShifts.tsx
git commit -m "feat: remove lock guard from useDeleteShiftSeries, pass includePublished to RPC"
```

---

### Task 4: Update single-shift delete dialog to warn about published shifts

**Files:**
- Modify: `src/pages/Scheduling.tsx:1777-1803` (Delete Confirmation Dialog)
- Modify: `src/pages/Scheduling.tsx:615-626` (handleDeleteShift)

- [ ] **Step 1: Update the delete confirmation dialog to show published warning**

In `src/pages/Scheduling.tsx`, update the Delete Confirmation Dialog (lines 1777-1803):

```tsx
// BEFORE (lines 1787-1789):
            <AlertDialogDescription className="text-sm leading-relaxed">
              Are you sure you want to delete this shift? This action cannot be undone and the
              employee will need to be rescheduled.
            </AlertDialogDescription>

// AFTER:
            <AlertDialogDescription className="text-sm leading-relaxed space-y-2">
              <span>Are you sure you want to delete this shift? This action cannot be undone and the
              employee will need to be rescheduled.</span>
              {shiftToDelete?.is_published && (
                <span className="flex items-center gap-2 text-warning font-medium">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  This shift has been published and employees may have already seen it.
                </span>
              )}
            </AlertDialogDescription>
```

Make sure `AlertTriangle` is imported (it's already imported in the file from lucide-react — verify at the top of the file).

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/pages/Scheduling.tsx
git commit -m "feat: show published warning in single-shift delete dialog"
```

---

### Task 5: Update `RecurringShiftActionDialog` warning message

**Files:**
- Modify: `src/components/scheduling/RecurringShiftActionDialog.tsx:122-129`

- [ ] **Step 1: Change the locked-shift warning from blocking to informational**

In `RecurringShiftActionDialog.tsx`, update the locked-count warning (lines 122-129):

```tsx
// BEFORE:
          {lockedCount > 0 && (
            <Alert variant="default" className="mb-4 border-warning/50 bg-warning/10">
              <AlertTriangle className="h-4 w-4 text-warning" />
              <AlertDescription className="text-sm">
                {lockedCount} shift{lockedCount > 1 ? 's are' : ' is'} part of a published schedule
                and will not be {isDelete ? 'deleted' : 'modified'}.
              </AlertDescription>
            </Alert>
          )}

// AFTER:
          {lockedCount > 0 && isDelete && (
            <Alert variant="default" className="mb-4 border-warning/50 bg-warning/10">
              <AlertTriangle className="h-4 w-4 text-warning" />
              <AlertDescription className="text-sm">
                {lockedCount} shift{lockedCount > 1 ? 's have' : ' has'} been published and
                employees may have already seen {lockedCount > 1 ? 'them' : 'it'}.
                {lockedCount > 1 ? ' They' : ' It'} will also be deleted.
              </AlertDescription>
            </Alert>
          )}
          {lockedCount > 0 && !isDelete && (
            <Alert variant="default" className="mb-4 border-warning/50 bg-warning/10">
              <AlertTriangle className="h-4 w-4 text-warning" />
              <AlertDescription className="text-sm">
                {lockedCount} shift{lockedCount > 1 ? 's are' : ' is'} part of a published schedule
                and will not be modified.
              </AlertDescription>
            </Alert>
          )}
```

- [ ] **Step 2: Pass `includePublished` from Scheduling.tsx when confirming recurring delete**

In `src/pages/Scheduling.tsx`, update `handleRecurringActionConfirm` (lines 633-641):

```typescript
// BEFORE (lines 633-641):
    if (actionType === 'delete') {
      deleteShiftSeries.mutate(
        { shift, scope, restaurantId },
        {
          onSuccess: () => {
            setRecurringActionDialog({ open: false, shift: null, actionType: 'edit' });
          },
        }
      );

// AFTER:
    if (actionType === 'delete') {
      deleteShiftSeries.mutate(
        { shift, scope, restaurantId, includePublished: true },
        {
          onSuccess: () => {
            setRecurringActionDialog({ open: false, shift: null, actionType: 'edit' });
          },
        }
      );
```

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/components/scheduling/RecurringShiftActionDialog.tsx src/pages/Scheduling.tsx
git commit -m "feat: update recurring shift dialog to warn instead of block on published delete"
```

---

### Task 6: Update bulk delete to include locked shifts

**Files:**
- Modify: `src/hooks/useBulkShiftActions.ts:46-78` (bulkDelete)
- Modify: `src/pages/Scheduling.tsx:1857-1876` (bulk delete dialog)

- [ ] **Step 1: Simplify `bulkDelete` to delete all shifts regardless of lock status**

In `src/hooks/useBulkShiftActions.ts`, replace the `bulkDelete` function (lines 46-78):

```typescript
// BEFORE (lines 46-78):
  const bulkDelete = useCallback(
    async (shiftIds: string[]): Promise<BulkDeleteResult> => {
      const { unlockedIds, lockedCount } = await partitionByLocked(shiftIds, restaurantId);

      if (unlockedIds.length === 0) {
        toast({
          title: 'No shifts deleted',
          description: buildShiftChangeDescription(0, lockedCount, 'deleted'),
        });
        return { deletedCount: 0, lockedCount };
      }

      const { error } = await supabase
        .from('shifts')
        .delete()
        .in('id', unlockedIds)
        .eq('locked', false);

      if (error) throw error;

      const deletedCount = unlockedIds.length;

      queryClient.invalidateQueries({ queryKey: ['shifts', restaurantId] });

      toast({
        title: 'Shifts deleted',
        description: buildShiftChangeDescription(deletedCount, lockedCount, 'deleted'),
      });

      return { deletedCount, lockedCount };
    },
    [restaurantId, queryClient, toast],
  );

// AFTER:
  const bulkDelete = useCallback(
    async (shiftIds: string[]): Promise<BulkDeleteResult> => {
      const { error } = await supabase
        .from('shifts')
        .delete()
        .in('id', shiftIds)
        .eq('restaurant_id', restaurantId);

      if (error) throw error;

      queryClient.invalidateQueries({ queryKey: ['shifts', restaurantId] });

      toast({
        title: 'Shifts deleted',
        description: `${shiftIds.length} shift${shiftIds.length !== 1 ? 's' : ''} deleted.`,
      });

      return { deletedCount: shiftIds.length, lockedCount: 0 };
    },
    [restaurantId, queryClient, toast],
  );
```

- [ ] **Step 2: Update the bulk delete dialog to show published warning**

In `src/pages/Scheduling.tsx`, update the bulk delete dialog (lines 1857-1876):

```tsx
// BEFORE (lines 1862-1866):
            <AlertDialogDescription className="space-y-2">
              <p>This action cannot be undone.</p>
              {hasLockedInSelection && (
                <p className="text-muted-foreground font-medium">Locked shifts (published) will be skipped.</p>
              )}
            </AlertDialogDescription>

// AFTER:
            <AlertDialogDescription className="space-y-2">
              <p>This action cannot be undone.</p>
              {hasLockedInSelection && (
                <p className="flex items-center gap-2 text-warning font-medium">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  Some selected shifts have been published and employees may have already seen them.
                </p>
              )}
            </AlertDialogDescription>
```

- [ ] **Step 3: Clean up unused imports if `partitionByLocked` is no longer used**

Check if `partitionByLocked` is still used by `bulkEdit`. It is (line 82), so keep it. No cleanup needed.

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useBulkShiftActions.ts src/pages/Scheduling.tsx
git commit -m "feat: bulk delete now includes published shifts with warning"
```

---

### Task 7: Regenerate Supabase TypeScript types

**Files:**
- Modify: `src/integrations/supabase/types.ts` (auto-generated)

- [ ] **Step 1: Regenerate types**

Run: `npx supabase gen types typescript --local > src/integrations/supabase/types.ts`

- [ ] **Step 2: Verify the new `p_include_locked` parameter appears in the types**

Check that `delete_shift_series` in the generated types includes `p_include_locked`.

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/integrations/supabase/types.ts
git commit -m "chore: regenerate Supabase types for delete_shift_series"
```
