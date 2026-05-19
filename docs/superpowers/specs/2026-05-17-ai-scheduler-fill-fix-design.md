# AI Scheduler — Fill Slots, Respect Availability, Use All Employees

**Date:** 2026-05-17
**Author:** Jose M Delgado (with Claude Code)
**Branch:** `worktree-ai-scheduler-fill-fix`
**Status:** Design — approved, design-review folded (2026-05-17)

## Problem

Users report three concrete failures in the AI scheduler (planner section):

1. **Doesn't fill the slots** with available people — open shifts remain on the grid after generation.
2. **Doesn't respect hours available or not available** — employees are scheduled outside their availability windows, or never scheduled despite valid availability.
3. **~30 employees on the roster, but slots are left open** — the AI seems to ignore most of the roster.

A read-through of `supabase/functions/generate-schedule/`, `supabase/functions/_shared/schedule-validator.ts`, `supabase/functions/_shared/schedule-prompt-builder.ts`, `src/hooks/useGenerateSchedule.ts`, `src/components/AvailabilityDialog.tsx`, and `src/components/scheduling/ShiftPlanner/TemplateFormDialog.tsx` identifies **eight distinct bugs** plus observability gaps that together produce these symptoms.

## Root-cause inventory

### Critical (silently drop shifts the AI generates)

#### Bug 1 — Timezone mismatch between availability and templates

- `AvailabilityDialog.tsx:82-83` writes `employee_availability.start_time / end_time` after `localTimeToUtcTime(time, restaurantTimezone)` — **storage is UTC**.
- `TemplateFormDialog.tsx:100-101` writes `shift_templates.start_time / end_time` with **no timezone conversion** — storage is restaurant-local.
- `generate-schedule/index.ts:237-244` reads availability rows directly and passes UTC times to the prompt and validator.
- `schedule-prompt-builder.ts:144-150` renders both side-by-side to the AI as if they're in the same clock.
- `schedule-validator.ts:148-161` compares them with raw `timeToMinutes` (no TZ awareness).

For a CST restaurant with an employee "available 8am–11pm", availability is stored as `13:00–04:00` UTC (an overnight window!). The AI sees that string, thinks the employee is available 1pm–4am, doesn't overlap a `08:00–16:00` template, and skips them. Even when the AI does assign them, the validator's `shiftStart < windowStart || shiftEnd > windowEnd` check (line 155) returns true for any normal shift because `windowEnd (240) < windowStart (780)`.

**Almost certainly the #1 root cause of "30 employees but slots left open."**

#### Bug 2 — Validator overnight window handling

`schedule-validator.ts:71-78` (`shiftsOverlap`) and `:155` (window check) both assume `start < end`. Even after Bug 1 is fixed at storage-time interpretation, late-night shifts that legitimately cross midnight (e.g., bartender 22:00–02:00) will continue to fail.

#### Bug 3 — Position exact-match drops cross-trained employees

`schedule-validator.ts:124-134` requires `employee.position.toLowerCase() === shift.position.toLowerCase()`. With 30 employees on a real roster, position strings drift: "Line Cook" vs "Cook", "Server " (trailing space) vs "Server", "Bartender" vs "Bar". Every such mismatch silently drops every shift for that employee.

#### Bug 4 — Missing-day contract mismatch

`generate-schedule/index.ts:258-266` only fills a "default available all days" map when an employee has **zero** availability rows. If they have rows for some days but not others (e.g., Mon/Wed/Fri only), the other days are absent from the map.

- `schedule-prompt-builder.ts:154-170` renders only the days that exist in the map — the AI sees nothing about Tue/Thu/Sat/Sun for that employee, and reasonably assumes they're free.
- `schedule-validator.ts:139-145` treats `!slot` as unavailable — drops all shifts the AI generated for those days.

Silent drops + wrong AI inference = lots of wasted slots.

### Important (cause AI to under-generate)

#### Bug 5 — No "fill all slots" instruction in the system prompt

