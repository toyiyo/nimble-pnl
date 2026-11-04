# Draft-Shift Trade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an employee and a manager offer a draft shift (`is_published = false`) for trade, with a tentative mark everywhere the trade shows.

**Architecture:** Relax two UI gates and one RPC guard. Derive the tentative state live from `offered_shift.is_published`. Store nothing new. A shared badge component marks the tentative state in five UI surfaces. A shared pure helper marks it in the notification.

**Tech Stack:** React 18 + TypeScript + Vite, shadcn/ui, Supabase (Postgres + Deno edge functions), Vitest, pgTAP.

**Spec:** `docs/superpowers/specs/2026-08-14-draft-shift-trade-design.md`. Read it first.

## Global Constraints

- Write all prose (comments, commit messages) in ASD-STE100. See `docs/STE100_STYLE.md`.
- UI badge text, exact: `Tentative — draft` (em dash, U+2014).
- Notification line, exact: `Tentative: this shift is on a draft schedule and can still change.`
- Draft check in UI and helper, exact: `is_published === false`. A React Query cache from before this deploy lacks the field. `!is_published` would mark those rows tentative. `=== false` does not.
- Semantic tokens only. The badge uses `bg-warning/15 text-foreground border-warning/30`, the same tokens as `DraftBadge` (`src/components/employee/ShiftRow.tsx:93`).
- Never edit `supabase/migrations/20260812120000_create_shift_trade_for_employee.sql`. Add a new migration.
- Commit with explicit paths only. Never `git add -A`. Run git with `git -C /Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/draft-shift-trade`.
- All commands run from the worktree root: `/Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/draft-shift-trade`.

---

### Task 1: Migration — delete the `is_published` guard from `create_shift_trade_for_employee`

**Files:**
- Create: `supabase/migrations/20260814120000_allow_draft_shift_trade.sql`
- Modify: `supabase/tests/55_create_shift_trade_for_employee.sql:22-23,29,74-75,297-311`
- Test: `supabase/tests/55_create_shift_trade_for_employee.sql`

**Interfaces:**
- Consumes: the current function in `supabase/migrations/20260812120000_create_shift_trade_for_employee.sql`.
- Produces: the same function signature `create_shift_trade_for_employee(UUID, UUID, UUID, UUID, TEXT) RETURNS UUID`, minus the publish guard. Later tasks do not call it directly.

- [ ] **Step 1: Flip pgTAP Scenario 14 to a success test**

In `supabase/tests/55_create_shift_trade_for_employee.sql`:

Change line 29 from `SELECT plan(16);` to `SELECT plan(17);`.

Replace the Scenario 14 block (lines 297-311) with:

```sql
-- ============================================================================
-- Scenario 14 (assertions 16-17): Owner O posts shift7, a 'scheduled' draft
-- shift (is_published = false) owned by the active empA -> succeeds. The
-- draft-trade design (docs/superpowers/specs/2026-08-14-draft-shift-trade-design.md)
-- lifts the PR #744 publication guard on purpose. The UI marks the trade
-- as tentative instead.
-- ============================================================================
RESET ROLE;
SET LOCAL role = 'authenticated';
SELECT set_config('request.jwt.claims', '{"sub":"55000000-0000-0000-0000-000000000011","role":"authenticated"}', true);

SELECT lives_ok(
  $$ SELECT create_shift_trade_for_employee('55000000-0000-0000-0000-000000000001', '55000000-0000-0000-0000-000000000047', '55000000-0000-0000-0000-000000000021') $$,
  'Scenario 14: an unpublished draft shift can be posted for trade'
);

RESET ROLE;
SET LOCAL role TO postgres;
SELECT is(
  (SELECT count(*)::int FROM shift_trades WHERE offered_shift_id = '55000000-0000-0000-0000-000000000047' AND status = 'open'),
  1,
  'Scenario 14: one open trade exists for the draft shift7'
);
```

Also change the fixture comments. At lines 22-23 the header says shift7 tests
"the publication guard". At lines 74-75 the fixture comment says the same.
Change both so they say shift7 tests the draft-trade success path.

- [ ] **Step 2: Run the pgTAP file and check it fails**

Run:
```bash
npm run db:reset && npm run test:db
```
Expected: `55_create_shift_trade_for_employee.sql` FAILS. Scenario 14 raises `Only a published shift can be traded`.

