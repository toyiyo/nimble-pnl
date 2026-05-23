# AI Schedule LLM Date-Map Fix (Bug H)

**Status:** Approved
**Date:** 2026-05-23
**Branch:** `fix/ai-schedule-llm-date-map`

## Summary

Replace the bare `Week starting: <YYYY-MM-DD>` block in the AI schedule
generator's prompt with an explicit day-name → date map, and inline the
matching date alongside each entry in the `Required Headcount Per Slot`
section. This removes all calendar math from the LLM's plate so it can
no longer drift weekend templates onto Monday or week templates onto
Friday.

## Background

The AI schedule generator (`supabase/functions/generate-schedule`)
builds a prompt via `_shared/schedule-prompt-builder.ts` and asks an
OpenRouter model to return a JSON array of shifts. Each emitted shift
carries a `day: YYYY-MM-DD` field.

Today the prompt opens with:

```
## Target Week
Week starting: 2026-06-08
```

Templates list their active days by *name* (`active days: Monday,
Tuesday, …`). The LLM has to derive the date for each named day itself,
using the bare `Week starting: 2026-06-08` anchor.

In production (restaurant `7c0c76e3-e770-401b-a2a9-c1edd407efed`,
America/Chicago, 8 templates, 69 weekly required slots) the LLM
consistently shifts day-name → date by +1 day:

- Weekend templates (`days = [0, 5, 6]` = Sun/Fri/Sat) get emitted on
  Mon (06-08), Sat (06-13), Sun (06-14).
- Week templates (`days = [1, 2, 3, 4]` = Mon/Tue/Wed/Thu) get emitted
  on Tue (06-09), Wed (06-10), Thu (06-11), Fri (06-12).

