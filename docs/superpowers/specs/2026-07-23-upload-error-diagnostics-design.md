# Upload Error Diagnostics — Design

**Date:** 2026-07-23
**Branch:** `fix/upload-error-diagnostics`
**Status:** Approved

## Problem

Uploading a PDF or image to Inventory fails silently for at least one production
user on desktop Safari. The failure produces **no actionable signal anywhere**:
the on-screen upload does nothing, and our telemetry never names a cause.

### Root-cause investigation (Iron Law: no fix without root cause)

The WebKit request-construction hypothesis was **refuted**. Across three
independent tests, Chromium and WebKit 26.0 produced byte-identical multipart
bodies, identical part headers, and identical CORS preflights — for a synthetic
`File`, and for a real 1.2 MB on-disk PDF through a real `<input type=file>`.
The app's request and the browser engine are exonerated.

What the investigation *did* establish:

1. **Production storage returns HTTP 400** on the failing POSTs
   (`/object/product-images/...`, `/object/receipt-images/...`), while GETs from
   the same session succeed (thumbnails render). The page is running; only the
   upload POST is rejected.
2. **The failing session sends zero Faro telemetry.** Correlating storage-log
   timestamps against the Faro per-browser tally: on a normal day desktop Safari
   emitted ~2,000 Faro entries; during the windows containing the 400s, Safari
   emitted **none**. The telemetry beacon (itself a POST) does not arrive in the
   session that fails.
3. **`console.error('msg:', errObject)` serializes to `[object Object]` in
   Faro.** A live production exception proves it. So even the un-gated
   `console.error` on some upload paths would have yielded no `statusCode`.
4. **`ProductDialog.tsx` gates its catch behind `import.meta.env.DEV`**, so
   product-image failures leave no trace in production at all.

The **400 response body** — the field that would name the cause — has never been
captured, precisely because no channel currently surfaces it.

> Note on identifiers: real tenant names and UUIDs from the investigation are
> withheld from this document. Where an example needs an ID, a fictional
> placeholder such as `restaurant_11111111` is used.

## Goal

Make every storage upload failure name its own cause, through a channel that
works **in the session that actually fails** — i.e. on screen, not telemetry.
Repair the silent `DEV`-gated swallow in `ProductDialog.tsx` as part of this.

Non-goal: changing upload semantics, retry behavior, or the storage request
itself. This is a diagnostics change, not a functional rewrite.

## Constraint that shapes the design

Telemetry-only diagnostics are the **one thing proven not to work** here: the
failing session emits no Faro. Therefore the primary diagnostic channel MUST be
user-visible on screen. Telemetry is a secondary channel and must be
pre-stringified so it survives Faro's `[object Object]` serialization.

## Approaches considered

**A — Pure `describeStorageError()` helper, applied at each call site
(CHOSEN).** A new pure function in `src/lib/` narrows `unknown` → structured
error info. Each of the 12 call sites swaps its catch body for a few lines.
Upload semantics unchanged everywhere.

**B — Shared `uploadToStorage()` wrapper.** One function that uploads *and*
normalizes. Rejected: the 12 sites differ materially (some pass `upsert`, some
return a storage path, some a public URL, one passes options none of the others
do). Forcing a common signature is a real regression surface in paths that
cannot be exercised in the browser preview (asset import, bank-statement
import) — too much blast radius for a diagnostics change chasing a live bug.

**C — Inventory paths only.** Rejected: fixes the reported symptom but leaves
eight other silent swallows in place, and the incremental cost of covering them
with approach A is small.

## Design

### `src/lib/storageError.ts`

One pure function. No imports from React or the Supabase runtime; narrowing is
duck-typed so we do not depend on storage-js class identity.

```typescript
export interface StorageErrorInfo {
  code: string;        // '400', '413', 'network', 'unknown'
  userMessage: string; // safe to render in a toast
  logLine: string;     // fully stringified — survives Faro
}

export function describeStorageError(error: unknown): StorageErrorInfo;
```

Narrowing order:

1. **`StorageApiError`** — duck-typed on presence of `statusCode`/`status`.
   `code` = the status as string. This is an anticipated 4xx/5xx from the
   server.
