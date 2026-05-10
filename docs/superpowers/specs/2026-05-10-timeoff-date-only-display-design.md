# Time-Off Request Date Off-By-One Fix — Design

**Date:** 2026-05-10
**Author:** Jose M Delgado (via /dev workflow)
**Branch:** `fix/timeoff-tz-bug`

## Problem

Tristen Liu submitted a time-off request for **May 29, 2026** (her graduation day). The approval email correctly stated **May 29**, but the EasyShiftHQ UI shows **May 28** — one day early.

### Production data (verified via Supabase MCP)

```
request_id        : 408cc35a-5880-489f-89ab-3cfb15996c64
employee          : Tristen Liu
restaurant        : Wetzel's - Cold Stone - Alamo Ranch
restaurant_tz     : America/Chicago
start_date (DATE) : 2026-05-29
end_date   (DATE) : 2026-05-29
status            : approved
created_at (UTC)  : 2026-04-22 01:50:51
```

**The DB value is correct.** The bug is purely on the read/display path.

### Root cause

The `time_off_requests.start_date` and `end_date` columns are PostgreSQL `DATE` (a calendar day with no time component). Supabase serializes them as ISO date-only strings (`"2026-05-29"`). The frontend then renders them like:

```typescript
{format(new Date(request.start_date), 'MMM d, yyyy')}
```

JavaScript parses ISO date-only strings (`"2026-05-29"`) as **UTC midnight** per the ECMAScript spec. In a browser running in `America/Chicago` (UTC-5 in CDT), that UTC instant is "May 28, 7:00 PM CDT", and `format()` from `date-fns` renders it in the local TZ as **May 28, 2026**.

Locally reproduced (`TZ=America/Chicago`):

| Expression | Output |
| --- | --- |
| `new Date("2026-05-29").toLocaleDateString('en-US', ...)` | "May 28, 2026" ❌ |
| `new Date("2026-05-29T00:00:00").toLocaleDateString('en-US', ...)` | "May 29, 2026" ✅ |

The email path renders correctly only because Supabase Edge Functions (Deno) run in UTC; the same expression produces "May 29, 2026" there. This is fragile — a runtime TZ change would silently break emails.

### Affected sites

| File | Line | Severity |
| --- | --- | --- |
| `src/components/TimeOffList.tsx` | 144–145 | Visible to managers (PRIMARY) |
| `src/pages/EmployeePortal.tsx` | 205–206 | Visible to employees (PRIMARY) |
| `src/components/TimeOffRequestDialog.tsx` | 47–48 | Edit-mode calendar prefill |
| `src/components/TimeOffRequestDialog.tsx` | 62–64 | Write path — latent fragility |
| `supabase/functions/send-time-off-notification/index.ts` | 54–57 | Latent (currently masked by Deno UTC) |

