#!/usr/bin/env bash
# UserPromptSubmit hook: re-inject the ASD-STE100 writing rule on every turn.
#
# CLAUDE.md carries the same rule, but it sits at the very top of the context
# window and its pull weakens across a long session. This block lands next to
# the newest user message, where it competes on even terms. Keep it short — it
# costs tokens on every single turn.
#
# Full standard: docs/STE100_STYLE.md
set -euo pipefail

cat <<'JSON'
{
  "suppressOutput": true,
  "hookSpecificOutput": {
    "hookEventName": "UserPromptSubmit",
    "additionalContext": "WRITING STANDARD (ASD-STE100, per CLAUDE.md) — applies to this reply and to every sub-agent prompt you write: One idea per sentence; max 20 words for an instruction, 25 for a description. Active voice; start an instruction with the verb. One word for one meaning: fix (not repair/resolve/address/patch), change (not modify/tweak/alter), delete (not remove/drop/purge), show (not display/surface/render), check (not verify/validate/ensure). Simple tenses only. No -ing word as a noun. Keep the articles; max 3 nouns in a cluster. No idioms, no metaphors, no hedges (basically, just, simply, I think, it seems). Keep EXACT: code identifiers, file paths, tool output, error messages, quotes. Full standard: docs/STE100_STYLE.md"
  }
}
JSON