`schedule-prompt-builder.ts:69-84` has 11 rules, none of which tell the AI:

- How many staff each (template, day) requires.
- That leaving a required slot empty is a failure.

Rule 10 actively pressures the AI to under-staff: "Try to stay within the weekly labor budget target." With no opposing pressure to fill, a thrifty AI optimizes for cost.

#### Bug 6 — `staffing_settings.min_crew` (JSONB) is never read

`staffing_settings` has columns: `min_staff INTEGER`, `min_crew JSONB`, `target_splh`, `avg_ticket_size`, `target_labor_pct`.

`generate-schedule/index.ts:390-394` does:

```typescript
for (const [k, v] of Object.entries(rest)) {
  if (k.startsWith("min_") && typeof v === "number") {
    const position = k.replace(/^min_/, "").replace(/_/g, " ");
    result[position] = { min: v };
  }
}
```

This only picks numeric `min_*` columns. `min_crew` (JSONB) is ignored. `min_staff` is numeric and starts with `min_` so it becomes a position named `"staff"` that no employee has. Result: `staffingSettings` is almost always null/garbage; the prompt falls back to "No explicit minimums set."

#### Bug 7 — `max_tokens: 8192` truncates large schedules

`generate-schedule/index.ts:419`. With 30 employees × 7 days × ~30 template slots, the JSON output can exceed 8K tokens. Truncated JSON throws on `JSON.parse(cleaned)` at line 443. The `catch { continue; }` at line 446 silently falls through to the next model, which produces the same truncated output. Eventually all five models fail, the function returns 502, and the user sees "All AI models failed."

Worse: a partially-truncated valid-looking JSON parses fine and produces a half-schedule with no error signal.

#### Bug 8 — No zero-shift guardrail

`generate-schedule/index.ts:515-530` returns HTTP 200 with `{ shifts: [], metadata: {...} }` if all models produce zero valid shifts. `useGenerateSchedule.ts` returns silently. The user sees no error, just an empty schedule, with no clue why.

### Observability gaps

- No log of the actual prompt size or estimated tokens.
- No log of `finish_reason` from OpenRouter (would reveal truncation).
- No log of per-template fill ratio (would reveal which templates/days went unfilled).
- The dialog's "Dropped suggestions" view doesn't show how many slots **existed** vs filled vs dropped.

## Approach

Surgical, in-flight fixes inside the edge function, validator, and prompt builder. **No data migration** — existing UTC availability stays in storage; the edge function converts it to restaurant-local on read. All other consumers (`AvailabilityDialog`, `TeamAvailabilityGrid`) already do their own UTC↔local handling and are not affected.

### File-level change map

