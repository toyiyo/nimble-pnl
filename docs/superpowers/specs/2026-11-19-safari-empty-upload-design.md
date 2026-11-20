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
type Bucket = ReturnType<typeof supabase.storage.from>;
type UploadOptions = Parameters<Bucket['upload']>[2];
type UploadData = NonNullable<Awaited<ReturnType<Bucket['upload']>>['data']>;

export class EmptyUploadError extends Error {
  readonly status = 'empty';
}

export async function uploadBlobBytes(
  bucket: Pick<Bucket, 'upload'>,
  path: string,
  blob: Blob,
  options?: UploadOptions,
): Promise<{ data: UploadData | null; error: Error | null }>
```

`@supabase/storage-js` is not a direct dependency, and `@supabase/supabase-js` does not
export `StorageError`. So `EmptyUploadError` extends `Error`, and the types come from the
`supabase` client. `StorageApiError.status` is a `number`, so the helper does not reuse
that type. All 13 call sites only read `error` as a truthy value, throw it, or pass it to
`describeStorageError(error: unknown)`. `npm run typecheck` checks this.

The helper does these steps:

1. Read the bytes with `blob.arrayBuffer()`.
   If the read rejects (for example `NotReadableError` on an iCloud placeholder file),
   return the `EmptyUploadError` below. The helper does not throw.
2. If the result has 0 bytes, return `{ data: null, error: EmptyUploadError }`.
   It does not call Storage. `EmptyUploadError` extends `Error` and carries `status: 'empty'`.
   `describeStorageError` checks `'status' in error` (`src/lib/storageError.ts:29-33`), so it maps the code.
   `useTimePunches.tsx:206` types the error as `Error | null`; an `Error` subclass fits.
3. Call `bucket.upload(path, bytes, { ...options, contentType })`.
   `contentType` is `options.contentType || blob.type || 'application/octet-stream'`.
   Use `||`, not `??`: `useReviewPages.ts:217` can pass `file.type === ''`.
   Always set `contentType`. The storage-js default is `text/plain;charset=UTF-8`
   (`StorageFileApi.js:23-27`), which bucket MIME rules reject.

The 0-byte check reads `bytes.byteLength`, not `blob.size`. A test or browser can report a
wrong `size`.

The helper does not copy the buffer for the Node 20 realm issue. storage-js checks only
`instanceof Blob` and `instanceof FormData` (`StorageFileApi.js:57,64`). Production browsers
have one realm.

The helper keeps the `{ data, error }` return shape of `upload()`.
Each call site changes one line and keeps its error handling.

The `content-type` value is the same value the multipart part carried before (`blob.type`).
Bucket MIME rules (for example on `receipt-images`) thus see the same type.
`cacheControl` keeps its default `'3600'`; storage-js sends it as a header on this path.
For an empty `file.type`, the browser sent `application/octet-stream` as the part type.
The fallback is the same value, so no bucket MIME rule changes its result.

Other options on the raw path: `metadata` becomes an `x-metadata` header
(`StorageFileApi.js:75-78`). `duplex` goes to fetch only. `headers` still merge (`:80-82`).
No call site uses `metadata` or `duplex`.

Bucket rules (prod matches migrations; none change):

| Bucket | MIME rule | Size limit |
|---|---|---|
| `receipt-images` | jpeg, jpg, png, webp, pdf | 50MB |
| `product-images` | none | none |
| `asset-images` | none | none |
| `review-page-logos` | png, jpeg, webp | 2MB |
| `time-clock-photos` | jpeg, jpg, png, webp | 5MB |

RLS on `storage.objects` keys on bucket, path, and extension. It does not read the content type.
The upstream Storage server accepts a raw body on the standard upload route.

### 2. Clear message for an empty upload: `src/lib/storageError.ts`

`describeStorageError` (`src/lib/storageError.ts:27`) maps a status code to a curated
message (`src/lib/storageError.ts:13-17`). The messages never contain raw server text
(`src/lib/storageError.ts:5`). Keep that rule.

Add one curated entry:

- Code `empty`: "This file is empty or your browser could not read it. Try again, or use a different browser."

Also map a server `400` whose message contains `no content provided` (case-insensitive) to code `empty`.
Other `400` errors (for example an RLS rejection) keep the generic text.
Today the mapping reads only the code (`src/lib/storageError.ts:40`); this rule also reads the message.
This shows the clear message if a 0-byte body still reaches the server.
The `logLine` keeps the raw server text, as now.

### 3. Call sites

Change each `.upload(path, file, opts)` to `uploadBlobBytes(supabase.storage.from(bucket), path, file, opts)`.
No other change in the error handling.

Most sites show a toast from `describeStorageError`. Two sites do not:
- `useAssetImport.ts:414` shows its own "Could not attach document" warning.
- `useTimePunches.tsx:225` only logs the error.
This stays as now.

`useTimePunches.tsx:190-216` races the upload against a 10s timeout. The timeout starts
before the call, so the file read is inside the timeout. If the timeout wins during the read,
the upload can start later and leave an orphan object. A hung request has the same risk today.

## Out of scope

- No change to the database, RLS, buckets, or edge functions.
- No UI layout change. Only the toast text for the new `empty` code is new.
- No upgrade of `@supabase/supabase-js`.

## Tests

- `tests/unit/storageUpload.test.ts`: the helper sends an `ArrayBuffer`, sets `contentType`
  from the blob, keeps an explicit `contentType`, falls back to `application/octet-stream`,
  treats `contentType: ''` as missing, returns the empty error without a Storage call for a
  0-byte blob, and returns the empty error when `arrayBuffer()` rejects.
- `tests/unit/storageError.test.ts`: the `empty` code, an `EmptyUploadError` input, and the
  `400 No content provided` mapping.
- Fix existing tests that the change breaks:
  - `tests/unit/useAssetPhotos.test.ts:67-70`: `createMockFile` builds `new File([''], ...)`
    and fakes `size`. Give it real bytes. Change the assertion at `:196-199` from
    `upload(path, mockFile)` to an `ArrayBuffer` plus `{ contentType: 'image/jpeg' }`.
  - `tests/unit/useReviewPages.test.ts:338` and `:359`: give the files real bytes.
    Change the assertion at `:321` to an `ArrayBuffer` plus `{ contentType: 'image/png', upsert: false }`.
  - `tests/unit/useTimePunches.test.tsx:220-258` uses fake timers. The jsdom `arrayBuffer`
    polyfill (`tests/setup.ts:15-24`) uses `FileReader`, which waits on `setImmediate`.
    Run this file after the change.
- Do not assert `toBeInstanceOf(ArrayBuffer)` (Node 20 realm issue). Check
  `Object.prototype.toString.call(arg) === '[object ArrayBuffer]'`, `byteLength`, and the bytes.
- Run the full `npx vitest run` and `npm run typecheck`.

E2E: justified exception. The defect needs Safari 26.5.2 on macOS. CI runs Chromium, which
sends good multipart bodies, so an E2E test cannot reproduce the bug.

Manual check: upload a receipt and a product image in Safari 26.x on macOS after deploy.
The logs show the Storage server got 0 bytes. They do not prove that a raw body avoids the
Safari defect. If `arrayBuffer()` also returns 0 bytes, the user sees the new `empty`
message, and the server gets no request. That result is still better than a generic code.

## Decided trade-offs

- The helper reads the whole file into memory. `product-images` and `asset-images` have no
  size limit, and `asset-images` also gets documents (`src/hooks/useAssetImport.ts:414`).
  We accept this. The files are photos and PDFs from a file picker. The browser already reads
  the full receipt file for the SHA-256 hash (`src/hooks/useReceiptImport.tsx:201`).
  We add no new client size limit, because that changes behavior outside this fix.
- Date note: the doc date is local time (2026-11-19). The log times are UTC (2026-11-20).
