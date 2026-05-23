# Optional category on check creation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users optionally pick a chart-of-accounts category when creating a check, so the resulting expense lands categorized without a second screen.

**Architecture:** Reuse the existing `pending_outflows.category_id` column and `SearchableAccountSelector` component on two surfaces (`PrintChecks.tsx` batch table, `PrintCheckButton.tsx` per-expense dialog). Add a same-restaurant integrity trigger and a partial index on the DB side. No new RPCs, no schema changes other than the trigger + index.

**Tech Stack:** React 18 + TypeScript, Vite, shadcn/ui (Popover/Command/Dialog/Table), Vitest + @testing-library/react, PostgreSQL with pgTAP for DB tests.

**Spec:** `docs/superpowers/specs/2026-05-22-check-create-with-category-design.md`

---

## File Structure

**Create:**
- `supabase/migrations/20260522120000_pending_outflows_category_same_restaurant.sql`
- `supabase/migrations/20260522120100_pending_outflows_category_index.sql`
- `supabase/tests/pending_outflows_category_same_restaurant.test.sql`
- `tests/unit/SearchableAccountSelector.ariaLabel.test.tsx`
- `tests/unit/PrintChecksCategoryColumn.test.tsx`
- `tests/unit/PrintCheckButtonCategory.test.tsx`

**Modify:**
- `src/components/banking/SearchableAccountSelector.tsx` (add `triggerAriaLabel` prop, `collisionPadding`, remove `console.log`s)
- `src/pages/PrintChecks.tsx` (widen `updateRow`, add `categoryId` to `CheckRow`, add Category column, switch to `CheckJob` loop)
- `src/components/pending-outflows/PrintCheckButton.tsx` (add Category field, dialog overflow classes, pass `category_id`)

**Read-only references** (no change, just used in tests):
- `src/hooks/usePendingOutflows.tsx` — already accepts `category_id` in both inputs.
- `src/types/pending-outflows.ts` — input types already correct.

---

## Task 1 — `SearchableAccountSelector`: add `triggerAriaLabel`, `collisionPadding`, clean up logs

**Files:**
- Modify: `src/components/banking/SearchableAccountSelector.tsx`
- Create: `tests/unit/SearchableAccountSelector.ariaLabel.test.tsx`

### Step 1.1 — Write the failing test

Create `tests/unit/SearchableAccountSelector.ariaLabel.test.tsx`:

```tsx
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SearchableAccountSelector } from '@/components/banking/SearchableAccountSelector';

vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => ({
    selectedRestaurant: { restaurant_id: 'rest-1' },
  }),
}));

vi.mock('@/hooks/useChartOfAccounts', () => ({
  useChartOfAccounts: () => ({
    accounts: [
      {
        id: 'acc-1',
        restaurant_id: 'rest-1',
        account_code: '5000',
        account_name: 'Food Costs',
        account_type: 'cogs',
        account_subtype: 'food',
        parent_account_id: null,
        is_active: true,
      },
    ],
    loading: false,
  }),
}));

describe('SearchableAccountSelector — triggerAriaLabel', () => {
  it('forwards triggerAriaLabel to the combobox button when provided', () => {
    render(
      <SearchableAccountSelector
        onValueChange={() => {}}
        triggerAriaLabel="Category for check row 1"
      />,
    );
    const combo = screen.getByRole('combobox', {
      name: 'Category for check row 1',
    });
    expect(combo).toBeInTheDocument();
  });

  it('omits aria-label when prop is not provided (default behaviour unchanged)', () => {
    render(<SearchableAccountSelector onValueChange={() => {}} />);
    const combo = screen.getByRole('combobox');
    expect(combo.getAttribute('aria-label')).toBeNull();
  });
});
```

### Step 1.2 — Run test, confirm RED

```bash
npm run test -- tests/unit/SearchableAccountSelector.ariaLabel.test.tsx
```

Expected: FAIL on the first test (prop is ignored, `combobox` has no accessible name "Category for check row 1").

### Step 1.3 — Add the prop, `collisionPadding`, and remove logs

Edit `src/components/banking/SearchableAccountSelector.tsx`:

1. Widen the prop interface:

```ts
interface SearchableAccountSelectorProps {
  value?: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  filterByTypes?: string[];
  autoOpen?: boolean;
  triggerAriaLabel?: string;   // NEW
}
```

2. Destructure it in the function signature:

```ts
export function SearchableAccountSelector({
  value,
  onValueChange,
  placeholder = "Select account",
  disabled = false,
  filterByTypes,
  autoOpen = false,
  triggerAriaLabel,   // NEW
}: SearchableAccountSelectorProps) {
```

3. Forward it to the trigger button (around line 108):

```tsx
<Button
  variant="outline"
  role="combobox"
  aria-expanded={open}
  aria-busy={loading}
  aria-label={triggerAriaLabel}   // NEW
  className="w-full justify-between"
  disabled={isDisabled}
>
```

