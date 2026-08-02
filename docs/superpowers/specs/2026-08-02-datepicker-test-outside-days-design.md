# Design: make the BulkInventoryDeductionDialog date-picker test clock-independent

- **Date:** 2026-08-02
- **Type:** fix (test-only)
- **Files touched:** `tests/unit/BulkInventoryDeductionDialog.datePicker.test.tsx`

## Problem

`tests/unit/BulkInventoryDeductionDialog.datePicker.test.tsx` fails on `main`
(commit `2bafd868`), turning the "Unit Tests" workflow red on `main` and on
every open PR.

The failing assertion is in *"end-date: days before the selected start date are
disabled"*:

```ts
const day5Cell = within(grid).getByRole('gridcell', { name: '5' });
```
`tests/unit/BulkInventoryDeductionDialog.datePicker.test.tsx:120`

`getByRole` throws *"found multiple elements"*. The calendar renders outside
days from the adjacent months, so in a month whose grid runs past the 1st of the
next month at a low enough day number, two `gridcell`s carry the same accessible
name.

### Why the duplicate exists

- The dialog renders both pickers with the shared `DatePicker` primitive
  (`src/components/BulkInventoryDeductionDialog.tsx:109` and `:118`), which
  mounts `<Calendar mode="single" …>` (`src/components/ui/date-picker.tsx:86`).
- `Calendar` is react-day-picker **v8.10.1** and defaults `showOutsideDays` to
  `true` (`src/components/ui/calendar.tsx:10`, forwarded at `:13`), so the
  6-week grid is padded with days from the previous and next month.
- Neither picker passes `defaultMonth`, and neither has a value when the
  calendar first opens (`src/components/ui/date-picker.tsx:89` falls back to
  `value`, i.e. `undefined`), so react-day-picker displays **the current
  month** — whatever the host clock says.

In August 2026 the last grid row is Aug 30 – Sep 5, so `5` matches both Aug 5
and the outside Sep 5.

Enumerating every month from 2020–2040 bounds the exposure: leading outside days
always fall in **23–31** and trailing outside days in **1–6** (react-day-picker
v8 does not pad to a fixed six weeks unless asked, so a trailing run never
exceeds 6). Days **7–22** are therefore unambiguous in every month. That makes
`'10'`, `'15'` and `'20'` safe as written, and `'5'` the only lookup in this
file that can collide — but the safety is a property of those particular
numbers, not of the query. Any future assertion on a day ≤ 6 or ≥ 23 walks into
the same failure.

## Options considered

### A. Pin the clock with fake timers

`vi.setSystemTime(new Date('2026-06-15T12:00:00'))` in `beforeEach`, restored in
`afterEach`. June 2026's grid spans May 31 – Jul 4, so nothing collides.

- **Pro:** two lines, no query changes.
- **Con:** it fixes the symptom by choosing a lucky month. Any future test in
  this file that reaches for a different day number re-opens the same trap. It
  also drags `vi.useFakeTimers()` into a file that has no need for timer
  control; `memory/lessons.md:42` already records fake timers leaking across
  files when `useRealTimers` is missed.

### B. Scope the queries to non-outside days (chosen)

Query all matching gridcells and keep the one that is *not* an outside day.
react-day-picker v8 tags outside days via `classNames.day_outside`, which our
`Calendar` sets to a string beginning with the literal `day-outside`
(`src/components/ui/calendar.tsx:37-38`). That class is not decorative — the
cell selector in the same file keys off it
(`[&:has([aria-selected].day-outside)]:bg-accent/50`,
`src/components/ui/calendar.tsx:31`), so it is load-bearing and will not be
dropped silently.

- **Pro:** correct in every month, so the test is clock-independent by
  construction rather than by choice of month. It also expresses the intent —
  *the 5th of the displayed month* — instead of *"the only cell labelled 5"*.
- **Con:** couples the test to a class name. Mitigated by asserting exactly one
  in-month match, so a rename fails loudly instead of silently selecting the
  wrong cell.

**Chosen: B.** A is a smaller diff but leaves the trap armed.

## Design

Add one helper at the top of the test file and route all four day lookups
through it:

```ts
/**
 * react-day-picker pads the 6-week grid with outside days from the adjacent
 * months (`showOutsideDays` defaults to true), so a label like "5" can match
 * both the 5th of the displayed month and an outside 5th of the next one.
 * Keep only the in-month cell — outside days carry the `day-outside` class
 * from `Calendar`'s `classNames.day_outside`.
 */
function getDayCell(grid: HTMLElement, day: string): HTMLElement {
  const cells = within(grid)
    .getAllByRole('gridcell', { name: day })
    .filter((cell) => !cell.classList.contains('day-outside'));
  expect(cells).toHaveLength(1);
  return cells[0];
}
```

Call sites replaced: `:79` (`'10'`), `:93` (`'20'`), `:120` (`'5'`),
`:124` (`'20'`).

## Non-goals

- No change to `DatePicker`, `Calendar`, or `BulkInventoryDeductionDialog`.
  The duplicate-name situation is normal react-day-picker output, not an
  accessibility defect to fix in the component.
- No fake timers. The fix removes the clock dependency rather than freezing it.

## Verification

- `npx vitest run tests/unit/BulkInventoryDeductionDialog.datePicker.test.tsx`
  passes with the host clock untouched (currently August 2026 — the month that
  reproduces the bug).
- A throwaway re-run with the clock faked to February 2027 (grid Jan 31 – Mar 6,
  so the outside Mar 5 collides with Feb 5) confirms the query holds in a month
  other than today's. Manual cross-check only — no fake timers are committed.
- Full unit suite, typecheck, lint, build.
