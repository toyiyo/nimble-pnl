# Calendar First-Click Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the first-click failure on date pickers rendered inside dialogs by replacing the `initialFocus` + uncontrolled-`Popover` pattern with a shared, controlled `DatePicker` primitive across all 10 single-date instances, and fixing `date-range-picker` in place.

**Architecture:** New `src/components/ui/date-picker.tsx` owns a controlled Popover (closes on a real pick), forwards a day-`disabled` matcher to `Calendar`, and renders no `initialFocus` — removing the focus tug-of-war between the modal Dialog's trapped FocusScope and react-day-picker's programmatic day focus. Call sites become thin `<DatePicker .../>` usages; bespoke triggers use the `children` escape hatch.

**Tech Stack:** React 18, TypeScript, react-day-picker 8.10.1, @radix-ui/react-popover 1.1.14, shadcn/ui, Vitest + Testing Library + user-event, date-fns.

**Spec:** `docs/superpowers/specs/2026-06-04-timeoff-calendar-first-click-design.md`

**Coverage note:** `src/components/**` is excluded from both `vitest.config.ts` `coverage.exclude` and `sonar.coverage.exclusions`, so none of these files affect the SonarCloud new-code gate. Tests below exist for **regression value**, not coverage.

---

## File Structure

- **Create** `src/components/ui/date-picker.tsx` — `DatePicker` single-date primitive (controlled, close-on-select, no `initialFocus`).
- **Create** `tests/unit/DatePicker.test.tsx` — behavior/regression suite for the primitive.
- **Modify** `src/components/TimeOffRequestDialog.tsx` — 2 instances (reported bug).
- **Modify** `src/components/AvailabilityExceptionDialog.tsx` — 1 instance.
- **Modify** `src/components/BulkInventoryDeductionDialog.tsx` — 2 instances.
- **Modify** `src/components/banking/ReconciliationDialog.tsx` — 1 instance.
- **Modify** `src/components/banking/EnhancedReconciliationDialog.tsx` — 1 instance.
- **Modify** `src/components/POSSalesImportReview.tsx` — 2 instances (custom triggers + aria).
- **Modify** `src/components/ReceiptMappingReview.tsx` — 1 instance (custom trigger + aria).
- **Modify** `src/components/ui/date-range-picker.tsx` — controlled open + close-on-complete + no `initialFocus`.
- **Create** `tests/unit/DateRangePicker.test.tsx` — close-on-complete regression.

---

## Task 1: `DatePicker` primitive (TDD)

**Files:**
- Create: `src/components/ui/date-picker.tsx`
- Test: `tests/unit/DatePicker.test.tsx`

- [ ] **Step 1: Write the failing test** — `tests/unit/DatePicker.test.tsx`

