---
description: Start the full development workflow (brainstorm, plan, worktree, TDD build, review, verify, finish)
---

# Development Workflow

Invoke the `development-workflow` skill from `.claude/skills/development-workflow.md` and follow it exactly.

## Context
- Branch: !`git branch --show-current`
- Recent commits: !`git log --oneline -5`
- Worktree status: !`git worktree list`
- Progress file: !`cat progress.md 2>/dev/null || echo "(no active progress file)"`

## Instructions

1. **Check for in-progress work:** If `progress.md` exists above, this is a resumed session. Read the plan file referenced in it, check git log, and resume from the last incomplete phase. Do NOT restart from scratch.

2. **Fresh start:** If no `progress.md`, use the Skill tool to invoke the development-workflow skill, then follow every phase in order. Ask the user what they want to build if no task was provided alongside this command.

3. **Autonomy after Phase 2:** Once the user approves the plan, execute Phases 3–9 autonomously. Only pause for genuine blockers or ambiguous review feedback. Update `progress.md` at each phase transition.

4. **Completion:** Notify the user when the PR is green and ready for review, or when stuck after exhausting retry loops.
