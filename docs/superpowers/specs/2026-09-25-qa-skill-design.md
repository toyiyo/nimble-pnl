# QA skill (`/qa`) and mandatory /dev Phase 8.5 — design

Date: 2026-09-25
Status: proposed

## Problem

The `/dev` pipeline checks code, not behavior as a user sees it.

- Phase 8 (Verify) runs the automated suites only:
  `.claude/workflows/dev-build-and-ship.js:695` runs `npm run test`,
  `test:db`, `test:e2e`, `typecheck`, `lint`, and `build`.
- The E2E gate asks for a spec that "exercises the new behavior"
  (`.claude/skills/development-workflow/SKILL.md:602-610`). The spec author
  also wrote the feature, so the spec tests what the author expected.
- No phase opens the app and uses the changed flow like a tester. No phase
  looks at empty or error states, other roles, mobile width, or console errors
  unless a spec author thought of them.
- The Ship phase starts directly after Verify
  (`.claude/workflows/dev-build-and-ship.js:712`).

Lessons in `memory/lessons.md` show the cost. A mobile layout bug did not
show on a fresh seed because it needed specific data
(`memory/lessons.md:991-994`). A stale dev server served old code and looked
like a code bug (`memory/lessons.md:1015-1018`).

## Goal

1. Add a `qa` skill. A user can run it alone as `/qa`.
2. Run the same skill as a mandatory phase of every `/dev` run, between
   Verify and Ship. No skip path exists for code changes.

## Decisions (from the user, 2026-09-25)

| Question | Decision |
|---|---|
| QA scope | Manual-style browser QA on local Supabase, with evidence. |
| `/dev` slot | New Phase 8.5, after Verify, before Ship. A QA bug blocks the PR. |
| On a bug in `/dev` | Fix, add a regression test, re-run Verify and QA. Max 3 rounds, then `needs_human`. |
| Standalone default | Test the current branch diff against `origin/main`. Accept a PR number or free-text focus. |

## Approaches considered

1. **Prompt-only phase.** Add one QA paragraph to the workflow prompts. Cheap,
   but a standalone `/qa` does not exist, and the two workflow scripts drift.
2. **Skill + thin workflow phase (chosen).** One `SKILL.md` holds the QA
   method. The two workflow scripts call it with a short prompt and enforce
   the result in the script layer. `/qa` and `/dev` run the same method.
3. **Skill + deterministic runner script.** A Node runner builds the charter
   and drives the browser. Too rigid: each change needs different flows, so
   an agent must write the checks.

## Design

### Files

| File | Change |
|---|---|
| `.claude/skills/qa/SKILL.md` | New. The QA method. User-invocable as `/qa`. |
| `.claude/skills/qa/playwright.qa.config.ts` | New. Playwright config for scratch QA specs. |
| `.gitignore` | Add `dev-tools/qa/` (scratch specs, screenshots, report). |
| `.claude/workflows/dev-build-and-ship.js` | New `QA` phase after `Verify`. Post-QA re-verify. QA summary into Ship and Done Gate. |
| `.claude/workflows/dev-continue-verify-and-ship.js` | Same `QA` phase. This script also runs Verify then Ship (`:296`, `:339`). |
| `.claude/skills/development-workflow/SKILL.md` | New Phase 8.5 section, quick-reference row, and never-skip entry. |
| `.claude/commands/dev.md`, `.claude/hooks/dev-phase-guard.sh`, `CLAUDE.md` | Name Phase 8.5 / QA where they list phases. |
| `tests/unit/workflowQaPhase.test.ts` | New. Script-layer tests through `dev-tools/workflow-harness.mjs`. |
| `tests/unit/workflowRunawayGuards.test.ts` | Add a `qa` response to `defaultResponder`. |

### The QA method (`.claude/skills/qa/SKILL.md`)

**Modes.** `report` (default for `/qa`): find and report bugs, change no
code. `fix` (`/dev` Phase 8.5, or `/qa --fix`): run the fix loop.

