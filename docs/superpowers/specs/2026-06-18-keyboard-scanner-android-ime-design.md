# Keyboard Scanner — Android IME Input-Capture Fix

**Date:** 2026-06-18
**Status:** Approved
**Component:** `src/components/KeyboardBarcodeScanner.tsx`

## Problem & Root Cause

A USB/Bluetooth UPC scanner in HID-keyboard mode does not scan on an Android tablet,
while the same app + same workflow works on iPhone. Confirmed via PostHog (June 16):

- **Android tablet** (Android 10, Chrome 149), session `019ecf81-9723-7c0e-804a-549896c07255`:
  user selected "Keyboard Scanner", the hidden barcode input received characters (PostHog
  `change` events on `input.opacity-0.absolute.-left-[10000px]`), but **no scan ever fired** —
  98 console errors, product count frozen, ~25 min of restart/toggle, then abandoned.
- **iPhone control** (Chrome iOS), session `019ecf98-2938-7f61-a088-31f3789887c4`, 45 s later:
  same component, **same hidden input**, scan **detected** → post-scan dialog opened, 5 errors.

`KeyboardBarcodeScanner` detects barcodes from a `document` `keydown` listener reading `e.key`
(`e.key.length === 1` to accumulate, `e.key === 'Enter'` to submit). On Android, an active
on-screen keyboard / IME routes even hardware-HID keystrokes through input-method composition:
`keydown` arrives as `keyCode 229` / `e.key === 'Unidentified'` and the terminating Enter is
swallowed. Every character fails `e.key.length === 1` and is dropped — yet the characters still
land in the focused input's `.value` (hence the `change` events). On iOS (WebKit, all browsers),
a connected hardware keyboard suppresses the soft keyboard / IME, so `keydown`/`e.key` arrive
clean and the existing code works.

**The input's `.value` is populated identically on both platforms** (proven by the `change`
events on both sessions). The bug is that the code reads `e.key` instead of that value.

## Goal / Non-Goals

**Goal:** Capture scans on Android *without regressing iOS*, by reading the input value instead
of `e.key` and adding an idle-timeout terminator for the swallowed-Enter case.

**Non-goals (deferred):**
- Suppressing the Android on-screen keyboard (`inputMode="none"` / `readOnly` tricks) — may also
  suppress the value population the fix depends on; separate concern.
- EAN-13→UPC-A normalization / dedup parity with the camera scanners — changes the emitted-value
  contract on both platforms; out of scope.

## iOS-Safety Rationale (primary constraint)

1. iOS keeps its **existing Enter trigger** unchanged.
2. The value iOS reads equals the characters it types (same chars that today accumulate via
   `e.key`) — so the **emitted string is byte-identical** to today on iOS.
3. The idle-timeout is *additive*: on iOS the Enter keydown fires first and cancels the timer, so
   the normal path is unchanged. A scanner configured without an Enter suffix — which does not
   work on iOS today — would now also work via the idle flush. Improvement, never regression.

## Architecture

Extract the logic into a pure, framework-agnostic module (unit-tested, coverage-counted because
`src/lib/**` is included while `src/components/**` is excluded from Sonar coverage). The component
becomes a thin DOM adapter.

### New: `src/lib/barcodeScanInput.ts` (pure)

```ts
export const SCAN_FORMAT = 'KeyboardHID';
export const SCAN_IDLE_MS = 80;            // re-armed on each keystroke; tune on real device
export const MIN_TIMEOUT_BARCODE_LENGTH = 3;

// Strip optional @@/]Q prefix, trim; return code or null if shorter than minLength.
export function parseScannedBarcode(raw: string, minLength: number): string | null;

export interface ScanAssembler {
  feed(value: string): void;            // latest input value; (re)arms idle timer unless composing
  setComposing(active: boolean): void;  // IME guard: suppress idle arm while composing; arm on end
  enter(): void;                        // explicit terminator (Enter keydown)
  reset(): void;                        // clear buffer + cancel timer
  dispose(): void;                      // teardown (cancel timer)
}

export function createScanAssembler(opts: {
  onScan: (code: string, format: string) => void;
  schedule: (cb: () => void, ms: number) => number;   // injected setTimeout
  clearScheduled: (id: number) => void;               // injected clearTimeout
  idleMs?: number;             // default SCAN_IDLE_MS
  minTimeoutLength?: number;   // default MIN_TIMEOUT_BARCODE_LENGTH
}): ScanAssembler;
```

