# Manual Sale dialog — mobile / small-viewport fix

**Date:** 2026-05-16
**Branch:** `fix/manual-sale-mobile-scroll`
**Origin:** PostHog session replay `019e279d-6758-7ee5-b23e-33a636421183`

## Problem

A user reported they "couldn't scroll" when adding a new manual sale. The replay
shows the form opening as a modal dialog but the user is unable to reach the
**Record Sale** button at the bottom and abandons the flow.

### Root cause

`src/components/POSSaleDialog.tsx:328` renders:

```tsx
<DialogContent className="sm:max-w-md p-0 gap-0 border-border/40">
```

There is **no** `max-h-[Xvh]` and **no** `overflow-y-auto`. The base
`DialogContent` (Radix wrapper at `src/components/ui/dialog.tsx`) only sets
`max-w-lg`, also without any height constraint or overflow rule.

When the modal opens, Radix locks `body { overflow: hidden }` to prevent the
page from scrolling behind the modal. With no height cap and no internal
scroll on the dialog itself, content that exceeds the viewport simply
gets clipped — the entire bottom of the form, including Save and Cancel,
is unreachable.

The Manual Sale form is tall: header → item picker → quantity/unit-price row →
total price → date/time row → 5-field Adjustments section → totals summary
panel → footer with buttons. Easily 800+px. The PostHog replay shows a
**1200 × 657** viewport (small laptop with browser chrome), so the form
overflows by ~150px. Mobile devices in portrait (≈ 360 × 640) overflow far
more dramatically.

The user described the device as "mobile" because the symptom matches what
mobile users experience, but the bug is viewport-height-driven and affects
small laptops too.

### Other dialogs

A grep of `src/components` and `src/pages` finds ~40 `<DialogContent>` usages
that lack any `max-h`. Most are short confirmation dialogs that fit comfortably
in any viewport, but several are form-heavy (`AccountDialog`, `EmployeeDialog`,
`TimeOffRequestDialog`, etc.) and could exhibit the same bug on small screens.

## Goals

1. **Primary:** The Manual Sale dialog must work end-to-end on any viewport
   down to iPhone SE (320 × 568). The Save / Cancel buttons must always be
   visible while the user fills out the form.
2. **Secondary:** Every other dialog in the codebase gets a reasonable
   safety net by default — content beyond the viewport is reachable via
   scroll, even if the developer forgot to add a constraint.
3. Tests guard against regression of (1).

## Non-goals

- We are **not** rewriting the dialog as a native mobile Sheet/Drawer. That
  would be a bigger UX change requiring product input; the safety-net +
  sticky-footer pattern is sufficient.
- We are **not** auditing each of the 40 dialogs individually. The primitive
  default catches them as a group, and any specific dialog that needs a
  more sophisticated layout (e.g. tabs, side panels) is unaffected because
  `tailwind-merge` lets explicit overrides win.

## Design

### Layer 1 — Primitive safety net

Update `DialogContent` defaults in `src/components/ui/dialog.tsx` to include
`max-h-[85vh]` and `overflow-y-auto`. Because the project's `cn()` uses
`tailwind-merge`, any caller that explicitly sets `max-h-X` or
`overflow-hidden` will keep its value. Existing dialogs are not affected
unless they had neither constraint, in which case they gain a reasonable
fallback.

We use `85vh` rather than `100vh` so the dialog never feels edge-to-edge on
desktop while leaving generous breathing room for mobile keyboards.

### Layer 2 — Sticky footer for `POSSaleDialog`

Restructure the dialog to use a 3-row flex layout:

```tsx
<DialogContent className="sm:max-w-md max-h-[85vh] overflow-hidden p-0 gap-0 border-border/40 flex flex-col">
  <DialogHeader className="flex-shrink-0 ...">…</DialogHeader>
  <Form …>
    <form …>
      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
        {/* all the form fields */}
      </div>
      <div className="flex-shrink-0 flex gap-2 px-6 py-4 border-t border-border/40 bg-background">
        {/* Cancel + Save buttons */}
      </div>
    </form>
  </Form>
</DialogContent>
```

Key properties:

- Outer container is `flex flex-col` with `max-h-[85vh]` and `overflow-hidden`
  (overrides Layer 1's `overflow-y-auto` because we'll scroll the middle, not
  the whole container).
- Header is `flex-shrink-0` — always at the top.
- Form body is `flex-1 overflow-y-auto` — fills available space and scrolls
  when content overflows.
- Footer is `flex-shrink-0` with a top border — always pinned at the bottom.

This keeps **Save** always tappable, even on a 320 × 568 phone, while the
user scrolls through the form fields above.

### Mobile padding consideration

Add `pb-[max(env(safe-area-inset-bottom),1rem)]` to the footer to respect
iOS home-indicator safe area on phones. (Optional polish, but cheap.)

## Tests

### Unit (vitest + @testing-library/react)

Add `tests/unit/POSSaleDialog.scroll.test.tsx`:

- Renders the dialog with `open`.
- Asserts the form body wrapper has class `flex-1` and `overflow-y-auto`.
- Asserts the footer wrapper has class `flex-shrink-0` and contains both
  Cancel and Record Sale buttons.
- Asserts the outermost `DialogContent` has `max-h-[85vh]` and `flex flex-col`.

These class assertions are intentionally low-level — the goal is to lock in
the layout primitives that produce a sticky footer. A higher-fidelity
visual test belongs to Playwright (out of scope here).

### Unit (dialog primitive)

Add `tests/unit/dialogPrimitive.defaults.test.tsx`:

- Render `<Dialog open><DialogContent>...</DialogContent></Dialog>`.
- Assert `DialogContent` has `max-h-[85vh]` and `overflow-y-auto`.
- Render again with `<DialogContent className="max-h-[60vh] overflow-hidden">`.
- Assert `max-h-[60vh]` wins (no `max-h-[85vh]`) and `overflow-hidden` wins
  (no `overflow-y-auto`). This locks in the twMerge override contract.

## Migration / rollout

No data migration. No feature flag. Single PR ships both layers together —
the primitive change is backward compatible by `tailwind-merge` semantics.

## Risks

- **Risk:** A dialog that intentionally extended past the viewport (e.g. for
  a custom full-screen experience) might now have an extra `max-h-[85vh]`.
  **Mitigation:** A grep of the codebase finds none — every full-screen
  dialog (`prep/*Dialog`, `ManualMatch`, `EnhancedReconciliation`,
  `AssetColumnMapping`, `Assets`) explicitly sets `h-[XXvh]` or `max-h-[XXvh]`,
  which wins over the default.
- **Risk:** A dialog whose outer is `flex flex-col` with no overflow rule
  (e.g. `MapPOSItemDialog`) gains an outer `overflow-y-auto`. Inner
  `flex-1 overflow-y-auto` regions still work because the inner div claims
  the remaining flex space, and the outer only scrolls if total content
  exceeds `max-h-[85vh]` (its own override).
  **Mitigation:** Manual smoke test of `MapPOSItemDialog`,
  `ManualMatchDialog` in the dev server.
