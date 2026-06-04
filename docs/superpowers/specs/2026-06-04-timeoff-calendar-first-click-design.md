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
  align?: "start" | "center" | "end";  // default "start"
  id?: string;
  "aria-label"?: string;
  triggerClassName?: string;
  children?: React.ReactNode;          // optional custom trigger (escape hatch)
}
```

Behavior:

- **Controlled open state.** `const [open, setOpen] = useState(false)`, wired to
  `<Popover open={open} onOpenChange={setOpen}>`.
- **Trigger.** If `children` is provided, render it inside
  `<PopoverTrigger asChild>` (custom-trigger sites). Otherwise render a default
  `outline` `Button` with a leading `CalendarIcon` and
  `value ? format(value, dateFormat) : placeholder`, applying
  `text-muted-foreground` when empty, merged with `triggerClassName`, and passing
  `id` / `aria-label`.
- **Content.** `<PopoverContent className="w-auto p-0 pointer-events-auto" align={align}>`.
  The `pointer-events-auto` is a deliberate, documented defensive measure for a
  portaled popper rendered while a modal Dialog has set `pointer-events: none` on
  `document.body`; it also lets the two existing band-aid sites drop their inline
  copies without regression.
- **Calendar.** `<Calendar mode="single" selected={value} disabled={disabled}
  onSelect={(d) => { onChange(d); setOpen(false); }} />` — **no `initialFocus`**.
  Closing on select gives the immediate visual feedback whose absence drove the
  rage-click, and is the shadcn-recommended form pattern.

### 2. Migrate the 8 default-trigger instances

Replace the `Popover` / `PopoverTrigger` / `PopoverContent` / `Calendar` block
with a single `<DatePicker .../>`, preserving each site's existing `dateFormat`,
`placeholder`, `triggerClassName` (widths/colors), `id`, `aria-label`, and
`disabled` predicate so there is **no visual or behavioral change** other than the
fix. Remove now-unused `Popover`/`Calendar`/`format`/`CalendarIcon` imports.

### 3. Migrate the 3 custom-trigger instances

`POSSalesImportReview` (×2) and `ReceiptMappingReview` (×1) pass their bespoke
trigger button as `children`:

```tsx
<DatePicker value={selectedDate} onChange={handleApplyDate} disabled={pred}>
  <Button variant="outline" className="...border-orange-300">…custom…</Button>
</DatePicker>
```

Drop the inline `pointer-events-auto` and the `CalendarComponent` import alias.

### 4. Fix `ui/date-range-picker.tsx` in place

Kept separate from `DatePicker` (different range API; single usage). Changes:

- Remove `initialFocus`.
- Add controlled `open` state.
- Close the popover when the range is complete (both `from` and `to` selected) —
  the same point where it already calls `onSelect`.

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
  - renders the formatted `value` when set (default and custom `dateFormat`);
  - opening the trigger reveals the calendar grid;
  - **clicking a day calls `onChange` with that date AND closes the popover** —
    the core close-on-select regression guard;
  - a `disabled` day cannot be selected;
  - a custom `children` trigger renders and toggles the popover;
  - the default trigger exposes the provided `aria-label`.
  This also satisfies SonarCloud's ≥80% new-code coverage on the new file.
- **Real-browser verification (Phase 8):** the focus-race itself is not
  reproducible in jsdom (no real focus/pointer timing), so the first-click fix is
  confirmed by driving the actual Time-Off dialog in a browser and selecting
  start + end dates on the first interaction.
- Existing suites must stay green: migrated call sites are covered by their own
  dialogs' tests where present; full `npm run test` + `typecheck` + `lint` +
  `build` in Phase 8.

## Risks & Mitigations

- **Blast radius** spans banking, POS-import, inventory, and scheduling dialogs.
  Mitigated by a single correct primitive, strict per-site preservation of
  format/aria/className/disabled, the unit suite, and manual browser checks of at
  least the reported Time-Off flow plus one banking and one POS-import dialog.
- **`pointer-events-auto` as default** could be seen as cargo-cult. Rationale is
  documented above; it is harmless when no modal is present (popovers are
  interactive anyway) and removes two existing ad-hoc copies.
- **Behavior change: popover now closes on select.** Intentional and desirable
  (clear feedback). Range picker closes only when both ends are chosen, matching
  its existing completion point.

## Decided trade-offs

- **Single `DatePicker` vs. folding range in:** keep range in its own component;
  one range usage does not justify a dual-mode API.
- **No custom `onOpenAutoFocus`:** we intentionally let Radix manage focus rather
  than re-introducing programmatic focus (the very thing that caused the bug).

## Out of scope

- CopyWeekDialog inline calendars.
- Any redesign of the Time-Off flow beyond the date-picker fix.
- Migrating `date-range-picker` to share internals with `DatePicker`.
