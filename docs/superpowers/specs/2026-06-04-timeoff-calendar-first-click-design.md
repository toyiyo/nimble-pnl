# Design: Fix calendar date-picker first-click failure (BUG-001)

- **Date:** 2026-06-04
- **Branch:** `fix/timeoff-calendar-first-click`
- **Bug:** BUG-001 — Calendar date picker fails on first interaction
- **Severity:** Medium (user can retry; first-time users may not know to)
- **Reported surface:** `/scheduling` → New Time-Off Request form

## Problem

A user opened the New Time-Off Request form, tried to pick a date, and the
calendar did not register the first click — a PostHog `$rageclick` fired on the
calendar element, the user abandoned the form, and succeeded only on a fresh
second attempt. Zero console errors (not a crash); a timing/UI-state issue.

## Root Cause (confirmed)

In `src/components/TimeOffRequestDialog.tsx` each `<Calendar>` renders with the
**`initialFocus`** prop inside a `<PopoverContent>` that Radix **portals to
`document.body`** — i.e. *outside* the modal `<Dialog>`'s trapped `FocusScope`.

react-day-picker's `initialFocus` effect programmatically focuses a day button
after mount:

- `node_modules/react-day-picker/dist/index.esm.js:2042` — the `initialFocus`
  effect calls `focusContext.focus(focusContext.focusTarget)`.
- `:1707` — the matching day's effect then calls `buttonRef.current.focus()`.

Because that day button lives **outside** the Dialog's DOM subtree, the Dialog's
trapped focus scope detects focus leaving and yanks it back. This focus
tug-of-war on the **first** popover open disrupts the pointer/click sequence, so
the first day-click is swallowed; a later fresh attempt hits different timing and
registers. This matches every reported signal: rage-click *on the calendar*,
fails-first/works-on-retry, and **0 console errors**.