| File | Change |
|---|---|
| `supabase/functions/_shared/schedule-validator.ts` | (a) Normalize positions; (b) Overnight-aware `withinWindow` and `shiftsOverlap`. Module stays pure. |
| `supabase/functions/_shared/schedule-prompt-builder.ts` | (a) Render 7 days per employee (mark missing as unavailable); (b) Add per-template required headcount field; (c) Add "Fill every required slot" as a hard rule; (d) Add note that all times are restaurant local. |
| `supabase/functions/_shared/availability-tz.ts` (new) | Pure utility: `convertRecurringToLocal` + `convertExceptionsToLocal`. Both return `LocalAvail[]` in restaurant local time, splitting rows whose conversion crosses local midnight into two rows on adjacent local days. Bare-specifier import of `date-fns-tz`. Pure function, fully unit-tested. |
| `supabase/functions/deno.json` (new) | Import map pinning `date-fns-tz` to `npm:date-fns-tz@3.2.0` for the Deno runtime. |
| `supabase/functions/_shared/staffing-requirements.ts` (new) | Pure utility: `computeRequiredStaff(templates, minCrew, priorPatterns, hourlySales)` → returns `Map<templateId, Map<day, requiredCount>>`. Fully unit-tested. |
| `supabase/functions/generate-schedule/index.ts` | (a) Fetch restaurant timezone in the parallel batch (10th query) with null-safety default to `"UTC"`; (b) Apply `convertRecurringToLocal` + `convertExceptionsToLocal` before building the prompt + validator map; (c) Read `min_crew` (JSONB) into `staffingSettings`; (d) Compute `requiredStaffPerTemplate` and pass to prompt; (e) `max_tokens: 16384`; (f) Detect `finish_reason === "length"` and skip with a logged warning; (g) Add structured logs for prompt size, model attempts, dropped reasons summary, fill ratio; (h) Zero-shift → HTTP 422 + diagnostic (codes only, no UUIDs); (i) Include `total_required_slots` and `dropped_reason_summary` in success metadata. |
| `src/hooks/useGenerateSchedule.ts` | (a) Add `ScheduleDiagnostic` interface; (b) Read 422 body via `FunctionsHttpError.context`, rethrow as `ScheduleGenerationError` carrying the diagnostic; (c) Format toast as single-line summary in `onError`; (d) Drop the `if (data.shifts.length === 0) return;` early return so invalidate always fires. |
| `src/components/scheduling/ShiftPlanner/GenerateScheduleDialog.tsx` | (a) "Filled X of Y required slots" line gated on `total_required_slots > 0`; (b) Replace `key={i}` with `key={reason}` (or `${reason}-${i}`) in dropped-reasons lists; (c) `aria-hidden` on decorative icons; (d) Wrap subtitle in `<DialogDescription>`; (e) Restructure DialogContent to flex layout so footer is sticky on short viewports. |
| `src/lib/scheduleWarnings.ts` | Already handles overnight in `timeRangesOverlap` — confirm and update tests if needed. |

### Bug-fix detail

#### Bug 1 — Timezone conversion at read time

```typescript
// supabase/functions/_shared/availability-tz.ts (new)
import { toZonedTime } from "date-fns-tz";

interface RawRecurringAvail {
  employee_id: string;
  // The user's local day of week (0=Sun..6=Sat) as selected in the
  // AvailabilityDialog UI. The column carries no timezone metadata.
  day_of_week: number;
  is_available: boolean;
  // Stored as UTC-valued clock time (no timezone metadata on the TIME column).
  // Written by `localTimeToUtcTime` in AvailabilityDialog.tsx:82-83.
  start_time: string | null; // HH:MM:SS
  end_time: string | null;   // HH:MM:SS
}

interface RawExceptionAvail {
  employee_id: string;
  date: string;              // YYYY-MM-DD, local calendar date
  is_available: boolean;
  start_time: string | null; // HH:MM:SS, UTC-valued clock time
  end_time: string | null;   // HH:MM:SS, UTC-valued clock time
}

interface LocalAvail {
  employee_id: string;
  day_of_week: number;       // 0=Sun..6=Sat in restaurant local
  is_available: boolean;
  start_time: string | null; // HH:MM:SS local
  end_time: string | null;   // HH:MM:SS local
  isOvernight: boolean;      // end_local < start_local
}

export function convertRecurringToLocal(
  rows: RawRecurringAvail[],
  restaurantTimezone: string,
  weekStart: string,
): LocalAvail[] { ... }

export function convertExceptionsToLocal(
  rows: RawExceptionAvail[],
  restaurantTimezone: string,
): LocalAvail[] { ... }
```

For each row:

1. Anchor the UTC clock time to a real UTC instant using a reference date — for recurring rows, the date within `weekStart`'s week that matches the row's `day_of_week`; for exceptions, the row's `date` itself. This handles DST correctly for the specific week.
2. Convert that UTC instant to restaurant local time via `toZonedTime`.
3. If the resulting local-day differs from the original `day_of_week` (or, for exceptions, the original `date`), split the row across the local days it touches (`Mon 17:00–24:00` + `Tue 00:00–01:00`).
4. Mark `isOvernight: true` if `end_local < start_local` after splitting.