**Terminator rules:**
- `enter()` → parse current value with `minLength = 1` (preserves today's "emit any non-empty"),
  emit if valid, then `reset()`.
- idle timer (armed/re-armed by each `feed`) → parse with `minLength = MIN_TIMEOUT_BARCODE_LENGTH`
  (avoids flushing 1–2 stray keys when Enter is swallowed), emit if valid, then `reset()`.
- Emit always `reset()`s (clears buffer + cancels timer) → a single scan can't double-emit; Enter
  cancels any pending idle flush.

**IME composition guard (`setComposing`):** Android Chrome may deliver scanner keystrokes as IME
composition. To avoid the idle timer firing *mid-barcode* (splitting one scan in two),
`setComposing(true)` suppresses idle-timer arming inside `feed()`; `setComposing(false)` re-arms
the timer from the latest fed value. If a browser/IME never fires composition events, the flag
stays `false` and behavior is the pure idle-timer path — i.e., this degrades gracefully and is
strictly safer when composition *does* occur.

### Changed: `src/components/KeyboardBarcodeScanner.tsx` (thin adapter)

- Keep the hidden input, focus management, and start/stop UI exactly as-is. The hidden input stays
  **uncontrolled** (no React `value` prop) — its native `.value` is the capture buffer.
- **Stable `onScan` ref (avoids stale closure — review critical #1):**
  `const onScanRef = useRef(onScan); useEffect(() => { onScanRef.current = onScan; }, [onScan]);`
  The assembler is built with `(code, fmt) => onScanRef.current(code, fmt)`, so a changing `onScan`
  prop does not require recreating the assembler or re-registering listeners.
- **Assembler lifecycle (avoids timer leak / post-stop emit — review critical #2):** create the
  assembler once per active session inside the `isActive`-gated `useEffect` (`schedule = window.setTimeout`,
  `clearScheduled = window.clearTimeout`); the effect cleanup calls `assembler.dispose()`. This
  single cleanup covers both unmount and the `isActive → false` transition, so a pending idle timer
  can never fire `onScan` after the scanner is stopped.
- **Capture:** attach a DOM **`input`** listener (React `onInput`, *not* `onChange`) on the hidden
  input → `assembler.feed(e.currentTarget.value)` + mirror to the `buffer` display state. `input`
  fires per keystroke (so the idle timer re-arms correctly); `change` would only fire on blur.
- **IME composition (review major #1):** wire `compositionstart` → `assembler.setComposing(true)`
  and `compositionend` → `assembler.setComposing(false)` on the hidden input.
- **Enter handling (review minors #1/#2):** the `document` `keydown` listener is registered only
  while `isActive`. Handle Enter only when the hidden input owns focus:
  `if ((e.key === 'Enter' || e.keyCode === 13) && document.activeElement === hiddenInputRef.current) { assembler.enter(); e.preventDefault(); }`.
  This avoids swallowing Enter for other focused elements. Character keys are **not**
  `preventDefault`ed (so the value populates). Backspace is handled natively by the input.
- On scan: clear the hidden input's `value`, update `lastScan`/`scanCount`, refocus (as today).
- Remove the `e.key`-accumulation branch and the now-redundant manual Backspace handling.
- **Accessibility (review major #3):** add an `aria-live="polite" className="sr-only"` region that
  announces the last scanned code, so screen-reader users get scan confirmation (today it is
  visual-only). Inventory scanning is error-costly; this is a cheap, correct uplift.
- **UI copy (review minor #3):** the component title (`"Keyboard Scanner (iOS Compatible)"`) and the
  setup blurb claim iOS-only support. Update copy to reflect that it now works on Android too (e.g.
  drop "(iOS Compatible)", generalize "Works on all iOS devices" / "Pair scanner in iOS Settings").

## Edge Cases & Decided Trade-offs

- **Double-emit:** prevented by `reset()` on every emit + Enter canceling the timer.
- **Stray single keystroke** times out → rejected by `MIN_TIMEOUT_BARCODE_LENGTH`.
- **Slow scanner (inter-char gap > idleMs):** would split a barcode. Mitigated by re-arming the
  timer on each keystroke (only fires after `idleMs` of silence) and a generous 80 ms default.
  `SCAN_IDLE_MS` is a named constant for real-device tuning.
- **Mid-barcode IME composition gap:** if Android commits the barcode in batches with a gap
  > `idleMs`, the idle timer could split it. Guarded by `setComposing` — while composing, the idle
  timer is suppressed and only armed at `compositionend`.
- **Trailing IME commit after Enter:** input value already cleared on reset → trailing fragment is
  short → below min-length → no spurious emit.
- **`idleMs` as a prop:** *deferred.* `createScanAssembler` accepts `idleMs`, but it is not plumbed
  through `KeyboardBarcodeScannerProps` (no caller needs per-instance tuning yet). The named
  `SCAN_IDLE_MS` constant is the single edit point until a caller requires device-specific tuning.

## Testing

- **`tests/unit/barcodeScanInput.test.ts`** (covered):
  - `parseScannedBarcode`: prefix strip (`@@`, `]Q`), trim, min-length boundary, empty.
  - `createScanAssembler` with a **fake scheduler** + `vi.useFakeTimers()` (paired with
    `afterEach(() => vi.useRealTimers())` per lesson 2026-04-21):
    - iOS path: `feed` chars → `enter()` → one emit, timer canceled (advancing time → no 2nd emit).
    - Android path: `feed` chars → advance `idleMs` → one emit.
    - No-double-emit; stray short buffer rejected on timeout but emitted on explicit enter;
      re-arm resets the idle window.
    - Composition guard: `setComposing(true)` → `feed` → advancing time does **not** emit;
      `setComposing(false)` arms the idle flush → one emit.
    - `dispose()` cancels a pending idle timer → advancing time emits nothing (no post-stop emit).
- **`tests/unit/KeyboardBarcodeScanner.test.tsx`** (component integration; excluded from coverage):
  - iOS sim: dispatch `keydown` `Enter` after setting input value → `onScan` once with the code.
  - Android sim: fire `input` events (value set) with `keydown` `{key:'Unidentified', keyCode:229}`
    and **no** Enter → advance timers → `onScan` once.
  - Lifecycle: stopping the scanner (`isActive → false`) before the idle timer fires → no `onScan`
    (asserts dispose-on-stop). Changing the `onScan` prop mid-session → the new callback is invoked
    (asserts the stable-ref pattern, review critical #1).
  - **Caveat (lesson 2026-05-26):** jsdom cannot reproduce the real Android IME; these tests
    *simulate* it. Ground truth remains the PostHog evidence and a real-device check.

## Files

| File | Change |
|---|---|
| `src/lib/barcodeScanInput.ts` | New — pure parser + assembler |
| `src/components/KeyboardBarcodeScanner.tsx` | Rewire capture to value + idle terminator |
| `tests/unit/barcodeScanInput.test.ts` | New — pure-logic tests |
| `tests/unit/KeyboardBarcodeScanner.test.tsx` | New — component integration (iOS + Android sims) |

No DB / RLS / edge-function / API surface touched.
