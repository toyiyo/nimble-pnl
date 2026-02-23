---
description: Show project status — git state, branch info, worktrees, and advisories
---

# Project Status

## Git
- Branch: !`git branch --show-current`
- Status: !`git status --short`
- Recent commits: !`git log --oneline -5`
- Ahead/behind: !`git rev-list --left-right --count main...HEAD 2>/dev/null || echo "N/A"`

## Worktrees
!`git -C $(git rev-parse --show-toplevel 2>/dev/null || echo .) worktree list 2>/dev/null || echo "Not in a git repo"`

## Summary

Present the above information in a clean, readable format. Include:
- Current branch and whether it has uncommitted changes
- How many commits ahead of main
- Active worktrees and their branches
- Any suggestions (e.g., "you have uncommitted changes" or "branch is 5 commits ahead, consider creating a PR")
