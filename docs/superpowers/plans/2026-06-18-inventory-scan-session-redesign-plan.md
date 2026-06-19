# Inventory Barcode Scan Session Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the inventory camera barcode scanner pause on capture and drive a mobile-first scan → enter → resume flow, eliminating the background-rescanning bug.

**Architecture:** A controlled `active` prop gates every scanner engine (loop runs only while a synchronously-updated `activeRef` is true). A new `useScanSession` hook owns a state machine (`scanning → lookingUp → quickEntry | fullEntry → confirmed → scanning`) plus a session counter and an identity `createScanGate()`. A new `ScanSessionView` composes the scanner with the two existing entry components (reused, never double-wrapped) and a confirm-beat overlay. `Inventory.tsx`'s camera path delegates to `ScanSessionView`.

**Tech Stack:** React 18 + TypeScript, Vitest + @testing-library/react, Playwright, shadcn/Radix, html5-qrcode, native `BarcodeDetector`, Capacitor ML Kit.

**Design doc:** `docs/superpowers/specs/2026-06-18-inventory-scan-session-redesign-design.md`

---

## File Structure

**New**
- `src/utils/scannerConfig.ts` (extend) → `createScanGate()` identity-suppression factory.
- `src/hooks/useScanSession.ts` → state machine + counter + gate orchestration (no camera/DOM deps).
- `src/components/inventory/ScanSessionView.tsx` → mobile-first scan-session shell.
- Tests: `tests/unit/scannerConfig.scanGate.test.ts`, `tests/unit/useScanSession.test.ts`, `tests/unit/ScanSessionView.test.tsx`, `tests/e2e/inventory-scan-session.spec.ts`.

**Modified**
- `src/components/SmartBarcodeScanner.tsx` — add `active` prop (pass-through).
- `src/components/NativeBarcodeScanner.tsx` — `activeRef`-gated loop; freeze on pause; semantic-token badges.
- `src/components/Html5QrcodeScanner.tsx` — `.stop()`/`.start()` on `active`; snapshot freeze; semantic-token badges; preserve torch/flip.
- `src/components/MLKitBarcodeScanner.tsx` — scan only while `active`; re-scan only on re-arm.
- `src/components/QuickInventoryDialog.tsx` — `<DialogDescription>` + operator-button `aria-label`s.
- `src/pages/Inventory.tsx` — camera path renders `ScanSessionView`; `resolveNewProduct` helper.

**Reused (controlled, not double-wrapped)**
- `src/components/ProductUpdateDialog.tsx` → `ProductUpdateSheet` (mobile) / `ProductUpdateDialog` (desktop).

**Task dependency order:** 1 → 2 → (3,4,5,6 parallel-able) → 7 → 8 → 9 → 10. Tasks 1, 2, 7 are pure-logic/markup and fully unit-tested. Scanner tasks (4-6) are integration-covered by Task 8 (mocked) and Task 10 (e2e).

---

## Task 1: `createScanGate()` identity-suppression utility

**Files:**
- Modify: `src/utils/scannerConfig.ts` (append)
- Test: `tests/unit/scannerConfig.scanGate.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/scannerConfig.scanGate.test.ts
import { describe, it, expect } from 'vitest';
import { createScanGate } from '@/utils/scannerConfig';

describe('createScanGate', () => {
  it('accepts the first scan', () => {
    const gate = createScanGate();
    expect(gate.shouldAccept('0123456789012')).toBe(true);
  });

  it('suppresses the same value once it has been marked accepted', () => {
    const gate = createScanGate();
    gate.markAccepted('0123456789012');
    expect(gate.shouldAccept('0123456789012')).toBe(false);
  });

  it('accepts a different value and then no longer suppresses the old one', () => {
    const gate = createScanGate();
    gate.markAccepted('111');
    expect(gate.shouldAccept('222')).toBe(true); // different code clears suppression
    expect(gate.shouldAccept('111')).toBe(true); // old code no longer suppressed
  });

  it('reset() clears suppression', () => {
    const gate = createScanGate();
    gate.markAccepted('111');
    gate.reset();
    expect(gate.shouldAccept('111')).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `npm run test -- scannerConfig.scanGate`
Expected: FAIL — `createScanGate is not a function`.

- [ ] **Step 3: Implement `createScanGate` (append to `src/utils/scannerConfig.ts`)**

```ts
export interface ScanGate {
  /** True if `value` may be handled now; a value different from the suppressed one clears suppression. */
  shouldAccept: (value: string) => boolean;
  /** Suppress `value` until a different value is seen (or reset). */
  markAccepted: (value: string) => void;
  /** Clear any suppression. */
  reset: () => void;
}

/**
 * Identity-suppression gate. After a scan is accepted and handled, the SAME code is
 * suppressed until a genuinely different code appears — so an item still sitting in the
 * camera frame after save cannot double-add. Unlike `shouldDeduplicateScan`, this has no
 * time component; it is cleared by a new value or `reset()`.
 */
export const createScanGate = (): ScanGate => {
  let suppressed: string | null = null;
  return {
    shouldAccept(value: string): boolean {
      if (suppressed !== null && value === suppressed) return false;
      suppressed = null; // a new/different value clears suppression
      return true;
    },
    markAccepted(value: string): void {
      suppressed = value;
    },
    reset(): void {
      suppressed = null;
    },
  };
};
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `npm run test -- scannerConfig.scanGate`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/utils/scannerConfig.ts tests/unit/scannerConfig.scanGate.test.ts
git commit -m "feat(inventory): add createScanGate identity-suppression helper

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: `useScanSession` state-machine hook

**Files:**
- Create: `src/hooks/useScanSession.ts`
- Test: `tests/unit/useScanSession.test.ts`

Depends on Task 1.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/useScanSession.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useScanSession } from '@/hooks/useScanSession';
import type { Product } from '@/hooks/useProducts';

afterEach(() => vi.useRealTimers());

const product = (over: Partial<Product> = {}): Product =>
  ({ id: 'p1', name: 'Roma Tomatoes', gtin: '111', sku: '111', restaurant_id: 'r1' } as Product);

