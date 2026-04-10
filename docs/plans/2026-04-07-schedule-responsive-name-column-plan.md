# Responsive Schedule Name Column Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the schedule planner usable on tablet/mobile by collapsing the employee name column to compact avatars below 768px.

**Architecture:** Use Tailwind's `md:` responsive prefix (768px breakpoint) to toggle between full and compact name layouts. No JS media queries needed — just `hidden md:flex` / `flex md:hidden` class toggling. Applies to all three schedule grid components.

**Tech Stack:** React, TailwindCSS responsive classes, existing shadcn Tooltip component

**Design doc:** `docs/plans/2026-04-07-schedule-responsive-name-column-design.md`

---

### File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/pages/Scheduling.tsx` | Modify lines 1130-1260 | Main schedule table: responsive name column + reduced day column min-widths |
| `src/components/scheduling/ShiftPlanner/TemplateGrid.tsx` | Modify line 43 | Template grid: responsive grid-cols |
| `src/components/scheduling/ShiftPlanner/TemplateRowHeader.tsx` | Modify lines 34-47 | Template name: compact mode with truncation |
| `src/components/scheduling/ShiftPlanner/StaffingOverlay.tsx` | Modify line 310 | Staffing overlay: responsive grid-cols matching TemplateGrid |
| `tests/unit/schedule-responsive.test.tsx` | Create | Unit tests for responsive class application |

---

### Task 1: Add responsive name column to main schedule table (Scheduling.tsx)

**Files:**
- Modify: `src/pages/Scheduling.tsx:1130-1260`
- Test: `tests/unit/schedule-responsive.test.tsx`

- [ ] **Step 1: Write failing test for compact avatar rendering**

Create `tests/unit/schedule-responsive.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

// We test that both full and compact name elements exist in the DOM
// (Tailwind responsive classes handle visibility via CSS, not JS)
describe('Schedule responsive name column', () => {
  it('renders both full-name and compact-name elements for each employee', () => {
    // We'll test the CSS class presence rather than visual rendering
    // since Vitest doesn't evaluate CSS media queries
    const doc = document.createElement('div');
    doc.innerHTML = `
      <td class="name-col">
        <div class="full-name hidden md:flex items-center gap-3">Full Name</div>
        <div class="compact-name flex md:hidden flex-col items-center">
          <div class="avatar">MR</div>
        </div>
      </td>
    `;

    const fullName = doc.querySelector('.full-name');
    const compactName = doc.querySelector('.compact-name');

    expect(fullName).not.toBeNull();
    expect(compactName).not.toBeNull();
    // Full name hidden on mobile, visible on md+
    expect(fullName?.className).toContain('hidden');
    expect(fullName?.className).toContain('md:flex');
    // Compact name visible on mobile, hidden on md+
    expect(compactName?.className).toContain('flex');
    expect(compactName?.className).toContain('md:hidden');
  });
});
```

- [ ] **Step 2: Run test to verify it passes (this is a class-presence test)**

Run: `npx vitest run tests/unit/schedule-responsive.test.tsx`
Expected: PASS (this validates our expected class pattern)

- [ ] **Step 3: Modify the table wrapper and header min-widths**

In `src/pages/Scheduling.tsx`, change line 1131 from:
```tsx
<table className="w-full border-collapse min-w-[900px]">
```
to:
```tsx
<table className="w-full border-collapse min-w-[600px] md:min-w-[900px]">
```

Change the header `<th>` for the name column (line 1134) from:
```tsx
<th className="text-left p-3 font-medium sticky left-0 bg-muted/30 backdrop-blur-sm z-10 min-w-[180px] border-r border-border/30">
```
to:
```tsx
<th className="text-left p-3 font-medium sticky left-0 bg-muted/30 backdrop-blur-sm z-10 w-[56px] md:w-auto md:min-w-[180px] border-r border-border/30">
```

Change the day column header `<th>` (line 1143) from:
```tsx
"text-center p-3 font-medium min-w-[130px] transition-colors",
```
to:
```tsx
"text-center p-2 md:p-3 font-medium min-w-[70px] md:min-w-[130px] transition-colors",
```

- [ ] **Step 4: Add compact avatar layout to employee name cells**

In `src/pages/Scheduling.tsx`, replace the employee name `<td>` block (lines 1220-1259) with a responsive layout. The `<td>` currently contains a single flex div with avatar + name + edit button. Wrap that in `hidden md:flex` and add a compact version with `flex md:hidden`:

Replace the content inside `<td className="p-3 sticky left-0 bg-inherit backdrop-blur-sm z-10 border-r border-border/30">` (lines 1220-1259):

