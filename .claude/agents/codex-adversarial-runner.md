---
name: codex-adversarial-runner
description: Documentation for the Codex adversarial reviewer that runs in parallel with the four Claude reviewers in Phase 7a. NOT a sub-agent invoked via the `Agent` tool — this is documentation for `dev-tools/codex-adversarial-review.sh`, which the workflow calls via `Bash`.
subagent_type: n/a
---

# Codex Adversarial Runner (Phase 7a)

This is **not** a Claude sub-agent. It documents the shell script
`dev-tools/codex-adversarial-review.sh` that brings a non-Claude model
(via the Codex CLI) into Phase 7a's review fan-out. The intent is to
defeat the "Claude grades its own homework" failure mode: a second model
family with a different training distribution looks at the same diff.

## When it runs

Phase 7a, in parallel with the four Claude reviewers. The workflow
shells out via `Bash`:

```bash
dev-tools/codex-adversarial-review.sh main
```

## Prerequisites

- `codex` CLI on `PATH`. Install: `brew install --cask codex && codex login`.
- If `codex` is missing or the binary symlink is broken, the script
  emits a `::skip::` line and exits 0. The workflow treats adversarial
  review as **best-effort** — the four Claude reviewers still run.

## Mechanism (high level)

1. Capture `git diff origin/main...HEAD`.
2. Find the matching design doc under
   `docs/superpowers/specs/<today>-*-design.md` (if any).
3. Build an adversarial prompt that asks Codex to find **one** concrete
   bug, security issue, or correctness flaw Claude would miss. Be
   honest: say "No adversarial finding." rather than invent.
4. Pipe both into `codex exec`.
5. Write the raw output to `dev-tools/codex-review-output.md` for the
   workflow to fold into Phase 7b.

## Output format

Codex is asked to emit findings as:

```
::finding:: severity=<critical|major|minor> file=<path> line=<n>
<one-paragraph description of the bug and the trigger>
```

…and the raw stdout is captured. Anything that doesn't match the
format is still preserved in `codex-review-output.md` for human review.

## Skill loadout (Codex side)

Codex already has `security-best-practices` installed globally; the
script does NOT re-load skills inside the prompt. If we add Codex-side
skills in the future, attach them via the Codex CLI's own skill
mechanism — not via prompt injection.

## What this runner deliberately does NOT do

- It does NOT pass `.env`, secrets, `lessons.md`, or any
  non-PR-bound text to Codex. Inputs are limited to the diff and the
  design doc — both about to be public on the PR.
- It does NOT auto-apply fixes. Findings flow into Phase 7b, where
  Claude decides which to act on.
- It does NOT retry on Codex failure. A failed Codex invocation logs
  a WARN and the workflow continues.

## Failure modes & recovery

| Mode | Detection | Recovery |
|---|---|---|
| `codex` not on PATH | `command -v codex` returns non-zero | Skip with `::skip::`; continue Phase 7a |
| `codex login` expired | `codex exec` returns auth error | User reruns `codex login`; workflow logs WARN and continues |
| Codex returns garbage | Output has no `::finding::` lines | Captured raw in `codex-review-output.md`; Phase 7b shows it to Claude for manual triage |
| Codex finds nothing | Output: "No adversarial finding." | Skip in Phase 7b; recorded in retrospective |