**Restaurant timezone fetch + null safety:** Add a 10th parallel query for `restaurants.timezone`. If the result is null/missing or the column is empty (legacy rows pre-dating the `20251001022351` migration), default to `"UTC"` and log a warning. UTC defaulting means no conversion is applied, which is the safest fallback — it matches today's broken behavior, not a worse one.

```typescript
const restaurantTimezone =
  restaurantResult.data?.timezone && typeof restaurantResult.data.timezone === "string"
    ? restaurantResult.data.timezone
    : "UTC";
if (restaurantTimezone === "UTC" && restaurantResult.data?.timezone !== "UTC") {
  console.warn(`[generate-schedule] No timezone for restaurant ${restaurant_id}; defaulting to UTC.`);
}
```

**Dependency wiring:** `date-fns-tz` is already in `package.json` (`^3.2.0`). For the new shared module to import it as a bare specifier (so Vitest can resolve it) AND work in Deno edge runtime:

- Use `import { toZonedTime } from "date-fns-tz"` (bare specifier) in `availability-tz.ts`.
- Create `supabase/functions/deno.json` with an import map: `{ "imports": { "date-fns-tz": "npm:date-fns-tz@3.2.0" } }`. Pinned to 3.2.0 exactly to avoid esm.sh floating-version drift seen in `square-webhooks`.
- Vitest resolves the bare specifier via the existing npm install.

Pure function. Unit tests cover: same-day, crossing midnight into next local day, crossing midnight into previous local day, DST spring forward, DST fall back, null/empty timezone (returns rows unchanged with `day_of_week` preserved), exceptions parity with recurring.

#### Bug 2 — Overnight-aware validator

```typescript
function withinWindow(shiftStart: number, shiftEnd: number, windowStart: number, windowEnd: number): boolean {
  const shiftIsOvernight = shiftEnd <= shiftStart;
  const windowIsOvernight = windowEnd < windowStart;

  if (!windowIsOvernight) {
    // Normal window. Shift must also be normal (no overnight shift fits a
    // non-overnight window without spilling past midnight).
    if (shiftIsOvernight) return false;
    return shiftStart >= windowStart && shiftEnd <= windowEnd;
  }

  // Overnight window [windowStart, 24:00) ∪ [0, windowEnd].
  if (shiftIsOvernight) {
    // Both halves must lie within their respective sides of the window.
    return shiftStart >= windowStart && shiftEnd <= windowEnd;
  }
  // Normal shift fitting entirely in one side of the overnight window.
  const inEvening = shiftStart >= windowStart && shiftEnd <= 1440;
  const inMorning = shiftStart >= 0 && shiftEnd <= windowEnd;
  return inEvening || inMorning;
}

function shiftsOverlap(a: GeneratedShift, b: GeneratedShift): boolean {
  // Normalize each shift: if end <= start, treat as overnight (end + 1440)
  let aStart = timeToMinutes(a.start_time);
  let aEnd = timeToMinutes(a.end_time);
  if (aEnd <= aStart) aEnd += 1440;
  let bStart = timeToMinutes(b.start_time);
  let bEnd = timeToMinutes(b.end_time);
  if (bEnd <= bStart) bEnd += 1440;
  return aStart < bEnd && bStart < aEnd;
}
```

Note the `shiftIsOvernight` guard in the normal-window branch — without it, an overnight shift `22:00–02:00` (shiftEnd=120) would falsely pass `shiftEnd <= windowEnd=1380` against a normal `08:00–23:00` window.

Unit tests for: normal-vs-normal, normal-vs-overnight window, overnight-shift-vs-normal-window rejected, overnight-shift-vs-overnight-window, shift exactly at boundary, etc.

#### Bug 3 — Position normalization