Authoritative confirmation: Radix Primitives issue
[#2885 "Calendar Not Working In Dialog"](https://github.com/radix-ui/primitives/issues/2885)
(closed as a duplicate of #2122): *"When `initialFocus` is set on the Calendar,
it conflicts with the Dialog's focus trapping mechanism, causing the popover to
require multiple clicks."*

### Why it is a whole class, not one form

The identical `initialFocus` + uncontrolled-`Popover` pattern is duplicated
across the codebase. Two sites (`POSSalesImportReview`, `ReceiptMappingReview`)
already carry a `className="pointer-events-auto"` band-aid — independent evidence
that engineers have hit this interaction before and patched a symptom rather than
the cause.

#### Affected inventory

| Component | Instances | Trigger | Notes |
|---|---|---|---|
| `TimeOffRequestDialog` | 2 (start/end) | default | end has `disabled` predicate; format `MMM d, yyyy` |
| `AvailabilityExceptionDialog` | 1 | default | format `MMM d, yyyy` |
| `BulkInventoryDeductionDialog` | 2 (start/end) | default | end has `disabled`; format `PPP` |
| `banking/ReconciliationDialog` | 1 | default | format `PPP` |
| `banking/EnhancedReconciliationDialog` | 1 | default | `id="ending-date"`; format `PPP` |
| `POSSalesImportReview` | 2 | **custom** | "Change Date" text + border colors; has `pointer-events-auto` band-aid; day-picker imported as `CalendarComponent` |
| `ReceiptMappingReview` | 1 | **custom** | trailing `CheckCircle`; `pointer-events-auto` band-aid; value parsed from string |
| `ui/date-range-picker.tsx` | 1 | default | **range** mode, `numberOfMonths={2}`, standalone reusable |
| `scheduling/ShiftPlanner/CopyWeekDialog` | 2 | — | **inline** calendars (no Popover) → **NOT affected, out of scope** |

Total in scope: **10 single-date popover instances across 7 files** + **1 range
picker**. CopyWeekDialog's inline calendars are explicitly excluded — no popover,
no focus trap interaction.

## Solution

### 1. New shared primitive — `src/components/ui/date-picker.tsx`

A focused, reusable single-date picker that bakes in the correct pattern, placed
beside `calendar.tsx` / `popover.tsx` / `date-range-picker.tsx`.

```tsx
import type { Matcher } from "react-day-picker";

interface DatePickerProps {
  value: Date | undefined;
  onChange: (date: Date | undefined) => void;
  disabled?: Matcher | Matcher[];      // day-matcher, forwarded to Calendar
  placeholder?: string;                // default "Pick a date"
  dateFormat?: string;                 // default "PPP"
  defaultMonth?: Date;                 // initial month; defaults to `value`
  align?: "start" | "center" | "end";  // default "start"
  id?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  triggerClassName?: string;
  children?: React.ReactElement;       // optional custom trigger (single element, asChild)
}
```

Behavior:

- **Controlled open state.** `const [open, setOpen] = useState(false)`, wired to
  `<Popover open={open} onOpenChange={setOpen}>`.
- **Trigger.** If `children` is provided, render it inside
  `<PopoverTrigger asChild>` (custom-trigger sites). `children` is typed
  `React.ReactElement` (not `ReactNode`) because Radix `asChild` clones a single
  element — a fragment/string would mis-merge. Otherwise render a default
  `outline` `Button` with a leading `CalendarIcon` and
  `value ? format(value, dateFormat) : placeholder`, applying
  `text-muted-foreground` when empty, merged with `triggerClassName`, and
  forwarding `id` / `aria-label` / `aria-labelledby`.
- **Content.** `<PopoverContent className="w-auto p-0" align={align}>`. **No
  `pointer-events-auto`** — see "Considered & declined" below; the reported bug
  proves clicks are not pointer-blocked (the retry succeeds), so Radix 1.1.14
  already grants the portaled popover pointer events.
- **Calendar.** `<Calendar mode="single" selected={value}
  defaultMonth={defaultMonth ?? value} disabled={disabled} onSelect={...} />` —
  **no `initialFocus`**. Passing `defaultMonth ?? value` keeps the calendar
  opening on the selected date's month (the old `initialFocus` did this
  implicitly by focusing the selected day; without it the calendar would
  otherwise open on today).
- **`onSelect` (close-guard).** `mode="single"` calls `onSelect` with `undefined`
  when the user re-clicks the selected day (deselect). Closing *and* clearing in
  that case silently wipes a required date. So:
  ```tsx
  onSelect={(d) => {
    if (d) { onChange(d); setOpen(false); }  // pick → update + close
    else   { onChange(undefined); }          // deselect → clear but stay open
  }}
  ```
  Closing on a real pick gives the immediate visual feedback whose absence drove
  the rage-click (shadcn's recommended form pattern); the deselect branch keeps
  the popover open so the user sees the cleared state rather than a silent
  close-and-wipe.

### Considered & declined (focus mechanism)

- **`onOpenAutoFocus={(e) => e.preventDefault()}` on `PopoverContent`** — declined
  as a default. It suppresses Radix's focus-into-popover on open, which would
  leave focus on the trigger and force keyboard users to Tab into the grid (an
  a11y regression vs. landing inside the calendar). It is also unnecessary for the
  *mouse* first-click symptom: that is caused by react-day-picker's **uncoordinated**
  `initialFocus` `.focus()` call firing during the click gesture. Radix's own
  open-focus is coordinated with the Dialog (the Popover layer pauses the Dialog's
  trapped scope), so removing `initialFocus` alone stops the tug-of-war. Empirically
  confirmed in a real browser in Phase 8.
- **`pointer-events-auto`** — declined (see Content above). Removing it also lets
  the two non-dialog band-aid sites (`POSSalesImportReview`, `ReceiptMappingReview`,
  both rendered at page level, not inside a modal Dialog) drop their inline copies
  with zero behavioral change.

### 2. Migrate the 8 default-trigger instances

Replace the `Popover` / `PopoverTrigger` / `PopoverContent` / `Calendar` block
with a single `<DatePicker .../>`, preserving each site's existing `dateFormat`,
`placeholder`, `triggerClassName` (widths/colors), `aria-label`, and `disabled`
predicate so there is **no visual or behavioral change** other than the fix.
Remove now-unused `Popover`/`Calendar`/`format`/`CalendarIcon` imports.

**Label association fix.** Several sites pair a visible `<Label htmlFor="start-date">`
with the trigger `<Button id="start-date">`. A `<button>` is **not** a labelable
element, so `htmlFor` → button is a dead (non-functional) association — clicking
the label does nothing and the link is ignored by assistive tech. The trigger's
existing `aria-label` (e.g. "Select start date") already provides the accessible
name. Migration drops the dead `htmlFor`/`id` pairing and keeps the `aria-label`;
the visible `<Label>` remains a sighted-user affordance. (Sites that prefer linking
the visible label may instead give the `<Label>` an `id` and pass
`aria-labelledby` to `DatePicker`.)

### 3. Migrate the 3 custom-trigger instances

`POSSalesImportReview` (×2) and `ReceiptMappingReview` (×1) pass their bespoke
trigger button as `children`:

```tsx
<DatePicker value={selectedDate} onChange={handleApplyDate} disabled={pred}>
  <Button variant="outline" className="...border-orange-300">…custom…</Button>
</DatePicker>
```

Drop the inline `pointer-events-auto` and the `CalendarComponent` import alias.

**Custom-trigger a11y contract.** Because `children` is caller-rendered, the
caller owns the trigger's accessible name and any decorative icons. Concretely:
- `ReceiptMappingReview`: its trigger shows only a formatted date when set (no
  contextual text), so add `aria-label="Select purchase date"` to the button and
  `aria-hidden` to the trailing decorative `<CheckCircle>`.
- `POSSalesImportReview`: the "Change Date" trigger already has visible text; the
  primary trigger shows the date — add an `aria-label` ("Select sales date") for
  the date-only state.

These sites render at page level (not inside a modal Dialog), so they are not
actively affected by the focus trap; migrating them serves the "fix the whole
class" goal and removes the dead band-aids.

### 4. Fix `ui/date-range-picker.tsx` in place

Kept separate from `DatePicker` (different range API). Its call sites
(`PeriodSelector`, `FinancialStatements`, `pos/SyncComponents`) are all
page-level — **none inside a Dialog** — so it is not an active bug today; the
change is hygiene + future-proofing. Changes:

- Remove `initialFocus`.
- Add controlled `open` state (`<Popover open onOpenChange>`).
- Close the popover when the range is complete (both `from` and `to` selected) —
  the same point where it already calls `onSelect`.

No range-in-Dialog test is added (no such usage exists); the controlled-open +
no-`initialFocus` behavior is covered by the `DatePicker` unit suite's
equivalent assertions.

### 5. CopyWeekDialog — untouched

Inline calendars, no popover, not subject to the focus trap.

## Accessibility

Removing `initialFocus` does not remove keyboard access. Radix's native popover
focus management takes over: open → focus moves into the `PopoverContent` →
`Tab` reaches the day grid (react-day-picker's roving `tabIndex`, with the focus
target day at `tabIndex 0`) → arrow keys navigate → `Enter` selects and closes →
focus returns to the trigger. The default trigger retains its `aria-label`.
Validated in Phase 5 (UI review) with the `accessibility` skill.

## Testing

- **`tests/unit/DatePicker.test.tsx`** (Vitest + Testing Library + `userEvent`):
  - renders the placeholder when `value` is undefined;
  - renders the formatted `value` when set (default `PPP` and a custom `dateFormat`);
  - opening the trigger reveals the calendar grid;
  - **clicking a day calls `onChange` with that date AND closes the popover** —
    the core close-on-select regression guard;
  - **re-clicking the selected day (deselect → `onSelect(undefined)`) keeps the
    popover open and does not silently close** — the close-guard;
  - a `disabled` day cannot be selected;
  - the calendar opens on the selected `value`'s month (`defaultMonth` behavior);
  - a custom `children` trigger renders and toggles the popover;
  - the default trigger exposes the provided `aria-label` / `aria-labelledby`.
  This also satisfies SonarCloud's ≥80% new-code coverage on the new file.
- **Real-browser verification (Phase 8 — MANDATORY).** The focus-race is not
  reproducible in jsdom (no real focus/pointer timing). Phase 8 must, in a real
  browser: (a) reproduce the **first-click failure on the pre-fix code** in the
  Time-Off dialog, then (b) confirm the **first click selects a date and closes
  the popover on the fixed code**, and (c) spot-check one banking dialog
  (`ReconciliationDialog`/`EnhancedReconciliationDialog`) to confirm no
  `pointer-events`/focus regression after dropping the band-aids. This step is the
  authoritative confirmation of the focus-mechanism decisions above.
- Existing suites must stay green: migrated call sites are covered by their own
  dialogs' tests where present; full `npm run test` + `typecheck` + `lint` +
  `build` in Phase 8.

## Risks & Mitigations

- **Blast radius** spans banking, POS-import, inventory, and scheduling dialogs.
  Mitigated by a single correct primitive, strict per-site preservation of
  format/aria/className/disabled, the unit suite, and the mandatory real-browser
  checks (Time-Off flow + one banking dialog).
- **Dropping the two `pointer-events-auto` band-aids** could in principle regress
  click handling. Mitigated because both band-aid sites render at page level (no
  modal → body never gets `pointer-events: none`), and the dialog sites are proven
  click-capable by the bug report itself (the retry succeeds). Browser-verified in
  Phase 8.
- **Behavior change: popover now closes on a real pick.** Intentional and
  desirable (clear feedback). Re-clicking the selected day clears but keeps the
  popover open (no silent close+wipe of a required field). Range picker closes
  only when both ends are chosen, matching its existing completion point.

## Decided trade-offs

- **Single `DatePicker` vs. folding range in:** keep range in its own component;
  one range usage does not justify a dual-mode API.
- **Focus mechanism** (`onOpenAutoFocus`, `pointer-events-auto`): see "Considered
  & declined (focus mechanism)" under the Solution — both rejected as defaults,
  with browser verification in Phase 8.

## Design-review resolutions (Phase 2.5)

Frontend reviewer findings folded in: dropped `pointer-events-auto` default (C1);
removed dead `htmlFor`→button label pairing, forward `aria-labelledby` (C2);
close-guard so deselect doesn't silently wipe a required date (M1); custom-trigger
a11y contract for the Receipt/POS sites (M2); confirmed range picker is used
outside dialogs (M3); typed `children` as `React.ReactElement` (M5); added
`defaultMonth ?? value` so the calendar opens on the selected month (Minor-2).
Declined with rationale: `onOpenAutoFocus` default (a11y + unnecessary for the
mouse bug), POS raw-color remediation (out of scope), form `name`/`required`
(YAGNI).

## Out of scope (with rationale)

- **CopyWeekDialog inline calendars** — no Popover, no focus trap, unaffected.
- **Time-Off flow redesign** beyond the date-picker fix.
- **Migrating `date-range-picker` to share internals with `DatePicker`** — one
  range usage doesn't justify a dual-mode API.
- **`POSSalesImportReview` raw Tailwind colors** (`border-orange-300`,
  `bg-green-50`, …) — pre-existing CLAUDE.md non-compliance, unrelated to BUG-001.
  The migration wraps the existing trigger button verbatim (no color changes), so
  this PR neither fixes nor worsens it. Flagged as a separate follow-up to keep the
  diff focused on the bug.
- **Form-control props (`name`/`required`) on `DatePicker`** — no current call
  site uses native-form/react-hook-form binding for these dates (all use
  `useState`). Deferred until a real need exists (YAGNI).
