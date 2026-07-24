# Upload Error Diagnostics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every Supabase storage upload failure name its own cause through a channel that works in the failing session (on-screen), and remove the silent `DEV`-gated swallow in `ProductDialog.tsx`.

**Architecture:** A single pure helper `describeStorageError(error: unknown)` in `src/lib/storageError.ts` narrows any thrown value to `{ code, userMessage, logLine }`. Twelve upload sites adopt it in one of three tiers: **A** (code-keyed destructive toast), **A+inline** (toast plus a persistent inline error line, on the two reported surfaces), or **B** (`console.error(logLine)` only, existing UX preserved). All twelve emit a stringified `logLine`, fixing the `[object Object]` serialization that erased prior telemetry.

**Tech Stack:** React 18 + TypeScript, Vite, Vitest, `@supabase/storage-js`, shadcn `useToast()` + `sonner`.

## Global Constraints

- **No raw server text in `userMessage`.** The toast description is a curated,
  code-keyed string only. Raw server bodies live solely in `logLine`. (Lesson
  2026-04-22: don't leak raw error messages; the 400 we chase is an RLS body.)
- **`catch (error: unknown)`**, never `catch (error: any)`. (Lesson 2026-04-22.)
- **Tests use real error-shaped fixtures**, not source-text/regex assertions —
  a single uncovered new executable line fails SonarCloud's 80%-on-new-code
  gate. (Lesson 2026-07-20.)
- **No real tenant identifiers** in code, tests, comments, commit messages, or
  PR body — use fictional placeholders like `restaurant_11111111`. (Lesson
  2026-07-07.)
- Semantic color tokens only (`text-destructive`, never `text-red-500`).
- `describeStorageError` is **pure** — no React, no Supabase runtime imports.

---

### Task 1: `describeStorageError` helper + unit tests

**Files:**
- Create: `src/lib/storageError.ts`
- Test: `tests/unit/storageError.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `export interface StorageErrorInfo { code: string; userMessage: string; logLine: string; }`
  - `export function describeStorageError(error: unknown): StorageErrorInfo`
  - `export const UPLOAD_ERROR_TOAST_DURATION = 12000` (ms)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/storageError.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { describeStorageError, UPLOAD_ERROR_TOAST_DURATION } from '@/lib/storageError';

// Mimics @supabase/storage-js StorageApiError (status: number, statusCode: string).
function apiError(status: number, message: string) {
  return { name: 'StorageApiError', message, status, statusCode: String(status) };
}
// Mimics StorageUnknownError (carries originalError, no status).
function unknownError(message: string) {
  return { name: 'StorageUnknownError', message, originalError: new TypeError(message) };
}

describe('describeStorageError', () => {
  it('413 payload-too-large → curated size message, code 413', () => {
    const info = describeStorageError(apiError(413, 'The object exceeded the maximum allowed size'));
    expect(info.code).toBe('413');
    expect(info.userMessage).toBe('This file is too large to upload.');
    expect(info.logLine).toContain('[413]');
  });

  it('415 unsupported-media → curated type message', () => {
    const info = describeStorageError(apiError(415, 'mime type text/x-evil is not supported'));
    expect(info.code).toBe('415');
    expect(info.userMessage).toBe("That file type isn't supported.");
  });

  it('409 conflict → curated duplicate message', () => {
    const info = describeStorageError(apiError(409, 'The resource already exists'));
    expect(info.code).toBe('409');
    expect(info.userMessage).toBe('A file with that name already exists.');
  });

  it('400 RLS rejection → generic message, raw body ONLY in logLine', () => {
    const rls = 'new row violates row-level security policy for table "objects"';
    const info = describeStorageError(apiError(400, rls));
    expect(info.code).toBe('400');
    expect(info.userMessage).not.toContain('row-level');
    expect(info.userMessage).toContain('400');
    expect(info.logLine).toContain(rls);
  });

  it('5xx → generic message, code preserved', () => {
    const info = describeStorageError(apiError(503, 'upstream unavailable'));
    expect(info.code).toBe('503');
    expect(info.userMessage).not.toContain('upstream');
    expect(info.userMessage).toContain('503');
  });

  it('StorageUnknownError (fetch never completed) → code network', () => {
    const info = describeStorageError(unknownError('Failed to fetch'));
    expect(info.code).toBe('network');
    expect(info.logLine).toContain('[network]');
  });

  it('plain Error → code unknown, message in logLine', () => {
    const info = describeStorageError(new Error('boom'));
    expect(info.code).toBe('unknown');
    expect(info.logLine).toContain('boom');
  });

  it('non-error value → fallback via String()', () => {
    const info = describeStorageError('just a string');
    expect(info.code).toBe('unknown');
    expect(info.logLine).toContain('just a string');
  });

  it('logLine is always single-line and starts with a bracketed code', () => {
    const info = describeStorageError(apiError(400, 'line1\nline2'));
    expect(info.logLine.startsWith('[')).toBe(true);
    expect(info.logLine).not.toContain('\n');
  });

  it('exports a toast duration longer than the ~5s default', () => {
    expect(UPLOAD_ERROR_TOAST_DURATION).toBeGreaterThan(5000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- storageError`
Expected: FAIL — `Cannot find module '@/lib/storageError'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/storageError.ts`:

```typescript
export interface StorageErrorInfo {
  /** HTTP-ish status ('400', '413', ...), 'network', or 'unknown'. */
  code: string;
  /** Curated, safe-to-render toast text. Never contains raw server output. */
  userMessage: string;
  /** Single-line, '[code]'-prefixed summary carrying the raw body for logs/Faro. */
  logLine: string;
}

/** Longer than Radix's ~5s default so a reportable code survives on screen. */
export const UPLOAD_ERROR_TOAST_DURATION = 12000;

const CURATED_MESSAGES: Record<string, string> = {
  '413': 'This file is too large to upload.',
  '415': "That file type isn't supported.",
  '409': 'A file with that name already exists.',
};

function generic(code: string): string {
  return `Upload failed (code ${code}). Please try again — if it keeps happening, share this code with support.`;
}

function oneLine(value: string): string {
  return value.replace(/\s*\n\s*/g, ' ').trim();
}

export function describeStorageError(error: unknown): StorageErrorInfo {
  // StorageApiError — duck-typed on HTTP status fields (avoids importing the class).
  if (
    typeof error === 'object' &&
    error !== null &&
    ('status' in error || 'statusCode' in error)
  ) {
    const e = error as { status?: unknown; statusCode?: unknown; message?: unknown };
    const rawStatus = e.status ?? e.statusCode;
    const code = rawStatus === undefined || rawStatus === null ? 'unknown' : String(rawStatus);
    const rawMessage = typeof e.message === 'string' ? e.message : code;
    return {
      code,
      userMessage: CURATED_MESSAGES[code] ?? generic(code),
      logLine: oneLine(`[${code}] ${rawMessage}`),
    };
  }

  // StorageUnknownError — carries originalError; the fetch never completed.
  if (typeof error === 'object' && error !== null && 'originalError' in error) {
    const e = error as { message?: unknown };
    const rawMessage = typeof e.message === 'string' ? e.message : 'network error';
    return {
      code: 'network',
      userMessage: generic('network'),
      logLine: oneLine(`[network] ${rawMessage}`),
    };
  }

  if (error instanceof Error) {
    return {
      code: 'unknown',
      userMessage: generic('unknown'),
      logLine: oneLine(`[unknown] ${error.message}`),
    };
  }

  return {
    code: 'unknown',
    userMessage: generic('unknown'),
    logLine: oneLine(`[unknown] ${String(error)}`),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- storageError`
Expected: PASS (11 tests).

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck
git add src/lib/storageError.ts tests/unit/storageError.test.ts
git commit -m "feat(storage): add describeStorageError diagnostics helper"
```

---

### Task 2: `ProductDialog.tsx` — remove DEV gate, Tier A + inline (reported "pictures" bug)

**Files:**
- Modify: `src/components/ProductDialog.tsx` (imports; `handleImageUpload` ~282-311; add inline error state + render)

**Interfaces:**
- Consumes: `describeStorageError`, `UPLOAD_ERROR_TOAST_DURATION` from `@/lib/storageError`. `useToast()` is already imported and used in this component.
- Produces: nothing for later tasks.

- [ ] **Step 1: Add the import**

Add to the util import group (per CLAUDE.md import order):

```typescript
import { describeStorageError, UPLOAD_ERROR_TOAST_DURATION } from '@/lib/storageError';
```

- [ ] **Step 2: Add inline-error state**

Next to the existing `uploading` state near the top of the component, add:

```typescript
const [imageUploadError, setImageUploadError] = useState<string | null>(null);
```

- [ ] **Step 3: Rewrite `handleImageUpload`**

Replace the whole function (currently lines ~282-311). Before:

```typescript
  const handleImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${Math.random().toString(36).substring(2)}.${fileExt}`;
      const filePath = `${restaurantId}/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('product-images')
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      const { data } = supabase.storage
        .from('product-images')
        .getPublicUrl(filePath);

      setImageUrl(data.publicUrl);
      form.setValue('image_url', data.publicUrl);
    } catch (error) {
      if (import.meta.env.DEV) {
        console.error('Error uploading image:', error);
      }
    } finally {
      setUploading(false);
    }
  };
