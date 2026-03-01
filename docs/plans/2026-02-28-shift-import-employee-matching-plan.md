# Shift Import Employee Matching — Edge Case Fixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix 6 edge cases in shift import employee matching that cause imported shifts to be assigned to wrong employees.

**Architecture:** Fix `normalizeEmployeeKey` to handle accented characters. Change partial matches from auto-linking to suggestion-only. Fix map collisions in `buildEmployeeLookup`. Raise partial match threshold. Update UI to show "Did you mean?" instead of pre-selecting.

**Tech Stack:** TypeScript, Vitest, React

---

### Task 1: Add edge case tests for `normalizeEmployeeKey`

**Files:**
- Modify: `tests/unit/shiftEmployeeMatching.test.ts`

**Step 1: Write failing tests for accent normalization**

Add these tests after the existing test suite (after line 85):

```typescript
import { normalizeEmployeeKey } from '@/utils/timePunchImport';

describe('normalizeEmployeeKey — accent handling', () => {
  it('normalizes accented characters to ASCII equivalents', () => {
    expect(normalizeEmployeeKey('García')).toBe('garcia');
    expect(normalizeEmployeeKey('José')).toBe('jose');
    expect(normalizeEmployeeKey('Müller')).toBe('muller');
    expect(normalizeEmployeeKey('François')).toBe('francois');
  });

  it('matches accented and non-accented versions of the same name', () => {
    expect(normalizeEmployeeKey('María García')).toBe(normalizeEmployeeKey('Maria Garcia'));
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npm run test -- tests/unit/shiftEmployeeMatching.test.ts`
Expected: FAIL — "García" currently normalizes to "garc a" not "garcia"

**Step 3: Commit failing tests**

```bash
git add tests/unit/shiftEmployeeMatching.test.ts
git commit -m "test: add failing tests for accent normalization in employee matching"
```

---

### Task 2: Fix `normalizeEmployeeKey` to handle accented characters

**Files:**
- Modify: `src/utils/timePunchImport.ts:143-148`

**Step 1: Update `normalizeEmployeeKey` with Unicode NFD decomposition**

Replace lines 143-148:

```typescript
export const normalizeEmployeeKey = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
```

The `.normalize('NFD')` decomposes "é" into "e" + combining accent mark, then the `\u0300-\u036f` regex strips the combining marks.

**Step 2: Run tests to verify they pass**

Run: `npm run test -- tests/unit/shiftEmployeeMatching.test.ts`
Expected: ALL PASS — accented names now normalize correctly

**Step 3: Commit**

```bash
git add src/utils/timePunchImport.ts tests/unit/shiftEmployeeMatching.test.ts
git commit -m "fix: normalize accented characters in employee name matching"
```

---

### Task 3: Add tests for partial match behavior changes

**Files:**
- Modify: `tests/unit/shiftEmployeeMatching.test.ts`

**Step 1: Write failing tests for partial match edge cases**

Add inside the main `describe('shiftEmployeeMatching')` block:

```typescript
  describe('partial match safety', () => {
    it('partial matches set action to create, not link', () => {
      const csvNames = [
        { name: 'Gaspar Chef Vidanez', position: 'Kitchen Manager' },
      ];
      const result = matchEmployees(csvNames, employees);
      expect(result[0].matchConfidence).toBe('partial');
      expect(result[0].action).toBe('create');
      expect(result[0].matchedEmployeeId).toBeNull();
    });

    it('partial matches populate suggestion fields', () => {
      const csvNames = [
        { name: 'Gaspar Chef Vidanez', position: 'Kitchen Manager' },
      ];
      const result = matchEmployees(csvNames, employees);
      expect(result[0].suggestedEmployeeId).toBe('emp-2');
      expect(result[0].suggestedEmployeeName).toBe('Gaspar Vidanez');
    });

    it('does not cross-match employees sharing a surname', () => {
      const employeesWithSharedSurname = [
        makeEmployee('emp-a', 'Antonio Dominguez', 'Server'),
        makeEmployee('emp-b', 'Abraham Dominguez', 'Server'),
      ];
      const csvNames = [
        { name: 'Abraham Dominguez', position: 'Server' },
      ];
      const result = matchEmployees(csvNames, employeesWithSharedSurname);
      // Should be exact match to emp-b, NOT partial to emp-a
      expect(result[0].matchedEmployeeId).toBe('emp-b');
      expect(result[0].matchConfidence).toBe('exact');
    });

    it('rejects low-confidence partial matches below threshold', () => {
      // 2-of-3 words matching = 67%, below 0.8 threshold
      const threeWordEmployees = [
        makeEmployee('emp-x', 'José García López', 'Server'),
        makeEmployee('emp-y', 'María García Rodríguez', 'Server'),
      ];
      const csvNames = [
        { name: 'Carlos García López', position: 'Server' },
      ];
      const result = matchEmployees(csvNames, threeWordEmployees);
      // 2 of 3 words match emp-x ("garcia", "lopez") = 0.67, below 0.8 threshold
      expect(result[0].matchConfidence).toBe('none');
      expect(result[0].suggestedEmployeeId).toBeUndefined();
    });

    it('does not partial-match single-word CSV names', () => {
      const csvNames = [
        { name: 'Dominguez', position: 'Server' },
      ];
      const result = matchEmployees(csvNames, employees);
      // "dominguez" is only 1 word, needs >= 2 matching words
      expect(result[0].matchConfidence).toBe('none');
    });
  });
```

**Step 2: Run tests to verify they fail**

Run: `npm run test -- tests/unit/shiftEmployeeMatching.test.ts`
Expected: FAIL — partial matches currently set `action: 'link'` with `matchedEmployeeId`, and `suggestedEmployeeId` doesn't exist yet

**Step 3: Commit failing tests**

```bash
git add tests/unit/shiftEmployeeMatching.test.ts
git commit -m "test: add failing tests for partial match safety edge cases"
```

---

### Task 4: Update `ShiftImportEmployee` interface and partial match logic

**Files:**
- Modify: `src/utils/shiftEmployeeMatching.ts`

**Step 1: Add suggestion fields to interface**

Update `ShiftImportEmployee` (lines 4-12):

```typescript
export interface ShiftImportEmployee {
  csvName: string;
  normalizedName: string;
  matchedEmployeeId: string | null;
  matchedEmployeeName: string | null;
  matchConfidence: 'exact' | 'partial' | 'none';
  csvPosition: string;
  action: 'link' | 'create' | 'skip';
  suggestedEmployeeId?: string;
  suggestedEmployeeName?: string;
}
```

**Step 2: Raise partial match threshold**

Update `findPartialMatch` (line 49) — add `score >= 0.8` condition:

```typescript
    if (score >= 0.8 && score > bestScore && matchingWords.length >= 2) {
```

**Step 3: Change partial match from auto-link to suggestion**

Update `matchEmployees` (lines 91-94):

```typescript
    const partialMatch = findPartialMatch(normalizedName, employees);
    if (partialMatch) {
      results.push({
        csvName,
        normalizedName,
        matchedEmployeeId: null,
        matchedEmployeeName: null,
        matchConfidence: 'partial',
        csvPosition,
        action: 'create',
        suggestedEmployeeId: partialMatch.id,
        suggestedEmployeeName: partialMatch.name,
      });
      return;
    }
```

**Step 4: Run tests to verify they pass**

Run: `npm run test -- tests/unit/shiftEmployeeMatching.test.ts`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add src/utils/shiftEmployeeMatching.ts
git commit -m "fix: partial matches suggest instead of auto-linking employees"
```

---

### Task 5: Fix existing test that expects partial auto-link

**Files:**
- Modify: `tests/unit/shiftEmployeeMatching.test.ts`

**Step 1: Update the old partial match test (lines 45-53)**

The existing test expects `matchedEmployeeId` to be `'emp-2'` for partial matches. Update it:

```typescript
  it('marks unmatched names with partial confidence when words match', () => {
    const csvNames = [
      { name: 'Gaspar Chef  Vidanez', position: 'Kitchen Manager' },
    ];
    const result = matchEmployees(csvNames, employees);
    expect(result[0].matchConfidence).toBe('partial');
    expect(result[0].matchedEmployeeId).toBeNull();
    expect(result[0].action).toBe('create');
    expect(result[0].suggestedEmployeeId).toBe('emp-2');
    expect(result[0].suggestedEmployeeName).toBe('Gaspar Vidanez');
  });
