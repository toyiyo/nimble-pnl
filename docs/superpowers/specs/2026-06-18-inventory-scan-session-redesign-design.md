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
  (capture-freeze, entry sheets, confirm beat, session counter).

## The controlled-scanner contract

`SmartBarcodeScanner`, `NativeBarcodeScanner`, `Html5QrcodeScanner`, **and
`MLKitBarcodeScanner`** gain a controlled boolean prop **`active`**:

- While `active === true`, the engine scans.
- On the first detection, the engine calls `onScan` **exactly once**, then **suspends itself**
  (native: `cancelAnimationFrame` + stop the loop; html5: `.stop()`). It will not emit again
  until re-armed.
- **Re-arming** = a `false → true` transition of `active`. The session sets `active=false` on
  capture and `active=true` when it returns to `scanning`, so the edge always re-arms.
- **`MLKitBarcodeScanner` (Capacitor native) must join the contract (M6).** It is a modal
  one-shot today and **auto-starts on mount** (`useEffect` → `handleScan()`). Under the contract
  it initiates `BarcodeScanner.scan()` only while `active`, emits once, and re-scans only on a
  fresh `false → true` re-arm. Without this, native iOS/Android builds keep relaunching the
  native scanner behind an open entry sheet.
- On pause, the last camera frame is **frozen** behind the UI. Native: pause the `<video>`
  element. Html5: capture a snapshot before `.stop()`, falling back to a dimmed backdrop using a
  **semantic token** (`bg-background/90 backdrop-blur-sm` — never raw `bg-black/*`) (m4).
- The overlay status badges inside `NativeBarcodeScanner`/`Html5QrcodeScanner` (today hard-coded
  gradients: `from-primary to-accent`, `from-green-500 to-emerald-600`, `from-blue-500 to-cyan-600`)
  are converted to **semantic tokens** as part of this change, so the new feature ships no
  direct-color violations (M4).
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
- **`quickEntry`** — quick quantity sheet. Save → `await commitQuick()`; **on success only**
  increment counter, mark gate, **auto-resume** to `scanning`. Cancel → mark gate, `scanning`.
- **`fullEntry`** — full form sheet. Save → `await commitFull()`; **on success only** increment
  counter and → `confirmed`. Cancel → mark gate, `scanning`.
- **`confirmed`** — confirm beat. "Scan next item" → mark gate, `scanning`. "Done" →
  `endSession`.
- **Manual entry / AI-OCR / `MANUAL_ENTRY`** capture → enters at `fullEntry`.

**Commit-error path (M3).** Counter increment and state advance happen **only after the save
promise resolves**. If `commitQuick()` / `commitFull()` rejects (offline, validation, server
error), the machine **stays in the entry state**, re-enables Save, and surfaces the error (toast)
— it does **not** advance to `confirmed`/`scanning`. The camera stays paused, no entry is lost,
and the counter never over-counts. The reused dialogs already hold their own `saving` state and
only close on a resolved `onSave`; the session mirrors that contract.

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
- `reset()` — clear the suppressed value.

This complements the existing time-based `shouldDeduplicateScan` (`scannerConfig.ts:43`). Since
the scanner is fully paused between captures, the gate is belt-and-suspenders for the re-arm
moment when the same item is still in frame. A **fresh gate is created at session start** and
`endSession` calls `reset()` (m3), so a prior session's last-accepted code can never suppress the
first scan of the next session.

## Mobile UX (`ScanSessionView`)

**Layout & chrome**
- Full-bleed camera. Top bar: **Done**, a session-count badge (Lucide `Package` icon +
  "N added" in the `text-[11px] px-1.5 py-0.5 rounded-md bg-muted` badge style — **no emoji**,
  m1), and torch + camera-flip where supported. Centered reticle + scan line; bottom hint text.
- **Reticle is percentage-based** (`w-[65%] aspect-square`, not the existing fixed `w-64 h-64`)
  so it scales on a 375px-wide iPhone SE without overflowing (m5).
- **Safe-area insets (M2):** verify `viewport-fit=cover` is set in `index.html`; the top bar
  applies `pt-[env(safe-area-inset-top)]` and any bottom CTA/footer applies
  `pb-[env(safe-area-inset-bottom)]`, so the notch/Dynamic Island and home indicator never clip
  the **Done** button or a primary CTA.
- **Reduced motion (m7):** the scan-line animation and freeze-frame dim transition are gated
  behind `motion-safe:` / the existing `prefers-reduced-motion` block in `src/index.css`.
- Styling per CLAUDE.md Apple/Notion tokens — **semantic colors only**, `rounded-xl`,
  `border-border/40`.

**Capture & lookup**
- On capture: freeze frame + dim overlay. **Haptics are best-effort (M7):** call
  `navigator.vibrate(...)` guarded by feature detection (fires on Android web; silently absent on
  iOS Safari/WKWebView, which is acceptable). The design no longer claims a reliable
  cross-platform haptic; a `@capacitor/haptics` integration is a future native enhancement.
- **`lookingUp` affordance (M5):** while `findProductByGtin` + `productLookupService.lookupProduct`
  run (up to ~2s), show a centered spinner + "Looking up product…" over the frozen frame
  (semantic tokens). This is the loading state of the three-state contract for the lookup.

**Entry presentation — reuse without double-wrapping (M1)**
- The two entry components are reused **in their existing single-portal presentations**, with the
  session controlling only their `open` state. **They are never wrapped in another Radix
  Dialog/Sheet** — `ProductUpdateDialog.tsx` already imports `Sheet`, and nesting a Dialog inside
  a Sheet collides on the shared focus-trap/portal stack.
  - **Known item →** `QuickInventoryDialog` (its centered `Dialog`).
  - **New item →** the **existing `ProductUpdateSheet`** export on mobile / `ProductUpdateDialog`
    on desktop (both already render the shared `ProductUpdateContent`). No new wrapper needed.
