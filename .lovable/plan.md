

# Schedule Export for Kitchen & Manager Display

## Overview

We'll create a **print-optimized schedule export** that serves two primary use cases:
1. **Kitchen Display** - A clean, at-a-glance weekly grid posted in back-of-house
2. **Manager Quick Reference** - Portable format for floor managers during shifts

Following Apple's principle of **"do one thing exceptionally well"** and Notion's **"clarity over features"**, we'll focus on a single, beautifully formatted print view rather than multiple export formats.

---

## Design Principles Applied

| Principle | Application |
|-----------|-------------|
| **Simplicity** | Single "Print Schedule" button - no dropdown menus for format selection |
| **Clarity** | Large, readable names and times - optimized for 10ft viewing distance in kitchen |
| **Progressive Disclosure** | Basic info prominent, details (hours, cost) secondary |
| **Actionable** | Each day clearly shows who works when - zero interpretation needed |

---

## User Experience Flow

```text
┌─────────────────────────────────────────────────────────────────┐
│  Week Navigation                          [Print Schedule 🖨️]  │
├─────────────────────────────────────────────────────────────────┤
│  ... existing schedule grid ...                                 │
└─────────────────────────────────────────────────────────────────┘

        ↓ Click "Print Schedule"

┌─────────────────────────────────────────────────────────────────┐
│                    PRINT PREVIEW DIALOG                         │
├─────────────────────────────────────────────────────────────────┤
│  Preview:                                                       │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ [Restaurant Name]                                          │  │
│  │ Week of Jan 27 - Feb 2, 2026                              │  │
│  │ ┌─────┬─────┬─────┬─────┬─────┬─────┬─────┬─────┐        │  │
│  │ │     │ Mon │ Tue │ Wed │ Thu │ Fri │ Sat │ Sun │        │  │
│  │ ├─────┼─────┼─────┼─────┼─────┼─────┼─────┼─────┤        │  │
│  │ │ John│ 6A  │ OFF │ 6A  │ 6A  │ OFF │ 5A  │ 5A  │        │  │
│  │ │     │ 2P  │     │ 2P  │ 2P  │     │ 1P  │ 1P  │        │  │
│  │ ├─────┼─────┼─────┼─────┼─────┼─────┼─────┼─────┤        │  │
│  │ │Maria│ OFF │ 4P  │ 4P  │ OFF │ 4P  │ 4P  │ OFF │        │  │
│  │ │     │     │ CL  │ CL  │     │ CL  │ CL  │     │        │  │
│  │ └─────┴─────┴─────┴─────┴─────┴─────┴─────┴─────┘        │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                  │
│  Options:                                                        │
│  ☑ Include position labels                                      │
│  ☐ Include hours summary                                        │
│                                                                  │
│               [Cancel]              [Print]                      │
└─────────────────────────────────────────────────────────────────┘
```

---

## Technical Implementation

### Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `src/components/scheduling/ScheduleExportDialog.tsx` | **Create** | Print preview dialog with options |
| `src/utils/scheduleExport.ts` | **Create** | PDF generation logic for schedule |
| `src/pages/Scheduling.tsx` | **Modify** | Add "Print Schedule" button |

---

### Phase 1: Schedule Export Utility

**File: `src/utils/scheduleExport.ts`**

Create a dedicated schedule PDF generator optimized for kitchen display:

- **Landscape orientation** - Better fit for weekly grid
- **Large, bold names** - 14pt minimum for readability
- **Compact time format** - "6A-2P" instead of "6:00 AM - 2:00 PM"
- **Position as subtitle** - Smaller text under times
- **Day columns** - Mon-Sun with dates
- **"OFF" indicators** - Clear visual when employee not scheduled
- **Footer** - Restaurant name, week dates, print timestamp

**PDF Layout (Landscape A4/Letter):**

