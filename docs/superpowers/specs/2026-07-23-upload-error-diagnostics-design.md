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

**The toast never renders raw server text.** The 400 this investigation is
chasing is a Supabase Storage RLS/insert rejection whose body is literally
`new row violates row-level security policy for table "objects"` — not
actionable for a restaurant manager, and a schema/policy leak. So `userMessage`
is a **curated, code-keyed string**, never `error.message`:

| `code` | `userMessage` |
|--------|---------------|
| `413`  | "This file is too large to upload." |
| `415`  | "That file type isn't supported." |
| `409`  | "A file with that name already exists." |
| everything else (incl. `400`, `5xx`, `network`, `unknown`) | "Upload failed (code `<code>`). Please try again — if it keeps happening, share this code with support." |

The generic branch still shows the `code` so the user can report it. The raw
server body is captured **only** in `logLine`.

`logLine` is always a fully stringified, single-line summary that already
begins with the code (`"[400] new row violates ..."`), so `console.error(logLine)`
reaches Faro as real text and carries the raw body for a support report — while
the on-screen toast stays clean.

### Delivery — three tiers

Reading the 12 sites showed they are **not** uniform: only 8 have a catch that
unambiguously wraps the storage upload and surfaces to a user via `useToast()`.
The other 4 either `throw` into a broad parent catch that also handles OCR/save
errors (and, for `AssetDialog`, uses the `sonner` `toast.error()` API), or
deliberately degrade without alarming the user. Forcing a code-keyed
"Upload failed" toast into those would mislabel non-upload errors or break
intentional UX. So each site gets exactly one of three treatments — but **all
12 emit a stringified `logLine`**, fixing `[object Object]` everywhere.

**Tier A — user-facing toast.** The catch already wraps the upload (+immediate
DB insert) and surfaces via `useToast()`:

```typescript
} catch (error: unknown) {
  const info = describeStorageError(error);
  console.error(info.logLine);        // already prefixed with [code]
  toast({
    title: 'Upload failed',
    description: info.userMessage,
    variant: 'destructive',
    duration: UPLOAD_ERROR_TOAST_DURATION,  // longer than the ~5s default
  });
} finally {
  setUploading(false);
}
```

Existing control flow is preserved — same return values, same `finally`, same
re-throws. Only the catch *body* changes.

**Tier A + inline.** The two surfaces the bug was reported against — product
**image** (`ProductDialog.tsx`) and **receipt** (`ReceiptUpload.tsx` via
`useReceiptImport`) — additionally set a `uploadError` state string rendered as
a `text-[13px] text-destructive` line under the file input. It shows
`userMessage`, clears on the next attempt, and outlives the toast. This exists
because the failing session is exactly the one where the ~5s single-slot
(`TOAST_LIMIT = 1`) toast is too fragile to be the *only* channel.

**Tier B — log-only.** The catch/throw is not a clean user-facing upload
surface. Emit the stringified diagnostic and preserve existing behavior — no new
toast:

```typescript
if (uploadError) {
  console.error(describeStorageError(uploadError).logLine);
  throw uploadError;   // or: existing degradation (set path=null, Warning toast, etc.)
}
```

Tier B sites: `AssetDialog` (throw-only; parents use `sonner` + mix save
errors), `Inventory.tsx` (throw-only; parents mix OCR errors),
`useAssetImport.ts:411` (best-effort attach — keeps its non-destructive
"Warning" toast), and `useTimePunches.tsx` (kiosk — see below).

`UPLOAD_ERROR_TOAST_DURATION` is exported from `src/lib/storageError.ts`
(e.g. 12000 ms) and used by every Tier A toast.

### Why `useTimePunches.tsx` is Tier B, not Tier A

