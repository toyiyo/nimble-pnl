# Design: caller check and SSRF fix for document processing functions

Date: 2026-10-26
Status: approved in advance by the user (fix 7 of 7, security audit)
Branch: `claude/dreamy-feynman-xo1amm`

## Problem

Two edge functions parse uploaded documents with AI:
`process-receipt` and `process-bank-statement`.

1. No caller check. Both functions have `verify_jwt = true`
   (`supabase/config.toml:100-101`, `supabase/config.toml:234-235`). The
   public anon key passes this check. Neither function calls
   `auth.getUser` or reads `user_restaurants`. Both use the service role
   (`supabase/functions/process-receipt/index.ts:609-611`,
   `supabase/functions/process-bank-statement/index.ts:479-481`).
2. Any tenant. Each function writes parsed rows into the `receiptId` or the
   `statementUploadId` that the caller sends
   (`process-receipt/index.ts:917-928`, `process-receipt/index.ts:966`,
   `process-bank-statement/index.ts:870-884`).
3. SSRF. `process-receipt` calls `fetch(imageData)` for a PDF
   (`process-receipt/index.ts:653`). `process-bank-statement` calls
   `fetch(fetchUrl)` (`process-bank-statement/index.ts:564`). No host
   allowlist exists. The bank function also rewrites `localhost` to
   `host.docker.internal` (`process-bank-statement/index.ts:546-558`).
4. Error leak. `process-bank-statement` writes the raw fetch error into
   `bank_statement_uploads.error_message` and returns it in `details`
   (`process-bank-statement/index.ts:597-611`). Both functions return
   `error.message` in `details` from the outer `catch`
   (`process-receipt/index.ts:992`, `process-bank-statement/index.ts:1005`).
5. Cross-tenant file read. The service role can read every object in the
   `receipt-images` bucket. A user can write any `raw_file_url` into a row
   of their own restaurant. If the server downloads that path, the user can
   read a file of a different tenant.

## Current callers

- `src/hooks/useReceiptImport.tsx:279-312`: for a PDF, the hook reads
  `raw_file_url`, makes a signed URL on bucket `receipt-images`, and sends
  it as `imageData`. For an image, it sends a `data:` URL
  (`useReceiptImport.tsx:313-319`). It calls the function at
  `useReceiptImport.tsx:327`.
- `src/hooks/useBankStatementImport.tsx:180-221`: the hook reads
  `raw_file_url`, makes a signed URL on bucket `receipt-images`, and sends
  it as `pdfUrl`.
- Upload paths: receipts go to `${restaurant_id}/${file}`
  (`useReceiptImport.tsx:223`). Bank statements go to
  `${restaurant_id}/bank-statements/${file}`
  (`useBankStatementImport.tsx:128`). Both store the path in
  `raw_file_url` (`useReceiptImport.tsx:237`,
  `useBankStatementImport.tsx:143`).

## Roles that can upload

The function must match the RLS rule that lets the UI create the row.

- `receipt_imports` INSERT: `owner`, `manager`, `operations_manager`,
  `collaborator_operations_manager`
  (`supabase/migrations/20260723120000_add_collaborator_operations_manager_role.sql:720-730`).
- `bank_statement_uploads` FOR ALL: `owner`, `manager`
  (`supabase/migrations/20251118100000_add_bank_statement_uploads.sql:74-83`).
  No later migration changes this policy.

## Approach

Chosen: the server downloads the file itself from the row path. The server
never fetches a URL from the caller.

Rejected options:

- Host allowlist and fetch of the caller URL. Local dev breaks: the edge
  runtime sees `SUPABASE_URL=http://kong:8000`, but the browser signs
  `http://127.0.0.1:54321/...`. The fetch also stays a server-side request
  to a value that the caller controls.
- Bucket and path from the caller. The row already holds the path. A
  second source of truth adds a mismatch case and no value.

### New shared module `supabase/functions/_shared/documentProcessingAuth.ts`

Pure functions with injected dependencies, so Vitest can load them. This
follows the split-handler lesson in `memory/lessons.md` (2026-05-07).

- `RECEIPT_PROCESS_ROLES`, `BANK_STATEMENT_PROCESS_ROLES`: the role lists
  above.
- `isAllowedStorageUrl(rawUrl, supabaseUrl)`: `true` only when the URL is
  `https:`, has no user name or password, has the same host and port as
  `supabaseUrl`, and its path starts with `/storage/v1/`. The function
  returns `false` for a bad URL, `http:`, `localhost`, `169.254.169.254`,
  and any other host.
- `isInlineDataUrl(value, allowedMimePrefixes)`: `true` only for
  `data:<mime>;base64,` where the MIME type starts with an allowed prefix.
- `isRestaurantStoragePath(path, restaurantId)`: `true` only when the path
  starts with `${restaurantId}/`, uses only the characters `[A-Za-z0-9._/-]`,
  and has no `.` or `..` segment and no empty segment. This rejects `%`,
  `?`, `#`, a backslash, and a leading `/`.
- `MAX_RECEIPT_BYTES` (20 MB) and `MAX_BANK_STATEMENT_BYTES` (5 MB): the
  server checks the size of the downloaded bytes before it encodes them. The
  `file_size` column comes from the client, so the server does not trust it
  alone. The bank limit matches `useBankStatementImport.tsx:108`.
