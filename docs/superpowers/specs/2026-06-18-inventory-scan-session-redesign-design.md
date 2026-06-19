# Inventory Barcode Scan Session — Redesign

**Date:** 2026-06-18
**Status:** Approved design — ready for implementation plan
**Area:** Inventory → Scanner tab → Camera Scanner

## Problem

In the Inventory **Scanner** tab, the Camera Scanner runs continuously. When a barcode is
detected, `handleBarcodeScanned` (`src/pages/Inventory.tsx:247`) opens either
`QuickInventoryDialog` (existing product) or `ProductUpdateDialog` (new product). The camera
never pauses while that form is open, so it keeps detecting barcodes behind the dialog —
overwriting the entry and popping new windows. On mobile this makes data entry effectively
impossible.

There are three compounding root causes:

1. **No pause input exists.** `SmartBarcodeScanner` accepts only `onScan` / `onError` /
   `className` / `autoStart` (`src/components/SmartBarcodeScanner.tsx:10-15`). The native
   engine's `scanLoop` reschedules itself every animation frame unconditionally
   (`src/components/NativeBarcodeScanner.tsx:158`). Nothing short of unmounting can stop it.
2. **The in-handler guard is bypassed by a stale closure.** `handleBarcodeScanned` checks
   `isLookingUp || showUpdateDialog || showQuickInventoryDialog` (`Inventory.tsx:251`), but it
   is not wrapped in `useCallback`, so the scanner's loop holds the first render's closure and
   reads the guard flags as `false` even after a dialog opens.
3. **An async race exists even if the guard worked.** The existing-product branch `await`s
   `findProductByGtin` *before* setting `showQuickInventoryDialog` (`Inventory.tsx:302-308`).
   A second detection during that await passes the guard and opens a duplicate.

## Goals

- The camera detects barcodes **only** while actively scanning, and pauses the instant a code
  is captured.
- After an item is handled, scanning resumes **under user control**, with the just-handled code
  **suppressed** so the item still in hand cannot double-add.
- A mobile-first, intuitive **scan → enter → resume** rhythm.
- Reuse existing form logic (the two dialogs) and the product lookup service.

## Non-goals (this iteration)

- Batch / "scan many, review at end" queue mode — noted as a future follow-up.
- Rewriting product form fields or the lookup service.
- Changing the **AI-OCR** or **Keyboard** scanner types — they are not continuous-camera and
  stay as-is.

## Decisions (from brainstorming)

- **Workflow — Smart hybrid.** Known product → quick quantity entry; new product → full form.
  Mirrors the two existing dialogs.
- **Resume rhythm — Confirm beat** for the new-item (full-form) path: a
  "✓ Added · N items this session · Scan next item" screen; the user taps to continue. The
  known-item quick path **auto-resumes** after save.
- **Scope — Scan-session redesign:** the correctness fix *plus* the immersive mobile flow
  (capture-freeze, bottom sheets, confirm beat, session counter).

## The controlled-scanner contract

`SmartBarcodeScanner`, `NativeBarcodeScanner`, and `Html5QrcodeScanner` gain a controlled
boolean prop **`active`**:

- While `active === true`, the engine scans.
- On the first detection, the engine calls `onScan` **exactly once**, then **suspends itself**
  (native: `cancelAnimationFrame` + stop the loop; html5: `.stop()`). It will not emit again
  until re-armed.
- **Re-arming** = a `false → true` transition of `active`. The session sets `active=false` on
  capture and `active=true` when it returns to `scanning`, so the edge always re-arms.
- On pause, the last camera frame is **frozen** behind the UI. Native: pause the `<video>`
  element. Html5: capture a snapshot before `.stop()`, falling back to a dimmed neutral backdrop
  if a snapshot is not readily available.
- `autoStart` is retained for backward compatibility, but the session drives `active`
  explicitly.

This makes correctness independent of React's async state-update timing: even with an
in-flight animation frame, self-suspend-on-fire guarantees at most one emission per armed cycle.
It closes all three root causes at the source.

## State machine (`useScanSession`)

States: `scanning → lookingUp → (quickEntry | fullEntry) → confirmed → scanning`.

- `active = (state === 'scanning')`.
- **`scanning`** — camera armed. On `onScan(gtin, format)`: synchronously transition to
  `lookingUp` (which sets `active=false`) and store the freeze frame.
- **`lookingUp`** — run `findProductByGtin`. If found → `quickEntry` with the product; else run
  `productLookupService.lookupProduct` and → `fullEntry` with a prefilled new-product object.
- **`quickEntry`** — quick quantity sheet. Save → increment counter, mark gate, **auto-resume**
  to `scanning`. Cancel → mark gate, `scanning`.
- **`fullEntry`** — full form sheet. Save → increment counter, → `confirmed`. Cancel → mark
  gate, `scanning`.
- **`confirmed`** — confirm beat. "Scan next item" → mark gate, `scanning`. "Done" →
  `endSession`.
- **Manual entry / AI-OCR / `MANUAL_ENTRY`** capture → enters at `fullEntry`.

