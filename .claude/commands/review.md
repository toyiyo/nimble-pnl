---
description: Run CodeRabbit review on committed changes
---

# CodeRabbit Review

## Current State
- Branch: !`git branch --show-current`
- Uncommitted changes: !`git status --short`

## Instructions

1. If there are uncommitted changes, warn the user — CodeRabbit only reviews committed code
2. Run: `coderabbit review --plain --type committed`
3. Parse the output:
   - **Actionable findings**: Issues that need fixing (bugs, security, performance)
   - **Informational notes**: Style suggestions, minor improvements
4. List actionable findings clearly with file paths and line numbers
5. Ask user which findings to fix
