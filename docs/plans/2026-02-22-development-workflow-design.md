# Development Workflow Design

**Date**: 2026-02-22
**Status**: Approved

## Goal

Establish a consistent, enforced development workflow that integrates superpowers pipeline, frontend-design, code-simplifier, and CodeRabbit CLI into every task.

## Pipeline (9 Phases)

```
USER REQUEST
     │
     ▼
1. BRAINSTORM          → superpowers:brainstorming
   - Explore context, ask questions, propose approaches, get design approval
     │
     ▼
2. PLAN                → superpowers:writing-plans
   - Break into 2-5 min tasks, identify dependencies, save to docs/plans/
     │
     ▼
3. ISOLATE             → superpowers:using-git-worktrees
   - Create worktree + branch (skip if already in worktree)
     │
     ▼
4. BUILD (TDD)         → superpowers:test-driven-development
   - RED → GREEN → REFACTOR for each task
   - Use superpowers:subagent-driven-development for parallel independent tasks
     │
     ▼
5. UI REVIEW           → frontend-design:frontend-design
   - Apple/Notion guidelines, typography, spacing, a11y
   - SKIP if no UI/component changes
     │
     ▼
6. SIMPLIFY            → code-simplifier:code-simplifier
   - Clean recently modified code, reduce complexity, preserve functionality
     │
     ▼
7. CODERABBIT REVIEW   → coderabbit review --plain
   - Run on all committed changes
   - Fix actionable findings
   - Re-run up to 3 iterations total
   - Report any remaining issues to user
     │
     ▼
8. VERIFY              → superpowers:verification-before-completion
   - Run tests (unit, lint, build)
   - Evidence before assertions
     │
     ▼
9. FINISH              → superpowers:finishing-a-development-branch
   - Present options: merge / PR / cleanup
   - User decides
```

## Skip Conditions

| Phase | Skip When |
|-------|-----------|
| 3. Isolate | Already in a worktree |
| 5. UI Review | No UI/component file changes |
| For trivial fixes | Phases 1-3 can be condensed (still required, just brief) |

## CodeRabbit Review Loop

```
Run: coderabbit review --plain --type committed
     │
     ├─ No actionable findings → Proceed to phase 8
     │
     └─ Has findings → Fix them → Re-run
                        │
                        └─ Iteration count < 3? → Fix & re-run
                           Iteration count = 3? → Report remaining to user
```

## Implementation Artifacts

### 1. Skill File: `.claude/skills/development-workflow.md`
- YAML frontmatter (name, description)
- Full pipeline as a checklist
- Each phase references specific skill to invoke
- Skip conditions
- CodeRabbit loop with max iterations

### 2. CLAUDE.md Update
- Add ~5-line "Mandatory Development Workflow" section to Critical Rules
- References the skill, non-negotiable for all tasks

### 3. Hook: `.claude/settings.json`
- PreToolUse hook on Bash tool
- Detects `git commit` commands
- Runs `coderabbit review --plain --type uncommitted` as safety net
- Surfaces findings before commit proceeds

### 4. CodeRabbit Config: `.coderabbit.yaml` (optional)
- Language/framework hints
- Path filters
- Review profile customization