**Session lifecycle.** A session starts in `scanning` when the user selects the Camera Scanner,
with `itemsThisSession = 0`. `endSession` tears down the camera (`active=false`, stream
stopped), exits the immersive view on mobile (returns to the Scanner tab) / returns the scanner
to its idle state on desktop, and resets the counter so the next session starts fresh.
"Done" is also reachable from the `scanning` top bar, not only from the confirm beat.

The hook exposes: `state`, `isScanning`, `itemsThisSession`, `activeProduct`, `freezeFrame`,
and handlers `capture()`, `commitQuick()`, `commitFull()`, `cancelEntry()`, `scanNext()`,
`endSession()`. The known-vs-new branching currently in `handleBarcodeScanned` moves here, so
it is testable with **no camera**.

## Scan gate (`scannerConfig.ts` → `createScanGate`)

A small factory holding the last-accepted value:

- `markAccepted(value)` — record the just-handled code.
- `shouldAccept(value)` — returns `false` while `value` equals the suppressed code; clears
  suppression once a different code is seen.

This complements the existing time-based `shouldDeduplicateScan` (`scannerConfig.ts:43`). Since
the scanner is fully paused between captures, the gate is belt-and-suspenders for the re-arm
moment when the same item is still in frame.

## Mobile UX (`ScanSessionView`)

- Full-bleed camera; top bar with **Done**, a "📦 N added" session chip, and torch +
  camera-flip where supported; centered reticle + scan line; bottom hint text.
- On capture: **haptic** (Capacitor Haptics on native, `navigator.vibrate` fallback on web),
  freeze frame, dim overlay.
- **Quick sheet** (known item): product name, current stock, quantity stepper,
  "Save & scan next" (auto-resume). Presented as a bottom sheet.
- **Full sheet** (new item): the `ProductUpdateDialog` form as a full-height bottom sheet.
  Save → confirm beat.
- **Confirm beat:** ✓, product name, "N items this session", primary "Scan next item",
  secondary "Done".
- Styling per CLAUDE.md Apple/Notion tokens (semantic colors only, `rounded-xl`,
  `border-border/40`, etc.). All interactive controls keyboard-accessible with `aria-label`s.

## Desktop

Inherits the controlled pause + gate. The camera path keeps its current two-column layout;
entry renders as the existing centered dialogs; the confirm beat shows as a compact success
state with the same "Scan next / Done" actions.

## Data flow

- `ScanSessionView` renders
  `<SmartBarcodeScanner active={session.isScanning} onScan={session.capture} … />`.
- `onScan` → `session.capture(gtin, format)` — synchronous pause + freeze, then async lookup.
- Sheet save → `session.commitQuick()` / `session.commitFull()`.
- Confirm "Scan next" → `session.scanNext()`; "Done" → `session.endSession()`.

## Error handling

- **Permission denied / camera busy** → existing friendly messages
  (`Html5QrcodeScanner.tsx:213-224`); user can fall back to the Keyboard or AI-OCR scanner types.
- **Lookup throws / offline** → toast + open `fullEntry` with a blank product (today's behavior,
  `Inventory.tsx:357-363`).
- **Leaving the tab / unmount** → cleanup tears down the media stream; session resets.

## Testing

Per CLAUDE.md, hooks and utilities require tests.

- **Vitest (unit):** `useScanSession` — all transitions including cancel paths, counter
  increments, gate interaction; and `createScanGate` suppression logic.
  (`tests/unit/useScanSession.test.ts`, `tests/unit/scannerConfig.scanGate.test.ts`)
- **Component:** `ScanSessionView` capture → sheet → confirm with a mocked
  `SmartBarcodeScanner`; assert a repeat detection does **not** open a second sheet, and that
  `active` is `false` in every non-`scanning` state.
  (`tests/unit/ScanSessionView.test.tsx`)
- **E2E (Playwright):** stub the scanner to emit codes; verify
  scan → form → confirm → scan-next, and that no duplicate dialogs open. (`tests/e2e/`)

## Files

**New**
- `src/hooks/useScanSession.ts` — state machine, counter, gate orchestration.
- `src/components/inventory/ScanSessionView.tsx` — mobile-first scan-session shell.
- `tests/unit/useScanSession.test.ts`, `tests/unit/scannerConfig.scanGate.test.ts`,
  `tests/unit/ScanSessionView.test.tsx`.

**Modified**
- `src/components/SmartBarcodeScanner.tsx` — add controlled `active` prop (pass-through).
- `src/components/NativeBarcodeScanner.tsx` — gate the rAF loop on `active`; self-suspend on
  fire; freeze frame on pause.
- `src/components/Html5QrcodeScanner.tsx` — same contract via `.stop()`/`.start()`; preserve
  torch + camera-flip.
- `src/utils/scannerConfig.ts` — add `createScanGate()`.
- `src/pages/Inventory.tsx` — camera path renders `ScanSessionView`; move known-vs-new
  branching into `useScanSession`.

**Reused as-is**
- `src/components/QuickInventoryDialog.tsx`, `src/components/ProductUpdateDialog.tsx`.

## Out of scope / future

- **Batch / queue mode** ("scan many, review at end") — design acknowledged, deferred to a
  separate spec.
