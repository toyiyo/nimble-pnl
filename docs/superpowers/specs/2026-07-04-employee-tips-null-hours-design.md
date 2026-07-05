# BUG-002: null.toFixed() crash on /employee/tips — design

## Bug report

- **Severity:** MEDIUM, 3 occurrences, Android Chrome only, on `/employee/tips`.
- **Symptom:** `TypeError` — `.toFixed()` called on `null` during the tips list render.
- Error-tracking search in PostHog (project 233023) found no matching issue under
  "toFixed" or the `/employee/tips` URL in the last 90 days — the report likely comes
  from an older window or a different tracker. Static analysis pinpoints the crash
  site deterministically, so the fix does not depend on the stack trace.

## Root cause

`TipSplitItem.hours_worked` is typed `number | null`
([useTipSplits.tsx:28](../../../src/hooks/useTipSplits.tsx)) and manual splits store
`share.hours || null` (line 181). `EmployeeTips.tsx` maps it straight into a local
`tip.hours` field declared as plain `number` (the object literal is built inside
`useMemo` with an inline type annotation, so the null flows through unchecked at
line 138).

Three render sites consume `tip.hours`:

| Site | Guarded? | Crash? |
|---|---|---|
| `EmployeeTips.tsx:187` — `periodHours.toFixed(1)` | reduce coerces (`sum + null` → number) | No |
| `EmployeeTips.tsx:270` — Breakdown tab | `Boolean(tip.hours) && …` | No |
| `EmployeeTips.tsx:377` — **History tab** | **none** | **Yes — `null.toFixed(1)`** |
| `TipTransparency.tsx:51` | `employeeTip.hours && …` (line 47) | No |

Adjacent sites audited and confirmed safe (per Phase 2.5 frontend review):

- `totalTeamHours` — the reduce at `EmployeeTips.tsx:142` already coerces with
  `(item.hours_worked || 0)`, so `TipTransparency.tsx:52`'s unconditional
  `totalTeamHours.toFixed(1)` always receives a number. No change needed.
- `TipDispute.tsx` — renders in the same card row but does not consume
  `hours`/`hours_worked` at all. Non-consumer, no change needed.
- `TipTransparency`'s `EmployeeTip` interface already types
  `hours?: number | null` (`TipTransparency.tsx:16`), so the nullable type
  crosses that component boundary without any prop-contract change.

So the crash fires exactly when an employee with an approved **manual** tip split
(no hours recorded) opens the **History** tab. "Android Chrome only" is a
population artifact — employees view this page on phones — not a browser bug.

## Approaches considered

1. **Coerce to zero:** `(tip.hours ?? 0).toFixed(1)` — matches the bug-report
   suggestion literally, but renders a fake "0.0 hours" for manual splits where no
   hours exist. Lessons.md (2026-04-22, synthetic-zero entry) warns against
   presenting synthetic 0 for absent data.
2. **Hide when absent (chosen):** conditionally render the hours line in the
   History tab exactly like the Breakdown tab already does
   (`Boolean(tip.hours) && …`). Null means "no hours recorded", and the page
   already has an established idiom for it. Additionally:
   - Type the `myTips` entry as `hours: number | null` so the compiler enforces
     guards at every consumption site (this is what would have prevented the bug).
   - Make the `periodHours` reduce explicit with `(tip.hours || 0)`. Note: this
     is **not** a bug fix — `sum + null` already coerces to a number, so
     `EmployeeTips.tsx:187` was never broken. It only removes implicit `+ null`
     coercion for readability once the field is typed nullable.

Accepted trade-off: hiding the hours line makes History-tab card heights vary
between rows with and without recorded hours. Accepted — it matches the
Breakdown tab's existing behavior for the same data, and is preferable to a
fabricated "0.0 hours".

Approach 2 fixes the crash, keeps display semantics consistent across both tabs,
and turns the latent type hole into a compile-time check. No DB, hook, or
edge-function changes; `TipTransparency` already accepts `hours?: number | null`.

## Test plan

- Unit test (Vitest + RTL) rendering `EmployeeTips` History tab with a mocked
  approved split whose item has `hours_worked: null` — asserts no crash and no
  "hours" text; a second case with real hours asserts "X.X hours" renders.
- Aggregate case: a split whose `items` mix null and non-null `hours_worked` —
  asserts the period-summary hours total and `totalTeamHours` treat nulls as 0
  (renders without crash, sums only real hours).
- Typecheck enforces the new `number | null` at all `tip.hours` usages.

## Scope

- `src/pages/EmployeeTips.tsx` — type + History-tab guard + explicit reduce coercion.
- New test file under `tests/unit/`.