Warning from the PR #744 retrospective: run the whole file, not one scenario. Confirm scenarios 1-13 still pass in this run. Their fixtures set `is_published = true` and must stay green.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260814120000_allow_draft_shift_trade.sql`. The body is the current function from `supabase/migrations/20260812120000_create_shift_trade_for_employee.sql` with two changes: the header comment, and the deleted publish guard (old lines 70-77).

```sql
-- Draft-shift trade.
--
-- Delete the is_published guard from create_shift_trade_for_employee. PR #744
-- added the guard so a trade could not point at a shift that can still change
-- or disappear. The draft-trade design lifts it as a product decision:
-- docs/superpowers/specs/2026-08-14-draft-shift-trade-design.md. The UI and
-- the notification now mark a draft trade as tentative, and the
-- ON DELETE CASCADE on offered_shift_id deletes the trade with the shift.
-- Every other guard stays.
CREATE OR REPLACE FUNCTION create_shift_trade_for_employee(
  p_restaurant_id UUID,
  p_offered_shift_id UUID,
  p_offered_by_employee_id UUID,
  p_target_employee_id UUID DEFAULT NULL,
  p_reason TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_role TEXT;
  v_shift shifts;
  v_new_trade_id UUID;
BEGIN
  -- Authorization: the caller must be an owner or a manager of this restaurant.
  -- This mirrors the approve_shift_trade audience on purpose: the same person
  -- who approves the trade may post it. It is NOT the edit:scheduling
  -- capability, which also admits operations_manager and would create a
  -- dead-end approval queue.
  SELECT role INTO v_user_role
  FROM user_restaurants
  WHERE user_id = auth.uid()
    AND restaurant_id = p_restaurant_id
  LIMIT 1;

  -- v_user_role is NULL when the caller has no membership for this restaurant.
  -- `NULL NOT IN (...)` evaluates to NULL, not TRUE, so a plain NOT IN check
  -- would fail OPEN and let any authenticated user post a trade. Reject NULL
  -- first.
  IF v_user_role IS NULL OR v_user_role NOT IN ('owner', 'manager') THEN
    RAISE EXCEPTION 'Only an owner or a manager can post a trade for an employee';
  END IF;

  -- Load the offered shift.
  SELECT * INTO v_shift
  FROM shifts
  WHERE id = p_offered_shift_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Shift not found';
  END IF;

  -- The shift must belong to this restaurant.
  IF v_shift.restaurant_id != p_restaurant_id THEN
    RAISE EXCEPTION 'Shift does not belong to this restaurant';
  END IF;

  -- The shift must belong to the employee named as the offerer.
  IF v_shift.employee_id IS DISTINCT FROM p_offered_by_employee_id THEN
    RAISE EXCEPTION 'Shift does not belong to this employee';
  END IF;

  -- Only a live shift can be traded (allow-list, not deny-list).
  IF v_shift.status NOT IN ('scheduled', 'confirmed') THEN
    RAISE EXCEPTION 'Only a scheduled or confirmed shift can be traded';
  END IF;

  -- No is_published guard here. A draft shift can be traded; the UI and the
  -- notification mark it as tentative. See the header comment.

  -- The offered employee must be active in this restaurant. Without this guard
  -- a manager can post a trade for a terminated employee: deactivate_employee
  -- auto-cancels only 'scheduled' shifts, so a 'confirmed' shift of an inactive
  -- employee stays tradeable.
  IF NOT EXISTS (
    SELECT 1 FROM employees
    WHERE id = p_offered_by_employee_id
      AND restaurant_id = p_restaurant_id
      AND is_active = true
  ) THEN
    RAISE EXCEPTION 'Offered employee is not active';
  END IF;

  -- Directed trade: the target must be a different, active employee of this
  -- restaurant.
  IF p_target_employee_id IS NOT NULL THEN
    IF p_target_employee_id = p_offered_by_employee_id THEN
      RAISE EXCEPTION 'Cannot direct a trade to the same employee';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM employees
      WHERE id = p_target_employee_id
        AND restaurant_id = p_restaurant_id
        AND is_active = true
    ) THEN
      RAISE EXCEPTION 'Target employee not found or inactive';
    END IF;
  END IF;

  -- Insert the trade. The partial unique index
  -- idx_unique_active_trade_per_shift blocks a second active trade on the same
  -- shift; translate that into a clear message instead of a raw 23505.
  BEGIN
    INSERT INTO shift_trades (
      restaurant_id,
      offered_shift_id,
      offered_by_employee_id,
      target_employee_id,
      reason,
      status
    ) VALUES (
      p_restaurant_id,
      p_offered_shift_id,
      p_offered_by_employee_id,
      p_target_employee_id,
      p_reason,
      'open'
    )
    RETURNING id INTO v_new_trade_id;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'This shift already has an active trade';
  END;

  RETURN v_new_trade_id;
END;
$$;

GRANT EXECUTE ON FUNCTION create_shift_trade_for_employee(UUID, UUID, UUID, UUID, TEXT) TO authenticated;
```

