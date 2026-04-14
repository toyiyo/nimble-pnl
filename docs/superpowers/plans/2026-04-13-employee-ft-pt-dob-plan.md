# Employee FT/PT & DOB Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add employment type (full-time/part-time) and date of birth fields to employees, with scheduler filtering, AI prompt integration, and minor badge display.

**Architecture:** Two new columns on the `employees` table. A pure utility for age/minor calculation. UI updates to EmployeeDialog (FT/PT toggle + DOB input), EmployeeList (badges), EmployeeSidebar (FT/PT filter + minor badge). AI prompt builder gets a new rule for FT/PT hour targeting.

**Tech Stack:** PostgreSQL (migration), React, TypeScript, Vitest, pgTAP, Playwright

---

### Task 1: Database Migration

**Files:**
- Create: `supabase/migrations/20260413100000_add_employee_employment_type_dob.sql`
- Test: `supabase/tests/employee_employment_type_dob.sql`

- [ ] **Step 1: Write the pgTAP test file**

```sql
-- supabase/tests/employee_employment_type_dob.sql
BEGIN;
SELECT plan(7);

-- Test 1: employment_type column exists with default
SELECT has_column('public', 'employees', 'employment_type',
  'employees table should have employment_type column');

-- Test 2: date_of_birth column exists
SELECT has_column('public', 'employees', 'date_of_birth',
  'employees table should have date_of_birth column');

-- Test 3: employment_type defaults to full_time
INSERT INTO employees (id, restaurant_id, name, position, hourly_rate, compensation_type)
VALUES (
  'aaaaaaaa-0000-0000-0000-000000000001',
  (SELECT id FROM restaurants LIMIT 1),
  'Test Default FT',
  'Server',
  1500,
  'hourly'
);
SELECT is(
  (SELECT employment_type FROM employees WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  'full_time',
  'employment_type should default to full_time'
);

-- Test 4: Can set employment_type to part_time
UPDATE employees SET employment_type = 'part_time'
WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001';
SELECT is(
  (SELECT employment_type FROM employees WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  'part_time',
  'employment_type should accept part_time'
);

-- Test 5: CHECK constraint rejects invalid values
SELECT throws_ok(
  $$UPDATE employees SET employment_type = 'contractor'
    WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001'$$,
  '23514',
  NULL,
  'employment_type should reject invalid values'
);

-- Test 6: date_of_birth accepts valid date
UPDATE employees SET date_of_birth = '2008-06-15'
WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001';
SELECT is(
  (SELECT date_of_birth FROM employees WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  '2008-06-15'::DATE,
  'date_of_birth should accept valid date'
);

-- Test 7: date_of_birth accepts NULL
UPDATE employees SET date_of_birth = NULL
WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001';
SELECT is(
  (SELECT date_of_birth FROM employees WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  NULL::DATE,
  'date_of_birth should accept NULL'
);

-- Cleanup
DELETE FROM employees WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001';

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 2: Run pgTAP tests to verify they fail**

Run: `npm run test:db`
Expected: FAIL — columns don't exist yet.

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260413100000_add_employee_employment_type_dob.sql

-- Add employment type (full-time or part-time) for scheduling
ALTER TABLE employees
  ADD COLUMN employment_type TEXT NOT NULL DEFAULT 'full_time'
  CHECK (employment_type IN ('full_time', 'part_time'));

-- Add optional date of birth for minor detection
ALTER TABLE employees
  ADD COLUMN date_of_birth DATE;

-- Comment for documentation
COMMENT ON COLUMN employees.employment_type IS 'full_time or part_time — used by scheduler for weekly hour targeting';
COMMENT ON COLUMN employees.date_of_birth IS 'Optional DOB for minor detection (age < 18)';
```

- [ ] **Step 4: Reset database and run pgTAP tests**