4. Add `collisionPadding` on the popover content (around line 134):

```tsx
<PopoverContent
  className="w-[350px] p-0 bg-background z-50"
  align="start"
  collisionPadding={8}   // NEW
  onWheel={(e) => e.stopPropagation()}
  onTouchMove={(e) => e.stopPropagation()}
>
```

5. Delete the two `console.log` calls in the `organizedAccounts` memo (lines 70–71 of the current file):

```ts
// REMOVE these two lines:
console.log('[SearchableAccountSelector] Filtered accounts:', filteredAccounts);
console.log('[SearchableAccountSelector] Filter types:', filterByTypes);
```

### Step 1.4 — Run test, confirm GREEN

```bash
npm run test -- tests/unit/SearchableAccountSelector.ariaLabel.test.tsx
```

Expected: Both tests PASS.

### Step 1.5 — Commit

```bash
git add src/components/banking/SearchableAccountSelector.tsx tests/unit/SearchableAccountSelector.ariaLabel.test.tsx
git commit -m "feat(account-selector): add triggerAriaLabel + collisionPadding, drop dev logs

Preparing the shared category picker for use inside batch tables and
narrow dialogs where the trigger needs a per-row accessible name and the
popover must not clip on small viewports."
```

---

## Task 2 — Migration A: same-restaurant trigger on `pending_outflows.category_id`

**Files:**
- Create: `supabase/migrations/20260522120000_pending_outflows_category_same_restaurant.sql`
- Create: `supabase/tests/pending_outflows_category_same_restaurant.test.sql`

### Step 2.1 — Write the failing pgTAP test

Create `supabase/tests/pending_outflows_category_same_restaurant.test.sql`:

```sql
-- pgTAP tests for the same-restaurant guard on pending_outflows.category_id.
--
-- Pinning: writing a pending_outflows row whose category_id resolves to a
-- chart_of_accounts row in a different restaurant must fail with SQLSTATE
-- 23503 (foreign_key_violation), both on INSERT and on UPDATE.

BEGIN;
SELECT plan(7);

-- Fixture: two restaurants, each with its own chart-of-accounts row.
INSERT INTO public.restaurants (id, name)
VALUES
  ('00000000-0000-0000-0000-000000000a01', 'Test Restaurant A'),
  ('00000000-0000-0000-0000-000000000a02', 'Test Restaurant B')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.chart_of_accounts
  (id, restaurant_id, account_code, account_name, account_type, normal_balance)
VALUES
  ('00000000-0000-0000-0000-000000000b01',
   '00000000-0000-0000-0000-000000000a01',
   '5100', 'Test Food Costs A', 'cogs', 'debit'),
  ('00000000-0000-0000-0000-000000000b02',
   '00000000-0000-0000-0000-000000000a02',
   '5100', 'Test Food Costs B', 'cogs', 'debit')
ON CONFLICT (id) DO NOTHING;

-- 1. Trigger function exists.
SELECT has_function(
  'public',
  'assert_pending_outflow_category_same_restaurant',
  'trigger function exists'
);

-- 2. Trigger is wired up on pending_outflows.
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'pending_outflows_category_same_restaurant'
      AND tgrelid = 'public.pending_outflows'::regclass
  ),
  'trigger is attached to pending_outflows'
);

-- 3. Insert with a same-restaurant category succeeds.
SELECT lives_ok(
  $$
    INSERT INTO public.pending_outflows (
      restaurant_id, vendor_name, category_id, payment_method,
      amount, issue_date
    )
    VALUES (
      '00000000-0000-0000-0000-000000000a01',
      'Same-Restaurant Vendor',
      '00000000-0000-0000-0000-000000000b01',
      'check',
      100.00,
      CURRENT_DATE
    );
  $$,
  'insert with same-restaurant category succeeds'
);

-- 4. Insert with a cross-restaurant category fails with 23503.
SELECT throws_ok(
  $$
    INSERT INTO public.pending_outflows (
      restaurant_id, vendor_name, category_id, payment_method,
      amount, issue_date
    )
    VALUES (
      '00000000-0000-0000-0000-000000000a01',
      'Cross-Restaurant Vendor',
      '00000000-0000-0000-0000-000000000b02',
      'check',
      200.00,
      CURRENT_DATE
    );
  $$,
  '23503',
  NULL,
  'cross-restaurant insert raises foreign_key_violation'
);

-- 5. Insert with NULL category_id still works (category is optional).
SELECT lives_ok(
  $$
    INSERT INTO public.pending_outflows (
      restaurant_id, vendor_name, payment_method, amount, issue_date
    )
    VALUES (
      '00000000-0000-0000-0000-000000000a01',
      'Uncategorized Vendor',
      'check',
      300.00,
      CURRENT_DATE
    );
  $$,
  'NULL category_id is still permitted'
);

-- 6. Update from NULL → cross-restaurant category fails with 23503.
SELECT throws_ok(
  $$
    UPDATE public.pending_outflows
       SET category_id = '00000000-0000-0000-0000-000000000b02'
     WHERE vendor_name = 'Uncategorized Vendor'
       AND restaurant_id = '00000000-0000-0000-0000-000000000a01';
  $$,
  '23503',
  NULL,
  'cross-restaurant update raises foreign_key_violation'
);

-- 7. Update to same-restaurant category succeeds.
SELECT lives_ok(
  $$
    UPDATE public.pending_outflows
       SET category_id = '00000000-0000-0000-0000-000000000b01'
     WHERE vendor_name = 'Uncategorized Vendor'
       AND restaurant_id = '00000000-0000-0000-0000-000000000a01';
  $$,
  'same-restaurant update succeeds'
);

SELECT * FROM finish();
ROLLBACK;
```

