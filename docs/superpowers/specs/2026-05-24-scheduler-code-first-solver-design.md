# Code-first scheduler solver with LLM preference layer

**Date:** 2026-05-24
**Status:** Design review (Phase 2.5)
**Worktree:** `.claude/worktrees/scheduler-code-first-solver`
**Branch:** `feature/scheduler-code-first-solver`
**Base commit:** `6727d416` (post-Bug-I)

## Problem

The current AI scheduler asks an LLM (Gemini 2.5 Flash) to satisfy 14 numbered hard rules in one shot — position match, area match, availability window, weekly hour cap (40h adult / 18h under-16), 5 consecutive days max, template active days, no double-booking, etc. Trace `ae991acdcf47542827da5ddee9ed5a40` (2026-05-24, 13:48 UTC) shows the model systematically violates the rules:

- Aleah Holderread (under-16, 18h cap, Mon–Fri avail 16:30–19:00 only) scheduled for **7 × 6.5h = 45.5h**, with five shifts at 10:00–16:30 entirely outside her availability.
- Termora, Helena, Lynnette (minors, 40h cap): **45.5–50.5h each**.
- Tristen, Carolina (40h cap adults): **50.5h each**.
- Javier, Quintena, Ivy: **42–45.5h**.
- 8 employees scheduled **7 days straight** (5-day rule).
- Alexa Valdez Tue shift outside availability window.
- Shy Harrison Sun shift on an unavailable day plus Fri shift outside window.
- LLM picks the **same ~12 employees** for all 70 slots, ignoring 15 other eligible servers in the pool.

The validator catches and drops ~130h of these violations correctly. Net result: **~340h scheduled vs ~491h required** (the reported "we're under-filling and some employees get zero hours").

**The LLM is the bottleneck, not the validator.** Rules 1–14 are deterministic predicates. The LLM gives them probabilistic best-effort. We can satisfy them by construction with a code-first solver, and use the LLM only where it actually adds value — interpreting free-text manager preferences and proposing schedule adjustments.

## Goals

1. **Schedule completeness:** every required slot is filled OR the response surfaces it as `unfilled` with a reason.
2. **Every emitted shift satisfies every hard rule by construction** — validator becomes a smoke test, not a primary gate.
3. **Fairness:** lowest-loaded eligible employee picks each slot first; no one gets 50h while a peer gets 0.
4. **Manager preferences honoured opportunistically** via an LLM-driven swap pass on the solver's output.
5. **One code path.** The LLM-only flow is retired. No feature flag wars between two scheduler implementations.

## Non-goals

- Globally optimal scheduling (MILP / constraint programming). Greedy with most-constrained-first ordering is good enough for ~30 employees × ~70 slots and is the simplest thing that satisfies the goals.
- Solving for tip equity, seniority, or "manager prefers Alex on Saturdays" as hard constraints. Those become **soft** preferences expressed in free text.
- Replacing locked shifts. Locked shifts are still inputs; the solver assigns the open slots around them.
- Changing the `shifts` insert contract or the `shift_template_id` persistence path. Those stay.

## Architecture

```
                           generate-schedule edge function
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│  1. Auth + permission check                                             │
│  2. Fetch context (10 parallel queries — unchanged)                     │
│  3. Build ScheduleContext (employees, templates, availability,          │
│     requiredStaff, lockedShifts, hour budgets — unchanged)              │
│                                                                         │
│  4. ───── NEW: solveSchedule(context) ─────────────────────────────┐   │
│                                                                    │   │
│       returns { shifts, unfilled, fairness }                       │   │
│       every shift satisfies all 14 hard rules                      │   │
│                                                                    │   │
│  5. ───── NEW (optional): applyPreferences(schedule, prefsText) ──┐   │
│                                                                    │   │
│       LLM proposes swap pairs; solver re-validates each swap       │   │
│       only fires when prefsText is non-empty                       │   │
│                                                                    │   │
│  6. Validate (defense-in-depth) → persist → response               │   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

## The solver (`supabase/functions/_shared/schedule-solver.ts`)

Pure-TS module. One exported function:

```ts
solveSchedule(ctx: ScheduleContext): SolverResult

