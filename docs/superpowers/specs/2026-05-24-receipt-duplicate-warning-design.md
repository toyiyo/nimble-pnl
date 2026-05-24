# Receipt duplicate-upload warning — design

**Status:** Approved
**Date:** 2026-05-24
**Branch:** `feature/receipt-duplicate-warning`

## Summary

Warn the user when they upload a receipt that appears to have been uploaded
before, so they don't double-count inventory or waste time mapping a receipt
they've already processed. The warning is soft — the user can always proceed.

Two complementary checks:

1. **Pre-upload byte-hash check** — SHA-256 over the file bytes, queried
   against `receipt_imports` before the file enters storage. Catches the most
   common case: same file re-selected by mistake.
2. **Post-OCR semantic check** — after the existing AI extraction populates
   `vendor_name`, `purchase_date`, and `total_amount`, look for an existing
   receipt with the same three values. Catches re-scans/re-photos of the same
   paper receipt where bytes differ but the receipt itself is identical.

Both surface in the upload / mapping flow. Neither blocks the user.

## Goals

- Detect exact-file re-uploads before storage is touched.
- Detect semantic re-uploads (different file bytes, same receipt) after OCR.
- Show the previous receipt's vendor / date / total so the user can decide.
- Allow the user to proceed in every case (no hard blocks).

## Non-goals

- Auto-deleting / auto-merging the duplicate.
- Server-side enforcement (no DB constraints, no edge-function rejection).
- Detecting near-duplicates with fuzzy matching beyond ±$0.01 on total.
- Backfilling `file_hash` for receipts uploaded before this feature shipped.

## Database

Add one column + one partial index to `receipt_imports`:

```sql
ALTER TABLE public.receipt_imports
  ADD COLUMN file_hash TEXT;

COMMENT ON COLUMN public.receipt_imports.file_hash IS
  'SHA-256 hex digest of the uploaded file bytes. NULL for receipts uploaded before this column existed.';

CREATE INDEX receipt_imports_restaurant_hash_idx
  ON public.receipt_imports (restaurant_id, file_hash)
  WHERE file_hash IS NOT NULL;
```

Partial index reasoning: legacy rows have `NULL` hashes and can never match,
so excluding them keeps the index smaller and faster.

RLS is already restaurant-scoped on `receipt_imports`; no policy changes
needed. The new column inherits the same visibility.

No new index for the semantic match. Per-restaurant receipt counts are
bounded (typical < 5k), and the filter `restaurant_id = ? AND vendor_name = ?
AND purchase_date = ? AND total_amount BETWEEN ? AND ?` will use the existing
`restaurant_id` index and scan cheaply within that subset.

## Client architecture

### New utility: `src/lib/fileHash.ts`

```typescript
export async function sha256Hex(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
```

Modeled after the existing pattern in `src/utils/kiosk.ts:34`. Lowercase hex
to match common conventions.

### `useReceiptImport` changes

Two new query helpers and a modified upload signature.

```typescript
// New
findDuplicateByHash(restaurantId, hash) → ReceiptImport | null

// New
findSemanticDuplicate(restaurantId, vendor, purchaseDate, total, excludeId)
  → ReceiptImport | null
//   filters: restaurant_id = ? AND vendor_name ILIKE ?
//            AND purchase_date = ? AND total_amount BETWEEN total-0.01 AND total+0.01
//            AND id <> excludeId
//   order: created_at DESC, limit 1

// Modified
uploadReceipt(file, options?: { force?: boolean })
  → { kind: 'duplicate', existing: ReceiptImport }
  | { kind: 'uploaded', receipt: ReceiptImport }
  | null  // on error, preserves today's contract
```

Behavior of the modified `uploadReceipt`:

1. Hash the file via `sha256Hex`. On hash failure (rare): log, set hash to
   `null`, continue as a normal upload — duplicate warning is non-essential.
2. If `!force`: call `findDuplicateByHash(restaurantId, hash)`. If a row
   comes back, return `{ kind: 'duplicate', existing }` immediately. The file
   is **not** uploaded; the DB row is **not** inserted.
3. Otherwise (or if `force === true`): upload to storage as today, insert the
   `receipt_imports` row with `file_hash` set, return `{ kind: 'uploaded',
   receipt }`.

`processReceipt` is unchanged. The semantic check is a separate call the
mapping-review screen makes after OCR has populated the fields.

### `ReceiptUpload.tsx` changes

Add state for a pending duplicate:

```typescript
const [pendingDuplicate, setPendingDuplicate] = useState<{
  file: File;
  existing: ReceiptImport;
} | null>(null);
```

`processReceiptFile(file)` becomes:

1. `const result = await uploadReceipt(file);`
2. If `result?.kind === 'duplicate'`, set `pendingDuplicate = { file, existing: result.existing }` and stop.
3. If `result?.kind === 'uploaded'`, continue with `processReceipt(...)` and `onReceiptProcessed(...)` as today.

The dialog mounts at the bottom of the component when `pendingDuplicate` is
non-null. Cancel clears `pendingDuplicate`. Proceed calls
`uploadReceipt(file, { force: true })` and continues.

### `ReceiptMappingReview.tsx` changes

On mount, after the receipt's details load and if all three OCR fields are
present, call `findSemanticDuplicate(restaurantId, vendor, date, total,
receiptId)`. If a row is returned, render an inline amber banner at the top
of the review pane with the same content as the dialog (date uploaded,
vendor, total, "View previous receipt" link) and a dismiss button. Dismissal
is session-only — `useState`, not stored.

Banner-not-modal here because the user has already invested time uploading +
OCR'ing; interrupting them with a modal at the mapping stage would feel
heavier than the situation warrants. The information is visible immediately
above the items they're about to map.