Run: `npm run db:reset && npm run test:db`
Expected: All 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260413100000_add_employee_employment_type_dob.sql supabase/tests/employee_employment_type_dob.sql
git commit -m "feat: add employment_type and date_of_birth columns to employees"
```

---

### Task 2: TypeScript Types & Utility Functions

**Files:**
- Modify: `src/types/scheduling.ts:1-5` (add type alias) and `src/types/scheduling.ts:18-72` (add fields to Employee interface)
- Create: `src/lib/employeeUtils.ts`
- Create: `tests/unit/employeeUtils.test.ts`

- [ ] **Step 1: Write the unit tests for age/minor utilities**

```typescript
// tests/unit/employeeUtils.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { computeAge, isMinor } from '@/lib/employeeUtils';

describe('computeAge', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('computes age for a past birthday this year', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-15'));
    expect(computeAge('1990-03-10')).toBe(36);
  });

  it('computes age when birthday has not yet occurred this year', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-01'));
    expect(computeAge('1990-03-10')).toBe(35);
  });

  it('computes age on the exact birthday', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-10'));
    expect(computeAge('1990-03-10')).toBe(36);
  });

  it('handles leap year birthday (Feb 29)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-01'));
    expect(computeAge('2008-02-29')).toBe(17);
  });
});

