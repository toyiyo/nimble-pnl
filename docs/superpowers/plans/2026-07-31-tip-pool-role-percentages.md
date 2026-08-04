# Tip Pool Role Percentages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a manager assign a role a guaranteed (`at least X%`) or fixed (`exactly X%`) share of the tip pool, and show every participant's live percentage while hours are being entered.

**Architecture:** A JSONB `role_percentages` column on `tip_pool_settings` holds `{ [role]: { mode, percentage } }`. A new pure function `calculateTipSplitWithGuarantees` in `src/utils/tipPooling.ts` wraps whichever base splitter is active: it reserves `exactly` amounts off the top, water-fills the remainder through the base splitter, locks anyone who lands below their `at_least` floor, and repeats until stable. Rules are **per person** — two managers at 10% commit 20% of the pool. All UI reads from the function's output, so entry, review, and persistence agree by construction.

**Tech Stack:** React 18.3, TypeScript, Vite, TailwindCSS, shadcn/ui (`ToggleGroup`), Supabase Postgres + RLS, React Query, Vitest, Playwright, pgTAP.

**Spec:** `docs/superpowers/specs/2026-07-31-tip-pool-role-percentages-design.md`

**Worktree:** `/Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/tip-pool-percentage` — branch `feature/tip-pool-percentage`. Every command below assumes this is the working directory.

## Global Constraints

- **Full Pool only.** Guarantees never apply when `poolingModel === 'percentage_contribution'`. Every call site must gate on `poolingModel === 'full_pool'`.
- **`at_least` never caps.** A floor only ever raises someone. If the only worker is a manager on `at_least 10%`, they get 100% of the pool.
- **Rules are per person, never summed into a pool fraction in copy.** Never write "25% of the pool is guaranteed". Write "10% + 15% per person on these roles".
- **`sum(shares) === totalTipsCents` exactly.** `TipReviewScreen` disables Approve unless `remaining === 0` (`src/components/tips/TipReviewScreen.tsx:167`); a one-cent drift makes a split unapprovable.
- **Participant order is preserved.** The new splitter returns shares in the input order, unlike `rebalanceAllocations` which appends the changed employee last (`src/utils/tipPooling.ts:146-152`).
- **Money is integer cents.** No floats in stored or compared amounts.
- **No direct colors.** Semantic tokens only (`text-muted-foreground`, `bg-muted/30`, `border-border/40`). Amber advisories use `bg-amber-500/10 border-amber-500/20 text-amber-600` matching `src/components/tips/TipReviewScreen.tsx:400-405`.
- **Typography scale** per CLAUDE.md: `text-[13px]` secondary, `text-[14px]` body, `text-[12px] uppercase tracking-wider` labels, `text-[11px] px-1.5 py-0.5 rounded-md bg-muted` badges.
- **Accessibility:** every icon-only or ambiguous control carries an `aria-label`; every input has an associated `<Label htmlFor>`; no icon is the sole carrier of meaning.
- **Tests:** run with `npm run test -- <path>`. Typecheck with `npm run typecheck`. Lint with `npm run lint`.

---

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/20260731000000_tip_role_percentages.sql` | New — `tip_pool_settings.role_percentages` + CHECK, `tip_split_items.applied_rule` |
| `supabase/tests/tip_role_percentages.test.sql` | New — column + constraint assertions |
| `src/integrations/supabase/types.ts` | Add both columns to the generated types |
| `src/utils/tipPooling.ts` | Add rule types, extend `TipShare`, add `calculateTipSplitWithGuarantees` |
| `src/hooks/useTipPoolSettings.tsx` | Carry `role_percentages` on both interfaces |
| `src/hooks/useAutoSaveTipSettings.ts` | Detect `rolePercentages` changes |
| `src/hooks/useDebouncedValue.ts` | New — generic 200ms display debounce |
| `src/components/tips/RoleAllocationSection.tsx` | New — controlled per-role mode + percentage editor |
| `src/components/tips/TipPoolSettingsDialog.tsx` | Render `RoleAllocationSection` for Full Pool |
| `src/pages/Tips.tsx` | Wire rules into the split; live percentage readout in the hours grid |
| `src/components/tips/TipReviewScreen.tsx` | % of pool column, badges, narrow-viewport handling, advisories |
| `src/hooks/useTipSplits.tsx` | Persist `applied_rule` per split item |
| `tests/unit/tipPooling-guarantees.test.ts` | New — algorithm coverage |
| `tests/unit/useDebouncedValue.test.ts` | New |
| `tests/unit/RoleAllocationSection.test.tsx` | New |
| `tests/unit/useAutoSaveTipSettings.test.tsx` | Extend |
| `tests/e2e/tip-sharing.spec.ts` | Extend |

---

### Task 1: Database columns and generated types

**Files:**
- Create: `supabase/migrations/20260731000000_tip_role_percentages.sql`
- Create: `supabase/tests/tip_role_percentages.test.sql`
- Modify: `src/integrations/supabase/types.ts:8427-8470` (tip_pool_settings), `src/integrations/supabase/types.ts:8574-8605` (tip_split_items)

**Interfaces:**
- Consumes: nothing.
- Produces: column `tip_pool_settings.role_percentages JSONB NOT NULL DEFAULT '{}'` shaped `Record<string, { mode: 'at_least' | 'exactly'; percentage: number }>`; column `tip_split_items.applied_rule JSONB NULL`. Constraint name `tip_pool_settings_role_percentages_check`.

- [ ] **Step 1: Write the failing pgTAP test**

Create `supabase/tests/tip_role_percentages.test.sql`:

```sql
-- ============================================================================
-- Tests for role-percentage tip guarantees schema
--
-- Verifies the schema objects created by the migration:
--   20260731000000_tip_role_percentages.sql
--
-- Tests:
--   1. role_percentages column exists on tip_pool_settings
--   2. role_percentages defaults to an empty object
--   3. applied_rule column exists on tip_split_items
--   4. applied_rule is nullable
--   5. role_percentages rejects a non-object value
--   6. role_percentages rejects an unknown mode
--   7. role_percentages rejects a percentage above 100
--   8. role_percentages rejects a negative percentage
--   9. role_percentages rejects an entry missing a required key
--  10. role_percentages accepts a well-formed rule map
-- ============================================================================

BEGIN;
SELECT plan(10);

SET LOCAL role TO postgres;

INSERT INTO restaurants (id, name) VALUES
  ('c0000000-0000-0000-0000-000000000001', 'Role Percentage Test Restaurant')
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- Test 1: role_percentages column exists
-- ============================================================================

SELECT has_column(
  'public',
  'tip_pool_settings',
  'role_percentages',
  'tip_pool_settings should have a role_percentages column'
);

-- ============================================================================
-- Test 2: role_percentages defaults to an empty object
-- ============================================================================

INSERT INTO tip_pool_settings (id, restaurant_id, active) VALUES
  ('c0000000-0000-0000-0000-000000000010', 'c0000000-0000-0000-0000-000000000001', false);

SELECT is(
  (SELECT role_percentages FROM tip_pool_settings WHERE id = 'c0000000-0000-0000-0000-000000000010'),
  '{}'::jsonb,
  'role_percentages should default to an empty object'
);

-- ============================================================================
-- Test 3: applied_rule column exists on tip_split_items
-- ============================================================================

SELECT has_column(
  'public',
  'tip_split_items',
  'applied_rule',
  'tip_split_items should have an applied_rule column'
);

-- ============================================================================
-- Test 4: applied_rule is nullable
-- ============================================================================

SELECT col_is_null(
  'public',
  'tip_split_items',
  'applied_rule',
  'applied_rule should be nullable so existing rows stay valid'
);

-- ============================================================================
-- Test 5: role_percentages rejects a non-object value
-- ============================================================================

SELECT throws_ok(
  $$
    INSERT INTO tip_pool_settings (restaurant_id, role_percentages, active)
    VALUES ('c0000000-0000-0000-0000-000000000001', '[]'::jsonb, false)
  $$,
  '23514',
  NULL,
  'role_percentages should reject a JSON array'
);

-- ============================================================================
-- Test 6: role_percentages rejects an unknown mode
-- ============================================================================

SELECT throws_ok(
  $$
    INSERT INTO tip_pool_settings (restaurant_id, role_percentages, active)
    VALUES ('c0000000-0000-0000-0000-000000000001', '{"Manager": {"mode": "bogus", "percentage": 10}}'::jsonb, false)
  $$,
  '23514',
  NULL,
  'role_percentages should reject a mode outside at_least/exactly'
);

-- ============================================================================
-- Test 7: role_percentages rejects a percentage above 100
-- ============================================================================

SELECT throws_ok(
  $$
    INSERT INTO tip_pool_settings (restaurant_id, role_percentages, active)
    VALUES ('c0000000-0000-0000-0000-000000000001', '{"Manager": {"mode": "at_least", "percentage": 101}}'::jsonb, false)
  $$,
  '23514',
  NULL,
  'role_percentages should reject a percentage above 100'
);

-- ============================================================================
-- Test 8: role_percentages rejects a negative percentage
-- ============================================================================

SELECT throws_ok(
  $$
    INSERT INTO tip_pool_settings (restaurant_id, role_percentages, active)
    VALUES ('c0000000-0000-0000-0000-000000000001', '{"Manager": {"mode": "at_least", "percentage": -5}}'::jsonb, false)
  $$,
  '23514',
  NULL,
  'role_percentages should reject a negative percentage'
);

-- ============================================================================
-- Test 9: role_percentages rejects an entry missing a required key
-- ============================================================================

SELECT throws_ok(
  $$
    INSERT INTO tip_pool_settings (restaurant_id, role_percentages, active)
    VALUES ('c0000000-0000-0000-0000-000000000001', '{"Manager": {"percentage": 10}}'::jsonb, false)
  $$,
  '23514',
  NULL,
  'role_percentages should reject an entry with no mode'
);

-- ============================================================================
-- Test 10: role_percentages accepts a well-formed rule map
-- ============================================================================

