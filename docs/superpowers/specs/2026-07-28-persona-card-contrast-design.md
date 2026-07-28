# Persona card contrast on the sidebar surface — design

**Date:** 2026-07-28
**Branch:** `fix/persona-card-contrast`
**Follows:** PR #660 (`docs/superpowers/specs/2026-07-24-admin-work-view-mode-design.md`)

## The defect

`ViewModeSwitch` — the "You're viewing as" persona card — renders its eyebrow
label and hint line essentially invisible when mounted in `SidebarFooter`
(`AppSidebar.tsx:228`) under the **light** theme. Measured from real rendered
pixels of a running app (not from a model):

| element | measured | required |
|---|---|---|
| eyebrow "YOU'RE VIEWING AS" | **1.05:1** | 4.5:1 (WCAG 1.4.3) |
| hint "Switch to clock in, …" | **1.05:1** | 4.5:1 |
| unpressed segment label "My Work" | **1.99:1** | 4.5:1 |
| pressed segment label "Admin" | 20.17:1 | ✅ |

Dark theme is fine (5.5–6.2:1), which is why no check caught it.

## Root cause — the background, not just the text token

The obvious reading is "the text uses `text-muted-foreground`, which is scoped
to the main-content surface, and the card is mounted in the sidebar, which is
dark **even in light theme** (`--sidebar-background: 30 15% 12%`)."

That is true but incomplete, and the obvious fix derived from it — inherit the
surface foreground (`text-current` + opacity) — **does not work**. Modelled
against the real tokens:

| candidate (light / sidebar) | eyebrow | segment label |
|---|---|---|
| current `text-muted-foreground` | 1.03:1 | 1.72:1 |
| inherit `--sidebar-foreground` @ 70% | 2.96:1 | 1.99:1 |
| inherit `--sidebar-foreground` @ 100% | 4.27:1 | 2.56:1 |

Nothing reaches 4.5:1, because the real problem is one layer down: the card
paints `bg-personal-view/40`. In light theme `--personal-view` is a *light*
slate (`214 32% 91%`); at 40% alpha over the dark sidebar it composites to a
**mid-gray** (measured `rgb(111,111,111)`). A mid-gray backdrop supports
neither light text nor dark text. The alpha is the bug — it lets the mount
surface bleed through and destroy a token pair that was designed to be used
together.

Note the card already has a matched foreground token,
`--personal-view-foreground`, defined in `src/index.css` for both themes and
**never used** — the component reached for `text-muted-foreground` instead.

## Fix

Make the card carry its own surface and its own foreground, so it renders
identically wherever it is mounted:

1. `bg-personal-view/40` → `bg-personal-view` (opaque).
2. Eyebrow → `text-personal-view-foreground`.
3. Hint → `text-personal-view-foreground/80`.
4. Unpressed segment → `text-personal-view-foreground/80`, hover
   `hover:text-personal-view-foreground` (was `hover:text-foreground`, which in
   the sidebar resolves to a *dark* token and would have made hover worse).
5. Pressed segment (`bg-background text-foreground`) unchanged — both tokens
   are opaque, so it is already mount-independent.

Resulting ratios (modelled from the real token values, both mounts identical
by construction):

| element | light | dark |
|---|---|---|
| eyebrow | 8.20:1 | 8.82:1 |
| hint | 4.91:1 | 6.25:1 |
| unpressed segment | 4.96:1 | 6.30:1 |
| pressed segment | 14.35:1 | 14.74:1 |

## Decided trade-offs

- **Pressed-pill vs. track boundary is ~1.2:1**, below the 3:1 that WCAG
  1.4.11 asks of a boundary identifying a control's state. Reaching 3:1 would
  require a mid-gray track, which would in turn break the text contrast we are
  fixing — the two constraints are in direct conflict at this palette. The
  pressed state stays identifiable by the label's own contrast shift
  (14.35:1 pressed vs. 4.96:1 unpressed), by `shadow-sm`, and by `aria-pressed`
  for assistive tech. This ratio is **unchanged** from the already-shipped
  dropdown mount (~1.03:1 there today); the fix does not regress it.
- **The card no longer tints toward the sidebar.** That is the point: it is a
  persona card, deliberately distinct from the chrome it sits in, and it now
  matches the approved mock in both mounts rather than only in the dropdown.

## Test strategy

The original bug survived a full review because every check asserted that the
*class names were semantic tokens* — none asserted the *rendered result*. Two
new guards, both measuring contrast rather than class strings:

1. **Unit (`tests/unit/ViewModeSwitch.contrast.test.tsx`)** — parses the real
   `:root` / `.dark` token values out of `src/index.css`, reads the actual
   `className` off each rendered element, resolves the Tailwind color
   utilities to `(token, alpha)`, composites the documented layer stack over
   both mount surfaces, and asserts ≥4.5:1. Fails on the current code.
2. **E2E (`tests/e2e/view-mode-switching.spec.ts`)** — in a real browser,
   walks up from each text node for the first opaque background and asserts
   the computed contrast, so a future token edit that only looks fine in
   isolation still fails.

No behaviour, routing, permission, or data change: `viewMode` remains a
display lens, roles and RLS are untouched.