```

After:

```typescript
  const handleImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setImageUploadError(null);
    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${Math.random().toString(36).substring(2)}.${fileExt}`;
      const filePath = `${restaurantId}/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('product-images')
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      const { data } = supabase.storage
        .from('product-images')
        .getPublicUrl(filePath);

      setImageUrl(data.publicUrl);
      form.setValue('image_url', data.publicUrl);
    } catch (error: unknown) {
      const info = describeStorageError(error);
      console.error(info.logLine);
      setImageUploadError(info.userMessage);
      toast({
        title: 'Upload failed',
        description: info.userMessage,
        variant: 'destructive',
        duration: UPLOAD_ERROR_TOAST_DURATION,
      });
    } finally {
      setUploading(false);
    }
  };
```

- [ ] **Step 4: Render the persistent inline error**

Find the image upload control (the `<Input type="file">`/upload button for the
product image). Immediately after that control's element, add:

```tsx
{imageUploadError && (
  <p className="text-[13px] text-destructive mt-1.5" role="alert">
    {imageUploadError}
  </p>
)}
```

- [ ] **Step 5: Typecheck, lint, verify no DEV gate remains**

```bash
npm run typecheck
npm run lint -- src/components/ProductDialog.tsx
grep -n "import.meta.env.DEV" src/components/ProductDialog.tsx
```

Expected: typecheck/lint clean; the `grep` no longer matches inside
`handleImageUpload` (other unrelated DEV logs in the file, e.g. in
`handleSubmit`, are out of scope and may remain).

- [ ] **Step 6: Commit**

```bash
git add src/components/ProductDialog.tsx
git commit -m "fix(inventory): surface product image upload errors (remove DEV-gated swallow)"
```

---

### Task 3: `useReceiptImport.tsx` + `ReceiptUpload.tsx` — Tier A + inline (reported "PDFs" path)

**Files:**
- Modify: `src/hooks/useReceiptImport.tsx` (catch ~251-258; return type of `uploadReceipt`)
- Modify: `src/components/ReceiptUpload.tsx` (render inline error from the hook)

**Interfaces:**
- Consumes: `describeStorageError`, `UPLOAD_ERROR_TOAST_DURATION` from `@/lib/storageError`.
- Produces: `useReceiptImport()` additionally returns `uploadErrorMessage: string | null` and `clearUploadError: () => void` for `ReceiptUpload.tsx`.

- [ ] **Step 1: Import + state in the hook**

Add import:

```typescript
import { describeStorageError, UPLOAD_ERROR_TOAST_DURATION } from '@/lib/storageError';
```

Add state alongside the existing `isUploading` state:

```typescript
const [uploadErrorMessage, setUploadErrorMessage] = useState<string | null>(null);
const clearUploadError = () => setUploadErrorMessage(null);
```

- [ ] **Step 2: Clear on new attempt + rewrite the catch**

At the start of `uploadReceipt` (right where `setIsUploading(true)` runs), add
`setUploadErrorMessage(null);`.

Replace the catch (currently ~251-258). Before:

```typescript
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
```

After:

```typescript
    } catch (error: unknown) {
      const info = describeStorageError(error);
      console.error(info.logLine);
      setUploadErrorMessage(info.userMessage);
      toast({
        title: 'Upload failed',
        description: info.userMessage,
        variant: 'destructive',
        duration: UPLOAD_ERROR_TOAST_DURATION,
      });
      return null;
    } finally {
      setIsUploading(false);
    }