SELECT lives_ok(
  $$
    INSERT INTO tip_pool_settings (restaurant_id, role_percentages, active)
    VALUES (
      'c0000000-0000-0000-0000-000000000001',
      '{"Manager": {"mode": "at_least", "percentage": 10}, "Chef": {"mode": "exactly", "percentage": 15.5}}'::jsonb,
      false
    )
  $$,
  'role_percentages should accept a well-formed rule map'
);

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npm run db:start && npm run test:db 2>&1 | grep -A3 tip_role_percentages
```

Expected: FAIL — `column "role_percentages" does not exist` / `has_column` failures.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260731000000_tip_role_percentages.sql`:

```sql
-- Migration: Role-based guaranteed and fixed tip pool percentages
-- Lets a restaurant pin a role to a minimum ("at least 10% of the pool") or a
-- fixed ("exactly 15%") share, evaluated per person on the day they worked.
--
-- New objects:
--   ALTER tip_pool_settings – add role_percentages column + shape CHECK
--   ALTER tip_split_items   – add applied_rule column (audit provenance)

-- =============================================================================
-- 1. Add role_percentages to tip_pool_settings
-- =============================================================================
ALTER TABLE tip_pool_settings
  ADD COLUMN IF NOT EXISTS role_percentages JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Shape constraint. RLS gates rows, not column shape: without this, any client
-- with write access could store a negative percentage or an unknown mode and
-- the allocation algorithm's non-negativity assumption would rest entirely on
-- an HTML min/max attribute. Use a DO block so re-running is safe.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tip_pool_settings_role_percentages_check'
  ) THEN
    ALTER TABLE tip_pool_settings
      ADD CONSTRAINT tip_pool_settings_role_percentages_check
      CHECK (
        jsonb_typeof(role_percentages) = 'object'
        AND NOT jsonb_path_exists(
          role_percentages,
          '$.* ? (@.mode != "at_least" && @.mode != "exactly")'
        )
        AND NOT jsonb_path_exists(
          role_percentages,
          '$.* ? (@.percentage < 0 || @.percentage > 100)'
        )
        AND NOT jsonb_path_exists(
          role_percentages,
          '$.* ? (!exists(@.mode) || !exists(@.percentage))'
        )
      );
  END IF;
END $$;

COMMENT ON COLUMN tip_pool_settings.role_percentages IS
  'Per-role allocation rules: {"<role>": {"mode": "at_least" | "exactly", "percentage": 0-100}}. Evaluated per person, so two people in a 10% role commit 20% of the pool. Full Pool model only.';

-- =============================================================================
-- 2. Add applied_rule to tip_split_items
-- =============================================================================
-- Audit provenance only. NULL means no rule applied, which is every existing
-- row and every plain hours-derived allocation. The split-level audit trigger
-- logs status transitions on tip_splits, not per-employee reasoning, so
-- without this there is no record of why an employee received what they did.
ALTER TABLE tip_split_items
  ADD COLUMN IF NOT EXISTS applied_rule JSONB;

COMMENT ON COLUMN tip_split_items.applied_rule IS
  'Allocation rule in force for this employee when the split was created: {"mode": "at_least" | "exactly", "percentage": number}, or NULL. Audit record — not read back for display.';
```

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
npm run db:reset && npm run test:db 2>&1 | grep -A3 tip_role_percentages
```

Expected: all 10 assertions pass, `ok 1` through `ok 10`.

- [ ] **Step 5: Add both columns to the generated types**

In `src/integrations/supabase/types.ts`, inside the `tip_pool_settings` block, add `role_percentages` to all three shapes (alphabetically it sits immediately before `role_weights`):

```ts
      tip_pool_settings: {
        Row: {
          // …
          restaurant_id: string
          role_percentages: Json
          role_weights: Json | null
          // …
        }
        Insert: {
          // …
          restaurant_id: string
          role_percentages?: Json
          role_weights?: Json | null
          // …
        }
        Update: {
          // …
          restaurant_id?: string
          role_percentages?: Json
          role_weights?: Json | null
          // …
        }
```

In the `tip_split_items` block, add `applied_rule` to all three shapes (alphabetically first, before `amount`):

```ts
      tip_split_items: {
        Row: {
          applied_rule: Json | null
          amount: number
          // …
        }
        Insert: {
          applied_rule?: Json | null
          amount?: number
          // …
        }
        Update: {
          applied_rule?: Json | null
          amount?: number
          // …
        }
```

- [ ] **Step 6: Verify the types compile**

Run:

```bash
npm run typecheck
```

Expected: exit 0, no errors.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260731000000_tip_role_percentages.sql supabase/tests/tip_role_percentages.test.sql src/integrations/supabase/types.ts
git commit -m "feat(tips): add role_percentages and applied_rule columns"
```

---

### Task 2: The allocation algorithm

**Files:**
- Modify: `src/utils/tipPooling.ts:3-9` (extend `TipShare`), append the new function after `calculateTipSplitByRole` (`src/utils/tipPooling.ts:99-119`)
- Test: `tests/unit/tipPooling-guarantees.test.ts`

**Interfaces:**
- Consumes: private `distributeByRatio` (`src/utils/tipPooling.ts:15-33`), which is in the same module.
- Produces:
  ```ts
  export type RoleAllocationMode = 'at_least' | 'exactly';
  export type RoleAllocationRule = { mode: RoleAllocationMode; percentage: number };
  export type GuaranteedParticipant = { id: string; name: string; hours?: number; role?: string; rule?: RoleAllocationRule };
  export type GuaranteedSplitResult = { shares: TipShare[]; scaledDownFactor: number | null; redistributedLeftoverCents: number };
  export function calculateTipSplitWithGuarantees(
    totalTipsCents: number,
    participants: GuaranteedParticipant[],
    distributeRemainder: (poolCents: number, subset: GuaranteedParticipant[]) => TipShare[],
  ): GuaranteedSplitResult;
  ```
  `TipShare` gains `appliedRule?: RoleAllocationRule` and `lifted?: boolean`.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/tipPooling-guarantees.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  calculateTipSplitWithGuarantees,
  calculateTipSplitByHours,
  calculateTipSplitEven,
  rebalanceAllocations,
  type GuaranteedParticipant,
  type RoleAllocationRule,
  type TipShare,
} from '@/utils/tipPooling';

const byHours = (poolCents: number, subset: GuaranteedParticipant[]): TipShare[] =>
  calculateTipSplitByHours(
    poolCents,
    subset.map(p => ({ id: p.id, name: p.name, hours: p.hours ?? 0 })),
  );

const evenly = (poolCents: number, subset: GuaranteedParticipant[]): TipShare[] =>
  calculateTipSplitEven(poolCents, subset.map(p => ({ id: p.id, name: p.name })));

const atLeast = (percentage: number): RoleAllocationRule => ({ mode: 'at_least', percentage });
const exactly = (percentage: number): RoleAllocationRule => ({ mode: 'exactly', percentage });

const person = (
  id: string,
  hours: number,
  rule?: RoleAllocationRule,
): GuaranteedParticipant => ({ id, name: `Person ${id}`, hours, role: 'Server', rule });

const amountOf = (result: { shares: TipShare[] }, id: string) =>
  result.shares.find(s => s.employeeId === id)?.amountCents;

const sumOf = (result: { shares: TipShare[] }) =>
  result.shares.reduce((sum, s) => sum + s.amountCents, 0);

describe('calculateTipSplitWithGuarantees', () => {
  describe('pass-through behaviour', () => {
    it('matches the plain hours split when no rules are configured', () => {
      const participants = [person('a', 6), person('b', 4)];
      const result = calculateTipSplitWithGuarantees(10000, participants, byHours);

      expect(result.shares.map(s => s.amountCents)).toEqual([6000, 4000]);
      expect(result.scaledDownFactor).toBeNull();
      expect(result.redistributedLeftoverCents).toBe(0);
    });

    it('treats a 0% rule as no rule', () => {
      const participants = [person('a', 6, atLeast(0)), person('b', 4)];
      const result = calculateTipSplitWithGuarantees(10000, participants, byHours);

      expect(result.shares.map(s => s.amountCents)).toEqual([6000, 4000]);
    });

    it('returns an empty array for no participants', () => {
      const result = calculateTipSplitWithGuarantees(10000, [], byHours);
      expect(result.shares).toEqual([]);
    });

    it('allocates zero to everyone when the pool is zero', () => {
      const participants = [person('a', 6, atLeast(10)), person('b', 4)];
      const result = calculateTipSplitWithGuarantees(0, participants, byHours);

      expect(result.shares.map(s => s.amountCents)).toEqual([0, 0]);
    });

    it('allocates zero to everyone when the pool is negative', () => {
      const participants = [person('a', 6, atLeast(10))];
      const result = calculateTipSplitWithGuarantees(-500, participants, byHours);

      expect(result.shares.map(s => s.amountCents)).toEqual([0]);
    });

    it('preserves participant order', () => {
      const participants = [person('a', 1), person('b', 9, atLeast(50)), person('c', 2)];
      const result = calculateTipSplitWithGuarantees(10000, participants, byHours);

      expect(result.shares.map(s => s.employeeId)).toEqual(['a', 'b', 'c']);
    });
  });

  describe('at_least floors', () => {
    it('lifts a participant whose hours share falls below the floor', () => {
      // 2h of 12h = 16.6% without the rule; the 30% floor lifts them.
      const participants = [person('mgr', 2, atLeast(30)), person('a', 5), person('b', 5)];
      const result = calculateTipSplitWithGuarantees(10000, participants, byHours);

      expect(amountOf(result, 'mgr')).toBe(3000);
      expect(amountOf(result, 'a')).toBe(3500);
      expect(amountOf(result, 'b')).toBe(3500);
      expect(sumOf(result)).toBe(10000);
    });

    it('marks a lifted participant', () => {
      const participants = [person('mgr', 2, atLeast(30)), person('a', 10)];
      const result = calculateTipSplitWithGuarantees(10000, participants, byHours);

      expect(result.shares.find(s => s.employeeId === 'mgr')?.lifted).toBe(true);
      expect(result.shares.find(s => s.employeeId === 'a')?.lifted).toBeUndefined();
    });

    it('does not cap someone already above their floor', () => {
      // 10h of 12h = 83.3%, well above the 30% floor.
      const participants = [person('mgr', 10, atLeast(30)), person('a', 2)];
      const result = calculateTipSplitWithGuarantees(10000, participants, byHours);

      expect(amountOf(result, 'mgr')).toBe(8333);
      expect(result.shares.find(s => s.employeeId === 'mgr')?.lifted).toBeUndefined();
    });

    it('gives the whole pool to a lone at_least participant', () => {
      const participants = [person('mgr', 3, atLeast(10))];
      const result = calculateTipSplitWithGuarantees(10000, participants, byHours);

      expect(amountOf(result, 'mgr')).toBe(10000);
    });

    it('applies the floor per person, not per role', () => {
      // Two managers at 10% each commit 20% of the pool.
      const participants = [
        person('mgr1', 1, atLeast(10)),
        person('mgr2', 1, atLeast(10)),
        person('a', 18),
      ];
      const result = calculateTipSplitWithGuarantees(10000, participants, byHours);

      expect(amountOf(result, 'mgr1')).toBe(1000);
      expect(amountOf(result, 'mgr2')).toBe(1000);
      expect(amountOf(result, 'a')).toBe(8000);
      expect(sumOf(result)).toBe(10000);
    });

    it('lifts iteratively when locking one floor pushes another below its own', () => {
      // Pool 10000. c has a 40% floor; a has a 30% floor.
      // Pass 1 by hours (1/1/8): a=1000 (<3000), c=8000 (ok) -> lock a at 3000.
      // Pass 2 over b,c with 7000 (1/8): b=778, c=6222 -> stable.
      const participants = [person('a', 1, atLeast(30)), person('b', 1), person('c', 8, atLeast(40))];
      const result = calculateTipSplitWithGuarantees(10000, participants, byHours);

      expect(amountOf(result, 'a')).toBe(3000);
      expect(amountOf(result, 'c')).toBeGreaterThanOrEqual(4000);
      expect(sumOf(result)).toBe(10000);
    });

    it('falls back to an even remainder split when nobody logged hours', () => {
      const participants = [person('mgr', 0, atLeast(50)), person('a', 0), person('b', 0)];
      const result = calculateTipSplitWithGuarantees(9000, participants, byHours);

      expect(amountOf(result, 'mgr')).toBe(4500);
      expect(sumOf(result)).toBe(9000);
    });
  });

  describe('exactly shares', () => {
    it('reserves the fixed share off the top', () => {
      const participants = [person('mgr', 1, exactly(20)), person('a', 5), person('b', 5)];
      const result = calculateTipSplitWithGuarantees(10000, participants, byHours);

      expect(amountOf(result, 'mgr')).toBe(2000);
      expect(amountOf(result, 'a')).toBe(4000);
      expect(amountOf(result, 'b')).toBe(4000);
      expect(sumOf(result)).toBe(10000);
    });

    it('caps an exactly participant even when their hours would earn more', () => {
      const participants = [person('mgr', 20, exactly(20)), person('a', 1)];
      const result = calculateTipSplitWithGuarantees(10000, participants, byHours);

      expect(amountOf(result, 'mgr')).toBe(2000);
      expect(amountOf(result, 'a')).toBe(8000);
    });

    it('mixes exactly and at_least in one split', () => {
      const participants = [
        person('fixed', 10, exactly(20)),
        person('floor', 1, atLeast(30)),
        person('hourly', 9),
      ];
      const result = calculateTipSplitWithGuarantees(10000, participants, byHours);

      expect(amountOf(result, 'fixed')).toBe(2000);
      expect(amountOf(result, 'floor')).toBe(3000);
      expect(amountOf(result, 'hourly')).toBe(5000);
      expect(sumOf(result)).toBe(10000);
    });

    it('redistributes the leftover when only exactly participants worked', () => {
      const participants = [person('a', 5, exactly(30)), person('b', 5, exactly(20))];
      const result = calculateTipSplitWithGuarantees(10000, participants, byHours);

      expect(result.redistributedLeftoverCents).toBe(5000);
      // 5000 leftover split 30:20 -> 3000 / 2000 on top of 3000 / 2000.
      expect(amountOf(result, 'a')).toBe(6000);
      expect(amountOf(result, 'b')).toBe(4000);
      expect(sumOf(result)).toBe(10000);
    });

    it('leaves no leftover when exactly shares total 100%', () => {
      const participants = [person('a', 5, exactly(60)), person('b', 5, exactly(40))];
      const result = calculateTipSplitWithGuarantees(10000, participants, byHours);

      expect(result.redistributedLeftoverCents).toBe(0);
      expect(amountOf(result, 'a')).toBe(6000);
      expect(amountOf(result, 'b')).toBe(4000);
    });
  });

  describe('overshoot', () => {
    it('scales guarantees down proportionally when they exceed the pool', () => {
      const participants = [
        person('a', 1, exactly(60)),
        person('b', 1, exactly(60)),
      ];
      const result = calculateTipSplitWithGuarantees(10000, participants, byHours);

      expect(result.scaledDownFactor).toBeCloseTo(10000 / 12000, 6);
      expect(amountOf(result, 'a')).toBe(5000);
      expect(amountOf(result, 'b')).toBe(5000);
      expect(sumOf(result)).toBe(10000);
    });

    it('reports no scaling when guarantees total exactly 100%', () => {
      const participants = [person('a', 1, atLeast(50)), person('b', 1, atLeast(50))];
      const result = calculateTipSplitWithGuarantees(10000, participants, byHours);

      expect(result.scaledDownFactor).toBeNull();
      expect(sumOf(result)).toBe(10000);
    });
  });

  describe('provenance', () => {
    it('attaches the applied rule to the share', () => {
      const participants = [person('mgr', 1, atLeast(30)), person('a', 9)];
      const result = calculateTipSplitWithGuarantees(10000, participants, byHours);

      expect(result.shares.find(s => s.employeeId === 'mgr')?.appliedRule).toEqual({
        mode: 'at_least',
        percentage: 30,
      });
      expect(result.shares.find(s => s.employeeId === 'a')?.appliedRule).toBeUndefined();
    });

    it('survives a manual override through rebalanceAllocations', () => {
      const participants = [person('mgr', 1, atLeast(30)), person('a', 9)];
      const { shares } = calculateTipSplitWithGuarantees(10000, participants, byHours);
      const rebalanced = rebalanceAllocations(10000, shares, 'a', 8000);

      expect(rebalanced.find(s => s.employeeId === 'mgr')?.appliedRule).toEqual({
        mode: 'at_least',
        percentage: 30,
      });
    });
  });

  describe('cent exactness', () => {
    it('allocates every cent across an awkward participant count', () => {
      const participants = [
        person('a', 1, atLeast(11)),
        person('b', 1),
        person('c', 1),
        person('d', 1, exactly(7)),
        person('e', 1),
        person('f', 1),
        person('g', 1),
      ];
      const result = calculateTipSplitWithGuarantees(10001, participants, byHours);

      expect(sumOf(result)).toBe(10001);
      expect(result.shares.every(s => s.amountCents >= 0)).toBe(true);
    });

    it('allocates every cent with an even remainder splitter', () => {
      const participants = [person('a', 0, atLeast(33)), person('b', 0), person('c', 0)];
      const result = calculateTipSplitWithGuarantees(10001, participants, evenly);

      expect(sumOf(result)).toBe(10001);
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
npm run test -- tests/unit/tipPooling-guarantees.test.ts
```

Expected: FAIL — `calculateTipSplitWithGuarantees is not a function` / import errors.

- [ ] **Step 3: Extend `TipShare`**

In `src/utils/tipPooling.ts`, replace lines 3-9:

```ts
export type RoleAllocationMode = 'at_least' | 'exactly';

/** A per-role allocation rule. Evaluated per person, not per role. */
export type RoleAllocationRule = {
  mode: RoleAllocationMode;
  /** 0-100. Enforced by tip_pool_settings_role_percentages_check in the database. */
  percentage: number;
};

export type TipShare = {
  employeeId: string;
  name: string;
  hours?: number;
  role?: string;
  amountCents: number;
  /** The rule in force for this employee, when one applied. */
  appliedRule?: RoleAllocationRule;
  /** True when an `at_least` floor raised this share above its base-method value. */
  lifted?: boolean;
};
```

- [ ] **Step 4: Write the algorithm**

Append to `src/utils/tipPooling.ts`, immediately after `calculateTipSplitByRole` (which currently ends at line 119):

```ts
export type GuaranteedParticipant = {
  id: string;
  name: string;
  hours?: number;
  role?: string;
  rule?: RoleAllocationRule;
};

export type GuaranteedSplitResult = {
  shares: TipShare[];
  /** Set when guarantees exceeded the pool and every rule was scaled down. */
  scaledDownFactor: number | null;
  /** Cents redistributed because only `exactly` participants worked. */
  redistributedLeftoverCents: number;
};

const amountsById = (shares: TipShare[]): Map<string, number> =>
  new Map(shares.map(s => [s.employeeId, s.amountCents]));

/**
 * Overlay per-role guarantees on top of any base share method.
 *
 * `exactly` participants are reserved off the top. Everyone else is water-filled
 * through `distributeRemainder`: anyone landing below their `at_least` floor is
 * locked at the floor and the pass repeats, so a floor only ever raises someone
 * and never caps them. Shares come back in the input order and always sum to
 * `totalTipsCents` exactly.
 */
export function calculateTipSplitWithGuarantees(
  totalTipsCents: number,
  participants: GuaranteedParticipant[],
  distributeRemainder: (poolCents: number, subset: GuaranteedParticipant[]) => TipShare[],
): GuaranteedSplitResult {
  if (participants.length === 0) {
    return { shares: [], scaledDownFactor: null, redistributedLeftoverCents: 0 };
  }

  const ruleOf = (p: GuaranteedParticipant): RoleAllocationRule | undefined =>
    p.rule && p.rule.percentage > 0 ? p.rule : undefined;

  const toShare = (p: GuaranteedParticipant, amountCents: number): TipShare => {
    const share: TipShare = { employeeId: p.id, name: p.name, amountCents };
    if (p.hours !== undefined) share.hours = p.hours;
    if (p.role !== undefined) share.role = p.role;
    const rule = ruleOf(p);
    if (rule) share.appliedRule = rule;
    return share;
  };

  if (totalTipsCents <= 0) {
    return {
      shares: participants.map(p => toShare(p, 0)),
      scaledDownFactor: null,
      redistributedLeftoverCents: 0,
    };
  }

  // 1. Convert rules to cents.
  const guarantees = new Map<string, number>();
  let guaranteedTotal = 0;
  for (const p of participants) {
    const rule = ruleOf(p);
    if (!rule) continue;
    const cents = Math.round(totalTipsCents * (rule.percentage / 100));
    guarantees.set(p.id, cents);
    guaranteedTotal += cents;
  }

  if (guarantees.size === 0) {
    const amounts = amountsById(distributeRemainder(totalTipsCents, participants));
    return {
      shares: participants.map(p => toShare(p, amounts.get(p.id) ?? 0)),
      scaledDownFactor: null,
      redistributedLeftoverCents: 0,
    };
  }

  // 2. Feasibility — guarantees are per person, so several people in one role
  //    can overshoot even when each individual percentage is legal.
  let scaledDownFactor: number | null = null;
  if (guaranteedTotal > totalTipsCents) {
    scaledDownFactor = totalTipsCents / guaranteedTotal;
    for (const [id, cents] of guarantees) {
      guarantees.set(id, Math.floor(cents * scaledDownFactor));
    }
  }

  // 3. Reserve the `exactly` participants off the top.
  const locked = new Map<string, number>();
  let pool = totalTipsCents;
  for (const p of participants) {
    if (ruleOf(p)?.mode === 'exactly') {
      const cents = guarantees.get(p.id) ?? 0;
      locked.set(p.id, cents);
      pool -= cents;
    }
  }
  if (pool < 0) pool = 0;

  // 4. Water-fill: run the base method, lock anyone below their floor, repeat.
  const lifted = new Set<string>();
  let candidates = participants.filter(p => !locked.has(p.id));
  while (candidates.length > 0) {
    const amounts = amountsById(distributeRemainder(pool, candidates));
    const belowFloor = candidates.filter(p => {
      if (ruleOf(p)?.mode !== 'at_least') return false;
      return (amounts.get(p.id) ?? 0) < (guarantees.get(p.id) ?? 0);
    });

    if (belowFloor.length === 0) {
      for (const p of candidates) locked.set(p.id, amounts.get(p.id) ?? 0);
      break;
    }

    for (const p of belowFloor) {
      const floor = guarantees.get(p.id) ?? 0;
      locked.set(p.id, floor);
      lifted.add(p.id);
      pool -= floor;
    }
    if (pool < 0) pool = 0;
    candidates = candidates.filter(p => !locked.has(p.id));
  }

  // 5. Leftover — only reachable when every participant is locked, i.e. every
  //    rule is `exactly` and they total under 100%. Split it in proportion to
  //    the configured percentages.
  let redistributedLeftoverCents = 0;
  const allocated = participants.reduce((sum, p) => sum + (locked.get(p.id) ?? 0), 0);
  const leftover = totalTipsCents - allocated;
  if (leftover > 0) {
    // Don't report a leftover that is only the rounding dust from scaling down —
    // the scale-down advisory already explains that case, and "no hourly staff
    // worked" would be wrong.
    redistributedLeftoverCents = scaledDownFactor === null ? leftover : 0;
    const extra = distributeByRatio(
      leftover,
      participants.map(p => ruleOf(p)?.percentage ?? 0),
    );
    participants.forEach((p, i) => {
      locked.set(p.id, (locked.get(p.id) ?? 0) + extra[i]);
    });
  }

  // 6. Reconcile so the shares sum to the pool exactly — Approve is gated on it.
  const shares = participants.map(p => toShare(p, locked.get(p.id) ?? 0));
  const residual = totalTipsCents - shares.reduce((sum, s) => sum + s.amountCents, 0);
  if (residual !== 0) {
    const nonExact: number[] = [];
    const all: number[] = [];
    participants.forEach((p, i) => {
      all.push(i);
      if (ruleOf(p)?.mode !== 'exactly') nonExact.push(i);
    });
    const target =
      [...nonExact, ...all].find(i => shares[i].amountCents + residual >= 0) ?? all.length - 1;
    shares[target].amountCents += residual;
  }

  for (const share of shares) {
    if (lifted.has(share.employeeId)) share.lifted = true;
  }

  return { shares, scaledDownFactor, redistributedLeftoverCents };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run:

```bash
npm run test -- tests/unit/tipPooling-guarantees.test.ts
```

Expected: PASS, all assertions green.

- [ ] **Step 6: Verify no existing tip tests regressed**

Run:

```bash
npm run test -- tests/unit/tipPooling.test.ts tests/unit/tipPooling-comprehensive.test.ts tests/unit/tipPooling-percentage.test.ts tests/unit/tipPooling-manager-ux.test.ts tests/unit/tipPooling-employee-ux.test.ts
```

Expected: PASS — `TipShare` only gained optional fields.

- [ ] **Step 7: Commit**

```bash
git add src/utils/tipPooling.ts tests/unit/tipPooling-guarantees.test.ts
git commit -m "feat(tips): add calculateTipSplitWithGuarantees allocation algorithm"
```

---

### Task 3: Settings persistence

**Files:**
- Modify: `src/hooks/useTipPoolSettings.tsx:10-31`
- Modify: `src/hooks/useAutoSaveTipSettings.ts:10-58`
- Test: `tests/unit/useAutoSaveTipSettings.test.tsx`

**Interfaces:**
- Consumes: `RoleAllocationRule` from `@/utils/tipPooling` (Task 2).
- Produces: `TipPoolSettings.role_percentages: Record<string, RoleAllocationRule>`, `TipPoolSettingsUpdate.role_percentages?: Record<string, RoleAllocationRule>`, and a `rolePercentages: Record<string, RoleAllocationRule>` param on `useAutoSaveTipSettings`.

- [ ] **Step 1: Write the failing test**

Append to the outermost `describe` in `tests/unit/useAutoSaveTipSettings.test.tsx`:

```ts
  it('saves when role percentages diverge from persisted settings', async () => {
    const onSave = vi.fn();
    const settings = {
      id: 's1',
      restaurant_id: 'r1',
      tip_source: 'manual',
      share_method: 'hours',
      split_cadence: 'daily',
      role_weights: {},
      role_percentages: {},
      enabled_employee_ids: [],
      pooling_model: 'full_pool',
      active: true,
      created_at: '',
      updated_at: '',
    } as never;

    renderHook(() =>
      useAutoSaveTipSettings({
        settings,
        tipSource: 'manual',
        shareMethod: 'hours',
        splitCadence: 'daily',
        roleWeights: {},
        rolePercentages: { Manager: { mode: 'at_least', percentage: 10 } },
        selectedEmployees: new Set<string>(),
        poolingModel: 'full_pool',
        onSave,
      }),
    );

    expect(onSave).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('does not save when role percentages are unchanged', async () => {
    const onSave = vi.fn();
    const rules = { Manager: { mode: 'at_least' as const, percentage: 10 } };
    const settings = {
      id: 's1',
      restaurant_id: 'r1',
      tip_source: 'manual',
      share_method: 'hours',
      split_cadence: 'daily',
      role_weights: {},
      role_percentages: rules,
      enabled_employee_ids: [],
      pooling_model: 'full_pool',
      active: true,
      created_at: '',
      updated_at: '',
    } as never;

    renderHook(() =>
      useAutoSaveTipSettings({
        settings,
        tipSource: 'manual',
        shareMethod: 'hours',
        splitCadence: 'daily',
        roleWeights: {},
        rolePercentages: { Manager: { mode: 'at_least', percentage: 10 } },
        selectedEmployees: new Set<string>(),
        poolingModel: 'full_pool',
        onSave,
      }),
    );

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(onSave).not.toHaveBeenCalled();
  });
```

If the existing file does not already set up fake timers and imports, add at the top of the file (only if absent):

```ts
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useAutoSaveTipSettings } from '@/hooks/useAutoSaveTipSettings';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npm run test -- tests/unit/useAutoSaveTipSettings.test.tsx
```

Expected: FAIL — TypeScript rejects the unknown `rolePercentages` property, or the "saves when role percentages diverge" case sees `onSave` uncalled.

- [ ] **Step 3: Add the field to the settings interfaces**

In `src/hooks/useTipPoolSettings.tsx`, add the import and the two fields:

```ts
import type { RoleAllocationRule } from '@/utils/tipPooling';
```

In `TipPoolSettings` (after line 16, `role_weights`):

```ts
  role_weights: Record<string, number>;
  /** Per-role guarantees, Full Pool only. Empty object means no rules. */
  role_percentages: Record<string, RoleAllocationRule>;
```

In `TipPoolSettingsUpdate` (after line 28):

```ts
  role_weights?: Record<string, number>;
  role_percentages?: Record<string, RoleAllocationRule>;
```

- [ ] **Step 4: Add change detection to the autosave hook**

In `src/hooks/useAutoSaveTipSettings.ts`, add the import:

```ts
import type { RoleAllocationRule } from '@/utils/tipPooling';
```

Add to `Params` after `roleWeights` (line 15):

```ts
  roleWeights: Record<string, number>;
  rolePercentages: Record<string, RoleAllocationRule>;
```

Destructure it in the signature after `roleWeights` (line 30):

```ts
  roleWeights,
  rolePercentages,
```

Add the comparison to the `settings`-present branch, after line 43:

```ts
        JSON.stringify(roleWeights) !== JSON.stringify(settings.role_weights) ||
        JSON.stringify(rolePercentages) !== JSON.stringify(settings.role_percentages ?? {}) ||
```

Add to the no-settings branch, after line 49:

```ts
        (poolingModel !== undefined && poolingModel !== 'full_pool') ||
        Object.keys(rolePercentages).length > 0;
```

Add `rolePercentages` to the dependency array on line 58:

```ts
  }, [settings, tipSource, shareMethod, splitCadence, roleWeights, rolePercentages, selectedEmployees, poolingModel, onSave]);
```

- [ ] **Step 5: Run the tests to verify they pass**

Run:

```bash
npm run test -- tests/unit/useAutoSaveTipSettings.test.tsx tests/unit/useAutoSaveTipSettings.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useTipPoolSettings.tsx src/hooks/useAutoSaveTipSettings.ts tests/unit/useAutoSaveTipSettings.test.tsx
git commit -m "feat(tips): carry role_percentages through settings persistence"
```

---

### Task 4: Role allocation settings section

**Files:**
- Create: `src/components/tips/RoleAllocationSection.tsx`
- Modify: `src/components/tips/TipPoolSettingsDialog.tsx` — props (`:23-49`), destructure (`:60-81`), local state (`:84-89`), render after the Share Method block (which ends at `:333`)
- Test: `tests/unit/RoleAllocationSection.test.tsx`

**Interfaces:**
- Consumes: `RoleAllocationRule`, `RoleAllocationMode` from `@/utils/tipPooling` (Task 2).
- Produces:
  ```ts
  type RoleAllocationSectionProps = {
    roles: string[];
    rules: Record<string, RoleAllocationRule>;
    onChange: (rules: Record<string, RoleAllocationRule>) => void;
  };
  export function RoleAllocationSection(props: Readonly<RoleAllocationSectionProps>): JSX.Element;
  ```
  Plus two new `TipPoolSettingsDialog` props: `rolePercentages: Record<string, RoleAllocationRule>` and `onRolePercentagesChange: (rules: Record<string, RoleAllocationRule>) => void`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/RoleAllocationSection.test.tsx`:

```tsx
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RoleAllocationSection } from '@/components/tips/RoleAllocationSection';

describe('RoleAllocationSection', () => {
  const roles = ['Manager', 'Server', 'Busser'];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders a row per role', () => {
    render(<RoleAllocationSection roles={roles} rules={{}} onChange={vi.fn()} />);

    expect(screen.getByText('Manager')).toBeInTheDocument();
    expect(screen.getByText('Server')).toBeInTheDocument();
    expect(screen.getByText('Busser')).toBeInTheDocument();
  });

  it('labels each mode control for screen readers', () => {
    render(<RoleAllocationSection roles={roles} rules={{}} onChange={vi.fn()} />);

    expect(screen.getByLabelText('Manager allocation mode')).toBeInTheDocument();
  });

  it('hides the percentage input for roles with no rule', () => {
    render(<RoleAllocationSection roles={roles} rules={{}} onChange={vi.fn()} />);

    expect(screen.queryByLabelText('Manager percentage')).not.toBeInTheDocument();
  });

  it('shows the percentage input when a rule is set', () => {
    render(
      <RoleAllocationSection
        roles={roles}
        rules={{ Manager: { mode: 'at_least', percentage: 10 } }}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByLabelText('Manager percentage')).toHaveValue(10);
  });

  it('emits a rule when a mode is chosen', () => {
    const onChange = vi.fn();
    render(<RoleAllocationSection roles={roles} rules={{}} onChange={onChange} />);

    fireEvent.click(screen.getByRole('radio', { name: 'Manager: at least a set percentage' }));

    expect(onChange).toHaveBeenCalledWith({ Manager: { mode: 'at_least', percentage: 10 } });
  });

  it('removes the rule when the mode returns to by hours', () => {
    const onChange = vi.fn();
    render(
      <RoleAllocationSection
        roles={roles}
        rules={{ Manager: { mode: 'at_least', percentage: 10 } }}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole('radio', { name: 'Manager: by hours' }));

    expect(onChange).toHaveBeenCalledWith({});
  });

  it('clamps the percentage to 0-100', () => {
    const onChange = vi.fn();
    render(
      <RoleAllocationSection
        roles={roles}
        rules={{ Manager: { mode: 'exactly', percentage: 10 } }}
        onChange={onChange}
      />,
    );

    fireEvent.change(screen.getByLabelText('Manager percentage'), { target: { value: '150' } });
    expect(onChange).toHaveBeenCalledWith({ Manager: { mode: 'exactly', percentage: 100 } });

    fireEvent.change(screen.getByLabelText('Manager percentage'), { target: { value: '-5' } });
    expect(onChange).toHaveBeenCalledWith({ Manager: { mode: 'exactly', percentage: 0 } });
  });

  it('summarises configured rules per person', () => {
    render(
      <RoleAllocationSection
        roles={roles}
        rules={{
          Manager: { mode: 'at_least', percentage: 10 },
          Server: { mode: 'exactly', percentage: 15 },
        }}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByText('10% + 15% per person on these roles')).toBeInTheDocument();
  });

  it('warns when configured percentages exceed 100', () => {
    render(
      <RoleAllocationSection
        roles={roles}
        rules={{
          Manager: { mode: 'exactly', percentage: 60 },
          Server: { mode: 'exactly', percentage: 60 },
        }}
        onChange={vi.fn()}
      />,
    );

    expect(
      screen.getByText(
        "Over 100% — guarantees will be scaled down proportionally on days they don't fit.",
      ),
    ).toBeInTheDocument();
  });

  it('shows nothing in the footer when no rules are configured', () => {
    render(<RoleAllocationSection roles={roles} rules={{}} onChange={vi.fn()} />);

    expect(screen.queryByText(/per person on these roles/)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npm run test -- tests/unit/RoleAllocationSection.test.tsx
```

Expected: FAIL — `Failed to resolve import "@/components/tips/RoleAllocationSection"`.

- [ ] **Step 3: Write the component**

Create `src/components/tips/RoleAllocationSection.tsx`:

```tsx
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { AlertTriangle } from 'lucide-react';
import type { RoleAllocationMode, RoleAllocationRule } from '@/utils/tipPooling';

const DEFAULT_PERCENTAGE = 10;

type ModeValue = 'hours' | RoleAllocationMode;

interface RoleAllocationSectionProps {
  readonly roles: string[];
  readonly rules: Record<string, RoleAllocationRule>;
  readonly onChange: (rules: Record<string, RoleAllocationRule>) => void;
}

const MODE_LABELS: Record<ModeValue, { label: string; description: string }> = {
  hours: { label: 'By hours', description: 'by hours' },
  at_least: { label: 'At least', description: 'at least a set percentage' },
  exactly: { label: 'Exactly', description: 'exactly a set percentage' },
};

/**
 * Per-role allocation rules for the Full Pool model.
 *
 * Fully controlled: the dialog owns the rule map and auto-saves it, so this
 * component holds no state of its own. Rules are per person — two people in a
 * 10% role commit 20% of the pool — so the footer never reports a pool fraction.
 */
export function RoleAllocationSection({ roles, rules, onChange }: RoleAllocationSectionProps) {
  const handleModeChange = (role: string, next: string) => {
    if (!next || next === 'hours') {
      const { [role]: _removed, ...rest } = rules;
      onChange(rest);
      return;
    }
    onChange({
      ...rules,
      [role]: {
        mode: next as RoleAllocationMode,
        percentage: rules[role]?.percentage ?? DEFAULT_PERCENTAGE,
      },
    });
  };

  const handlePercentageChange = (role: string, raw: string) => {
    const existing = rules[role];
    if (!existing) return;
    const parsed = Number.parseFloat(raw);
    const percentage = Number.isNaN(parsed) ? 0 : Math.min(100, Math.max(0, parsed));
    onChange({ ...rules, [role]: { ...existing, percentage } });
  };

  const configured = roles.filter(role => rules[role]);
  const configuredTotal = configured.reduce((sum, role) => sum + rules[role].percentage, 0);
  const isOver = configuredTotal > 100;

  return (
    <div className="rounded-xl border border-border/40 bg-muted/30 overflow-hidden">
      <div className="px-4 py-3 border-b border-border/40 bg-muted/50">
        <h3 className="text-[13px] font-semibold text-foreground">Role Allocation</h3>
        <p className="text-[12px] text-muted-foreground mt-0.5">
          Guarantee a role a minimum share, or pin it to a fixed share. Applied per person on the
          days they worked.
        </p>
      </div>
      <div className="p-4 space-y-3">
        {roles.map(role => {
          const rule = rules[role];
          const value: ModeValue = rule?.mode ?? 'hours';

          return (
            <div key={role} className="flex items-center gap-3">
              <span className="w-24 shrink-0 text-[14px] text-foreground truncate">{role}</span>
              <ToggleGroup
                type="single"
                value={value}
                onValueChange={next => handleModeChange(role, next)}
                aria-label={`${role} allocation mode`}
                size="sm"
                variant="outline"
                className="justify-start"
              >
                {(['hours', 'at_least', 'exactly'] as ModeValue[]).map(mode => (
                  <ToggleGroupItem
                    key={mode}
                    value={mode}
                    aria-label={`${role}: ${MODE_LABELS[mode].description}`}
                    className="h-9 px-3 rounded-lg text-[13px] font-medium"
                  >
                    {MODE_LABELS[mode].label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              {rule ? (
                <div className="flex items-center gap-1.5">
                  <Label htmlFor={`role-pct-${role}`} className="sr-only">
                    {`${role} percentage`}
                  </Label>
                  <Input
                    id={`role-pct-${role}`}
                    type="number"
                    min={0}
                    max={100}
                    step={0.5}
                    value={rule.percentage}
                    onChange={e => handlePercentageChange(role, e.target.value)}
                    className="w-20 h-9 text-[14px] bg-muted/30 border-border/40 rounded-lg"
                  />
                  <span className="text-[13px] text-muted-foreground">%</span>
                </div>
              ) : (
                <span className="text-[13px] text-muted-foreground" aria-hidden="true">
                  —
                </span>
              )}
            </div>
          );
        })}

        {configured.length > 0 && (
          <div
            className={
              isOver
                ? 'flex items-center gap-2 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20'
                : 'pt-1'
            }
          >
            {isOver && <AlertTriangle className="h-4 w-4 text-amber-600 flex-shrink-0" />}
            <span className={isOver ? 'text-[13px] text-amber-600' : 'text-[13px] text-muted-foreground'}>
              {isOver
                ? "Over 100% — guarantees will be scaled down proportionally on days they don't fit."
                : `${configured.map(role => `${rules[role].percentage}%`).join(' + ')} per person on these roles`}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
npm run test -- tests/unit/RoleAllocationSection.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Wire the section into the settings dialog**

In `src/components/tips/TipPoolSettingsDialog.tsx`:

Add the import next to the existing tip imports:

```tsx
import { RoleAllocationSection } from './RoleAllocationSection';
import type { RoleAllocationRule } from '@/utils/tipPooling';
```

Add to `TipPoolSettingsDialogProps`, after `roleWeights: Record<string, number>;` (line 32):

```tsx
  roleWeights: Record<string, number>;
  rolePercentages: Record<string, RoleAllocationRule>;
```

and after `onRoleWeightsChange` (line 41):

```tsx
  onRoleWeightsChange: (weights: Record<string, number>) => void;
  onRolePercentagesChange: (rules: Record<string, RoleAllocationRule>) => void;
```

Destructure both in the component signature, after `roleWeights,` (line 68) and after `onRoleWeightsChange,` (line 75):

```tsx
  roleWeights,
  rolePercentages,
```

```tsx
  onRoleWeightsChange,
  onRolePercentagesChange,
```

Mirror the Role Weights local-state pattern — add after line 89:

```tsx
  const [localRolePercentages, setLocalRolePercentages] = useState(rolePercentages);

  useEffect(() => {
    setLocalRolePercentages(rolePercentages);
  }, [rolePercentages]);

  const handleRolePercentagesChange = (rules: Record<string, RoleAllocationRule>) => {
    setLocalRolePercentages(rules);
    onRolePercentagesChange(rules);
  };
```

Render the section immediately after the Share Method block closes (after the `)}` on line 333, before the `{/* Role Weights ... */}` comment). It is gated on `isFullPool` only — rules overlay every base share method, unlike Role Weights:

```tsx
          {/* Role Allocation (full_pool only — overlays whichever share method is active) */}
          {isFullPool && (
            <RoleAllocationSection
              roles={uniqueRoles}
              rules={localRolePercentages}
              onChange={handleRolePercentagesChange}
            />
          )}
```

- [ ] **Step 6: Keep the existing dialog tests green**

In `tests/unit/TipPoolSettingsDialog.test.tsx`, add the two new required props to `defaultProps`, after `roleWeights`:

```ts
    roleWeights: { Server: 1, Bartender: 1, Busser: 0.5 },
    rolePercentages: {},
```

and after `onRoleWeightsChange`:

```ts
    onRoleWeightsChange: vi.fn(),
    onRolePercentagesChange: vi.fn(),
```

Then add one integration case at the end of the outermost `describe`:

```tsx
  it('renders role allocation for full pool regardless of share method', () => {
    render(<TipPoolSettingsDialog {...defaultProps} shareMethod="hours" />);
    expect(screen.getByText('Role Allocation')).toBeInTheDocument();
  });

  it('does not render role allocation for percentage contribution pools', () => {
    render(<TipPoolSettingsDialog {...defaultProps} poolingModel="percentage_contribution" />);
    expect(screen.queryByText('Role Allocation')).not.toBeInTheDocument();
  });
```

`shareMethod="hours"` is the point of the first case: unlike Role Weights, the section renders for a non-`role` method.

- [ ] **Step 7: Run the dialog tests**

Run:

```bash
npm run test -- tests/unit/TipPoolSettingsDialog.test.tsx tests/unit/RoleAllocationSection.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/components/tips/RoleAllocationSection.tsx src/components/tips/TipPoolSettingsDialog.tsx tests/unit/RoleAllocationSection.test.tsx tests/unit/TipPoolSettingsDialog.test.tsx
git commit -m "feat(tips): add role allocation section to tip pool settings"
```

---

### Task 5: Live percentage in the hours grid

**Files:**
- Create: `src/hooks/useDebouncedValue.ts`
- Modify: `src/pages/Tips.tsx` — imports (`:12`, `:15`), state (`:257`), settings sync effect (`:265-270`), preview memo (`:394-409`), save callback (`:578-589`), autosave call (`:591-599`), hours grid rows (`:697-732`), dialog props (`:799-821`)
- Test: `tests/unit/useDebouncedValue.test.ts`

**Interfaces:**
- Consumes: `calculateTipSplitWithGuarantees`, `GuaranteedParticipant`, `RoleAllocationRule` (Task 2); `role_percentages` on settings (Task 3); `rolePercentages` / `onRolePercentagesChange` dialog props (Task 4).
- Produces: `export function useDebouncedValue<T>(value: T, delayMs: number): T`. `previewShares` becomes `guaranteedResult.shares`; `guaranteedResult` also exposes `scaledDownFactor` and `redistributedLeftoverCents` for Task 6.

- [ ] **Step 1: Write the failing debounce test**

Create `tests/unit/useDebouncedValue.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';

describe('useDebouncedValue', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('returns the initial value immediately', () => {
    const { result } = renderHook(() => useDebouncedValue('a', 200));
    expect(result.current).toBe('a');
  });

  it('holds the previous value until the delay elapses', () => {
    const { result, rerender } = renderHook(({ v }) => useDebouncedValue(v, 200), {
      initialProps: { v: 'a' },
    });

    rerender({ v: 'b' });
    expect(result.current).toBe('a');

    act(() => {
      vi.advanceTimersByTime(199);
    });
    expect(result.current).toBe('a');

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe('b');
  });

  it('skips intermediate values when updates arrive faster than the delay', () => {
    const { result, rerender } = renderHook(({ v }) => useDebouncedValue(v, 200), {
      initialProps: { v: '1' },
    });

    rerender({ v: '12' });
    act(() => {
      vi.advanceTimersByTime(100);
    });
    rerender({ v: '120' });
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(result.current).toBe('1');

    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(result.current).toBe('120');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npm run test -- tests/unit/useDebouncedValue.test.ts
```

Expected: FAIL — `Failed to resolve import "@/hooks/useDebouncedValue"`.

- [ ] **Step 3: Write the hook**

Create `src/hooks/useDebouncedValue.ts`:

```ts
import { useEffect, useState } from 'react';

/**
 * Trailing-edge debounce for a *displayed* value.
 *
 * Use this only for read-only display. Debouncing the underlying state would
 * delay form behaviour; debouncing the projection keeps typing responsive while
 * stopping a shared derived readout from flashing through intermediate values.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timeoutId = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timeoutId);
  }, [value, delayMs]);

  return debounced;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
npm run test -- tests/unit/useDebouncedValue.test.ts
```

Expected: PASS.

- [ ] **Step 5: Wire rules into the split preview**

In `src/pages/Tips.tsx`, extend the `@/utils/tipPooling` import on line 12:

```ts
import { formatCurrencyFromCents, calculateTipSplitByHours, calculateTipSplitByRole, filterTipEligible, calculateTipSplitEven, calculatePercentagePoolAllocations, calculateTipSplitWithGuarantees, type PercentageAllocationResult, type GuaranteedParticipant, type RoleAllocationRule, type TipShare } from '@/utils/tipPooling';
```

Add the debounce import next to the other hook imports:

```ts
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
```

Add state after `roleWeights` (line 257):

```ts
  const [rolePercentages, setRolePercentages] = useState<Record<string, RoleAllocationRule>>(
    settings?.role_percentages || {},
  );
```

Add to the settings-sync effect, next to `setRoleWeights(...)` (line 270):

```ts
      setRolePercentages(settings.role_percentages || {});
```

Replace the `previewShares` memo (lines 394-409) with the guarantee-aware version:

```ts
  const distributeRemainder = useCallback(
    (poolCents: number, subset: GuaranteedParticipant[]): TipShare[] => {
      if (shareMethod === 'hours') {
        return calculateTipSplitByHours(
          poolCents,
          subset.map(p => ({ id: p.id, name: p.name, hours: p.hours ?? 0 })),
        );
      }
      if (shareMethod === 'role') {
        return calculateTipSplitByRole(
          poolCents,
          subset.map(p => ({
            id: p.id,
            name: p.name,
            role: p.role ?? '',
            weight: roleWeights[p.role ?? ''] || 1,
          })),
        );
      }
      return calculateTipSplitEven(poolCents, subset.map(p => ({ id: p.id, name: p.name })));
    },
    [shareMethod, roleWeights],
  );

  // Guarantees are a Full Pool concept — percentage-contribution pools allocate
  // per sub-pool and are out of scope.
  const guaranteedParticipants = useMemo<GuaranteedParticipant[]>(
    () =>
      participants.map(p => ({
        id: p.id,
        name: p.name,
        hours: Number.parseFloat(hoursByEmployee[p.id] || '0') || 0,
        role: p.position,
        rule:
          poolingModel === 'full_pool' && p.position ? rolePercentages[p.position] : undefined,
      })),
    [participants, hoursByEmployee, rolePercentages, poolingModel],
  );

  const guaranteedResult = useMemo(
    () => calculateTipSplitWithGuarantees(totalTipsCents, guaranteedParticipants, distributeRemainder),
    [totalTipsCents, guaranteedParticipants, distributeRemainder],
  );

  const previewShares = guaranteedResult.shares;
```

`hoursAllocations` (lines 386-392) is now unused — delete it.

Add the rules to the save callback (line 585) and its dependency array (line 589):

```ts
      role_weights: roleWeights,
      role_percentages: rolePercentages,
```

```ts
  }, [restaurantId, selectedEmployees, shareMethod, splitCadence, tipSource, roleWeights, rolePercentages, poolingModel, updateSettings]);
```

Add to the `useAutoSaveTipSettings` call (after line 596):

```ts
    roleWeights,
    rolePercentages,
```

Add to the `TipPoolSettingsDialog` props (after line 807 / line 814):

```tsx
        roleWeights={roleWeights}
        rolePercentages={rolePercentages}
```

```tsx
        onRoleWeightsChange={setRoleWeights}
        onRolePercentagesChange={setRolePercentages}
```

- [ ] **Step 6: Add the live percentage readout to the hours grid**

Still in `src/pages/Tips.tsx`, add the debounced projection next to the other memos, after `guaranteedResult`:

```ts
  // Debounce the *display* only. The underlying hours state stays immediate so
  // typing, manual-edit flags, and autosave are unaffected; without this a
  // keystroke in one row visibly re-renders every other row's percentage.
  const displayShares = useDebouncedValue(guaranteedResult.shares, 200);

  const displayByEmployee = useMemo(
    () => new Map(displayShares.map(s => [s.employeeId, s])),
    [displayShares],
  );
```

Replace the grid row body (lines 698-730) with the version that shows the percentage in the header row's right-hand slot and a rule badge beside the name:

```tsx
                  return (
                    <div key={emp.id} className="space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <Label htmlFor={`hours-${emp.id}`} className="flex items-center gap-1.5 min-w-0">
                          <span className="truncate">{emp.name}</span>
                          {isAutoCalculated && hasPunches && (
                            <Clock className="h-3 w-3 text-muted-foreground shrink-0" aria-label="Auto-calculated from time punches" />
                          )}
                          {(() => {
                            const rule = emp.position ? rolePercentages[emp.position] : undefined;
                            if (!rule || poolingModel !== 'full_pool') return null;
                            return (
                              <span className="text-[11px] px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground shrink-0">
                                {rule.mode === 'at_least'
                                  ? `Guaranteed ${rule.percentage}%`
                                  : `Fixed ${rule.percentage}%`}
                              </span>
                            );
                          })()}
                        </Label>
                        <div className="flex items-center gap-2 shrink-0">
                          {!hasPunches && (
                            <span className="text-xs text-muted-foreground">No punches</span>
                          )}
                          {(() => {
                            const share = displayByEmployee.get(emp.id);
                            if (!share || totalTipsCents <= 0) return null;
                            const pct = (share.amountCents / totalTipsCents) * 100;
                            return (
                              <span className="text-[13px] text-muted-foreground tabular-nums">
                                {pct.toFixed(1)}% · {formatCurrencyFromCents(share.amountCents)}
                                {share.lifted && (
                                  <span className="ml-1" aria-label="Guaranteed minimum applied">
                                    ↑
                                  </span>
                                )}
                              </span>
                            );
                          })()}
                        </div>
                      </div>
                      <Input
                        id={`hours-${emp.id}`}
                        type="number"
                        step="0.1"
                        min="0"
                        value={hoursByEmployee[emp.id] ?? '0'}
                        onChange={e => {
                          setHoursByEmployee(prev => ({
                            ...prev,
                            [emp.id]: e.target.value,
                          }));
                          // Mark as manually edited
                          setAutoCalculatedHours(prev => ({
                            ...prev,
                            [emp.id]: false,
                          }));
                        }}
                        className={isAutoCalculated && hasPunches ? 'border-primary/50' : ''}
                      />
                    </div>
                  );
```

Add a summary line directly above the grid, replacing the opening `<div className="grid md:grid-cols-2 gap-3">` on line 691 with:

```tsx
              <p className="text-[13px] text-muted-foreground mb-3">
                {`Pool ${formatCurrencyFromCents(totalTipsCents)} · ${participants.length} ${participants.length === 1 ? 'person' : 'people'}`}
              </p>
              <div className="grid md:grid-cols-2 gap-3">
```

- [ ] **Step 7: Verify the app compiles and existing page tests pass**

Run:

```bash
npm run typecheck && npm run test -- tests/unit/Tips.distributionTab.test.tsx tests/unit/tips-hours-auto-calculation.test.ts tests/unit/tipsDistribution-staleRefs-guard.test.ts
```

Expected: typecheck exit 0, tests PASS.

- [ ] **Step 8: Commit**

```bash
git add src/hooks/useDebouncedValue.ts tests/unit/useDebouncedValue.test.ts src/pages/Tips.tsx
git commit -m "feat(tips): apply role guarantees and show live pool percentage while entering hours"
```

---

### Task 6: Review screen percentage column

**Files:**
- Modify: `src/components/tips/TipReviewScreen.tsx` — props (`:11-21`), destructure (`:32-42`), advisory render near the totals block (`:146-153`), `AllocationTable` (`:196-284`)
- Modify: `src/pages/Tips.tsx:747-756` — pass the two advisory flags

**Interfaces:**
- Consumes: `guaranteedResult.scaledDownFactor` and `guaranteedResult.redistributedLeftoverCents` (Task 5); `TipShare.appliedRule` / `TipShare.lifted` (Task 2).
- Produces: two new optional `TipReviewScreen` props — `scaledDownFactor?: number | null`, `redistributedLeftoverCents?: number`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/TipReviewScreen.guarantees.test.tsx`:

```tsx
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TipReviewScreen } from '@/components/tips/TipReviewScreen';
import type { TipShare } from '@/utils/tipPooling';

const shares: TipShare[] = [
  {
    employeeId: '1',
    name: 'Manager Mo',
    hours: 2,
    role: 'Manager',
    amountCents: 3000,
    appliedRule: { mode: 'at_least', percentage: 30 },
    lifted: true,
  },
  { employeeId: '2', name: 'Server Sam', hours: 8, role: 'Server', amountCents: 7000 },
];

const baseProps = {
  totalTipsCents: 10000,
  initialShares: shares,
  shareMethod: 'hours' as const,
  onApprove: vi.fn(),
  onSaveDraft: vi.fn(),
};

describe('TipReviewScreen guarantees', () => {
  it('shows a percentage of pool column', () => {
    render(<TipReviewScreen {...baseProps} />);

    expect(screen.getByText('% of pool')).toBeInTheDocument();
    expect(screen.getByText('30.0%')).toBeInTheDocument();
    expect(screen.getByText('70.0%')).toBeInTheDocument();
  });

  it('badges an employee whose share came from a guarantee', () => {
    render(<TipReviewScreen {...baseProps} />);

    expect(screen.getByText('Guaranteed 30%')).toBeInTheDocument();
  });

  it('badges an employee pinned to a fixed share', () => {
    render(
      <TipReviewScreen
        {...baseProps}
        initialShares={[
          {
            employeeId: '1',
            name: 'Chef Cal',
            amountCents: 10000,
            appliedRule: { mode: 'exactly', percentage: 15 },
          },
        ]}
      />,
    );

    expect(screen.getByText('Fixed 15%')).toBeInTheDocument();
  });

  it('warns when guarantees were scaled down', () => {
    render(<TipReviewScreen {...baseProps} scaledDownFactor={0.8} />);

    expect(
      screen.getByText('Guarantees totalled more than the pool and were reduced proportionally.'),
    ).toBeInTheDocument();
  });

  it('warns when leftover cents were redistributed', () => {
    render(<TipReviewScreen {...baseProps} redistributedLeftoverCents={2500} />);

    expect(
      screen.getByText(
        'No hourly staff worked; the remaining $25.00 was split across the fixed percentages.',
      ),
    ).toBeInTheDocument();
  });

  it('shows no advisory when neither branch fired', () => {
    render(<TipReviewScreen {...baseProps} scaledDownFactor={null} redistributedLeftoverCents={0} />);

    expect(screen.queryByText(/reduced proportionally/)).not.toBeInTheDocument();
    expect(screen.queryByText(/split across the fixed percentages/)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npm run test -- tests/unit/TipReviewScreen.guarantees.test.tsx
```

Expected: FAIL — `% of pool` not found.

- [ ] **Step 3: Add the props**

In `src/components/tips/TipReviewScreen.tsx`, add to `TipReviewScreenProps` after `poolResults?: PoolResult[];` (line 20):

```ts
  readonly scaledDownFactor?: number | null;
  readonly redistributedLeftoverCents?: number;
```

Destructure them after `poolResults,` (line 41):

```ts
  poolResults,
  scaledDownFactor = null,
  redistributedLeftoverCents = 0,
```

- [ ] **Step 4: Add the percentage column, badges and narrow-viewport handling**

Replace the `AllocationTable` return statement (lines 213-283) with:

```tsx
  return (
    <div className="rounded-xl border border-border/40 overflow-hidden overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="bg-muted/50 border-b border-border/40">
            <th className="px-4 py-2.5 text-left text-[12px] font-medium text-muted-foreground uppercase tracking-wider">Employee</th>
            {shareMethod === 'hours' && (
              <th className="hidden sm:table-cell px-4 py-2.5 text-right text-[12px] font-medium text-muted-foreground uppercase tracking-wider">Hours</th>
            )}
            {shareMethod === 'role' && (
              <th className="px-4 py-2.5 text-left text-[12px] font-medium text-muted-foreground uppercase tracking-wider">Role</th>
            )}
            <th className="px-4 py-2.5 text-right text-[12px] font-medium text-muted-foreground uppercase tracking-wider">% of pool</th>
            <th className="px-4 py-2.5 text-right text-[12px] font-medium text-muted-foreground uppercase tracking-wider">Tip</th>
          </tr>
        </thead>
        <tbody>
          {shares.map((share) => (
            <tr
              key={share.employeeId}
              className="border-b border-border/40 last:border-b-0 hover:bg-muted/30 transition-colors"
            >
              <td className="px-4 py-3">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="text-[14px] font-medium text-foreground truncate max-w-[12rem]">{share.name}</span>
                  {share.appliedRule && (
                    <span className="text-[11px] px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground shrink-0">
                      {share.appliedRule.mode === 'at_least'
                        ? `Guaranteed ${share.appliedRule.percentage}%`
                        : `Fixed ${share.appliedRule.percentage}%`}
                    </span>
                  )}
                </div>
              </td>
              {shareMethod === 'hours' && (
                <td className="hidden sm:table-cell px-4 py-3 text-right text-[13px] text-muted-foreground">
                  {share.hours?.toFixed(1) || '—'}
                </td>
              )}
              {shareMethod === 'role' && (
                <td className="px-4 py-3 text-[13px] text-muted-foreground">
                  {share.role || '—'}
                </td>
              )}
              <td className="px-4 py-3 text-right text-[13px] text-muted-foreground tabular-nums">
                {totalTipsCents > 0
                  ? `${((share.amountCents / totalTipsCents) * 100).toFixed(1)}%`
                  : '—'}
              </td>
              <td className="px-4 py-3 text-right">
                {editingEmployeeId === share.employeeId ? (
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    max={totalTipsCents / 100}
                    value={(share.amountCents / 100).toFixed(2)}
                    onChange={(e) => {
                      const newAmount = Math.round(Number.parseFloat(e.target.value || '0') * 100);
                      onAmountChange(share.employeeId, newAmount);
                    }}
                    onBlur={onBlur}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        onBlur();
                      }
                    }}
                    autoFocus
                    className="text-right w-24 sm:w-32 ml-auto h-9 text-[14px] bg-muted/30 border-border/40 rounded-lg"
                  />
                ) : (
                  <button
                    onClick={() => onEdit(share.employeeId)}
                    className="text-[14px] font-semibold hover:text-foreground/70 transition-colors text-right w-full"
                    aria-label={`Edit tip amount for ${share.name}`}
                  >
                    {formatCurrencyFromCents(share.amountCents)}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
```

- [ ] **Step 5: Add the advisory notes**

In `src/components/tips/TipReviewScreen.tsx`, insert directly above the `{/* Balance Indicator */}` block (line 144), inside the same container:

```tsx
        {scaledDownFactor !== null && (
          <div className="flex items-center gap-2 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20">
            <AlertTriangle className="h-4 w-4 text-amber-600 flex-shrink-0" />
            <span className="text-[13px] text-amber-600">
              Guarantees totalled more than the pool and were reduced proportionally.
            </span>
          </div>
        )}
        {redistributedLeftoverCents > 0 && (
          <div className="flex items-center gap-2 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20">
            <AlertTriangle className="h-4 w-4 text-amber-600 flex-shrink-0" />
            <span className="text-[13px] text-amber-600">
              {`No hourly staff worked; the remaining ${formatCurrencyFromCents(redistributedLeftoverCents)} was split across the fixed percentages.`}
            </span>
          </div>
        )}
```

Neither blocks approval — the Approve button's `disabled` condition on line 167 stays untouched.

- [ ] **Step 6: Pass the flags from the page**

In `src/pages/Tips.tsx`, add to the `<TipReviewScreen>` element (after `poolResults={...}`, line 752):

```tsx
          scaledDownFactor={isPercentageContribution ? null : guaranteedResult.scaledDownFactor}
          redistributedLeftoverCents={isPercentageContribution ? 0 : guaranteedResult.redistributedLeftoverCents}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run:

```bash
npm run test -- tests/unit/TipReviewScreen.guarantees.test.tsx tests/unit/TipDistribution.test.tsx && npm run typecheck
```

Expected: PASS, typecheck exit 0.

- [ ] **Step 8: Commit**

```bash
git add src/components/tips/TipReviewScreen.tsx src/pages/Tips.tsx tests/unit/TipReviewScreen.guarantees.test.tsx
git commit -m "feat(tips): show percentage of pool and guarantee badges on the review screen"
```

---

### Task 7: Persist the applied rule and cover the flow end to end

**Files:**
- Modify: `src/hooks/useTipSplits.tsx:23-33` (`TipSplitItem`), `src/hooks/useTipSplits.tsx:176-192` (`insertSplitItems`)
- Test: `tests/unit/useTipSplits.appliedRule.test.ts`, `tests/e2e/tip-sharing.spec.ts`

**Interfaces:**
- Consumes: `TipShare.appliedRule` (Task 2), the `applied_rule` column (Task 1).
- Produces: nothing downstream — this column is written for audit and is not read back for display.

- [ ] **Step 1: Write the failing unit test**

Create `tests/unit/useTipSplits.appliedRule.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildSplitItemRows } from '@/hooks/useTipSplits';
import type { TipShare } from '@/utils/tipPooling';

describe('buildSplitItemRows', () => {
  it('persists the applied rule when one was in force', () => {
    const shares: TipShare[] = [
      {
        employeeId: 'e1',
        name: 'Manager Mo',
        hours: 2,
        role: 'Manager',
        amountCents: 3000,
        appliedRule: { mode: 'at_least', percentage: 30 },
      },
    ];

    expect(buildSplitItemRows('split-1', shares)).toEqual([
      {
        tip_split_id: 'split-1',
        employee_id: 'e1',
        amount: 3000,
        hours_worked: 2,
        role: 'Manager',
        role_weight: null,
        manually_edited: false,
        applied_rule: { mode: 'at_least', percentage: 30 },
      },
    ]);
  });

  it('writes null when no rule applied', () => {
    const shares: TipShare[] = [
      { employeeId: 'e2', name: 'Server Sam', hours: 8, role: 'Server', amountCents: 7000 },
    ];

    expect(buildSplitItemRows('split-1', shares)[0].applied_rule).toBeNull();
  });

  it('normalises missing hours and role to null', () => {
    const shares: TipShare[] = [{ employeeId: 'e3', name: 'Even Eve', amountCents: 100 }];
    const row = buildSplitItemRows('split-1', shares)[0];

    expect(row.hours_worked).toBeNull();
    expect(row.role).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npm run test -- tests/unit/useTipSplits.appliedRule.test.ts
```

Expected: FAIL — `buildSplitItemRows` is not exported.

- [ ] **Step 3: Extract and extend the row builder**

In `src/hooks/useTipSplits.tsx`, add `applied_rule` to `TipSplitItem` (after line 30):

```ts
  manually_edited: boolean;
  applied_rule: RoleAllocationRule | null;
```

and add the type import next to the existing imports:

```ts
import type { RoleAllocationRule, TipShare } from '@/utils/tipPooling';
```

Add the exported pure builder just above the hook (module scope, so it is unit-testable without a Supabase client):

```ts
/**
 * Build the tip_split_items rows for a set of shares.
 *
 * `applied_rule` is an audit record of why an employee received what they did —
 * it is written but never read back for display, because resuming a draft
 * re-derives amounts from current settings.
 */
export function buildSplitItemRows(splitId: string, shares: TipShare[]) {
  return shares.map(share => ({
    tip_split_id: splitId,
    employee_id: share.employeeId,
    amount: share.amountCents,
    hours_worked: share.hours ?? null,
    role: share.role ?? null,
    role_weight: null,
    manually_edited: false,
    applied_rule: share.appliedRule ?? null,
  }));
}
```

Replace the body of `insertSplitItems` (lines 177-185) so it delegates:

```ts
  const insertSplitItems = async (splitId: string, input: CreateTipSplitInput): Promise<void> => {
    const items = buildSplitItemRows(splitId, input.shares);

    const { error: itemsError } = await supabase
      .from('tip_split_items')
      .insert(items);

    if (itemsError) throw itemsError;
  };
```

Note the behaviour change this makes explicit: `hours_worked` and `role` were previously `share.hours || null` and `share.role || null`, which turned a genuine `0` hours into `null`. `?? null` preserves `0`. The third unit test above pins the new behaviour.

- [ ] **Step 4: Run the tests to verify they pass**

Run:

```bash
npm run test -- tests/unit/useTipSplits.appliedRule.test.ts tests/unit/useTipSplits.reopenSplit.test.tsx && npm run typecheck
```

Expected: PASS, typecheck exit 0.

- [ ] **Step 5: Add the E2E case**

Append to `tests/e2e/tip-sharing.spec.ts`, following the file's existing setup helpers and login flow:

```ts
test('a guaranteed role receives at least its configured percentage', async ({ page }) => {
  await page.goto('/tips');

  // Configure Manager at "at least 30%".
  await page.getByRole('button', { name: 'Setup' }).click();
  const managerMode = page.getByLabel('Manager allocation mode');
  await managerMode.getByRole('radio', { name: 'Manager: at least a set percentage' }).click();
  await page.getByLabel('Manager percentage').fill('30');
  await page.getByRole('button', { name: /close|done/i }).first().click();

  // Enter a tip amount and hours that would otherwise put the manager well below 30%.
  await page.getByLabel('Tip amount').fill('100');
  await page.getByLabel(/Manager/).fill('1');
  await page.getByLabel(/Server/).fill('9');

  // The entry screen shows the guarantee and the resulting percentage.
  await expect(page.getByText('Guaranteed 30%')).toBeVisible();
  await expect(page.getByText('30.0% · $30.00')).toBeVisible();

  // Review carries the same figure through.
  await expect(page.getByRole('cell', { name: '30.0%' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Edit tip amount for .*Manager/ })).toContainText('$30.00');
});
```

Adjust the selectors for employee names and the tip-amount entry to match the fixtures the rest of the file already creates via `generateTestUser()` — the assertions on `Guaranteed 30%`, `30.0% · $30.00`, and the review cell are what matter.

- [ ] **Step 6: Run the full check**

Run:

```bash
npm run typecheck && npm run lint && npm run test
```

Expected: all green. Then:

```bash
npm run test:e2e -- tests/e2e/tip-sharing.spec.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/hooks/useTipSplits.tsx tests/unit/useTipSplits.appliedRule.test.ts tests/e2e/tip-sharing.spec.ts
git commit -m "feat(tips): persist the applied allocation rule per split item"
```

---

## Verification

After Task 7, confirm the whole feature from a clean state:

```bash
npm run db:reset && npm run test:all
```

Expected: unit, pgTAP, and E2E suites all pass.

Manual smoke, in the dev server:

1. Tips → Setup → Role Allocation → set Manager to **At least** `30`. Confirm the footer reads "30% per person on these roles" and no save button is needed.
2. Enter a $100 tip, 1 hour for the manager and 9 for a server. The manager's row reads `30.0% · $30.00 ↑` with a `Guaranteed 30%` badge; the server reads `70.0% · $70.00`.
3. Continue to review. The **% of pool** column reads 30.0% / 70.0%, the badge carries over, and Approve is enabled.
4. Set Manager to **Exactly** `120` across two managers, enter hours, and confirm the amber "reduced proportionally" advisory appears and Approve still works.
5. Narrow the window below 640px on the review screen and confirm the table scrolls rather than crushing, and the Hours column is hidden.