2. **`StorageUnknownError`** — has `originalError`; means the fetch never
   completed (network / CORS / aborted) → `code: 'network'`.
3. **`Error`** — generic; `code: 'unknown'`, message from `error.message`.
4. **Fallback** — `String(error)`.

`userMessage` policy (per lesson 2026-04-22 on leaking raw error text):

- **4xx**: surface the server's message — anticipated and actionable
  ("File size exceeds limit", "Invalid MIME type", etc.).
- **5xx / network / unknown**: generic message ("Upload failed — please try
  again"), but the `code` is still shown so the user can report it.

`logLine` is always a fully stringified, single-line summary
(`"[400] new row violates ..."`) so a `console.error(logLine)` reaches Faro as
real text.

### Delivery at each call site

```typescript
} catch (error: unknown) {
  const info = describeStorageError(error);
  console.error(`Upload failed [${info.code}]: ${info.logLine}`);
  toast({
    title: 'Upload failed',
    description: info.userMessage,
    variant: 'destructive',
  });
} finally {
  setUploading(false);
}
```

- **Toast is primary.** In the failing session the beacon never arrives, so the
  user reads the code off the screen and can report it.
- **`console.error` is secondary** and uses a template literal, so Faro captures
  real text instead of `[object Object]`.
- Each site keeps its existing control flow — same return values, same
  `finally`, same re-throws. Only the catch *body* changes.

### The one behavior change

`src/components/ProductDialog.tsx` currently swallows its upload error inside
`if (import.meta.env.DEV) { console.error(...) }` with no user feedback. That
gate is removed and the site gains a destructive toast like every sibling. This
is the only path whose observable behavior changes; it changes from
"silent in production" to "shows the same toast as the others".

### Call sites (12 across 11 files)

| File | Line | Notes |
|------|------|-------|
| `src/components/ProductDialog.tsx` | 294 | **DEV-gated swallow — behavior fix** |
| `src/components/ProductUpdateDialog.tsx` | 263 | toasts, discards detail |
| `src/components/assets/AssetDialog.tsx` | 150 | |
| `src/hooks/useAssetImport.ts` | 74, 411 | two sites |
| `src/hooks/useAssetPhotos.ts` | 129 | |
| `src/hooks/useAttachments.ts` | 207 | |
| `src/hooks/useBankStatementImport.tsx` | 126 | |
| `src/hooks/useExpenseInvoiceUpload.tsx` | 80 | |
| `src/hooks/useReceiptImport.tsx` | 222 | inventory receipt path |
| `src/hooks/useTimePunches.tsx` | 197 | only site passing options |
| `src/pages/Inventory.tsx` | 742 | |

Line numbers are indicative and will be re-confirmed against the branch during
implementation.

### Error typing

Several sites use `catch (error)` with implicit `any`. Per lesson 2026-04-22
(`catch (err: any)` hides bugs), each touched catch is tightened to
`catch (error: unknown)`; `describeStorageError(error: unknown)` makes this free
at the boundary.

## Testing

`tests/unit/storageError.test.ts` — real error-shaped objects, not string
assertions (per lesson 2026-07-20: source-text/regex tests do not count toward
SonarCloud new-code coverage):

- `StorageApiError`-shaped (4xx) → `code` = status, `userMessage` surfaces
  server message.
- `StorageApiError`-shaped (5xx) → `code` = status, `userMessage` generic.
- `StorageUnknownError`-shaped → `code: 'network'`, generic message.
- Plain `Error` → `code: 'unknown'`, message passed through the 5xx/generic
  policy.
- Non-error value (string, null) → fallback via `String(error)`.
- `logLine` is always single-line and contains the code.

Keeping the logic pure in `src/lib/` (not inside a component) is what makes this
coverage reachable.

## Out of scope

- Changing the storage request, retries, or MIME/size validation.
- Capturing the 400 body server-side (the toast now surfaces it client-side).
- Cleanup of the two production `receipt_imports` diagnostic rows — the user
  confirmed they are harmless to leave.