```

- [ ] **Step 3: Export the new fields**

In the hook's return object, add `uploadErrorMessage` and `clearUploadError`
alongside the existing returned values (e.g. `isUploading`, `uploadReceipt`).

- [ ] **Step 4: Render inline error in `ReceiptUpload.tsx`**

Destructure the new fields where the component already calls `useReceiptImport()`:

```typescript
const { uploadErrorMessage, clearUploadError, /* ...existing... */ } = useReceiptImport();
```

Immediately after the receipt file `<Input id="receipt-file" ...>` element, add:

```tsx
{uploadErrorMessage && (
  <p className="text-[13px] text-destructive mt-1.5" role="alert">
    {uploadErrorMessage}
  </p>
)}
```

If the component has an `onChange`/select handler that begins a new upload,
call `clearUploadError()` at its start so a fresh pick clears the stale line.

- [ ] **Step 5: Typecheck + lint**

```bash
npm run typecheck
npm run lint -- src/hooks/useReceiptImport.tsx src/components/ReceiptUpload.tsx
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useReceiptImport.tsx src/components/ReceiptUpload.tsx
git commit -m "fix(inventory): surface receipt upload error code inline + toast"
```

---

### Task 4: Tier A toast sites (6 flows)

Each site swaps its catch body to `describeStorageError` + code-keyed toast, and
tightens `catch (error)` → `catch (error: unknown)`. Import
`{ describeStorageError, UPLOAD_ERROR_TOAST_DURATION }` from `@/lib/storageError`
in each file.

**Files:**
- Modify: `src/components/ProductUpdateDialog.tsx` (catch ~278-284)
- Modify: `src/hooks/useAssetImport.ts` (catch after line 74)
- Modify: `src/hooks/useAssetPhotos.ts` (catch ~171)
- Modify: `src/hooks/useAttachments.ts` (catch ~267)
- Modify: `src/hooks/useBankStatementImport.tsx` (catch below line 145)
- Modify: `src/hooks/useExpenseInvoiceUpload.tsx` (catch ~103-112)

**Interfaces:**
- Consumes: `describeStorageError`, `UPLOAD_ERROR_TOAST_DURATION`.
- Produces: nothing.

- [ ] **Step 1: `ProductUpdateDialog.tsx`**

Before:

```typescript
    } catch (error) {
      console.error('Error uploading image:', error);
      toast({
        title: "Upload failed",
        description: "Failed to upload image",
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
```

After:

```typescript
    } catch (error: unknown) {
      const info = describeStorageError(error);
      console.error(info.logLine);
      toast({
        title: 'Upload failed',
        description: info.userMessage,
        variant: 'destructive',
        duration: UPLOAD_ERROR_TOAST_DURATION,
      });
    } finally {
      setUploading(false);
    }
```

- [ ] **Step 2: `useAssetImport.ts` (primary upload, catch after line 74)**

Locate the catch of the `try` that wraps the `.from('asset-images').upload(...)`
at line 74 (its catch begins `} catch (error) {\n console.error('Error uploading document:', error);`). Replace its body's
`console.error` + `toast({...})` with:

```typescript
    } catch (error: unknown) {
      const info = describeStorageError(error);
      console.error(info.logLine);
      toast({
        title: 'Upload failed',
        description: info.userMessage,
        variant: 'destructive',
        duration: UPLOAD_ERROR_TOAST_DURATION,
      });
```

Keep the remainder of that catch (any state resets and the `return` /
`throw` that already follow) exactly as-is.

- [ ] **Step 3: `useAssetPhotos.ts` (catch ~171)**

Before:

```typescript
      } catch (error) {
        console.error('Error uploading photo:', error);
        toast({
          title: 'Upload failed',
          description: 'Failed to upload the photo. Please try again.',
          variant: 'destructive',
        });
        return null;
      } finally {
        setIsUploading(false);
      }
```

After:

```typescript
      } catch (error: unknown) {
        const info = describeStorageError(error);
        console.error(info.logLine);
        toast({
          title: 'Upload failed',
          description: info.userMessage,
          variant: 'destructive',
          duration: UPLOAD_ERROR_TOAST_DURATION,
        });
        return null;
      } finally {
        setIsUploading(false);
      }
