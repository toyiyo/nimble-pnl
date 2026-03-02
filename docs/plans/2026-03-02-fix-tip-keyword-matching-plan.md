# Fix Tip Keyword Matching Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix false-positive tip classification across all 7 locations and add tip source breakdown to dashboard surfaces.

**Architecture:** Replace all `.includes('tip')` / `LIKE '%tip%'` substring matching on account names with word-boundary regex. Tighten subtype matching to exact `=== 'tips'`. Expose existing `tip_categories` and `adjustments` data in Monthly Breakdown Table and P&L Intelligence Report.

**Tech Stack:** TypeScript (React hooks, Deno edge functions), PostgreSQL (SQL migrations), Vitest (unit tests), pgTAP (SQL tests)

---

### Task 1: Create worktree and branch with existing changes

**Files:**
- All 5 modified/new files from main working tree

**Step 1: Create worktree from main**

```bash
cd /Users/josedelgado/Documents/GitHub/nimble-pnl
git worktree add .claude/worktrees/fix-tip-matching -b fix/tip-keyword-matching HEAD
```

**Step 2: Copy staged changes into worktree**

```bash
cd /Users/josedelgado/Documents/GitHub/nimble-pnl
git diff HEAD -- src/hooks/useMonthlyMetrics.tsx src/hooks/useRevenueBreakdown.tsx src/hooks/utils/passThroughAdjustments.ts tests/unit/passThroughAdjustments.test.ts | git -C .claude/worktrees/fix-tip-matching apply -
cp supabase/migrations/20260302120000_fix_monthly_tip_keyword_matching.sql .claude/worktrees/fix-tip-matching/supabase/migrations/
```

**Step 3: Commit the user's existing changes**

```bash
cd /Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/fix-tip-matching
git add src/hooks/useMonthlyMetrics.tsx src/hooks/useRevenueBreakdown.tsx src/hooks/utils/passThroughAdjustments.ts tests/unit/passThroughAdjustments.test.ts supabase/migrations/20260302120000_fix_monthly_tip_keyword_matching.sql
git commit -m "fix: use word-boundary regex for tip keyword matching in client hooks and SQL

Replace .includes('tip') and LIKE '%tip%' with hasTipKeyword() regex to prevent
false positives (e.g. 'Stipend Liability' being classified as tips).

Fixes: useMonthlyMetrics, useRevenueBreakdown, passThroughAdjustments, get_monthly_sales_metrics SQL"
```

---

### Task 2: Tighten subtype matching to exact `=== 'tips'`

**Files:**
- Modify: `src/hooks/useMonthlyMetrics.tsx:291`
- Modify: `src/hooks/utils/passThroughAdjustments.ts:89`
- Modify: `supabase/migrations/20260302120000_fix_monthly_tip_keyword_matching.sql:59,82`

**Step 1: Write failing test for subtype false positive**

Add to `tests/unit/passThroughAdjustments.test.ts` inside `describe('chart_account based classification')`:

```typescript
it('does not classify liability with subtype containing "tip" substring as tips', () => {
  const item = createRow({
    is_categorized: true,
    chart_account: {
      account_type: 'liability',
      account_subtype: 'other_tip_related',
      account_name: 'Some Liability',
    },
  });
  // subtype.includes('tip') would match this, but exact match should not
  expect(classifyPassThroughItem(item)).toBe('other');
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/fix-tip-matching && npx vitest run tests/unit/passThroughAdjustments.test.ts --reporter verbose`

Expected: FAIL — `classifyPassThroughItem` returns `'tip'` because `subtype.includes('tip')` matches `'other_tip_related'`.

**Step 3: Fix passThroughAdjustments.ts**

In `src/hooks/utils/passThroughAdjustments.ts:89`, change:
```typescript
// OLD
if (subtype.includes('tip') || subtype === 'tips' || hasTipKeyword(accountName)) {

// NEW
if (subtype === 'tips' || subtype === 'tips_payable' || hasTipKeyword(accountName)) {
```

**Step 4: Fix useMonthlyMetrics.tsx**

In `src/hooks/useMonthlyMetrics.tsx:291`, change:
```typescript
// OLD
} else if (subtype.includes('tip') || hasTipKeyword(accountName)) {

// NEW
} else if (subtype === 'tips' || subtype === 'tips_payable' || hasTipKeyword(accountName)) {
```

**Step 5: Fix SQL migration**