```typescript
function normalizePosition(s: string | null | undefined): string {
  if (!s) return "";
  const lower = s.trim().toLowerCase().replace(/\s+/g, " ");
  // Strip trailing plural -s ONLY if the stem is at least 4 chars and the
  // word doesn't end in "ss" (Hostess, Buss). This avoids corruption of
  // singular nouns that happen to end in -s.
  if (lower.length > 4 && lower.endsWith("s") && !lower.endsWith("ss")) {
    return lower.slice(0, -1);
  }
  return lower;
}
```

- `"Line Cook"` → `"line cook"`
- `"Cook "` → `"cook"`
- `"Servers"` → `"server"`
- `"Server"` → `"server"`
- `"Hostess"` → `"hostess"` (preserved — ends in `ss`)
- `"Buss"` → `"buss"` (preserved — ends in `ss`)
- `"Bus"` → `"bus"` (preserved — stem length ≤ 4)

Validator uses `normalizePosition(emp.position) === normalizePosition(shift.position)`. Prompt builder keeps original capitalization in the rendered text (so the AI sees natural strings) but the validator compares post-normalization. Add a note in the system prompt: "Position strings on shifts you generate must match an employee's position exactly as shown; case and trailing whitespace are ignored, and trailing -s plurals normalize."

This avoids needing a separate alias table. If the user later wants strict matching or alias-driven cross-training, we add an opt-in flag.

#### Bug 4 — Complete 7-day availability map

In `generate-schedule/index.ts` after the conversion (Bug 1 fix), explicitly fill 7 days per employee:

```typescript
for (const emp of employees) {
  if (!availability[emp.id]) {
    availability[emp.id] = {};
    for (let d = 0; d < 7; d++) availability[emp.id][d] = { available: true };
  } else {
    // Has SOME records — missing days default to UNAVAILABLE
    for (let d = 0; d < 7; d++) {
      if (!availability[emp.id][d]) {
        availability[emp.id][d] = { available: false };
      }
    }
  }
}
```

Prompt builder renders all 7 days for every employee so the AI sees an unambiguous picture.

#### Bug 5 — Required-headcount per slot + new prompt rule

```typescript
// staffing-requirements.ts
export function computeRequiredStaff(
  templates: ScheduleTemplate[],
  minCrew: Record<string, number> | null,  // position → min head per slot
  priorPatterns: PriorPattern[],
  hourlySales: HourlySales[],
): Map<string, Map<number, number>> {
  // For each (template, day):
  //   base = minCrew[template.position] ?? priorPatterns[day][template.position] ?? 1
  //   peakBoost = +1 if hourlySales[day][template start hour] is in top quartile
  //   return base + peakBoost
}
```

Added to prompt as:

```
## Required Headcount Per Slot
- [template-uuid] "Morning Shift" | Monday: 2 | Tuesday: 2 | ... 

RULE 12 (HARD): For every (template, day) listed above, you MUST assign the required headcount.
A slot may only be left below required headcount if there is NO eligible-and-available
employee for it. Coverage is more important than budget.
```

Rule 10 (budget) is rephrased to soft: "Among schedules that meet required headcount, prefer ones that stay within the budget target."

#### Bug 6 — Read `min_crew` JSONB correctly

```typescript
if (settingsRow) {
  const result: Record<string, { min: number }> = {};
  // Read min_crew JSONB. Keys are user-facing position strings
  // (e.g., "Server", "Line Cook"); normalize at the comparison site,
  // not here, so the prompt can echo the original strings to the AI.
  if (settingsRow.min_crew && typeof settingsRow.min_crew === "object") {
    for (const [position, count] of Object.entries(settingsRow.min_crew as Record<string, unknown>)) {
      if (typeof count === "number" && count > 0) {
        result[position] = { min: count };
      }
    }
  }
  // min_staff is a global floor only used by computeRequiredStaff fallback.
  // Do NOT add it as a phantom "staff" position.
  if (Object.keys(result).length > 0) staffingSettings = result;
}
```

`computeRequiredStaff` does the position-name match via `normalizePosition(template.position) === normalizePosition(crewKey)`, so prompt rendering can keep original strings.

