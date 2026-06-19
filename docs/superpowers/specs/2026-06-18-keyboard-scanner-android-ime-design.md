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
  feed(value: string): void;   // latest input value; (re)arms idle timer
  enter(): void;               // explicit terminator (Enter keydown)
  reset(): void;               // clear buffer + cancel timer
  dispose(): void;             // teardown (cancel timer)
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

### Changed: `src/components/KeyboardBarcodeScanner.tsx` (thin adapter)

- Keep the hidden input, focus management, and start/stop UI exactly as-is.
- Build a `createScanAssembler` with `schedule = window.setTimeout`, `clearScheduled = window.clearTimeout`.
- `onInput` on the hidden input → `assembler.feed(e.currentTarget.value)` and mirror to the
  `buffer` display state.
- `document` `keydown` → only handle Enter: `if (e.key === 'Enter' || e.keyCode === 13) { assembler.enter(); e.preventDefault(); }`. Character keys are **not** `preventDefault`ed (so the value populates). Backspace is handled natively by the input.
- On scan: clear the hidden input's `value`, update `lastScan`/`scanCount`, refocus (as today).
- Replace the `e.key`-accumulation branch; remove the now-redundant manual Backspace handling.

## Edge Cases & Decided Trade-offs

- **Double-emit:** prevented by `reset()` on every emit + Enter canceling the timer.
- **Stray single keystroke** times out → rejected by `MIN_TIMEOUT_BARCODE_LENGTH`.
- **Slow scanner (inter-char gap > idleMs):** would split a barcode. Mitigated by re-arming the
  timer on each keystroke (only fires after `idleMs` of silence) and a generous 80 ms default.
  `SCAN_IDLE_MS` is a named constant for real-device tuning.
- **Trailing IME commit after Enter:** input value already cleared on reset → trailing fragment is
  short → below min-length → no spurious emit.

## Testing

- **`tests/unit/barcodeScanInput.test.ts`** (covered):
  - `parseScannedBarcode`: prefix strip (`@@`, `]Q`), trim, min-length boundary, empty.
  - `createScanAssembler` with a **fake scheduler** + `vi.useFakeTimers()` (paired with
    `afterEach(() => vi.useRealTimers())` per lesson 2026-04-21):
    - iOS path: `feed` chars → `enter()` → one emit, timer canceled (advancing time → no 2nd emit).
    - Android path: `feed` chars → advance `idleMs` → one emit.
    - No-double-emit; stray short buffer rejected on timeout but emitted on explicit enter;
      re-arm resets the idle window.
- **`tests/unit/KeyboardBarcodeScanner.test.tsx`** (component integration; excluded from coverage):
  - iOS sim: dispatch `keydown` `Enter` after setting input value → `onScan` once with the code.
  - Android sim: fire `input` events (value set) with `keydown` `{key:'Unidentified', keyCode:229}`
    and **no** Enter → advance timers → `onScan` once.
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