In `supabase/migrations/20260302120000_fix_monthly_tip_keyword_matching.sql`, change both CASE blocks (lines 59 and 82) from:
```sql
WHEN LOWER(COALESCE(coa.account_subtype::TEXT, '')) LIKE '%tip%'
```
to:
```sql
WHEN LOWER(COALESCE(coa.account_subtype::TEXT, '')) IN ('tips', 'tips_payable')
```

**Step 6: Run tests to verify they pass**

Run: `cd /Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/fix-tip-matching && npx vitest run tests/unit/passThroughAdjustments.test.ts --reporter verbose`

Expected: ALL PASS

**Step 7: Commit**

```bash
git add src/hooks/utils/passThroughAdjustments.ts src/hooks/useMonthlyMetrics.tsx supabase/migrations/20260302120000_fix_monthly_tip_keyword_matching.sql tests/unit/passThroughAdjustments.test.ts
git commit -m "fix: tighten subtype matching from includes('tip') to exact match"
```

---

### Task 3: Fix edge function monthlyMetrics.ts

**Files:**
- Modify: `supabase/functions/_shared/monthlyMetrics.ts:68`

**Step 1: Add hasTipKeyword function and fix the matching**

At the top of `supabase/functions/_shared/monthlyMetrics.ts` (after imports), add:
```typescript
const hasTipKeyword = (value: string) => /(^|[^a-z])(?:tip|tips|gratuity)([^a-z]|$)/i.test(value);
```

Change line 68 from:
```typescript
if (subtype.includes('tip') || accountName.includes('tip')) {
```
to:
```typescript
if (subtype === 'tips' || subtype === 'tips_payable' || hasTipKeyword(accountName)) {
```

**Step 2: Commit**

```bash
git add supabase/functions/_shared/monthlyMetrics.ts
git commit -m "fix: use hasTipKeyword in edge function monthlyMetrics.ts"
```

---

### Task 4: Fix edge function periodMetrics.ts

**Files:**
- Modify: `supabase/functions/_shared/periodMetrics.ts:116-119`

**Step 1: Add hasTipKeyword and fix isTipAccount**

Add hasTipKeyword before the `isTipAccount` function:
```typescript
const hasTipKeyword = (value: string) => /(^|[^a-z])(?:tip|tips|gratuity)([^a-z]|$)/i.test(value);
```

Change `isTipAccount` (line 116-119) from:
```typescript
function isTipAccount(account: { account_type: string; account_subtype: string | null }): boolean {
  const subtype = (account.account_subtype || '').toLowerCase();
  return account.account_type === 'liability' && subtype.includes('tip');
}
```
to:
```typescript
function isTipAccount(account: { account_type: string; account_subtype: string | null; account_name?: string | null }): boolean {
  const subtype = (account.account_subtype || '').toLowerCase();
  const name = (account.account_name || '').toLowerCase();
  return account.account_type === 'liability' && (subtype === 'tips' || subtype === 'tips_payable' || hasTipKeyword(name));
}
```

Note: Check if `account_name` is available where `isTipAccount` is called. If not, the subtype-only fix is sufficient since the function only checks subtype today.

**Step 2: Commit**

```bash
git add supabase/functions/_shared/periodMetrics.ts
git commit -m "fix: use exact subtype match + hasTipKeyword in periodMetrics.ts"
```

---

### Task 5: Fix get_pos_tips_by_date SQL function

**Files:**
- Create: `supabase/migrations/20260302120001_fix_pos_tips_keyword_matching.sql`

**Step 1: Write the migration**

Create `supabase/migrations/20260302120001_fix_pos_tips_keyword_matching.sql`:

```sql
-- Migration: tighten tip matching in get_pos_tips_by_date to avoid false positives
-- Same fix as get_monthly_sales_metrics: use word-boundary regex on account_name
-- and exact match on account_subtype

CREATE OR REPLACE FUNCTION get_pos_tips_by_date(
  p_restaurant_id UUID,
  p_start_date DATE,
  p_end_date DATE
)
RETURNS TABLE (
  tip_date DATE,
  total_amount_cents INTEGER,
  transaction_count INTEGER,
  pos_source TEXT
)
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
BEGIN
  -- Authorization check
  IF NOT EXISTS (
    SELECT 1 FROM user_restaurants
    WHERE restaurant_id = p_restaurant_id
    AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Access denied: User does not have access to restaurant %', p_restaurant_id;
  END IF;

  RETURN QUERY
  WITH categorized_tips AS (
    SELECT
      us.sale_date AS t_date,
      SUM(uss.amount * 100)::INTEGER AS t_cents,
      COUNT(DISTINCT us.external_order_id)::INTEGER AS t_count,
      us.pos_system AS t_source
    FROM unified_sales us
    INNER JOIN unified_sales_splits uss ON us.id = uss.sale_id
    INNER JOIN chart_of_accounts coa ON uss.category_id = coa.id
    WHERE us.restaurant_id = p_restaurant_id
      AND us.sale_date >= p_start_date
      AND us.sale_date <= p_end_date
      AND (
        LOWER(COALESCE(coa.account_subtype::TEXT, '')) IN ('tips', 'tips_payable')
        OR LOWER(COALESCE(coa.account_name, '')) ~ '(^|[^a-z])(tip|tips|gratuity)([^a-z]|$)'
      )
    GROUP BY us.sale_date, us.pos_system
  ),
  uncategorized_tips AS (
    SELECT
      us.sale_date AS t_date,
      SUM(COALESCE(us.total_price, us.unit_price * us.quantity, 0) * 100)::INTEGER AS t_cents,
      COUNT(DISTINCT us.external_order_id)::INTEGER AS t_count,
      us.pos_system AS t_source
    FROM unified_sales us
    WHERE us.restaurant_id = p_restaurant_id
      AND us.sale_date >= p_start_date
      AND us.sale_date <= p_end_date
      AND (us.item_type = 'tip' OR us.adjustment_type = 'tip')
      AND NOT EXISTS (
        SELECT 1 FROM unified_sales_splits uss
        INNER JOIN chart_of_accounts coa ON uss.category_id = coa.id
        WHERE uss.sale_id = us.id
        AND (
          LOWER(COALESCE(coa.account_subtype::TEXT, '')) IN ('tips', 'tips_payable')
          OR LOWER(COALESCE(coa.account_name, '')) ~ '(^|[^a-z])(tip|tips|gratuity)([^a-z]|$)'
        )
      )
    GROUP BY us.sale_date, us.pos_system
  ),
  combined_tips AS (
    SELECT t_date, t_cents, t_count, t_source FROM categorized_tips
    UNION ALL
    SELECT t_date, t_cents, t_count, t_source FROM uncategorized_tips
  )
  SELECT
    ct.t_date,
    SUM(ct.t_cents)::INTEGER,
    SUM(ct.t_count)::INTEGER,
    ct.t_source
  FROM combined_tips ct
  GROUP BY ct.t_date, ct.t_source
  ORDER BY ct.t_date DESC;
END;
$$;

COMMENT ON FUNCTION get_pos_tips_by_date IS
'Aggregates POS tips from both categorized (unified_sales_splits) and uncategorized (unified_sales) sources.
Uses word-boundary regex on account_name and exact match on account_subtype to avoid false positives.
Used by tip pooling system to display POS-imported tips.';
```

**Step 2: Commit**

```bash
git add supabase/migrations/20260302120001_fix_pos_tips_keyword_matching.sql
git commit -m "fix: tighten tip matching in get_pos_tips_by_date SQL function"
```

---

### Task 6: Add comprehensive unit tests for hasTipKeyword

**Files:**
- Modify: `tests/unit/passThroughAdjustments.test.ts`

**Step 1: Add edge case tests**

Add a new `describe('tip keyword matching edge cases')` block inside `describe('chart_account based classification')`:

```typescript
it('classifies "Tip - CREDIT" as tip (Toast POS format)', () => {
  const item = createRow({
    is_categorized: true,
    chart_account: {
      account_type: 'liability',
      account_subtype: 'other_current_liability',
      account_name: 'Tip - CREDIT',
    },
  });
  expect(classifyPassThroughItem(item)).toBe('tip');
});

it('classifies "Gratuity Collected" as tip', () => {
  const item = createRow({
    is_categorized: true,
    chart_account: {
      account_type: 'liability',
      account_subtype: 'other_current_liability',
      account_name: 'Gratuity Collected',
    },
  });
  expect(classifyPassThroughItem(item)).toBe('tip');
});

it('does not classify "Participation Fee" as tip', () => {
  const item = createRow({
    is_categorized: true,
    chart_account: {
      account_type: 'liability',
      account_subtype: 'other_current_liability',
      account_name: 'Participation Fee',
    },
  });
  expect(classifyPassThroughItem(item)).toBe('other');
});

it('does not classify "Anticipation Reserve" as tip', () => {
  const item = createRow({
    is_categorized: true,
    chart_account: {
      account_type: 'liability',
      account_subtype: 'other_current_liability',
      account_name: 'Anticipation Reserve',
    },
  });
  expect(classifyPassThroughItem(item)).toBe('other');
});

it('classifies account with subtype "tips" exactly', () => {
  const item = createRow({
    is_categorized: true,
    chart_account: {
      account_type: 'liability',
      account_subtype: 'tips',
      account_name: 'General Liability',
    },
  });
  expect(classifyPassThroughItem(item)).toBe('tip');
});

it('classifies account with subtype "tips_payable" exactly', () => {
  const item = createRow({
    is_categorized: true,
    chart_account: {
      account_type: 'liability',
      account_subtype: 'tips_payable',
      account_name: 'Tips Payable',
    },
  });
  expect(classifyPassThroughItem(item)).toBe('tip');
});
```