The kiosk clock-in/out photo upload deliberately lets the punch **succeed** when
the photo fails, setting a `photoUploadFailed` flag and delivering a calm
message in `onSuccess` ("Punch recorded — photo could not be uploaded"). Firing
a destructive "Upload failed" toast inside the mutation would (a) alarm someone
clocking in for a handled background hiccup, and (b) race the calm success toast
under `TOAST_LIMIT = 1`, non-deterministically suppressing one. This site
therefore keeps its existing flow; it may still call `describeStorageError()`
to enrich its `console.error` log line, but it does **not** gain a destructive
toast.

### The one behavior change

`src/components/ProductDialog.tsx` currently swallows its upload error inside
`if (import.meta.env.DEV) { console.error(...) }` with no user feedback. That
gate is removed and the site gains a destructive toast like every sibling. This
is the only path whose observable behavior changes; it changes from
"silent in production" to "shows the same toast as the others".

### Call sites (12 across 11 files) with tier

| File | Line | Tier | Notes |
|------|------|------|-------|
| `src/components/ProductDialog.tsx` | 294 | **A + inline** | DEV-gated swallow — the reported "pictures" bug; remove gate |
| `src/hooks/useReceiptImport.tsx` (inline in `ReceiptUpload.tsx`) | 222 | **A + inline** | the reported "PDFs" path |
| `src/components/ProductUpdateDialog.tsx` | 263 | A | already toasts generic; enrich with code |
| `src/hooks/useAssetImport.ts` | 74 | A | primary asset-import upload; already toasts |
| `src/hooks/useAssetPhotos.ts` | 129 | A | catch (~line 171) wraps upload+insert; already toasts |
| `src/hooks/useAttachments.ts` | 207 | A | catch (~line 267) wraps upload+insert; already toasts |
| `src/hooks/useBankStatementImport.tsx` | 126 | A | local catch; already toasts |
| `src/hooks/useExpenseInvoiceUpload.tsx` | 80 | A | local catch; already toasts |
| `src/components/assets/AssetDialog.tsx` | 150 | B | `throw`-only; parents use `sonner` + mix save errors |
| `src/pages/Inventory.tsx` | 742 | B | `throw`-only; parents (`handleImageCaptured`, fallback) mix OCR errors |
| `src/hooks/useAssetImport.ts` | 411 | B | best-effort attach; keeps its non-destructive "Warning" toast |
| `src/hooks/useTimePunches.tsx` | 197 | B | kiosk — keeps `photoUploadFailed`/`onSuccess` flow |

Tier A = code-keyed destructive toast; A+inline adds a persistent inline error
line; Tier B = `console.error(logLine)` only, existing UX preserved. Line
numbers are current as of the branch base and will be re-confirmed during
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

- `StorageApiError`-shaped `413`/`415`/`409` → `code` = status,
  `userMessage` = the matching curated string.
- `StorageApiError`-shaped `400` → `code: '400'`, `userMessage` = generic
  (asserts the raw RLS body is **not** in `userMessage`, only in `logLine`).
- `StorageApiError`-shaped `5xx` → `code` = status, `userMessage` generic.
- `StorageUnknownError`-shaped → `code: 'network'`, generic message.
- Plain `Error` → `code: 'unknown'`, generic message; raw `message` in `logLine`.
- Non-error value (string, null) → fallback via `String(error)`.
- `logLine` is always single-line, begins with `[code]`, and — for the 400
  case — contains the raw server body.

Keeping the logic pure in `src/lib/` (not inside a component) is what makes this
coverage reachable.

## Out of scope

- Changing the storage request, retries, or MIME/size validation.
- Capturing the 400 body server-side (the toast now surfaces it client-side).
- Cleanup of the two production `receipt_imports` diagnostic rows — the user
  confirmed they are harmless to leave.
- Pre-existing shared-component a11y gaps flagged in design review but not
  regressions of this change: `ToastClose` lacks an `sr-only`/`aria-label`
  (`src/components/ui/toast.tsx`), and a toast firing over an open dialog is not
  keyboard-reachable from inside the dialog's focus trap. Optional one-line
  `ToastClose` label may be included if trivial; the focus-trap issue is not
  addressed here.
