---
name: development-workflow
description: "MANDATORY — invoke BEFORE any implementation, feature, bugfix, or code change. Orchestrates: consult lessons → brainstorm → plan → worktree → TDD build → UI review → code-simplify → CodeRabbit review → verify → PR → CI loop → retrospective."
---

# Development Workflow

## Overview

This skill defines the mandatory development pipeline for every task. Follow each phase in order. Skip conditions are documented per phase.

The workflow is designed for **autonomous execution**: after the user approves the plan (Phase 2), Claude executes Phases 3–9 without requiring human prompts. The user is only notified when the PR is green and ready for review, or when Claude is genuinely stuck.

### Progress Tracking

Maintain a `progress.md` file in the worktree root throughout execution. This file enables context recovery if the session is interrupted or context is compressed.

**Hygiene:** `progress.md` is ephemeral — it must NOT be committed (it's in `.gitignore`). Create it fresh per task, and delete it when the task completes (Phase 10). If a stale `progress.md` is found from a prior completed run, delete it before starting.

**Update `progress.md`** at every phase transition with:
```markdown
# Progress: [task title]

## Spec
Link: docs/plans/YYYY-MM-DD-<topic>-plan.md

## Current Phase
Phase N: [name] — [status: in-progress | completed | blocked]

## Completed Tasks
- [x] Task 1 (commit: abc1234)
- [x] Task 2 (commit: def5678)
- [ ] Task 3 (next up)

## CI Status
- PR: #NNN (or "not yet created")
- Checks: [pending | passing | failing]
- Failures: [summary of current failures, if any]
- Iteration: N/5

## Blockers
- [any issues requiring human input]

## Key Decisions
- [design decisions made during execution]
```

<HARD-GATE>
Do NOT skip phases. Do NOT start coding before phases 1-2 are complete. Do NOT claim work is done before phases 8-9 pass. This applies to EVERY task regardless of perceived simplicity.
</HARD-GATE>

## Phase 0: Consult Lessons & Recover Context

- Read `memory/lessons.md` from the auto-memory directory
- Scan for entries relevant to the current task (matching category, similar patterns, related files)
- Keep relevant lessons in mind during brainstorm and implementation
- If lessons suggest a specific approach or warn against a mistake, call it out during Phase 1
- **Context recovery:** If `progress.md` exists, read it to determine where prior work left off. Resume from the last incomplete phase instead of restarting.

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

## Phase 8: Verify (Local)

**Invoke:** `superpowers:verification-before-completion`

- Set a symlink to .env.local so you can run tests in the worktree with access to env vars
- Run all relevant tests: `npm run test && npm run test:db && npm run test:e2e`, `npm run lint`, `npm run build`
- Confirm ALL pass with actual output evidence
- Never claim "tests pass" without running them
- **If any check fails:** Fix the issue, commit the fix, re-run. Loop locally until green before proceeding. Max 5 local fix iterations — if still failing after 5, report to user.
- Update `progress.md` with verification results

**Skip condition:** None. Evidence before assertions, always.

## Phase 9: Ship & CI Loop

This phase is **fully autonomous**. Do not ask the user what to do — push, open the PR, and iterate until CI is green.

### 9a: Push & Create PR

1. Push branch: `git push -u origin <branch-name>`
2. Create PR using the GitHub MCP tools (`mcp__github__create_pull_request`) with:
   - Concise title (< 70 chars)
   - Body with `## Summary` (1-3 bullets from the plan), `## Test plan`, and link to the design doc
3. Update `progress.md` with the PR number

### 9b: Subscribe to PR Activity

1. Use `subscribe_pr_activity` to watch the PR for CI check results and review comments
2. This enables automatic notification when checks complete or reviews are posted

### 9c: CI Feedback Loop (max 5 iterations)

```text
Iteration N:
  Wait for CI checks to complete (via PR activity events)
  │
  ├── ALL checks pass → Update progress.md, proceed to Phase 9d
  │
  └── Checks fail →
      1. Read failure details from CI check output (use mcp__github__get_pull_request_checks or similar)
      2. Re-read the plan (docs/plans/YYYY-MM-DD-*-plan.md) to stay spec-anchored
      3. Diagnose root cause from error logs
      4. Fix the issue locally
      5. Run the failing check locally to confirm fix (e.g., npm run test, npm run build)
      6. Commit fix with message: "fix(ci): [what was fixed] (iteration N/5)"
      7. Push to branch
      8. Update progress.md with iteration count and what was fixed
      9. Return to top of loop
```

**After 5 failed iterations:** Stop iterating. Update `progress.md` with detailed failure analysis. Notify the user with:
- What's failing and why
- What was tried in each iteration
- Suggested next steps

### 9d: Handle Review Comments

When review comments arrive (via PR activity events or after CI passes):

1. Read all review comments
2. Classify each as:
   - **Actionable** — clear code change needed (bug, security, performance)
   - **Clarification needed** — ambiguous, could be interpreted multiple ways
   - **Informational** — style preferences, minor nits, no action needed
3. For **actionable** items: fix, commit, push (re-enters CI loop 9c)
4. For **clarification needed**: Ask the user via `AskUserQuestion` with enough context to answer without scrolling back
5. For **informational**: Reply on the PR acknowledging, explain if not implementing and why
6. After addressing all comments, confirm CI is still green

### 9e: Done

When all CI checks pass and review comments are addressed:
- Update `progress.md` with final status: `## Status: Ready for merge`
- Notify the user: "PR #NNN is green and ready for review/merge" with a summary of what was built

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

**Skip condition:** No corrections occurred during the session (clean run through all phases). Only the lesson-writing steps (1-4) are skipped — progress cleanup below always runs.

### Progress Cleanup (always runs)

5. **Finalize progress** — Update `progress.md` with `## Status: Complete` and delete it. This step runs regardless of whether lessons were written, to prevent stale `progress.md` from triggering false resume in future sessions.

## Autonomy Guidelines

After the user approves the plan (end of Phase 2), the workflow should run autonomously through Phases 3–9 without requiring human input. The only exceptions where you should pause and ask:

1. **Ambiguous review comments** (Phase 9d) — When a reviewer's intent is unclear
2. **Persistent CI failures** (Phase 9c) — After 5 failed iterations
3. **Architectural decisions** — When a fix requires changing the approved design
4. **Genuine blockers** — Environment issues, missing credentials, etc.

For everything else — test failures, lint errors, CodeRabbit findings, CI red — diagnose and fix autonomously. Each failure is structured feedback, not a reason to stop.

### Context Recovery

If a session is interrupted (context compression, timeout, crash):
1. Read `progress.md` to understand current state
2. Read the plan file linked in `progress.md`
3. Check `git log` for recent commits
4. Resume from the last incomplete phase — do not restart from Phase 0

This is the Ralph loop principle: each fresh context window re-orients from persistent artifacts (git history, progress.md, plan files), not from conversation memory.

## Quick Reference

| Phase | Skill/Command | Skip If |
|-------|---------------|---------|
| 0. Consult Lessons | Read `memory/lessons.md` + `progress.md` | Never |
| 1. Brainstorm | `superpowers:brainstorming` | Never |
| 2. Plan | `superpowers:writing-plans` | Never |
| 3. Isolate | `superpowers:using-git-worktrees` | Already in worktree |
| 4. Build | `superpowers:test-driven-development` | Never |
| 5. UI Review | `frontend-design:frontend-design` | No UI changes |
| 6. Simplify | `code-simplifier:code-simplifier` | Never |
| 7. CodeRabbit | `coderabbit review --plain --type committed` | Never |
| 8. Verify | `superpowers:verification-before-completion` | Never (loop locally until green) |
| 9. Ship & CI Loop | Push → PR → CI loop → Review loop | Never |
| 10. Retrospective | Write to `memory/lessons.md` | No corrections occurred |
