# Employee FT/PT Employment Type & Date of Birth

## Problem

Managers need to distinguish full-time vs part-time employees for scheduling purposes. While employee availability captures *when* someone can work, FT/PT captures *how much* they should work per week. Not all employees fill out availability, so FT/PT provides a reliable planning signal for both manual and AI-powered scheduling.

Additionally, managers need to know when an employee is a minor so they can comply with state labor laws. A date of birth field enables the system to flag minors visually, positioning the platform for future AI-powered labor rule enforcement.

## Design

### Database

Single migration adding two columns to `employees`:

| Column | Type | Nullable | Default | Constraint |
|--------|------|----------|---------|------------|
| `employment_type` | `TEXT` | NOT NULL | `'full_time'` | `CHECK (employment_type IN ('full_time', 'part_time'))` |
| `date_of_birth` | `DATE` | YES | `NULL` | None |

- No new tables or RLS policies needed — existing employee-level RLS covers these columns.
- Default `'full_time'` means existing employees are automatically classified as FT without requiring backfill.

### Employee Dialog (EmployeeDialog.tsx)

**FT/PT segmented toggle:**
- Placed between Area and Compensation Type fields.
- Two-button toggle: "Full-Time" | "Part-Time". Defaults to Full-Time.
- Helper text below: "Used by the scheduler to plan weekly hours."
- Uses the same visual pattern as existing toggle elements in the dialog.

**Date of birth input:**
- Added as a third column in the existing Status / Hire Date row, making it a 3-column grid: Status | Hire Date | Date of Birth.
- Standard date input, optional (no asterisk, no required validation).
- When the computed age is under 18, an inline amber badge appears below the field: "Minor (N yrs)" using the project's standard badge styling (`text-[11px] px-1.5 py-0.5 rounded-md bg-amber-500/10 text-amber-600`).

**Form state additions:**
- `employmentType` state, initialized from `employee.employment_type` or `'full_time'`.
- `dateOfBirth` state, initialized from `employee.date_of_birth` or `''`.
- Both included in the `employeeData` payload for create/update.
- Both included in `resetForm()`.

### Employee List (EmployeeList.tsx)

- FT/PT badge displayed next to position text on each employee card. Uses subtle styling: `text-[11px] px-1.5 py-0.5 rounded-md bg-muted` showing "FT" or "PT".
- Minor badge (amber) shown when DOB indicates age < 18. Same badge style as the dialog: `bg-amber-500/10 text-amber-600`.

### Shift Planner Sidebar (EmployeeSidebar.tsx)

**New filter dropdown:**
- "Employment type" filter added alongside existing Area and Role filters.
- Options: "All types" | "Full-Time" | "Part-Time".
- Follows the same `Select` component pattern as existing filters.

**Employee chip updates:**
- The sidebar's local `Employee` interface gets `employment_type` and `date_of_birth` added.
- Minor badge shown on employee chips when applicable (amber dot or "Minor" text).
- `filterEmployees()` function extended with an `employmentType` parameter.

**Data flow:**
- `ShiftPlannerTab.tsx` already fetches full employee objects — `employment_type` and `date_of_birth` will flow through once the hook select includes them.

### AI Scheduler (schedule-prompt-builder.ts)

**ScheduleEmployee interface:**
```typescript
export interface ScheduleEmployee {
  id: string;
  name: string;
  position: string;
  area: string | null;
  hourly_rate: number; // cents
  employment_type: 'full_time' | 'part_time'; // NEW
}
```

**Prompt changes:**
- Employee data sent to AI includes `employment_type` field.
- New rule added to SYSTEM_PROMPT (rule 11):

> 11. Full-time employees should be scheduled for more shifts, targeting 35-40 hours per week. Part-time employees should be scheduled for fewer shifts, targeting 15-25 hours per week. When both full-time and part-time employees are available for a slot, prefer the full-time employee unless they are already near 40 hours for the week.

**What is NOT passed to AI:**
- `date_of_birth` is NOT included in `ScheduleEmployee` or the prompt. Minor status is UI-only for now. Future work will pass minor status to enable AI-powered labor rule enforcement per state.

### Edge Function (generate-schedule/index.ts)

- The employee query in the edge function adds `employment_type` to the select.
- Maps it into the `ScheduleEmployee` object passed to the prompt builder.

### TypeScript Types (types/scheduling.ts)

```typescript
export type EmploymentType = 'full_time' | 'part_time';

export interface Employee {
  // ... existing fields ...
  employment_type: EmploymentType;
  date_of_birth?: string;
}
```

### Hooks (useEmployees.tsx)

- No changes needed to `useEmployees` — it uses `select('*')` which will include the new columns automatically.
- The `useCreateEmployee` and `useUpdateEmployee` mutations already pass through the full payload.

### Minor Age Calculation

A pure utility function for computing age and minor status:

```typescript
// src/lib/employeeUtils.ts
export function computeAge(dateOfBirth: string): number {
  const today = new Date();
  const dob = new Date(dateOfBirth);
  let age = today.getFullYear() - dob.getFullYear();
  const monthDiff = today.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
    age--;
  }
  return age;
}

export function isMinor(dateOfBirth: string | null | undefined): boolean {
  if (!dateOfBirth) return false;
  return computeAge(dateOfBirth) < 18;
}
```

This is used by EmployeeDialog, EmployeeList, and EmployeeSidebar for badge rendering. No database-level age computation needed.

## Testing

### pgTAP Tests
- `employment_type` defaults to `'full_time'` when not specified.
- `employment_type` CHECK constraint rejects invalid values (e.g., `'contractor'`).
- `date_of_birth` accepts valid dates and NULL.
- Existing employees retain `'full_time'` after migration.

### Unit Tests
- `computeAge()` — various DOB values, edge cases (birthday today, leap year).
- `isMinor()` — under 18, exactly 18, over 18, null/undefined.
- `filterEmployees()` — with employment type filter parameter.
- `buildSchedulePrompt()` — employment_type appears in generated prompt.

### E2E Test
- Create employee with PT toggle and DOB that makes them a minor.
- Verify "Minor" badge appears in the employee dialog and list.
- Verify FT/PT filter works in shift planner sidebar.

## Out of Scope

- State-specific minor labor rules and automatic availability restrictions (future feature).
- Passing DOB or minor status to the AI scheduler (future feature).
- Target hours configuration per FT/PT (using hardcoded ranges in AI prompt for now — 35-40h FT, 15-25h PT).
- Overtime/benefits implications of FT/PT classification (this is a scheduling hint only, not a legal classification tool).