```text
┌────────────────────────────────────────────────────────────────────────────────┐
│                         [RESTAURANT NAME]                                       │
│                    Week of January 27 - February 2, 2026                        │
├────────┬──────────┬──────────┬──────────┬──────────┬──────────┬────────┬───────┤
│        │   Mon    │   Tue    │   Wed    │   Thu    │   Fri    │  Sat   │  Sun  │
│        │  Jan 27  │  Jan 28  │  Jan 29  │  Jan 30  │  Jan 31  │  Feb 1 │ Feb 2 │
├────────┼──────────┼──────────┼──────────┼──────────┼──────────┼────────┼───────┤
│ John D │  6A-2P   │   OFF    │  6A-2P   │  6A-2P   │   OFF    │ 5A-1P  │ 5A-1P │
│ Cook   │          │          │          │          │          │        │       │
├────────┼──────────┼──────────┼──────────┼──────────┼──────────┼────────┼───────┤
│ Maria S│   OFF    │  4P-CL   │  4P-CL   │   OFF    │  4P-CL   │ 4P-CL  │  OFF  │
│ Server │          │          │          │          │          │        │       │
├────────┼──────────┼──────────┼──────────┼──────────┼──────────┼────────┼───────┤
│ Alex T │  11A-7P  │  11A-7P  │   OFF    │  11A-7P  │ 11A-7P   │  OFF   │  OFF  │
│ Prep   │          │          │          │          │          │        │       │
└────────┴──────────┴──────────┴──────────┴──────────┴──────────┴────────┴───────┘
│ Generated Jan 26, 2026 at 3:45 PM                    Total: 142.5 hrs | 8 staff │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

### Phase 2: Export Dialog Component

**File: `src/components/scheduling/ScheduleExportDialog.tsx`**

A simple, focused dialog with:

1. **Visual preview** - Miniature representation of the output
2. **Minimal options**:
   - Include position labels (default: on)
   - Include hours summary (default: off)
3. **Two actions**: Cancel / Print

**Key Features:**
- Uses existing `Dialog` component from shadcn/ui
- Generates PDF using jsPDF (already installed)
- Landscape orientation for better fit
- Respects current position filter (if applied)

---

### Phase 3: Integrate into Scheduling Page

**File: `src/pages/Scheduling.tsx`**

Add a "Print Schedule" button next to existing actions:

```tsx
// In the header action buttons area (around line 624)
<Button variant="outline" onClick={() => setExportDialogOpen(true)}>
  <Printer className="h-4 w-4 mr-2" />
  Print Schedule
</Button>
```

Pass required data to dialog:
- `shifts` - Current week's shifts
- `employees` - Employee lookup
- `weekStart` / `weekEnd` - Date range
- `restaurantName` - For header
- `positionFilter` - Apply current filter

---

## PDF Generation Details

### Time Formatting (Kitchen-Friendly)

| Original | Kitchen Format |
|----------|----------------|
| 6:00 AM - 2:00 PM | 6A-2P |
| 4:00 PM - 11:00 PM | 4P-11P |
| 4:00 PM - 12:00 AM | 4P-CL |
| 5:00 AM - 11:00 AM | 5A-11A |

**"CL"** = Close (midnight or later) - common restaurant shorthand

### Color Coding (Optional, if printing in color)

| Status | Color |
|--------|-------|
| Scheduled shift | Black text |
| OFF day | Gray text, lighter background |
| Conflict | Yellow highlight |

For kitchen displays, we'll default to high-contrast black/white for clarity.

---

## Alternative: CSV Export (Manager Use)

For managers who want to manipulate data in spreadsheets, we can add a secondary CSV export option:

**Columns:**
- Employee Name
- Position
- Date
- Start Time
- End Time
- Hours
- Status

This uses the existing `exportToCSV` utility from the project.

---

## Summary of Changes

1. **Create** `src/utils/scheduleExport.ts` - PDF generation for schedule
2. **Create** `src/components/scheduling/ScheduleExportDialog.tsx` - Print dialog
3. **Modify** `src/pages/Scheduling.tsx` - Add Print button, state, and dialog

---

## Benefits

- **Zero cognitive load** - One button, one purpose
- **Kitchen-optimized** - Large text, compact format, landscape
- **Manager-friendly** - Hours summary, downloadable PDF
- **Consistent** - Matches existing export patterns in the app
- **Accessible** - High contrast, print-friendly
- **Fast** - Client-side PDF generation, no server round-trip

