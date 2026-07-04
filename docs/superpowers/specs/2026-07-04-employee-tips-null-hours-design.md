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
   - Harden the `periodHours` reduce with `(tip.hours || 0)` so its behavior is
     explicit rather than relying on `+ null` coercion.

Approach 2 fixes the crash, keeps display semantics consistent across both tabs,
and turns the latent type hole into a compile-time check. No DB, hook, or
edge-function changes; `TipTransparency` already accepts `hours?: number | null`.

## Test plan

- Unit test (Vitest + RTL) rendering `EmployeeTips` History tab with a mocked
  approved split whose item has `hours_worked: null` — asserts no crash and no
  "hours" text; a second case with real hours asserts "X.X hours" renders.
- Typecheck enforces the new `number | null` at all `tip.hours` usages.

## Scope

- `src/pages/EmployeeTips.tsx` — type + History-tab guard + explicit reduce coercion.
- New test file under `tests/unit/`.