The `DAY_NOT_IN_TEMPLATE` validator (PR #511) correctly drops every
mis-dated shift, but the resulting partial-fill schedule under-fills by
~151 hours (Mon = 0/X, Fri = 0/X in the planner UI).

The most likely explanation for the drift is that the LLM is reading
`06-08` through a "Sunday-first US calendar" lens. June 8 2026 is
actually a Monday, but with no explicit anchoring, the LLM treats it as
Sunday, then assigns each named day to the next calendar slot — a
classic off-by-one.

## Decision

Patch the prompt at the two surfaces where dates appear:

1. **Target Week section** — emit a 7-row day-name → date map, ordered
   Monday … Sunday. This pins every name to a specific date with no
   inferential leap.
2. **Required Headcount Per Slot lines** — inline the matching date on
   each `<DayName>: <count>` pair so the LLM never has to look back at
   the Target Week section to compute a date.

The validator already drops `DAY_NOT_IN_TEMPLATE` (PR #511) and stays as
the second-layer safety net — defense in depth, per lesson [2026-05-22].

## Detailed design

### Output shape (Target Week)

```
## Target Week
Each day of the week maps to this exact date. Use these dates verbatim
in every shift you emit — do not compute dates yourself.
  Monday    2026-06-08
  Tuesday   2026-06-09
  Wednesday 2026-06-10
  Thursday  2026-06-11
  Friday    2026-06-12
  Saturday  2026-06-13
  Sunday    2026-06-14
```

Ordering rationale: Monday-first ordering matches the natural reading
order for restaurant work weeks and discourages the LLM from re-anchoring
on the first row it sees. The week-start anchor (`ctx.weekStart`,
guaranteed by callers to be a Monday) is positioned at the top.

### Output shape (Required Headcount Per Slot)

Before:
```
- [ef3b61d3] "Open-weekend-csc" | Server | Sunday: 2 | Friday: 2 | Saturday: 2
```
After:
```
- [ef3b61d3] "Open-weekend-csc" | Server | Sunday 2026-06-14: 2 | Friday 2026-06-12: 2 | Saturday 2026-06-13: 2
```

### Date computation

A small helper inside `schedule-prompt-builder.ts` derives the seven
dates from `ctx.weekStart` (a `YYYY-MM-DD` string). To avoid the host-TZ
hazard documented in lesson [2026-05-10] (*Switching a Date's anchoring
convention requires auditing every helper that reads .getUTC*()*), the
helper:

- Parses `ctx.weekStart` as a UTC date (`new Date(\`${ctx.weekStart}T00:00:00Z\`)`).
- Adds offsets in UTC (`new Date(base.getTime() + days * 86_400_000)`).
- Formats back using UTC accessors (`.getUTCFullYear/Month/Date`).

That way the helper returns the same date string for every process TZ
(local dev, CI UTC, prod UTC). The TZ-discipline-rule in the prompt
itself stays: "All times in this context are in the restaurant local
clock" — the dates are calendar-day strings, not wall-clock instants,
so there's no conflict.

### Day-of-week numbering

The existing `DAY_NAMES` array is Sunday-first (0=Sun..6=Sat, matching
JS `Date.getDay()`). The Target Week map renders rows in Monday-first
order, but the underlying numbering is unchanged; the validator still
reads `getDayOfWeek(shift.day)` and compares against `template.days`,
which uses the existing 0=Sun convention. Only the *display order* in
the prompt changes.

## Out of scope

- **Server-side date materialization.** Long-term it would be cleaner
  to have the LLM emit `(template_id, day_of_week)` and let us
  materialize the date in the validator. That would touch the response
  schema, validator, `useGenerateSchedule`, and any planner read path
  that consumes `shifts[].day`. Out of scope for this PR; revisit if
  the prompt-level fix doesn't fully resolve the drift in production.
- **Changes to the validator.** `DAY_NOT_IN_TEMPLATE` (PR #511) already
  catches the drift today. No validator changes needed.
- **Hourly sales / prior schedule patterns.** These already use day
  names without dates; not changed in this PR.
- **`generate-schedule/index.ts` lines 109–116 calendar-window math.**
  The caller derives `fourWeeksAgo` and `weekEndStr` via
  `new Date(week_start)` (parsed as UTC midnight by spec) then
  `.toISOString().split("T")[0]`. This is UTC-stable on prod and CI but
  would drift on a non-UTC dev box. Pre-existing footgun, not touched
  by this PR; flag for a separate follow-up if it bites.

## Helper-composition invariant (do not compose with `getDayOfWeek`)

The new date helper inside `schedule-prompt-builder.ts` operates on a
caller-supplied `weekStart` (`YYYY-MM-DD`) and is intentionally
UTC-anchored. The validator's `getDayOfWeek(day)` in
`schedule-validator.ts` operates on LLM-emitted `YYYY-MM-DD` strings
and uses the local-time `new Date(year, month-1, day)` constructor.

The two helpers handle distinct inputs and MUST NOT be composed. To
prevent cargo-culting in a future change, the new helper's JSDoc names
this explicitly and the validator's `getDayOfWeek` gets a one-line
comment pointing back. The numerical day-of-week values they produce
agree for any process TZ today (both treat a bare `YYYY-MM-DD` as the
calendar day named, and the resulting `.getUTCDay()` /  `.getDay()` on
a midnight Date always land on the same weekday), so this is a comment
fix, not a code fix.

## Testing

A new test block in `tests/unit/schedule-prompt-builder.test.ts`:

- Positive: prompt contains all seven *exact* day-name/date pairs for a
  week starting on a Monday — e.g. given `weekStart = "2026-06-08"` the
  output contains the literal strings `"Monday    2026-06-08"`,
  `"Tuesday   2026-06-09"`, …, `"Sunday    2026-06-14"`. This locks in
  the UTC-midnight + ms-offset arithmetic; if the helper accidentally
  used the local-time constructor and shifted, this test fails on a
  non-UTC dev box.
- Positive: when `requiredStaff` is provided, the lines under "Required
  Headcount Per Slot" contain `<DayName> <YYYY-MM-DD>: <count>` (e.g.
  `Sunday 2026-06-14: 2`).
- Negative: the bare `Week starting: <date>` failure-mode string is not
  present (locks the regression — adding `Week starting: …` back without
  the map would be a regression).
- TZ portability: tests construct `weekStart` as a string literal, so
  they produce identical output in any process TZ.

## Acceptance

- All unit tests pass locally and in CI (UTC).
- Typecheck, lint, build, Supabase preview, Database tests (pgTAP) all
  green.
- After ship, observe a Bug H–affected restaurant generate a schedule
  and confirm the planner UI shows Monday and Friday filled (no more
  0/X under those columns) in a real OpenRouter response.

## References

- Prior fix PR #511 (capacity / template-active-days / persist
  template_id) — `DAY_NOT_IN_TEMPLATE` validator landed here.
- Prior fix PR #513 (position-anchored validator + open+close overlap
  Rule 5).
- Prior fix PR #515 (streaming AI path).
- Lessons: [2026-05-22] Schema → Consumer Contract Drift,
  [2026-05-10] Date anchoring convention,
  [2026-05-17] Triage by writing the regression test first.