- [ ] **Step 4: Run the pgTAP file and check it passes**

Run:
```bash
npm run db:reset && npm run test:db
```
Expected: all pgTAP files PASS. `55_create_shift_trade_for_employee.sql` reports 17/17.

- [ ] **Step 5: Commit**

```bash
git -C /Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/draft-shift-trade add supabase/migrations/20260814120000_allow_draft_shift_trade.sql supabase/tests/55_create_shift_trade_for_employee.sql
git -C /Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/draft-shift-trade commit -m "feat(shift-trades): let the manager RPC post a draft shift

Delete the is_published guard from create_shift_trade_for_employee.
The draft-trade design lifts the PR #744 guard as a product decision.
Flip pgTAP Scenario 14 to a success test; plan(16) becomes plan(17).

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Data plumbing — select and type `is_published` on the offered shift

**Files:**
- Modify: `src/hooks/useShiftTrades.ts:21-27` (type), `:139-145`, `:243-249`, `:632-638` (embeds)
- Modify: `src/components/schedule/TradeMarketplace.tsx:32-38` (type)
- Test: `npm run typecheck` plus the existing suites `tests/unit/useShiftTrades.test.ts`, `tests/unit/useShiftTrades.deleteTrade.test.ts`, `tests/unit/MyShiftTradesCard.test.tsx`, `tests/unit/AvailableShiftsPage.tradeCard.test.tsx`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `ShiftTrade['offered_shift']` and `TradeWithConflict['offered_shift']` each gain `is_published: boolean`. Every query embed returns the field. Tasks 4-9 read `offered_shift.is_published`.

- [ ] **Step 1: Add the field to the two types**

In `src/hooks/useShiftTrades.ts:21-27`:

```typescript
  offered_shift?: {
    id: string;
    start_time: string;
    end_time: string;
    position: string;
    break_duration: number;
    is_published: boolean;
  };
```

In `src/components/schedule/TradeMarketplace.tsx:32-38`, the same addition to `TradeWithConflict.offered_shift`.

- [ ] **Step 2: Add the field to the three embeds**

In `src/hooks/useShiftTrades.ts`, each of the three `offered_shift:shifts!offered_shift_id(...)` blocks (lines 139-145, 243-249, 632-638) gains one line:

```
          offered_shift:shifts!offered_shift_id(
            id,
            start_time,
            end_time,
            position,
            break_duration,
            is_published
          ),
```

- [ ] **Step 3: Run typecheck and fix every fixture the compiler flags**

Run:
```bash
npm run typecheck
```
Expected: errors in test fixtures that build an `offered_shift` object without `is_published`. Add `is_published: true` to each flagged fixture. Use `true`, not `false`: these fixtures model the published path that existed before this change.

Run again. Expected: PASS with no errors.

- [ ] **Step 4: Run the touched unit suites**

Run:
```bash
npx vitest run tests/unit/useShiftTrades.test.ts tests/unit/useShiftTrades.deleteTrade.test.ts tests/unit/MyShiftTradesCard.test.tsx tests/unit/AvailableShiftsPage.tradeCard.test.tsx
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C /Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/draft-shift-trade add src/hooks/useShiftTrades.ts src/components/schedule/TradeMarketplace.tsx tests/unit
git -C /Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/draft-shift-trade diff --cached --name-only
```
Check the staged list contains only the two source files and test fixture files this task touched. Then:
```bash
git -C /Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/draft-shift-trade commit -m "feat(shift-trades): select is_published on the offered shift

Add the column to the three offered_shift embeds and the two types.
The tentative badge and the notification read this field.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: The `TentativeDraftBadge` component

**Files:**
- Create: `src/components/schedule/TentativeDraftBadge.tsx`
- Test: `tests/unit/TentativeDraftBadge.test.tsx`

**Interfaces:**
- Consumes: `Badge` from `@/components/ui/badge`, `cn` from `@/lib/utils`, `PencilLine` from `lucide-react`.
- Produces: `export function TentativeDraftBadge({ className }: { className?: string }): JSX.Element`. Tasks 6-9 import it.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/TentativeDraftBadge.test.tsx`:

```tsx
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { TentativeDraftBadge } from '@/components/schedule/TentativeDraftBadge';