**Step 2: Run all tests**

Run: `cd /Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/fix-tip-matching && npx vitest run tests/unit/passThroughAdjustments.test.ts --reporter verbose`

Expected: ALL PASS

**Step 3: Commit**

```bash
git add tests/unit/passThroughAdjustments.test.ts
git commit -m "test: add edge case tests for tip keyword matching"
```

---

### Task 7: Add pgTAP tests for SQL tip matching

**Files:**
- Create: `supabase/tests/tip_keyword_matching.sql`

**Step 1: Write the pgTAP test**

```sql
BEGIN;
SELECT plan(6);

-- Test 1: Verify get_monthly_sales_metrics function exists
SELECT has_function(
  'public',
  'get_monthly_sales_metrics',
  ARRAY['uuid', 'date', 'date'],
  'get_monthly_sales_metrics function exists'
);

-- Test 2: Verify get_pos_tips_by_date function exists
SELECT has_function(
  'public',
  'get_pos_tips_by_date',
  ARRAY['uuid', 'date', 'date'],
  'get_pos_tips_by_date function exists'
);

-- Test 3: Verify regex matches "Tips Payable" (word boundary)
SELECT ok(
  'tips payable' ~ '(^|[^a-z])(tip|tips|gratuity)([^a-z]|$)',
  'Regex matches "tips payable"'
);

-- Test 4: Verify regex matches "Tip - CREDIT" (word boundary)
SELECT ok(
  'tip - credit' ~ '(^|[^a-z])(tip|tips|gratuity)([^a-z]|$)',
  'Regex matches "tip - credit"'
);

-- Test 5: Verify regex does NOT match "Stipend Liability" (false positive)
SELECT ok(
  NOT ('stipend liability' ~ '(^|[^a-z])(tip|tips|gratuity)([^a-z]|$)'),
  'Regex does NOT match "stipend liability"'
);

-- Test 6: Verify regex does NOT match "Participation Fee" (false positive)
SELECT ok(
  NOT ('participation fee' ~ '(^|[^a-z])(tip|tips|gratuity)([^a-z]|$)'),
  'Regex does NOT match "participation fee"'
);

SELECT * FROM finish();
ROLLBACK;
```

**Step 2: Run pgTAP tests (if local Supabase is available)**

Run: `cd /Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/fix-tip-matching && npm run test:db`

Expected: ALL PASS

**Step 3: Commit**

```bash
git add supabase/tests/tip_keyword_matching.sql
git commit -m "test: add pgTAP tests for SQL tip keyword regex matching"
```

---

### Task 8: Add tip source breakdown to Monthly Breakdown Table

**Files:**
- Modify: `src/components/MonthlyBreakdownTable.tsx:631-643`

**Step 1: Replace the single "Tips Collected" row with source breakdown**

Change the tips section (lines 631-643) from:
```tsx
{breakdown.totals.tips > 0 && (
  <div className="flex items-center justify-between p-2 rounded bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 text-xs">
    <div className="flex items-center gap-2">
      <span className="font-medium">Tips Collected</span>
      <Badge variant="outline" className="text-[9px] px-1.5 py-0 text-blue-600">
        Liability
      </Badge>
    </div>
    <span className="font-semibold text-blue-700">
      {formatCurrency(breakdown.totals.tips)}
    </span>
  </div>
)}
```