The write path uses `fromZonedTime(date, restaurantTimezone).toISOString().substring(0, 10)`. This works **only when the browser TZ matches the restaurant TZ** (Tristen's case). If a user travels or a manager submits from a different TZ, the wall-clock components shift and the wrong day is stored. Out of scope today only because we have no production evidence of cross-TZ writes — but we should fix it preemptively since the helper makes it free.

### Why subsequent commits did not fix this

Reviewed `git log --since="2026-04-22"` for time-off and TZ-related commits. The only post-creation time-off commit was `1db94052` (#477 — manager email notifications), which did not touch date display. The bug is still present in `main`.

## Goals

1. UI shows the same calendar day that was stored (no TZ shift), regardless of browser TZ.
2. UI shows the same calendar day that the email approval stated.
3. Write path stores exactly the calendar day the user selected, regardless of browser TZ.
4. The fix is reusable so future date-only columns don't repeat the trap.
5. Tests pin the contract under TZ stubbing so regressions get caught in CI (which runs in UTC).

## Non-goals

- Changing the schema (DATE columns stay).
- Changing API contracts for `time_off_requests`.
- Refactoring banking date-only display sites (`ReconciliationReport.tsx`, `ReconciliationDialog.tsx`) — same pattern but out of scope; their behavior is correct enough today and a separate ticket can adopt the helper.
- Replacing `Date` with `string` or Temporal polyfill across the codebase.

## Approach

Approach A from brainstorm: minimal helper + targeted fixes.

### Helper module: `src/lib/dateOnly.ts`

A small utility with two functions and zero dependencies on TZ libraries:

```typescript
/**
 * Parse a YYYY-MM-DD calendar-day string into a Date anchored at LOCAL midnight.
 *
 * JavaScript's built-in `new Date("2026-05-29")` parses ISO date-only strings as UTC
 * midnight, which then renders as the previous day in any negative-UTC-offset
 * browser TZ (US Pacific/Mountain/Central/Eastern, all of South America, etc.).
 * This helper sidesteps that by parsing the components manually.
 */
export function parseDateOnly(value: string): Date;

/**
 * Convert a Date object (typically from a calendar/date picker) into a YYYY-MM-DD
 * calendar-day string, using the Date's LOCAL fields. The output is the calendar
 * day the user clicked on, with no UTC math — appropriate for storing in a
 * Postgres DATE column.
 */
export function toDateOnlyString(date: Date): string;

/**
 * Format a YYYY-MM-DD calendar-day string for display via date-fns.
 * Always parses as local midnight so format() renders the correct day.
 */
export function formatDateOnly(value: string, fmt?: string): string;
```

`parseDateOnly` validates `value` matches `YYYY-MM-DD` exactly (rejects `YYYY-MM-DDTHH:MM:SS` to keep callers honest about the type), splits on `-`, and constructs `new Date(y, m - 1, d)` (LOCAL midnight constructor).

`toDateOnlyString` uses `getFullYear()` / `getMonth() + 1` / `getDate()` (LOCAL fields) and zero-pads.

`formatDateOnly` is a one-line composition: `format(parseDateOnly(value), fmt ?? 'MMM d, yyyy')`.

### Read-path call-site changes

Three components, each replaces `format(new Date(req.start_date), 'MMM d, yyyy')` with `formatDateOnly(req.start_date, 'MMM d, yyyy')`:

- `src/components/TimeOffList.tsx` (lines 144, 145)
- `src/pages/EmployeePortal.tsx` (lines 205, 206)

The dialog edit-mode prefill replaces `setStartDate(new Date(request.start_date))` with `setStartDate(parseDateOnly(request.start_date))`:

- `src/components/TimeOffRequestDialog.tsx` (lines 47, 48)

### Write-path change in `TimeOffRequestDialog.tsx`

Replace:

```typescript
const toUTCDate = (date: Date) => {
  const converter = fromZonedTime ?? ((value: Date) => value);
  return converter(date, restaurantTimezone).toISOString().substring(0, 10);
};
```

with:

```typescript
import { toDateOnlyString } from '@/lib/dateOnly';
// ...
start_date: toDateOnlyString(startDate),
end_date:   toDateOnlyString(endDate),
```

Drop the `import * as dateFnsTz from 'date-fns-tz'`, the `fromZonedTime` destructure, and the `restaurantTimezone` lookup that's no longer needed for this purpose. Keep the `restaurantTimezone` line if it's used elsewhere — verify during implementation; current read confirms it's only used for `toUTCDate`.

The user clicked a calendar day. They did not pick a moment in time. Treating it as a calendar day with no TZ math is the correct semantics; the previous code only worked by coincidence when browser TZ matched restaurant TZ.

### Email path

The Deno edge function in `supabase/functions/send-time-off-notification/index.ts` currently does:

```typescript
const formatDate = (date: string) => new Date(date).toLocaleDateString('en-US', {
  month: 'long', day: 'numeric', year: 'numeric',
});
```

This works because Deno runs in UTC. Out of scope for this PR (per user's chosen Approach A — not "A + harden email"). The pattern stays as-is; we'll revisit if we ever see edge-function TZ migration.

### Testing

Unit tests in `tests/unit/dateOnly.test.ts` covering:

1. `parseDateOnly("2026-05-29")` returns a Date whose local-TZ year/month/day are 2026/5/29 — under both `TZ=UTC` and `TZ=America/Chicago` (and one east-of-UTC TZ like `Asia/Tokyo` for symmetry).
2. `toDateOnlyString(new Date(2026, 4, 29))` returns `"2026-05-29"` under all three TZs.
3. Round-trip: `toDateOnlyString(parseDateOnly("2026-05-29")) === "2026-05-29"` under all three TZs.
4. `formatDateOnly("2026-05-29", "MMM d, yyyy")` returns `"May 29, 2026"` under all three TZs.
5. Tristen-specific regression: `formatDateOnly("2026-05-29")` under `TZ=America/Chicago` ≠ `"May 28, 2026"`.
6. `parseDateOnly` rejects malformed input with a clear error (`"2026/05/29"`, `""`, `"2026-5-9"`, `"2026-05-29T00:00:00"`, `"not a date"`).

Test strategy: assert TZ-independent properties of the helpers wherever possible — e.g. `expect(parsed.getFullYear()).toBe(2026)` and `expect(parsed.getMonth()).toBe(4)` for `parseDateOnly`, since these wall-clock-fields read in the runner's local TZ (whatever it is) and the helper anchors to local midnight by construction. For `formatDateOnly` we assert the output string `"May 29, 2026"`, which under date-fns's local rendering will be correct in any TZ as long as `parseDateOnly` already anchored to local midnight. Add one explicit Chicago-stubbed regression test using `vi.stubGlobal('Date', ...)` only if `vi.stubEnv('TZ', 'America/Chicago')` proves insufficient for V8's timezone subsystem under vitest workers — record which approach was used in the test file header. Lessons.md (PR #485, 2026-05-03) documents that CI runs in UTC, so the runner's-TZ-agnostic approach also pins behavior in CI.

## Architecture & data flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│  Calendar widget (browser local TZ)                                     │
│         │                                                               │
│         │  Date object: 2026-05-29 00:00 LOCAL                          │
│         ▼                                                               │
│  toDateOnlyString(date)  ──→  "2026-05-29"  ──→  Supabase DATE column   │
│                                                                         │
│                                                                         │
│  Supabase DATE column                                                   │
│         │                                                               │
│         │  ISO date-only string: "2026-05-29"                           │
│         ▼                                                               │
│  formatDateOnly("2026-05-29", "MMM d, yyyy")  ──→  "May 29, 2026"       │
│  parseDateOnly("2026-05-29")                  ──→  Date(2026,4,29 LOCAL)│
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

The helper makes the read and write paths symmetric and TZ-independent for date-only values.

## Error handling

`parseDateOnly` throws `Error("Invalid date-only string: <value>")` on malformed input. Callers all receive validated DB output, so this throw is a safety net — not expected to fire in normal flow. We do not catch and degrade; a malformed date-only string indicates a schema or migration bug that should surface loudly.

`formatDateOnly` and `toDateOnlyString` likewise do not silently degrade.

## Backward compatibility

Pure addition + 4 call-site replacements. No schema, API, or type changes. No data migration. Users with existing requests continue to see the correct dates after deploy.

## Rollout

Standard deploy via the workflow. No feature flag — the bug is visible to every employee in a non-UTC TZ, and the fix is type-equivalent to the original on the happy path (correct calendar day in, correct calendar day out).

## Out of scope

- Banking `ReconciliationReport.tsx` / `ReconciliationDialog.tsx` adopting the helper.
- Email render hardening in `send-time-off-notification/index.ts`.
- Audit of every other `format(new Date(...), ...)` call site for TZ correctness.
- Schema change to `timestamptz` or any column type change.

## Risks

1. **Test TZ stubbing flakiness.** Mitigation: validate via wall-clock-field assertions as a fallback if `vi.stubEnv('TZ', '...')` doesn't propagate to the V8 timezone subsystem reliably. Document the chosen approach in the test file header.
2. **Edit-mode calendar appears 1 day off if a user has any in-flight edits at deploy.** Mitigation: refresh page; the values stored in DB are correct. No data fix needed.
3. **Lost write-path safety net for cross-TZ submitters.** The new `toDateOnlyString` strictly uses LOCAL fields, which is semantically right (the user picks a calendar day in their browser). If in the future we want to constrain "submit only days that exist in restaurant TZ" we can add that on top of the helper without reverting it.

## Summary

Add `src/lib/dateOnly.ts`, swap 4 call sites to use it, drop the `fromZonedTime` write-path workaround, add a tested contract. Diff: ~80 lines plus tests.
