---
description: Review working-tree (or branch) changes against ocr rule packs using Claude — no API key, no codex dependency
---

# Our Code Review

Uses `dev-tools/ocr-rules-review.sh` (git + `ocr` only, $0) to build a REVIEW BRIEF, then has the current Claude session review the diff against the matched ocr rule packs. No external API calls, no Codex — just ocr's rule engine + Claude running on the Max subscription.

## Context
- Branch: !`git branch --show-current`
- Status: !`git status --short`
- ocr on PATH: !`command -v ocr 2>/dev/null && echo "yes ($(command -v ocr))" || echo "no"`

## Instructions

1. **Determine the base ref.** If the user passed an argument (e.g. `/our-code-review main`), treat it as BASE_REF and run:
   ```
   bash dev-tools/ocr-rules-review.sh <BASE_REF>
   ```
   If no argument was given, run working-tree mode:
   ```
   bash dev-tools/ocr-rules-review.sh
   ```

2. **Capture the REVIEW BRIEF** printed to stdout by the script. The brief has three sections:
   - `## Changed files` — list of files in scope
   - `## ocr rule packs (deduped)` — the rule text matched for those files (or the fallback note if `ocr` was unavailable)
   - `## Diff` — the unified diff

3. **Read the reviewer instructions** from `.claude/agents/ocr-rules-reviewer.md` (if it exists). Apply those instructions when analysing the brief. If the file does not exist yet, fall back to the conventions in `CLAUDE.md`.

4. **Review the diff** against every rule in the "ocr rule packs" section. For each violation found, record:
   - Severity: **Critical** | **High** | **Medium** | **Low** | **Informational**
   - File path and line number (from the diff context)
   - Which rule was violated and a one-sentence explanation
   - A suggested fix (inline snippet when short)

5. **Present findings grouped by severity**, highest first. Use this format:

   ### Critical
   - `src/foo.ts:42` — **Rule: no-direct-colors** — `bg-white` is a direct colour; use `bg-background` instead.
     ```diff
     - className="bg-white text-black"
     + className="bg-background text-foreground"
     ```

   ### High
   - `src/bar.ts:17` — **Rule: staleTime-required** — useQuery missing staleTime; add `staleTime: 30000`.

   _(omit a severity section entirely if there are no findings at that level)_

6. **If there are no findings**, say so clearly: "No violations found against the matched ocr rule packs."

7. **Ask the user which findings to fix.** List them by number so they can reply "fix 1, 3" or "fix all". Then apply the requested fixes directly to the working tree.