```tsx
import React, { useState } from 'react';
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, within, waitForElementToBeRemoved } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DatePicker } from '../../src/components/ui/date-picker';

// Radix Popover needs these in jsdom.
beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
  }
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = () => {};
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = () => {};
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
});

const JAN_2026 = new Date(2026, 0, 1);

describe('DatePicker', () => {
  it('shows the placeholder when no value is set', () => {
    render(<DatePicker value={undefined} onChange={vi.fn()} placeholder="Pick a date" />);
    expect(screen.getByRole('button', { name: 'Pick a date' })).toBeInTheDocument();
  });

  it('renders the formatted value with the default and a custom dateFormat', () => {
    const { rerender } = render(<DatePicker value={new Date(2026, 0, 15)} onChange={vi.fn()} />);
    // default "PPP"
    expect(screen.getByRole('button', { name: /January 15(th)?,? 2026/i })).toBeInTheDocument();
    rerender(<DatePicker value={new Date(2026, 0, 15)} onChange={vi.fn()} dateFormat="MMM d, yyyy" />);
    expect(screen.getByRole('button', { name: /Jan 15, 2026/ })).toBeInTheDocument();
  });

  it('opens the calendar grid when the trigger is clicked', async () => {
    const user = userEvent.setup();
    render(<DatePicker value={undefined} onChange={vi.fn()} defaultMonth={JAN_2026} placeholder="Pick a date" />);
    expect(screen.queryByRole('grid')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Pick a date' }));
    expect(await screen.findByRole('grid')).toBeInTheDocument();
  });

  it('selecting a day calls onChange and CLOSES the popover (the fix)', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<DatePicker value={undefined} onChange={onChange} defaultMonth={JAN_2026} placeholder="Pick a date" />);
    await user.click(screen.getByRole('button', { name: 'Pick a date' }));
    const grid = await screen.findByRole('grid');
    await user.click(within(grid).getByRole('gridcell', { name: '15' }));
    expect(onChange).toHaveBeenCalledTimes(1);
    const arg = onChange.mock.calls[0][0] as Date;
    expect(arg.getFullYear()).toBe(2026);
    expect(arg.getMonth()).toBe(0);
    expect(arg.getDate()).toBe(15);
    await waitForElementToBeRemoved(() => screen.queryByRole('grid'));
  });

  it('re-clicking the selected day clears via onChange(undefined) but KEEPS the popover open (close-guard)', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<DatePicker value={new Date(2026, 0, 15)} onChange={onChange} defaultMonth={JAN_2026} />);
    await user.click(screen.getByRole('button'));
    const grid = await screen.findByRole('grid');
    await user.click(within(grid).getByRole('gridcell', { name: '15' }));
    expect(onChange).toHaveBeenCalledWith(undefined);
    expect(screen.getByRole('grid')).toBeInTheDocument(); // still open
  });

  it('does not select a disabled day', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <DatePicker
        value={undefined}
        onChange={onChange}
        defaultMonth={JAN_2026}
        disabled={(d) => d.getDate() === 20}
        placeholder="Pick a date"
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Pick a date' }));
    const grid = await screen.findByRole('grid');
    await user.click(within(grid).getByRole('gridcell', { name: '20' }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('grid')).toBeInTheDocument();
  });

  it('opens on the selected value’s month when no defaultMonth is given', async () => {
    const user = userEvent.setup();
    render(<DatePicker value={new Date(2026, 0, 15)} onChange={vi.fn()} />);
    await user.click(screen.getByRole('button'));
    expect(await screen.findByText(/January 2026/i)).toBeInTheDocument();
  });

  it('renders a custom children trigger and toggles the popover', async () => {
    const user = userEvent.setup();
    render(
      <DatePicker value={undefined} onChange={vi.fn()} defaultMonth={JAN_2026}>
        <button type="button">Change Date</button>
      </DatePicker>,
    );
    await user.click(screen.getByRole('button', { name: 'Change Date' }));
    expect(await screen.findByRole('grid')).toBeInTheDocument();
  });

  it('forwards aria-label to the default trigger', () => {
    render(<DatePicker value={undefined} onChange={vi.fn()} aria-label="Select start date" />);
    expect(screen.getByRole('button', { name: 'Select start date' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `npx vitest run tests/unit/DatePicker.test.tsx`
Expected: FAIL — `Failed to resolve import "../../src/components/ui/date-picker"`.

- [ ] **Step 3: Implement `src/components/ui/date-picker.tsx`**

```tsx
import * as React from "react";
import { Calendar as CalendarIcon } from "lucide-react";
import { format } from "date-fns";
import type { Matcher } from "react-day-picker";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export interface DatePickerProps {
  /** Currently selected date, or undefined when empty. */
  value: Date | undefined;
  /** Called with the picked date, or undefined when the day is deselected. */
  onChange: (date: Date | undefined) => void;
  /** Day matcher(s) forwarded to react-day-picker to disable days. */
  disabled?: Matcher | Matcher[];
  /** Trigger placeholder when no value is set. */
  placeholder?: string;
  /** date-fns format string for the trigger label. */
  dateFormat?: string;
  /** Initial month to display; defaults to `value` so the calendar opens on it. */
  defaultMonth?: Date;
  /** Popover alignment relative to the trigger. */
  align?: "start" | "center" | "end";
  id?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  /** Extra classes for the default trigger button. */
  triggerClassName?: string;
  /** Optional custom trigger (a single element; rendered via Radix `asChild`). */
  children?: React.ReactElement;
}

