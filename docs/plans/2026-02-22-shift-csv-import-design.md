# Shift CSV Import Design

**Date:** 2026-02-22
**Status:** Approved

## Overview

Allow managers to import shift schedules from CSV files, supporting both Sling's weekly calendar grid format and generic row-per-shift CSVs from other tools (7shifts, Homebase, etc.). Follows the established multi-step import pattern from TimePunchUploadSheet.

## Requirements

- Auto-detect Sling grid format vs. generic flat CSV
- Fuzzy employee name matching with manual override
- Auto-create new employees for unmatched names
- Detect and skip duplicate/overlapping shifts
- Block imports into published/locked weeks
- TDD approach for all parsers and matching logic

## Architecture

### Approach: Multi-Step Sheet (like TimePunchUploadSheet)

**Flow:** Upload → Column Mapping (generic only) → Employee Review → Preview → Import

### File Structure

```
src/
├── components/scheduling/
│   ├── ShiftImportSheet.tsx          # Main multi-step sheet component
│   ├── ShiftImportEmployeeReview.tsx # Employee matching review UI
│   └── ShiftImportPreview.tsx        # Preview table with validation
├── utils/
│   ├── slingCsvParser.ts             # Sling grid format parser
│   └── shiftColumnMapping.ts         # Generic shift CSV mapping heuristics
└── hooks/
    └── useBulkCreateShifts.ts        # Bulk shift insert mutation
```

## Design Sections

### 1. Sling CSV Parser

The Sling export is a weekly calendar grid:
- Row 1: empty cell + 7 date columns (YYYY-MM-DD)
- Rows 2-5: section headers ("Unassigned shifts", "Available shifts", "Scheduled shifts") with empty data
- Data rows: employee name in column A, shift data in columns B-H

Shift cell format (multi-line):
```
"10:00 AM - 11:00 PM • 13h\nServer • San Antonio\n "
```

Parser logic (`parseSlingCSV`):
1. Extract 7 dates from row 1
2. Skip section headers (rows with "Unassigned", "Available", "Scheduled" and no shift data)
3. For each data row: extract employee name from column A
4. For each date column: parse cell with regex for time range, position, location
5. Handle multiple shifts per cell (split on double-newline)
6. Combine date + time into ISO timestamps; handle overnight shifts (end < start → +1 day)
7. Output: `ParsedShift[]`

Format detection (`isSlingFormat`): Check row 1 for date-like values in columns B-H and presence of multi-line shift patterns in data rows.

### 2. Generic Flat CSV + Column Mapping

Target fields:
```
employee_name | employee_id | date | start_time | end_time |
start_datetime | end_datetime | position | break_duration | notes
```

Auto-mapping keyword heuristics (following csvColumnMapping.ts pattern):
- `employee_name`: ["employee", "name", "staff", "worker", "team member"]
- `date`: ["date", "day", "shift date"]
- `start_time`: ["start", "clock in", "begin", "in time"]
- `end_time`: ["end", "clock out", "finish", "out time"]
- `position`: ["position", "role", "job", "department", "station"]
- `break_duration`: ["break", "lunch", "rest"]

Uses existing `ColumnMappingDialog` pattern. Supports template save/load via `csv_mapping_templates`.

Parsing rules:
- Separate date + time columns → combine into ISO timestamps
- Combined datetime columns → parse directly
- Overnight detection: end time < start time → add 1 day to end
- Break duration: parse as minutes (strip unit suffixes)

### 3. Employee Matching & Creation

Reuses `timePunchImport.ts` normalization patterns:

1. Normalize names: lowercase, strip extra spaces, remove special chars
2. Build lookup map from existing employees with variants: "john smith", "smith john", "smith, john"
3. Match each CSV employee against lookup
4. Confidence levels:
   - **Exact**: normalized match → auto-link
   - **Partial**: first/last name matches → suggest with low-confidence badge
   - **None**: no match → mark as "New employee"

Employee Review Screen — table with columns:

| CSV Name | Status | Matched To | Position | Action |
|---|---|---|---|---|
| Abraham Dominguez | Matched (green) | Abraham Dominguez | Server | [Change] |
| Gaspar Chef Vidanez | Unmatched (amber) | — | Kitchen Manager | [Link Existing ▾] [Create New] |

- Bulk "Create All Unmatched" button
- New employees: name from CSV (cleaned), position from most frequent CSV position, status: active, compensation_type: hourly, hourly_rate: 0

### 4. Preview, Validation & Import

Summary card:
- Total shifts, total hours, new employees to create, duplicates to skip, published-week conflicts

Shift table grouped by date with status badges:
- **Ready** (green): will import
- **Duplicate** (amber): overlapping shift exists, skipped (checkbox to force)
- **Published** (red): target week is locked, blocked
- **Skipped** (gray): employee not matched and skipped

Validation rules:
1. Duration > 0 and < 24 hours
2. End time after start time (overnight handled)
3. Employee must be matched or marked for creation
4. Target date not in published/locked week
5. No exact duplicate (same employee + same start/end)

Import execution:
1. Bulk create new employees
2. Bulk insert shifts with new employee IDs
3. All shifts: `status: 'scheduled'`, `is_published: false`, `locked: false`
4. Invalidate React Query caches (`['shifts']`, `['employees']`)
5. Success toast: "Imported X shifts for Y employees"

## UI Location

Import button on the Scheduling page (`src/pages/Scheduling.tsx`), opens the ShiftImportSheet.

## Data Types

```typescript
interface ParsedShift {
  employeeName: string;
  startTime: string;  // ISO 8601
  endTime: string;    // ISO 8601
  position: string;
  location?: string;
  breakDuration?: number; // minutes
  notes?: string;
}

interface ShiftImportEmployee {
  csvName: string;
  normalizedName: string;
  matchedEmployeeId: string | null;
  matchedEmployeeName: string | null;
  matchConfidence: 'exact' | 'partial' | 'none';
  csvPosition: string;
  action: 'link' | 'create' | 'skip';
}

interface ShiftImportPreview {
  shifts: Array<ParsedShift & {
    employeeId: string | null;
    status: 'ready' | 'duplicate' | 'published' | 'skipped';
    existingShiftId?: string;
  }>;
  summary: {
    totalShifts: number;
    totalHours: number;
    readyCount: number;
    duplicateCount: number;
    publishedCount: number;
    skippedCount: number;
    newEmployeesCount: number;
  };
}
```

## Testing Strategy (TDD)

Unit tests for:
- Sling CSV parser (format detection, cell parsing, overnight shifts, multi-shift cells)
- Generic column mapping heuristics
- Employee name normalization and matching
- Duplicate/overlap detection
- Validation rules

Integration tests for:
- Full import flow (parse → match → preview → insert)
- Bulk employee creation + shift insertion