```

**Step 2: Run tests**

Run: `npm run test -- tests/unit/shiftEmployeeMatching.test.ts`
Expected: ALL PASS

**Step 3: Commit**

```bash
git add tests/unit/shiftEmployeeMatching.test.ts
git commit -m "test: update partial match test expectations for suggestion-only behavior"
```

---

### Task 6: Add tests for `buildEmployeeLookup` collision

**Files:**
- Modify: `tests/unit/shiftEmployeeMatching.test.ts`

**Step 1: Write failing test for lookup collision**

```typescript
  describe('buildEmployeeLookup collision', () => {
    it('first employee wins when two normalize to same key', () => {
      // "John Smith" reversed → "smith john". If another "Smith, John" exists, first registered wins.
      const collisionEmployees = [
        makeEmployee('emp-first', 'John Smith', 'Server'),
        makeEmployee('emp-second', 'Smith, John', 'Cook'),
      ];
      const csvNames = [{ name: 'John Smith', position: 'Server' }];
      const result = matchEmployees(csvNames, collisionEmployees);
      expect(result[0].matchedEmployeeId).toBe('emp-first');
      expect(result[0].matchConfidence).toBe('exact');
    });
  });
```

**Step 2: Run test**

Run: `npm run test -- tests/unit/shiftEmployeeMatching.test.ts`
Expected: May PASS or FAIL depending on iteration order — the important thing is the behavior is deterministic after fix

**Step 3: Commit**

```bash
git add tests/unit/shiftEmployeeMatching.test.ts
git commit -m "test: add test for buildEmployeeLookup collision behavior"
```

---

### Task 7: Fix `buildEmployeeLookup` collision in both files

**Files:**
- Modify: `src/utils/shiftEmployeeMatching.ts:14-38`
- Modify: `src/utils/timePunchImport.ts:207-237`

**Step 1: Fix collision in `shiftEmployeeMatching.ts`**

Update `buildEmployeeLookup` — change `add` helper (line 18):

```typescript
    if (normalized && !lookup.has(normalized)) lookup.set(normalized, employee);
```

**Step 2: Fix collision in `timePunchImport.ts`**

Update `buildEmployeeLookup` — change `add` helper (lines 212-213):

```typescript
    if (normalized && !lookup.has(normalized)) {
      lookup.set(normalized, employee);
    }
```

**Step 3: Run tests**

Run: `npm run test -- tests/unit/shiftEmployeeMatching.test.ts`
Expected: ALL PASS

**Step 4: Commit**

```bash
git add src/utils/shiftEmployeeMatching.ts src/utils/timePunchImport.ts
git commit -m "fix: prevent buildEmployeeLookup from overwriting first employee on collision"
```

---

### Task 8: Add test for accented name exact matching end-to-end

**Files:**
- Modify: `tests/unit/shiftEmployeeMatching.test.ts`

**Step 1: Write test for accented exact match through `matchEmployees`**

```typescript
  describe('accented name matching', () => {
    it('matches accented CSV name to non-accented DB employee', () => {
      const accentedEmployees = [
        makeEmployee('emp-accent', 'Maria Garcia', 'Server'),
      ];
      const csvNames = [{ name: 'María García', position: 'Server' }];
      const result = matchEmployees(csvNames, accentedEmployees);
      expect(result[0].matchedEmployeeId).toBe('emp-accent');
      expect(result[0].matchConfidence).toBe('exact');
    });

    it('matches non-accented CSV name to accented DB employee', () => {
      const accentedEmployees = [
        makeEmployee('emp-accent', 'José García López', 'Server'),
      ];
      const csvNames = [{ name: 'Jose Garcia Lopez', position: 'Server' }];
      const result = matchEmployees(csvNames, accentedEmployees);
      expect(result[0].matchedEmployeeId).toBe('emp-accent');
      expect(result[0].matchConfidence).toBe('exact');
    });
  });