```

- [ ] **Step 4: `useAttachments.ts` (catch ~267)**

Before:

```typescript
      } catch (error) {
        console.error('Error uploading attachment:', error);
        toast({
          title: 'Upload failed',
          description: 'Failed to upload the file. Please try again.',
          variant: 'destructive',
        });
        return null;
      } finally {
```

After:

```typescript
      } catch (error: unknown) {
        const info = describeStorageError(error);
        console.error(info.logLine);
        toast({
          title: 'Upload failed',
          description: info.userMessage,
          variant: 'destructive',
          duration: UPLOAD_ERROR_TOAST_DURATION,
        });
        return null;
      } finally {
```

- [ ] **Step 5: `useBankStatementImport.tsx`**

Find the catch of the `uploadBankStatement` `try` (the one whose `try` contains
the `.from('receipt-images').upload(...)` at line 126; its catch logs
`'Error uploading bank statement'` or similar and toasts destructive). Replace
its `console.error(...)` + `toast({...})` pair with:

```typescript
    } catch (error: unknown) {
      const info = describeStorageError(error);
      console.error(info.logLine);
      toast({
        title: 'Upload failed',
        description: info.userMessage,
        variant: 'destructive',
        duration: UPLOAD_ERROR_TOAST_DURATION,
      });
```

Preserve the existing `return`/`finally` that follow.

- [ ] **Step 6: `useExpenseInvoiceUpload.tsx` (catch ~103)**

Before:

```typescript
    } catch (error) {
      console.error('Error uploading invoice:', error);
      toast({
        title: 'Error',
        description: 'Failed to upload invoice',
        variant: 'destructive',
      });
      return null;
    } finally {
      setIsUploading(false);
    }
