# Keyboard Scanner Android-IME Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the HID "Keyboard Scanner" capture barcodes on Android (where the IME masks `keydown` `e.key`) without regressing iOS, by reading the hidden input's value plus an idle-timeout terminator.

**Architecture:** Extract a pure, framework-agnostic scan-assembler into `src/lib/barcodeScanInput.ts` (unit-tested with a fake scheduler; coverage-counted). Rewire `KeyboardBarcodeScanner.tsx` to feed the assembler from the hidden input's `input` events and to terminate on Enter or idle. iOS keeps its Enter trigger and reads the same value it already types, so it cannot regress.

**Tech Stack:** React 18 + TypeScript, Vitest + @testing-library/react (jsdom), `@/` path alias → `src/`.

**Design doc:** `docs/superpowers/specs/2026-06-18-keyboard-scanner-android-ime-design.md`

**Run all commands from the worktree root:** `/Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/fix+barcode-scanner-android-ime`

---

### Task 1: Pure parser — `parseScannedBarcode` + constants

**Files:**
- Create: `src/lib/barcodeScanInput.ts`
- Create: `tests/unit/barcodeScanInput.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/barcodeScanInput.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  parseScannedBarcode,
  SCAN_FORMAT,
  SCAN_IDLE_MS,
  MIN_TIMEOUT_BARCODE_LENGTH,
} from '@/lib/barcodeScanInput';

describe('parseScannedBarcode', () => {
  it('strips the @@ prefix and returns the code', () => {
    expect(parseScannedBarcode('@@012345678905', 1)).toBe('012345678905');
  });

  it('strips the ]Q prefix', () => {
    expect(parseScannedBarcode(']Q012345678905', 1)).toBe('012345678905');
  });

  it('trims surrounding whitespace', () => {
    expect(parseScannedBarcode('  012345  ', 1)).toBe('012345');
  });

  it('returns null when shorter than minLength', () => {
    expect(parseScannedBarcode('ab', 3)).toBeNull();
  });

  it('returns the code at exactly minLength', () => {
    expect(parseScannedBarcode('abc', 3)).toBe('abc');
  });

  it('returns null for empty / whitespace-only input', () => {
    expect(parseScannedBarcode('   ', 1)).toBeNull();
  });

  it('exposes stable constants', () => {
    expect(SCAN_FORMAT).toBe('KeyboardHID');
    expect(SCAN_IDLE_MS).toBeGreaterThan(0);
    expect(MIN_TIMEOUT_BARCODE_LENGTH).toBeGreaterThanOrEqual(2);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/barcodeScanInput.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/barcodeScanInput"`.

- [ ] **Step 3: Write the minimal implementation**

Create `src/lib/barcodeScanInput.ts`:

```ts
/**
 * Pure helpers for assembling barcodes from HID-keyboard ("Keyboard Scanner") input.
 *
 * Background: a USB/Bluetooth scanner in HID mode "types" the barcode characters.
 * On iOS the hardware keyboard suppresses the soft keyboard, so `keydown`/`e.key`
 * arrive cleanly. On Android an active IME routes the keystrokes through composition
 * (`keyCode 229` / `e.key === 'Unidentified'`) and the characters only reliably reach
 * the focused input's `.value`. This module works off that value, so it is correct on
 * both platforms.
 */

export const SCAN_FORMAT = 'KeyboardHID';

/** Idle gap (ms) with no new input that terminates a scan when Enter is swallowed. Re-armed on each keystroke. */
export const SCAN_IDLE_MS = 80;

/** Minimum length for an idle-terminated scan (guards against a stray keystroke flushing as a "barcode"). */
export const MIN_TIMEOUT_BARCODE_LENGTH = 3;

const PREFIX_RE = /^(@@|]Q)/;

/**
 * Normalize a raw captured buffer into a barcode string, or null if (after stripping
 * the optional @@/]Q prefix and trimming) it is shorter than `minLength`.
 */
export function parseScannedBarcode(raw: string, minLength: number): string | null {
  const cleaned = raw.replace(PREFIX_RE, '').trim();
  return cleaned.length >= minLength ? cleaned : null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/barcodeScanInput.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/barcodeScanInput.ts tests/unit/barcodeScanInput.test.ts
git commit -m "feat(scanner): add parseScannedBarcode pure helper"
```

---

### Task 2: Pure assembler — `createScanAssembler`

**Files:**
- Modify: `src/lib/barcodeScanInput.ts` (append)
- Modify: `tests/unit/barcodeScanInput.test.ts` (append)

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/barcodeScanInput.test.ts`:

```ts
import { vi, beforeEach, afterEach } from 'vitest';
import { createScanAssembler } from '@/lib/barcodeScanInput';