```

**Step 2: Run tests**

Run: `npm run test -- tests/unit/shiftEmployeeMatching.test.ts`
Expected: ALL PASS (accent fix from Task 2 should handle this)

**Step 3: Commit**

```bash
git add tests/unit/shiftEmployeeMatching.test.ts
git commit -m "test: add accented name end-to-end matching tests"
```

---

### Task 9: Update `ShiftImportEmployeeReview` UI for suggestion display

**Files:**
- Modify: `src/components/scheduling/ShiftImportEmployeeReview.tsx:96-186`

**Step 1: Update partial match row to show "Did you mean?" instead of pre-selecting**

In the review component, find the section for partial/none matches (line 130-179). Update the partial match rendering:

Replace lines 130-158 with logic that shows the suggestion as helper text instead of pre-selecting:

```typescript
            {(match.matchConfidence === 'partial' || match.matchConfidence === 'none') && (
              <div className="flex flex-wrap items-center gap-2 pl-11">
                {match.matchConfidence === 'partial' && match.suggestedEmployeeName && (
                  <span className="text-[12px] text-amber-600">
                    Did you mean {match.suggestedEmployeeName}?
                  </span>
                )}
                <Select
                  value={match.matchedEmployeeId || ''}
                  onValueChange={(value) => {
                    if (value === '__clear__') {
                      onUpdateMatch(match.normalizedName, null, 'skip');
                    } else {
                      onUpdateMatch(match.normalizedName, value, 'link');
                    }
                  }}
                >
                  <SelectTrigger
                    className="h-9 text-[13px] bg-muted/30 border-border/40 rounded-lg w-48"
                    aria-label={`Link ${match.csvName} to existing employee`}
                  >
                    <SelectValue placeholder="Link to existing" />
                  </SelectTrigger>
                  <SelectContent>
                    {match.matchedEmployeeId && (
                      <SelectItem value="__clear__">Clear</SelectItem>
                    )}
                    {existingEmployees.map((emp) => (
                      <SelectItem key={emp.id} value={emp.id}>
                        {emp.name} {emp.position ? `(${emp.position})` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {match.action !== 'link' && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-9 px-3 rounded-lg text-[13px] font-medium"
                    onClick={() => onCreateSingle(match.normalizedName)}
                    disabled={isCreating}
                    aria-label={`Create employee ${match.csvName}`}
                  >
                    {isCreating ? (
                      <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                    ) : (
                      <UserPlus className="h-3.5 w-3.5 mr-1.5" />
                    )}
                    Create
                  </Button>
                )}
                {match.action === 'skip' && (
                  <span className="text-[12px] text-muted-foreground">Shifts will be skipped</span>
                )}
              </div>
            )}
```

Also update the `matchedEmployeeName` display (lines 117-121) to not show the arrow for partial since it's no longer linked:

```typescript
                    {match.matchedEmployeeName && match.matchConfidence === 'exact' && (
                      <span className="text-[12px] text-muted-foreground">
                        &rarr; {match.matchedEmployeeName}
                      </span>
                    )}
```

**Step 2: Run lint**

Run: `npm run lint -- --no-warn`
Expected: No new lint errors

**Step 3: Commit**

```bash
git add src/components/scheduling/ShiftImportEmployeeReview.tsx
git commit -m "fix: show suggestion hint instead of pre-selecting partial matches in UI"
```

---

### Task 10: Verify all tests pass

**Step 1: Run full test suite**

Run: `npm run test -- tests/unit/shiftEmployeeMatching.test.ts`
Expected: ALL tests pass

**Step 2: Run lint**

Run: `npm run lint`
Expected: No new errors (pre-existing errors are OK)

**Step 3: Run build**

Run: `npm run build`
Expected: Build succeeds

---

## Summary of Changes

| File | Change |
|------|--------|
| `src/utils/timePunchImport.ts` | Fix `normalizeEmployeeKey` accent handling, fix `buildEmployeeLookup` collision |
| `src/utils/shiftEmployeeMatching.ts` | Add suggestion fields, partial→create, raise threshold, fix collision |
| `src/components/scheduling/ShiftImportEmployeeReview.tsx` | "Did you mean?" UI, no pre-selection |
| `tests/unit/shiftEmployeeMatching.test.ts` | 10+ new test cases for all 6 edge cases |
