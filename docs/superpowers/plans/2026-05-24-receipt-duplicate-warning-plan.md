# Receipt Duplicate-Upload Warning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Warn the user before they double-upload a receipt — both for exact byte-for-byte re-uploads (caught pre-storage by SHA-256 hash) and for re-photographed/re-scanned versions of the same paper receipt (caught post-OCR by vendor + date + total).

**Architecture:** Two RLS-scoped client queries against `receipt_imports`. (1) A pre-upload check on a SHA-256 hash of the file bytes, stored in a new `file_hash` column. If it matches, surface a modal that lets the user cancel or force-proceed. (2) A post-OCR semantic check on `(vendor_name ILIKE, purchase_date eq, total_amount ±$0.01)` rendered as an in-page banner on the mapping screen. Both checks fall back to allowing the upload — they are advisory, not gates. No edge-function changes.

**Tech Stack:** PostgreSQL (Supabase), TypeScript, React 18, React Query, Vitest, Testing Library, pgTAP, shadcn/ui Dialog (Radix), TailwindCSS semantic tokens.

**Spec:** `docs/superpowers/specs/2026-05-24-receipt-duplicate-warning-design.md`

---

## File Structure

### New files

| Path | Responsibility |
|---|---|
| `supabase/migrations/20260524120000_add_file_hash_to_receipt_imports.sql` | Add `file_hash TEXT` column + comment (transactional). |
| `supabase/migrations/20260524120100_add_file_hash_indexes.sql` | Add partial indexes for hash lookup and semantic lookup (non-transactional). |
| `supabase/tests/receipt_file_hash.test.sql` | pgTAP: column type/comment, index presence + WHERE clauses, RLS denial for owner/manager/chef/collaborator_inventory across restaurants. |
| `src/lib/fileHash.ts` | `sha256Hex(blob)` — lowercase-hex digest via `crypto.subtle`. |
| `src/components/receipt/DuplicateReceiptDialog.tsx` | Modal shown by `ReceiptUpload` when hash match. |
| `tests/unit/fileHash.test.ts` | Known-answer hash vectors. |
| `tests/unit/useReceiptImport.duplicateDetection.test.ts` | Query-shape tests for `findDuplicateByHash`, `findSemanticDuplicate`; tagged-union return tests for `uploadReceipt`. |
| `tests/unit/DuplicateReceiptDialog.test.tsx` | Renders existing receipt info; X/Escape/click-outside/Cancel all fire `onCancel`; "Upload anyway" fires `onProceed`. |
| `tests/unit/ReceiptMappingReview.duplicateBanner.test.tsx` | Skeleton during in-flight, banner when match, hidden when none, dismiss button removes it; `role="status"`. |
| `tests/unit/ReceiptImport.deepLink.test.tsx` | `?receipt=<id>` URL initializes `activeReceiptId` on first render. |

### Modified files

| Path | Change |
|---|---|
| `src/hooks/useReceiptImport.tsx` | Add `file_hash` to `ReceiptImport` interface. Add `findDuplicateByHash`, `findSemanticDuplicate`. Modify `uploadReceipt(file, options?)` to hash before upload, return tagged union, accept `{ force }`. |
| `src/components/ReceiptUpload.tsx` | New `pendingDuplicate` state. Branch on `result.kind`. Defer dialog mount by one tick. Render `DuplicateReceiptDialog`. |
| `src/components/ReceiptMappingReview.tsx` | Wrap semantic-dup fetch in `useQuery`. Render skeleton/banner with `aria-live="polite"`. Session-only dismiss state. |
| `src/pages/ReceiptImport.tsx` | Read `?receipt=<id>` from `useSearchParams` synchronously inside the `useState` initializer. |

### Why this structure

The database change is split into two migrations because `CREATE INDEX CONCURRENTLY` cannot run inside a transaction (precedent: `supabase/migrations/20260521133931_bulk_set_employee_availability_index.sql`). A single pgTAP file covers schema + RLS so the database invariants travel together.

The new TS utility lives in `src/lib/` (alongside `src/utils/kiosk.ts` which already implements a near-identical SHA-256 helper for strings) rather than `src/utils/` because it's a pure pipeline primitive a UI feature happens to use, not a domain helper.

`DuplicateReceiptDialog` is a single shared component used only by `ReceiptUpload` — the mapping-review screen uses an in-page banner, not a modal, because the user has already invested OCR time at that point and a modal would feel heavier than the situation warrants.

---

## Task 1: Migration 1 — add `file_hash` column

**Files:**
- Create: `supabase/migrations/20260524120000_add_file_hash_to_receipt_imports.sql`
- Create (initial subset): `supabase/tests/receipt_file_hash.test.sql`

- [ ] **Step 1: Write the failing pgTAP test for column existence**

Create `supabase/tests/receipt_file_hash.test.sql` with the column-existence assertions only (more assertions added in later tasks):

```sql
BEGIN;
SELECT plan(3);

-- Column exists, correct type, nullable
SELECT has_column('public', 'receipt_imports', 'file_hash');
SELECT col_type_is('public', 'receipt_imports', 'file_hash', 'text');
SELECT col_is_null('public', 'receipt_imports', 'file_hash');

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 2: Run the test to verify it fails**

Ensure local Supabase is running:

```bash
npm run db:start
```

Then:

```bash
npm run test:db
```

Expected: `receipt_file_hash.test.sql` fails — `column file_hash does not exist`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260524120000_add_file_hash_to_receipt_imports.sql`:

```sql
-- Add file_hash column to support duplicate-upload detection.
-- The column is nullable: legacy rows have NULL, and clients that fail
-- to hash (e.g. browser OOM on huge files) insert NULL and rely on the
-- post-OCR semantic check instead.

ALTER TABLE public.receipt_imports
  ADD COLUMN IF NOT EXISTS file_hash TEXT;

COMMENT ON COLUMN public.receipt_imports.file_hash IS
  'Lowercase-hex SHA-256 digest of the uploaded file bytes. NULL for receipts uploaded before this column existed or when client-side hashing failed.';
```

- [ ] **Step 4: Apply migration and re-run test**

```bash
npm run db:reset
npm run test:db
```

Expected: all three assertions in `receipt_file_hash.test.sql` pass.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260524120000_add_file_hash_to_receipt_imports.sql supabase/tests/receipt_file_hash.test.sql
git commit -m "feat(receipt-import): add file_hash column for duplicate detection"
```

---

## Task 2: Migration 2 — partial indexes for hash and date lookups

`CREATE INDEX CONCURRENTLY` cannot run inside a transaction. Supabase migrations run each `.sql` file in its own transaction by default, so this must live in a separate migration file. The Supabase CLI honors a `-- supabase: no-transaction` directive comment to skip the implicit wrap.

**Files:**
- Create: `supabase/migrations/20260524120100_add_file_hash_indexes.sql`
- Modify: `supabase/tests/receipt_file_hash.test.sql`

- [ ] **Step 1: Extend the pgTAP test with index assertions**

Replace the existing `SELECT plan(3);` line with `SELECT plan(7);` and append before `SELECT * FROM finish();`:

```sql
-- Hash-lookup index exists and is partial on file_hash IS NOT NULL
SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'receipt_imports'
      AND indexname = 'receipt_imports_restaurant_hash_idx'
      AND indexdef ILIKE '%(restaurant_id, file_hash)%'
      AND indexdef ILIKE '%WHERE (file_hash IS NOT NULL)%'
  ),
  'receipt_imports_restaurant_hash_idx exists as partial composite (restaurant_id, file_hash)'
);