Pass `min_staff` separately to `computeRequiredStaff` as a sanity floor.

#### Bug 7 — `max_tokens: 16384` + truncation detection

```typescript
const requestBody = { ...promptResult, temperature: 0.3, max_tokens: 16384 };

for (const modelConfig of SCHEDULE_MODELS) {
  console.log(`[generate-schedule] Trying model: ${modelConfig.name}`);
  const response = await callModel(...);
  if (!response || !response.ok) continue;
  const data = await response.json();
  const choice = data.choices?.[0];
  if (!choice?.message?.content) continue;
  if (choice.finish_reason === "length") {
    console.warn(`[generate-schedule] Model ${modelConfig.name} truncated output (finish_reason=length), skipping`);
    continue;
  }
  // ...parse + break
}
```

#### Bug 8 — Zero-shift guardrail + structured drop codes

To avoid leaking employee UUIDs in the diagnostic body and server logs (raised by both reviewers), refactor `DroppedShift.reason` (a free-text string) into a structured `{ code: DropCode; message: string }` pair:

```typescript
// schedule-validator.ts
export type DropCode =
  | "EXCLUDED"
  | "UNKNOWN_EMPLOYEE"
  | "UNKNOWN_TEMPLATE"
  | "POSITION_MISMATCH"
  | "UNAVAILABLE_DAY"
  | "OUTSIDE_WINDOW"
  | "DOUBLE_BOOKING";

interface DroppedShift {
  shift: GeneratedShift;
  code: DropCode;
  message: string; // human-readable, MAY contain UUIDs for server-side debug
}
```

The 422 diagnostic and server log aggregate by `code` only — never by `message`:

```typescript
if (validShifts.length === 0) {
  const reasonCounts: Record<DropCode, number> = {} as Record<DropCode, number>;
  for (const d of droppedShifts) {
    reasonCounts[d.code] = (reasonCounts[d.code] ?? 0) + 1;
  }
  return new Response(
    JSON.stringify({
      error: "AI generated no valid shifts. Check employee positions, availability, and templates.",
      diagnostic: {
        total_employees: employees.length,
        total_templates: templates.length,
        total_required_slots: totalRequiredSlots,
        total_generated: generatedShifts.length,
        total_dropped: droppedShifts.length,
        drop_reason_summary: reasonCounts, // { POSITION_MISMATCH: 12, UNAVAILABLE_DAY: 4, ... }
        model_used: aiResult.model,
      },
    }),
    { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}
```

For the success path, also surface `total_required_slots` and a stripped `dropped_reasons` (codes only, no UUIDs):

```typescript
metadata: {
  ...,
  total_required_slots: totalRequiredSlots,
  total_valid: validShifts.length,
  total_dropped: droppedShifts.length,
  dropped_reason_summary: reasonCounts, // replaces dropped_reasons free-text array
}
```

The existing `dropped_reasons: string[]` field is kept as well for backwards compatibility with the dialog, but it now emits the human messages without UUIDs (or UUID-redacted variants).

**Frontend hook update — `useGenerateSchedule.ts`:**

`supabase.functions.invoke` returns a `FunctionsHttpError` for non-2xx responses; the body is on `error.context` (Response). Default error handling discards the diagnostic:

```typescript
import { FunctionsHttpError } from "@supabase/functions-js";

export interface ScheduleDiagnostic {
  total_employees: number;
  total_templates: number;
  total_required_slots: number;
  total_generated: number;
  total_dropped: number;
  drop_reason_summary: Record<string, number>;
  model_used: string;
}

class ScheduleGenerationError extends Error {
  diagnostic?: ScheduleDiagnostic;
  constructor(message: string, diagnostic?: ScheduleDiagnostic) {
    super(message);
    this.diagnostic = diagnostic;
  }
}

// inside mutationFn, after the invoke:
if (error) {
  if (error instanceof FunctionsHttpError) {
    const body = await (error.context as Response).json().catch(() => null);
    if (body?.diagnostic) {
      throw new ScheduleGenerationError(body.error ?? "No valid shifts generated", body.diagnostic);
    }
  }
  throw new Error(error.message || "Failed to generate schedule");
}

// in onError:
const diag = err instanceof ScheduleGenerationError ? err.diagnostic : undefined;
const top = diag?.drop_reason_summary
  ? Object.entries(diag.drop_reason_summary).sort((a, b) => b[1] - a[1])[0]
  : null;
const description = diag
  ? `Filled 0 of ${diag.total_required_slots} required slots.` +
    (top ? ` Top reason: ${top[0]} (${top[1]}).` : "") +
    " Check employee positions, availability, and templates."
  : err.message;
toast({ variant: "destructive", title: "Could not generate schedule", description });
```

**Always invalidate on success:** the current `if (data.shifts.length === 0) return;` early return in `onSuccess` (line ~96) is no longer needed (zero-shift now returns 422). Remove it so `queryClient.invalidateQueries({ queryKey: ['shifts', restaurantId] })` always runs.

#### Observability

```typescript
const promptStr = promptResult.messages.map(m => m.content).join("\n");
console.log(`[generate-schedule] Prompt: ${promptStr.length} chars, ~${Math.round(promptStr.length / 4)} tokens`);
console.log(`[generate-schedule] Employees: ${employees.length}, Templates: ${templates.length}, Required slots: ${totalRequiredSlots}, TZ: ${restaurantTimezone}`);
// ... after generation:
console.log(`[generate-schedule] Generated: ${generatedShifts.length}, Valid: ${validShifts.length}, Dropped: ${droppedShifts.length}`);
console.log(`[generate-schedule] Drop reason summary: ${JSON.stringify(reasonCounts)}`); // codes only, no UUIDs
```

**Dialog results view** (`GenerateScheduleDialog.tsx`):

- New line, gated on `total_required_slots > 0`:
  ```tsx
  {result.metadata.total_required_slots > 0 && (
    <p className="text-[13px] text-muted-foreground mt-1">
      Filled {result.metadata.total_valid} of {result.metadata.total_required_slots} required slots.
    </p>
  )}
  ```
- Use stable keys in `dropped_reasons.map`: `key={reason}` (or `${reason}-${i}` if duplicates are possible). Replaces the existing `key={i}` anti-pattern at lines 364 and 391.
- Decorative icons (`<Sparkles />`, `<Lock />`) get `aria-hidden="true"` since the buttons already have an `aria-label` or visible text.
- Wrap the dialog subtitle paragraph in `<DialogDescription>` for screen-reader association.
- Restructure `DialogContent` to use flex layout so the footer doesn't get clipped on short viewports:
  ```tsx
  <DialogContent className="max-w-lg p-0 gap-0 border-border/40 flex flex-col max-h-[80vh]">
    <DialogHeader ...>...</DialogHeader>
    <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">...</div>
    <div className="px-6 py-4 border-t ...">...</div>
  </DialogContent>
  ```

## Testing strategy

### Unit (Vitest + Deno test for edge function shared modules)

- `schedule-validator.test.ts` — extend with:
  - Position normalization: "Line Cook" matches "Line Cook ", "Servers" matches "Server"
  - Overnight window: shift 22:00–02:00 falls within window 18:00–06:00
  - Overnight window rejection: shift 12:00–18:00 NOT within window 18:00–06:00
  - Overnight shift overlap: 22:00–02:00 overlaps 01:00–05:00
- `availability-tz.test.ts` (new) — pure utility:
  - UTC 13:00–04:00 for CST restaurant on Mon 2026-05-18 → local 08:00–23:00 Monday
  - UTC 22:00–06:00 for CST on Mon → local 17:00 Mon – 01:00 Tue (split into two LocalAvail rows)
  - DST spring-forward week — verify offsets switch mid-week handled
  - Available-all-day (no times) passes through unchanged
