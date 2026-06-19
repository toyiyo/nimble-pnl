# Progress: Fix Android keyboard-scanner input (IME masks keydown e.key)

## Spec
Design: docs/superpowers/specs/2026-06-18-keyboard-scanner-android-ime-design.md (pending Phase 2)
Plan:  docs/superpowers/plans/2026-06-18-keyboard-scanner-android-ime-plan.md (pending Phase 3)

## Root cause (confirmed via PostHog, conversation)
- KeyboardBarcodeScanner.tsx detects barcodes via `document` keydown reading `e.key`.
- Android (Chrome): on-screen keyboard/IME routes HID scanner keystrokes through composition
  → keydown arrives as keyCode 229 / e.key 'Unidentified', Enter swallowed → e.key.length===1
  filter drops everything → buffer never assembles → no scan. Text DOES land in hidden input value
  (proven: PostHog `change` events on the hidden input on Android session 019ecf81...).
- iOS (WebKit, all browsers): hardware keyboard suppresses soft keyboard/IME → clean keydown e.key
  → works. Confirmed by control session 019ecf98 (iPhone) right after Android: 5 errors vs 98,
  post-scan dialog opened.

## Fix approach (user-approved direction)
- Read barcode from hidden input `.value` (correct on BOTH platforms) instead of keydown `e.key`.
- Terminators: keep Enter keydown (iOS path) + add idle-timeout flush (~Xms) for Android (Enter swallowed).
- Additive → iOS cannot regress (value is empirically present on iOS too).
- Extract state machine to pure `src/lib/` module (coverage-included; component is excluded).

## Current Phase
Phase 4-9: dev-build-and-ship workflow RUNNING (background)
- Run ID: wf_dabc3d15-609  | Task ID: w6aotz32b
- Plan approved by user. Launched autonomous build.
- On halt ({stopped:true}): surface phase+reason, fix, resume with resumeFromRunId.

## Completed
- [x] Phase 0: Lessons consulted (fake timers, jsdom-can't-repro-IME, worktree npm install, sonar coverage, 9d gate)
- [x] Phase 1: Worktree .claude/worktrees/fix+barcode-scanner-android-ime, branch fix/barcode-scanner-android-ime, npm install, .env.local symlinked, baseline barcode tests green (8/8)
- [x] Phase 2: Design doc committed a40bca7c
- [x] Phase 2.5: frontend-design-reviewer ran; 2 critical + 3 major folded in (stable onScan ref, dispose lifecycle, IME composition guard, input-event, aria-live); commit d66591d1. Supabase reviewer skipped (no DB surface).
- [x] Phase 3: Plan committed 39a8609b (4 TDD tasks). Self-review passed; edit anchors verified.
- [ ] Phase 4-9: dev-build-and-ship workflow (after plan approval)

## Plan tasks
1. [x] parseScannedBarcode pure helper (src/lib/barcodeScanInput.ts) — commit 6d2081b1
2. [x] createScanAssembler (idle + composition + dispose terminators) — commit 38b26cd5
3. [x] Append createScanAssembler unit tests (7 cases: iOS path, Android idle, re-arm, short buffer, composition guard, dispose, no double-emit) to tests/unit/barcodeScanInput.test.ts — commit 38b26cd5 (tests bundled with implementation)
4. Rewire KeyboardBarcodeScanner.tsx (value capture + idle, focus-gated Enter, dispose lifecycle, stable onScan ref)
5. aria-live scan announcement + cross-platform copy

## CI Status
- PR: not yet created

## Key Decisions
- Pure logic in src/lib/ for coverage (src/components/** excluded from Sonar coverage).