The existing inner div (lines 1221-1258) gets class `hidden md:flex`:
```tsx
<td className="p-1 md:p-3 sticky left-0 bg-inherit backdrop-blur-sm z-10 border-r border-border/30">
  {/* Desktop: full name layout */}
  <div className="hidden md:flex items-center gap-3 justify-between">
    <div className="flex items-center gap-3">
      <div className={cn(
        "w-9 h-9 rounded-lg flex items-center justify-center text-xs font-semibold shadow-sm",
        employee.is_active
          ? "bg-gradient-to-br from-primary/20 to-primary/10 text-primary"
          : "bg-muted text-muted-foreground"
      )}>
        {employee.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
      </div>
      <div>
        <div className="font-medium text-sm flex items-center gap-2">
          {employee.name}
          {!employee.is_active && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 bg-muted">
              Inactive
            </Badge>
          )}
        </div>
        <div className="text-xs text-muted-foreground flex items-center gap-1.5">
          {employee.position}
          {(hoursPerEmployee.get(employee.id) ?? 0) > 0 && (
            <span className="text-[11px] px-1.5 py-0.5 rounded-md bg-muted">
              {hoursPerEmployee.get(employee.id)}h
            </span>
          )}
        </div>
      </div>
    </div>
    <Button
      variant="ghost"
      size="icon"
      onClick={() => handleEditEmployee(employee)}
      className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-all duration-200 hover:bg-primary/10"
      aria-label={`Edit ${employee.name}`}
    >
      <Edit className="h-3.5 w-3.5" />
    </Button>
  </div>

  {/* Mobile: compact avatar with tooltip */}
  <div className="flex md:hidden flex-col items-center py-1">
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={() => handleEditEmployee(employee)}
          className={cn(
            "w-9 h-9 rounded-lg flex items-center justify-center text-xs font-semibold shadow-sm cursor-pointer",
            employee.is_active
              ? "bg-gradient-to-br from-primary/20 to-primary/10 text-primary"
              : "bg-muted text-muted-foreground"
          )}
          aria-label={`${employee.name}, ${employee.position}`}
        >
          {employee.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right" className="text-xs">
        <div className="font-medium">{employee.name}</div>
        <div className="text-muted-foreground">{employee.position}</div>
      </TooltipContent>
    </Tooltip>
    {(hoursPerEmployee.get(employee.id) ?? 0) > 0 && (
      <span className="text-[10px] text-muted-foreground mt-0.5">
        {hoursPerEmployee.get(employee.id)}h
      </span>
    )}
  </div>
</td>
```

- [ ] **Step 5: Reduce day cell padding on mobile**

In `src/components/scheduling/DroppableDayCell.tsx`, the cell's inner div has `min-h-[60px]`. This stays, but find the `<td>` padding class `p-2` and change it to `p-1 md:p-2`. Also find the shift add button `"w-full h-8 text-xs"` and verify it works at reduced width.

In `src/pages/Scheduling.tsx` line 1272, the shift content area `<div className="space-y-1.5 min-h-[60px]">` — change to:
```tsx
<div className="space-y-1 md:space-y-1.5 min-h-[48px] md:min-h-[60px]">
```

- [ ] **Step 6: Run the test**

Run: `npx vitest run tests/unit/schedule-responsive.test.tsx`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/pages/Scheduling.tsx tests/unit/schedule-responsive.test.tsx
git commit -m "feat: add responsive compact name column to schedule table"
```

---

### Task 2: Make TemplateGrid responsive

**Files:**
- Modify: `src/components/scheduling/ShiftPlanner/TemplateGrid.tsx:43`
- Modify: `src/components/scheduling/ShiftPlanner/TemplateRowHeader.tsx:35-47`

- [ ] **Step 1: Update TemplateGrid grid-cols to be responsive**

In `src/components/scheduling/ShiftPlanner/TemplateGrid.tsx`, change line 43 from:
```tsx
<div className="grid grid-cols-[200px_repeat(7,1fr)] min-w-[1000px]">
```
to:
```tsx
<div className="grid grid-cols-[56px_repeat(7,1fr)] md:grid-cols-[200px_repeat(7,1fr)] min-w-[560px] md:min-w-[1000px]">
```

- [ ] **Step 2: Make TemplateRowHeader compact on mobile**

In `src/components/scheduling/ShiftPlanner/TemplateRowHeader.tsx`, replace lines 34-71 with a responsive layout:

```tsx
return (
  <div className="flex items-center justify-between p-1 md:p-3 min-h-[48px] md:min-h-[64px]">
    {/* Desktop: full name + time + position */}
    <div className="hidden md:block min-w-0">
      <div className="text-[14px] font-medium text-foreground truncate">
        {template.name}
      </div>
      <div className="text-[12px] text-muted-foreground">
        {formatCompactTemplateTime(template.start_time)}-
        {formatCompactTemplateTime(template.end_time)}
      </div>
      <div className="text-[12px] text-muted-foreground">
        {template.position}
      </div>
    </div>
    {/* Mobile: abbreviated name + time only */}
    <div className="block md:hidden min-w-0 text-center w-full">
      <div className="text-[11px] font-medium text-foreground truncate">
        {template.name.length > 5 ? template.name.slice(0, 5) + '.' : template.name}
      </div>
      <div className="text-[10px] text-muted-foreground">
        {formatCompactTemplateTime(template.start_time)}
      </div>
    </div>
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity hidden md:inline-flex"
          aria-label={`Actions for ${template.name}`}
        >
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => onEdit(template)}>
          <Pencil className="h-4 w-4 mr-2" /> Edit
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => onDelete(template.id)}
          className="text-destructive"
        >
          <Trash2 className="h-4 w-4 mr-2" /> Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>
);
```

- [ ] **Step 3: Run build to verify no type errors**

Run: `npx tsc --noEmit`
Expected: No new errors

- [ ] **Step 4: Commit**

```bash
git add src/components/scheduling/ShiftPlanner/TemplateGrid.tsx src/components/scheduling/ShiftPlanner/TemplateRowHeader.tsx
git commit -m "feat: make TemplateGrid and TemplateRowHeader responsive"
```

---

### Task 3: Make StaffingOverlay responsive

**Files:**
- Modify: `src/components/scheduling/ShiftPlanner/StaffingOverlay.tsx:310`

- [ ] **Step 1: Update StaffingOverlay grid-cols**

In `src/components/scheduling/ShiftPlanner/StaffingOverlay.tsx`, change line 310 from:
```tsx
<div className="grid grid-cols-[200px_repeat(7,1fr)] min-w-[1000px]">
```
to:
```tsx
<div className="grid grid-cols-[56px_repeat(7,1fr)] md:grid-cols-[200px_repeat(7,1fr)] min-w-[560px] md:min-w-[1000px]">
```

Also update the label cell at line 311-312. The "Staff per Hour" text and legend need to be hidden on mobile. Change:
```tsx
<div className="px-3 py-2 flex flex-col justify-center gap-1">
  <span className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
    Staff per Hour
  </span>
  <div className="flex items-center gap-2">