- `authorizeDocumentRequest({ authHeader, recordId, allowedRoles }, deps)`:
  1. No `Bearer` token → 401 `Authentication required`.
  2. `deps.getUser(token)` returns no user → 401 `Authentication required`.
  3. `deps.loadRecord(recordId)` returns no row → 404 `Document not found`.
  4. `deps.getMembershipRole(userId, restaurantId)` returns no role → 404
     `Document not found`. The same message as step 3 hides whether the
     row exists.
  5. Role not in `allowedRoles` → 403 `You do not have permission to process this document`.
  6. Else `{ ok: true, userId, record }`.
  A thrown error in a dependency → 500 `Authorization check failed`, with
  the detail in the server log only.
- `bytesToDataUrl(bytes, mime)`: chunked base64 encoder. Both functions
  already have this loop inline (`process-receipt/index.ts:662-676`,
  `process-bank-statement/index.ts:574-586`).

### `process-receipt/index.ts`

1. Read `receiptId`, `imageData`, `isPDF`. `receiptId` is required.
2. Call `authorizeDocumentRequest` with `RECEIPT_PROCESS_ROLES`. The record
   loader selects `restaurant_id, raw_file_url` from `receipt_imports`.
3. Pick the document source:
   - `imageData` is a `data:image/` or `data:application/pdf` base64 URL →
     use it as before.
   - Else if `isPDF`: if `imageData` is present, it must pass
     `isAllowedStorageUrl` (old cached clients send a signed URL), else 400.
     The server does not fetch that URL. It downloads `raw_file_url` from
     bucket `receipt-images` with the service client, after
     `isRestaurantStoragePath` passes.
   - Else → 400 `Unsupported document source`.
4. A download failure returns 400 `Failed to load the receipt file` and
   logs the detail. A file above `MAX_RECEIPT_BYTES` returns 413.
5. The outer `catch` and the 422 parse failure return no `details`
   (`process-receipt/index.ts:845`, `process-receipt/index.ts:992`).

### `process-bank-statement/index.ts`

1. Read `statementUploadId` and optional `pdfUrl`. `statementUploadId` is
   required.
2. Call `authorizeDocumentRequest` with `BANK_STATEMENT_PROCESS_ROLES`. The
   loader selects `restaurant_id, file_size, raw_file_url` from
   `bank_statement_uploads`.
3. If `pdfUrl` is present, it must pass `isAllowedStorageUrl`, else 400.
   The server does not fetch it.
4. Download `raw_file_url` from bucket `receipt-images` after
   `isRestaurantStoragePath` passes. Delete the `localhost` rewrite.
5. On a download failure, write the fixed text
   `Failed to download the bank statement file. Please upload it again.`
   to `error_message`. Return the same generic text. Log the detail.
6. A file above `MAX_BANK_STATEMENT_BYTES` returns 413.
7. The outer `catch`, the 422 parse failure, and the line insert failure
   return no `details` (`process-bank-statement/index.ts:834`,
   `process-bank-statement/index.ts:940`,
   `process-bank-statement/index.ts:1005`). The parse failure text in
   `error_message` becomes fixed text too
   (`process-bank-statement/index.ts:827`).

### Frontend

- `useReceiptImport.tsx`: for a PDF, send `{ receiptId, isPDF: true }`.
  Delete the signed URL step. Images still send the `data:` URL.
- `useBankStatementImport.tsx`: send `{ statementUploadId }`. Delete the
  signed URL step and the `raw_file_url` read. Clean the file extension
  with the same rule as receipts (`useReceiptImport.tsx:218`), so the
  strict path check accepts every new upload.

Old clients that still send a signed URL keep working in production: the
URL host is the project host, so the allowlist passes, and the server
ignores the URL value.

## Out of scope

- Other edge functions (task rule 6).
- RLS changes. The existing policies are correct for direct table access.
- Rate limits on OpenRouter spend. The caller check removes anonymous
  spend; per-user limits are a separate change.

## Tests

- `tests/unit/documentProcessingAuth.test.ts`:
  - `isAllowedStorageUrl`: a project storage URL passes. Another host,
    `localhost`, `127.0.0.1`, `169.254.169.254`, `http:`, user info, a
    path outside `/storage/v1/`, a different port, and a bad string fail.
  - `isInlineDataUrl`, `isRestaurantStoragePath`, `bytesToDataUrl`.
  - `authorizeDocumentRequest`: no header, bad header, no user, no row,
    no membership, wrong role, allowed role, dependency throw.
- `isRestaurantStoragePath` has a case for a path of a different tenant
  (`<other-restaurant>/x.pdf`). This is the cross-tenant file read test.
- E2E: the CI E2E stack does not serve edge functions
  (`tests/e2e/review-stars.spec.ts:13`). An E2E test cannot call the real
  function. The auth and path rules have unit tests. A browser E2E with a
  stubbed function adds little value for this server-side fix, so the
  change uses a justified E2E exception.

## TLA+ check

No trigger from `.claude/skills/run-tla/SKILL.md` matches. The change has
no concurrent writer, cron, retry, cursor, lock, or state machine.

## Decided trade-offs

- The functions still check `imageData` or `pdfUrl` with
  `isAllowedStorageUrl` when a caller sends a URL, and do not use the
  value. The task asks to reject other URLs. A stale local tab that sends
  `http://127.0.0.1` gets a 400 and must reload. That is a local-dev cost
  only.
- Old rows whose `raw_file_url` is not a bare path fail the path check and
  return 400. All current upload code writes a bare path
  (`useReceiptImport.tsx:237`, `useBankStatementImport.tsx:143`). The task
  forbids a production query, so the PR asks the owner to run a read-only
  count before deploy.

- The storage download has no explicit timeout. The old code had a 20 s or
  30 s fetch abort. The download is now from the project's own storage, and
  the edge runtime wall clock bounds it.
