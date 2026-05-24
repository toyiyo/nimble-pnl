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

`receipt_imports` today has **no indexes at all** beyond the primary key
(verified by grepping every migration file). The semantic check's
`restaurant_id` filter would do a sequential scan on every upload without
a new index. Two indexes are added.

### Migration 1 — column add (transactional)

```sql
ALTER TABLE public.receipt_imports
  ADD COLUMN IF NOT EXISTS file_hash TEXT;

COMMENT ON COLUMN public.receipt_imports.file_hash IS
  'Lowercase-hex SHA-256 digest of the uploaded file bytes. NULL for receipts uploaded before this column existed or when client-side hashing failed.';
```

### Migration 2 — indexes (non-transactional)

`CREATE INDEX CONCURRENTLY` cannot run inside a transaction, so the
indexes go in a separate migration file. This matches the existing
codebase precedent (`20260521133931_bulk_set_employee_availability_index.sql`).

```sql
-- Hash lookup: WHERE restaurant_id = ? AND file_hash = ?
-- Partial: legacy NULL-hash rows can never match, excluding keeps it small.
CREATE INDEX CONCURRENTLY IF NOT EXISTS
  receipt_imports_restaurant_hash_idx
  ON public.receipt_imports (restaurant_id, file_hash)
  WHERE file_hash IS NOT NULL;

-- Semantic lookup: WHERE restaurant_id = ? AND purchase_date = ?
-- Vendor name and total are residual filters on the per-restaurant /
-- per-date subset (typically 1–3 rows), so they don't need to be in
-- the index. This keeps the index narrow and useful for other
-- restaurant-by-date queries (e.g. dashboards, receipt history).
CREATE INDEX CONCURRENTLY IF NOT EXISTS
  receipt_imports_restaurant_purchase_date_idx
  ON public.receipt_imports (restaurant_id, purchase_date)
  WHERE purchase_date IS NOT NULL;
```

### Why two migrations

A transactional `CREATE INDEX` would lock the table during the build,
blocking concurrent uploads. `CREATE INDEX CONCURRENTLY` avoids that
but cannot live inside a migration transaction. The split lets the
column add stay transactional (safe rollback) while the indexes build
without blocking.

### Why NOT a composite `(restaurant_id, vendor_name, purchase_date)`

`vendor_name` is compared with `ILIKE` (case-insensitive) because OCR
output casing is not normalized. A standard B-tree index can't satisfy
`ILIKE` regardless. With `(restaurant_id, purchase_date)` the database
narrows to the few receipts at the same restaurant on the same date,
then evaluates `vendor_name ILIKE ?` and the `BETWEEN` clause on that
tiny set. No `pg_trgm` index is justified at expected receipt volumes.

### RLS

RLS is unchanged. The existing policies on `receipt_imports` scope by
`restaurant_id` via the `user_restaurants` subquery on all DML
operations, and the SELECT policy further restricts to roles
`owner`/`manager`. The new `file_hash` column inherits both
constraints. The pgTAP test (see Testing) verifies this for a `chef`
and a `collaborator_inventory` user as well, not just role coverage
that today's policies happen to grant.

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
// New — exact byte-hash match
findDuplicateByHash(restaurantId, hash) → Promise<ReceiptImport | null>
//   .from('receipt_imports')
//     .select(...)
//     .eq('restaurant_id', restaurantId)
//     .eq('file_hash', hash)        // lowercase hex
//     .order('created_at', { ascending: false })
//     .limit(1)
//     .maybeSingle()

// New — semantic match. Caller normalizes purchaseDate to 'YYYY-MM-DD'
// and total to a 2-decimal string (e.g. total.toFixed(2)).
findSemanticDuplicate(restaurantId, vendor, purchaseDate, total, excludeId)
  → Promise<ReceiptImport | null>
//   .from('receipt_imports')
//     .select(...)
//     .eq('restaurant_id', restaurantId)
//     .ilike('vendor_name', vendor)           // case-insensitive equality
//     .eq('purchase_date', purchaseDate)      // bare 'YYYY-MM-DD'
//     .gte('total_amount', (total - 0.01).toFixed(2))
//     .lte('total_amount', (total + 0.01).toFixed(2))
//     .neq('id', excludeId)
//     .order('created_at', { ascending: false })
//     .limit(1)
//     .maybeSingle()

