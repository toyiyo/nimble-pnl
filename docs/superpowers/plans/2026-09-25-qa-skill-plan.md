# QA skill and /dev Phase 8.5 — plan

Design: `docs/superpowers/specs/2026-09-25-qa-skill-design.md`
Branch: `claude/wizardly-dijkstra-0v6pfk`

This change touches only `.claude/`, docs, `.gitignore`, and `tests/unit/`.
Per the skip condition for Phases 4–9 (no code under `src/`, `supabase/`,
`dev-tools/`), run the phases inline, not through the `dev-build-and-ship`
workflow. The workflow must not edit its own gate file while it runs
(`memory/lessons.md:964-967`).

## Tasks

### Task 1 — Failing script tests (RED)

- Create `tests/unit/workflowQaPhase.test.ts` with the 8 cases in the design
  "Tests" section, for both workflow scripts.
- Add a `qa` response to `defaultResponder` in
  `tests/unit/workflowRunawayGuards.test.ts`.
- Run `npx vitest run tests/unit/workflowQaPhase.test.ts`. Expect failures.

### Task 2 — QA phase in `dev-build-and-ship.js` (GREEN, part 1)

- Add `{ title: 'QA' }` to `meta.phases` after `Verify`.
- Add the `QA` phase after the Verify gate: budget check, `qa` agent,
  gate, `qaPassed` check, and `verify:post-qa` when QA committed.
- Add `ctx.qaResolutionNote` to the QA prompt.
- Add the QA summary and minor findings to the Ship prompt.
- Add the QA report check to the Done Gate prompt.
- Extract the Verify prompt into one `const` so Verify and the post-QA
  re-verify use the same text.

### Task 3 — QA phase in `dev-continue-verify-and-ship.js` (GREEN, part 2)

- Same changes as Task 2. Keep the production-bundle probe in the post-QA
  re-verify.
- Change `meta.description` to name Phase 8.5.
- Run both unit test files. Expect all to pass.

### Task 4 — The `qa` skill

- Create `.claude/skills/qa/SKILL.md` per the design "QA method" section.
- Create `.claude/skills/qa/playwright.qa.config.ts`.
- Add `dev-tools/qa/` to `.gitignore`.
- Check: `npx playwright test --config .claude/skills/qa/playwright.qa.config.ts --list`
  loads the config with an empty scratch folder and a sample spec.

### Task 5 — Workflow docs

- `.claude/skills/development-workflow/SKILL.md`: add `## Phase 8.5: QA`,
  the quick-reference row, the never-skip entry, and the overview text.
- `.claude/commands/dev.md`, `.claude/hooks/dev-phase-guard.sh`, `CLAUDE.md`:
  name QA where they list phases.

### Task 6 — Simplify, review, verify

- Run the `simplify` pass on the diff.
- Run the Phase 7a reviewers (`sound-logic-reviewer`,
  `maintainability-reviewer`) on the workflow script diff.
- Run `npm run test`, `npm run typecheck`, `npm run lint`, and
  `bash -n .claude/hooks/dev-phase-guard.sh`.

### Task 7 — Ship

- Push to `claude/wizardly-dijkstra-0v6pfk`.
- Open a PR only if the user asks.
