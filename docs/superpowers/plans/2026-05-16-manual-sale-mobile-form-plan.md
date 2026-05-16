# Implementation Plan — Manual Sale dialog mobile fix

**Spec:** `docs/superpowers/specs/2026-05-16-manual-sale-mobile-form-design.md`

## Tasks (TDD order)

### Task 1: Add primitive-default tests (RED)

Create `tests/unit/dialogPrimitive.defaults.test.tsx`.

1. Test: `DialogContent` without overrides has classes `max-h-[85vh]` and `overflow-y-auto`.
2. Test: `DialogContent className="max-h-[60vh]"` resolves to `max-h-[60vh]` (no `max-h-[85vh]`).
3. Test: `DialogContent className="overflow-hidden"` resolves to `overflow-hidden` (no `overflow-y-auto`).

Run vitest, confirm tests fail.

### Task 2: Update primitive defaults (GREEN)

Edit `src/components/ui/dialog.tsx`:

- Add `max-h-[85vh] overflow-y-auto` to `DialogContent`'s default className.

Run vitest, confirm Task 1 tests now pass.

### Task 3: Add POSSaleDialog sticky-footer tests (RED)

Create `tests/unit/POSSaleDialog.scroll.test.tsx`. Mock hooks following the
pattern in `tests/unit/CheckSettingsDialog.test.tsx`.

1. Test: outermost dialog content has `max-h-[85vh] overflow-hidden flex flex-col`
   (outer is height-capped and non-scrolling so only the inner body scrolls).
2. Test: a scrollable form body (`flex-1 overflow-y-auto`) wraps the form fields.
3. Test: a fixed footer (`flex-shrink-0` with `border-t`) contains both
   `Cancel` and `Record Sale` buttons.

Run vitest, confirm tests fail.

### Task 4: Refactor POSSaleDialog layout (GREEN)

Edit `src/components/POSSaleDialog.tsx`:

- Change `<DialogContent>` className to
  `sm:max-w-md max-h-[85vh] overflow-hidden p-0 gap-0 border-border/40 flex flex-col`.
- Add `flex-shrink-0` to `<DialogHeader>` className.
- Wrap the existing form fields (everything between `<Form …>` open and the
  `{/* Footer Actions */}` block) in a single
  `<div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">`. Remove the
  matching `px-6 py-5 space-y-5` from the `<form>` element (move padding
  from form to the new scrollable body).
- Wrap the existing footer button row in
  `<div className="flex-shrink-0 flex gap-2 px-6 py-4 border-t border-border/40 bg-background pb-[max(env(safe-area-inset-bottom),1rem)]">`.
  Remove the now-redundant `pt-4 border-t border-border/40` from the inner row.

Run vitest, confirm Task 3 tests now pass.

### Task 5: Manual smoke test

Run `npm run dev` and verify in browser:

- At desktop viewport: dialog appears centered, header + footer visible, body scrolls if you fill many adjustments.
- Resize browser to 1200 × 657 (DevTools): Save button still visible.
- Resize to iPhone SE (320 × 568): Save button still visible at the bottom.
- Smoke-check `MapPOSItemDialog` (POS Items page) and `ManualMatchDialog`
  (Pending Outflows page) still render and scroll correctly with the
  primitive change.

### Task 6: Run full verification suite

- `npm run typecheck`
- `npm run lint`
- `npm run test`
- `npm run build`

Fix any regressions. Re-run until green.

### Task 7: Commit, push, open PR

- Single commit (or two: primitive + dialog) on `fix/manual-sale-mobile-scroll`.
- Open PR linking to the design doc, with summary and test plan.

## Dependencies

- Task 2 depends on Task 1.
- Task 4 depends on Task 3 (and indirectly Task 2 — the primitive defaults
  are already in place when we refactor the dialog).
- Tasks 5–7 depend on Tasks 1–4 passing.

## Estimated time

~30 min total. Each task is 2–5 min.