### Step 2.2 — Run test, confirm RED

```bash
npm run db:reset && npm run test:db -- pending_outflows_category_same_restaurant
```

Expected: tests 1 and 2 (and 4, 6) FAIL because neither the function nor the trigger exists yet. Tests 3, 5, 7 pass-by-accident because no guard is in place.

### Step 2.3 — Write the migration

Create `supabase/migrations/20260522120000_pending_outflows_category_same_restaurant.sql`:

```sql
-- Same-restaurant integrity guard for pending_outflows.category_id.
--
-- The existing FK only enforces that category_id points at SOME chart_of_accounts
-- row. The SELECT RLS on chart_of_accounts hides foreign rows from the UI, but a
-- direct API write supplying a foreign uuid would still pass FK validation.
-- This trigger closes that gap by asserting category and outflow share a
-- restaurant_id at write time.

CREATE OR REPLACE FUNCTION public.assert_pending_outflow_category_same_restaurant()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.category_id IS NOT NULL THEN
    PERFORM 1
      FROM public.chart_of_accounts
     WHERE id = NEW.category_id
       AND restaurant_id = NEW.restaurant_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION
        'pending_outflows.category_id % does not belong to restaurant %',
        NEW.category_id, NEW.restaurant_id
        USING ERRCODE = 'foreign_key_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER pending_outflows_category_same_restaurant
BEFORE INSERT OR UPDATE OF category_id, restaurant_id ON public.pending_outflows
FOR EACH ROW
EXECUTE FUNCTION public.assert_pending_outflow_category_same_restaurant();

COMMENT ON FUNCTION public.assert_pending_outflow_category_same_restaurant() IS
  'Asserts pending_outflows.category_id and restaurant_id refer to the same restaurant. Raises ERRCODE 23503 on mismatch.';
```

### Step 2.4 — Run test, confirm GREEN

```bash
npm run db:reset && npm run test:db -- pending_outflows_category_same_restaurant
```

Expected: All 7 tests PASS.

### Step 2.5 — Commit

```bash
git add supabase/migrations/20260522120000_pending_outflows_category_same_restaurant.sql supabase/tests/pending_outflows_category_same_restaurant.test.sql
git commit -m "feat(db): same-restaurant guard on pending_outflows.category_id

Prevents writes that pair a pending_outflows row in restaurant A with a
chart_of_accounts row in restaurant B — a leak the existing FK alone
does not catch. pgTAP coverage included."
```

---

## Task 3 — Migration B: partial index on `pending_outflows.category_id`

**Files:**
- Create: `supabase/migrations/20260522120100_pending_outflows_category_index.sql`
- Modify: `supabase/tests/pending_outflows_category_same_restaurant.test.sql` (append index assertion — same test file because the index ships with the trigger feature)

### Step 3.1 — Add the failing index assertion to the existing pgTAP test

Edit `supabase/tests/pending_outflows_category_same_restaurant.test.sql`:

Change `SELECT plan(7);` to `SELECT plan(8);`, then **after** test 7 (and before `SELECT * FROM finish();`), append:

```sql
-- 8. Partial index on category_id exists (non-null rows).
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'pending_outflows'
      AND indexname = 'idx_pending_outflows_category'
  ),
  'idx_pending_outflows_category index exists'
);
```

### Step 3.2 — Run test, confirm RED on test 8

```bash
npm run test:db -- pending_outflows_category_same_restaurant
```

Expected: Tests 1–7 PASS (from Task 2), test 8 FAILS because the index does not exist.

### Step 3.3 — Write the migration

Create `supabase/migrations/20260522120100_pending_outflows_category_index.sql`:

```sql
-- Partial index on pending_outflows.category_id.
--
-- Aggregation reads (expenseDataFetcher, useMonthlyMetrics, useExpenseHealth)
-- already join chart_of_accounts via category_id. Historically most rows are
-- NULL; with the optional category picker on check creation, a meaningful
-- fraction will now be populated. The partial index keeps cost down by only
-- indexing the populated rows.

CREATE INDEX IF NOT EXISTS idx_pending_outflows_category
  ON public.pending_outflows(category_id)
  WHERE category_id IS NOT NULL;

COMMENT ON INDEX public.idx_pending_outflows_category IS
  'Partial index supporting category-keyed reads on pending_outflows. Excludes NULL category_id rows (the historical majority).';
```

> Note: `CREATE INDEX CONCURRENTLY` cannot run inside a transaction. The CLI applies migrations inside a transaction by default; we use plain `CREATE INDEX IF NOT EXISTS`, which is safe given the table size at our scale (tens of thousands of rows max per restaurant, all of which lock-acquire fast). If/when the table grows, a follow-up migration can replace this with a `CONCURRENTLY` version run via a manual ops step.

### Step 3.4 — Run test, confirm GREEN

```bash
npm run db:reset && npm run test:db -- pending_outflows_category_same_restaurant
```

Expected: All 8 tests PASS.

### Step 3.5 — Commit

```bash
git add supabase/migrations/20260522120100_pending_outflows_category_index.sql supabase/tests/pending_outflows_category_same_restaurant.test.sql
git commit -m "perf(db): partial index on pending_outflows.category_id

Aggregation reads now hit populated category_id rows after the check
creation feature lands. Partial-on-NOT-NULL keeps index size minimal
since most historical rows remain uncategorized."
```

---

## Task 4 — `PrintChecks.tsx`: Category column in Write Checks table

**Files:**
- Modify: `src/pages/PrintChecks.tsx`
- Create: `tests/unit/PrintChecksCategoryColumn.test.tsx`

### Step 4.1 — Write the failing test

Create `tests/unit/PrintChecksCategoryColumn.test.tsx`:

```tsx
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const claimCheckNumbersMock = vi.fn();
const createPendingOutflowMock = vi.fn();
const logCheckActionMock = vi.fn();

vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => ({
    selectedRestaurant: { restaurant: { name: 'Test Restaurant' }, restaurant_id: 'rest-1' },
  }),
}));

vi.mock('@/hooks/useCheckSettings', () => ({
  useCheckSettings: () => ({
    settings: {
      id: 'set-1',
      restaurant_id: 'rest-1',
      business_name: 'Test Restaurant LLC',
      business_address_line1: '123 Main St',
      business_address_line2: null,
      business_city: 'Austin',
      business_state: 'TX',
      business_zip: '78701',
      bank_name: null,
      print_bank_info: false,
      routing_number: null,
      signature_url: null,
    },
    isLoading: false,
  }),
}));

vi.mock('@/hooks/useCheckBankAccounts', () => ({
  useCheckBankAccounts: () => ({
    accounts: [{
      id: 'acct-1',
      account_name: 'Operating',
      bank_name: 'First National',
      next_check_number: 1001,
      print_bank_info: false,
      routing_number: null,
      account_number_last4: null,
      is_default: true,
    }],
    defaultAccount: {
      id: 'acct-1',
      account_name: 'Operating',
      bank_name: 'First National',
      next_check_number: 1001,
      print_bank_info: false,
      routing_number: null,
      account_number_last4: null,
      is_default: true,
    },
    isLoading: false,
    claimCheckNumbers: { mutateAsync: claimCheckNumbersMock },
    fetchAccountSecrets: vi.fn(),
  }),
}));

vi.mock('@/hooks/useCheckAuditLog', () => ({
  useCheckAuditLog: () => ({
    auditLog: [],
    isLoading: false,
    logCheckAction: { mutateAsync: logCheckActionMock },
  }),
}));

vi.mock('@/hooks/usePendingOutflows', () => ({
  usePendingOutflowMutations: () => ({
    createPendingOutflow: { mutateAsync: createPendingOutflowMock },
  }),
}));

vi.mock('@/hooks/useSuppliers', () => ({
  useSuppliers: () => ({ suppliers: [] }),
}));

vi.mock('@/components/subscription', () => ({
  FeatureGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/components/banking/SearchableAccountSelector', () => ({
  SearchableAccountSelector: ({
    onValueChange,
    triggerAriaLabel,
    value,
  }: {
    onValueChange: (value: string) => void;
    triggerAriaLabel?: string;
    value?: string;
  }) => (
    <button
      type="button"
      aria-label={triggerAriaLabel}
      data-current-value={value ?? ''}
      onClick={() => onValueChange('acc-food')}
    >
      Pick category
    </button>
  ),
}));

vi.mock('@/utils/checkPrinting', async () => {
  const actual = await vi.importActual<any>('@/utils/checkPrinting');
  return {
    ...actual,
    generateCheckPDF: vi.fn().mockReturnValue({ save: vi.fn() }),
    generateCheckPDFAsync: vi.fn().mockResolvedValue({ save: vi.fn() }),
  };
});

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import PrintChecks from '@/pages/PrintChecks';

describe('PrintChecks — per-row Category column', () => {
  beforeEach(() => {
    claimCheckNumbersMock.mockReset().mockResolvedValue(1001);
    createPendingOutflowMock.mockReset().mockResolvedValue({ id: 'outflow-new-1' });
    logCheckActionMock.mockReset().mockResolvedValue(undefined);
  });

  it('renders a Category column header', () => {
    render(<PrintChecks />);
    expect(screen.getByRole('columnheader', { name: /category/i })).toBeInTheDocument();
  });

  it('renders a per-row category selector with a row-scoped aria-label', () => {
    render(<PrintChecks />);
    expect(
      screen.getByRole('button', { name: /category for check row 1/i }),
    ).toBeInTheDocument();
  });

  it('passes the chosen category_id through to createPendingOutflow', async () => {
    const user = userEvent.setup();
    render(<PrintChecks />);

    await user.type(screen.getByPlaceholderText(/vendor name/i), 'Sysco');
    await user.type(screen.getByPlaceholderText('0.00'), '125.50');

    await user.click(screen.getByRole('button', { name: /category for check row 1/i }));

    await user.click(screen.getByRole('button', { name: /^Print 1 Check$/i }));

    await waitFor(() => expect(createPendingOutflowMock).toHaveBeenCalledTimes(1));
    expect(createPendingOutflowMock).toHaveBeenCalledWith(
      expect.objectContaining({
        vendor_name: 'Sysco',
        amount: 125.5,
        category_id: 'acc-food',
      }),
    );
  });

  it('defaults category_id to null when no category is picked', async () => {
    const user = userEvent.setup();
    render(<PrintChecks />);

    await user.type(screen.getByPlaceholderText(/vendor name/i), 'Sysco');
    await user.type(screen.getByPlaceholderText('0.00'), '99.00');

    await user.click(screen.getByRole('button', { name: /^Print 1 Check$/i }));

    await waitFor(() => expect(createPendingOutflowMock).toHaveBeenCalledTimes(1));
    expect(createPendingOutflowMock).toHaveBeenCalledWith(
      expect.objectContaining({ category_id: null }),
    );
  });
});
```