**Step 1 — Scope.** Read `git diff origin/main...HEAD --name-only`. Read the
acceptance source: the design doc and plan in `/dev`; the PR body for
`/qa <PR>`; commit messages plus the focus text otherwise.
If the diff touches only docs, `.claude/`, or CI config, return a justified
exception with one sentence. This is the only skip.

**Step 2 — Environment preflight.** Check each item and print the raw value:

- `node_modules/.bin/vite` exists.
- `.env.local` sets `VITE_SUPABASE_URL` to `127.0.0.1:54321` or
  `localhost:54321`. The same regex as the Phase 1 readiness check
  (`.claude/skills/development-workflow/SKILL.md:133-136`).
- Local Supabase answers (`npx supabase status`).
- No stale dev server on the QA port. Playwright reuses any server on the
  port (`playwright.config.ts:77`), and a stale one serves old code.

If `.env.local` is not local, stop with `needs_human`. QA never signs up users
on production.

**Step 3 — Charter.** Write one row per user-facing behavior the change
touches. Each row has: behavior, acceptance criterion, data precondition,
and the lenses that apply. Also add one adjacent flow: a screen that imports
a changed component or hook (find it with `grep`).

**Step 4 — Execute.** Write scratch Playwright specs in
`dev-tools/qa/scratch/`. Run them with
`npx playwright test --config .claude/skills/qa/playwright.qa.config.ts`.
The config reuses the main config's port, `webServer`, and projects. The
scratch specs import `tests/helpers/e2e-supabase.ts` for
`generateTestUser()` (`:1152`) and `signUpAndCreateRestaurant()` (`:1171`).
Scratch specs are not `*.spec.ts` files under `tests/`, so
`npm run test:e2e` never picks them up (`playwright.config.ts:40-41,67-68`).

Every row gets these lenses where they apply:

1. Happy path, then reload: the data persists.
2. Loading, empty, and error states. Force the error with `page.route`.
3. Input edges: blank, zero, negative, decimals, long text, special
   characters, date edges (midnight, DST, restaurant timezone).
4. Roles: owner, manager, staff, and a collaborator role if relevant.
   A blocked role cannot see or do the action.
5. Tenant isolation: a second restaurant's data never shows.
6. Viewports 1280x800 and 390x844. No horizontal page scroll.
7. Keyboard and accessibility: tab order, dialog focus trap, Escape closes,
   `aria-label` on icon buttons, labels on inputs.
8. Console errors and failed network responses (status >= 400), collected
   with `page.on('console')` and `page.on('response')`.
9. Data correctness: numbers on screen match an independent calculation or
   a DB query.
10. Abuse of the flow: double submit, back button, reload mid-flow.

Seed the exact data precondition for each row. Use the
`tests/helpers/` patterns, or a service-role client in the Node test process,
never in the browser page (same rule as
`.claude/skills/development-workflow/SKILL.md:619-621`).

**Step 5 — Report.** Write `dev-tools/qa/qa-report-<branch-slug>.md`. It has
the charter table (behavior, steps, expected, actual, verdict, evidence path),
the bug list with severity, and the preflight output. Screenshots go to
`dev-tools/qa/evidence/`.

Severity:

- `critical` — wrong money or inventory numbers, data loss, security or
  tenant leak, a crash in a main flow.
- `major` — an acceptance criterion fails, a role cannot do its job, the
  flow breaks on mobile, or the change causes a console error.
- `minor` — cosmetic, copy, or spacing.

**Step 6 — Fix loop (`fix` mode only).** For each `critical` or `major` bug:

1. Turn the failing scratch check into a committed regression test
   (`tests/e2e/*.spec.ts` or `tests/unit/*.test.ts`). Run it and see it fail.
2. Fix the code. Run the test and see it pass.
3. Commit explicit paths only.
4. Re-run the affected charter rows.

Max 3 rounds. If a `critical` or `major` bug stays open, return
`needs_human`. Fix a `minor` only when the fix is one line with no behavior
change. List the other minors in the report.

**Verdict.** `qaPassed=true` only if every charter row is `pass` or a
justified `n/a`, and zero `critical` or `major` bugs stay open.

**Privacy.** Use only generated test users (`generateTestUser()`). Never put
production data in a scratch spec, a screenshot, or the report
(`memory/lessons.md:352-356`). `dev-tools/qa/` is gitignored.