- The Radix Dialog/Sheet portals render above the camera layer; the **confirm beat** is a
  `ScanSessionView` overlay over the frozen frame (not a dialog).

**Accessibility (C1/C2/C3)**
- **Dialog descriptions (C1):** `QuickInventoryDialog` currently has only a `DialogTitle` — it
  gains a `<DialogDescription>` (brand / unit-of-measure subline) so Radix wires
  `aria-describedby`. Confirm the `ProductUpdateSheet` `SheetContent` exposes a title/description
  too. (Reinforces the 2026-05-29 lesson that the CLAUDE.md dialog snippet once seeded a
  plain-`<p>` a11y bug.)
- **Icon-only controls (C3):** the `QuickInventoryDialog` operator buttons (`+ − × ÷`) use only
  `title=` today → add explicit `aria-label`s (mobile screen readers don't reliably expose
  `title`). Same for the new top-bar icon buttons (Done, torch, camera-flip) and the confirm-beat
  actions.
- **Focus management (C2):** while any entry overlay is open, the camera layer is made `inert`
  (or `aria-hidden`) so its torch/flip/Done controls leave the tab order. Initial focus lands on
  the quantity field (quick) or the first form field (full); focus returns to the scan area /
  Done on close. The reused Radix Dialog/Sheet already trap focus — the additive requirement is
  the `inert` camera layer.
- **Live region (m2):** a visually-hidden `aria-live="polite"` region at the `ScanSessionView`
  root announces "Added [Product]. N items this session." on each successful commit, so VoiceOver
  users get the confirm-beat feedback without focus moving.

**Confirm beat**
- ✓, product name, "N items this session", primary **Scan next item**, secondary **Done**.
  Reachable only after a successful `commitFull()` (see the commit-error path above).

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

- **Vitest (unit):** `useScanSession` — all transitions incl. cancel paths, counter increments
  **on commit success only**, the **commit-error path** (a rejected `commitFull` stays in
  `fullEntry` with the counter unchanged), and gate interaction incl. **reset across sessions**;
  plus `createScanGate` suppression + `reset()`. Pair any `vi.useFakeTimers()` with
  `afterEach(() => vi.useRealTimers())`.
  (`tests/unit/useScanSession.test.ts`, `tests/unit/scannerConfig.scanGate.test.ts`)
- **Component:** `ScanSessionView` capture → entry → confirm with a mocked `SmartBarcodeScanner`;
  assert a repeat detection does **not** open a second entry, `active` is `false` in every
  non-`scanning` state, and the camera layer is `inert`/`aria-hidden` while an entry overlay is
  open. (`tests/unit/ScanSessionView.test.tsx`)
- **E2E (Playwright):** stub the scanner to emit codes; verify
  scan → form → confirm → scan-next, and that no duplicate dialogs open. (`tests/e2e/`)

## Files

**New**
- `src/hooks/useScanSession.ts` — state machine, counter, gate orchestration.
- `src/components/inventory/ScanSessionView.tsx` — mobile-first scan-session shell.
- `tests/unit/useScanSession.test.ts`, `tests/unit/scannerConfig.scanGate.test.ts`,
  `tests/unit/ScanSessionView.test.tsx`.

**Modified**
- `src/components/SmartBarcodeScanner.tsx` — add controlled `active` prop (pass-through to all
  engines).
- `src/components/NativeBarcodeScanner.tsx` — gate the rAF loop on `active`; self-suspend on
  fire; freeze frame on pause; badges → semantic tokens.
- `src/components/Html5QrcodeScanner.tsx` — same contract via `.stop()`/`.start()`; preserve
  torch + camera-flip; badges → semantic tokens.
- `src/components/MLKitBarcodeScanner.tsx` — honor `active`: scan only while armed, re-scan only
  on a fresh re-arm (M6).
- `src/components/QuickInventoryDialog.tsx` — add `<DialogDescription>` + `aria-label`s on the
  operator buttons (C1/C3) before reuse in the session.
- `src/utils/scannerConfig.ts` — add `createScanGate()`.
- `src/pages/Inventory.tsx` — camera path renders `ScanSessionView`; move known-vs-new
  branching into `useScanSession`.

**Reused (existing presentations, controlled by the session — not double-wrapped)**
- `src/components/ProductUpdateDialog.tsx` — `ProductUpdateSheet` (mobile) /
  `ProductUpdateDialog` (desktop), both rendering the shared `ProductUpdateContent`.

## Decided trade-offs (Phase 2.5 review)

- **Pre-existing dialog heights exceed the 80vh cap (m6).** `ProductUpdateDialog` uses
  `max-h-[95vh]` and `QuickInventoryDialog` `max-h-[90vh]`, above CLAUDE.md's `max-h-[80vh]`
  guidance. These are pre-existing and unrelated to the scan flow; **not** changed here to avoid
  regressing the established desktop form layouts. Revisit separately.
- **Capacitor Haptics deferred (M7).** Haptic feedback is web-best-effort (`navigator.vibrate`,
  no-op on iOS Safari). A `@capacitor/haptics` integration for crisp native haptics is a future
  enhancement, intentionally out of scope to avoid adding a native dependency in this iteration.

## Out of scope / future

- **Batch / queue mode** ("scan many, review at end") — design acknowledged, deferred to a
  separate spec.