### Step 4.2 — Run test, confirm RED

```bash
npm run test -- tests/unit/PrintChecksCategoryColumn.test.tsx
```

Expected: All four tests FAIL (no Category column, no selector, no category_id in payload).

### Step 4.3 — Edit `src/pages/PrintChecks.tsx`

Apply these edits in order:

**4.3a — Import `SearchableAccountSelector`.** Add to the existing imports near the top of the file:

```ts
import { SearchableAccountSelector } from '@/components/banking/SearchableAccountSelector';
```

**4.3b — Widen `CheckRow` and `createEmptyRow`:**

```ts
interface CheckRow {
  id: string;
  payeeName: string;
  amount: string;
  issueDate: string;
  memo: string;
  categoryId: string | null;
  selected: boolean;
}

function createEmptyRow(): CheckRow {
  return {
    id: crypto.randomUUID(),
    payeeName: '',
    amount: '',
    issueDate: format(new Date(), 'yyyy-MM-dd'),
    memo: '',
    categoryId: null,
    selected: true,
  };
}
```

**4.3c — Widen `updateRow` signature:**

```ts
const updateRow = useCallback((id: string, field: keyof CheckRow, value: string | boolean | null) => {
  setRows((prev) => prev.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
}, []);
```

**4.3d — Refactor the print loop to a `CheckJob` shape.** Replace the body of `handlePrint` (the section between `setIsPrinting(true)` and `pdf.save(filename)`) so that the per-row data flows through one structure:

```ts
const startNumber = await claimCheckNumbers.mutateAsync({
  accountId: selectedAccount.id,
  count: selectedRows.length,
});

type CheckJob = CheckData & { categoryId: string | null };
const jobs: CheckJob[] = selectedRows.map((row, i) => ({
  checkNumber: startNumber + i,
  payeeName: row.payeeName.trim(),
  amount: parseFloat(row.amount),
  issueDate: row.issueDate,
  memo: row.memo.trim() || undefined,
  categoryId: row.categoryId,
}));

for (const job of jobs) {
  const outflow = await createPendingOutflow.mutateAsync({
    vendor_name: job.payeeName,
    amount: job.amount,
    payment_method: 'check',
    reference_number: String(job.checkNumber),
    issue_date: job.issueDate,
    notes: job.memo ?? null,
    category_id: job.categoryId,
  });

  await logCheckAction.mutateAsync({
    check_number: job.checkNumber,
    payee_name: job.payeeName,
    amount: job.amount,
    issue_date: job.issueDate,
    memo: job.memo ?? null,
    action: 'printed',
    pending_outflow_id: outflow.id,
    check_bank_account_id: selectedAccount.id,
  });
}

const checks: CheckData[] = jobs.map(({ categoryId: _ignored, ...rest }) => rest);
const config = buildPrintConfig(settings, selectedAccount, secrets);
const pdf = selectedAccount.print_bank_info
  ? await generateCheckPDFAsync(config, checks)
  : generateCheckPDF(config, checks);
const filename = generateCheckFilename(
  selectedRestaurant.restaurant.name,
  checks.map((c) => c.checkNumber),
);
pdf.save(filename);

toast.success(`${checks.length} check${checks.length > 1 ? 's' : ''} printed`);

setRows([createEmptyRow()]);
```

