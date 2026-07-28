# Plan — persona card contrast fix

Design: `docs/superpowers/specs/2026-07-28-persona-card-contrast-design.md`

## Task 1 — contrast test helper (RED support)
Add `tests/helpers/contrast.ts`:
- `parseThemeTokens(css)` → `{ light: Record<token, hsl>, dark: … }` from the
  `:root { }` and `.dark { }` blocks of `src/index.css`.
- `hslToRgb`, `composite(fg, alpha, bg)`, `relativeLuminance`, `contrastRatio`.
- `resolveColorUtility(className, prefix)` → `{ token, alpha } | null` for the
  `bg-*` / `text-*` utilities this component uses, including `/NN` alpha.

## Task 2 — RED: unit contrast guard
`tests/unit/ViewModeSwitch.contrast.test.tsx`: render the card, read real
classNames, composite over `--sidebar-background` and `--popover`, assert
≥4.5:1 for eyebrow, hint, and both segment labels, in light and dark.
Must fail against current `ViewModeSwitch.tsx`.

## Task 3 — GREEN: apply the fix
`src/components/ViewModeSwitch.tsx`: opaque `bg-personal-view`; eyebrow
`text-personal-view-foreground`; hint and unpressed segment
`text-personal-view-foreground/80`; hover `hover:text-personal-view-foreground`.
Update the component doc comment to record why the card must stay opaque.

## Task 4 — E2E rendered-contrast assertion
Extend `tests/e2e/view-mode-switching.spec.ts` with a check that computes
contrast from `getComputedStyle` in a real browser for the sidebar-footer
mount.

## Task 5 — Verify
`npm run typecheck && npm run lint && npm run test && npm run build`, then the
view-mode E2E spec. Re-capture the sidebar screenshot as visual evidence.

## Task 6 — Ship
Push, PR, CI to green, full 9d review-comment triage.