**Wait discipline.** Run Playwright in the foreground. Kill any server the
skill starts, on the failure path too (`CLAUDE.md`, "No Unbounded Waits").

### Workflow integration

In both workflow scripts, after the Verify gate and before Ship:

```js
phase('QA')
{ const b = budgetHalt('QA'); if (b) return b }
const qa = await runAgent(envelope('PHASE 8.5 (QA). ... follow .claude/skills/qa/SKILL.md in fix mode ...'),
  { label: 'qa', phase: 'QA', schema: statusSchema({ qaPassed, reportPath, exception, minorFindings }, ['qaPassed', 'reportPath']) })
{ const g = gate(qa, 'QA'); if (g.halt) return g.out }
if (!qa.qaPassed) return stop('QA', { status: 'needs_human', reason: ..., reportPath: qa.reportPath })
if (qa.commits?.length || qa.headSha !== verify.headSha) {
  budgetHalt('QA')
  // QA fixes landed after Verify. Re-run the full suite so Ship never pushes unverified code.
  const reverify = await runAgent(<same Verify prompt>, { label: 'verify:post-qa', phase: 'QA', ... })
  gate + allPass check (+ the production-bundle probe in the continue script)
}
```

- Verify and QA both return `headSha`. The HEAD test catches a QA agent that
  commits a fix but does not list it, and a resumed QA whose fixes landed on
  an earlier attempt (review finding, sound-logic reviewer).

- The script, not the prompt, enforces the order: Verify → QA →
  (re-Verify if QA committed) → Ship.
- `args.postQaVerifyResolutionNote` re-keys the post-QA re-verify on resume.
- `args.qaResolutionNote` re-keys the QA prompt on resume, the same pattern as
  `args.verifyResolutionNote` (`.claude/workflows/dev-build-and-ship.js:700-702`).
- The Ship prompt adds a `## QA` section to the PR body: the verdict, the
  charter row count, fixed bugs, and each open minor finding.
- The Done Gate prompt checks that the QA report exists and shows zero open
  `critical` or `major` bugs.
- `meta.phases` in both scripts gets a `QA` entry, so `/workflows` shows it.

### Development-workflow skill

- New section `## Phase 8.5: QA` between Phase 8 and Phase 9. It points to
  `.claude/skills/qa/SKILL.md` and states the hard gate.
- Quick-reference row: `8.5 QA | qa skill (fix mode) | Docs/.claude/CI-config-only diff (justified exception)`.
- "Things you may NEVER autonomously skip" gets Phase 8.5.

## Tests

Script-layer tests in `tests/unit/workflowQaPhase.test.ts`, for both scripts:

1. The `qa` agent runs after `verify` and before `ship`.
2. `qaPassed=false` halts at phase `QA`. No `ship` call follows.
3. A `needs_human` QA result halts at `QA` with its own reason.
4. QA commits trigger `verify:post-qa` before `ship`. No commits: no re-verify.
5. A failed post-QA re-verify halts. No `ship` call follows.
6. QA minor findings and the report path reach the Ship prompt.
7. `qaResolutionNote` changes the QA prompt text.
8. The token ceiling halts at `QA` before the QA agent runs, and again before
   the re-verify.
9. HEAD moved with no listed commits: the re-verify runs.
10. `postQaVerifyResolutionNote` changes the re-verify prompt.
11. An empty `reportPath` falls back to the computed report path.
12. Both scripts build the same QA prompt and the same `## QA` Ship section.

The QA method itself is agent instructions. No unit test can run it. The
first real `/dev` run is its acceptance test.

## Out of scope

- The Codex `$dev` skill (`.agents/skills/dev/scripts/orchestrate.mjs:17-27`)
  has its own phase list and evidence checks. It needs its own change.
- Automatic axe scans. `@axe-core/playwright` is not a dependency. The
  keyboard lens covers the basics.

## Risks

- **Run time.** QA adds a browser pass to every `/dev` run. The charter holds
  only rows for behavior the change touches, plus one adjacent flow.
- **No local Supabase.** QA halts with `needs_human`. It never falls back to
  production.
