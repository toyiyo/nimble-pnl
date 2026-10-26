# Plan: caller check and SSRF fix for document processing functions

Design: `docs/superpowers/specs/2026-10-26-document-processing-auth-design.md`

## Task 1: shared helpers (TDD)

1. Write `tests/unit/documentProcessingAuth.test.ts` for
   `isAllowedStorageUrl`, `isInlineDataUrl`, `isRestaurantStoragePath`,
   `bytesToDataUrl`, and `authorizeDocumentRequest`. Run it. It fails.
2. Write `supabase/functions/_shared/documentProcessingAuth.ts`. Run the
   test. It passes.
3. Commit.

## Task 2: `process-receipt`

1. Add the caller check after the body parse.
2. Pick the source: `data:` URL, or a download of `raw_file_url` from
   bucket `receipt-images`. Check any caller URL with
   `isAllowedStorageUrl`. Never fetch it.
3. Check the download size. Delete the old fetch block.
4. Delete `details` from the 422 and 500 responses.
5. Commit.

## Task 3: `process-bank-statement`

1. Add the caller check after the body parse.
2. Check `pdfUrl` with `isAllowedStorageUrl` when present. Download
   `raw_file_url` from storage. Delete the `localhost` rewrite and the fetch.
3. Check the download size.
4. Write fixed text to `error_message`. Delete `details` from the 400, 422,
   500 responses and the line insert failure.
5. Commit.

## Task 4: frontend callers

1. `useReceiptImport.tsx`: send `{ receiptId, isPDF: true }` for a PDF.
2. `useBankStatementImport.tsx`: send `{ statementUploadId }`. Clean the
   file extension.
3. Run typecheck, lint, and unit tests. Commit.

## Task 5: verify

Run `npm run test`, `npm run typecheck`, `npm run lint`, `npm run build`.
Type-check both functions with `deno check` if Deno is available.
