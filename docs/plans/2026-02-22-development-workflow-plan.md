# Development Workflow Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create a consistent, enforced development workflow that integrates superpowers, frontend-design, code-simplifier, and CodeRabbit CLI into every task.

**Architecture:** A new project-level skill file (`.claude/skills/development-workflow.md`) orchestrates the 9-phase pipeline. CLAUDE.md gets a brief mandatory reference. A pre-commit hook in `.claude/settings.json` runs CodeRabbit as a safety net.

**Tech Stack:** Claude Code skills (YAML frontmatter + markdown), Claude Code hooks (JSON config), CodeRabbit CLI v0.3.5

---

### Task 1: Create the skills directory

**Files:**
- Create: `.claude/skills/` (directory)

**Step 1: Create the directory**

```bash
mkdir -p .claude/skills
```

**Step 2: Verify**

```bash
ls -la .claude/skills/
```
Expected: Empty directory exists

**Step 3: Commit**

```bash
git add .claude/skills/.gitkeep
git commit -m "chore: create project skills directory"
```

Note: git won't track empty dirs, so we'll commit the skill file in the next task instead.

---

### Task 2: Create the master workflow skill

**Files:**
- Create: `.claude/skills/development-workflow.md`

**Step 1: Write the skill file**

Create `.claude/skills/development-workflow.md` with this exact content:

```markdown
---
name: development-workflow
description: "MANDATORY for every task. Orchestrates the full development pipeline: brainstorm, plan, TDD build, UI review, code-simplify, CodeRabbit review, verify, finish."
---

# Development Workflow

## Overview

This skill defines the mandatory development pipeline for every task. Follow each phase in order. Skip conditions are documented per phase.

<HARD-GATE>
Do NOT skip phases. Do NOT start coding before phases 1-2 are complete. Do NOT claim work is done before phases 7-8 pass. This applies to EVERY task regardless of perceived simplicity.
</HARD-GATE>

## Phase 1: Brainstorm

**Invoke:** `superpowers:brainstorming`

- Explore project context (files, docs, recent commits)
- Ask clarifying questions (one at a time, prefer multiple choice)
- Propose 2-3 approaches with trade-offs and recommendation
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
  ├─ No actionable findings → Proceed to Phase 8
  └─ Has findings → Fix them, commit fixes
       │
       Iteration 2: Run coderabbit review --plain --type committed
         ├─ No actionable findings → Proceed to Phase 8
         └─ Has findings → Fix them, commit fixes
              │
              Iteration 3: Run coderabbit review --plain --type committed
                ├─ No actionable findings → Proceed to Phase 8
                └─ Still has findings → Report to user for manual decision
```

**Important:** Use `--type committed` to review all committed changes on the branch. Parse the output for actionable suggestions vs informational notes. Only fix actionable items.

**Skip condition:** None.

## Phase 8: Verify

**Invoke:** `superpowers:verification-before-completion`

- Run all relevant tests: `npm run test`, `npm run lint`, `npm run build`
- Confirm ALL pass with actual output evidence
- Never claim "tests pass" without running them

**Skip condition:** None. Evidence before assertions, always.

## Phase 9: Finish

**Invoke:** `superpowers:finishing-a-development-branch`

- Present options to user: merge into main, create PR, or cleanup
- User decides the integration path
- If PR: use `gh pr create` with summary of all changes

**Skip condition:** None.

## Quick Reference

| Phase | Skill/Command | Skip If |
|-------|---------------|---------|
| 1. Brainstorm | `superpowers:brainstorming` | Never |
| 2. Plan | `superpowers:writing-plans` | Never |
| 3. Isolate | `superpowers:using-git-worktrees` | Already in worktree |
| 4. Build | `superpowers:test-driven-development` | Never |
| 5. UI Review | `frontend-design:frontend-design` | No UI changes |
| 6. Simplify | `code-simplifier:code-simplifier` | Never |
| 7. CodeRabbit | `coderabbit review --plain --type committed` | Never |
| 8. Verify | `superpowers:verification-before-completion` | Never |
| 9. Finish | `superpowers:finishing-a-development-branch` | Never |
```

**Step 2: Verify the file was created correctly**

```bash
cat .claude/skills/development-workflow.md | head -5
```
Expected: YAML frontmatter with `name: development-workflow`

**Step 3: Commit**

```bash
git add .claude/skills/development-workflow.md
git commit -m "feat: add master development workflow skill"
```

---

### Task 3: Update CLAUDE.md with workflow reference

**Files:**
- Modify: `CLAUDE.md:82` (insert after "## Critical Rules" heading)

**Step 1: Add the mandatory workflow section**

Insert the following immediately after `## Critical Rules` (line 82) and before `### No Manual Caching` (line 84):

```markdown

### Mandatory Development Workflow
**Every task MUST follow the `development-workflow` skill.** Before starting any implementation work, invoke the development-workflow skill from `.claude/skills/development-workflow.md`. This is non-negotiable. The skill orchestrates: brainstorm → plan → worktree → TDD build → UI review → code-simplify → CodeRabbit review → verify → finish.

```

**Step 2: Verify the edit**

Read CLAUDE.md lines 82-90 and confirm the new section is present.

**Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add mandatory development workflow reference to CLAUDE.md"
```

---

### Task 4: Add pre-commit CodeRabbit hook to settings

**Files:**
- Modify: `.claude/settings.json`

**Step 1: Read current settings**

Current content:
```json
{
  "enabledPlugins": {
    "code-simplifier@claude-plugins-official": true,
    "feature-dev@claude-plugins-official": true,
    "stripe@claude-plugins-official": true,
    "frontend-design@claude-plugins-official": true,
    "superpowers@claude-plugins-official": true
  }
}
```

**Step 2: Add hooks configuration**

Update `.claude/settings.json` to:

```json
{
  "enabledPlugins": {
    "code-simplifier@claude-plugins-official": true,
    "feature-dev@claude-plugins-official": true,
    "stripe@claude-plugins-official": true,
    "frontend-design@claude-plugins-official": true,
    "superpowers@claude-plugins-official": true
  },
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "if echo \"$TOOL_INPUT\" | grep -q 'git commit'; then echo '--- CodeRabbit Pre-Commit Check ---'; coderabbit review --plain --type uncommitted 2>&1 | head -200; echo '--- End CodeRabbit Check ---'; fi"
          }
        ]
      }
    ]
  }
}
```

**Step 3: Verify JSON is valid**

```bash
python3 -c "import json; json.load(open('.claude/settings.json'))"
```
Expected: No error (valid JSON)

**Step 4: Commit**

```bash
git add .claude/settings.json
git commit -m "feat: add pre-commit CodeRabbit hook to Claude settings"
```

---

### Task 5: Verify the complete setup

**Step 1: Verify skill file exists and is well-formed**

```bash
ls -la .claude/skills/development-workflow.md
```
Expected: File exists

**Step 2: Verify CLAUDE.md has the workflow reference**

Search CLAUDE.md for "Mandatory Development Workflow" — should find one match.

**Step 3: Verify settings.json has hooks**

Read `.claude/settings.json` and confirm `hooks.PreToolUse` array is present.

**Step 4: Verify CodeRabbit CLI is available**

```bash
coderabbit --version
```
Expected: `v0.3.5` or similar

**Step 5: Test the CodeRabbit hook by doing a dry-run**

```bash
coderabbit review --plain --type uncommitted 2>&1 | head -20
```
Expected: Either "no changes" message or review output (confirms CLI works)

**Step 6: Final commit if any fixes were needed**

```bash
git status
```
Expected: Clean working tree (all committed)
