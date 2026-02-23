---
description: Create a PR from the current branch with auto-generated summary
---

# Create Pull Request

## Current State
- Branch: !`git branch --show-current`
- Commits since main: !`git log --oneline main..HEAD 2>/dev/null || echo "(no divergence from main)"`
- Changed files: !`git diff --stat main..HEAD 2>/dev/null || echo "(none)"`

## Instructions

1. Review the commits and changed files above
2. Draft a concise PR title (under 70 chars) and a summary body with:
   - `## Summary` — 1-3 bullet points describing WHAT changed and WHY
   - `## Test plan` — How to verify the changes
3. Push the branch if not already pushed: `git push -u origin $(git branch --show-current)`
4. Create the PR: `gh pr create --title "..." --body "..."`
5. Return the PR URL
