

## Bug: Weekly Brief page shows "No brief generated" due to timezone date shift

### Root Cause

The `getMostRecentSunday()` function in `src/hooks/useWeeklyBrief.ts` has a **timezone bug**. It calculates the correct Sunday in local time, but then calls `.toISOString().split('T')[0]` which converts to **UTC before extracting the date string**. For US timezones (UTC-5 to UTC-8), this shifts the date forward by one day in the evening hours.

**Example (your case):**
- Your local time: Monday Feb 16, ~9 PM CST
- Correct Sunday: Feb 15
- `setDate()` sets it to Feb 15 in local time
- `toISOString()` converts to UTC: Feb 16 03:00 UTC
- `.split('T')[0]` extracts `"2026-02-16"` instead of `"2026-02-15"`

The brief exists in the database with `brief_week_end = 2026-02-15`, but the UI queries for `2026-02-16`, so nothing is found.

The same bug exists in the `generate-weekly-brief` edge function dispatcher, but that runs server-side in UTC so it has not caused issues there.

### Fix

**File: `src/hooks/useWeeklyBrief.ts`** -- Replace `toISOString()` with local date formatting:

```typescript
// BEFORE (buggy):
export function getMostRecentSunday(): string {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const lastSunday = new Date(now);
  lastSunday.setDate(now.getDate() - (dayOfWeek === 0 ? 7 : dayOfWeek));
  return lastSunday.toISOString().split('T')[0];
}

// AFTER (fixed):
export function getMostRecentSunday(): string {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const lastSunday = new Date(now);
  lastSunday.setDate(now.getDate() - (dayOfWeek === 0 ? 7 : dayOfWeek));
  const yyyy = lastSunday.getFullYear();
  const mm = String(lastSunday.getMonth() + 1).padStart(2, '0');
  const dd = String(lastSunday.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}
```

This uses `getFullYear()`, `getMonth()`, and `getDate()` which all return **local** values, avoiding the UTC shift entirely.

### Scope
- One function change in one file
- No database changes needed
- The brief data already exists correctly in the database