export function DatePicker({
  value,
  onChange,
  disabled,
  placeholder = "Pick a date",
  dateFormat = "PPP",
  defaultMonth,
  align = "start",
  id,
  triggerClassName,
  children,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledby,
}: DatePickerProps) {
  const [open, setOpen] = React.useState(false);

  const handleSelect = (date: Date | undefined) => {
    if (date) {
      // Real pick: update and close (immediate feedback).
      onChange(date);
      setOpen(false);
    } else {
      // Deselect (re-click of the selected day): clear but keep the popover
      // open so the user sees the cleared state instead of a silent close+wipe.
      onChange(undefined);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {children ?? (
          <Button
            id={id}
            type="button"
            variant="outline"
            aria-label={ariaLabel}
            aria-labelledby={ariaLabelledby}
            className={cn(
              "w-full justify-start text-left font-normal",
              !value && "text-muted-foreground",
              triggerClassName,
            )}
          >
            <CalendarIcon className="mr-2 h-4 w-4" />
            {value ? format(value, dateFormat) : placeholder}
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align={align}>
        <Calendar
          mode="single"
          selected={value}
          defaultMonth={defaultMonth ?? value}
          disabled={disabled}
          onSelect={handleSelect}
        />
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `npx vitest run tests/unit/DatePicker.test.tsx`
Expected: PASS (9 tests). If a react-day-picker day selector mismatches (rdp labels gridcells by day-of-month), adjust the `getByRole('gridcell', { name })` query to the actual accessible name printed by `screen.debug()` — the assertions themselves do not change.

- [ ] **Step 5: Typecheck + lint the new files**

Run: `npm run typecheck && npx eslint src/components/ui/date-picker.tsx tests/unit/DatePicker.test.tsx`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/ui/date-picker.tsx tests/unit/DatePicker.test.tsx
git commit -m "feat(ui): add controlled DatePicker primitive (no initialFocus)"
```

---

## Task 2: Migrate `TimeOffRequestDialog` (reported bug)

**Files:**
- Modify: `src/components/TimeOffRequestDialog.tsx` (imports + the two date `Popover` blocks at lines ~109-165, and the two `<Label htmlFor>`)

- [ ] **Step 1: Update imports**

Remove the now-unused `Calendar as CalendarIcon` from lucide, `format` from date-fns, `Calendar`, and `Popover`/`PopoverContent`/`PopoverTrigger`. Add:

```tsx
import { DatePicker } from '@/components/ui/date-picker';
```

(Keep `AlertCircle` from lucide-react; keep `cn` only if still used elsewhere in the file — remove if not.)

- [ ] **Step 2: Replace the Start Date block**

Replace the `<Label htmlFor="start-date">…</Label>` + `<Popover>…</Popover>` (lines ~110-136) with:

```tsx
<div className="space-y-2">
  <Label>Start Date *</Label>
  <DatePicker
    value={startDate}
    onChange={setStartDate}
    dateFormat="MMM d, yyyy"
    placeholder="Pick date"
    aria-label="Select start date"
  />
</div>
```

- [ ] **Step 3: Replace the End Date block**

Replace the End Date `<Label htmlFor="end-date">` + `<Popover>` (lines ~138-164) with:

```tsx
<div className="space-y-2">
  <Label>End Date *</Label>
  <DatePicker
    value={endDate}
    onChange={setEndDate}
    dateFormat="MMM d, yyyy"
    placeholder="Pick date"
    aria-label="Select end date"
    disabled={(date) => (startDate ? date < startDate : false)}
  />
</div>
```

(`<Label>` no longer uses `htmlFor` — a `<button>` is not a labelable element, so the old pairing was dead; the trigger's `aria-label` provides the accessible name.)

- [ ] **Step 4: Typecheck, lint, build**

Run: `npm run typecheck && npx eslint src/components/TimeOffRequestDialog.tsx && npm run build`
Expected: success, no unused-import warnings.

- [ ] **Step 5: Commit**

```bash
git add src/components/TimeOffRequestDialog.tsx
git commit -m "fix(timeoff): use DatePicker so first calendar click registers (BUG-001)"
```

---

## Task 3: Migrate `AvailabilityExceptionDialog`

**Files:**
- Modify: `src/components/AvailabilityExceptionDialog.tsx` (imports + Popover block at lines ~132-155 + `<Label htmlFor="date">`)

- [ ] **Step 1:** Add `import { DatePicker } from '@/components/ui/date-picker';`; remove now-unused `Calendar`, `Popover*`, `CalendarIcon`, and `format` imports (verify `format`/`cn` are unused elsewhere before removing).

- [ ] **Step 2:** Replace the `<Label htmlFor="date">Date *</Label>` + `<Popover>…</Popover>` with:

```tsx
<div className="space-y-2">
  <Label>Date *</Label>
  <DatePicker
    value={date}
    onChange={setDate}
    dateFormat="MMM d, yyyy"
    placeholder="Pick a date"
    aria-label="Select date"
  />
</div>
```

- [ ] **Step 3:** `npm run typecheck && npx eslint src/components/AvailabilityExceptionDialog.tsx`
- [ ] **Step 4: Commit**

```bash
git add src/components/AvailabilityExceptionDialog.tsx
git commit -m "fix(availability): migrate date field to DatePicker"
```

---

## Task 4: Migrate `BulkInventoryDeductionDialog`

**Files:**
- Modify: `src/components/BulkInventoryDeductionDialog.tsx` (imports + two Popover blocks at lines ~64-112)

- [ ] **Step 1:** Add `import { DatePicker } from '@/components/ui/date-picker';`; remove unused `Calendar`, `Popover*`, `CalendarIcon`, `format`, `cn` (verify each is unused elsewhere).

- [ ] **Step 2:** Replace the Start Date `<Popover>` block with:

```tsx
<DatePicker value={startDate} onChange={setStartDate} aria-label="Select start date" />
```

- [ ] **Step 3:** Replace the End Date `<Popover>` block with:

```tsx
<DatePicker
  value={endDate}
  onChange={setEndDate}
  aria-label="Select end date"
  disabled={(date) => (startDate ? date < startDate : false)}
/>
```

(Keep the surrounding `<div className="grid gap-2"><Label>Start Date</Label> … </div>` wrappers; only the `<Popover>` subtree is replaced. Default `dateFormat="PPP"` matches the original `format(startDate, "PPP")`.)

- [ ] **Step 4:** `npm run typecheck && npx eslint src/components/BulkInventoryDeductionDialog.tsx`
- [ ] **Step 5: Commit**

```bash
git add src/components/BulkInventoryDeductionDialog.tsx
git commit -m "fix(inventory): migrate bulk-deduction date fields to DatePicker"
```

---

## Task 5: Migrate banking `ReconciliationDialog` + `EnhancedReconciliationDialog`

**Files:**
- Modify: `src/components/banking/ReconciliationDialog.tsx` (Popover block ~60-86, `<Label htmlFor="date">`)
- Modify: `src/components/banking/EnhancedReconciliationDialog.tsx` (Popover block ~270-295, `<Label htmlFor="ending-date">`)

- [ ] **Step 1 (ReconciliationDialog):** Add the `DatePicker` import; remove unused `Calendar`/`Popover*`/`CalendarIcon`/`format`. Replace the `<Label htmlFor="date">…</Label>` + `<Popover>` with:

```tsx
<Label>Statement Date</Label>
<DatePicker value={date} onChange={setDate} aria-label="Select statement date" />
```

(Use the existing label text verbatim if it differs; keep the wrapping `<div className="space-y-2">`.)

- [ ] **Step 2 (EnhancedReconciliationDialog):** Add the `DatePicker` import; remove unused calendar/popover imports. Replace the `<Label htmlFor="ending-date">` + `<Popover>` with:

```tsx
<Label>Statement Ending Date</Label>
<DatePicker value={endingDate} onChange={setEndingDate} aria-label="Select statement ending date" />
```

(Use the existing label text verbatim.)

- [ ] **Step 3:** `npm run typecheck && npx eslint src/components/banking/ReconciliationDialog.tsx src/components/banking/EnhancedReconciliationDialog.tsx`
- [ ] **Step 4: Commit**

```bash
git add src/components/banking/ReconciliationDialog.tsx src/components/banking/EnhancedReconciliationDialog.tsx
git commit -m "fix(banking): migrate reconciliation date fields to DatePicker"
```

---

## Task 6: Migrate `POSSalesImportReview` (custom triggers)

**Files:**
- Modify: `src/components/POSSalesImportReview.tsx` (two Popover blocks ~476-499 and ~510-530)

- [ ] **Step 1:** Add `import { DatePicker } from '@/components/ui/date-picker';`. Remove the `CalendarComponent` import alias and the now-unused `Popover*` imports. Keep the lucide `Calendar` icon import (still used inside the custom trigger buttons).

- [ ] **Step 2:** Replace the first `<Popover>…</Popover>` (the primary "Pick a date" trigger) with a `DatePicker` wrapping the existing button as `children`, dropping the `pointer-events-auto` className and adding an aria-label:

```tsx
<DatePicker value={selectedDate} onChange={handleApplyDate}>
  <Button
    variant="outline"
    aria-label="Select sales date"
    className={cn(
      "w-[240px] justify-start text-left font-normal border-orange-300",
      !selectedDate && "text-muted-foreground",
    )}
  >
    <Calendar className="mr-2 h-4 w-4" />
    {selectedDate ? format(selectedDate, "PPP") : <span>Pick a date</span>}
  </Button>
</DatePicker>
```

- [ ] **Step 3:** Replace the second `<Popover>…</Popover>` ("Change Date") with:

```tsx
<DatePicker value={selectedDate} onChange={handleApplyDate}>
  <Button variant="outline" size="sm" className="border-green-300">
    <Calendar className="mr-2 h-4 w-4" />
    Change Date
  </Button>
</DatePicker>
```

(The existing `border-orange-300`/`border-green-300` classes are preserved verbatim — raw-color remediation is out of scope per the spec.)

- [ ] **Step 4:** `npm run typecheck && npx eslint src/components/POSSalesImportReview.tsx`
- [ ] **Step 5: Commit**

```bash
git add src/components/POSSalesImportReview.tsx
git commit -m "fix(pos-import): migrate date pickers to DatePicker; drop pointer-events band-aid"
```

---

## Task 7: Migrate `ReceiptMappingReview` (custom trigger)

**Files:**
- Modify: `src/components/ReceiptMappingReview.tsx` (Popover block ~597-623)

- [ ] **Step 1:** Add `import { DatePicker } from '@/components/ui/date-picker';`. Remove the now-unused `Calendar`, `Popover*` imports (keep `CheckCircle`, `format`).

- [ ] **Step 2:** Replace the `<Popover>…</Popover>` with a `DatePicker` wrapping the existing trigger as `children`, adding `aria-label` and marking the decorative icon `aria-hidden`:

```tsx
<DatePicker
  value={receiptDetails?.purchase_date ? new Date(receiptDetails.purchase_date) : undefined}
  onChange={handlePurchaseDateChange}
  disabled={(date) => date > new Date() || date < new Date("2000-01-01")}
>
  <Button
    variant="outline"
    aria-label="Select purchase date"
    className={cn(
      "w-full justify-start text-left font-normal",
      !receiptDetails?.purchase_date && "text-muted-foreground",
    )}
  >
    {receiptDetails?.purchase_date
      ? format(new Date(receiptDetails.purchase_date), 'PPP')
      : 'Pick a date'}
    {receiptDetails?.purchase_date && (
      <CheckCircle className="ml-auto h-4 w-4 text-green-600" aria-hidden="true" />
    )}
  </Button>
</DatePicker>
```

- [ ] **Step 3:** `npm run typecheck && npx eslint src/components/ReceiptMappingReview.tsx`
- [ ] **Step 4: Commit**

```bash
git add src/components/ReceiptMappingReview.tsx
git commit -m "fix(receipt): migrate purchase-date picker to DatePicker"
```

---

## Task 8: Fix `date-range-picker.tsx` in place (+ test)

**Files:**
- Modify: `src/components/ui/date-range-picker.tsx`
- Test: `tests/unit/DateRangePicker.test.tsx`

- [ ] **Step 1: Write the failing test** — `tests/unit/DateRangePicker.test.tsx`

```tsx
import React from 'react';
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, within, waitForElementToBeRemoved } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DateRangePicker } from '../../src/components/ui/date-range-picker';

beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false;
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
});

describe('DateRangePicker', () => {
  it('closes the popover only once the range is complete (both ends picked)', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<DateRangePicker from={new Date(2026, 0, 1)} to={new Date(2026, 0, 31)} onSelect={onSelect} />);
    await user.click(screen.getByRole('button'));
    const grid = await screen.findByRole('grid');
    // First click sets `from` and keeps the popover open.
    await user.click(within(grid).getAllByRole('gridcell', { name: '10' })[0]);
    expect(screen.getByRole('grid')).toBeInTheDocument();
    // Second click completes the range -> onSelect fires and the popover closes.
    await user.click(within(screen.getByRole('grid')).getAllByRole('gridcell', { name: '20' })[0]);
    expect(onSelect).toHaveBeenCalled();
    await waitForElementToBeRemoved(() => screen.queryByRole('grid'));
  });
});
```

- [ ] **Step 2: Run, verify it fails**

Run: `npx vitest run tests/unit/DateRangePicker.test.tsx`
Expected: FAIL — the popover stays open after completion (no controlled close yet).

- [ ] **Step 3: Edit `src/components/ui/date-range-picker.tsx`**

Add controlled open state and close-on-complete; remove `initialFocus`:

```tsx
export function DateRangePicker({ from, to, onSelect, className }: DateRangePickerProps) {
  const [date, setDate] = React.useState<{ from: Date | undefined; to: Date | undefined }>({ from, to })
  const [open, setOpen] = React.useState(false)

  React.useEffect(() => {
    setDate({ from, to })
  }, [from, to])

  return (
    <div className={cn("grid gap-2", className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          {/* …unchanged trigger button… */}
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="range"
            defaultMonth={date?.from}
            selected={{ from: date.from, to: date.to }}
            onSelect={(range) => {
              setDate({ from: range?.from, to: range?.to })
              if (range?.from && range?.to) {
                onSelect({ from: range.from, to: range.to })
                setOpen(false)
              }
            }}
            numberOfMonths={2}
          />
        </PopoverContent>
      </Popover>
    </div>
  )
}
```

The only changes vs. the current file: add `const [open, setOpen] = …`; pass `open`/`onOpenChange` to `<Popover>`; delete the `initialFocus` prop; add `setOpen(false)` inside the both-ends branch. Leave the trigger button markup unchanged.

- [ ] **Step 4: Run the test, verify it passes**

Run: `npx vitest run tests/unit/DateRangePicker.test.tsx`
Expected: PASS. (If the `'10'`/`'20'` gridcell names collide across the two displayed months, switch to `getAllByRole(...)[0]` as written, or scope to the first month container via `screen.getByText(...)`.)

- [ ] **Step 5: Typecheck + lint**

Run: `npm run typecheck && npx eslint src/components/ui/date-range-picker.tsx tests/unit/DateRangePicker.test.tsx`

- [ ] **Step 6: Commit**

```bash
git add src/components/ui/date-range-picker.tsx tests/unit/DateRangePicker.test.tsx
git commit -m "fix(ui): controlled DateRangePicker closes on complete; drop initialFocus"
```

---

## Task 9: Final guard — no stragglers

- [ ] **Step 1: Confirm no `initialFocus` remains on any popover Calendar**

Run: `grep -rn "initialFocus" src/`
Expected: **no matches** (CopyWeekDialog's inline calendars never used it).

- [ ] **Step 2: Confirm no orphaned `pointer-events-auto` band-aids on calendars**

Run: `grep -rn "pointer-events-auto" src/components/POSSalesImportReview.tsx src/components/ReceiptMappingReview.tsx`
Expected: no matches.

- [ ] **Step 3: Full local verification** (Phase 8 entrypoint)

Run: `npm run test && npm run typecheck && npm run lint && npm run build`
Expected: all green.

---

## Self-Review

- **Spec coverage:** §Solution-1 → Task 1; §2 (8 default sites) → Tasks 2,3,4,5; §3 (custom triggers) → Tasks 6,7; §4 (range) → Task 8; §5 (CopyWeekDialog excluded) → Task 9 grep guard. A11y label fix → Tasks 2,3,5; custom-trigger a11y → Tasks 6,7. defaultMonth/close-guard/`children: ReactElement` → Task 1 implementation + tests.
- **Placeholder scan:** none — every code step has complete code; the only conditional notes are about react-day-picker's runtime gridcell labels, with a concrete fallback (`screen.debug()` / `getAllByRole[0]`), not a TODO.
- **Type consistency:** `DatePicker` prop names (`value`, `onChange`, `disabled`, `dateFormat`, `placeholder`, `aria-label`, `children`) are used identically across Tasks 2-7. `onChange`/`onSelect`/`setDate`/`setStartDate`/`setEndDate`/`setEndingDate`/`handleApplyDate`/`handlePurchaseDateChange` all match each call site's existing setter signature `(date: Date | undefined) => void`.
- **Behavior:** close-on-select (Task 1) is the named regression guard; date-range close-on-complete (Task 8) is independently tested; the focus-race itself is verified in a real browser in Phase 8 (mandatory, per spec).