**4.3e — Add the Category column header.** Inside the `<TableHeader><TableRow>` block, between the Memo `<TableHead>` and the trailing empty `<TableHead className="w-10" />`, insert:

```tsx
<TableHead className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
  Category
</TableHead>
```

**4.3f — Add the Category body cell.** Inside the `rows.map((row, rowIndex) => ...)` block, after the Memo `<TableCell>` and before the trash `<TableCell>`, insert:

```tsx
<TableCell>
  <div className="w-48">
    <SearchableAccountSelector
      value={row.categoryId ?? undefined}
      onValueChange={(v) => updateRow(row.id, 'categoryId', v || null)}
      filterByTypes={['expense', 'cogs', 'asset']}
      placeholder="Optional"
      triggerAriaLabel={`Category for check row ${rowIndex + 1}`}
    />
  </div>
</TableCell>
```

### Step 4.4 — Run test, confirm GREEN

```bash
npm run test -- tests/unit/PrintChecksCategoryColumn.test.tsx
```

Expected: All four tests PASS.

### Step 4.5 — Run the full unit suite to catch regressions

```bash
npm run test -- tests/unit/PrintChecks tests/unit/checkPrinting tests/unit/SearchableAccountSelector
```

Expected: No regressions in adjacent suites.

### Step 4.6 — Commit

```bash
git add src/pages/PrintChecks.tsx tests/unit/PrintChecksCategoryColumn.test.tsx
git commit -m "feat(print-checks): per-row Category column on Write Checks page

Each batch check row gains an optional chart-of-accounts category
picker. The category travels with the row through the print job and
lands on the resulting pending_outflows row, so the user never has to
hunt down the expense afterward to categorize it."
```

---

## Task 5 — `PrintCheckButton.tsx`: Category field on per-expense print dialog

**Files:**
- Modify: `src/components/pending-outflows/PrintCheckButton.tsx`
- Create: `tests/unit/PrintCheckButtonCategory.test.tsx`

### Step 5.1 — Write the failing test

Create `tests/unit/PrintCheckButtonCategory.test.tsx`:

```tsx
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const claimForAccountMutateAsync = vi.fn();
const fetchAccountSecretsMock = vi.fn();
const updatePendingOutflowMutateAsync = vi.fn();
const logCheckActionMutateAsync = vi.fn();

vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => ({
    selectedRestaurant: { restaurant: { name: 'Test Restaurant' }, restaurant_id: 'rest-1' },
  }),
}));

vi.mock('@/hooks/useCheckSettings', () => ({
  useCheckSettings: () => ({
    settings: {
      id: 'set-1',
      restaurant_id: 'rest-1',
      business_name: 'Test Restaurant LLC',
      business_address_line1: '123 Main St',
      business_address_line2: null,
      business_city: 'Austin',
      business_state: 'TX',
      business_zip: '78701',
      bank_name: null,
      print_bank_info: false,
      routing_number: null,
      signature_url: null,
    },
  }),
}));

vi.mock('@/hooks/useCheckBankAccounts', () => ({
  useCheckBankAccounts: () => ({
    accounts: [{
      id: 'acct-1',
      account_name: 'Operating',
      bank_name: 'First National',
      next_check_number: 1001,
      print_bank_info: false,
      routing_number: null,
      account_number_last4: null,
      is_default: true,
    }],
    defaultAccount: {
      id: 'acct-1',
      account_name: 'Operating',
      bank_name: 'First National',
      next_check_number: 1001,
      print_bank_info: false,
      routing_number: null,
      account_number_last4: null,
      is_default: true,
    },
    claimCheckNumbers: { mutateAsync: claimForAccountMutateAsync },
    fetchAccountSecrets: fetchAccountSecretsMock,
  }),
}));

vi.mock('@/hooks/useCheckAuditLog', () => ({
  useCheckAuditLog: () => ({
    logCheckAction: { mutateAsync: logCheckActionMutateAsync },
  }),
}));

vi.mock('@/hooks/usePendingOutflows', () => ({
  usePendingOutflowMutations: () => ({
    updatePendingOutflow: { mutateAsync: updatePendingOutflowMutateAsync },
  }),
}));

vi.mock('@/components/banking/SearchableAccountSelector', () => ({
  SearchableAccountSelector: ({
    onValueChange,
    value,
  }: {
    onValueChange: (value: string) => void;
    value?: string;
  }) => (
    <button
      type="button"
      data-testid="category-selector"
      data-current-value={value ?? ''}
      onClick={() => onValueChange('acc-rent')}
    >
      Pick category
    </button>
  ),
}));

vi.mock('@/utils/checkPrinting', async () => {
  const actual = await vi.importActual<any>('@/utils/checkPrinting');
  return {
    ...actual,
    generateCheckPDF: vi.fn().mockReturnValue({ save: vi.fn() }),
    generateCheckPDFAsync: vi.fn().mockResolvedValue({ save: vi.fn() }),
  };
});

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { PrintCheckButton } from '@/components/pending-outflows/PrintCheckButton';
import type { PendingOutflow } from '@/types/pending-outflows';

function makeExpense(overrides: Partial<PendingOutflow> = {}): PendingOutflow {
  return {
    id: 'pof-1',
    restaurant_id: 'rest-1',
    vendor_name: 'ACME Rent',
    category_id: null,
    payment_method: 'check',
    amount: 1200,
    issue_date: '2026-05-22',
    due_date: null,
    notes: null,
    reference_number: null,
    status: 'pending',
    linked_bank_transaction_id: null,
    cleared_at: null,
    voided_at: null,
    voided_reason: null,
    created_at: '2026-05-22T00:00:00Z',
    updated_at: '2026-05-22T00:00:00Z',
    chart_account: null,
    ...overrides,
  };
}

beforeEach(() => {
  claimForAccountMutateAsync.mockReset().mockResolvedValue(1001);
  fetchAccountSecretsMock.mockReset().mockResolvedValue(null);
  updatePendingOutflowMutateAsync.mockReset().mockResolvedValue({});
  logCheckActionMutateAsync.mockReset().mockResolvedValue(undefined);
});

describe('PrintCheckButton — Category field', () => {
  it('passes the newly picked category_id when the expense was uncategorized', async () => {
    const user = userEvent.setup();
    render(<PrintCheckButton expense={makeExpense()} />);

    await user.click(screen.getByRole('button', { name: /^Print check for ACME Rent$/i }));
    await user.click(screen.getByTestId('category-selector'));
    await user.click(screen.getByRole('button', { name: /^Print Check$/i }));

    await waitFor(() => expect(updatePendingOutflowMutateAsync).toHaveBeenCalledTimes(1));
    expect(updatePendingOutflowMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'pof-1',
        input: expect.objectContaining({
          payment_method: 'check',
          category_id: 'acc-rent',
        }),
      }),
    );
  });

  it('keeps the existing category_id when the user leaves the field alone', async () => {
    const user = userEvent.setup();
    render(<PrintCheckButton expense={makeExpense({ category_id: 'acc-preexisting' })} />);

    await user.click(screen.getByRole('button', { name: /^Print check for ACME Rent$/i }));
    expect(screen.getByTestId('category-selector')).toHaveAttribute(
      'data-current-value',
      'acc-preexisting',
    );

    await user.click(screen.getByRole('button', { name: /^Print Check$/i }));

    await waitFor(() => expect(updatePendingOutflowMutateAsync).toHaveBeenCalledTimes(1));
    expect(updatePendingOutflowMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({ category_id: 'acc-preexisting' }),
      }),
    );
  });

  it('overrides an existing category_id when the user picks a different one', async () => {
    const user = userEvent.setup();
    render(<PrintCheckButton expense={makeExpense({ category_id: 'acc-old' })} />);

    await user.click(screen.getByRole('button', { name: /^Print check for ACME Rent$/i }));
    await user.click(screen.getByTestId('category-selector'));
    await user.click(screen.getByRole('button', { name: /^Print Check$/i }));

    await waitFor(() => expect(updatePendingOutflowMutateAsync).toHaveBeenCalledTimes(1));
    expect(updatePendingOutflowMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({ category_id: 'acc-rent' }),
      }),
    );
  });
});
```

### Step 5.2 — Run test, confirm RED

```bash
npm run test -- tests/unit/PrintCheckButtonCategory.test.tsx
```

Expected: All three tests FAIL (selector not rendered, `category_id` not in payload).

### Step 5.3 — Edit `src/components/pending-outflows/PrintCheckButton.tsx`

**5.3a — Add the `SearchableAccountSelector` import** alongside other imports near the top:

```ts
import { SearchableAccountSelector } from '@/components/banking/SearchableAccountSelector';
```

**5.3b — Add state.** Below the existing `useState` block:

```ts
const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(
  expense.category_id ?? null,
);
```

**5.3c — Reset state when the dialog reopens.** Below the existing `useEffect` that resets `memo`:

```ts
useEffect(() => {
  if (!open) return;
  setSelectedCategoryId(expense.category_id ?? null);
}, [open, expense.category_id]);
```