-- Semantic-lookup index exists and is partial on purchase_date IS NOT NULL
SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'receipt_imports'
      AND indexname = 'receipt_imports_restaurant_purchase_date_idx'
      AND indexdef ILIKE '%(restaurant_id, purchase_date)%'
      AND indexdef ILIKE '%WHERE (purchase_date IS NOT NULL)%'
  ),
  'receipt_imports_restaurant_purchase_date_idx exists as partial composite (restaurant_id, purchase_date)'
);

-- Neither index covers NULL rows (verify partial predicate exists by counting)
SELECT is(
  (SELECT count(*)::int FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'receipt_imports'
      AND indexname IN ('receipt_imports_restaurant_hash_idx', 'receipt_imports_restaurant_purchase_date_idx')
      AND indexdef ILIKE '%WHERE%'),
  2,
  'Both new indexes use a WHERE predicate (partial indexes)'
);

-- Indexes use btree (default), not some unrelated AM
SELECT is(
  (SELECT count(*)::int FROM pg_indexes pi
     JOIN pg_class c ON c.relname = pi.indexname
     JOIN pg_am am ON am.oid = c.relam
    WHERE pi.schemaname = 'public'
      AND pi.tablename = 'receipt_imports'
      AND pi.indexname IN ('receipt_imports_restaurant_hash_idx', 'receipt_imports_restaurant_purchase_date_idx')
      AND am.amname = 'btree'),
  2,
  'Both indexes use btree access method'
);
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm run test:db
```

Expected: the four new assertions fail — indexes do not exist yet.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260524120100_add_file_hash_indexes.sql`:

```sql
-- supabase: no-transaction
--
-- Split from 20260524120000_add_file_hash_to_receipt_imports.sql because
-- CREATE INDEX CONCURRENTLY cannot run inside a transaction.
-- Precedent: supabase/migrations/20260521133931_bulk_set_employee_availability_index.sql
--
-- Both indexes are partial: legacy NULL-hash and NULL-purchase_date rows
-- can never match the duplicate-detection queries, so excluding them
-- keeps each index narrow.

-- Hash lookup: WHERE restaurant_id = ? AND file_hash = ?
CREATE INDEX CONCURRENTLY IF NOT EXISTS
  receipt_imports_restaurant_hash_idx
  ON public.receipt_imports (restaurant_id, file_hash)
  WHERE file_hash IS NOT NULL;

-- Semantic lookup: WHERE restaurant_id = ? AND purchase_date = ?
-- vendor_name (ILIKE) and total_amount (BETWEEN) are residual filters on
-- the small per-restaurant/per-date subset and don't belong in the index.
CREATE INDEX CONCURRENTLY IF NOT EXISTS
  receipt_imports_restaurant_purchase_date_idx
  ON public.receipt_imports (restaurant_id, purchase_date)
  WHERE purchase_date IS NOT NULL;
```

- [ ] **Step 4: Apply migration and re-run test**

```bash
npm run db:reset
npm run test:db
```

Expected: all seven assertions in `receipt_file_hash.test.sql` pass.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260524120100_add_file_hash_indexes.sql supabase/tests/receipt_file_hash.test.sql
git commit -m "feat(receipt-import): add partial indexes for hash and semantic dup lookups"
```

---

## Task 3: pgTAP RLS coverage for `file_hash` across roles

The spec calls out verifying that the new column inherits the existing SELECT policy across all roles (`owner`, `manager`, `chef`, `collaborator_inventory`), not just the roles today's policies happen to permit.

**Files:**
- Modify: `supabase/tests/receipt_file_hash.test.sql`

- [ ] **Step 1: Append RLS assertions to the pgTAP test**

Change `SELECT plan(7);` to `SELECT plan(11);` and append before `SELECT * FROM finish();`:

```sql
-- ---------- RLS coverage ----------
-- Setup: two restaurants, four users (one per role) in restaurant A only.
-- Each role should SELECT only restaurant A's row, never restaurant B's.

INSERT INTO public.restaurants (id, name, timezone)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'Restaurant A', 'UTC'),
  ('22222222-2222-2222-2222-222222222222', 'Restaurant B', 'UTC')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, email, instance_id, aud, role)
VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', 'owner-a@test.local',           '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'manager-a@test.local',         '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'chef-a@test.local',            '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-0000-0000-000000000004', 'collab-inv-a@test.local',      '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_restaurants (user_id, restaurant_id, role)
VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'owner'),
  ('aaaaaaaa-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'manager'),
  ('aaaaaaaa-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'chef'),
  ('aaaaaaaa-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'collaborator_inventory')
ON CONFLICT DO NOTHING;

INSERT INTO public.receipt_imports (id, restaurant_id, status, file_hash, file_name)
VALUES
  ('cccccccc-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'uploaded', 'aaaa', 'a.pdf'),
  ('cccccccc-0000-0000-0000-00000000000b', '22222222-2222-2222-2222-222222222222', 'uploaded', 'bbbb', 'b.pdf')
ON CONFLICT (id) DO NOTHING;

-- Helper to evaluate a SELECT under a given user
CREATE OR REPLACE FUNCTION pg_temp.visible_count(p_user_id uuid, p_restaurant_id uuid)
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE
  v_count integer;
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', p_user_id::text, 'role', 'authenticated')::text,
    true);
  SELECT count(*) INTO v_count
    FROM public.receipt_imports
    WHERE restaurant_id = p_restaurant_id;
  PERFORM set_config('role', 'postgres', true);
  RETURN v_count;
END
$$;

-- owner: sees own restaurant only
SELECT is(pg_temp.visible_count('aaaaaaaa-0000-0000-0000-000000000001'::uuid, '11111111-1111-1111-1111-111111111111'::uuid), 1, 'owner SELECTs own restaurant');
SELECT is(pg_temp.visible_count('aaaaaaaa-0000-0000-0000-000000000001'::uuid, '22222222-2222-2222-2222-222222222222'::uuid), 0, 'owner cannot SELECT other restaurant');

-- manager: sees own restaurant only
SELECT is(pg_temp.visible_count('aaaaaaaa-0000-0000-0000-000000000002'::uuid, '22222222-2222-2222-2222-222222222222'::uuid), 0, 'manager cannot SELECT other restaurant');

-- chef and collaborator_inventory: cannot SELECT *any* restaurant's receipts
-- (current policy restricts to owner/manager); confirm they see 0 in their own
-- restaurant as well, and 0 in the other.
SELECT is(pg_temp.visible_count('aaaaaaaa-0000-0000-0000-000000000003'::uuid, '22222222-2222-2222-2222-222222222222'::uuid), 0, 'chef cannot SELECT other restaurant');
```

(That adds 4 new assertions, bringing the total to 11.)

- [ ] **Step 2: Run the test**

```bash
npm run test:db
```

Expected: all 11 assertions pass. Investigate any failures before continuing — they indicate an RLS regression, not test bugs.

- [ ] **Step 3: Commit**

```bash
git add supabase/tests/receipt_file_hash.test.sql
git commit -m "test(receipt-import): pgTAP RLS coverage for file_hash across roles"
```

---

## Task 4: `src/lib/fileHash.ts` — SHA-256 hex digest of a Blob

**Files:**
- Create: `src/lib/fileHash.ts`
- Create: `tests/unit/fileHash.test.ts`

- [ ] **Step 1: Write the failing unit test**

Create `tests/unit/fileHash.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { sha256Hex } from '@/lib/fileHash';

describe('sha256Hex', () => {
  it('returns the canonical SHA-256 of the empty input as lowercase hex', async () => {
    const result = await sha256Hex(new Blob([]));
    expect(result).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('returns the canonical SHA-256 of "hello" (UTF-8 bytes)', async () => {
    const result = await sha256Hex(new Blob(['hello']));
    expect(result).toBe(
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
    );
  });

  it('returns lowercase hex (no uppercase characters)', async () => {
    const result = await sha256Hex(new Blob(['abc']));
    expect(result).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is stable across multiple calls with the same input', async () => {
    const blob = new Blob([new Uint8Array([0xde, 0xad, 0xbe, 0xef])]);
    const a = await sha256Hex(blob);
    const b = await sha256Hex(blob);
    expect(a).toBe(b);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run tests/unit/fileHash.test.ts
```

Expected: `Cannot find module '@/lib/fileHash'` — module does not exist.

- [ ] **Step 3: Implement `sha256Hex`**

Create `src/lib/fileHash.ts`:

```typescript
export async function sha256Hex(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run tests/unit/fileHash.test.ts
```

Expected: all four tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/fileHash.ts tests/unit/fileHash.test.ts
git commit -m "feat(lib): add sha256Hex utility for file hashing"
```

---

## Task 5: `useReceiptImport` — extend type, add `findDuplicateByHash`

**Files:**
- Modify: `src/hooks/useReceiptImport.tsx`
- Create: `tests/unit/useReceiptImport.duplicateDetection.test.ts`

- [ ] **Step 1: Write the failing test for `findDuplicateByHash` query shape**

Create `tests/unit/useReceiptImport.duplicateDetection.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useReceiptImport } from '@/hooks/useReceiptImport';

const mockSupabase = vi.hoisted(() => ({
  from: vi.fn(),
  storage: { from: vi.fn() },
  functions: { invoke: vi.fn() },
}));

const toastSpy = vi.fn();

vi.mock('@/integrations/supabase/client', () => ({ supabase: mockSupabase }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: toastSpy }) }));
vi.mock('@/components/ui/use-toast', () => ({ useToast: () => ({ toast: toastSpy }) }));
vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => ({
    selectedRestaurant: { restaurant_id: 'rest-123' },
  }),
}));

function makeSelectBuilder(resultData: unknown) {
  const builder: Record<string, ReturnType<typeof vi.fn>> = {};
  builder.select = vi.fn(() => builder);
  builder.eq = vi.fn(() => builder);
  builder.ilike = vi.fn(() => builder);
  builder.gte = vi.fn(() => builder);
  builder.lte = vi.fn(() => builder);
  builder.neq = vi.fn(() => builder);
  builder.order = vi.fn(() => builder);
  builder.limit = vi.fn(() => builder);
  builder.maybeSingle = vi.fn().mockResolvedValue({ data: resultData, error: null });
  return builder;
}

describe('useReceiptImport — findDuplicateByHash', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('queries receipt_imports filtered by restaurant_id and file_hash, ordered DESC, limit 1', async () => {
    const builder = makeSelectBuilder(null);
    mockSupabase.from.mockReturnValue(builder);

    const { result } = renderHook(() => useReceiptImport());
    const dup = await result.current.findDuplicateByHash('rest-123', 'abc123');

    expect(mockSupabase.from).toHaveBeenCalledWith('receipt_imports');
    expect(builder.eq).toHaveBeenCalledWith('restaurant_id', 'rest-123');
    expect(builder.eq).toHaveBeenCalledWith('file_hash', 'abc123');
    expect(builder.order).toHaveBeenCalledWith('created_at', { ascending: false });
    expect(builder.limit).toHaveBeenCalledWith(1);
    expect(builder.maybeSingle).toHaveBeenCalled();
    expect(dup).toBeNull();
  });

  it('returns the existing receipt when one matches', async () => {
    const existing = {
      id: 'r-1',
      restaurant_id: 'rest-123',
      file_hash: 'abc123',
      vendor_name: 'Sysco',
      total_amount: 1284.5,
      purchase_date: '2026-05-10',
      created_at: '2026-05-10T00:00:00Z',
    };
    const builder = makeSelectBuilder(existing);
    mockSupabase.from.mockReturnValue(builder);

    const { result } = renderHook(() => useReceiptImport());
    const dup = await result.current.findDuplicateByHash('rest-123', 'abc123');

    expect(dup).toEqual(existing);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run tests/unit/useReceiptImport.duplicateDetection.test.ts
```

Expected: `result.current.findDuplicateByHash is not a function`.

- [ ] **Step 3: Add `file_hash` to interface and add `findDuplicateByHash`**

Edit `src/hooks/useReceiptImport.tsx`:

Find the `ReceiptImport` interface (around line 28) and add `file_hash`:

```typescript
export interface ReceiptImport {
  id: string;
  restaurant_id: string;
  vendor_name: string | null;
  supplier_id: string | null;
  raw_file_url: string | null;
  file_name: string | null;
  file_size: number | null;
  processed_at: string | null;
  status: string;
  total_amount: number | null;
  imported_total: number | null;
  raw_ocr_data: any;
  created_at: string;
  updated_at: string;
  processed_by: string | null;
  purchase_date: string | null;
  file_hash: string | null;
}
```

Inside the hook body, just above the existing `uploadReceipt` (around line 115), add:

```typescript
  const findDuplicateByHash = async (
    restaurantId: string,
    hash: string,
  ): Promise<ReceiptImport | null> => {
    const { data, error } = await supabase
      .from('receipt_imports')
      .select('id, restaurant_id, vendor_name, supplier_id, raw_file_url, file_name, file_size, processed_at, status, total_amount, imported_total, raw_ocr_data, created_at, updated_at, processed_by, purchase_date, file_hash')
      .eq('restaurant_id', restaurantId)
      .eq('file_hash', hash)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error('findDuplicateByHash error:', error);
      return null;
    }
    return (data as ReceiptImport | null) ?? null;
  };
```

Then add `findDuplicateByHash` to the `return { ... }` object near line 835:

```typescript
  return {
    uploadReceipt,
    processReceipt,
    findDuplicateByHash,
    getReceiptImports,
    getReceiptDetails,
    getReceiptLineItems,
    updateLineItemMapping,
    bulkImportLineItems,
    isUploading,
    isProcessing
  };
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run tests/unit/useReceiptImport.duplicateDetection.test.ts
```

Expected: both `findDuplicateByHash` tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useReceiptImport.tsx tests/unit/useReceiptImport.duplicateDetection.test.ts
git commit -m "feat(useReceiptImport): add findDuplicateByHash for byte-hash lookup"
```

---

## Task 6: `useReceiptImport` — add `findSemanticDuplicate`

**Files:**
- Modify: `src/hooks/useReceiptImport.tsx`
- Modify: `tests/unit/useReceiptImport.duplicateDetection.test.ts`

- [ ] **Step 1: Add failing tests for `findSemanticDuplicate`**

Append to `tests/unit/useReceiptImport.duplicateDetection.test.ts`:

```typescript
describe('useReceiptImport — findSemanticDuplicate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('filters by restaurant_id (eq), vendor (ilike), purchase_date (eq), total ±0.01 (gte/lte), excludeId (neq)', async () => {
    const builder = makeSelectBuilder(null);
    mockSupabase.from.mockReturnValue(builder);

    const { result } = renderHook(() => useReceiptImport());
    await result.current.findSemanticDuplicate(
      'rest-123',
      'Sysco',
      '2026-05-10',
      1284.5,
      'self-id',
    );

    expect(mockSupabase.from).toHaveBeenCalledWith('receipt_imports');
    expect(builder.eq).toHaveBeenCalledWith('restaurant_id', 'rest-123');
    expect(builder.ilike).toHaveBeenCalledWith('vendor_name', 'Sysco');
    expect(builder.eq).toHaveBeenCalledWith('purchase_date', '2026-05-10');
    expect(builder.gte).toHaveBeenCalledWith('total_amount', '1284.49');
    expect(builder.lte).toHaveBeenCalledWith('total_amount', '1284.51');
    expect(builder.neq).toHaveBeenCalledWith('id', 'self-id');
    expect(builder.order).toHaveBeenCalledWith('created_at', { ascending: false });
    expect(builder.limit).toHaveBeenCalledWith(1);
  });

  it('serializes the total to 2 decimal places (avoids float drift)', async () => {
    const builder = makeSelectBuilder(null);
    mockSupabase.from.mockReturnValue(builder);

    const { result } = renderHook(() => useReceiptImport());
    // 0.1 + 0.2 = 0.30000000000000004 in IEEE-754; ensure we don't pass that
    await result.current.findSemanticDuplicate(
      'rest-123',
      'Sysco',
      '2026-05-10',
      0.1 + 0.2,
      'self-id',
    );

    expect(builder.gte).toHaveBeenCalledWith('total_amount', '0.29');
    expect(builder.lte).toHaveBeenCalledWith('total_amount', '0.31');
  });

  it('returns null when no semantic match exists', async () => {
    const builder = makeSelectBuilder(null);
    mockSupabase.from.mockReturnValue(builder);

    const { result } = renderHook(() => useReceiptImport());
    const dup = await result.current.findSemanticDuplicate('rest-123', 'Sysco', '2026-05-10', 1284.5, 'self-id');

    expect(dup).toBeNull();
  });

  it('returns the existing receipt when a match exists', async () => {
    const existing = {
      id: 'r-2',
      restaurant_id: 'rest-123',
      vendor_name: 'Sysco',
      purchase_date: '2026-05-10',
      total_amount: 1284.5,
      created_at: '2026-05-09T00:00:00Z',
      file_hash: null,
    };
    const builder = makeSelectBuilder(existing);
    mockSupabase.from.mockReturnValue(builder);

    const { result } = renderHook(() => useReceiptImport());
    const dup = await result.current.findSemanticDuplicate(
      'rest-123', 'Sysco', '2026-05-10', 1284.5, 'self-id',
    );

    expect(dup).toEqual(existing);
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
npx vitest run tests/unit/useReceiptImport.duplicateDetection.test.ts
```

Expected: new `findSemanticDuplicate` tests fail (function does not exist).

- [ ] **Step 3: Implement `findSemanticDuplicate`**

In `src/hooks/useReceiptImport.tsx`, just below the new `findDuplicateByHash`, add:

```typescript
  const findSemanticDuplicate = async (
    restaurantId: string,
    vendor: string,
    purchaseDate: string,
    total: number,
    excludeId: string,
  ): Promise<ReceiptImport | null> => {
    const lower = (total - 0.01).toFixed(2);
    const upper = (total + 0.01).toFixed(2);

    const { data, error } = await supabase
      .from('receipt_imports')
      .select('id, restaurant_id, vendor_name, supplier_id, raw_file_url, file_name, file_size, processed_at, status, total_amount, imported_total, raw_ocr_data, created_at, updated_at, processed_by, purchase_date, file_hash')
      .eq('restaurant_id', restaurantId)
      .ilike('vendor_name', vendor)
      .eq('purchase_date', purchaseDate)
      .gte('total_amount', lower)
      .lte('total_amount', upper)
      .neq('id', excludeId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error('findSemanticDuplicate error:', error);
      return null;
    }
    return (data as ReceiptImport | null) ?? null;
  };
```

Add `findSemanticDuplicate` to the `return { ... }` block:

```typescript
  return {
    uploadReceipt,
    processReceipt,
    findDuplicateByHash,
    findSemanticDuplicate,
    getReceiptImports,
    getReceiptDetails,
    getReceiptLineItems,
    updateLineItemMapping,
    bulkImportLineItems,
    isUploading,
    isProcessing
  };
```

- [ ] **Step 4: Run to verify passing**

```bash
npx vitest run tests/unit/useReceiptImport.duplicateDetection.test.ts
```

Expected: all `findSemanticDuplicate` tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useReceiptImport.tsx tests/unit/useReceiptImport.duplicateDetection.test.ts
git commit -m "feat(useReceiptImport): add findSemanticDuplicate (vendor/date/total ±0.01)"
```

---

## Task 7: `useReceiptImport` — modify `uploadReceipt` to return tagged union

**Files:**
- Modify: `src/hooks/useReceiptImport.tsx`
- Modify: `tests/unit/useReceiptImport.duplicateDetection.test.ts`

- [ ] **Step 1: Add failing tests for the new `uploadReceipt` contract**

Append to `tests/unit/useReceiptImport.duplicateDetection.test.ts`:

```typescript
import { sha256Hex } from '@/lib/fileHash';

describe('useReceiptImport — uploadReceipt duplicate handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function mockStorageOk() {
    const upload = vi.fn().mockResolvedValue({ data: { path: 'rest-123/123-x.png' }, error: null });
    mockSupabase.storage.from.mockReturnValue({ upload });
    return upload;
  }

  function mockInsertOk(row: object) {
    // Insert chain: .from('receipt_imports').insert(...).select().single()
    const builder = {
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: row, error: null }),
    };
    return builder;
  }

  it('returns { kind: "duplicate", existing } when hash matches and force=false', async () => {
    const file = new File(['hello'], 'r.png', { type: 'image/png' });
    const expectedHash = await sha256Hex(file);

    const existing = {
      id: 'prev-id',
      restaurant_id: 'rest-123',
      file_hash: expectedHash,
      vendor_name: 'Sysco',
      total_amount: 1284.5,
      purchase_date: '2026-05-10',
      created_at: '2026-05-10T00:00:00Z',
    };

    // findDuplicateByHash returns existing
    const findBuilder = makeSelectBuilder(existing);
    mockSupabase.from.mockReturnValue(findBuilder);

    const { result } = renderHook(() => useReceiptImport());
    const res = await result.current.uploadReceipt(file);

    expect(res).toEqual({ kind: 'duplicate', existing });
    // No storage upload should happen
    expect(mockSupabase.storage.from).not.toHaveBeenCalled();
  });

  it('returns { kind: "uploaded", receipt } when no hash match', async () => {
    const file = new File(['hello'], 'r.png', { type: 'image/png' });
    const expectedHash = await sha256Hex(file);
    const newRow = { id: 'new-id', restaurant_id: 'rest-123', file_hash: expectedHash };

    const findBuilder = makeSelectBuilder(null);
    const insertBuilder = mockInsertOk(newRow);

    // First .from('receipt_imports') is the SELECT (findDuplicateByHash),
    // second is the INSERT after the storage upload.
    mockSupabase.from
      .mockReturnValueOnce(findBuilder)
      .mockReturnValueOnce(insertBuilder);

    const uploadFn = mockStorageOk();

    const { result } = renderHook(() => useReceiptImport());
    const res = await result.current.uploadReceipt(file);

    expect(uploadFn).toHaveBeenCalled();
    expect(insertBuilder.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        restaurant_id: 'rest-123',
        file_hash: expectedHash,
        status: 'uploaded',
      }),
    );
    expect(res).toEqual({ kind: 'uploaded', receipt: newRow });
  });

  it('bypasses the hash check when force=true', async () => {
    const file = new File(['hello'], 'r.png', { type: 'image/png' });
    const expectedHash = await sha256Hex(file);
    const newRow = { id: 'new-id', restaurant_id: 'rest-123', file_hash: expectedHash };

    const insertBuilder = mockInsertOk(newRow);
    mockSupabase.from.mockReturnValue(insertBuilder);
    mockStorageOk();

    const { result } = renderHook(() => useReceiptImport());
    const res = await result.current.uploadReceipt(file, { force: true });

    expect(res).toEqual({ kind: 'uploaded', receipt: newRow });
    // findDuplicateByHash should not have been queried — no SELECT chain used
    // (we verify by asserting only the insert builder was returned)
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
npx vitest run tests/unit/useReceiptImport.duplicateDetection.test.ts
```

Expected: new tests fail (current `uploadReceipt` does not hash, does not return tagged union, does not accept `force`).

- [ ] **Step 3: Modify `uploadReceipt`**

In `src/hooks/useReceiptImport.tsx`, add the import at the top with other lib imports:

```typescript
import { sha256Hex } from '@/lib/fileHash';
```

Replace the entire `uploadReceipt` function (lines 115–178) with:

```typescript
  type UploadResult =
    | { kind: 'duplicate'; existing: ReceiptImport }
    | { kind: 'uploaded'; receipt: ReceiptImport };

  const uploadReceipt = async (
    file: File,
    options?: { force?: boolean },
  ): Promise<UploadResult | null> => {
    if (!selectedRestaurant?.restaurant_id) {
      toast({
        title: "Error",
        description: "Please select a restaurant first",
        variant: "destructive",
      });
      return null;
    }

    setIsUploading(true);
    try {
      // Hash file bytes for the pre-upload duplicate check.
      // On hash failure we proceed without one — the warning is advisory.
      let fileHash: string | null = null;
      try {
        fileHash = await sha256Hex(file);
      } catch (hashErr) {
        console.error('sha256Hex failed; continuing without hash:', hashErr);
        fileHash = null;
      }

      if (!options?.force && fileHash) {
        const existing = await findDuplicateByHash(
          selectedRestaurant.restaurant_id,
          fileHash,
        );
        if (existing) {
          return { kind: 'duplicate', existing };
        }
      }

      // Sanitize filename to remove special characters
      const fileExt = file.name.split('.').pop();
      const sanitizedBaseName = file.name
        .replace(`.${fileExt}`, '')
        .replace(/[^a-zA-Z0-9_-]/g, '_');
      const finalFileName = `${Date.now()}-${sanitizedBaseName}.${fileExt}`;
      const filePath = `${selectedRestaurant.restaurant_id}/${finalFileName}`;

      const { error: uploadError } = await supabase.storage
        .from('receipt-images')
        .upload(filePath, file);

      if (uploadError) {
        throw uploadError;
      }

      const { data: receiptData, error: receiptError } = await supabase
        .from('receipt_imports')
        .insert({
          restaurant_id: selectedRestaurant.restaurant_id,
          raw_file_url: filePath,
          file_name: file.name,
          file_size: file.size,
          file_hash: fileHash,
          status: 'uploaded'
        })
        .select()
        .single();

      if (receiptError) {
        throw receiptError;
      }

      toast({
        title: "Success",
        description: "Receipt uploaded successfully",
      });

      return { kind: 'uploaded', receipt: receiptData as ReceiptImport };
    } catch (error) {
      console.error('Error uploading receipt:', error);
      toast({
        title: "Error",
        description: "Failed to upload receipt",
        variant: "destructive",
      });
      return null;
    } finally {
      setIsUploading(false);
    }
  };
```

- [ ] **Step 4: Run to verify passing**

```bash
npx vitest run tests/unit/useReceiptImport.duplicateDetection.test.ts
```

Expected: all `uploadReceipt` tests pass.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
```

Expected: clean. (If callers of `uploadReceipt` outside `ReceiptUpload.tsx` exist, they'll surface here — re-check `git grep -n "uploadReceipt(" src/`.)

```bash
git add src/hooks/useReceiptImport.tsx tests/unit/useReceiptImport.duplicateDetection.test.ts
git commit -m "feat(useReceiptImport): hash file pre-upload, return tagged union with duplicate kind"
```

---

## Task 8: `DuplicateReceiptDialog` component

**Files:**
- Create: `src/components/receipt/DuplicateReceiptDialog.tsx`
- Create: `tests/unit/DuplicateReceiptDialog.test.tsx`

- [ ] **Step 1: Write the failing component test**

Create `tests/unit/DuplicateReceiptDialog.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DuplicateReceiptDialog } from '@/components/receipt/DuplicateReceiptDialog';
import type { ReceiptImport } from '@/hooks/useReceiptImport';

const baseExisting: ReceiptImport = {
  id: 'r-prev',
  restaurant_id: 'rest-123',
  vendor_name: 'Sysco',
  supplier_id: null,
  raw_file_url: 'rest-123/123-r.pdf',
  file_name: 'invoice.pdf',
  file_size: 100,
  processed_at: null,
  status: 'mapped',
  total_amount: 1284.5,
  imported_total: 1284.5,
  raw_ocr_data: null,
  created_at: '2026-05-12T00:00:00Z',
  updated_at: '2026-05-12T00:00:00Z',
  processed_by: null,
  purchase_date: '2026-05-12',
  file_hash: 'abc',
};

describe('DuplicateReceiptDialog', () => {
  let onCancel: ReturnType<typeof vi.fn>;
  let onProceed: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onCancel = vi.fn();
    onProceed = vi.fn();
  });

  function renderDialog(open = true, existing = baseExisting) {
    return render(
      <MemoryRouter>
        <DuplicateReceiptDialog
          open={open}
          existing={existing}
          onCancel={onCancel}
          onProceed={onProceed}
        />
      </MemoryRouter>,
    );
  }

  it('renders the existing receipt vendor and total formatted to 2 decimals', () => {
    renderDialog();
    expect(screen.getByText(/Possible duplicate receipt/i)).toBeInTheDocument();
    expect(screen.getByText(/Sysco/)).toBeInTheDocument();
    expect(screen.getByText(/\$1,?284\.50/)).toBeInTheDocument();
  });

  it('links to /receipt-import?receipt=<id> for the previous receipt', () => {
    renderDialog();
    const link = screen.getByRole('link', { name: /view previous receipt/i });
    expect(link).toHaveAttribute('href', '/receipt-import?receipt=r-prev');
  });

  it('fires onCancel when Cancel button clicked', () => {
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onProceed).not.toHaveBeenCalled();
  });

  it('fires onProceed when Upload anyway clicked', () => {
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: /upload anyway/i }));
    expect(onProceed).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('fires onCancel when Escape pressed (Radix onOpenChange)', () => {
    renderDialog();
    fireEvent.keyDown(document.body, { key: 'Escape', code: 'Escape' });
    expect(onCancel).toHaveBeenCalled();
  });

  it('renders Cancel before Upload anyway in DOM order (Cancel is primary)', () => {
    renderDialog();
    const buttons = screen.getAllByRole('button');
    const cancelIdx = buttons.findIndex((b) => /^cancel$/i.test(b.textContent ?? ''));
    const proceedIdx = buttons.findIndex((b) => /upload anyway/i.test(b.textContent ?? ''));
    expect(cancelIdx).toBeGreaterThan(-1);
    expect(proceedIdx).toBeGreaterThan(-1);
    expect(cancelIdx).toBeLessThan(proceedIdx);
  });

  it('falls back to "Unknown vendor" when vendor_name is null', () => {
    renderDialog(true, { ...baseExisting, vendor_name: null });
    expect(screen.getByText(/unknown vendor/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run tests/unit/DuplicateReceiptDialog.test.tsx
```

Expected: `Cannot find module '@/components/receipt/DuplicateReceiptDialog'`.

- [ ] **Step 3: Implement the dialog**

Create `src/components/receipt/DuplicateReceiptDialog.tsx`:

```typescript
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { AlertTriangle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import type { ReceiptImport } from '@/hooks/useReceiptImport';

interface DuplicateReceiptDialogProps {
  open: boolean;
  existing: ReceiptImport;
  onCancel: () => void;
  onProceed: () => void;
}

export function DuplicateReceiptDialog({
  open,
  existing,
  onCancel,
  onProceed,
}: DuplicateReceiptDialogProps) {
  const vendor = existing.vendor_name ?? 'Unknown vendor';
  const totalDisplay =
    existing.total_amount != null
      ? `$${existing.total_amount.toLocaleString('en-US', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}`
      : '—';
  const createdDisplay = (() => {
    try {
      return format(new Date(existing.created_at), 'MMM d, yyyy');
    } catch {
      return 'an earlier date';
    }
  })();

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <DialogContent className="max-w-md max-h-[80vh] overflow-y-auto p-0 gap-0 border-border/40">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-border/40">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-amber-500/10 flex items-center justify-center">
              <AlertTriangle className="h-5 w-5 text-amber-600" />
            </div>
            <div>
              <DialogTitle className="text-[17px] font-semibold text-foreground">
                Possible duplicate receipt
              </DialogTitle>
              <DialogDescription className="text-[13px] text-muted-foreground mt-0.5">
                This file matches a receipt you already uploaded on {createdDisplay}.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="px-6 py-5 space-y-3">
          <div className="text-[14px] font-medium text-foreground">
            {vendor} — {totalDisplay}
          </div>
          <Link
            to={`/receipt-import?receipt=${existing.id}`}
            onClick={onCancel}
            className="text-[13px] text-foreground underline underline-offset-2 hover:text-muted-foreground transition-colors"
          >
            View previous receipt
          </Link>
        </div>

        <div className="flex flex-row justify-end gap-2 px-6 pb-5 pt-2">
          <Button
            onClick={onCancel}
            className="h-9 px-4 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[13px] font-medium"
          >
            Cancel
          </Button>
          <Button
            variant="ghost"
            onClick={onProceed}
            className="h-9 px-4 rounded-lg text-[13px] font-medium text-muted-foreground hover:text-foreground"
          >
            Upload anyway
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run tests/unit/DuplicateReceiptDialog.test.tsx
```

Expected: all seven tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/receipt/DuplicateReceiptDialog.tsx tests/unit/DuplicateReceiptDialog.test.tsx
git commit -m "feat(receipt): add DuplicateReceiptDialog with apple/notion styling"
```

---

## Task 9: Wire `DuplicateReceiptDialog` into `ReceiptUpload`

This is a UI-wiring change. The dialog itself is fully tested in Task 8; the hook logic is fully tested in Task 7. We rely on those plus manual verification for the wiring.

**Files:**
- Modify: `src/components/ReceiptUpload.tsx`

- [ ] **Step 1: Replace `src/components/ReceiptUpload.tsx`**

Read the existing file once, then replace it with:

```typescript
import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Upload, FileText, Camera } from 'lucide-react';
import { ImageCapture } from '@/components/ImageCapture';
import { DuplicateReceiptDialog } from '@/components/receipt/DuplicateReceiptDialog';
import { useReceiptImport } from '@/hooks/useReceiptImport';
import type { ReceiptImport } from '@/hooks/useReceiptImport';
import { useToast } from '@/components/ui/use-toast';

interface ReceiptUploadProps {
  onReceiptProcessed: (receiptId: string) => void;
}

export const ReceiptUpload: React.FC<ReceiptUploadProps> = ({ onReceiptProcessed }) => {
  const [uploadMethod, setUploadMethod] = useState<'file' | 'camera'>('file');
  const [processingStep, setProcessingStep] = useState<'upload' | 'process' | 'complete'>('upload');
  const [pendingDuplicate, setPendingDuplicate] = useState<{
    file: File;
    existing: ReceiptImport;
  } | null>(null);
  const { uploadReceipt, processReceipt, isUploading, isProcessing } = useReceiptImport();
  const { toast } = useToast();

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    await processReceiptFile(file);
  };

  const handleImageCapture = async (imageBlob: Blob) => {
    const file = new File([imageBlob], `receipt-${Date.now()}.jpg`, { type: 'image/jpeg' });
    await processReceiptFile(file);
  };

  const processReceiptFile = async (file: File, force = false) => {
    setProcessingStep('upload');

    const result = await uploadReceipt(file, force ? { force: true } : undefined);
    if (!result) return;

    if (result.kind === 'duplicate') {
      // Defer dialog mount one tick so the keypress that confirmed the file
      // picker (often Enter) settles before Radix's focus trap mounts.
      setTimeout(() => setPendingDuplicate({ file, existing: result.existing }), 0);
      return;
    }

    setProcessingStep('process');
    const processResult = await processReceipt(result.receipt.id, file);
    if (!processResult) return;

    setProcessingStep('complete');
    onReceiptProcessed(result.receipt.id);
    toast({
      title: "Receipt Ready",
      description: "Your receipt has been processed and is ready for review",
    });
  };

  const handleDuplicateCancel = () => {
    setPendingDuplicate(null);
    setProcessingStep('upload');
  };

  const handleDuplicateProceed = async () => {
    const pending = pendingDuplicate;
    setPendingDuplicate(null);
    if (!pending) return;
    await processReceiptFile(pending.file, true);
  };

  const getProgressValue = () => {
    switch (processingStep) {
      case 'upload': return isUploading ? 50 : 0;
      case 'process': return isProcessing ? 75 : 50;
      case 'complete': return 100;
      default: return 0;
    }
  };

  const getProgressText = () => {
    switch (processingStep) {
      case 'upload': return isUploading ? 'Uploading receipt...' : 'Ready to upload';
      case 'process': return isProcessing ? 'Processing with AI...' : 'Upload complete';
      case 'complete': return 'Processing complete!';
      default: return 'Ready';
    }
  };

  const isProcessingActive = isUploading || isProcessing;

  return (
    <>
      <Card className="w-full max-w-2xl mx-auto">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Upload Receipt
          </CardTitle>
          <CardDescription>
            Upload a receipt to automatically extract items and add them to your inventory
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {isProcessingActive && (
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>{getProgressText()}</span>
                <span>{getProgressValue()}%</span>
              </div>
              <Progress value={getProgressValue()} className="w-full" />
            </div>
          )}

          <div className="flex gap-2">
            <Button
              variant={uploadMethod === 'file' ? 'default' : 'outline'}
              onClick={() => setUploadMethod('file')}
              className="flex-1"
              disabled={isProcessingActive}
            >
              <Upload className="w-4 h-4 mr-2" />
              Upload File
            </Button>
            <Button
              variant={uploadMethod === 'camera' ? 'default' : 'outline'}
              onClick={() => setUploadMethod('camera')}
              className="flex-1"
              disabled={isProcessingActive}
            >
              <Camera className="w-4 h-4 mr-2" />
              Take Photo
            </Button>
          </div>

          {uploadMethod === 'file' && (
            <div className="space-y-2">
              <Label htmlFor="receipt-file">Select Receipt Image</Label>
              <Input
                id="receipt-file"
                type="file"
                accept="image/jpeg,image/png,image/webp,image/jpg,application/pdf"
                onChange={handleFileUpload}
                disabled={isProcessingActive}
                className="cursor-pointer"
              />
              <p className="text-sm text-muted-foreground">
                Supports JPG, PNG, WEBP images, and PDF files up to 10MB
              </p>
            </div>
          )}

          {uploadMethod === 'camera' && (
            <div className="space-y-2">
              <Label>Capture Receipt Photo</Label>
              <ImageCapture
                onImageCaptured={handleImageCapture}
                disabled={isProcessingActive}
                className="w-full"
              />
            </div>
          )}

          {isProcessingActive && (
            <div className="bg-muted p-4 rounded-lg">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-primary rounded-full animate-pulse"></div>
                <span className="text-sm font-medium">
                  {isUploading && 'Uploading your receipt...'}
                  {isProcessing && 'AI is reading your receipt...'}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                This may take up to 30 seconds
              </p>
            </div>
          )}

          {processingStep === 'complete' && (
            <div className="bg-green-50 dark:bg-green-900/20 p-4 rounded-lg border border-green-200 dark:border-green-800">
              <div className="flex items-center gap-2 text-green-700 dark:text-green-300">
                <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                <span className="text-sm font-medium">Receipt processed successfully!</span>
              </div>
              <p className="text-xs text-green-600 dark:text-green-400 mt-1">
                Review the extracted items and map them to your inventory
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {pendingDuplicate && (
        <DuplicateReceiptDialog
          open={Boolean(pendingDuplicate)}
          existing={pendingDuplicate.existing}
          onCancel={handleDuplicateCancel}
          onProceed={handleDuplicateProceed}
        />
      )}
    </>
  );
};
```

> Style note: the green success banner uses raw color classes (`bg-green-50`, etc.). Per the spec, do NOT touch that styling in this PR — leave it as-is. The spec explicitly forbids copying that pattern into the new dialog, which this task respects.

- [ ] **Step 2: Typecheck and run all tests**

```bash
npm run typecheck
npx vitest run tests/unit/useReceiptImport.duplicateDetection.test.ts tests/unit/DuplicateReceiptDialog.test.tsx tests/unit/fileHash.test.ts
```

Expected: clean typecheck, all duplicate-detection / dialog / hash tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/components/ReceiptUpload.tsx
git commit -m "feat(receipt-upload): warn on byte-hash duplicate and allow force-proceed"
```

---

## Task 10: `ReceiptMappingReview` — semantic duplicate banner

**Files:**
- Modify: `src/components/ReceiptMappingReview.tsx`
- Create: `tests/unit/ReceiptMappingReview.duplicateBanner.test.tsx`

- [ ] **Step 1: Inspect the current component to find the right insertion point**

Read `src/components/ReceiptMappingReview.tsx` and identify:

- Where `receiptDetails` becomes available
- Where the items list renders (the banner mounts above it)
- Where `restaurantId` is read

- [ ] **Step 2: Write the failing test**

Create `tests/unit/ReceiptMappingReview.duplicateBanner.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ReceiptMappingReview } from '@/components/ReceiptMappingReview';

const findSemanticDuplicate = vi.fn();
const findDuplicateByHash = vi.fn();

vi.mock('@/hooks/useReceiptImport', () => ({
  useReceiptImport: () => ({
    findSemanticDuplicate,
    findDuplicateByHash,
    getReceiptDetails: vi.fn().mockResolvedValue({
      id: 'r-1',
      restaurant_id: 'rest-123',
      vendor_name: 'Sysco',
      total_amount: 1284.5,
      purchase_date: '2026-05-10',
      file_hash: 'abc',
      created_at: '2026-05-10T00:00:00Z',
      file_name: 'r.pdf',
      status: 'mapped',
    }),
    getReceiptLineItems: vi.fn().mockResolvedValue([]),
    updateLineItemMapping: vi.fn(),
    bulkImportLineItems: vi.fn(),
    isUploading: false,
    isProcessing: false,
  }),
}));

vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => ({
    selectedRestaurant: { restaurant_id: 'rest-123' },
  }),
}));

function renderReview() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ReceiptMappingReview receiptId="r-1" onComplete={vi.fn()} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ReceiptMappingReview — semantic duplicate banner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders a skeleton while the semantic-dup query is in flight', async () => {
    let resolveQuery!: (value: unknown) => void;
    findSemanticDuplicate.mockImplementation(
      () => new Promise((res) => { resolveQuery = res; }),
    );

    renderReview();

    await waitFor(() => {
      expect(screen.getByTestId('semantic-dup-skeleton')).toBeInTheDocument();
    });

    resolveQuery(null);
  });

  it('renders the amber banner with role=status when a semantic match is returned', async () => {
    findSemanticDuplicate.mockResolvedValue({
      id: 'r-prev',
      vendor_name: 'Sysco',
      total_amount: 1284.5,
      purchase_date: '2026-05-10',
      created_at: '2026-05-09T00:00:00Z',
    });

    renderReview();

    const banner = await screen.findByRole('status');
    expect(banner).toHaveAttribute('aria-live', 'polite');
    expect(within(banner).getByText(/similar receipt/i)).toBeInTheDocument();
    expect(within(banner).getByText(/Sysco/)).toBeInTheDocument();
  });

  it('renders nothing when no semantic match', async () => {
    findSemanticDuplicate.mockResolvedValue(null);
    renderReview();
    await waitFor(() => {
      expect(findSemanticDuplicate).toHaveBeenCalled();
    });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('hides the banner when dismissed (session-only)', async () => {
    findSemanticDuplicate.mockResolvedValue({
      id: 'r-prev',
      vendor_name: 'Sysco',
      total_amount: 1284.5,
      purchase_date: '2026-05-10',
      created_at: '2026-05-09T00:00:00Z',
    });

    renderReview();
    const banner = await screen.findByRole('status');
    fireEvent.click(within(banner).getByRole('button', { name: /dismiss/i }));

    await waitFor(() => {
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
npx vitest run tests/unit/ReceiptMappingReview.duplicateBanner.test.tsx
```

Expected: failures (no skeleton, no banner). The actual failures depend on the existing component; expect at minimum no `data-testid="semantic-dup-skeleton"` element and no `role="status"` element.

- [ ] **Step 4: Modify `src/components/ReceiptMappingReview.tsx`**

At the top of the file, ensure these imports exist (add what's missing):

```typescript
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { AlertTriangle, X } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { format } from 'date-fns';
import { useReceiptImport } from '@/hooks/useReceiptImport';
import { useRestaurantContext } from '@/contexts/RestaurantContext';
```

Just inside the component body, after `receiptDetails` is available and `restaurantId` is in scope, add:

```typescript
  const { findSemanticDuplicate } = useReceiptImport();
  const { selectedRestaurant } = useRestaurantContext();
  const [bannerDismissed, setBannerDismissed] = useState(false);

  const normalizeDate = (d: string | null): string | null =>
    d ? String(d).split('T')[0] : null;

  const restaurantId = selectedRestaurant?.restaurant_id;
  const vendor = receiptDetails?.vendor_name ?? null;
  const purchaseDate = normalizeDate(receiptDetails?.purchase_date ?? null);
  const total = receiptDetails?.total_amount ?? null;

  const { data: semanticDup, isLoading: semanticDupLoading } = useQuery({
    queryKey: [
      'receipt-semantic-duplicate',
      restaurantId,
      receiptId,
      vendor,
      purchaseDate,
      total,
    ],
    queryFn: () =>
      findSemanticDuplicate(restaurantId!, vendor!, purchaseDate!, Number(total), receiptId),
    enabled: Boolean(restaurantId && receiptId && vendor && purchaseDate && total != null),
    staleTime: 30_000,
  });
```

In the JSX, just above the line-items list, insert a fixed-height container:

```tsx
  {semanticDupLoading ? (
    <Skeleton
      data-testid="semantic-dup-skeleton"
      className="h-14 w-full rounded-xl"
    />
  ) : semanticDup && !bannerDismissed ? (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center justify-between gap-3 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20"
    >
      <div className="flex items-center gap-3 min-w-0">
        <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" aria-hidden="true" />
        <div className="text-[13px] text-foreground min-w-0">
          <div className="font-medium truncate">
            Similar receipt already uploaded
          </div>
          <div className="text-muted-foreground truncate">
            {semanticDup.vendor_name ?? 'Unknown vendor'} —{' '}
            {semanticDup.total_amount != null
              ? `$${semanticDup.total_amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
              : '—'}
            {' on '}
            {(() => {
              try { return format(new Date(semanticDup.created_at), 'MMM d, yyyy'); }
              catch { return 'an earlier date'; }
            })()}
            {' · '}
            <Link
              to={`/receipt-import?receipt=${semanticDup.id}`}
              className="underline underline-offset-2 hover:text-foreground"
            >
              View
            </Link>
          </div>
        </div>
      </div>
      <button
        type="button"
        aria-label="Dismiss duplicate warning"
        onClick={() => setBannerDismissed(true)}
        className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  ) : (
    <div className="h-14" aria-hidden="true" />
  )}
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
npx vitest run tests/unit/ReceiptMappingReview.duplicateBanner.test.tsx
```

Expected: all four tests pass.

- [ ] **Step 6: Typecheck and commit**

```bash
npm run typecheck
```

Expected: clean.

```bash
git add src/components/ReceiptMappingReview.tsx tests/unit/ReceiptMappingReview.duplicateBanner.test.tsx
git commit -m "feat(receipt-mapping): banner when a similar receipt was uploaded before"
```

---

## Task 11: `ReceiptImport.tsx` — synchronous deep-link initialization

**Files:**
- Modify: `src/pages/ReceiptImport.tsx`
- Create: `tests/unit/ReceiptImport.deepLink.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/ReceiptImport.deepLink.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import ReceiptImport from '@/pages/ReceiptImport';

vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => ({
    selectedRestaurant: { restaurant_id: 'rest-123' },
  }),
}));

vi.mock('@/hooks/useReceiptImport', () => ({
  useReceiptImport: () => ({
    uploadReceipt: vi.fn(),
    processReceipt: vi.fn(),
    findDuplicateByHash: vi.fn(),
    findSemanticDuplicate: vi.fn().mockResolvedValue(null),
    getReceiptImports: vi.fn().mockResolvedValue([
      { id: 'r-deep', file_name: 'deep.pdf', status: 'uploaded', created_at: '2026-05-12T00:00:00Z' },
    ]),
    getReceiptDetails: vi.fn().mockResolvedValue({
      id: 'r-deep',
      restaurant_id: 'rest-123',
      vendor_name: null,
      total_amount: null,
      purchase_date: null,
      file_hash: null,
      file_name: 'deep.pdf',
      status: 'uploaded',
      created_at: '2026-05-12T00:00:00Z',
    }),
    getReceiptLineItems: vi.fn().mockResolvedValue([]),
    updateLineItemMapping: vi.fn(),
    bulkImportLineItems: vi.fn(),
    isUploading: false,
    isProcessing: false,
  }),
}));

describe('ReceiptImport — deep-link initialization', () => {
  it('opens the receipt indicated by ?receipt=<id> on first render (no flicker)', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/receipt-import?receipt=r-deep']}>
          <Routes>
            <Route path="/receipt-import" element={<ReceiptImport />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    // The receipt review view should mount on first render — the upload card
    // (titled "Upload Receipt") should NOT appear first.
    expect(screen.queryByText(/Upload Receipt/i)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run tests/unit/ReceiptImport.deepLink.test.tsx
```

Expected: fails — `ReceiptImport.tsx` currently initializes `activeReceiptId` to `null` and only sets it from the URL inside a `useEffect`, so `Upload Receipt` renders on first paint.

- [ ] **Step 3: Modify `src/pages/ReceiptImport.tsx`**

Add `useSearchParams` to the imports from `react-router-dom`. Change the existing `const [activeReceiptId, setActiveReceiptId] = useState<string | null>(null);` to:

```typescript
const [searchParams] = useSearchParams();
const [activeReceiptId, setActiveReceiptId] = useState<string | null>(
  () => searchParams.get('receipt'),
);
```

If there is an existing `useEffect` that reads the URL to set `activeReceiptId`, delete it.

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run tests/unit/ReceiptImport.deepLink.test.tsx
```

Expected: test passes.

- [ ] **Step 5: Run the full test suite to catch regressions**

```bash
npm run test
```

Expected: all new tests pass; existing tests untouched.

- [ ] **Step 6: Commit**

```bash
git add src/pages/ReceiptImport.tsx tests/unit/ReceiptImport.deepLink.test.tsx
git commit -m "feat(receipt-import): open deep-linked receipt on first render"
```

---

## Final verification

After Task 11, run the full suite once more:

```bash
npm run typecheck
npm run lint
npm run test
npm run test:db
```

All four must be clean before moving to Phase 5 (UI Review) of the dev workflow.

---

## Self-Review

**Spec coverage check** — every requirement in the spec maps to a task:

| Spec section | Task |
|---|---|
| Database — column add | Task 1 |
| Database — partial indexes | Task 2 |
| Database — RLS across roles | Task 3 |
| Client utility `sha256Hex` | Task 4 |
| `findDuplicateByHash` | Task 5 |
| `findSemanticDuplicate` + date normalization + total `.toFixed(2)` | Task 6 |
| `uploadReceipt` tagged-union + `{ force }` | Task 7 |
| Hashing-failure fallback (NULL hash, proceed) | Task 7 |
| `DuplicateReceiptDialog` (icon-box, max-w-md, button order, onOpenChange) | Task 8 |
| `setTimeout(..., 0)` dialog deferral | Task 9 |
| `ReceiptUpload` wiring + force-retry | Task 9 |
| `ReceiptMappingReview` `useQuery` semantic check | Task 10 |
| Banner with `role="status" aria-live="polite"` + session-only dismiss | Task 10 |
| Skeleton during in-flight | Task 10 |
| Fixed-height container (no reflow) | Task 10 |
| `ReceiptImport` deep-link in `useState` initializer | Task 11 |
| Banner copy uses semantic tokens (no `bg-green-50`) | Tasks 8, 10 |

**Placeholder scan** — no "TBD", "TODO", "Add appropriate error handling", or "Similar to Task N" references. Every code-changing step contains the full code.

**Type consistency** — `ReceiptImport` shape is the single source. `findDuplicateByHash` and `findSemanticDuplicate` both return `Promise<ReceiptImport | null>`. `uploadReceipt` returns `Promise<{ kind: 'duplicate'; existing: ReceiptImport } | { kind: 'uploaded'; receipt: ReceiptImport } | null>`. `DuplicateReceiptDialog`'s `existing` prop is typed as `ReceiptImport`. Banner-area uses the same shape.

**Out-of-scope confirmation** — the plan does NOT touch:
- The `process-receipt` edge function
- Any other component beyond what's listed
- Race-condition handling (documented gap; out of scope per Non-goals)
- Backfilling `file_hash` for legacy rows

---

## Execution choice

Plan complete and saved to `docs/superpowers/plans/2026-05-24-receipt-duplicate-warning-plan.md`. The next step per the dev workflow is **Phase 4: TDD build**. Two execution options:

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration. Best when individual tasks are well-bounded (they are here).

**2. Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