interface SolverResult {
  shifts: GeneratedShift[];      // every shift passes all hard rules
  unfilled: UnfilledSlot[];      // slots with no eligible employee
  fairness: FairnessSummary[];   // per-employee hours/days actually assigned
}
```

`UnfilledSlot = { template_id, day, position, area, reason }` where `reason ∈ {NO_ELIGIBLE_EMPLOYEE, ALL_AT_HOUR_CAP, ALL_AT_CONSEC_DAY_CAP, ALL_UNAVAILABLE}`. The slot was wanted; nobody legal was free.

`FairnessSummary = { employee_id, hours_assigned, days_worked, hours_budget }` (no name — surfaces only on server logs unless we add a `ClientSafe*` projection).

### Algorithm

**Stage A — Enumerate slots.** For each `(templateId, day)` in `ctx.requiredStaff`, materialize `count` slots. Each slot carries `{ template_id, day, day_of_week, start_time, end_time, position, area }`. Skip when `template.days` does not include `day_of_week` (defends against the same Bug C the validator caught — solver-side cheaper to skip than produce-then-drop).

**Stage B — Seed state from locked shifts.** Walk `ctx.lockedShifts`, increment per-employee `hoursByEmp`, add `day` to per-employee `daysByEmp`. Locked shifts count against caps but are not re-assigned. The solver will produce a schedule that fits *around* them.

**Stage C — Score slot scarcity.** For each slot, compute `|eligibleBase(slot)|` where `eligibleBase` checks the static predicates only:

- `normalizePosition(emp.position) === normalizePosition(slot.position)`
- `emp.area === slot.area || slot.area === null || emp.area === null` (mirrors validator's null-permissive area rule)
- `availability[emp.id][slot.day_of_week].available === true`
- `withinWindow(slot.start_time, slot.end_time, avail.start, avail.end)`
- `!ctx.excludedEmployeeIds.has(emp.id)` (already filtered upstream, defensive)

Sort slots **ascending** by `|eligibleBase|`. Ties broken by: weekend (Sat/Sun) before weekday → earliest `start_time` → stable insertion order. This is the "most-constrained-first" heuristic: a slot only 2 employees can cover gets first pick at those 2 employees before another slot might consume them.

**Stage D — Greedy assign.** Walk slots in scarcity order. For each slot:

1. Filter `eligibleBase` further by *dynamic* predicates (depend on slot order, not slot identity):
   - **Hour budget:** `hoursByEmp.get(emp.id) + shiftHours(slot) ≤ emp.max_weekly_hours` (uses `computeHourBudget` already wired upstream — 18h for under-16, 40h otherwise).
   - **Consecutive days:** add `slot.day` to a copy of `daysByEmp.get(emp.id)`, run `longestConsecutiveRun` from `schedule-validator.ts`, require result `≤ 5`.
   - **No conflict:** for every already-assigned shift of this employee, `shiftsConflict(slot, existing) === false`. Uses the cross-midnight-aware helper added in PR #506.
2. From the filtered set pick the employee with the **lowest `hoursByEmp.get(emp.id)`**. Tie-break: fewer entries in `daysByEmp.get(emp.id)` → stable order by `emp.id`.
3. If the filtered set is empty: append to `unfilled` with the most narrowing reason (`ALL_AT_HOUR_CAP` if eligibleBase non-empty but step 1's hour check zeroed it; etc.). Do **not** synthesize a violating shift.
4. Otherwise: append the new shift, increment `hoursByEmp[picked]`, add `slot.day` to `daysByEmp[picked]`.

**Stage E — Return** `{ shifts, unfilled, fairness }`.

### Reused helpers (no duplication)

`schedule-validator.ts` already exports `withinWindow`, `normalizePosition`, `shiftHours`, `shiftsConflict`, `longestConsecutiveRun`, `getDayOfWeek`, `timeToMinutes`. The solver imports them directly. Single source of truth for predicate semantics.

### Determinism + TZ safety

- Slot enumeration walks `ctx.requiredStaff` in `Map` iteration order (insertion order, stable across runs given the same data).
- Day-of-week derivation uses `getDayOfWeek(slot.day)` — UTC-anchored, matches `buildWeekDates` from Bug H fix. Same fairness call on the same input must produce byte-identical output, host-TZ-independent. Test will assert America/Chicago vs Pacific/Auckland produce identical results.

## The LLM preference layer (`supabase/functions/_shared/schedule-preference-llm.ts`)

Only invoked when the manager submits non-empty `preferences` text.

```ts
applyPreferences(
  schedule: GeneratedShift[],
  ctx: ScheduleContext,
  preferencesText: string,
  modelChain: ModelConfig[],
): Promise<PreferenceResult>