describe('createScanAssembler', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function makeAssembler() {
    const onScan = vi.fn();
    const assembler = createScanAssembler({
      onScan,
      schedule: (cb, ms) => window.setTimeout(cb, ms) as unknown as number,
      clearScheduled: (id) => window.clearTimeout(id),
    });
    return { onScan, assembler };
  }

  it('iOS path: enter() emits the buffered value once and cancels the idle timer', () => {
    const { onScan, assembler } = makeAssembler();
    assembler.feed('012345678905');
    assembler.enter();
    expect(onScan).toHaveBeenCalledTimes(1);
    expect(onScan).toHaveBeenCalledWith('012345678905', SCAN_FORMAT);
    vi.advanceTimersByTime(SCAN_IDLE_MS * 2);
    expect(onScan).toHaveBeenCalledTimes(1);
  });

  it('Android path: idle timeout emits once when Enter never arrives', () => {
    const { onScan, assembler } = makeAssembler();
    assembler.feed('012345678905');
    expect(onScan).not.toHaveBeenCalled();
    vi.advanceTimersByTime(SCAN_IDLE_MS);
    expect(onScan).toHaveBeenCalledTimes(1);
    expect(onScan).toHaveBeenCalledWith('012345678905', SCAN_FORMAT);
  });

  it('re-arms the idle window on each feed (no premature flush)', () => {
    const { onScan, assembler } = makeAssembler();
    assembler.feed('012');
    vi.advanceTimersByTime(SCAN_IDLE_MS - 10);
    assembler.feed('012345');
    vi.advanceTimersByTime(SCAN_IDLE_MS - 10);
    expect(onScan).not.toHaveBeenCalled();
    vi.advanceTimersByTime(10);
    expect(onScan).toHaveBeenCalledWith('012345', SCAN_FORMAT);
  });

  it('rejects a stray short buffer on idle timeout but emits it on explicit enter()', () => {
    const a = makeAssembler();
    a.assembler.feed('a');
    vi.advanceTimersByTime(SCAN_IDLE_MS);
    expect(a.onScan).not.toHaveBeenCalled();

    const b = makeAssembler();
    b.assembler.feed('a');
    b.assembler.enter();
    expect(b.onScan).toHaveBeenCalledWith('a', SCAN_FORMAT);
  });

  it('suppresses idle flush while composing, then emits after compositionend', () => {
    const { onScan, assembler } = makeAssembler();
    assembler.setComposing(true);
    assembler.feed('012345678905');
    vi.advanceTimersByTime(SCAN_IDLE_MS * 2);
    expect(onScan).not.toHaveBeenCalled();
    assembler.setComposing(false);
    vi.advanceTimersByTime(SCAN_IDLE_MS);
    expect(onScan).toHaveBeenCalledTimes(1);
    expect(onScan).toHaveBeenCalledWith('012345678905', SCAN_FORMAT);
  });

  it('does not emit after dispose() (no post-stop timer)', () => {
    const { onScan, assembler } = makeAssembler();
    assembler.feed('012345678905');
    assembler.dispose();
    vi.advanceTimersByTime(SCAN_IDLE_MS * 2);
    expect(onScan).not.toHaveBeenCalled();
  });

  it('does not double-emit the same buffer (enter then idle)', () => {
    const { onScan, assembler } = makeAssembler();
    assembler.feed('012345678905');
    assembler.enter();
    vi.advanceTimersByTime(SCAN_IDLE_MS * 2);
    expect(onScan).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/barcodeScanInput.test.ts`
Expected: FAIL — `createScanAssembler is not a function` / not exported.

- [ ] **Step 3: Write the minimal implementation**

Append to `src/lib/barcodeScanInput.ts`:

```ts
export interface ScanAssembler {
  /** Update the captured buffer to `value` and (re)arm the idle timer (unless composing). */
  feed(value: string): void;
  /** IME composition guard: while active, the idle timer is suppressed; arms on deactivate. */
  setComposing(active: boolean): void;
  /** Explicit terminator (Enter): emit any non-empty buffer, then reset. */
  enter(): void;
  /** Clear the buffer and cancel any pending idle timer. */
  reset(): void;
  /** Teardown: cancel pending timer and clear state (call on unmount / scanner stop). */
  dispose(): void;
}

export interface ScanAssemblerOptions {
  onScan: (code: string, format: string) => void;
  /** Injected timer scheduler (e.g. window.setTimeout). */
  schedule: (cb: () => void, ms: number) => number;
  /** Injected timer canceller (e.g. window.clearTimeout). */
  clearScheduled: (id: number) => void;
  idleMs?: number;
  minTimeoutLength?: number;
}

/**
 * Stateful barcode assembler driven by the component. Terminates a scan on an explicit
 * Enter (`enter()`, minLength 1 — matches legacy behaviour) or, when Enter is swallowed
 * by the IME, on an idle gap (`idleMs`, minLength `minTimeoutLength`). Every emit resets,
 * so a single scan cannot double-fire.
 */
export function createScanAssembler(opts: ScanAssemblerOptions): ScanAssembler {
  const idleMs = opts.idleMs ?? SCAN_IDLE_MS;
  const minTimeoutLength = opts.minTimeoutLength ?? MIN_TIMEOUT_BARCODE_LENGTH;

  let buffer = '';
  let composing = false;
  let timerId: number | null = null;

  const cancelTimer = (): void => {
    if (timerId !== null) {
      opts.clearScheduled(timerId);
      timerId = null;
    }
  };

  const reset = (): void => {
    cancelTimer();
    buffer = '';
    composing = false;
  };

  const emit = (minLength: number): void => {
    const code = parseScannedBarcode(buffer, minLength);
    // Reset before firing so a re-entrant feed (focus/refocus) starts from a clean buffer.
    reset();
    if (code !== null) {
      opts.onScan(code, SCAN_FORMAT);
    }
  };

  const armIdle = (): void => {
    cancelTimer();
    if (composing || buffer.length === 0) return;
    timerId = opts.schedule(() => {
      timerId = null;
      emit(minTimeoutLength);
    }, idleMs);
  };

  return {
    feed(value: string): void {
      buffer = value;
      armIdle();
    },
    setComposing(active: boolean): void {
      composing = active;
      if (active) {
        cancelTimer();
      } else {
        armIdle();
      }
    },
    enter(): void {
      emit(1);
    },
    reset,
    dispose(): void {
      cancelTimer();
      buffer = '';
      composing = false;
    },
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/barcodeScanInput.test.ts`
Expected: PASS (14 tests total).

- [ ] **Step 5: Commit**

```bash
git add src/lib/barcodeScanInput.ts tests/unit/barcodeScanInput.test.ts
git commit -m "feat(scanner): add createScanAssembler with idle + composition terminators"
```

---

### Task 3: Rewire `KeyboardBarcodeScanner` to the assembler

**Files:**
- Modify: `src/components/KeyboardBarcodeScanner.tsx`
- Create: `tests/unit/KeyboardBarcodeScanner.test.tsx`

- [ ] **Step 1: Write the failing component tests**

Create `tests/unit/KeyboardBarcodeScanner.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, act, cleanup, screen } from '@testing-library/react';
import { KeyboardBarcodeScanner } from '@/components/KeyboardBarcodeScanner';
import { SCAN_IDLE_MS } from '@/lib/barcodeScanInput';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function getHiddenInput(container: HTMLElement): HTMLInputElement {
  const input = container.querySelector('input');
  if (!input) throw new Error('hidden capture input not found');
  return input as HTMLInputElement;
}

describe('KeyboardBarcodeScanner', () => {
  beforeEach(() => vi.useFakeTimers());

  it('iOS path: Enter keydown emits the scanned value exactly once', () => {
    const onScan = vi.fn();
    const { container } = render(<KeyboardBarcodeScanner onScan={onScan} autoStart />);
    const input = getHiddenInput(container);
    act(() => {
      input.focus();
      fireEvent.input(input, { target: { value: '012345678905' } });
      fireEvent.keyDown(input, { key: 'Enter', keyCode: 13 });
    });
    expect(onScan).toHaveBeenCalledTimes(1);
    expect(onScan).toHaveBeenCalledWith('012345678905', 'KeyboardHID');
    act(() => { vi.advanceTimersByTime(SCAN_IDLE_MS * 2); });
    expect(onScan).toHaveBeenCalledTimes(1);
  });

  it('Android path: IME-masked keydown + no Enter, idle timeout emits once', () => {
    const onScan = vi.fn();
    const { container } = render(<KeyboardBarcodeScanner onScan={onScan} autoStart />);
    const input = getHiddenInput(container);
    act(() => {
      input.focus();
      // IME masks the key as 'Unidentified'/229; the characters land in the input value.
      fireEvent.keyDown(input, { key: 'Unidentified', keyCode: 229 });
      fireEvent.input(input, { target: { value: '012345678905' } });
    });
    expect(onScan).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(SCAN_IDLE_MS); });
    expect(onScan).toHaveBeenCalledTimes(1);
    expect(onScan).toHaveBeenCalledWith('012345678905', 'KeyboardHID');
  });

  it('does not emit after the scanner is stopped (assembler disposed)', () => {
    const onScan = vi.fn();
    const { container } = render(<KeyboardBarcodeScanner onScan={onScan} autoStart />);
    const input = getHiddenInput(container);
    act(() => {
      input.focus();
      fireEvent.input(input, { target: { value: '012345678905' } });
    });
    act(() => { fireEvent.click(screen.getByRole('button', { name: /stop scanner/i })); });
    act(() => { vi.advanceTimersByTime(SCAN_IDLE_MS * 2); });
    expect(onScan).not.toHaveBeenCalled();
  });

  it('invokes the latest onScan prop (stable ref, no stale closure)', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { container, rerender } = render(<KeyboardBarcodeScanner onScan={first} autoStart />);
    rerender(<KeyboardBarcodeScanner onScan={second} autoStart />);
    const input = getHiddenInput(container);
    act(() => {
      input.focus();
      fireEvent.input(input, { target: { value: '012345678905' } });
      fireEvent.keyDown(input, { key: 'Enter', keyCode: 13 });
    });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith('012345678905', 'KeyboardHID');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/KeyboardBarcodeScanner.test.tsx`
Expected: FAIL — current component never calls `onScan` from `input` events / idle timeout (Android test fails; stale-ref test fails).

- [ ] **Step 3: Replace the component logic block**

In `src/components/KeyboardBarcodeScanner.tsx`, replace the entire block **from the `import` lines through the closing of the `useEffect` that registers listeners** (i.e. everything above `const toggleScanner = () => {`) with:

```tsx
import React, { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Keyboard, Scan, Check, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { createScanAssembler, type ScanAssembler } from '@/lib/barcodeScanInput';

interface KeyboardBarcodeScannerProps {
  onScan: (result: string, format: string) => void;
  onError?: (error: string) => void;
  className?: string;
  autoStart?: boolean;
}

export const KeyboardBarcodeScanner: React.FC<KeyboardBarcodeScannerProps> = ({
  onScan,
  onError,
  className,
  autoStart = false,
}) => {
  const [isActive, setIsActive] = useState(autoStart);
  const [buffer, setBuffer] = useState('');
  const [lastScan, setLastScan] = useState<string>('');
  const [scanCount, setScanCount] = useState(0);
  const hiddenInputRef = useRef<HTMLInputElement>(null);
  const assemblerRef = useRef<ScanAssembler | null>(null);

  // Keep a stable reference to onScan so the assembler/listeners never go stale.
  const onScanRef = useRef(onScan);
  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  // Build the assembler + wire global listeners while the scanner is active.
  useEffect(() => {
    if (!isActive) return;
    const input = hiddenInputRef.current;

    const assembler = createScanAssembler({
      onScan: (code, format) => {
        setLastScan(code);
        setScanCount((c) => c + 1);
        if (input) input.value = '';
        setBuffer('');
        onScanRef.current(code, format);
        window.setTimeout(() => input?.focus(), 100);
      },
      schedule: (cb, ms) => window.setTimeout(cb, ms) as unknown as number,
      clearScheduled: (id) => window.clearTimeout(id),
    });
    assemblerRef.current = assembler;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (document.activeElement !== input) input?.focus();
      if ((e.key === 'Enter' || e.keyCode === 13) && document.activeElement === input) {
        assembler.enter();
        e.preventDefault();
      }
    };
    const refocus = () => input?.focus();
    const handleVisibility = () => {
      if (!document.hidden) input?.focus();
    };

    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('pointerdown', refocus);
    window.addEventListener('focus', refocus);
    document.addEventListener('visibilitychange', handleVisibility);
    input?.focus();

    return () => {
      assembler.dispose();
      assemblerRef.current = null;
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('pointerdown', refocus);
      window.removeEventListener('focus', refocus);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [isActive]);
```

> Note: `Square` was removed from the lucide import (it was unused). `bufferRef`, `focusHiddenInput`, `handleBarcode`, and `handleKeyDown` callbacks are intentionally gone — the assembler owns that logic now.

- [ ] **Step 4: Wire the hidden input's events**

Replace the hidden `<Input … />` element (the one with `className="opacity-0 absolute -left-[10000px] pointer-events-none"`) with:

```tsx
        {/* Hidden input that captures scanner keystrokes (works through Android IME via value). */}
        <Input
          ref={hiddenInputRef}
          onInput={(e) => {
            const v = e.currentTarget.value;
            assemblerRef.current?.feed(v);
            setBuffer(v);
          }}
          onCompositionStart={() => assemblerRef.current?.setComposing(true)}
          onCompositionEnd={(e) => {
            const v = e.currentTarget.value;
            assemblerRef.current?.feed(v);
            assemblerRef.current?.setComposing(false);
            setBuffer(v);
          }}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          className="opacity-0 absolute -left-[10000px] pointer-events-none"
          aria-hidden="true"
          tabIndex={-1}
        />
```

- [ ] **Step 5: Run the component + library tests to verify they pass**

Run: `npx vitest run tests/unit/KeyboardBarcodeScanner.test.tsx tests/unit/barcodeScanInput.test.ts`
Expected: PASS (all). If the Android idle test is flaky on the post-scan refocus timer, ensure `vi.advanceTimersByTime` runs inside `act()` (already the case above).

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors (confirms the removed imports/refs left nothing dangling).

- [ ] **Step 7: Commit**

```bash
git add src/components/KeyboardBarcodeScanner.tsx tests/unit/KeyboardBarcodeScanner.test.tsx
git commit -m "fix(scanner): capture barcodes via input value + idle terminator (Android IME)"
```

---

### Task 4: Accessibility announcement + cross-platform copy

**Files:**
- Modify: `src/components/KeyboardBarcodeScanner.tsx`
- Modify: `tests/unit/KeyboardBarcodeScanner.test.tsx` (append)

- [ ] **Step 1: Write the failing a11y test**

Append to `tests/unit/KeyboardBarcodeScanner.test.tsx` (inside the `describe` block):

```tsx
  it('announces the last scan to screen readers via an aria-live region', () => {
    const onScan = vi.fn();
    const { container } = render(<KeyboardBarcodeScanner onScan={onScan} autoStart />);
    const input = getHiddenInput(container);
    act(() => {
      input.focus();
      fireEvent.input(input, { target: { value: '012345678905' } });
      fireEvent.keyDown(input, { key: 'Enter', keyCode: 13 });
    });
    const live = container.querySelector('[aria-live="polite"]');
    expect(live).not.toBeNull();
    expect(live?.textContent).toContain('012345678905');
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/KeyboardBarcodeScanner.test.tsx -t "aria-live"`
Expected: FAIL — no `[aria-live]` region yet.

- [ ] **Step 3: Add the aria-live region**

In `src/components/KeyboardBarcodeScanner.tsx`, immediately after the opening `<CardContent className="space-y-4">` tag, add:

```tsx
        {/* Screen-reader announcement of the latest scan (visual UI is otherwise sufficient). */}
        <div aria-live="polite" className="sr-only">
          {lastScan ? `Scanned ${lastScan}` : ''}
        </div>
```

- [ ] **Step 4: Update the cross-platform copy**

Apply these exact text replacements in `src/components/KeyboardBarcodeScanner.tsx`:

1. Title — replace `Keyboard Scanner (iOS Compatible)` with `Keyboard Scanner`.
2. Description — replace `Use a Bluetooth scanner in keyboard (HID) mode. Works on all devices including iOS.` with `Use a USB or Bluetooth scanner in keyboard (HID) mode. Works on iOS, Android, and desktop browsers.`
3. Setup step — replace `Pair scanner in iOS Settings → Bluetooth` with `Pair the scanner via Bluetooth (or plug it in via USB)`.
4. Info line — replace `Your scanner will appear as a keyboard. This works on <strong>all iOS devices</strong> (iPhone/iPad) and all browsers.` with `Your scanner will appear as a keyboard. This works on <strong>iOS, Android</strong>, and desktop browsers.`

- [ ] **Step 5: Run the component tests to verify they pass**

Run: `npx vitest run tests/unit/KeyboardBarcodeScanner.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add src/components/KeyboardBarcodeScanner.tsx tests/unit/KeyboardBarcodeScanner.test.tsx
git commit -m "fix(scanner): announce scans for a11y and update cross-platform copy"
```

---

## Verification (handled in Phase 8, listed here for completeness)

```bash
npx vitest run tests/unit/barcodeScanInput.test.ts tests/unit/KeyboardBarcodeScanner.test.tsx
npm run test          # full unit suite — no regressions
npm run typecheck
npm run lint
npm run build
```

All must pass before push. The two new `src/lib/barcodeScanInput.ts` exports are covered by `tests/unit/barcodeScanInput.test.ts` (Sonar counts `src/lib/**`; `src/components/**` is excluded). Real-device validation on the Android tablet remains the ground-truth check after merge (jsdom cannot reproduce the IME).
