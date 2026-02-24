---
description: Start the full development workflow (brainstorm, plan, worktree, TDD build, review, verify, finish)
---

# Development Workflow

Invoke the `development-workflow` skill from `.claude/skills/development-workflow.md` and follow it exactly.

## Context
- Branch: !`git branch --show-current`
- Recent commits: !`git log --oneline -5`
- Worktree status: !`git worktree list`

## Instructions

Use the Skill tool to invoke the development-workflow skill, then follow every phase in order. The user's request follows — ask them what they want to build if no task was provided alongside this command.