interface PreferenceResult {
  shifts: GeneratedShift[];      // post-swap, still all hard rules
  appliedSwaps: SwapRecord[];    // for the success-toast detail
  rejectedSwaps: RejectedSwap[]; // for transparency in logs
  modelUsed: string | null;      // null when no LLM call was needed
}
```

### Prompt contract (much narrower than today's SYSTEM_PROMPT)

System message: "You receive a confirmed schedule and a manager preference statement in free text. Propose up to N **pair-swaps** that move toward the preference. Each swap exchanges the employee on shift A with the employee on shift B. Output a JSON array `swaps: [{ shift_a_id, shift_b_id, reason }]`. Do not invent new shifts. Do not change start/end times. You do not need to verify hard rules — the server re-validates every swap and rejects illegal ones. Aim for ≤ 5 swaps per call. If the preference is already satisfied or no safe swap exists, return `[]`."

User message: the schedule as a compact table (`shift_id | day | start-end | position | employee_name`), and the preferences text verbatim.

### Swap application

For each proposed swap `(A, B)`:

1. Look up shifts A and B by id; if either missing → reject (`UNKNOWN_SHIFT`).
2. Swap `employee_id`. The two shifts are now tentative.
3. For each touched employee (both old and new of each shift), recompute hours + days + conflicts and check all hard rules **including hour cap and consecutive-day**. If any rule breaks for either of the two employees → reject (`WOULD_VIOLATE_<RULE>`), restore the original assignment.
4. Otherwise commit; record swap.

**Iteration cap:** the LLM is called at most twice. Round 1: propose ≤ 5 swaps. Apply legal ones. Round 2 (only if round 1 applied ≥ 1 swap): present the updated schedule + the original preferences and ask "anything else?". This prevents infinite "shuffle a little more" loops and bounds the total LLM cost at ~$0.06/run.

**Budget guard:** wall-clock budget for the preference call shares the edge function's 130s ceiling. If the solver took 4s and the first preference call took 20s, the second is allowed up to ~60s. Bounded by the same `runScheduleModelChain` helper currently used for the LLM-first path, which already handles per-call AbortSignal + total-budget (PR #506 lesson [2026-05-17]).

### Why the LLM here is *safe*

The current LLM has the entire schedule synthesis to do — 70 slots × 27 employees × 14 rules — and it gets things wrong because the search space is huge. The swap LLM has a trivial job: read a 70-row table and a sentence, propose a list of (shift_a, shift_b) pairs. Any pair it proposes that breaks a hard rule is **silently rejected by the server**. The worst case for a bad swap proposal is the preference doesn't get applied — never an illegal schedule.

## UI changes

### `src/components/scheduling/ShiftPlanner/GenerateScheduleDialog.tsx`

This is the dialog that fronts `useGenerateSchedule` (mounted from `ShiftPlannerTab.tsx:108`). Add one `Textarea` inside the dialog body, above the Generate button:

```
<Label className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
  Preferences (optional)