describe('isMinor', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns true for age under 18', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-13'));
    expect(isMinor('2010-06-15')).toBe(true);
  });

  it('returns false for exactly 18', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-13'));
    expect(isMinor('2008-04-13')).toBe(false);
  });

  it('returns false for over 18', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-13'));
    expect(isMinor('1990-01-01')).toBe(false);
  });

  it('returns false for null', () => {
    expect(isMinor(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isMinor(undefined)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/employeeUtils.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the utility file**

```typescript
// src/lib/employeeUtils.ts

/**
 * Compute age in whole years from a date-of-birth string (YYYY-MM-DD).
 */
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

/**
 * Returns true if the employee is under 18 based on their DOB.
 */
export function isMinor(dateOfBirth: string | null | undefined): boolean {
  if (!dateOfBirth) return false;
  return computeAge(dateOfBirth) < 18;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/employeeUtils.test.ts`
Expected: All 9 tests PASS.

- [ ] **Step 5: Update TypeScript types**

In `src/types/scheduling.ts`, add the type alias after line 5 (after `DeactivationReason`):

```typescript
export type EmploymentType = 'full_time' | 'part_time';
```

In the `Employee` interface, add these two fields after `is_exempt` (after line 68):

```typescript
  // Employment classification
  employment_type: EmploymentType;
  date_of_birth?: string; // YYYY-MM-DD, optional
```

- [ ] **Step 6: Run typecheck**

Run: `npm run typecheck`
Expected: No new errors (existing fields are optional in form code, and the hook returns `*` which includes the new columns).

- [ ] **Step 7: Commit**

```bash
git add src/lib/employeeUtils.ts tests/unit/employeeUtils.test.ts src/types/scheduling.ts
git commit -m "feat: add EmploymentType, date_of_birth types and age utility"
```

---

### Task 3: Employee Dialog — FT/PT Toggle & DOB Input

**Files:**
- Modify: `src/components/EmployeeDialog.tsx`

- [ ] **Step 1: Add state variables**

After the existing `const [area, setArea] = useState('');` (line 48), add:

```typescript
  const [employmentType, setEmploymentType] = useState<'full_time' | 'part_time'>('full_time');
  const [dateOfBirth, setDateOfBirth] = useState('');
```

- [ ] **Step 2: Add to employee loading (useEffect)**

In the `if (employee)` block (around line 120), after `setArea(employee.area || '');` (line 126), add:

```typescript
      setEmploymentType(employee.employment_type || 'full_time');
      setDateOfBirth(employee.date_of_birth || '');
```

- [ ] **Step 3: Add to resetForm()**

In `resetForm()` (around line 152), after `setArea('');` (line 157), add:

```typescript
    setEmploymentType('full_time');
    setDateOfBirth('');
```

- [ ] **Step 4: Add to employeeData payload**

In the `employeeData` object inside `proceedWithSubmit()` (around line 400), after `area: area.trim() || null,` (line 406), add:

```typescript
      employment_type: employmentType,
      date_of_birth: dateOfBirth || null,
```

- [ ] **Step 5: Add FT/PT segmented toggle to the form**

After the Area field's closing `</div>` (after line 556, which is the area `space-y-2` div), add:

```tsx
              {/* Employment Type Toggle */}
              <div className="space-y-2">
                <Label className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                  Employment Type
                </Label>
                <div className="flex rounded-lg border border-border/40 overflow-hidden w-fit">
                  <button
                    type="button"
                    onClick={() => setEmploymentType('full_time')}
                    className={cn(
                      'px-4 py-2 text-[13px] font-medium transition-colors',
                      employmentType === 'full_time'
                        ? 'bg-foreground text-background'
                        : 'bg-background text-muted-foreground hover:text-foreground'
                    )}
                    aria-label="Full-time employment"
                    aria-pressed={employmentType === 'full_time'}
                  >
                    Full-Time
                  </button>
                  <button
                    type="button"
                    onClick={() => setEmploymentType('part_time')}
                    className={cn(
                      'px-4 py-2 text-[13px] font-medium transition-colors border-l border-border/40',
                      employmentType === 'part_time'
                        ? 'bg-foreground text-background'
                        : 'bg-background text-muted-foreground hover:text-foreground'
                    )}
                    aria-label="Part-time employment"
                    aria-pressed={employmentType === 'part_time'}
                  >
                    Part-Time
                  </button>
                </div>
                <p className="text-[12px] text-muted-foreground">
                  Used by the scheduler to plan weekly hours
                </p>
              </div>
```

Note: Import `cn` is already imported at the top of the file. Verify by checking for `import { cn }` — if not present, add: `import { cn } from '@/lib/utils';`

- [ ] **Step 6: Add DOB input to the Status/Hire Date row**

Find the grid with Status and Hire Date (around line 897):

```tsx
              <div className="grid grid-cols-2 gap-4">
```

Change it to a 3-column grid and add the DOB field:

```tsx
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="status">Status</Label>
                  <Select value={status} onValueChange={(value) => setStatus(value as typeof status)}>
                    <SelectTrigger id="status" aria-label="Employee status">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="inactive">Inactive</SelectItem>
                      <SelectItem value="terminated">Terminated</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="hireDate">Hire Date</Label>
                  <Input
                    id="hireDate"
                    type="date"
                    value={hireDate}
                    onChange={(e) => setHireDate(e.target.value)}
                    aria-label="Hire date"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="dateOfBirth">Date of Birth</Label>
                  <Input
                    id="dateOfBirth"
                    type="date"
                    value={dateOfBirth}
                    onChange={(e) => setDateOfBirth(e.target.value)}
                    aria-label="Date of birth"
                  />
                  {dateOfBirth && isMinor(dateOfBirth) && (
                    <span className="text-[11px] px-1.5 py-0.5 rounded-md bg-amber-500/10 text-amber-600 font-medium inline-block">
                      Minor ({computeAge(dateOfBirth)} yrs)
                    </span>
                  )}
                </div>
              </div>
```

Add the import at the top of the file:

```typescript
import { computeAge, isMinor } from '@/lib/employeeUtils';
```

- [ ] **Step 7: Verify the dialog renders correctly**

Run: `npm run dev`
Open the app, navigate to Employees, click "Add Employee". Verify:
- FT/PT toggle appears between Area and Compensation Type
- DOB field appears in the Status/Hire Date row
- Entering a minor's DOB shows the amber badge
- Toggling FT/PT works

- [ ] **Step 8: Commit**

```bash
git add src/components/EmployeeDialog.tsx
git commit -m "feat: add FT/PT toggle and DOB input to employee dialog"
```

---

### Task 4: Employee List — Badges

**Files:**
- Modify: `src/components/EmployeeList.tsx:288-291` (employee info section)

- [ ] **Step 1: Add import**

At the top of `EmployeeList.tsx`, add:

```typescript
import { isMinor } from '@/lib/employeeUtils';
```

- [ ] **Step 2: Add FT/PT and Minor badges to employee card**

In `EmployeeCard`, find the position/compensation line (around line 288-291):

```tsx
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className="truncate">{employee.position}</span>
              <span>•</span>
              <span className="shrink-0">{getCompensationDisplay()}</span>
            </div>
```

Replace with:

```tsx
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className="truncate">{employee.position}</span>
              <span className="text-[11px] px-1.5 py-0.5 rounded-md bg-muted shrink-0">
                {employee.employment_type === 'part_time' ? 'PT' : 'FT'}
              </span>
              {isMinor(employee.date_of_birth) && (
                <span className="text-[11px] px-1.5 py-0.5 rounded-md bg-amber-500/10 text-amber-600 font-medium shrink-0">
                  Minor
                </span>
              )}
              <span>•</span>
              <span className="shrink-0">{getCompensationDisplay()}</span>
            </div>
```

- [ ] **Step 3: Verify the badges render**

Run: `npm run dev`
Open the app, navigate to Employees. Check that FT/PT badges appear. If you have a test employee with a minor DOB, verify the amber "Minor" badge shows.

- [ ] **Step 4: Commit**

```bash
git add src/components/EmployeeList.tsx
git commit -m "feat: add FT/PT and Minor badges to employee list"
```

---

### Task 5: Shift Planner Sidebar — Filter & Badge

**Files:**
- Modify: `src/components/scheduling/ShiftPlanner/EmployeeSidebar.tsx`
- Create: `tests/unit/employeeSidebarFilter.test.ts`

- [ ] **Step 1: Write the filter test**

```typescript
// tests/unit/employeeSidebarFilter.test.ts
import { describe, it, expect } from 'vitest';
import { filterEmployees } from '@/components/scheduling/ShiftPlanner/EmployeeSidebar';

describe('filterEmployees with employment type', () => {
  const employees = [
    { id: '1', name: 'Alice', position: 'Server', area: 'FOH', employment_type: 'full_time' as const },
    { id: '2', name: 'Bob', position: 'Cook', area: 'BOH', employment_type: 'part_time' as const },
    { id: '3', name: 'Carol', position: 'Server', area: 'FOH', employment_type: 'part_time' as const },
  ];

  it('returns all when employmentType is "all"', () => {
    const result = filterEmployees(employees, '', 'all', 'all', 'all');
    expect(result).toHaveLength(3);
  });

  it('filters to full_time only', () => {
    const result = filterEmployees(employees, '', 'all', 'all', 'full_time');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Alice');
  });

  it('filters to part_time only', () => {
    const result = filterEmployees(employees, '', 'all', 'all', 'part_time');
    expect(result).toHaveLength(2);
    expect(result.map((e) => e.name)).toEqual(['Bob', 'Carol']);
  });

  it('combines employment type with role filter', () => {
    const result = filterEmployees(employees, '', 'all', 'Server', 'part_time');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Carol');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/employeeSidebarFilter.test.ts`
Expected: FAIL — `filterEmployees` signature doesn't accept 5th arg.

- [ ] **Step 3: Update the Employee interface and filterEmployees function**

In `EmployeeSidebar.tsx`, update the local `Employee` interface (around line 22):

```typescript
interface Employee {
  id: string;
  name: string;
  position: string | null;
  area?: string;
  employment_type?: 'full_time' | 'part_time';
  date_of_birth?: string;
}
```

Update the `filterEmployees` function (around line 28):

```typescript
export function filterEmployees(
  employees: Employee[],
  search: string,
  area: string,
  role: string,
  employmentType: string = 'all',
): Employee[] {
  const q = search.toLowerCase();
  return employees.filter((e) => {
    if (q && !e.name.toLowerCase().includes(q)) return false;
    if (area !== 'all' && e.area !== area) return false;
    if (role !== 'all' && e.position !== role) return false;
    if (employmentType !== 'all' && e.employment_type !== employmentType) return false;
    return true;
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/employeeSidebarFilter.test.ts`
Expected: All 4 tests PASS.

- [ ] **Step 5: Add employment type filter dropdown and minor badge to the sidebar**

Add the import at the top:

```typescript
import { isMinor } from '@/lib/employeeUtils';
```

Add state for employment type filter. After `const [role, setRole] = useState('all');` (line 140):

```typescript
  const [empType, setEmpType] = useState('all');
```

Update the `filtered` useMemo to pass the new filter. Find the existing call (around line 195):

```typescript
  const filtered = useMemo(
    () => filterEmployees(employees, search, effectiveArea, role, empType),
    [employees, search, effectiveArea, role, empType],
  );
```

Add the filter dropdown in the sticky header, after the role filter's closing `)}` (after line 257):

```tsx
        <Select value={empType} onValueChange={setEmpType}>
          <SelectTrigger
            className="h-8 text-[13px] bg-muted/30 border-border/40 rounded-lg"
            aria-label="Filter by employment type"
          >
            <SelectValue placeholder="All types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            <SelectItem value="full_time">Full-Time</SelectItem>
            <SelectItem value="part_time">Part-Time</SelectItem>
          </SelectContent>
        </Select>
```

Add minor badge to `DraggableEmployee`. After the position text (around line 118):

```tsx
        {employee.position && (
          <div className="flex items-center gap-1">
            <p className="text-[11px] text-muted-foreground truncate">
              {employee.position}
            </p>
            {isMinor(employee.date_of_birth) && (
              <span className="text-[10px] px-1 py-0.5 rounded bg-amber-500/10 text-amber-600 font-medium shrink-0">
                Minor
              </span>
            )}
          </div>
        )}
```

This replaces the existing position paragraph (lines 116-119):

```tsx
        {employee.position && (
          <p className="text-[11px] text-muted-foreground truncate">
            {employee.position}
          </p>
        )}
```

Update the `DraggableEmployee` memo comparison (around line 125) to include the new fields:

```typescript
  (prev, next) =>
    prev.employee.id === next.employee.id &&
    prev.employee.name === next.employee.name &&
    prev.employee.position === next.employee.position &&
    prev.employee.date_of_birth === next.employee.date_of_birth &&
    prev.shiftCount === next.shiftCount &&
    prev.hours === next.hours &&
    prev.onSelect === next.onSelect,
```

- [ ] **Step 6: Verify in the browser**

Run: `npm run dev`
Navigate to Scheduling > Shift Planner. Verify:
- Employment type filter dropdown appears in the sidebar
- Filtering by FT/PT works
- Minor badge appears on employees with minor DOB

- [ ] **Step 7: Commit**

```bash
git add src/components/scheduling/ShiftPlanner/EmployeeSidebar.tsx tests/unit/employeeSidebarFilter.test.ts
git commit -m "feat: add FT/PT filter and minor badge to shift planner sidebar"
```

---

### Task 6: AI Scheduler — Prompt Integration

**Files:**
- Modify: `supabase/functions/_shared/schedule-prompt-builder.ts:9-15` (ScheduleEmployee interface) and `supabase/functions/_shared/schedule-prompt-builder.ts:68-82` (SYSTEM_PROMPT)
- Modify: `supabase/functions/generate-schedule/index.ts:117` (employee select) and `supabase/functions/generate-schedule/index.ts:212-219` (employee mapping)
- Create: `tests/unit/schedulePromptBuilder.test.ts`

- [ ] **Step 1: Write the prompt builder test**

```typescript
// tests/unit/schedulePromptBuilder.test.ts
import { describe, it, expect } from 'vitest';
import { buildSchedulePrompt, ScheduleContext } from '../../supabase/functions/_shared/schedule-prompt-builder';

describe('buildSchedulePrompt with employment_type', () => {
  const baseContext: ScheduleContext = {
    weekStart: '2026-04-13',
    employees: [
      { id: '1', name: 'Alice', position: 'Server', area: null, hourly_rate: 1500, employment_type: 'full_time' },
      { id: '2', name: 'Bob', position: 'Cook', area: null, hourly_rate: 1800, employment_type: 'part_time' },
    ],
    templates: [],
    availability: {},
    staffingSettings: null,
    priorSchedulePatterns: [],
    hourlySalesPatterns: [],
    weeklyBudgetTarget: null,
    lockedShifts: [],
  };

  it('includes employment_type in employee data', () => {
    const result = buildSchedulePrompt(baseContext);
    const userMessage = result.messages[1].content;
    expect(userMessage).toContain('"employment_type": "full_time"');
    expect(userMessage).toContain('"employment_type": "part_time"');
  });

  it('includes FT/PT scheduling rule in system prompt', () => {
    const result = buildSchedulePrompt(baseContext);
    const systemMessage = result.messages[0].content;
    expect(systemMessage).toContain('Full-time');
    expect(systemMessage).toContain('Part-time');
    expect(systemMessage).toContain('35-40 hours');
    expect(systemMessage).toContain('15-25 hours');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/schedulePromptBuilder.test.ts`
Expected: FAIL — `employment_type` not in interface or output.

- [ ] **Step 3: Update ScheduleEmployee interface**

In `supabase/functions/_shared/schedule-prompt-builder.ts`, update the `ScheduleEmployee` interface (lines 9-15):

```typescript
export interface ScheduleEmployee {
  id: string;
  name: string;
  position: string;
  area: string | null;
  hourly_rate: number; // cents
  employment_type: 'full_time' | 'part_time';
}
```

- [ ] **Step 4: Update SYSTEM_PROMPT with FT/PT rule**

In the `SYSTEM_PROMPT` constant (lines 68-82), add rule 11 after rule 10:

```typescript
const SYSTEM_PROMPT = `You are a restaurant schedule optimizer. Your job is to create an optimal weekly shift schedule.

RULES:
1. ONLY use the provided shift templates as shift blocks — do not invent custom time ranges.
2. ONLY assign employees to templates matching their position.
3. When a template has an area set, PREFER assigning employees from the same area. Only assign employees from a different area to that template if no same-area employees are available for that time slot. This is a soft preference — cross-area assignments are allowed as a fallback.
4. ONLY assign employees on days/times they are available.
5. Do NOT assign any employee more than once in the same time slot (no double-booking).
6. Do NOT modify or reassign any locked shifts — they are fixed.
7. Weight staffing toward peak sales hours — more staff during lunch/dinner rushes.
8. If staffing settings specify minimum crew per position, meet those minimums when possible.
9. If no staffing settings exist, use prior schedule patterns to infer typical staffing levels.
10. Try to stay within the weekly labor budget target. If adequate coverage requires exceeding it, note the variance.
11. Full-time employees should be scheduled for more shifts, targeting 35-40 hours per week. Part-time employees should be scheduled for fewer shifts, targeting 15-25 hours per week. When both full-time and part-time employees are available for a slot, prefer the full-time employee unless they are already near 40 hours for the week.

Return valid JSON only, matching the provided schema exactly.`;
```

- [ ] **Step 5: Update buildUserPrompt to include employment_type**

In the `buildUserPrompt` function, update the `employeesForPrompt` mapping (around line 132):

```typescript
  const employeesForPrompt = ctx.employees.map((e) => ({
    id: e.id,
    name: e.name,
    position: e.position,
    area: e.area ?? 'unassigned',
    hourly_rate_dollars: (e.hourly_rate / 100).toFixed(2),
    employment_type: e.employment_type,
  }));
```

- [ ] **Step 6: Update the edge function to select and map employment_type**

In `supabase/functions/generate-schedule/index.ts`, update the employee select query (line 117):

```typescript
        .select("id, name, position, area, hourly_rate, salary_amount, compensation_type, employment_type")
```

Update the employee mapping (around line 212):

```typescript
    const employees: ScheduleEmployee[] = activeEmployees.map((e) => ({
      id: e.id,
      name: e.name,
      position: e.position ?? "Staff",
      area: e.area ?? null,
      hourly_rate: e.compensation_type === "salary" ? 0 : (e.hourly_rate ?? 0),
      employment_type: e.employment_type ?? "full_time",
    }));
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `npx vitest run tests/unit/schedulePromptBuilder.test.ts`
Expected: All 2 tests PASS.

- [ ] **Step 8: Commit**

```bash
git add supabase/functions/_shared/schedule-prompt-builder.ts supabase/functions/generate-schedule/index.ts tests/unit/schedulePromptBuilder.test.ts
git commit -m "feat: add employment_type to AI schedule prompt for FT/PT hour targeting"
```

---

### Task 7: E2E Test

**Files:**
- Create: `tests/e2e/employee-ft-pt-dob.spec.ts`

- [ ] **Step 1: Write the E2E test**

```typescript
// tests/e2e/employee-ft-pt-dob.spec.ts
import { test, expect } from '@playwright/test';
import { generateTestUser } from '../helpers/e2e-supabase';

test.describe('Employee FT/PT and DOB', () => {
  test('can create a part-time minor employee and see badges', async ({ page }) => {
    const testUser = generateTestUser();

    // Navigate to employees page (assumes auth is handled by test setup)
    await page.goto('/employees');

    // Open add employee dialog
    await page.getByRole('button', { name: /add/i }).click();

    // Fill basic info
    await page.getByLabel('Employee name').fill('Test Minor PT');
    await page.getByLabel('Employee name').press('Tab');

    // Toggle to Part-Time
    await page.getByRole('button', { name: 'Part-time employment' }).click();

    // Verify PT button is pressed
    await expect(page.getByRole('button', { name: 'Part-time employment' })).toHaveAttribute('aria-pressed', 'true');

    // Fill DOB for a minor (16 years old)
    const minorDob = new Date();
    minorDob.setFullYear(minorDob.getFullYear() - 16);
    const dobStr = minorDob.toISOString().split('T')[0];
    await page.getByLabel('Date of birth').fill(dobStr);

    // Verify minor badge appears in dialog
    await expect(page.getByText(/Minor \(\d+ yrs\)/)).toBeVisible();

    // Fill required compensation field
    await page.getByLabel('Hourly rate in dollars').fill('12.00');

    // Submit
    await page.getByRole('button', { name: /add employee/i }).click();

    // Wait for dialog to close
    await expect(page.getByRole('dialog')).toBeHidden({ timeout: 5000 });

    // Verify badges appear in the employee list
    await expect(page.getByText('Test Minor PT')).toBeVisible();
    await expect(page.getByText('PT')).toBeVisible();
    await expect(page.getByText('Minor')).toBeVisible();
  });
});
```

- [ ] **Step 2: Run the E2E test**

Run: `npx playwright test tests/e2e/employee-ft-pt-dob.spec.ts`
Expected: PASS (after the previous tasks are complete and dev server is running).

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/employee-ft-pt-dob.spec.ts
git commit -m "test: add E2E test for employee FT/PT toggle and DOB minor badge"
```

---

### Task 8: Final Verification

- [ ] **Step 1: Run full test suite**

Run: `npm run test`
Expected: All unit tests PASS.

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: No new errors.

- [ ] **Step 3: Run lint**

Run: `npm run lint`
Expected: No new errors (pre-existing ones are fine).

- [ ] **Step 4: Run build**

Run: `npm run build`
Expected: Successful build.

- [ ] **Step 5: Run pgTAP tests**

Run: `npm run test:db`
Expected: All tests PASS including the new ones.
