# Shift Import Employee Matching — Edge Case Fixes

**Date:** 2026-02-28
**Status:** Approved

## Problem

Customers report that importing shifts assigns imported employees to the wrong existing employee. Six edge cases identified:

1. **Accented characters break matching** — `normalizeEmployeeKey` strips accented chars so "García" ≠ "Garcia"
2. **Partial match auto-links** — Partial matches set `action: 'link'`, silently assigning wrong employee
3. **No minimum confidence threshold** — Any 2-word overlap auto-matches regardless of score
4. **Lookup map collision** — Two employees normalizing to same key overwrite each other
5. **Partial match ignores name-order reversal** — Already handled in exact lookup but not partial
6. **Duplicated matching logic** — `timePunchImport.ts` has its own `buildEmployeeLookup`

## Solution

### 1. Fix `normalizeEmployeeKey` (accent normalization)

In `src/utils/timePunchImport.ts`:
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

This makes "García" → "garcia", "José" → "jose". Single fix propagates to all consumers.

### 2. Partial matches → suggestion only, never auto-link

In `src/utils/shiftEmployeeMatching.ts`:
- Add `suggestedEmployeeId` and `suggestedEmployeeName` fields to `ShiftImportEmployee`
- When partial match found: set `matchedEmployeeId: null`, `action: 'create'`, store suggestion in new fields
- User must explicitly select from dropdown to link

### 3. UI: "Did you mean?" helper text

In `src/components/scheduling/ShiftImportEmployeeReview.tsx`:
- For partial confidence with suggestion: show "Did you mean: {name}?" helper text
- Dropdown starts empty (not pre-selected)
- "Create" button remains for creating new employee

### 4. Fix `buildEmployeeLookup` collision

Both in `shiftEmployeeMatching.ts` and `timePunchImport.ts`:
- Check `lookup.has(normalized)` before `.set()` — first entry wins
- Prevents silent overwrites when employees generate same normalized key

### 5. Raise partial match threshold

In `findPartialMatch()`:
- Require `score >= 0.8` (up from any positive score)
- Keep `matchingWords.length >= 2` minimum

### 6. Test cases

| Test | Description |
|------|-------------|
| Accented exact match | "García López" matches "Garcia Lopez" |
| Same surname, different first | "Antonio Dominguez" and "Abraham Dominguez" don't cross-match |
| Partial match action | Partial returns `action: 'create'` with suggestion, not `action: 'link'` |
| Lookup collision | Two employees with same normalized name — first one wins |
| Single-word CSV name | "Garcia" alone doesn't partial-match anyone |
| High threshold | 2-of-3 word match (67%) rejected by 0.8 threshold |
| Empty/whitespace names | Handled gracefully, no crash |
| Suggestion metadata | Partial match populates `suggestedEmployeeId`/`suggestedEmployeeName` |

## Files Changed

- `src/utils/timePunchImport.ts` — Fix `normalizeEmployeeKey`, fix `buildEmployeeLookup` collision
- `src/utils/shiftEmployeeMatching.ts` — New suggestion fields, partial→create, threshold, collision fix
- `src/components/scheduling/ShiftImportEmployeeReview.tsx` — "Did you mean?" UI for partial suggestions
- `tests/unit/shiftEmployeeMatching.test.ts` — 8+ new test cases