// Modified
uploadReceipt(file, options?: { force?: boolean })
  → Promise<
      | { kind: 'duplicate'; existing: ReceiptImport }
      | { kind: 'uploaded'; receipt: ReceiptImport }
      | null  // on error, preserves today's contract
    >
```

**Value normalization at the caller (important):**

- `purchaseDate` may arrive from OCR as a full ISO timestamp
  (`2026-05-10T00:00:00+00:00`). Postgres `DATE` equality won't match
  that, so the caller normalizes with `purchaseDate.split('T')[0]`
  before the query. The OCR pipeline today stores `purchase_date` as
  `DATE`, but the React side sometimes round-trips through `new
  Date()`. Normalizing client-side is the cheap fix.
- `total` is serialized via `.toFixed(2)` so the request body carries
  `"1284.50"`, not a float-rounded `1284.4999999999998`.
- `hash` is always lowercase hex (`sha256Hex` guarantees this).
- `vendor` is passed as-is; the `ILIKE` operator absorbs OCR case
  differences. No insert-side case normalization is required.

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
2. If `result?.kind === 'duplicate'`, defer the dialog open by one tick:
   `setTimeout(() => setPendingDuplicate({ file, existing: result.existing }), 0)`
   and stop. The deferral lets the keypress that confirmed the OS file
   picker (often Enter) settle before the dialog mounts — otherwise that
   keypress can leak through Radix's focus trap and immediately activate
   the first focusable element in the dialog.
3. If `result?.kind === 'uploaded'`, continue with `processReceipt(...)` and `onReceiptProcessed(...)` as today.

The dialog mounts at the bottom of the component when `pendingDuplicate` is
non-null. Cancel clears `pendingDuplicate`. Proceed calls
`uploadReceipt(file, { force: true })` and continues.

> Style note: the existing `ReceiptUpload.tsx` uses raw color classes
> (`bg-green-50`, `text-green-700`) at the success banner. Do **not**
> mirror that pattern in the new dialog or in any banner — use the
> semantic tokens documented below and in CLAUDE.md.

### `ReceiptMappingReview.tsx` changes

Wrap the semantic check in React Query (per CLAUDE.md's "no manual
caching" rule):

```typescript
const { data: semanticDup, isLoading: semanticDupLoading } = useQuery({
  queryKey: [
    'receipt-semantic-duplicate',
    restaurantId,
    receiptId,
    receipt?.vendor_name,
    receipt?.purchase_date,
    receipt?.total_amount,
  ],
  queryFn: () =>
    findSemanticDuplicate(
      restaurantId,
      receipt.vendor_name,
      normalizeDate(receipt.purchase_date),
      Number(receipt.total_amount),
      receiptId,
    ),
  enabled: Boolean(
    restaurantId &&
    receiptId &&
    receipt?.vendor_name &&
    receipt?.purchase_date &&
    receipt?.total_amount != null,
  ),
  staleTime: 30_000,
});
```

The banner area always renders a fixed-height container so the page
doesn't reflow when the query resolves:

- While `semanticDupLoading`: render `<Skeleton className="h-14 w-full rounded-xl" />`
- When `semanticDup` is non-null and not dismissed: render the amber banner
- Otherwise: render an empty `<div className="h-14" />` so the container preserves height during the in-flight window only

The banner itself wraps in `<div role="status" aria-live="polite">` so
screen readers announce when it appears asynchronously. The dismiss
button uses `aria-label="Dismiss duplicate warning"` and styles as
`text-muted-foreground hover:text-foreground transition-colors`.
Dismissal is session-only — `useState` inside the component. Returning
to the page (remount) re-runs the query; the banner reappears if the
match still exists. That's acceptable because the duplicate is
contextual advice, not an acknowledgement gate.

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
`/receipt-import?receipt=<existing.id>` (the route is registered as
`/receipt-import` in `App.tsx:261`, not `/receipts`).

`ReceiptImport.tsx` reads `?receipt=<id>` synchronously inside the
`useState` initializer — not in a `useEffect` — so a hard refresh of
the deep-link URL initializes the active-receipt state on first
render, with no tab flicker:

```typescript
const [searchParams] = useSearchParams();
const [activeReceiptId, setActiveReceiptId] = useState<string | null>(
  () => searchParams.get('receipt'),
);
```

Clicking the dialog's link closes the dialog (treated as cancel) so
the file isn't stuck in upload-pending state.

#### Structure and styling

Use CLAUDE.md's "Dialog Structure" pattern:

- `<DialogContent className="max-w-md max-h-[80vh] overflow-y-auto p-0 gap-0 border-border/40">` — `max-w-md` because this is a small confirmation, not a form
- Header uses the icon-box pattern: `h-10 w-10 rounded-xl bg-amber-500/10` containing `<AlertTriangle className="h-5 w-5 text-amber-600" />`. `bg-amber-500/10` is theme-aware (per CLAUDE.md AI suggestion panel); do **not** use raw `bg-amber-50`/`dark:bg-amber-900/20`.
- `<DialogTitle>`: `text-[17px] font-semibold text-foreground` → "Possible duplicate receipt"
- `<DialogDescription>`: `text-[13px] text-muted-foreground` → "This file matches a receipt you already uploaded on {existing.created_at, MMM d yyyy}." `DialogDescription` is required so Radix wires `aria-describedby` for screen readers.
- Body: `<div className="px-6 py-5 space-y-3">` with one row:
  - `<div className="text-[14px] font-medium text-foreground">{existing.vendor_name} — ${existing.total_amount.toFixed(2)}</div>`
  - `<Link className="text-[13px] text-foreground underline underline-offset-2 hover:text-muted-foreground transition-colors">View previous receipt</Link>`
- Footer: a plain `<div className="flex flex-row justify-end gap-2 px-6 pb-5 pt-2">` so the buttons stay side-by-side on mobile (the default `<DialogFooter>` uses `flex-col-reverse` on small viewports, which would put "Upload anyway" above "Cancel").

#### Buttons

The footer reads `[Cancel] [Upload anyway]` left-to-right. Cancel is
the **primary** action because it's the safer default:

- Cancel: `<Button className="h-9 px-4 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[13px] font-medium">Cancel</Button>`
- Upload anyway: `<Button variant="ghost" className="h-9 px-4 rounded-lg text-[13px] font-medium text-muted-foreground hover:text-foreground">Upload anyway</Button>`

This inverts the usual "primary action on the right" convention. We
do this on purpose: the affirmative path is the one we want to make
the user think about.

#### Close/dismiss wiring

`<Dialog open={open} onOpenChange={(next) => { if (!next) onCancel(); }}>`
— the X button, Escape key, click-outside, and the explicit Cancel
button all flow through `onCancel`. The new component does **not**
hide Radix's built-in X close button.

#### Focus

No `autoFocus` on any specific button. Radix's focus trap moves focus
to the first focusable element on mount; the deferred `setTimeout`
in `ReceiptUpload` (see above) ensures stray Enter keypresses from
the file picker don't activate it before the user can read the
dialog.

Mock (decorative — the real layout follows the structure above):

```
┌─ [⚠] Possible duplicate receipt ─────────┐
│       This file matches a receipt you    │
│       already uploaded on May 12, 2026.  │
│                                          │
│  Sysco — $1,284.50                       │
│  View previous receipt                   │
│                                          │
│              [Cancel] [Upload anyway]    │
└──────────────────────────────────────────┘
```

## Error handling and edge cases

- **Hashing failure (e.g., enormous file, browser OOM):** catch, log, set the
  inserted row's `file_hash` to `null`, proceed with the upload. Warning is a
  nice-to-have; the upload itself must remain reliable.
- **Legacy receipts (`file_hash IS NULL`):** excluded by the partial index;
  can't match by hash. They can still match semantically.
- **OCR fields incomplete:** if any of `vendor_name`, `purchase_date`, or
  `total_amount` is null after OCR, the React Query's `enabled` flag is false
  and the semantic check never fires. JS-side `null === null` would otherwise
  produce false positives across every no-OCR receipt.
- **Self-match exclusion:** semantic query passes the current `receipt.id` as
  `excludeId` and filters with `.neq('id', excludeId)`.
- **Float tolerance on total:** caller passes `(total ± 0.01).toFixed(2)` so
  the request body carries decimal strings, not floats. Server-side
  `.gte(...).lte(...)` then absorbs numeric round-trip drift between client
  and Postgres NUMERIC.
- **Date type mismatch:** OCR sometimes round-trips `purchase_date` through
  `new Date()` and stringifies as a full ISO timestamp. Postgres `DATE`
  equality won't match that. The caller normalizes to `YYYY-MM-DD` via
  `String(date).split('T')[0]` before the query. There is a unit test vector
  for this exact path.
- **Race condition (two simultaneous uploads of the same file):** documented
  gap. The hash check is a non-atomic read-then-insert. If two upload calls
  fire concurrently from the same session (e.g., double-click) and the hash
  doesn't exist yet, **both will succeed without warning** and the second
  copy lands in storage and `receipt_imports`. Subsequent uploads warn
  against whichever was created first (`created_at DESC LIMIT 1`). We accept
  this gap because (a) the window is short (single concurrent upload pair),
  (b) the feature is a soft warning anyway, and (c) the alternative
  (server-side `UNIQUE` constraint) is explicitly out of scope per the
  Non-goals section.
- **Banner dismissal:** session-only `useState`. No persisted "I already
  acknowledged this" flag. On remount the query re-runs and the banner
  reappears if the match still exists.
- **Deep-link with stale ID:** if the `?receipt=<id>` URL points at a deleted
  receipt, `ReceiptMappingReview` will already show its own not-found state.
  No new handling required.

## Testing strategy

| Layer | What                                                                                                                                          | File                                                              |
|-------|-----------------------------------------------------------------------------------------------------------------------------------------------|-------------------------------------------------------------------|
| Unit  | `sha256Hex` known-answer vectors (empty blob → `e3b0c4…`, "hello" → `2cf24d…`)                                                                | `tests/unit/fileHash.test.ts`                                     |
| Unit  | `findDuplicateByHash` query shape; `findSemanticDuplicate` filters incl. ±$0.01 window AND date normalization (ISO timestamp input → DATE eq) | `tests/unit/useReceiptImport.duplicateDetection.test.ts`          |
| Unit  | `uploadReceipt` returns `{ kind: 'duplicate', existing }` when hash matches and force=false; uploads when force=true                          | same file                                                         |
| Unit  | `DuplicateReceiptDialog` renders existing receipt details, fires callbacks, X/Escape both invoke onCancel                                     | `tests/unit/DuplicateReceiptDialog.test.tsx`                      |
| Unit  | `ReceiptMappingReview` shows skeleton while query in-flight, banner when dup exists, nothing when not, hides on dismiss, has `role="status"`  | `tests/unit/ReceiptMappingReview.duplicateBanner.test.tsx`        |
| Unit  | `ReceiptImport` initial render reads `?receipt=<id>` from search params and opens the receipt without a tab flicker                           | `tests/unit/ReceiptImport.deepLink.test.tsx`                      |
| pgTAP | `file_hash` column exists; both indexes exist with correct WHERE clauses; SELECT RLS denies cross-restaurant for `owner`, `manager`, `chef`, and `collaborator_inventory` | `supabase/tests/receipt_file_hash.test.sql`           |

All vitest tests use the existing `tests/helpers` pattern. Mocks supply a
`from(...).select(...)` chain so the query filters are observable as
arguments.

## Files

### New
- `supabase/migrations/<timestamp>_add_file_hash_to_receipt_imports.sql` (column + comment, transactional)
- `supabase/migrations/<timestamp+1>_add_file_hash_indexes.sql` (CONCURRENTLY indexes, non-transactional)
- `supabase/tests/receipt_file_hash.test.sql`
- `src/lib/fileHash.ts`
- `src/components/receipt/DuplicateReceiptDialog.tsx`
- `tests/unit/fileHash.test.ts`
- `tests/unit/useReceiptImport.duplicateDetection.test.ts`
- `tests/unit/DuplicateReceiptDialog.test.tsx`
- `tests/unit/ReceiptMappingReview.duplicateBanner.test.tsx`
- `tests/unit/ReceiptImport.deepLink.test.tsx`

### Modified
- `src/hooks/useReceiptImport.tsx` — add `file_hash` to `ReceiptImport`
  interface; `findDuplicateByHash`; `findSemanticDuplicate`; modify
  `uploadReceipt` to return a tagged union and accept `{ force }`.
- `src/components/ReceiptUpload.tsx` — wire the dialog and force-retry flow,
  including the one-tick `setTimeout` deferral on dialog open.
- `src/components/ReceiptMappingReview.tsx` — wrap semantic-dup fetch in
  `useQuery` (staleTime 30s); render skeleton/banner with `aria-live`.
- `src/pages/ReceiptImport.tsx` — initialize `activeReceiptId` from
  `useSearchParams` **inside the `useState` initializer** to support deep
  links from the dialog without a tab flicker.

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