- `staffing-requirements.test.ts` (new) — pure utility:
  - `min_crew` overrides prior patterns
  - Peak boost adds +1 when hourly sales for that hour is in top quartile
  - Falls back to 1 when nothing else is available
- `schedule-prompt-builder.test.ts` — extend:
  - Renders all 7 days per employee
  - Includes required-headcount section
  - Position normalization rendered

### Edge-function integration (existing test harness)

- `generate-schedule.test.ts` — extend with:
  - Restaurant with CST tz + UTC availability rows → prompt shows local times
  - Zero-shift response from AI → returns 422 with diagnostic
  - Truncated AI response (`finish_reason=length`) → skips that model, doesn't silently parse

### Frontend (Vitest)

- `useGenerateSchedule.test.tsx` — extend:
  - 422 response shows toast with diagnostic
- `GenerateScheduleDialog.test.tsx` — extend:
  - Results view renders "Filled X of Y slots"

### E2E (Playwright)

Skipped — the AI scheduler integration test would require mocking OpenRouter; the unit + edge-function tests provide sufficient coverage.

## Risks & decided trade-offs

- **Risk: TZ conversion at runtime adds a step that depends on `restaurants.timezone` being accurate.** Mitigated by: (a) defaulting to UTC if absent (no behaviour change vs today), (b) unit-test coverage, (c) logging the resolved timezone on every run.
- **Risk: `max_tokens: 16384` doubles potential cost per request.** Acceptable — schedules are infrequent (weekly per restaurant) and a failed run currently retries 5 models, costing more than one larger successful run.
- **Decided trade-off: No data migration.** We leave existing UTC-stored availability alone. The runtime conversion is the single source of correctness. This means `AvailabilityDialog` and `TeamAvailabilityGrid` (which already convert UTC↔local for display) stay unchanged. Future cleanup (moving to local storage) is a separate, larger project.
- **Decided trade-off: Position normalization is a simple regex, not an alias table.** If trim/lowercase/plural-strip isn't enough, we'll add an explicit alias table in a follow-up. Most reported drops should be eliminated by normalization alone.
- **Decided trade-off: `requiredStaffPerSlot` is computed, not configured per-template.** Restaurants can already set `min_crew` per position. Per-template explicit headcount is more flexible but adds a UI surface; deferred to a follow-up.

## Design-review folded findings (2026-05-17)

Both reviewers (Supabase + Frontend) ran on the initial design. Critical + major findings are folded into the sections above. Notable deferred items:

- **`restaurants.timezone` `NOT NULL` migration** (Supabase minor) — deferred to a follow-up. The edge-function null-default to UTC is the runtime safety net; tightening the column is a schema change with backfill that doesn't belong in this PR.
- **`total_valid` vs `total_generated` JSDoc** (Frontend minor) — fold into `useGenerateSchedule.ts` as inline comments when implementing; not a separate task.
- **`max_tokens: 16384` as I/O bound, not CPU** (Supabase minor) — documented here for the record. Edge-function wall-clock timeout (not CPU budget) is the binding constraint; OpenRouter call latency is what matters.

Folded as fixes in this design (see relevant sections above):

- 5 critical: esm.sh URL imports (→ bare specifier + deno.json import map), 422 UUID leak (→ structured `DropCode` enum), `RawAvail` TIME-column documentation, explicit null-check on `restaurants.timezone`, `useGenerateSchedule` reading `FunctionsHttpError.context.json()`.
- 9 major: `withinWindow` overnight-shift guard, `normalizePosition` stem-length + `ss`-guard, structured reason codes, frontend hook 422-body extraction code, `convertExceptionsToLocal` parity, `min_crew` position-name strategy, typed `ScheduleDiagnostic`, gated "Filled X of Y" line, removed zero-shift early-return invalidate skip, single-line toast description, stable keys for `dropped_reasons`.
- Frontend minor: aria-hidden on decorative icons, `DialogDescription` wrapping, DialogContent flex layout for sticky footer.