```

After:

```typescript
    } catch (error: unknown) {
      const info = describeStorageError(error);
      console.error(info.logLine);
      toast({
        title: 'Upload failed',
        description: info.userMessage,
        variant: 'destructive',
        duration: UPLOAD_ERROR_TOAST_DURATION,
      });
      return null;
    } finally {
      setIsUploading(false);
    }
```

- [ ] **Step 7: Typecheck + lint the batch**

```bash
npm run typecheck
npm run lint -- src/components/ProductUpdateDialog.tsx src/hooks/useAssetImport.ts src/hooks/useAssetPhotos.ts src/hooks/useAttachments.ts src/hooks/useBankStatementImport.tsx src/hooks/useExpenseInvoiceUpload.tsx
```

Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add src/components/ProductUpdateDialog.tsx src/hooks/useAssetImport.ts src/hooks/useAssetPhotos.ts src/hooks/useAttachments.ts src/hooks/useBankStatementImport.tsx src/hooks/useExpenseInvoiceUpload.tsx
git commit -m "feat(storage): code-keyed upload error toasts across 6 upload flows"
```

---

### Task 5: Tier B log-only sites (4 flows)

These preserve existing UX; they only enrich the log line with a stringified
storage diagnostic (fixing `[object Object]`). Import `{ describeStorageError }`
in each file. **No toast is added or changed.**

**Files:**
- Modify: `src/components/assets/AssetDialog.tsx` (throw at line 152: `if (uploadError) throw uploadError;`)
- Modify: `src/pages/Inventory.tsx` (throw at line 744: `if (uploadError) throw uploadError;`)
- Modify: `src/hooks/useAssetImport.ts` (best-effort attach ~line 414)
- Modify: `src/hooks/useTimePunches.tsx` (two log points: ~214 and ~222)

**Interfaces:**
- Consumes: `describeStorageError`.
- Produces: nothing.

- [ ] **Step 1: `AssetDialog.tsx` — log before throw**

Before:

```typescript
    if (uploadError) throw uploadError;
```

After:

```typescript
    if (uploadError) {
      console.error(describeStorageError(uploadError).logLine);
      throw uploadError;
    }
```

- [ ] **Step 2: `Inventory.tsx` — log before throw**

In `uploadImageToStorage`, before:

```typescript
    if (uploadError) throw uploadError;
```

After:

```typescript
    if (uploadError) {
      console.error(describeStorageError(uploadError).logLine);
      throw uploadError;
    }
```

- [ ] **Step 3: `useAssetImport.ts` — best-effort attach (~line 414)**

This path intentionally shows a non-destructive "Warning" and continues. Keep
all of that; only enrich the log line. Before:

```typescript
        if (uploadError) {
          console.error('Failed to upload document for attachment:', uploadError);
          documentStoragePath = null;
          toast({
            title: 'Warning',
            description: 'Could not attach document to assets. Assets will be imported without the invoice/receipt.',
            variant: 'default',
          });
        }
```

After (only the `console.error` line changes):

```typescript
        if (uploadError) {
          console.error(describeStorageError(uploadError).logLine);
          documentStoragePath = null;
          toast({
            title: 'Warning',
            description: 'Could not attach document to assets. Assets will be imported without the invoice/receipt.',
            variant: 'default',
          });
        }
```