function makeDeps(over: Partial<Parameters<typeof useScanSession>[0]> = {}) {
  return {
    findProductByGtin: vi.fn(async () => null),
    resolveNewProduct: vi.fn(async (gtin: string) => product({ id: '', gtin })),
    onError: vi.fn(),
    onExit: vi.fn(),
    ...over,
  };
}

describe('useScanSession', () => {
  it('starts in scanning with active=true and zero count', () => {
    const { result } = renderHook(() => useScanSession(makeDeps()));
    expect(result.current.state).toBe('scanning');
    expect(result.current.isScanning).toBe(true);
    expect(result.current.itemsThisSession).toBe(0);
  });

  it('known item → quickEntry; commitQuick increments count, suppresses code, auto-resumes', async () => {
    const deps = makeDeps({ findProductByGtin: vi.fn(async () => product()) });
    const { result } = renderHook(() => useScanSession(deps));

    await act(async () => { await result.current.capture('111'); });
    expect(result.current.state).toBe('quickEntry');
    expect(result.current.isScanning).toBe(false);
    expect(result.current.activeProduct?.name).toBe('Roma Tomatoes');

    act(() => result.current.commitQuick());
    expect(result.current.state).toBe('scanning');
    expect(result.current.itemsThisSession).toBe(1);

    // the just-saved code is suppressed while still in frame
    await act(async () => { await result.current.capture('111'); });
    expect(result.current.state).toBe('scanning'); // gate rejected, no entry opened
  });

  it('new item → fullEntry; commitFull → confirmed; scanNext → scanning', async () => {
    const { result } = renderHook(() => useScanSession(makeDeps()));
    await act(async () => { await result.current.capture('999'); });
    expect(result.current.state).toBe('fullEntry');

    act(() => result.current.commitFull());
    expect(result.current.state).toBe('confirmed');
    expect(result.current.itemsThisSession).toBe(1);

    act(() => result.current.scanNext());
    expect(result.current.state).toBe('scanning');
  });

  it('ignores captures while not scanning (no duplicate entry)', async () => {
    const deps = makeDeps({ findProductByGtin: vi.fn(async () => product()) });
    const { result } = renderHook(() => useScanSession(deps));
    await act(async () => { await result.current.capture('111'); });
    expect(result.current.state).toBe('quickEntry');
    await act(async () => { await result.current.capture('222'); }); // should be ignored
    expect(deps.findProductByGtin).toHaveBeenCalledTimes(1);
  });

  it('cancelEntry returns to scanning and suppresses the code', async () => {
    const deps = makeDeps({ findProductByGtin: vi.fn(async () => product()) });
    const { result } = renderHook(() => useScanSession(deps));
    await act(async () => { await result.current.capture('111'); });
    act(() => result.current.cancelEntry());
    expect(result.current.state).toBe('scanning');
    expect(result.current.itemsThisSession).toBe(0);
  });

  it('endSession resets count + gate and calls onExit', async () => {
    const deps = makeDeps({ findProductByGtin: vi.fn(async () => product()) });
    const { result } = renderHook(() => useScanSession(deps));
    await act(async () => { await result.current.capture('111'); });
    act(() => result.current.commitQuick());
    act(() => result.current.endSession());
    expect(deps.onExit).toHaveBeenCalled();
    expect(result.current.itemsThisSession).toBe(0);
  });

  it('treats a findProductByGtin rejection as not-found and opens fullEntry', async () => {
    const deps = makeDeps({ findProductByGtin: vi.fn(async () => { throw new Error('net'); }) });
    const { result } = renderHook(() => useScanSession(deps));
    await act(async () => { await result.current.capture('777'); });
    expect(result.current.state).toBe('fullEntry');
    expect(deps.resolveNewProduct).toHaveBeenCalledWith('777');
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `npm run test -- useScanSession`
Expected: FAIL — cannot find module `@/hooks/useScanSession`.

- [ ] **Step 3: Implement the hook**

```ts
// src/hooks/useScanSession.ts
import { useCallback, useRef, useState } from 'react';
import type { Product } from '@/hooks/useProducts';
import { createScanGate } from '@/utils/scannerConfig';
import { useEffect } from 'react';

export type ScanSessionState =
  | 'scanning'
  | 'lookingUp'
  | 'quickEntry'
  | 'fullEntry'
  | 'confirmed'
  | 'ended';

export interface UseScanSessionDeps {
  /** Look up an existing product by scanned GTIN. May resolve null or reject. */
  findProductByGtin: (gtin: string) => Promise<Product | null>;
  /** Build a prefilled NEW product for the full form. Must NOT throw (fall back to a blank product). */
  resolveNewProduct: (gtin: string) => Promise<Product>;
  onError?: (message: string) => void;
  /** Called when the user ends the session (Done). */
  onExit?: () => void;
}

export interface ScanSession {
  state: ScanSessionState;
  isScanning: boolean;
  itemsThisSession: number;
  activeProduct: Product | null;
  /** Camera capture entry-point. Guarded: only acts while scanning AND when the gate allows the code. */
  capture: (gtin: string, format?: string) => Promise<void>;
  /** Manual-entry / AI-OCR path: open the full form with a prebuilt product. */
  enterFullEntry: (product: Product) => void;
  commitQuick: () => void;
  commitFull: () => void;
  cancelEntry: () => void;
  scanNext: () => void;
  endSession: () => void;
}

export function useScanSession(deps: UseScanSessionDeps): ScanSession {
  const { findProductByGtin, resolveNewProduct, onError, onExit } = deps;

  const [state, setState] = useState<ScanSessionState>('scanning');
  const [itemsThisSession, setItems] = useState(0);
  const [activeProduct, setActiveProduct] = useState<Product | null>(null);

  const gateRef = useRef(createScanGate());
  const lastGtinRef = useRef<string | null>(null);

  // Synchronously-mirrored state so the async `capture` guard reads the latest value
  // without forcing `capture` to change identity every transition.
  const stateRef = useRef(state);
  stateRef.current = state;

  // Unmount guard for setState after the await chain (lesson 2026-05-16).
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const capture = useCallback(async (gtin: string, _format?: string) => {
    if (stateRef.current !== 'scanning') return;            // only one capture in flight
    if (!gateRef.current.shouldAccept(gtin)) return;        // suppress lingering same code
    lastGtinRef.current = gtin;
    setState('lookingUp');

    let existing: Product | null = null;
    try {
      existing = await findProductByGtin(gtin);
    } catch (err) {
      existing = null;                                      // treat lookup failure as not-found
      onError?.(err instanceof Error ? err.message : 'Product lookup failed');
    }
    if (!mountedRef.current) return;

    if (existing) {
      setActiveProduct(existing);
      setState('quickEntry');
      return;
    }

    const created = await resolveNewProduct(gtin);          // never throws (blank fallback)
    if (!mountedRef.current) return;
    setActiveProduct(created);
    setState('fullEntry');
  }, [findProductByGtin, resolveNewProduct, onError]);

  const enterFullEntry = useCallback((product: Product) => {
    if (stateRef.current !== 'scanning') return;
    lastGtinRef.current = product.gtin || `manual-${product.sku}`;
    setActiveProduct(product);
    setState('fullEntry');
  }, []);

  const commitQuick = useCallback(() => {
    if (lastGtinRef.current) gateRef.current.markAccepted(lastGtinRef.current);
    setItems((n) => n + 1);
    setActiveProduct(null);
    setState('scanning');
  }, []);

  const commitFull = useCallback(() => {
    setItems((n) => n + 1);
    setState('confirmed');                                  // gate marked on scanNext
  }, []);

  const cancelEntry = useCallback(() => {
    if (lastGtinRef.current) gateRef.current.markAccepted(lastGtinRef.current);
    setActiveProduct(null);
    setState('scanning');
  }, []);

  const scanNext = useCallback(() => {
    if (lastGtinRef.current) gateRef.current.markAccepted(lastGtinRef.current);
    setActiveProduct(null);
    setState('scanning');
  }, []);

  const endSession = useCallback(() => {
    gateRef.current.reset();
    setItems(0);
    setActiveProduct(null);
    setState('ended');
    onExit?.();
  }, [onExit]);

  return {
    state,
    isScanning: state === 'scanning',
    itemsThisSession,
    activeProduct,
    capture,
    enterFullEntry,
    commitQuick,
    commitFull,
    cancelEntry,
    scanNext,
    endSession,
  };
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `npm run test -- useScanSession`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useScanSession.ts tests/unit/useScanSession.test.ts
git commit -m "feat(inventory): add useScanSession state-machine hook

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: `SmartBarcodeScanner` — add controlled `active` prop (pass-through)

**Files:**
- Modify: `src/components/SmartBarcodeScanner.tsx`

- [ ] **Step 1: Add `active` to the props interface**

In `SmartBarcodeScannerProps` (currently lines 10-15), add:

```ts
interface SmartBarcodeScannerProps {
  onScan: (barcode: string, format: string) => void;
  onError?: (error: string) => void;
  className?: string;
  autoStart?: boolean;
  active?: boolean; // controlled scan enable/disable; defaults to true for backward compat
}
```

- [ ] **Step 2: Thread it through**

Destructure `active = true` in the component signature, then pass `active` to both engine branches:

```tsx
      {scannerType === 'native' ? (
        <NativeBarcodeScanner onScan={onScan} onError={onError} className={className} autoStart={autoStart} active={active} />
      ) : (
        <Html5QrcodeScanner onScan={onScan} onError={onError} className={className} autoStart={autoStart} active={active} />
      )}
```

And in the `mlkit` branch:

```tsx
        <MLKitBarcodeScanner onScan={onScan} onError={onError} className={className} active={active} />
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS (the engines gain `active?` in Tasks 4-6; until then TS allows the optional prop only after those interfaces are updated — implement Tasks 4-6 before typecheck if done out of order).

- [ ] **Step 4: Commit**

```bash
git add src/components/SmartBarcodeScanner.tsx
git commit -m "feat(scanner): add controlled active prop to SmartBarcodeScanner

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: `NativeBarcodeScanner` — `activeRef`-gated loop + freeze + semantic badges

**Files:**
- Modify: `src/components/NativeBarcodeScanner.tsx`

**Mechanism:** the rAF loop runs only while `activeRef.current`. The session sets `active=false` on capture; the `active` effect synchronously mirrors it into `activeRef`, cancels the pending frame, and pauses the `<video>` (freezing the last frame). Re-arm = `active` true → resume `.play()` + reschedule. `onScan` is read through `onScanRef` so the latest handler is always used (kills the stale-closure root cause).

- [ ] **Step 1: Add prop + refs**

Add `active?: boolean` to `NativeBarcodeScannerProps`; destructure `active = true`. Add refs near the existing ones:

```ts
  const activeRef = useRef(active);
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan; // refreshed every render
```

- [ ] **Step 2: Gate the loop on `activeRef` and call `onScanRef`**

Replace the start/guard of `scanLoop` and its reschedule tail:

```ts
  const scanLoop = async () => {
    if (!activeRef.current || !videoRef.current) {
      animationFrameRef.current = null;
      return;
    }
    try {
      const barcodes = await detectorRef.current!.detect(videoRef.current!);
      if (barcodes.length > 0 && activeRef.current) {
        const barcode = barcodes[0];
        const now = Date.now();
        if (
          !lastScanRef.current ||
          lastScanRef.current.value !== barcode.rawValue ||
          now - lastScanRef.current.time > 2000
        ) {
          let barcodeValue = barcode.rawValue;
          if (barcode.format === 'ean_13' && barcode.rawValue.startsWith('0')) {
            barcodeValue = barcode.rawValue.slice(1);
          }
          lastScanRef.current = { value: barcodeValue, time: now };
          setLastScanned(barcodeValue);
          onScanRef.current(barcodeValue, barcode.format);
          setTimeout(() => setLastScanned(null), 2000);
        }
      }
    } catch (error) {
      console.error('Detection error:', error);
    }
    animationFrameRef.current = activeRef.current ? requestAnimationFrame(scanLoop) : null;
  };
```

- [ ] **Step 3: Drive start/pause/resume from the `active` prop**

Replace the `useEffect([autoStart])` (lines 67-71) with an `active`-driven effect:

```ts
  useEffect(() => {
    activeRef.current = active;
    if (active) {
      if (!streamRef.current && isDetectorReady.current) {
        startScanning(); // first start (acquires the stream, sets isScanning, kicks scanLoop)
      } else if (streamRef.current && videoRef.current) {
        videoRef.current.play().catch(() => {});
        if (animationFrameRef.current == null) {
          animationFrameRef.current = requestAnimationFrame(scanLoop); // resume
        }
      }
    } else {
      if (animationFrameRef.current != null) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      videoRef.current?.pause(); // freeze the last frame behind the entry overlay
    }
  }, [active]);
```

> Keep `autoStart` in the props for backward compatibility but it no longer drives start — `active` does. In `startScanning`, after `await videoRef.current.play()`, only call `scanLoop()` if `activeRef.current` is true.

- [ ] **Step 4: Convert overlay badges to semantic tokens (M4)**

Replace the gradient badge classes:
- Line ~193 `bg-gradient-to-r from-primary to-accent` → `bg-foreground text-background`
- Line ~198 `bg-gradient-to-r from-green-500 to-emerald-600 animate-in fade-in` → `bg-foreground text-background animate-in fade-in`

- [ ] **Step 5: Manual verification (camera APIs are not unit-testable here)**

Run: `npm run build` and `npm run lint`.
Expected: both PASS. Integration behavior is covered by Task 8 (mocked) and Task 10 (e2e).

- [ ] **Step 6: Commit**

```bash
git add src/components/NativeBarcodeScanner.tsx
git commit -m "feat(scanner): gate NativeBarcodeScanner on controlled active prop

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: `Html5QrcodeScanner` — `.stop()`/`.start()` on `active` + snapshot freeze + semantic badges

**Files:**
- Modify: `src/components/Html5QrcodeScanner.tsx`

**Mechanism:** the html5-qrcode library owns its loop, so pause = `.stop()` and resume = `.start()`. Before stopping, snapshot the library's `<video>` to a dataURL for the freeze backdrop; show it (semantic-token dim) while paused. The success callback is guarded by `activeRef` and calls `onScanRef`.

- [ ] **Step 1: Add prop + refs + freeze state**

Add `active?: boolean` to props; destructure `active = true`. Add:

```ts
  const activeRef = useRef(active);
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;
  const [frozenFrame, setFrozenFrame] = useState<string | null>(null);
```

- [ ] **Step 2: Guard the success callback + use `onScanRef`**

Inside `scannerRef.current.start(..., (decodedText, decodedResult) => { ... })`, add at the top of the callback:

```ts
            if (!activeRef.current) return;
```

and replace the `onScan(processedValue, formatName)` call with `onScanRef.current(processedValue, formatName)`.

- [ ] **Step 3: Snapshot helper + `active` effect**

```ts
  const snapshotFrame = (): string | null => {
    const video = document.getElementById(elementId.current)?.querySelector('video') as HTMLVideoElement | null;
    if (!video || !video.videoWidth) return null;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0);
    try { return canvas.toDataURL('image/jpeg', 0.6); } catch { return null; }
  };

  useEffect(() => {
    activeRef.current = active;
    if (!scannerRef.current) return;
    if (active) {
      setFrozenFrame(null);
      if (!scannerRef.current.isScanning) startScanning(); // re-acquire + resume
    } else if (scannerRef.current.isScanning) {
      setFrozenFrame(snapshotFrame());                     // freeze backdrop, then stop
      cleanup();
    }
  }, [active]);
```

Remove `startScanning()` from the `autoStart` init effect's success branch (lines 79-81) so `active` is the single source of truth; keep the rest of init (camera enumeration).

- [ ] **Step 4: Render the freeze backdrop with a semantic token (m4)**

Add inside the scanner container, after the `#elementId` div:

```tsx
          {frozenFrame && (
            <div className="absolute inset-0">
              <img src={frozenFrame} alt="" aria-hidden="true" className="w-full h-full object-cover" />
              <div className="absolute inset-0 bg-background/90 backdrop-blur-sm" />
            </div>
          )}
```

- [ ] **Step 5: Convert overlay badges to semantic tokens (M4)**

- Line ~301 `bg-gradient-to-r from-blue-500 to-cyan-600` → `bg-foreground text-background`
- Line ~306 `bg-gradient-to-r from-green-500 to-emerald-600 animate-in fade-in` → `bg-foreground text-background animate-in fade-in`
- Line ~325 the tips overlay `bg-black/60` → `bg-foreground/80 text-background`

- [ ] **Step 6: Build + lint**

Run: `npm run build && npm run lint`
Expected: PASS. (Torch + camera-flip code paths are untouched and preserved.)

- [ ] **Step 7: Commit**

```bash
git add src/components/Html5QrcodeScanner.tsx
git commit -m "feat(scanner): control Html5QrcodeScanner via active prop with snapshot freeze

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: `MLKitBarcodeScanner` — scan only while `active`, re-scan only on re-arm

**Files:**
- Modify: `src/components/MLKitBarcodeScanner.tsx`

**Mechanism:** ML Kit is a modal one-shot today that auto-starts on mount. Bring it under the contract: launch `BarcodeScanner.scan()` only on an `active` false→true edge (and on first mount if `active`), and route the result through `onScanRef`. Do not auto-relaunch.

- [ ] **Step 1: Add prop + refs**

Add `active?: boolean` to props; destructure `active = true`. Add:

```ts
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;
  const prevActiveRef = useRef(false);
```

- [ ] **Step 2: Replace the mount auto-start effect with an `active`-edge effect**

Replace the existing `useEffect(() => { handleScan(); }, [])` (lines ~78-80) with:

```ts
  useEffect(() => {
    // Launch a native scan only on a false→true transition (re-arm) or initial active mount.
    if (active && !prevActiveRef.current) {
      handleScan();
    }
    prevActiveRef.current = active;
  }, [active]);
```

In `handleScan`, replace the `onScan(...)` call with `onScanRef.current(...)`. After a successful scan returns its value, **do not** re-invoke `handleScan` — the session re-arms via the `active` toggle.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: PASS. (Native ML Kit behavior is verified on-device manually; covered structurally by the build.)

- [ ] **Step 4: Commit**

```bash
git add src/components/MLKitBarcodeScanner.tsx
git commit -m "feat(scanner): gate MLKitBarcodeScanner on active re-arm edge

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: `QuickInventoryDialog` accessibility (DialogDescription + aria-labels)

**Files:**
- Modify: `src/components/QuickInventoryDialog.tsx`
- Test: `tests/unit/QuickInventoryDialog.a11y.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// tests/unit/QuickInventoryDialog.a11y.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QuickInventoryDialog } from '@/components/QuickInventoryDialog';
import type { Product } from '@/hooks/useProducts';

const product = { id: 'p1', name: 'Roma Tomatoes', brand: 'Acme', current_stock: 4, uom_purchase: 'cans' } as Product;

describe('QuickInventoryDialog a11y', () => {
  it('exposes a dialog description and labelled operator buttons', () => {
    render(
      <QuickInventoryDialog
        open onOpenChange={() => {}} product={product} mode="add"
        onSave={vi.fn(async () => {})} restaurantId="r1"
      />,
    );
    // Radix wires aria-describedby only when DialogDescription is present.
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-describedby');
    expect(screen.getByLabelText('Add')).toBeInTheDocument();       // '+'
    expect(screen.getByLabelText('Subtract')).toBeInTheDocument();  // '-'
    expect(screen.getByLabelText('Multiply')).toBeInTheDocument();  // '×'
    expect(screen.getByLabelText('Divide')).toBeInTheDocument();    // '÷'
  });
});
```

- [ ] **Step 2: Run, verify it fails**

Run: `npm run test -- QuickInventoryDialog.a11y`
Expected: FAIL — no `aria-describedby`; no labelled operator buttons.

- [ ] **Step 3: Add `DialogDescription` import + element**

Add `DialogDescription` to the import from `@/components/ui/dialog`, and add it under the title (use the brand / stock as the natural subline):

```tsx
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            Quick Inventory
          </DialogTitle>
          <DialogDescription className="text-[13px] text-muted-foreground">
            {product.name}{product.brand ? ` · ${product.brand}` : ''}
          </DialogDescription>
        </DialogHeader>
```

- [ ] **Step 4: Add `aria-label`s to the operator buttons**

Give each operator an explicit label and apply it. Change the `operatorButtons` array and the button:

```tsx
  const operatorButtons = [
    { label: '+', value: '+', icon: Plus, aria: 'Add' },
    { label: '-', value: '-', icon: Minus, aria: 'Subtract' },
    { label: '×', value: '*', icon: X, aria: 'Multiply' },
    { label: '÷', value: '/', icon: Divide, aria: 'Divide' },
  ];
```

```tsx
                  <Button
                    key={op.value}
                    variant="outline"
                    size="lg"
                    onClick={() => handleNumpadClick(op.value)}
                    className="text-xl font-semibold h-16"
                    aria-label={op.aria}
                    title={op.aria}
                  >
                    <op.icon className="h-5 w-5" />
                  </Button>
```

Also add `aria-label="Backspace"` to the `⌫` button and `aria-label="Clear"` is implicit (it has text).

- [ ] **Step 5: Run, verify it passes**

Run: `npm run test -- QuickInventoryDialog.a11y`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/QuickInventoryDialog.tsx tests/unit/QuickInventoryDialog.a11y.test.tsx
git commit -m "fix(inventory): add DialogDescription + operator aria-labels to QuickInventoryDialog

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: `ScanSessionView` component

**Files:**
- Create: `src/components/inventory/ScanSessionView.tsx`
- Test: `tests/unit/ScanSessionView.test.tsx`

Depends on Tasks 2-7. Composes the controlled scanner + the session hook + the two reused entry components (single instance each, controlled `open`, never double-wrapped) + the confirm-beat overlay.

- [ ] **Step 1: Write the failing component test (mocked scanner)**

```tsx
// tests/unit/ScanSessionView.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ScanSessionView } from '@/components/inventory/ScanSessionView';
import type { Product } from '@/hooks/useProducts';

// Mock the scanner: expose a button that fires onScan, and reflect `active` for assertions.
vi.mock('@/components/SmartBarcodeScanner', () => ({
  SmartBarcodeScanner: ({ onScan, active }: any) => (
    <div data-testid="scanner" data-active={String(active)}>
      <button onClick={() => onScan('111', 'EAN_13')}>emit-known</button>
      <button onClick={() => onScan('999', 'EAN_13')}>emit-new</button>
    </div>
  ),
}));

const known = { id: 'p1', name: 'Roma Tomatoes', brand: 'Acme', current_stock: 4, uom_purchase: 'cans' } as Product;

function setup(over: Partial<React.ComponentProps<typeof ScanSessionView>> = {}) {
  const props = {
    restaurantId: 'r1',
    findProductByGtin: vi.fn(async (g: string) => (g === '111' ? known : null)),
    resolveNewProduct: vi.fn(async (g: string) => ({ id: '', gtin: g, name: 'New Product', sku: g } as Product)),
    onAddQuantity: vi.fn(async () => {}),
    onUpdateProduct: vi.fn(async () => {}),
    onExit: vi.fn(),
    ...over,
  };
  render(<ScanSessionView {...props} />);
  return props;
}

describe('ScanSessionView', () => {
  it('scanner is active while scanning', () => {
    setup();
    expect(screen.getByTestId('scanner')).toHaveAttribute('data-active', 'true');
  });

  it('known item opens the quick dialog and pauses the scanner', async () => {
    setup();
    fireEvent.click(screen.getByText('emit-known'));
    await screen.findByText('Quick Inventory');
    expect(screen.getByTestId('scanner')).toHaveAttribute('data-active', 'false');
  });

  it('a second emit while an entry is open does NOT open a second entry', async () => {
    const props = setup();
    fireEvent.click(screen.getByText('emit-known'));
    await screen.findByText('Quick Inventory');
    fireEvent.click(screen.getByText('emit-new')); // ignored: not scanning
    await waitFor(() => expect(props.findProductByGtin).toHaveBeenCalledTimes(1));
  });

  it('new item opens the full form', async () => {
    setup();
    fireEvent.click(screen.getByText('emit-new'));
    await waitFor(() => expect(screen.getByTestId('scanner')).toHaveAttribute('data-active', 'false'));
  });
});
```

- [ ] **Step 2: Run, verify it fails**

Run: `npm run test -- ScanSessionView`
Expected: FAIL — cannot find `@/components/inventory/ScanSessionView`.

- [ ] **Step 3: Implement `ScanSessionView`**

```tsx
// src/components/inventory/ScanSessionView.tsx
import { useCallback } from 'react';
import { Capacitor } from '@capacitor/core';
import { Button } from '@/components/ui/button';
import { Package, Loader2, Check, ScanLine, X } from 'lucide-react';
import { SmartBarcodeScanner } from '@/components/SmartBarcodeScanner';
import { QuickInventoryDialog } from '@/components/QuickInventoryDialog';
import { ProductUpdateDialog, ProductUpdateSheet } from '@/components/ProductUpdateDialog';
import { useScanSession } from '@/hooks/useScanSession';
import type { Product } from '@/hooks/useProducts';
import { cn } from '@/lib/utils';

export interface ScanSessionViewProps {
  restaurantId: string | null;
  findProductByGtin: (gtin: string) => Promise<Product | null>;
  resolveNewProduct: (gtin: string) => Promise<Product>;
  onAddQuantity: (product: Product, quantity: number, location?: string) => Promise<void>;
  onUpdateProduct: (product: Product, updates: Partial<Product>, quantityToAdd: number) => Promise<void>;
  onEnhance?: (product: Product) => Promise<any>;
  onExit: () => void;
}

function vibrate() {
  // Best-effort haptic. Fires on Android web; silently absent on iOS Safari/WKWebView.
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    try { navigator.vibrate(20); } catch { /* no-op */ }
  }
}

export function ScanSessionView(props: ScanSessionViewProps) {
  const {
    restaurantId, findProductByGtin, resolveNewProduct,
    onAddQuantity, onUpdateProduct, onEnhance, onExit,
  } = props;

  const session = useScanSession({ findProductByGtin, resolveNewProduct, onExit });
  const { state, isScanning, itemsThisSession, activeProduct } = session;

  const handleScan = useCallback((gtin: string, format: string) => {
    vibrate();
    void session.capture(gtin, format);
  }, [session]);

  const isMobile = Capacitor.isNativePlatform()
    || (typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches);

  const entryOpen = state === 'quickEntry' || state === 'fullEntry';

  return (
    <div className="relative">
      {/* Visually-hidden live region for VoiceOver (m2) */}
      <div aria-live="polite" className="sr-only">
        {state === 'confirmed' && activeProduct
          ? `Added ${activeProduct.name}. ${itemsThisSession} items this session.`
          : ''}
      </div>

      {/* Camera layer — made inert while an entry overlay is open (C2) */}
      <div
        {...(entryOpen ? { inert: '' as any, 'aria-hidden': true } : {})}
        className="relative rounded-xl overflow-hidden"
      >
        {/* Top bar: Done + session counter (safe-area aware, M2) */}
        <div className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3">
          <span className="inline-flex items-center gap-1.5 text-[11px] font-medium px-1.5 py-0.5 rounded-md bg-muted text-foreground">
            <Package className="h-3.5 w-3.5" aria-hidden="true" />
            {itemsThisSession} added
          </span>
          <Button
            variant="ghost"
            onClick={session.endSession}
            aria-label="Done scanning"
            className="h-9 px-4 rounded-lg text-[13px] font-medium text-muted-foreground hover:text-foreground"
          >
            Done
          </Button>
        </div>

        <SmartBarcodeScanner onScan={handleScan} active={isScanning} autoStart />

        {/* lookingUp overlay (M5) */}
        {state === 'lookingUp' && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-background/80 backdrop-blur-sm">
            <Loader2 className="h-6 w-6 animate-spin text-foreground" aria-hidden="true" />
            <p className="text-[13px] text-muted-foreground">Looking up product…</p>
          </div>
        )}

        {/* Confirm beat overlay (success after full form) */}
        {state === 'confirmed' && activeProduct && (
          <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-4 bg-background/95 px-6 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <div className="h-14 w-14 rounded-full bg-foreground/10 flex items-center justify-center">
              <Check className="h-7 w-7 text-foreground" aria-hidden="true" />
            </div>
            <div className="text-center">
              <p className="text-[12px] uppercase tracking-wider text-muted-foreground">Added to inventory</p>
              <p className="text-[17px] font-semibold text-foreground">{activeProduct.name}</p>
            </div>
            <span className="text-[12px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
              {itemsThisSession} items this session
            </span>
            <div className="w-full max-w-xs space-y-2">
              <Button
                onClick={session.scanNext}
                className="w-full h-11 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[14px] font-medium"
              >
                <ScanLine className="h-4 w-4 mr-2" aria-hidden="true" /> Scan next item
              </Button>
              <Button
                variant="ghost"
                onClick={session.endSession}
                className="w-full h-10 rounded-lg text-[13px] text-muted-foreground hover:text-foreground"
              >
                Done
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Known item → quick dialog (single instance, controlled open) */}
      {activeProduct && (
        <QuickInventoryDialog
          open={state === 'quickEntry'}
          onOpenChange={(open) => { if (!open && state === 'quickEntry') session.cancelEntry(); }}
          product={activeProduct}
          mode="add"
          restaurantId={restaurantId}
          onSave={async (quantity, location) => {
            await onAddQuantity(activeProduct, quantity, location);
            session.commitQuick(); // success-only (M3); throw stays in quickEntry
          }}
        />
      )}

      {/* New item → full form via existing presentation (no double-wrap, M1) */}
      {activeProduct && (() => {
        const FullEntry = isMobile ? ProductUpdateSheet : ProductUpdateDialog;
        return (
          <FullEntry
            open={state === 'fullEntry'}
            onOpenChange={(open) => { if (!open && state === 'fullEntry') session.cancelEntry(); }}
            product={activeProduct}
            onEnhance={onEnhance}
            onUpdate={async (updates, quantityToAdd) => {
              await onUpdateProduct(activeProduct, updates, quantityToAdd);
              session.commitFull(); // success-only (M3) → confirm beat
            }}
          />
        );
      })()}
    </div>
  );
}
```

> **Notes for the implementer:**
> - `cn` is imported but only used if you add conditional classes; remove the import if unused to satisfy lint.
> - `inert` is not yet in the React `HTMLAttributes` types in all versions — the `{...(entryOpen ? { inert: '' as any } : {})}` spread keeps TS happy. Verify against the installed `@types/react`; if `inert` is typed, use `inert={entryOpen || undefined}`.
> - The scan-line/reticle visual and `motion-safe:` animation live inside the scanner components' overlays (Tasks 4-5); ScanSessionView adds only the session chrome.

- [ ] **Step 4: Run, verify it passes**

Run: `npm run test -- ScanSessionView`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/inventory/ScanSessionView.tsx tests/unit/ScanSessionView.test.tsx
git commit -m "feat(inventory): add ScanSessionView mobile scan-session shell

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 9: Rewire `Inventory.tsx` camera path → `ScanSessionView`

**Files:**
- Modify: `src/pages/Inventory.tsx`

Replace the inline `<SmartBarcodeScanner ... />` camera branch (lines ~1020-1029) with `<ScanSessionView />`, and provide `resolveNewProduct` by moving the new-product prefill out of `handleBarcodeScanned`. The existing `handleBarcodeScanned` stays usable for the AI-OCR / Keyboard scanner types (which are unchanged), but the camera path no longer uses it.

- [ ] **Step 1: Add the import**

```tsx
import { ScanSessionView } from '@/components/inventory/ScanSessionView';
```

- [ ] **Step 2: Add a memoized `resolveNewProduct` (prefill logic from `handleBarcodeScanned:316-341`)**

```tsx
  const resolveNewProduct = useCallback(async (gtin: string): Promise<Product> => {
    let result: Awaited<ReturnType<typeof productLookupService.lookupProduct>> | null = null;
    try {
      result = await productLookupService.lookupProduct(gtin, findProductByGtin);
    } catch (e) {
      result = null;
    }
    return {
      id: '', restaurant_id: selectedRestaurant!.restaurant!.id,
      gtin, sku: gtin,
      name: result?.product_name || 'New Product',
      description: null, brand: result?.brand || '', category: result?.category || '',
      size_value: result?.package_size_value || null, size_unit: result?.package_size_unit || null,
      package_qty: result?.package_qty || 1,
      uom_purchase: null, uom_recipe: null, cost_per_unit: null,
      current_stock: 0, par_level_min: 0, par_level_max: 0, reorder_point: 0,
      supplier_name: null, supplier_sku: null, barcode_data: null,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    } as Product;
  }, [selectedRestaurant, findProductByGtin]);
```

> Wrap `findProductByGtin` in `useCallback` too if it is not already stable, so `ScanSessionView`'s session deps don't churn.

- [ ] **Step 3: Extract the save mutations so the session can reuse them (product passed explicitly)**

The two existing camera handlers read the product from page state via closure
(`handleUpdateProduct` at `Inventory.tsx:639` uses `selectedProduct`; `handleQuickInventorySave`
at `:766` uses `quickInventoryProduct` / `scanMode`) and mix in legacy-dialog UI side-effects
(`setShowUpdateDialog(false)`, `setSelectedProduct(null)`). Extract their mutation bodies into
pure, product-parameterized helpers with **no** page-dialog side-effects, then call them from
both the legacy dialogs and the session.

**3a. `persistQuickAdd`** — lift the `'add'` branch of `handleQuickInventorySave` (`:778-808`):

```tsx
  const persistQuickAdd = useCallback(async (product: Product, quantity: number): Promise<boolean> => {
    if (!selectedRestaurant) return false;
    const currentStock = product.current_stock || 0;
    const ok = await updateProductStockWithAudit(
      selectedRestaurant.restaurant_id, product.id, currentStock + quantity, currentStock,
      product.cost_per_unit || 0, 'adjustment',
      `Adjustment - Added ${quantity} via quick scan`, `quick_scan_${Date.now()}`,
    );
    if (ok) {
      await refetchProducts();
      toast({ title: 'Inventory updated', description: `Added ${quantity.toFixed(2)} to ${product.name}`, duration: 800 });
    }
    return !!ok;
  }, [selectedRestaurant, refetchProducts, toast]);
```

> `handleQuickInventorySave` then delegates to `persistQuickAdd(quickInventoryProduct, quantity)`
> for `scanMode === 'add'`, keeping its reconcile branch as-is.

**3b. `persistProductUpsert`** — lift the create-or-update body of `handleUpdateProduct`
(`:643-760`) into a helper that takes the product explicitly and **returns a boolean**, dropping
the `setShowUpdateDialog(false)` / `setSelectedProduct(null)` UI lines. It is a mechanical
substitution: copy the field mapping at `:645-668` and the existing-product update + audit logic
at `:683-759`, replacing every `selectedProduct` reference with the `product` parameter:

```tsx
  const persistProductUpsert = useCallback(
    async (product: Product, updates: Partial<Product>, quantityToAdd: number): Promise<boolean> => {
      if (!product.id) {
        const productData: CreateProductData = { /* :645-668 mapping, `product` for `selectedProduct` */ };
        const created = await createProduct(productData);
        if (!created) return false;
        toast({ title: 'Product created', description: `${created.name} added to inventory${quantityToAdd > 0 ? ` with ${quantityToAdd.toFixed(2)} units` : ''}` });
        return true;
      }
      try {
        /* :683-759 supabase update + audit, `product` for `selectedProduct` */
        return true;
      } catch (e) {
        toast({ title: 'Update failed', description: 'Could not save changes', variant: 'destructive' });
        return false;
      }
    },
    [createProduct, toast /* + the audit deps used in :683-759 */],
  );
```

> Refactor legacy `handleUpdateProduct` to:
> `const ok = await persistProductUpsert(selectedProduct, updates, quantityToAdd); if (ok) { setShowUpdateDialog(false); setSelectedProduct(null); }` — preserving its current behavior exactly.

**3c. Session callbacks** (throw on failure so the session keeps the form open — commit-error path, M3):

```tsx
  const handleSessionAddQuantity = useCallback(async (product: Product, quantity: number) => {
    const ok = await persistQuickAdd(product, quantity);
    if (!ok) throw new Error('Save failed');
  }, [persistQuickAdd]);

  const handleSessionUpdateProduct = useCallback(async (product: Product, updates: Partial<Product>, quantityToAdd: number) => {
    const ok = await persistProductUpsert(product, updates, quantityToAdd);
    if (!ok) throw new Error('Save failed');
  }, [persistProductUpsert]);
```

- [ ] **Step 4: Replace the camera branch render**

```tsx
                  {scannerType === 'camera' ? (
                    <ScanSessionView
                      restaurantId={selectedRestaurant?.restaurant?.id ?? null}
                      findProductByGtin={findProductByGtin}
                      resolveNewProduct={resolveNewProduct}
                      onAddQuantity={handleSessionAddQuantity}
                      onUpdateProduct={handleSessionUpdateProduct}
                      onEnhance={handleEnhanceProduct}
                      onExit={() => { /* stays on the Scanner tab; the hook resets its own counter */ }}
                    />
                  ) : scannerType === 'ai-ocr' ? (
```

> Leave the `ai-ocr` and `keyboard` branches untouched (they still use `handleBarcodeScanned`). The standalone `QuickInventoryDialog`/`ProductUpdateDialog` instances previously rendered for the camera flow are now owned by `ScanSessionView`; if those page-level instances were ONLY used by the camera path, remove them — if shared with other tabs, leave them and ensure they are not double-driven.

- [ ] **Step 5: Typecheck + build + lint**

Run: `npm run typecheck && npm run build && npm run lint`
Expected: PASS. Fix any unused-import / dead-state warnings created by the rewire (e.g., `showQuickInventoryDialog` may become camera-path-dead; keep only if other tabs use it).

- [ ] **Step 6: Commit**

```bash
git add src/pages/Inventory.tsx
git commit -m "feat(inventory): wire camera scanner to ScanSessionView

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 10: E2E — scan → enter → resume with no duplicate dialogs

**Files:**
- Create: `tests/e2e/inventory-scan-session.spec.ts`

Real cameras aren't available in CI, so stub `SmartBarcodeScanner` emissions via a test hook. The app already gates the camera path behind a scanner-type selector; this test drives the session by dispatching synthetic scans through a `window.__emitScan` test bridge added under a compile-time `import.meta.env.PROD` guard (Vite replaces this with `true` at build time, so the bridge is tree-shaken out of the production bundle entirely).

- [ ] **Step 1: Add a test-only emit bridge in `ScanSessionView`**

```tsx
  // inside ScanSessionView, after `session` is created
  useEffect(() => {
    if (import.meta.env.PROD) return;
    (window as any).__emitScan = (gtin: string) => handleScan(gtin, 'EAN_13'); // test-only bridge
    return () => { delete (window as any).__emitScan; }; // test-only cleanup
  }, [handleScan]);
```

> The compile-time `import.meta.env.PROD` guard is used (not a runtime `MODE === 'test'` check) so the bridge body is dead-code-eliminated from production builds by Vite. No Playwright fixture flag is needed to activate it — the bridge is simply absent in prod.

- [ ] **Step 2: Write the E2E spec**

```ts
// tests/e2e/inventory-scan-session.spec.ts
import { test, expect } from '@playwright/test';
import { generateTestUser } from '../helpers/e2e-supabase';

test.describe('Inventory scan session', () => {
  test('scan new item → fill form → confirm → resume, no duplicate dialogs', async ({ page }) => {
    await page.addInitScript(() => { (window as any).__E2E__ = true; });
    // ... sign in + navigate to Inventory → Scanner tab → Camera (use existing helpers/fixtures) ...

    // Emit a new-product scan
    await page.evaluate(() => (window as any).__emitScan('0123456789999'));

    // Full form appears; a second emit must NOT open a duplicate
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.evaluate(() => (window as any).__emitScan('0123456789999'));
    await expect(page.getByRole('dialog')).toHaveCount(1);

    // ... fill required fields by accessible label, save ...
    // Escape the name into a RegExp safely if you build one (lesson 2026-06-04):
    //   const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // Confirm beat → Scan next resumes
    await expect(page.getByText(/items this session/i)).toBeVisible();
    await page.getByRole('button', { name: /scan next item/i }).click();
    await expect(page.getByText(/added/i)).toHaveCount(0);
  });
});
```

- [ ] **Step 3: Run the e2e test**

Run: `npm run test:e2e -- inventory-scan-session`
Expected: PASS. If sign-in/fixtures differ, mirror an existing inventory e2e spec's setup.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/inventory-scan-session.spec.ts src/components/inventory/ScanSessionView.tsx
git commit -m "test(inventory): e2e scan-session flow with no-duplicate-dialog guard

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Final verification (Phase 8 preview)

```bash
npm run test && npm run typecheck && npm run lint && npm run build
npm run test:e2e -- inventory-scan-session
```

All must pass. Coverage focus: `useScanSession` and `createScanGate` carry the logic coverage (≥80% on new code for SonarCloud); `ScanSessionView` carries the integration coverage.

## Spec coverage check

| Spec requirement | Task |
|---|---|
| `active` prop on all 4 engines (incl. MLKit M6) | 3, 4, 5, 6 |
| Loop pauses on capture; freeze frame | 4 (video pause), 5 (snapshot) |
| `onScan` via ref (stale-closure fix) | 4, 5, 6 |
| State machine + counter-on-success + error path (M3) | 2 |
| Identity gate + reset across sessions (m3) | 1, 2 |
| Reuse without double-wrap (M1) | 8 (ProductUpdateSheet/Dialog) |
| DialogDescription + operator aria-labels (C1/C3) | 7 |
| Focus management / inert camera layer (C2) | 8 |
| lookingUp affordance (M5) | 8 |
| Safe-area insets (M2) | 8 |
| Live region (m2) | 8 |
| Package icon, no emoji (m1) | 8 |
| Best-effort haptics (M7) | 8 |
| Semantic-token badges (M4) | 4, 5 |
| Confirm beat | 8 |
| Manual/AI-OCR → fullEntry | 2 (`enterFullEntry`), 9 |
| Camera path rewired | 9 |
| No-duplicate-dialog guarantee | 8 (unit), 10 (e2e) |

Deferred (Decided trade-offs): pre-existing dialog `max-h` (m6), Capacitor Haptics (M7) — intentionally not in this plan.