describe('TentativeDraftBadge', () => {
  it('shows the exact tentative text', () => {
    render(<TentativeDraftBadge />);

    // The text is the accessible signal. The icon and the amber tokens are
    // supplementary, so a screen reader and a greyscale phone get the
    // same message.
    expect(screen.getByText('Tentative — draft')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test and check it fails**

Run: `npx vitest run tests/unit/TentativeDraftBadge.test.tsx`
Expected: FAIL. The module does not exist.

- [ ] **Step 3: Write the component**

Create `src/components/schedule/TentativeDraftBadge.tsx`:

```tsx
import { Badge } from '@/components/ui/badge';
import { PencilLine } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Warning badge for a trade whose offered shift is not published yet.
 * The audience is the coworker who considers the trade, not the shift
 * owner, so the copy differs from ShiftRow's DraftBadge on purpose.
 * Same warning tokens as DraftBadge: one amber language for "not final".
 * The icon is supplementary; the text carries the meaning.
 *
 * Render it only on `offered_shift.is_published === false`. A cached row
 * from before the field existed is undefined, and undefined must not
 * read as tentative.
 */
export function TentativeDraftBadge({ className }: { className?: string }): JSX.Element {
  return (
    <Badge
      className={cn(
        'flex items-center gap-1 bg-warning/15 text-foreground border-warning/30 hover:bg-warning/15',
        className,
      )}
    >
      <PencilLine className="h-3 w-3" />
      Tentative — draft
    </Badge>
  );
}
```

- [ ] **Step 4: Run the test and check it passes**

Run: `npx vitest run tests/unit/TentativeDraftBadge.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C /Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/draft-shift-trade add src/components/schedule/TentativeDraftBadge.tsx tests/unit/TentativeDraftBadge.test.tsx
git -C /Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/draft-shift-trade commit -m "feat(shift-trades): add the TentativeDraftBadge component

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: ShiftRow — show the Trade button on a draft shift

**Files:**
- Modify: `src/components/employee/ShiftRow.tsx:125-133`
- Test: `tests/unit/ShiftRow.test.tsx`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `canTrade` without the publish term. No later task depends on it.

- [ ] **Step 1: Flip the draft test and add the together-test**

In `tests/unit/ShiftRow.test.tsx`, replace the test at lines 43-51 with:

```tsx
  it('offers a Trade button on a draft shift and marks the row as a draft', async () => {
    const onTrade = vi.fn();
    render(<ShiftRow shift={makeShift({ is_published: false })} onTrade={onTrade} />);

    // The draft-trade design allows a trade before publication. The row
    // must still read as a draft next to the button.
    expect(screen.getByText('Draft — not confirmed')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /trade/i }));
    expect(onTrade).toHaveBeenCalledTimes(1);
  });
```

- [ ] **Step 2: Run the file and check the flipped test fails**

Run: `npx vitest run tests/unit/ShiftRow.test.tsx`
Expected: the new test FAILS (no Trade button). The other four tests PASS.

- [ ] **Step 3: Change the gate and the comment**

In `src/components/employee/ShiftRow.tsx`, replace lines 125-133 with:

```tsx
  // Every draft signal below is load-bearing and redundant on purpose: the
  // dashed surface, the badge copy and the muted type each say "not final"
  // on their own, because the banner above may go unread on a fast mobile
  // glance. The Trade button is NOT a draft signal anymore: the draft-trade
  // design (docs/superpowers/specs/2026-08-14-draft-shift-trade-design.md)
  // lets an employee offer a draft shift, marked tentative on the trade side.
  const surface = getSurfaceClass(isCancelled, isDraft, variant);
  const timeText = isDraft ? 'font-normal text-muted-foreground' : 'font-medium';

  const canTrade = !!onTrade && !isCancelled && isFuture(parseISO(shift.start_time));
```

- [ ] **Step 4: Run the file and check all tests pass**

Run: `npx vitest run tests/unit/ShiftRow.test.tsx`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git -C /Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/draft-shift-trade add src/components/employee/ShiftRow.tsx tests/unit/ShiftRow.test.tsx
git -C /Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/draft-shift-trade commit -m "feat(shift-trades): show the Trade button on a draft shift row

Delete the is_published term from canTrade. Rewrite the draft-signal
comment: three signals remain, the missing button is not one of them.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: SchedulingShiftCard — show the offer action on a draft shift

**Files:**
- Modify: `src/pages/SchedulingShiftCard.tsx:220`
- Test: `tests/unit/SchedulingShiftCard.offerTrade.test.tsx`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: the offer button without the publish term. No later task depends on it.

- [ ] **Step 1: Flip the draft test**

In `tests/unit/SchedulingShiftCard.offerTrade.test.tsx`, replace the test at lines 70-80 with:

```tsx
  it('shows the offer action for an unpublished draft shift', () => {
    const onOfferTrade = vi.fn();
    render(
      <ShiftCard
        shift={mockShift({ is_published: false })}
        onEdit={() => {}}
        onDelete={() => {}}
        onOfferTrade={onOfferTrade}
      />,
    );
    fireEvent.click(screen.getByLabelText('Offer shift for trade'));
    expect(onOfferTrade).toHaveBeenCalledTimes(1);
  });
```

- [ ] **Step 2: Run the file and check the flipped test fails**

Run: `npx vitest run tests/unit/SchedulingShiftCard.offerTrade.test.tsx`
Expected: the flipped test FAILS. The other three PASS.

- [ ] **Step 3: Change the gate**

In `src/pages/SchedulingShiftCard.tsx:220`, change:

```tsx
          {onOfferTrade && shift.is_published && (shift.status === 'scheduled' || shift.status === 'confirmed') && (
```
to:
```tsx
          {onOfferTrade && (shift.status === 'scheduled' || shift.status === 'confirmed') && (
```

- [ ] **Step 4: Run the file and check all tests pass**

Run: `npx vitest run tests/unit/SchedulingShiftCard.offerTrade.test.tsx`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git -C /Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/draft-shift-trade add src/pages/SchedulingShiftCard.tsx tests/unit/SchedulingShiftCard.offerTrade.test.tsx
git -C /Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/draft-shift-trade commit -m "feat(shift-trades): show the offer action on a draft shift card

Delete the is_published term from the offer-button condition.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Badge in TradeMarketplace — card and accept-confirm dialog

**Files:**
- Modify: `src/components/schedule/TradeMarketplace.tsx` (the `ShiftTradeCard` component at lines 266+, and the confirm dialog at lines 188-232)
- Test: `tests/unit/TradeMarketplace.tentative.test.tsx` (create)

**Interfaces:**
- Consumes: `TentativeDraftBadge` from Task 3, `offered_shift.is_published` from Task 2.
- Produces: nothing later tasks use.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/TradeMarketplace.tentative.test.tsx`. Model the render setup on `tests/unit/MyShiftTradesCard.test.tsx` (mock the hooks the component calls; check its top imports and mock each hook module with `vi.mock`). The two assertions:

```tsx
    // Draft offered shift -> the card shows the badge.
    expect(screen.getByText('Tentative — draft')).toBeInTheDocument();
```
and, with `is_published: true` in the fixture:
```tsx
    expect(screen.queryByText('Tentative — draft')).not.toBeInTheDocument();
```

Build the trade fixtures with `offered_shift: { id, start_time, end_time, position, break_duration, is_published }` and future timestamps.

- [ ] **Step 2: Run the test and check it fails**

Run: `npx vitest run tests/unit/TradeMarketplace.tentative.test.tsx`
Expected: FAIL. No badge text in the DOM.

- [ ] **Step 3: Add the badge to the card and the dialog**

In `src/components/schedule/TradeMarketplace.tsx`:

Import: `import { TentativeDraftBadge } from '@/components/schedule/TentativeDraftBadge';`

In the `ShiftTradeCard` component (lines 266+), find the element that shows `trade.offered_shift.position` and add next to it:

```tsx
              {trade.offered_shift.is_published === false && <TentativeDraftBadge />}
```

In the confirm dialog, inside the "Shift Details" box (after the `<h4>` at lines 200-202), add:

```tsx
                {selectedTrade.offered_shift.is_published === false && (
                  <TentativeDraftBadge className="mb-2" />
                )}
```

- [ ] **Step 4: Run the test and check it passes**

Run: `npx vitest run tests/unit/TradeMarketplace.tentative.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C /Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/draft-shift-trade add src/components/schedule/TradeMarketplace.tsx tests/unit/TradeMarketplace.tentative.test.tsx
git -C /Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/draft-shift-trade commit -m "feat(shift-trades): mark a draft trade as tentative in the marketplace

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Badge in MyShiftTradesCard — card and withdraw-confirm dialog

**Files:**
- Modify: `src/components/schedule/MyShiftTradesCard.tsx` (card body near line 77, withdraw dialog at lines 267-278)
- Test: `tests/unit/MyShiftTradesCard.test.tsx` (extend)

**Interfaces:**
- Consumes: `TentativeDraftBadge` from Task 3, `offered_shift.is_published` from Task 2.
- Produces: nothing later tasks use.

- [ ] **Step 1: Add the failing test**

Extend `tests/unit/MyShiftTradesCard.test.tsx` with one test on the existing fixture pattern of that file:

```tsx
  it('marks a draft offered shift as tentative', () => {
    // Build a trade whose offered_shift has is_published: false, render,
    // and check the badge text.
    // Use the same render helper and fixture builder this file already has.
    expect(screen.getByText('Tentative — draft')).toBeInTheDocument();
  });
```

Add the symmetric check to one existing published-path test:
```tsx
    expect(screen.queryByText('Tentative — draft')).not.toBeInTheDocument();
```

- [ ] **Step 2: Run the file and check the new test fails**

Run: `npx vitest run tests/unit/MyShiftTradesCard.test.tsx`
Expected: the new test FAILS. The existing tests PASS.

- [ ] **Step 3: Add the badge**

In `src/components/schedule/MyShiftTradesCard.tsx`:

Import `TentativeDraftBadge`. In the card body (the component that sets `const shift = trade.offered_shift;` at line 77), add next to the element that shows `shift.position`:

```tsx
          {shift.is_published === false && <TentativeDraftBadge />}
```

In the withdraw dialog block at lines 267-278, inside the `confirmTarget?.offered_shift && (...)` section, add:

```tsx
              {confirmTarget.offered_shift.is_published === false && (
                <TentativeDraftBadge className="mt-1" />
              )}
```

- [ ] **Step 4: Run the file and check all tests pass**

Run: `npx vitest run tests/unit/MyShiftTradesCard.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C /Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/draft-shift-trade add src/components/schedule/MyShiftTradesCard.tsx tests/unit/MyShiftTradesCard.test.tsx
git -C /Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/draft-shift-trade commit -m "feat(shift-trades): mark a draft trade as tentative in my-trades

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Badge in TradeApprovalQueue — cards, cleanup dialog, approve dialog

**Files:**
- Modify: `src/components/schedule/TradeApprovalQueue.tsx` (card renderers near lines 946, 1165, 1207; cleanup dialog at lines 618-621; approve/reject dialog at lines 837-851)
- Test: `tests/unit/TradeApprovalQueue.tentative.test.tsx` (create)

**Interfaces:**
- Consumes: `TentativeDraftBadge` from Task 3, `offered_shift.is_published` from Task 2.
- Produces: nothing later tasks use.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/TradeApprovalQueue.tentative.test.tsx`. Model the mocks on `tests/unit/TradeApprovalQueue.claimBanner.test.tsx` (same hook mocks, same render helper). Assert the badge on a pending trade whose `offered_shift.is_published` is `false`, and its absence when `true`:

```tsx
    expect(screen.getByText('Tentative — draft')).toBeInTheDocument();
```
```tsx
    expect(screen.queryByText('Tentative — draft')).not.toBeInTheDocument();
```

- [ ] **Step 2: Run the test and check it fails**

Run: `npx vitest run tests/unit/TradeApprovalQueue.tentative.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Add the badge at five spots**

In `src/components/schedule/TradeApprovalQueue.tsx`, import `TentativeDraftBadge`, then:

1. Card title at line 946 (`<CardTitle ...>{trade.offered_shift.position}</CardTitle>`): add after the title element:
```tsx
            {trade.offered_shift.is_published === false && <TentativeDraftBadge />}
```
2. Card position at line 1165: same pattern with the same guard.
3. Row position at line 1207: same pattern with the same guard.
4. Cleanup dialog at lines 618-621, inside `confirmTarget.trade.offered_shift && (...)`:
```tsx
                      {confirmTarget.trade.offered_shift.is_published === false && (
                        <TentativeDraftBadge className="mt-1" />
                      )}
```
5. Approve/reject dialog at lines 837-851, next to the position span at line 850:
```tsx
                      {selectedTrade.offered_shift?.is_published === false && (
                        <TentativeDraftBadge className="mt-1" />
                      )}
```

- [ ] **Step 4: Run the new test plus the existing queue tests**

Run:
```bash
npx vitest run tests/unit/TradeApprovalQueue.tentative.test.tsx tests/unit/TradeApprovalQueue.claimBanner.test.tsx tests/unit/TradeApprovalQueue.cleanup.test.tsx
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C /Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/draft-shift-trade add src/components/schedule/TradeApprovalQueue.tsx tests/unit/TradeApprovalQueue.tentative.test.tsx
git -C /Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/draft-shift-trade commit -m "feat(shift-trades): mark a draft trade as tentative in the approval queue

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: Badge in AvailableShiftsPage TradeCard

**Files:**
- Modify: `src/pages/AvailableShiftsPage.tsx` (the `TradeCard` component at lines 68-186; position renders at line 109)
- Test: `tests/unit/AvailableShiftsPage.tradeCard.test.tsx` (extend)

**Interfaces:**
- Consumes: `TentativeDraftBadge` from Task 3, `offered_shift.is_published` from Task 2.
- Produces: nothing later tasks use.

- [ ] **Step 1: Set `is_published` on every fixture, then add the failing test**

Warning: in a TypeScript fixture an omitted field is `undefined`, not `false`. Set `is_published: true` on every existing `offered_shift` fixture in `tests/unit/AvailableShiftsPage.tradeCard.test.tsx` (Task 2 already did this for the compiler; check none is missing). Then add:

```tsx
  it('marks a draft offered shift as tentative', () => {
    // Same fixture builder as the other tests, with is_published: false.
    expect(screen.getByText('Tentative — draft')).toBeInTheDocument();
  });
```

And the symmetric absence check in one published-path test:
```tsx
    expect(screen.queryByText('Tentative — draft')).not.toBeInTheDocument();
```

- [ ] **Step 2: Run the file and check the new test fails**

Run: `npx vitest run tests/unit/AvailableShiftsPage.tradeCard.test.tsx`
Expected: the new test FAILS. The existing tests PASS.

- [ ] **Step 3: Add the badge**

In `src/pages/AvailableShiftsPage.tsx`, import `TentativeDraftBadge`. In `TradeCard`, next to the element at line 109 that shows `trade.offered_shift.position`, add:

```tsx
            {trade.offered_shift.is_published === false && <TentativeDraftBadge />}
```

- [ ] **Step 4: Run the file and check all tests pass**

Run: `npx vitest run tests/unit/AvailableShiftsPage.tradeCard.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C /Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/draft-shift-trade add src/pages/AvailableShiftsPage.tsx tests/unit/AvailableShiftsPage.tradeCard.test.tsx
git -C /Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/draft-shift-trade commit -m "feat(shift-trades): mark a draft trade as tentative on available shifts

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 10: Notification — the tentative line in email and push

**Files:**
- Create: `supabase/functions/_shared/draftTradeNote.ts`
- Modify: `supabase/functions/send-shift-trade-notification/index.ts` (embed at lines 334-338, `shiftDetails` at lines 396-402, `generateEmailHtml` at lines 151-212, broadcast push body at line 582)
- Test: `tests/unit/draftTradeNote.test.ts` (create)

**Interfaces:**
- Consumes: `offered_shift.is_published` (the embed change in this task).
- Produces: `TENTATIVE_NOTE: string`, `tentativeEmailBlock(isPublished: boolean | null | undefined): string`, `tentativePushBody(base: string, isPublished: boolean | null | undefined): string`. Nothing later depends on them.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/draftTradeNote.test.ts` on the pattern of `tests/unit/tradeEmailAudience.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  TENTATIVE_NOTE,
  tentativeEmailBlock,
  tentativePushBody,
} from '../../supabase/functions/_shared/draftTradeNote';

describe('draftTradeNote', () => {
  it('emits the note block only for is_published === false', () => {
    expect(tentativeEmailBlock(false)).toContain(TENTATIVE_NOTE);
    expect(tentativeEmailBlock(true)).toBe('');
  });

  it('CRITICAL: undefined and null do not read as tentative', () => {
    // A row from before the embed change lacks the field. Fail safe:
    // no tentative note rather than a wrong one on a published shift.
    expect(tentativeEmailBlock(undefined)).toBe('');
    expect(tentativeEmailBlock(null)).toBe('');
    expect(tentativePushBody('base', undefined)).toBe('base');
  });

  it('appends the note to a push body only for false', () => {
    expect(tentativePushBody('A teammate offered a shift for trade.', false)).toBe(
      `A teammate offered a shift for trade. ${TENTATIVE_NOTE}`,
    );
    expect(tentativePushBody('A teammate offered a shift for trade.', true)).toBe(
      'A teammate offered a shift for trade.',
    );
  });
});
```

- [ ] **Step 2: Run the test and check it fails**

Run: `npx vitest run tests/unit/draftTradeNote.test.ts`
Expected: FAIL. The module does not exist.

- [ ] **Step 3: Write the helper**

Create `supabase/functions/_shared/draftTradeNote.ts`:

```typescript
// Tentative note for a trade whose offered shift is not published yet.
// The check is `=== false` on purpose: a trade row read before the
// is_published embed existed has the field undefined, and undefined must
// not read as tentative.

export const TENTATIVE_NOTE =
  'Tentative: this shift is on a draft schedule and can still change.';

export function tentativeEmailBlock(isPublished: boolean | null | undefined): string {
  if (isPublished !== false) return '';
  return `
      <div style="background-color: #fffbeb; border-left: 4px solid #f59e0b; padding: 12px 16px; border-radius: 8px; margin: 0 0 24px 0;">
        <p style="color: #92400e; font-size: 14px; margin: 0;">${TENTATIVE_NOTE}</p>
      </div>`;
}

export function tentativePushBody(base: string, isPublished: boolean | null | undefined): string {
  return isPublished === false ? `${base} ${TENTATIVE_NOTE}` : base;
}
```

(Inline hex colors are the norm in this email template file — email clients do not read CSS tokens. Match the existing template style.)

- [ ] **Step 4: Run the test and check it passes**

Run: `npx vitest run tests/unit/draftTradeNote.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire the helper into the edge function**

In `supabase/functions/send-shift-trade-notification/index.ts`:

1. Import at the top, next to the other `_shared` imports:
```typescript
import { tentativeEmailBlock, tentativePushBody } from '../_shared/draftTradeNote.ts';
```
2. Add `is_published` to the embed (lines 334-338):
```
        offered_shift:shifts!offered_shift_id(
          start_time,
          end_time,
          position,
          is_published
        ),
```
3. Extend `shiftDetails` (lines 396-402) with the field:
```typescript
    const shiftDetails = shift
      ? {
          startTime: formatDateTime(shift.start_time, restaurantTimezone),
          endTime: formatDateTime(shift.end_time, restaurantTimezone),
          position: shift.position,
          isPublished: shift.is_published as boolean | undefined
        }
      : null;
```
4. Change the `generateEmailHtml` parameter type (line 154) to
   `{ startTime: string; endTime: string; position: string; isPublished?: boolean | null } | null`
   and insert the block right after the shift-details card closes (after the
   `` ` : ''} `` at line 212):
```typescript
      ${shiftDetails ? tentativeEmailBlock(shiftDetails.isPublished) : ''}
```
   The email block renders for every action on a draft shift, not only
   'created'. The builder is shared, so this is one insertion point.
5. Change the broadcast push body at line 582:
```typescript
            body: tentativePushBody('A teammate offered a shift for trade. Tap to view.', trade.offered_shift?.is_published),
```
   The per-user push loop (lines 601-629) does not run for action 'created',
   so it does not change.

- [ ] **Step 6: Typecheck and run the notification suites**

Run:
```bash
npm run typecheck && npx vitest run tests/unit/draftTradeNote.test.ts tests/unit/tradeEmailAudience.test.ts tests/unit/notificationServiceRoleReaders.test.ts
```
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git -C /Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/draft-shift-trade add supabase/functions/_shared/draftTradeNote.ts supabase/functions/send-shift-trade-notification/index.ts tests/unit/draftTradeNote.test.ts
git -C /Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/draft-shift-trade commit -m "feat(shift-trades): add the tentative note to draft-trade notifications

The email block renders for every action on a draft shift. The push
note applies to the created broadcast. The check is === false so a
row without the field never reads as tentative.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 11: Full check

**Files:**
- No new files. This task runs the full gate.

**Interfaces:**
- Consumes: all earlier tasks.
- Produces: a green branch for the review phases.

- [ ] **Step 1: Run the full unit suite, typecheck, and lint**

Run:
```bash
npm run typecheck && npm run lint && npm run test
```
Expected: PASS with zero errors.

- [ ] **Step 2: Run the pgTAP suite**

Run:
```bash
npm run db:reset && npm run test:db
```
Expected: PASS, `55_create_shift_trade_for_employee.sql` at 17/17.

- [ ] **Step 3: Check the e2e spec still compiles against the change**

Read `tests/e2e/manager-initiated-shift-trade.spec.ts`. It publishes the week before it offers a trade, so the relaxed gates do not change its path. Do not run the e2e suite here; CI runs it.

- [ ] **Step 4: Commit any straggler fixture fix with explicit paths**

If steps 1-2 forced an edit, stage that exact file and commit with a
`test:` prefix. If nothing changed, skip this step.