- [ ] **Step 4: `useTimePunches.tsx` — enrich both kiosk log points**

Keep the `photoUploadFailed` flag and the `onSuccess` calm message untouched.
Only change the two `console.error` lines.

Before (the `if (uploadError)` branch, ~line 213):

```typescript
          if (uploadError) {
            console.error('Photo upload error:', uploadError);
            photoUploadFailed = true;
```

After:

```typescript
          if (uploadError) {
            console.error(describeStorageError(uploadError).logLine);
            photoUploadFailed = true;
```

Before (the `catch`, ~line 221):

```typescript
        } catch (error) {
          console.error('Photo upload exception:', error);
          photoUploadFailed = true;
```

After:

```typescript
        } catch (error: unknown) {
          console.error(describeStorageError(error).logLine);
          photoUploadFailed = true;
```

- [ ] **Step 5: Typecheck + lint the batch**

```bash
npm run typecheck
npm run lint -- src/components/assets/AssetDialog.tsx src/pages/Inventory.tsx src/hooks/useAssetImport.ts src/hooks/useTimePunches.tsx
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/components/assets/AssetDialog.tsx src/pages/Inventory.tsx src/hooks/useAssetImport.ts src/hooks/useTimePunches.tsx
git commit -m "chore(storage): stringify upload diagnostics on log-only sites (preserve UX)"
```

---

### Task 6: Full-suite verification

**Files:** none (verification only).

- [ ] **Step 1: Unit tests + typecheck + lint (whole project)**

```bash
npm run test -- storageError
npm run typecheck
npm run lint
```

Expected: `storageError` suite green; typecheck clean; lint clean.

- [ ] **Step 2: Confirm every touched upload site now references the helper**

```bash
grep -rl "describeStorageError" src/ | sort
```

Expected: 11 source files — `src/lib/storageError.ts`, `ProductDialog.tsx`,
`ProductUpdateDialog.tsx`, `AssetDialog.tsx`, `Inventory.tsx`,
`useAssetImport.ts`, `useAssetPhotos.ts`, `useAttachments.ts`,
`useBankStatementImport.tsx`, `useExpenseInvoiceUpload.tsx`,
`useReceiptImport.tsx`, `useTimePunches.tsx`. (That is 12 files; `useAssetImport.ts`
covers two of the twelve call sites.)

- [ ] **Step 3: Confirm no `[object Object]`-prone pattern remains at touched sites**

```bash
grep -rn "console.error('Error uploading" src/
```

Expected: no matches (all upload catches now log `info.logLine` /
`describeStorageError(...).logLine`).

- [ ] **Step 4: PII sweep of the branch diff + commit messages**

```bash
git diff origin/main... | grep -niE "adbd9392|7c0c76e3|5ff13707|russo|wetzel|cold stone" && echo "PII FOUND" || echo "clean"
git log origin/main..HEAD --format=%B | grep -niE "adbd9392|7c0c76e3|5ff13707|russo|wetzel|cold stone" && echo "PII FOUND" || echo "clean"
```

Expected: both `clean`.

---

## Self-Review

**Spec coverage:**
- `describeStorageError` + `StorageErrorInfo` + `UPLOAD_ERROR_TOAST_DURATION` → Task 1.
- No-raw-text `userMessage` policy (curated table; 400/5xx generic) → Task 1 impl + Task 1 tests (RLS-400 and 5xx cases).
- Tier A toast (8 flows) → Tasks 2, 3, 4 (ProductDialog, useReceiptImport, +6).
- Tier A+inline (2 reported surfaces) → Tasks 2 and 3.
- Tier B log-only (AssetDialog, Inventory, useAssetImport:411, useTimePunches) → Task 5.
- `import.meta.env.DEV` gate removal → Task 2.
- `catch (error: unknown)` tightening → Tasks 2–5.
- Real-fixture tests for SonarCloud coverage → Task 1.
- PII discipline → Task 6 Step 4.

**Placeholder scan:** none — every code step shows complete before/after.

**Type consistency:** `describeStorageError(error: unknown): StorageErrorInfo`
and `UPLOAD_ERROR_TOAST_DURATION` are named identically across Tasks 1–5. The
`{ code, userMessage, logLine }` field names match the tests in Task 1.

**Note on line numbers:** All line references are current as of branch base
`fix/upload-error-diagnostics`. Edits within a file shift later line numbers;
each step anchors on surrounding code, not the line number alone.
