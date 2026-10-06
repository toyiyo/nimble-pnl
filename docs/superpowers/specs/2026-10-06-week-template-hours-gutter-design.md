# Design: Week Template Editor HOURS Column Gutter

## Problem

QA on PR #842 found that the HOURS column of the Week Templates editor
grid is not readable at the right edge of the window. The values
("4…", "48.5") and the header ("HOUR") are covered.

## Cause (measured on the Vercel preview, window 1870px wide)

- The grid does not overflow. The scroller has `scrollWidth` 1345 and
  `clientWidth` 1345. The HOURS column runs from x=1783 to x=1853.
- The grid fills its pane. The pane is `min-w-0` inside a
  `minmax(0,1fr)` track (`src/components/scheduling/WeekTemplates/WeekTemplatesTab.tsx:272`,
  `src/components/scheduling/WeekTemplates/WeekTemplatesTab.tsx:287`).
  The table is `w-full min-w-[720px]` inside `overflow-x-auto`
  (`src/components/scheduling/WeekTemplates/WeekTemplateEditor.tsx:419-420`).
- HOURS is the last column and is right-aligned
  (`src/components/scheduling/WeekTemplates/WeekTemplateEditor.tsx:144`,
  `:440`, `:480`). Its values therefore sit at the right edge of the window.
- Two third-party overlays sit fixed on the right edge of the window
  and cover approximately the last 45px:
  - `<vercel-live-feedback>`, the Vercel toolbar (preview deploys only).
  - The PostHog survey "Feedback" tab (all environments; PostHog loads in
    `src/main.tsx:4`).
- The 16px extra width of the page `space-y-6` wrapper comes from the
  page header bar (`-mx-4 px-4`, full-bleed on purpose). It is not related.

## Decision

Add a right gutter of `pr-12` (48px) to the three HOURS cells: the
header, each employee row, and the TOTAL row. Keep the class in one
constant so that the three cells stay aligned.

## Rejected options

- A page-wide right gutter on all tabs. It changes the layout of every
  page. The user selected the local fix.
- A change to the overlays. They are third-party code.

## Decided trade-offs

- The main Schedule grid has the same overlap. It is out of scope for
  this PR.
- The gutter adds 36px to the minimum table width. On a phone the grid
  scrolls sideways already, so this has no new effect.

## Test

- Unit: the HOURS header, a row HOURS cell and the TOTAL HOURS cell have
  the gutter class.
- Manual: check on the Vercel preview at 1265px, 1870px and 390px.
