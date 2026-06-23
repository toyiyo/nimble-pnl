# Design: Fix false "open session" warnings from cross-employee punch collapse

**Date:** 2026-06-22
**Branch:** `fix/time-punch-session-pairing`
**File touched:** `src/utils/timePunchProcessing.ts` (pure utility) + unit tests

## Problem

Managers see employees flagged as having an **open session** (never clocked
out) on the Time Clock page even though the employee has a clock-in *and* a
clock-out for the day. Reported for Carolina Sanchez, then reproduced live for
6 employees at once (Quentin Jones, Armanii Gonzalez, Alexia Hernandez, Colby
Mullaley, Josiah Gonzalez, zachary hernandez).

The "Open for Nh Mm" timer climbs all day, so a closed session looks like a
runaway open one. A page refresh does **not** fix it.

## Root cause (proven against live production data)

Confirmed by pulling the live React Query cache from the running app and
executing the real `processPunchesForPeriod` on it — it reproduces the exact
6 open sessions shown on screen.

Two independent bugs in `src/utils/timePunchProcessing.ts`:

### Bug 1 (primary) — `normalizePunches` collapses *different employees'* punches

`normalizePunches` sorts the **entire restaurant's** punch stream by time and
treats any punches within 60 seconds of each other as duplicate "noise,"
keeping only the first and discarding the rest. **It never checks
`employee_id`.**

The 60-second window was meant to absorb a single employee fat-fingering the
clock. But when multiple employees punch within 60s of each other — which is
constant with backdated/imported punches that share round timestamps
(`15:00:00`, `19:00:00`) or any normal clock-in/out rush — unrelated
employees' punches land in the same "noise group" and get dropped.

On the live data this discarded **22 of 48 punches (46%)**, orphaning clock-ins
(→ false "open session") and clock-outs (→ lost session). It is sort-order
luck which survives, which is why **Alexia (open)** and **Colin (complete)**
have byte-identical punches (`clock_in 15:00:00`, `clock_out 19:00:00`) yet
render differently.

This is also why the original Carolina case looked "clean" when her punches
were tested in isolation but broke in the app — the bug only manifests when
multiple employees are processed together.

### Bug 2 (secondary) — `identifyWorkSessions` skips a clock-in after closing a session

After a session is closed, the per-employee loop advances with `i = j + 1`
(line ~312). When the scan stopped because it hit the *next* clock-in, `j`
already points at that clock-in, so `i = j + 1` **skips it**, dropping the
following session entirely.

This is zachary's "12:00 AM" case: he has `[clock_in 00:00, clock_in 10:02,
clock_out 14:03]`. The stray midnight clock-in opens a session, then the real
10:02–14:03 session is skipped and lost.

### Severity

The same dropped punches feed `calculateDailyHours` and the page's "Today: N
hours" total, so **worked hours are under-counted** (13 sessions counted vs. 22
real). This is a labor-hours / payroll accuracy bug, not just a cosmetic
warning.

## Fix

### Fix 1 — scope noise detection per employee

Extract the current `normalizePunches` body into `normalizeEmployeePunches`
(unchanged logic). New `normalizePunches` buckets punches by `employee_id`,
runs `normalizeEmployeePunches` on each bucket, and concatenates. Same per-
employee de-duplication behaviour is preserved; cross-employee collapse is
eliminated.

Per-employee ascending order is preserved within each bucket, which is what
`identifyWorkSessions` relies on (it groups by employee and scans forward
chronologically).

### Fix 2 — stop skipping the next clock-in

Change `i = j + 1` to `i = j` in `identifyWorkSessions`. The inner loop always
advances `j` to at least `i + 1` before any break, so `i = j` still makes
forward progress (no infinite loop) while no longer skipping the punch `j`
points at. This recovers back-to-back sessions and zachary's real session;
his genuine unclosed midnight clock-in correctly remains flagged as one open
session.

### Proven effect

Re-running the real algorithm on the live cached punches with both fixes:

| | Before | After |
|---|---|---|
| Punches dropped as noise | 22 / 48 | 3 / 48 |
| False open sessions | 6 | 1 (zachary's genuine midnight orphan) |
| Sessions counted | 13 | 22 |

## Testing

Unit tests in `tests/unit/` (vitest), using **multi-employee fixtures** — the
class of test the original investigation lacked:

1. Two employees with identical `clock_in`/`clock_out` timestamps → both
   complete, zero open (regression for Bug 1; fails on current code).
2. 3+ employees clocking in within the same second → every session preserved,
   no punch dropped.
3. Same employee genuinely double-tapping the clock within 60s → still
   de-duplicated (preserve intended behaviour).
4. Orphan leading clock-in `[in, in, out]` for one employee → first session
   open, second session complete and present (regression for Bug 2).
5. Back-to-back complete sessions `[in1, out1, in2, out2]` for one employee →
   two complete sessions (regression for Bug 2).
6. Existing `punchFunctionality` / `useTimePunches` suites stay green.

## Decided trade-offs

- **Not adding polling / realtime refresh.** The first hypothesis (stale cache,
  no `refetchInterval`) was wrong: the bug is deterministic in the pure
  function and reproduces on a fresh load. Polling would have masked nothing
  here. Out of scope.
- **zachary's residual open session is correct.** His midnight clock-in has no
  matching clock-out in the data — flagging it open is the right behaviour. The
  stray punch itself is a data-entry artifact for the manager to resolve
  (force-out/delete), not an algorithm bug.
- **Noise detection stays heuristic.** We keep the existing 60s/burst rules;
  we only scope them to the correct employee. Rethinking the heuristic itself
  is a larger effort and not needed to fix this.

## Out of scope

- Midnight rollover of the viewed date.
- Investigating where the round-number / midnight phantom punches originate
  (import path / manual entry). Tracked separately if it recurs.