### Shared dialog `src/components/receipt/DuplicateReceiptDialog.tsx`

Apple/Notion styling per CLAUDE.md. Used by `ReceiptUpload` only (modal flow).
Props:

```typescript
interface DuplicateReceiptDialogProps {
  open: boolean;
  existing: ReceiptImport;
  onCancel: () => void;
  onProceed: () => void;
}
```

The "View previous receipt" link uses `react-router-dom`'s `<Link>` to
`/receipts?receipt=<existing.id>`. `ReceiptImport.tsx` is updated to read
`?receipt=` from `useSearchParams` on mount and set `activeReceiptId`
accordingly — a small change that also keeps deep-linking to a specific
receipt working in general. Clicking the link closes the dialog (treated
as cancel).

Rendered content (mock):

```
┌── Possible duplicate receipt ───────────┐
│ ⚠  This file matches a receipt you      │
│    already uploaded on May 12, 2026.    │
│                                          │
│    Sysco — $1,284.50                    │
│    [View previous receipt]               │
│                                          │
│        [Cancel]  [Upload anyway]         │
└──────────────────────────────────────────┘
```

Cancel is the safer/default action — receives `autoFocus`.

## Error handling and edge cases

- **Hashing failure (e.g., enormous file, browser OOM):** catch, log, set the
  inserted row's `file_hash` to `null`, proceed with the upload. Warning is a
  nice-to-have; the upload itself must remain reliable.
- **Legacy receipts (`file_hash IS NULL`):** excluded by the partial index;
  can't match by hash. They can still match semantically.
- **OCR fields incomplete:** if any of `vendor_name`, `purchase_date`, or
  `total_amount` is null after OCR, skip the semantic check. JS-side
  `null === null` would otherwise produce false positives across every
  no-OCR receipt.
- **Self-match exclusion:** semantic query passes the current `receipt.id` as
  `excludeId` and filters with `.neq('id', excludeId)`.
- **Float tolerance on total:** server-side `.gte(total - 0.01).lte(total +
  0.01)` to absorb numeric round-trip drift between client and Postgres.
- **Race condition (two simultaneous uploads of the same file):** acceptable.
  Both rows insert with the same hash; subsequent uploads warn against
  whichever was created first (most recent by `created_at DESC LIMIT 1`).
- **Banner dismissal:** session-only `useState`. No persisted "I already
  acknowledged this" flag.

## Testing strategy

| Layer | What                                                                                   | File                                                              |
|-------|----------------------------------------------------------------------------------------|-------------------------------------------------------------------|
| Unit  | `sha256Hex` known-answer vectors (empty blob → `e3b0c4…`, "hello" → `2cf24d…`)         | `tests/unit/fileHash.test.ts`                                     |
| Unit  | `findDuplicateByHash` query shape; `findSemanticDuplicate` filters incl. ±$0.01 window | `tests/unit/useReceiptImport.duplicateDetection.test.ts`          |
| Unit  | `uploadReceipt` returns `{ kind: 'duplicate', existing }` when hash matches and force=false; uploads when force=true | same file                                       |
| Unit  | `DuplicateReceiptDialog` renders existing receipt details and fires the right callbacks | `tests/unit/DuplicateReceiptDialog.test.tsx`                      |
| Unit  | `ReceiptMappingReview` shows banner when semantic dup exists, hides when not, hides on dismiss | `tests/unit/ReceiptMappingReview.duplicateBanner.test.tsx` |
| pgTAP | `file_hash` column exists; partial index exists with correct WHERE clause; RLS still requires same restaurant on a SELECT-by-hash | `supabase/tests/receipt_file_hash.test.sql` |

All vitest tests use the existing `tests/helpers` pattern. Mocks supply a
`from(...).select(...)` chain so the query filters are observable as
arguments.

## Files

### New
- `supabase/migrations/<timestamp>_add_file_hash_to_receipt_imports.sql`
- `supabase/tests/receipt_file_hash.test.sql`
- `src/lib/fileHash.ts`
- `src/components/receipt/DuplicateReceiptDialog.tsx`
- `tests/unit/fileHash.test.ts`
- `tests/unit/useReceiptImport.duplicateDetection.test.ts`
- `tests/unit/DuplicateReceiptDialog.test.tsx`
- `tests/unit/ReceiptMappingReview.duplicateBanner.test.tsx`

### Modified
- `src/hooks/useReceiptImport.tsx` — add `file_hash` to `ReceiptImport`
  interface; `findDuplicateByHash`; `findSemanticDuplicate`; modify
  `uploadReceipt` to return a tagged union and accept `{ force }`.
- `src/components/ReceiptUpload.tsx` — wire the dialog and force-retry flow.
- `src/components/ReceiptMappingReview.tsx` — fetch semantic dup on mount;
  render banner.
- `src/pages/ReceiptImport.tsx` — read `?receipt=<id>` from `useSearchParams`
  on mount to support deep-linking from the dialog.

## Open questions

None.

## Decided trade-offs

- **No hard block.** Receipts can legitimately repeat (weekly invoices at the
  same total). Forcing the user to delete a prior receipt to upload a new
  identical one would be more annoying than the duplication risk warrants.
- **No fuzzy total match beyond ±$0.01.** Wider windows (e.g. ±$1) start
  catching unrelated receipts. ±$0.01 only absorbs the numeric round-trip,
  not "the receipt was slightly different."
- **No edge-function involvement.** All detection is a normal RLS-protected
  client query. The existing `process-receipt` edge function does not need
  any change, which keeps the diff small and the surface area for review
  narrow.