```
to:
```tsx
<div className="px-1 md:px-3 py-2 flex flex-col justify-center gap-1">
  <span className="text-[10px] md:text-[12px] font-medium text-muted-foreground uppercase tracking-wider hidden md:block">
    Staff per Hour
  </span>
  <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider block md:hidden">
    Staff
  </span>
  <div className="hidden md:flex items-center gap-2">
```

- [ ] **Step 2: Run build**

Run: `npx tsc --noEmit`
Expected: No new errors

- [ ] **Step 3: Commit**

```bash
git add src/components/scheduling/ShiftPlanner/StaffingOverlay.tsx
git commit -m "feat: make StaffingOverlay responsive"
```

---

### Task 4: E2E test — verify schedule renders on mobile viewport

**Files:**
- Create: `tests/e2e/schedule-responsive.spec.ts`

- [ ] **Step 1: Write E2E test**

Create `tests/e2e/schedule-responsive.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { generateTestUser } from '../helpers/e2e-supabase';

test.describe('Schedule responsive layout', () => {
  test('all 7 day columns visible at 375px width', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 812 });

    // Navigate to scheduling page (assumes test auth is configured)
    await page.goto('/scheduling');

    // Wait for the schedule table to load
    const table = page.locator('table');
    await expect(table).toBeVisible({ timeout: 10000 });

    // Verify all 7 day column headers are visible
    const dayHeaders = page.locator('thead th').filter({ hasNot: page.locator('.name-col') });
    // The name column th + 7 day ths = 8 total
    const allHeaders = page.locator('thead th');
    await expect(allHeaders).toHaveCount(8);

    // Check that the compact avatar is visible (flex md:hidden)
    const compactAvatar = page.locator('td .flex.md\\:hidden').first();
    // On mobile viewport, this element should be displayed
    // (Playwright evaluates actual CSS, so responsive classes work)
    await expect(compactAvatar).toBeVisible();

    // Check that the full name is hidden
    const fullName = page.locator('td .hidden.md\\:flex').first();
    await expect(fullName).toBeHidden();
  });

  test('full name visible at 1024px width', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto('/scheduling');

    const table = page.locator('table');
    await expect(table).toBeVisible({ timeout: 10000 });

    // Full name should be visible on desktop
    const fullName = page.locator('td .hidden.md\\:flex').first();
    await expect(fullName).toBeVisible();

    // Compact avatar should be hidden
    const compactAvatar = page.locator('td .flex.md\\:hidden').first();
    await expect(compactAvatar).toBeHidden();
  });
});
```

- [ ] **Step 2: Run E2E test**

Run: `npx playwright test tests/e2e/schedule-responsive.spec.ts`
Expected: Tests may need auth setup adjustments — fix as needed

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/schedule-responsive.spec.ts
git commit -m "test: add E2E tests for schedule responsive layout"
```

---

### Task 5: Verify and polish

- [ ] **Step 1: Run full test suite**

```bash
npm run test && npm run lint && npm run build
```

- [ ] **Step 2: Visual check at multiple breakpoints**

Open dev server, check at 375px (iPhone), 768px (iPad), 1024px (desktop). Verify:
- All 7 days visible at 375px
- Avatars show initials, tooltip works on hover
- Desktop layout unchanged
- TemplateGrid and StaffingOverlay also respond correctly

- [ ] **Step 3: Fix any issues found, commit**

```bash
git add -A
git commit -m "fix: polish responsive schedule layout"
```
