---
name: development-workflow
description: "MANDATORY — invoke BEFORE any implementation, feature, bugfix, or code change. Orchestrates: consult lessons → brainstorm → plan → worktree → TDD build → UI review → code-simplify → CodeRabbit review → verify → finish → retrospective."
---

# Development Workflow

## Overview

This skill defines the mandatory development pipeline for every task. Follow each phase in order. Skip conditions are documented per phase.

<HARD-GATE>
Do NOT skip phases. Do NOT start coding before phases 1-2 are complete. Do NOT claim work is done before phases 7-8 pass. This applies to EVERY task regardless of perceived simplicity.
</HARD-GATE>

## Phase 0: Consult Lessons

- Read `memory/lessons.md` from the auto-memory directory
- Scan for entries relevant to the current task (matching category, similar patterns, related files)
- Keep relevant lessons in mind during brainstorm and implementation
- If lessons suggest a specific approach or warn against a mistake, call it out during Phase 1

**Skip condition:** None. Always check past lessons before starting.

## Phase 1: Brainstorm

**Invoke:** `superpowers:brainstorming`

- Explore project context (files, docs, recent commits)
- Ask clarifying questions (one at a time, prefer multiple choice)
- Propose 2-3 approaches with trade-offs and recommendation
- Reference any relevant lessons from Phase 0 in your proposals
- Get design approval
- Write design doc to `docs/plans/YYYY-MM-DD-<topic>-design.md`

**Skip condition:** None. Every task gets at least a brief design pass.

## Phase 2: Plan

**Invoke:** `superpowers:writing-plans`

- Break design into bite-sized tasks (2-5 minutes each)
- Identify task dependencies
- Save plan to `docs/plans/YYYY-MM-DD-<topic>-plan.md`

**Skip condition:** None.

## Phase 3: Isolate

**Invoke:** `superpowers:using-git-worktrees`

- Create worktree + branch for isolated development

**Skip condition:** Already in a worktree.

## Phase 4: Build (TDD)

**Invoke:** `superpowers:test-driven-development` + `superpowers:subagent-driven-development`

For each task in the plan:
1. **RED** — Write failing test
2. **GREEN** — Write minimal code to pass
3. **REFACTOR** — Clean up while tests stay green
4. **COMMIT** — Commit the passing task

Use subagent-driven-development to parallelize independent tasks.

**Skip condition:** None. All code gets tests.

## Phase 5: UI Review

**Invoke:** `frontend-design:frontend-design`

- Review against Apple/Notion design guidelines in CLAUDE.md
- Check typography scale, spacing, semantic colors, a11y
- Fix any design violations

**Skip condition:** No UI/component files were created or modified.

## Phase 6: Simplify

**Invoke:** `code-simplifier:code-simplifier`

- Simplify and refine recently modified code
- Focus on clarity, consistency, maintainability
- Preserve all functionality

**Skip condition:** None.

## Phase 7: CodeRabbit Review

**Command:** `coderabbit review --plain --type committed`

Review loop (max 3 iterations):

```
Iteration 1: Run coderabbit review --plain --type committed
  |-- No actionable findings --> Proceed to Phase 8
  +-- Has findings --> Fix them, commit fixes
       |
       Iteration 2: Run coderabbit review --plain --type committed
         |-- No actionable findings --> Proceed to Phase 8
         +-- Has findings --> Fix them, commit fixes
              |
              Iteration 3: Run coderabbit review --plain --type committed
                |-- No actionable findings --> Proceed to Phase 8
                +-- Still has findings --> Report to user for manual decision
```

**Important:** Use `--type committed` to review all committed changes on the branch. Parse the output for actionable suggestions vs informational notes. Only fix actionable items.

**Skip condition:** None.

## Phase 8: Verify

**Invoke:** `superpowers:verification-before-completion`

- set a symlink to .env.local so you can run tests in the worktree with access to env vars
- Run all relevant tests: `npm run test && npm run test:db && npm run test:e2e`, `npm run lint`, `npm run build`
- Confirm ALL pass with actual output evidence
- Never claim "tests pass" without running them

**Skip condition:** None. Evidence before assertions, always.

## Phase 9: Finish

**Invoke:** `superpowers:finishing-a-development-branch`

- Present options to user: merge into main, create PR, or cleanup
- User decides the integration path
- If PR: use `gh pr create` with summary of all changes

**Skip condition:** None.

## Phase 10: Retrospective

Review the entire workflow session and capture lessons learned:

1. **Identify corrections** — Scan the session for:
   - User corrections ("no, do it this way", "that's wrong", redirects)
   - CodeRabbit findings that required fixes (Phase 7)
   - Test failures that revealed wrong assumptions (Phase 4/8)
   - Design changes after initial brainstorm (Phase 1 pivots)

2. **Write lessons** — For each correction, append to the appropriate category in `memory/lessons.md`:
   ```markdown
   ### [YYYY-MM-DD] Short title
   - **Mistake:** What was done wrong or assumed incorrectly
   - **Correction:** What the right approach turned out to be
   - **Rule:** The general principle to apply going forward
   ```

3. **Deduplicate** — If a lesson reinforces an existing entry, update the existing one instead of adding a duplicate. Add a "confirmed" note.

4. **Prune** — If a lesson from a previous session turned out to be wrong or outdated, remove or correct it.

**Skip condition:** No corrections occurred during the session (clean run through all phases).

## Quick Reference

| Phase | Skill/Command | Skip If |
|-------|---------------|---------|
| 0. Consult Lessons | Read `memory/lessons.md` | Never |
| 1. Brainstorm | `superpowers:brainstorming` | Never |
| 2. Plan | `superpowers:writing-plans` | Never |
| 3. Isolate | `superpowers:using-git-worktrees` | Already in worktree |
| 4. Build | `superpowers:test-driven-development` | Never |
| 5. UI Review | `frontend-design:frontend-design` | No UI changes |
| 6. Simplify | `code-simplifier:code-simplifier` | Never |
| 7. CodeRabbit | `coderabbit review --plain --type committed` | Never |
| 8. Verify | `superpowers:verification-before-completion` | Never |
| 9. Finish | `superpowers:finishing-a-development-branch` | Never |
| 10. Retrospective | Write to `memory/lessons.md` | No corrections occurred |