</Label>
<Textarea
  className="text-[14px] bg-muted/30 border-border/40 rounded-lg
             focus-visible:ring-1 focus-visible:ring-border min-h-[80px]"
  placeholder="e.g. Termora prefers weekends. Keep Helena off Mondays. Aleah only after 16:30 on school days."
  value={preferences}
  onChange={(e) => setPreferences(e.target.value)}
  aria-label="Schedule preferences"
  maxLength={2000}
/>
```

Counter visible at `≥ 1800` chars. Empty input → no LLM call. Following the project's Apple/Notion typography scale and semantic tokens (CLAUDE.md). Three-state rendering for the mutation: loading button → success toast → error toast.

### `src/hooks/useGenerateSchedule.ts`

Add `preferences?: string` to `GenerateScheduleParams`. Pass through to the edge function payload as `preferences_text`. Add `applied_swaps_count` and `rejected_swaps_count` to `GenerateScheduleMetadata`. Surface in the success toast: *"3 shifts adjusted for preferences (2 changes couldn't be applied)"* when non-zero.

## Retirement of the LLM-only path

After the solver lands and tests pass against the trace's restaurant data:

1. **Remove** the SYSTEM_PROMPT-with-14-rules from `schedule-prompt-builder.ts`. Keep `computeHourBudget` (called by edge function for `max_weekly_hours`) and `buildWeekDates` (still useful for the preference prompt's table). Move the swap-proposer prompt into `schedule-preference-llm.ts`.
2. **Remove** `buildSchedulePrompt`, `buildUserPrompt`, `SchedulePromptResult` — no consumers after step 5.
3. **Trim** the `SCHEDULE_MODELS` chain in `generate-schedule/index.ts`. The primary path no longer uses any LLM — the chain only fires for the optional preference swap call. Drop from 5 models down to 2 (Gemini 2.5 Flash primary + Gemini 2.5 Flash Lite fallback). Move the constant into `schedule-preference-llm.ts`.
4. **Keep** `schedule-ai-runner.ts` (`runScheduleModelChain`) — it provides the wall-clock budget guard from PR #506 (lesson [2026-05-17]) that we still want for the swap call. Its only consumer becomes `schedule-preference-llm.ts`. Source-text test asserts `generate-schedule/index.ts` no longer imports it.
5. **Keep** `schedule-validator.ts` as a defense-in-depth pass on the solver's output. Every emitted shift should pass with `dropped.length === 0`; if it doesn't, that's a solver bug we want to catch in CI.

Removed files / removed exports get **negative source-text tests** to prevent regression: a small test reads `index.ts` and asserts `runScheduleModelChain` no longer appears outside the preference module, etc. (Same pattern as PR #504's mobile breakpoint guards — lesson [2026-05-17].)

## Tests (TDD targets)

Phase 4 will add these in roughly this order:

### `tests/unit/schedule-solver.test.ts`

1. **Smoke:** empty `requiredStaff` → `{ shifts: [], unfilled: [], fairness: [...] }` (one fairness row per employee with 0h).
2. **Single slot, single eligible employee:** assigns it.
3. **Single slot, no eligible employee:** returns it in `unfilled` with `NO_ELIGIBLE_EMPLOYEE`.
4. **Position match + area match:** rejects same-position different-area when slot has an area.
5. **Availability window:** rejects shift outside `avail.start`–`avail.end` (Aleah case from the trace).
6. **Hour-cap respects `max_weekly_hours`:** Aleah's 18h cap from `computeHourBudget` is honoured — solver fills first 2 shifts (13h), refuses 3rd 6.5h shift, surfaces `unfilled` if no peer can cover.
7. **5-consecutive-day cap:** 5 shifts Mon-Fri then attempt to assign Sat → rejected; Sun-Thu then Fri → rejected (consec run = 6).
8. **Cross-midnight conflict:** uses `shiftsConflict`; overnight + next-morning is a conflict; consecutive normal day shifts are not.
9. **Fairness:** with 2 equally-eligible employees and 4 slots that fit both, the 2nd slot picks the one with the lower current `hoursByEmp`; result distributes 2 + 2 not 4 + 0.
10. **Locked shifts seed state:** locked 6.5h shift on Mon → that employee's hours_assigned starts at 6.5, fills toward cap accordingly.
11. **Most-constrained-first ordering:** slot with `|eligibleBase| = 2` gets its pick before a slot with `|eligibleBase| = 20` runs the scarce employees down.
12. **Trace replay:** feed the exact `ScheduleContext` from trace `ae991acdcf47542827da5ddee9ed5a40` (Aleah 18h, 27 employees, 8 templates, restored from a fixture) and assert: Aleah hours ≤ 18; no employee > 40h (or > 18h if under-16); no employee has 6+ consecutive days; total assigned hours within 95% of `total_required_slots × avg_slot_hours`. This is the truth-test.
13. **TZ portability:** America/Chicago and Pacific/Auckland produce identical `{ shifts, unfilled, fairness }` (same pattern as `computeHourBudget` test added in Bug I).

### `tests/unit/schedule-preference-llm.test.ts`

14. **No preference text → no LLM call:** `applyPreferences(schedule, ctx, '', models)` returns the input shifts untouched, `modelUsed: null`, no fetch made (assert via mocked fetch counter).
15. **Swap that violates hour cap → rejected:** mock LLM returns a swap that would put an under-16 minor over 18h; result has `appliedSwaps: []`, `rejectedSwaps: [{ reason: 'WOULD_VIOLATE_MINOR_HOURS_EXCEEDED' }]`.
16. **Swap that violates availability → rejected:** same shape, code `WOULD_VIOLATE_OUTSIDE_WINDOW`.
17. **Legal swap → applied:** schedule reflects the swap; `appliedSwaps.length === 1`; the returned shifts still pass the validator.
18. **Unknown shift_id → rejected:** `UNKNOWN_SHIFT`.
19. **LLM returns malformed JSON → no swaps applied, error logged.**

### `tests/unit/generate-schedule-integration.test.ts` (or e2e edge function harness)

20. **Solver-only path:** call edge function with `preferences_text` omitted; response includes shifts that all pass the validator (defense-in-depth pass).
21. **Solver + preference path:** with a non-empty preferences text and a mocked OpenRouter, response includes swap metadata.
22. **Retired-path guard (source-text):** assert that `index.ts` no longer imports `buildSchedulePrompt`.

## Decided trade-offs

- **Greedy not MILP.** Greedy with most-constrained-first is well-known to produce strong (within ~5% of optimal) results on small bipartite-like problems and is auditable line-by-line. If fairness complaints arise after launch we can swap in a stronger solver behind the same interface (`solveSchedule(ctx) → SolverResult`) without UI or persistence churn.

- **Free text > structured preferences.** A per-employee preferred-days picker would be solver-readable with no LLM call at all, but the UX cost of building/maintaining it is high and the user has flexibility we'd lose ("only after school", "every other Sat"). Free text wins for now; we can layer a structured picker on top later if managers ask.

- **Retiring the LLM-only path (not flag-gating it).** Per user direction: "We must cleanup unused paths." A flag would let two implementations rot in parallel. The solver tests + a small canary deploy give us enough confidence; if it breaks we revert PR.

- **The validator stays.** Even with the solver, the validator earns its keep as a defense-in-depth smoke test (catches a regression in the solver before shifts persist). The DropCode `dropped_reasons` surface is also still useful for `unfilled` reasons in the response — same shape, slightly different cause.

- **Two-pass LLM preference budget.** A single pass would leave some preferences un-applied if a swap depends on a prior swap. Three+ passes risk the LLM "improving" the schedule indefinitely. Two passes balance applicability against cost (~$0.06/run worst case, $0 when prefs empty).

- **Locked shifts as seeds.** Solver does NOT try to relocate locked shifts — locked = "managers said so." Solver only fills the un-locked headroom. This matches today's behaviour and is what the planner UI expects.

## File touch list

**New:**
- `supabase/functions/_shared/schedule-solver.ts` (~300 lines)
- `supabase/functions/_shared/schedule-preference-llm.ts` (~200 lines, half of which is the prompt template)
- `tests/unit/schedule-solver.test.ts`
- `tests/unit/schedule-preference-llm.test.ts`
- `tests/fixtures/schedule-solver-trace.json` (sanitised replay of `ae991acdcf47542827da5ddee9ed5a40`)

**Modified:**
- `supabase/functions/generate-schedule/index.ts` — replace the LLM call with `solveSchedule()` + optional `applyPreferences()`. Drop the SCHEDULE_MODELS array (moves to preference module). ~120 lines deleted, ~40 added net.
- `src/hooks/useGenerateSchedule.ts` — add `preferences` to params, surface swap metadata in toasts.
- `src/components/scheduling/ShiftPlanner/GenerateScheduleDialog.tsx` — add Textarea for preferences.
- `supabase/functions/_shared/schedule-prompt-builder.ts` — keep `computeHourBudget` (consumed by `generate-schedule/index.ts:253` for `max_weekly_hours` dispatch); move `buildWeekDates` into the preference module if it's the only consumer left, otherwise keep. Remove `SYSTEM_PROMPT`, `buildUserPrompt`, `buildSchedulePrompt`, `SchedulePromptResult`.

**Mostly untouched (defense-in-depth only):**
- `supabase/functions/_shared/schedule-validator.ts` — no API change; still runs on every solver output.
- `supabase/functions/_shared/staffing-requirements.ts` — solver still consumes `requiredStaff`.
- `supabase/functions/_shared/availability-tz.ts` — solver still consumes converted availability.

**Removed (verified zero consumers, source-text guard added):**
- None as a result of retirement step 4 — `schedule-ai-runner.ts` is kept and re-pointed at the preference module.

## Rollout

1. **Deploy** the solver + preference module + UI to production. No flag. (User-stated direction.)
2. **Monitor** the next 7 days of `[generate-schedule]` logs for:
   - Solver duration p95 (target: < 500ms — solver is pure-TS on ~30 emps × ~70 slots).
   - `unfilled.length > 0` rate. If high, restaurants have impossible headcount targets — UI should show it; that's information, not a regression.
   - Validator drops on solver output. Should be **zero**. Any non-zero is a solver bug — alert.
   - LLM preference call rate. Tells us how often managers use the textarea.
3. **Retire** the validator's `dropped_reasons` text catalog if it's no longer customer-facing (solver `unfilled` reasons subsume it). Deferred to a follow-up PR.

## Open questions for Phase 2.5 reviewers

- **Supabase reviewer:** any concern with the solver running inside the edge function vs. moving to a Postgres function? (Edge keeps the 10-query data fetch and the assembly in one place; SQL would mean serialising the context twice.)
- **Frontend reviewer:** is a single 2000-char `Textarea` the right primitive, or should the preferences UI be a slide-over panel? (Designing the simplest thing now; can iterate if managers ask.)

## Risks

- **The trace fixture in test 12 is large.** Mitigation: sanitise UUIDs to deterministic short strings, keep it ~50KB in the repo. If the fixture drifts from production reality, the test becomes a false negative — re-snapshot quarterly.
- **Two-pass LLM preference layer + slow models** could exceed the 130s edge budget on a particularly long prompt. Mitigation: the preference prompt is *much* smaller than the current SYSTEM_PROMPT (no rules, no employee budgets, just a shift table). Each call should land in 10-20s.
- **The solver's fairness rule favours hours-balance over manager intent.** Managers who want "Bob always opens" will need to express it via preference text; if the LLM can't translate to a swap they're stuck. Mitigation: surface `unfilled` and `applied_swaps_count` in the toast so managers see *why* their preference didn't stick.