to:
```tsx
{breakdown.totals.tips > 0 && (
  <div className="space-y-1">
    <div className="flex items-center justify-between p-2 rounded bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 text-xs">
      <div className="flex items-center gap-2">
        <span className="font-medium">Tips Collected</span>
        <Badge variant="outline" className="text-[9px] px-1.5 py-0 text-blue-600">
          Liability
        </Badge>
      </div>
      <span className="font-semibold text-blue-700">
        {formatCurrency(breakdown.totals.tips)}
      </span>
    </div>
    {/* Tip source breakdown sub-rows */}
    {(breakdown.tip_categories?.length > 0 || breakdown.adjustments?.some(a => a.adjustment_type === 'tip')) && (
      <div className="ml-4 space-y-0.5">
        {breakdown.tip_categories?.map((category) => (
          <div key={category.account_id} className="flex items-center justify-between px-2 py-1 text-[11px] text-muted-foreground">
            <span>{category.account_name}</span>
            <span>{formatCurrency(category.total_amount)}</span>
          </div>
        ))}
        {breakdown.adjustments?.filter(a => a.adjustment_type === 'tip').map((adj, idx) => (
          <div key={`adj-tip-${idx}`} className="flex items-center justify-between px-2 py-1 text-[11px] text-muted-foreground">
            <span>POS Tip Adjustments</span>
            <span>{formatCurrency(adj.total_amount)}</span>
          </div>
        ))}
      </div>
    )}
  </div>
)}
```

**Step 2: Verify build compiles**

Run: `cd /Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/fix-tip-matching && npx tsc --noEmit --skipLibCheck 2>&1 | head -20`

Expected: No errors in MonthlyBreakdownTable.tsx

**Step 3: Commit**

```bash
git add src/components/MonthlyBreakdownTable.tsx
git commit -m "feat: add tip source breakdown to Monthly Breakdown Table"
```

---

### Task 9: Add tip source breakdown to P&L Intelligence Report

**Files:**
- Modify: `src/components/PnLIntelligenceReport.tsx:633-641`

**Step 1: Add source breakdown sub-text under the tip total**

Change the tips display (lines 633-641) from:
```tsx
{revenueBreakdown.totals.tips > 0 && (
  <div className="p-4 rounded-lg bg-background">
    <p className="text-sm text-muted-foreground mb-1">Tips</p>
    <p className="text-2xl font-bold text-blue-700 dark:text-blue-400">
      ${revenueBreakdown.totals.tips.toLocaleString()}
    </p>
    <Badge variant="outline" className="mt-2 text-xs">Liability</Badge>
  </div>
)}
```

to:
```tsx
{revenueBreakdown.totals.tips > 0 && (
  <div className="p-4 rounded-lg bg-background">
    <p className="text-sm text-muted-foreground mb-1">Tips</p>
    <p className="text-2xl font-bold text-blue-700 dark:text-blue-400">
      ${revenueBreakdown.totals.tips.toLocaleString()}
    </p>
    <Badge variant="outline" className="mt-2 text-xs">Liability</Badge>
    {/* Source breakdown */}
    {(revenueBreakdown.tip_categories?.length > 0 || revenueBreakdown.adjustments?.some(a => a.adjustment_type === 'tip')) && (
      <div className="mt-2 space-y-0.5 text-[11px] text-muted-foreground">
        {revenueBreakdown.tip_categories?.map((cat) => (
          <div key={cat.account_id} className="flex justify-between">
            <span>{cat.account_name}</span>
            <span>${cat.total_amount.toLocaleString()}</span>
          </div>
        ))}
        {revenueBreakdown.adjustments?.filter(a => a.adjustment_type === 'tip').map((adj, idx) => (
          <div key={`adj-${idx}`} className="flex justify-between">
            <span>POS Tip Adjustments</span>
            <span>${adj.total_amount.toLocaleString()}</span>
          </div>
        ))}
      </div>
    )}
  </div>
)}
```

**Step 2: Verify build compiles**

Run: `cd /Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/fix-tip-matching && npx tsc --noEmit --skipLibCheck 2>&1 | head -20`

Expected: No errors

**Step 3: Commit**

```bash
git add src/components/PnLIntelligenceReport.tsx
git commit -m "feat: add tip source breakdown to P&L Intelligence Report"
```

---

### Task 10: Full verification

**Step 1: Run all unit tests**

Run: `cd /Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/fix-tip-matching && npx vitest run --reporter verbose`

Expected: ALL PASS

**Step 2: Run lint**

Run: `cd /Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/fix-tip-matching && npm run lint 2>&1 | tail -5`

Expected: No new errors introduced

**Step 3: Run build**

Run: `cd /Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/fix-tip-matching && npm run build`

Expected: Build succeeds

**Step 4: Run pgTAP tests (if local DB available)**

Run: `cd /Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/fix-tip-matching && npm run test:db`

Expected: ALL PASS