**5.3d — Pass `category_id` in the update payload.** In `handlePrint`, change the `updatePendingOutflow.mutateAsync({...})` call to include the new field:

```ts
await updatePendingOutflow.mutateAsync({
  id: expense.id,
  input: {
    payment_method: 'check',
    reference_number: String(checkNumber),
    notes: memo.trim() || expense.notes,
    check_bank_account_id: selectedAccount.id,
    category_id: selectedCategoryId,
  },
});
```

**5.3e — Add the Category field to the dialog body.** Inside the `<div className="px-6 py-5 space-y-5">` block, immediately after the Memo block and before the closing `</div>` of that section:

```tsx
<div className="space-y-2">
  <Label htmlFor="print-check-category" className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
    Category (optional)
  </Label>
  <SearchableAccountSelector
    value={selectedCategoryId ?? undefined}
    onValueChange={(v) => setSelectedCategoryId(v || null)}
    filterByTypes={['expense', 'cogs', 'asset']}
    placeholder="Pick a chart-of-accounts category"
    triggerAriaLabel="Category for this check"
  />
</div>
```

**5.3f — Add overflow classes to the dialog.** Change the `<DialogContent>` opening tag from:

```tsx
<DialogContent className="max-w-md p-0 gap-0 border-border/40">
```

…to:

```tsx
<DialogContent className="max-w-md max-h-[80vh] overflow-y-auto p-0 gap-0 border-border/40">
```

### Step 5.4 — Run test, confirm GREEN

```bash
npm run test -- tests/unit/PrintCheckButtonCategory.test.tsx
```

Expected: All three tests PASS.

### Step 5.5 — Commit

```bash
git add src/components/pending-outflows/PrintCheckButton.tsx tests/unit/PrintCheckButtonCategory.test.tsx
git commit -m "feat(print-check-button): optional category on per-expense print dialog

Pre-fills from the expense's existing category_id (so already-categorized
expenses stay categorized) and lets the user override at print time.
Also fixes a missing max-h-[80vh] / overflow-y-auto on the dialog —
needed now that the body grows by one field."
```

---

## Task 6 — Manual sanity check + push

### Step 6.1 — Typecheck, lint, build

```bash
npm run typecheck && npm run lint && npm run build
```

Expected: all three exit zero. If `typecheck` flags the `as any` removal on the `chart_account` projection, re-read `src/types/pending-outflows.ts` and make sure `chart_account?: { account_name: string } | null` still satisfies the query result.

### Step 6.2 — Full unit suite

```bash
npm run test
```

Expected: all suites green. New tests included:
- `tests/unit/SearchableAccountSelector.ariaLabel.test.tsx`
- `tests/unit/PrintChecksCategoryColumn.test.tsx`
- `tests/unit/PrintCheckButtonCategory.test.tsx`

### Step 6.3 — Full pgTAP suite

```bash
npm run db:reset && npm run test:db
```

Expected: all pgTAP suites green, including the new `pending_outflows_category_same_restaurant.test.sql`.

### Step 6.4 — End of plan

No commit at this step — the Phase 8 / Phase 9 verification loop owns the rest. Hand off to the multi-model review skill.

---

## Self-Review

1. **Spec coverage**
   - Spec §Data model (no schema rewrite) → Tasks 2 + 3 (trigger + index, plus pgTAP). ✅
   - Spec §`PrintChecks.tsx` (Row shape / updateRow widening / table column / print handler refactor / aria-label / collisionPadding) → Tasks 1 + 4. ✅
   - Spec §`PrintCheckButton.tsx` (state, reset, update payload, dialog body, overflow class) → Task 5. ✅
   - Spec §Visual notes (console.log cleanup) → Task 1.3. ✅
   - Spec §Tests (PrintChecks Category column, PrintCheckButton three cases, new pgTAP file) → Tasks 2.1, 3.1, 4.1, 5.1. ✅
   - Spec §Decided trade-offs → no implementation work (deferred items). ✅

2. **Placeholder scan** — no "TBD" / "TODO" / vague "add appropriate error handling" / "similar to" references. All steps show concrete code or commands. ✅

3. **Type consistency**
   - `CheckRow.categoryId: string | null` is used consistently in 4.3b, 4.3c, 4.3d, 4.3f. ✅
   - `triggerAriaLabel?: string` (Task 1) → consumed in 4.3f (`Category for check row ${rowIndex + 1}`). ✅
   - `CheckJob = CheckData & { categoryId: string | null }` defined and used inside `handlePrint`'s scope only (Task 4.3d). ✅
   - `category_id` snake-case at DB / API boundary (`createPendingOutflow.mutateAsync`, `updatePendingOutflow.mutateAsync`), `categoryId` camelCase in component state. Consistent with the rest of the codebase (`useBankTransactions`, `usePendingOutflows`). ✅
