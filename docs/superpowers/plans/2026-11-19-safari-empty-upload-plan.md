# Safari empty upload body — plan

Design: `docs/superpowers/specs/2026-11-19-safari-empty-upload-design.md`
Branch: `fix/safari-empty-upload`
Worktree: `.claude/worktrees/safari-empty-upload`

Use TDD for each task: write the failing test, run it, write the code, run it again.
Commit after each task. Stage explicit paths only.

## Task 1: `describeStorageError` knows the `empty` code

Files: `src/lib/storageError.ts`, `tests/unit/storageError.test.ts`

Tests first:
- `{ status: 'empty', message: 'x' }` gives `code: 'empty'` and the curated text:
  "This file is empty or your browser could not read it. Try again, or use a different browser."
- `{ status: 400, message: 'No content provided' }` gives `code: 'empty'` and the same text.
  The `logLine` keeps the raw text: `[400] No content provided`.
- `{ status: 400, message: 'new row violates row-level security policy' }` keeps the generic text
  and `code: '400'`. (The existing "400 RLS rejection" test must still pass.)

Code:
- Add `empty` to `CURATED_MESSAGES`.
- In the status branch: if the code is `'400'` and the lower-case message contains
  `no content provided`, set the code to `'empty'`.

## Task 2: the `uploadBlobBytes` helper

Files: `src/lib/storageUpload.ts` (new), `tests/unit/storageUpload.test.ts` (new)

Tests first (a fake bucket with `upload: vi.fn()`):
1. It sends an ArrayBuffer with the same bytes. Check with
   `Object.prototype.toString.call(arg)`, `byteLength`, and `new Uint8Array(arg)`.
   Do not use `toBeInstanceOf(ArrayBuffer)`.
2. It sets `contentType` from `blob.type`.
3. It keeps an explicit `contentType` and other options (`upsert: false`, `cacheControl`).
4. `contentType: ''` and an empty `blob.type` fall back to `application/octet-stream`.
5. A 0-byte blob returns `{ data: null, error: EmptyUploadError }`, and `upload` is not called.
6. A blob whose `arrayBuffer()` rejects returns the same result. `upload` is not called.
7. It returns the `{ data, error }` result of `upload` unchanged.
8. `describeStorageError(new EmptyUploadError(...))` gives `code: 'empty'`.

Code: as in design section 1.

## Task 3: change the 13 call sites

Change each `.upload(...)` to `uploadBlobBytes(supabase.storage.from(bucket), ...)`:

1. `src/components/ProductUpdateDialog.tsx:270`
2. `src/components/ProductDialog.tsx:297`
3. `src/components/assets/AssetDialog.tsx:151`
4. `src/hooks/useReceiptImport.tsx:227`
5. `src/hooks/useAssetImport.ts:75`
6. `src/hooks/useAssetImport.ts:414`
7. `src/hooks/useExpenseInvoiceUpload.tsx:81`
8. `src/hooks/useAssetPhotos.ts:130`
9. `src/hooks/useReviewPages.ts:217`
10. `src/hooks/useAttachments.ts:208`
11. `src/hooks/useBankStatementImport.tsx:133`
12. `src/hooks/useTimePunches.tsx:206`
13. `src/pages/Inventory.tsx:754`

Fix the tests that break:
- `tests/unit/useAssetPhotos.test.ts:67-70`: give `createMockFile` real bytes.
  Change the assertion at `:196-199` to an ArrayBuffer plus `{ contentType: 'image/jpeg' }`.
- `tests/unit/useReviewPages.test.ts:338`, `:359`: give the files real bytes.
  Change the assertion at `:321` to an ArrayBuffer plus `{ contentType: 'image/png', upsert: false }`.
- Run `tests/unit/useTimePunches.test.tsx` (fake timers and the FileReader polyfill).

Add a guard test: grep `src/` for `.storage.from(` followed by `.upload(`. Expect no direct call
outside `src/lib/storageUpload.ts`. (A source-scan unit test in `tests/unit/storageUpload.test.ts`.)

## Task 4: check

- `npx vitest run` (full suite)
- `npm run typecheck`
- `npm run lint`
- `npm run build`

## Not in this plan

- No E2E test (see the design for the reason).
- Manual check after deploy: upload a receipt and a product image in Safari 26.x on macOS.
