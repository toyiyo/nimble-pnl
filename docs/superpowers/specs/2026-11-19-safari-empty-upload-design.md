# Safari empty upload body — design

Date: 2026-11-19
Branch: `fix/safari-empty-upload`

## Problem

On 2026-11-20 (UTC), the owner of Nox Patio Club got 4 upload failures with HTTP 400.
The Storage log shows the same error for all 4:

- `error.message: 'No content provided'`, `errorCode: 'InvalidRequest'`
- `req.headers.content_length: '0'`
- `content_type: multipart/form-data; boundary=----WebKitFormBoundary...`
- User agent: macOS Safari 26.5.2

The buckets were `receipt-images` (3 failures) and `product-images` (1 failure).
The PostHog recording `01a1f662-715f-7513-9a61-a6a589083d12` shows a normal file picker
`change` event before each failure. The user saw a generic "Upload failed (code 400)" toast.

RLS, MIME type, and file size are not the cause. The same owner has 137 good receipt imports
before 2026-11-01, and uploads from iPhone Safari and Android Chrome worked on the same day.

## Cause

`@supabase/storage-js` 2.12.1 puts every `Blob` (and so every `File`) into a `FormData` body
(`node_modules/@supabase/storage-js/dist/main/packages/StorageFileApi.js:57-63`).
This Safari version sent that multipart body with 0 bytes.

When the body is not a `Blob` or `FormData`, storage-js sends it as-is. It then sets the
`content-type` header from `fileOptions.contentType` and the `cache-control` header
(`StorageFileApi.js:72-75`). An `ArrayBuffer` body does not go through `FormData`.

## Current upload calls (all send a `Blob` or `File`)

| Call | Bucket |
|---|---|
| `src/components/ProductUpdateDialog.tsx:270` | `product-images` |
| `src/components/ProductDialog.tsx:297` | `product-images` |
| `src/components/assets/AssetDialog.tsx:151` | `asset-images` |
| `src/hooks/useReceiptImport.tsx:227` | `receipt-images` |
| `src/hooks/useAssetImport.ts:75` | `asset-images` |
| `src/hooks/useAssetImport.ts:414` | `asset-images` |
| `src/hooks/useExpenseInvoiceUpload.tsx:81` | `receipt-images` |
| `src/hooks/useAssetPhotos.ts:130` | `asset-images` |
| `src/hooks/useReviewPages.ts:217` | `review-page-logos` (already sets `contentType: file.type`) |
| `src/hooks/useAttachments.ts:208` | `receipt-images` |
| `src/hooks/useBankStatementImport.tsx:133` | `receipt-images` |
| `src/hooks/useTimePunches.tsx:206` | `time-clock-photos` (already sets `contentType: 'image/jpeg'`) |
| `src/pages/Inventory.tsx:754` | `product-images` |

The user chose to change all 13 calls.

## Design

### 1. New helper: `src/lib/storageUpload.ts`

```ts
export const EMPTY_UPLOAD_CODE = 'empty';

export async function uploadBlobBytes(
  bucket: Pick<StorageFileApi, 'upload'>,
  path: string,
  blob: Blob,
  options?: FileOptions,
): ReturnType<StorageFileApi['upload']>
```

The helper does these steps:

1. Read the bytes with `blob.arrayBuffer()`.
2. If the result has 0 bytes, return `{ data: null, error: EmptyUploadError }`.
   It does not call Storage. `EmptyUploadError` carries `status: 'empty'`.
3. Call `bucket.upload(path, bytes, { ...options, contentType })`.
   `contentType` is `options.contentType`, else `blob.type`, else `application/octet-stream`.

The helper keeps the `{ data, error }` return shape of `upload()`.
Each call site changes one line and keeps its error handling.

The `content-type` value is the same value the multipart part carried before (`blob.type`).
Bucket MIME rules (for example on `receipt-images`) thus see the same type.
`cacheControl` keeps its default `'3600'`; storage-js sends it as a header on this path.

### 2. Clear message for an empty upload: `src/lib/storageError.ts`

`describeStorageError` (`src/lib/storageError.ts:27`) maps a status code to a curated
message (`src/lib/storageError.ts:13-17`). The messages never contain raw server text
(`src/lib/storageError.ts:4`). Keep that rule.

Add one curated entry:

- Code `empty`: "This file is empty or your browser could not read it. Try again, or use a different browser."

Also map a server `400` whose message is `No content provided` to code `empty`.
This shows the clear message if a 0-byte body still reaches the server.
The `logLine` keeps the raw server text, as now.

### 3. Call sites

Change each `.upload(path, file, opts)` to `uploadBlobBytes(supabase.storage.from(bucket), path, file, opts)`.
No other change in the error handling. The toasts already use `describeStorageError`.

## Out of scope

- No change to the database, RLS, buckets, or edge functions.
- No UI layout change. Only the toast text for the new `empty` code is new.
- No upgrade of `@supabase/supabase-js`.

## Tests

- `tests/unit/storageUpload.test.ts`: the helper sends an `ArrayBuffer`, sets `contentType`
  from the blob, keeps an explicit `contentType`, falls back to `application/octet-stream`,
  and returns the empty error without a Storage call for a 0-byte blob.
- `tests/unit/storageError.test.ts`: the `empty` code and the `400 No content provided` mapping.
- Update existing tests that expect `upload(path, file)` with the raw `File`.

E2E: justified exception. The defect needs Safari 26.5.2 on macOS. CI runs Chromium, which
sends good multipart bodies, so an E2E test cannot reproduce the bug. The existing E2E upload
specs still cover the upload flow end to end on the new byte path.

## Decided trade-offs

- The helper reads the whole file into memory. The largest bucket limit is 50MB, and the
  browser already reads the full receipt file for the SHA-256 hash (`src/hooks/useReceiptImport.tsx:201`).
