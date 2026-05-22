---
name: development-workflow
description: "MANDATORY — invoke BEFORE any implementation, feature, bugfix, or code change. Orchestrates: consult lessons → brainstorm → plan → worktree → TDD build → UI review → code-simplify → CodeRabbit review → verify → PR → CI loop → retrospective."
---

# Development Workflow

## Overview

This skill defines the mandatory development pipeline for every task. Follow each phase in order. Skip conditions are documented per phase.

The workflow is designed for **autonomous execution**: after the user approves the plan (Phase 3), Claude executes Phases 4–9 without requiring human prompts. The user is only notified when the PR is green and ready for review, or when Claude is genuinely stuck.

**Two defense-in-depth phases** complement the linear flow:

- **Phase 2.5 — Design Review:** Always-on Supabase + Frontend reviewers
  inspect the design doc against best-practice skills before any code is
  written. Catching a design mistake here is roughly 10× cheaper than
  catching it in PR review.
- **Phase 7 — Multi-Model Code Review:** Four Claude reviewers (security,
  performance, maintainability, sound-logic) and one Codex adversarial
  reviewer fan out in parallel against the branch diff. CodeRabbit local
  CLI is the final gate, not the only gate — this avoids "Claude grading
  its own homework" and reduces dependence on one third-party reviewer.

### Progress Tracking

Maintain a `progress.md` file in the worktree root throughout execution. This file enables context recovery if the session is interrupted or context is compressed.

**Hygiene:** `progress.md` is ephemeral — it must NOT be committed (it's in `.gitignore`). Create it fresh per task, and delete it when the task completes (Phase 10). If a stale `progress.md` is found from a prior completed run, delete it before starting.

**Update `progress.md`** at every phase transition with:
```markdown
# Progress: [task title]

## Spec
Link: docs/superpowers/plans/YYYY-MM-DD-<topic>-plan.md

## Current Phase
Phase N: [name] — [status: in-progress | completed | blocked]

## Completed Tasks
- [x] Task 1 (commit: abc1234)
- [x] Task 2 (commit: def5678)
- [ ] Task 3 (next up)

## CI Status
- PR: #NNN (or "not yet created")
- Checks: [pending | passing | failing]
- Failures: [summary of current failures, if any]
- Iteration: N/5

## Blockers
- [any issues requiring human input]

## Key Decisions
- [design decisions made during execution]
```

<HARD-GATE>
Do NOT skip phases. Do NOT start coding before phases 1-2 are complete. Do NOT claim work is done before phases 8-9 pass. This applies to EVERY task regardless of perceived simplicity.
</HARD-GATE>

## Phase 0: Consult Lessons & Recover Context

- Read `memory/lessons.md` from the auto-memory directory
- Scan for entries relevant to the current task (matching category, similar patterns, related files)
- Keep relevant lessons in mind during brainstorm and implementation
- If lessons suggest a specific approach or warn against a mistake, call it out during Phase 2
- **Context recovery:** If `progress.md` exists, read it to determine where prior work left off. Resume from the last incomplete phase instead of restarting.

**Skip condition:** None. Always check past lessons before starting.

## Phase 1: Isolate

**Invoke:** `superpowers:using-git-worktrees`

- Create worktree + branch for isolated development **before** any artifact (design doc, plan, code) is written.
- This ensures every commit from this task — including spec and plan documents — lands on the feature branch, never on `main`.
- Branch name convention: `feature/<short-kebab-topic>` (or `fix/...`, `chore/...`).
- Worktree path convention: `.claude/worktrees/<short-kebab-topic>`.

**Skip condition:** Already in a dedicated worktree for this task. If the current directory is on `main` or a reused branch, do NOT skip — create a fresh worktree.

<HARD-GATE>
Never commit design docs, plans, or code for a new task directly to `main`. If you catch yourself with uncommitted changes or fresh commits on `main`, stop and move them off `main` before resyncing — **never `git reset --hard` while the working tree is dirty**, it destroys uncommitted work.

```bash
# 1. Preserve any uncommitted edits (tracked + untracked).
git stash push --include-untracked --message "pre-recover-$(date +%s)"

# 2. Move committed work (if any) to a feature branch, then resync main.
git branch <feature> HEAD
git reset --hard origin/main

# 3. Check out the feature branch in a new worktree and restore the stash there.
git worktree add .claude/worktrees/<feature> <feature>
cd .claude/worktrees/<feature>
git stash pop   # only if step 1 actually stashed something
```

If `git stash push` reports "No local changes to save," skip step 3's `git stash pop`. If step 2's `git branch` fails because `HEAD` is already at `origin/main` (no accidental commits), skip it — the stashed edits alone are what need to move.
</HARD-GATE>

## Phase 2: Brainstorm

**Invoke:** `superpowers:brainstorming`

- Explore project context (files, docs, recent commits)
- Ask clarifying questions (one at a time, prefer multiple choice)
- Propose 2-3 approaches with trade-offs and recommendation
- Reference any relevant lessons from Phase 0 in your proposals
- Get design approval
- Write design doc to `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md` and commit it on the feature branch

**Skip condition:** None. Every task gets at least a brief design pass.

## Phase 2.5: Design Review

**Trigger:** Runs immediately after the design doc is committed (end of
Phase 2), before Phase 3 (Plan) starts.

**Why it exists:** Design mistakes compound through TDD into reviewable
code. Catching them at the design-doc stage is roughly 10× cheaper than
catching them in PR review. The Supabase + Frontend dimensions are the
two surfaces where mistakes are most expensive in this codebase.

### Sub-agents (run in parallel)

Invoke both via the `Agent` tool with `subagent_type=general-purpose`,
passing the design doc path. Prompts live at:

- `.claude/agents/supabase-design-reviewer.md`
- `.claude/agents/frontend-design-reviewer.md`

#### `supabase-design-reviewer`

- **Runs when:** Design touches DB schema, RLS, edge functions, RPC,
  migrations, or any `restaurant_id`-scoped table. Detected by scanning
  the design doc for: `supabase`, `migration`, `rpc`, `rls`,
  `edge function`, `.sql`.
- **Skill loadout:** `supabase-postgres-best-practices`,
  `supabase-audit-rls`, `postgresql-code-review`.
- **Reviews:** RLS coverage, migration safety, edge-function CPU/memory,
  unified-sales hygiene, indexes implied by query patterns, function
  semantics, idempotency, timezone discipline, secret encryption.

#### `frontend-design-reviewer`

- **Runs when:** Design touches UI/components, dialogs, forms, pages,
  styling, mobile/viewport behaviour. Detected by scanning for:
  `component`, `dialog`, `form`, `page`, `mobile`, `viewport`,
  `tailwind`, `shadcn`, `Apple/Notion`, or `src/components/`.
- **Skill loadout:** `frontend-design`, `accessibility`, `performance`,
  `shadcn`.
- **Reviews:** CLAUDE.md compliance (typography, semantic tokens,
  three-state rendering), accessibility (aria, focus, keyboard),
  performance (virtualization, memoization, single-dialog pattern,
  React Query staleTime), shadcn idioms, routing, form ergonomics.

### Skip conditions

- **Supabase reviewer:** Skipped only when the design touches no
  DB/edge-function/SQL surface (keyword-based). When ambiguous, run it.
- **Frontend reviewer:** Skipped only when no UI/component surface is
  touched. When ambiguous, run it.
- **Both skipped** when the task is a workflow- or doc-only change
  (e.g., editing this file).
- **Hard rule:** When the keyword detection says "applicable," neither
  reviewer may be silently skipped.

### Folding feedback in

After both reviewers return:

1. Read the combined concerns list.
2. For each `critical` or `major` concern, decide:
   - **Fix in design** → Edit the design doc, commit the change.
   - **Defer with rationale** → Add a "Decided trade-offs" section to
     the design doc explaining why the concern is accepted as-is.
3. For `minor` concerns, decide:
   - **Fix in design** → Edit + commit.
   - **Skip** → Note in retrospective so the reviewer prompt can be
     refined later.
4. Proceed to Phase 3 only after the design doc reflects every accepted
   concern.

**Skip condition:** Workflow/doc-only changes (per the keyword
detection above). Otherwise never.

## Phase 3: Plan

**Invoke:** `superpowers:writing-plans`

- Break design into bite-sized tasks (2-5 minutes each)
- Identify task dependencies
- Save plan to `docs/superpowers/plans/YYYY-MM-DD-<topic>-plan.md` and commit it on the feature branch

**Skip condition:** None.

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

## Phase 7: Multi-Model Code Review

Phase 7 is **three sub-phases** that run sequentially: 7a fans out five
parallel reviewers, 7b folds their findings into commits, 7c runs
CodeRabbit local CLI as the final gate. The intent is to defeat "Claude
grading its own homework" and to stop putting all review eggs in one
third-party basket.

```
Phase 6  Simplify
   │
   ▼
Phase 7a  Multi-model fan-out (PARALLEL)
   ├─ Agent: security-reviewer
   ├─ Agent: performance-reviewer
   ├─ Agent: maintainability-reviewer
   ├─ Agent: sound-logic-reviewer
   └─ Bash:  dev-tools/codex-adversarial-review.sh
   │
   ▼
Phase 7b  Fold findings: classify, fix actionable, commit
   │
   ▼
Phase 7c  CodeRabbit local CLI (final gate, max 3 iterations)
   │
   ▼
Phase 8  Verify
```

### 7a — Multi-model fan-out (parallel)

Inputs handed to every reviewer:

- `git diff origin/main...HEAD`
- `git log origin/main..HEAD --oneline`
- The Phase 2 design doc.

**Four Claude reviewers.** Each is an `Agent` call with
`subagent_type=feature-dev:code-reviewer` and the prompt loaded from
`.claude/agents/<name>.md`. Launch them in a **single message with four
tool calls** so they run concurrently.

| Reviewer | Skills | Severity tag |
|---|---|---|
| `security-reviewer` | `security-best-practices`, `supabase-audit-rls` | `security:<level>` |
| `performance-reviewer` | `performance`, `vercel-react-best-practices` | `performance:<level>` |
| `maintainability-reviewer` | `typescript-react-reviewer`, `shadcn` | `maintainability:<level>` |
| `sound-logic-reviewer` | `vercel-react-best-practices`, `requesting-code-review` | `logic:<level>` |

**One Codex adversarial reviewer.** Shell out via `Bash`:

```bash
dev-tools/codex-adversarial-review.sh main
```

The script writes its output to `dev-tools/codex-review-output.md`.

**Codex prerequisite:** `codex` CLI must be on PATH and the binary must
launch (`codex --version`). If either fails, the script emits a
`::skip::` line and exits 0. Adversarial review is **best-effort** —
the four Claude reviewers still run.

```bash
# Install / repair if missing
brew install --cask codex && codex login
# If the symlink is dangling:
brew reinstall --cask codex
```

### 7b — Fold findings

1. Collect every `critical` and `major` finding from all five reviewers
   (including Codex's `dev-tools/codex-review-output.md`).
2. Deduplicate: same `file:line` from multiple reviewers → keep highest
   severity, merge messages.
3. Classify each:
   - **Actionable bug / security / correctness** → Fix it. Commit:
     `fix(review): <area> — addresses <reviewer> finding`.
   - **Style / nit** → Skip (CodeRabbit Phase 7c catches these).
   - **False positive** → Note in retrospective; skip.
4. After fixes commit, **re-invoke any reviewer that flagged a fixed
   issue** to confirm the fix resolved it.

`minor` findings are deferred to CodeRabbit and/or the retrospective.

### 7c — CodeRabbit local CLI (final gate)

This is the existing CodeRabbit step. It is still **non-skippable**, but
its role narrows: it's the *final consistency check*, not the *primary
review*. Most issues should have been caught by 7a.

**Independent of the GitHub bot.** The CodeRabbit GitHub bot's inline
comments on the PR are handled separately in Phase 9d.

**Command:** `coderabbit review --plain --type committed`

Review loop (max 3 iterations):

```
Iteration 1: Run coderabbit review --plain --type committed
  |-- No actionable findings --> Proceed to Phase 8
  +-- Has findings --> Fix them, commit fixes
       |
       Iteration 2: Run coderabbit review --plain --type committed
         |-- No actionable findings --> Proceed to Phase 8
         +-- Has findings --> Fix them, commit fixes
              |
              Iteration 3: Run coderabbit review --plain --type committed
                |-- No actionable findings --> Proceed to Phase 8
                +-- Still has findings --> Report to user for manual decision
```

Use `--type committed` to review all committed changes on the branch.
Parse the output for actionable suggestions vs informational notes. Only
fix actionable items.

**Skip condition for the whole phase:** None. 7a and 7c always run on
any task that produces code. 7a is skipped only when the task is
workflow- or doc-only (no diff under `src/`, `supabase/`, or
`dev-tools/`).

## Phase 8: Verify (Local)

**Invoke:** `superpowers:verification-before-completion`

- Set a symlink to .env.local so you can run tests in the worktree with access to env vars
- Run all relevant tests: `npm run test && npm run test:db && npm run test:e2e`, `npm run typecheck`, `npm run lint`, `npm run build`
- Confirm ALL pass with actual output evidence
- Never claim "tests pass" without running them
- **If any check fails:** Fix the issue, commit the fix, re-run. Loop locally until green before proceeding. Max 5 local fix iterations — if still failing after 5, report to user.
- Update `progress.md` with verification results

**Skip condition:** None. Evidence before assertions, always.

## Phase 9: Ship & CI Loop

This phase is **fully autonomous**. Do not ask the user what to do — push, open the PR, and iterate until CI is green **and every review comment is triaged**.

<HARD-GATE>
**Green CI is not Done.** Phase 9 has five sub-phases (9a–9e). All five
must complete, in order, before you may claim the PR is ready for review
or merge. In particular:

- 9b watches CI and fixes any check failure. Reaching all-green CI ends
  9b but does **not** end Phase 9.
- 9d fetches **inline review comments** from CodeRabbit, Codex, Copilot,
  and human reviewers (none of which are visible in `gh pr checks`) and
  triages every one of them. Skipping this step has shipped real bugs.
- 9e is only reachable after 9d has produced an explicit, in-terminal
  list of every bot and human comment, with each one either fixed (with
  a commit) or replied-to on the PR with a reason for declining.

If you find yourself thinking "CI went green, I'll just notify the
user," stop — that is the exact failure mode this gate exists to
prevent. Run 9d first, in full, before announcing anything.
</HARD-GATE>

### 9a: Push & Create PR

1. Push branch: `git push -u origin <branch-name>`
2. Create PR using `gh pr create` with:
   - Concise title (< 70 chars)
   - Body with `## Summary` (1-3 bullets from the plan), `## Test plan`, and link to the design doc
3. Update `progress.md` with the PR number

### 9b: Watch CI, Ingest Feedback, Fix — Autonomously

This step runs as a **single autonomous loop**. Do not wait for user prompts between iterations.

**Step 1: Start CI watch in background**

```bash
# Run in background — blocks until all checks complete, then notifies
gh pr checks <PR_NUMBER> --watch
```

Use `Bash` with `run_in_background: true`. You will be notified when it completes.

**Step 2: When CI completes, ingest all feedback**

```bash
# Ingest GitHub comments, SonarCloud issues, and lint problems into the review queue
dev-tools/refresh-queue.sh --pr <PR_NUMBER> --skip-tests

# If refresh-queue.sh can't reach SonarCloud (missing env vars), fetch manually:
curl -s "https://sonarcloud.io/api/issues/search?componentKeys=toyiyo_nimble-pnl&pullRequest=<PR_NUMBER>&resolved=false" -o /tmp/sonar.json
node dev-tools/ingest-feedback.js --sonar /tmp/sonar.json --pr <PR_NUMBER>

# Also check quality gate (coverage ≥80% on new code is required):
curl -s "https://sonarcloud.io/api/qualitygates/project_status?projectKey=toyiyo_nimble-pnl&pullRequest=<PR_NUMBER>"
```

**Step 3: Read the queue and act on every open item**

```bash
# Show all open items from the queue
cat dev-tools/review_queue.json | python3 -c "
import sys,json
d=json.load(sys.stdin)
for i in d['items']:
  if i['status']=='open':
    print(f\"{i['severity']:8s} {i['source']:16s} {i.get('origin_ref',{}).get('file',''):40s} {i['title'][:80]}\")
"
```

Classify each open item:
- **Actionable** (CI failure, SonarCloud critical/major, code review bug) → Fix it
- **Clarification needed** → Ask user
- **Informational** (nits, style) → Skip

**Step 4: Fix, verify locally, push, repeat**

For each actionable item:
1. Fix the code
2. Run the relevant local check to confirm (`npm run test`, `npm run build`, `npm run lint`)
3. Commit: `"fix(ci): [what was fixed] (iteration N/5)"`
4. Push to branch
5. Go back to Step 1 (start CI watch again)

### 9c: Iteration Limits

- **Max 5 CI iterations.** After 5 failed rounds, stop and report to user.
- **SonarCloud is a required gate** — quality gate MUST pass (coverage ≥80% on new code, zero critical issues).
- Update `progress.md` at each iteration with what was fixed.

### 9d: Review-Comment Triage Gate (MANDATORY — no early exit)

**CI green is not the finish line.** `gh pr checks` only reports status-check
outcomes. CodeRabbit, Codex, Copilot, SonarCloud, and human reviewers all post
**inline comments and PR-level reviews** that never appear in `gh pr checks`.
Several past PRs (#506, #511, others) reached all-green CI with unaddressed
actionable findings sitting in comments — those findings were the bugs we
were trying to fix.

<HARD-GATE>
9d MUST run on every PR, even if 9b reported "no comments in queue."
The queue refresh and the direct `gh api` fetch can disagree (the
refresh filters, the API doesn't), and Codex in particular often posts
inline comments without a status check. You may not call the PR Done
until you have personally:

1. Run **both** the queue refresh AND the direct `gh api` fetches below.
2. Printed the resulting comment list to the terminal so it is visible
   in the transcript.
3. Classified and acted on every entry — fix-with-commit OR reply-on-PR
   with a reason. Silent skipping is not allowed.

If either fetch returns rows you did not read, you are not done.
</HARD-GATE>

**Step 1 — Refresh the review queue:**

```bash
dev-tools/refresh-queue.sh --pr <PR_NUMBER> --skip-tests
cat dev-tools/review_queue.json | python3 -c "
import sys, json
d = json.load(sys.stdin)
opens = [i for i in d['items'] if i['status'] == 'open']
print(f'open items: {len(opens)}')
for i in opens:
    print(f\"  {i['severity']:8s} {i['source']:16s} {i.get('origin_ref',{}).get('file','')}: {i['title'][:80]}\")
"
```

**Step 2 — Direct fetch of bot + human review traffic (queue ingest can
miss things; this is the authoritative check):**

> **Prerequisite:** all three pipelines below depend on `jq` (for the two
> `gh api ... | jq -r` calls) and on `gh`'s built-in `--jq` (which embeds
> jq syntax). Verify with `command -v jq && gh --version` before running.
> If jq is missing: `brew install jq` on macOS, `apt-get install jq` on
> Debian/Ubuntu. (`gh` ships with the binary; only standalone `jq` needs
> a separate install.)

```bash
OWNER_REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
PR=<PR_NUMBER>

echo "── Inline review comments (file:line) ──"
gh api "repos/$OWNER_REPO/pulls/$PR/comments" --paginate \
  | jq -r '.[] | "\(.user.login)\t\(.path):\(.line // .original_line)\t\(.body | gsub("\n"; " ") | .[0:200])"'

echo "── PR conversation comments ──"
gh api "repos/$OWNER_REPO/issues/$PR/comments" --paginate \
  | jq -r '.[] | "\(.user.login)\t\(.body | gsub("\n"; " ") | .[0:200])"'

echo "── PR-level reviews (CodeRabbit summaries, human approvals, change requests) ──"
gh pr view "$PR" --json reviews \
  --jq '.reviews[] | "\(.author.login)\t\(.state)\t\(.body | gsub("\n"; " ") | .[0:200])"'
```

Do not narrow the filter to one bot. Codex, Copilot, CodeRabbit, and humans
all post under different logins and at different layers (inline vs issue vs
review). Print all three lists. Skim every row.

**Step 3 — Classify and act on each row:**

- **Bug / security / correctness / contract drift** → Fix it. Commit with
  a message that names the source (`fix(...): coerce X (CodeRabbit #PR)`).
  After commit, loop back to 9b (push triggers fresh CI).
- **Refactor / suggestion** → Decide: implement OR reply on the PR with a
  short reason for declining. Use `gh api -X POST repos/$OWNER_REPO/pulls/$PR/reviews -f event=COMMENT -f body=...` for a top-level reply, or `gh pr comment` for an issue-level reply. **Silent skipping is not allowed.**
- **Nit / informational** → Read it, decide it's a nit, move on. Reading is
  mandatory; acting is not.

**Red-flag thoughts that mean STOP and re-run 9d:**

| Thought | Reality |
|---------|---------|
| "CodeRabbit's check passed, so the comments are fine" | The check passing means the review ran. Comments are separate. |
| "Codex doesn't have a status check" | Codex usually posts inline comments without a check. Fetch them. |
| "Queue refresh said zero open items" | The refresh filters chitchat and may drop new bot postings. Direct `gh api` is the source of truth. |
| "These are all minor / nits" | Read each one. "Minor" CodeRabbit findings have been real bugs (off-by-one, missing combined `isPending`, contract drift). |
| "I'll triage after notifying the user" | No. 9d completes before any "ready for review" message. |

### 9e: Done

ALL of these MUST be true *and visible in the current Phase 9 execution
window* (you must have actually run the commands during this 9a–9e pass,
not just asserted the conclusion or recalled output from an earlier
phase). "Visible in the current window" means: the commands appear above
in the current transcript, against the latest pushed commit, and no
context compaction has dropped them. If compaction has happened or the
commands ran before the most recent push, re-run them.

- `gh pr checks <PR>` shows all checks passing, against the latest
  commit, in the current 9a–9e execution window.
- SonarCloud quality gate query returned PASS (coverage ≥80% on new
  code, zero critical issues).
- 9d Step 2's three `gh api`/`gh pr view` commands have been printed
  in the current execution window on the **latest** commit, and every
  non-empty row is either:
  - resolved by a commit pushed in this session, **or**
  - replied-to on the PR with a reason, **or**
  - explicitly classified as a nit you chose not to action.
- `dev-tools/review_queue.json` shows zero open `critical` or `major`
  items.

**Self-check before announcing Done:** ask yourself "Could I list every
review comment the user would see on the PR right now, from output I
fetched against the latest commit during this 9a–9e pass?" If the answer
is "I'm not sure," "probably none," or "I fetched it earlier but pushed
a new commit since," go back to 9d Step 2 and re-fetch. Announcing
"ready for merge" with un-read or stale-fetched comments is the explicit
failure mode this phase exists to prevent.

Then:
- Update `progress.md` with `## Status: Ready for merge`
- Notify the user: "PR #NNN is green AND all review comments triaged,
  ready for review/merge" with a one-line summary of the triage outcome
  (e.g., "8 comments: 1 fix committed, 3 nitpicks declined with reply,
  4 informational"). Never use the phrase "ready for merge" without
  that triage summary.

**Skip condition:** None.

## Phase 10: Retrospective

Review the entire workflow session and capture lessons learned:

1. **Identify corrections** — Scan the session for:
   - User corrections ("no, do it this way", "that's wrong", redirects)
   - CodeRabbit findings that required fixes (Phase 7)
   - Test failures that revealed wrong assumptions (Phase 4/8)
   - Design changes after initial brainstorm (Phase 2 pivots)

2. **Write lessons** — For each correction, append to the appropriate category in `memory/lessons.md`:
   ```markdown
   ### [YYYY-MM-DD] Short title
   - **Mistake:** What was done wrong or assumed incorrectly
   - **Correction:** What the right approach turned out to be
   - **Rule:** The general principle to apply going forward
   ```

3. **Deduplicate** — If a lesson reinforces an existing entry, update the existing one instead of adding a duplicate. Add a "confirmed" note.

4. **Prune** — If a lesson from a previous session turned out to be wrong or outdated, remove or correct it.

**Skip condition:** No corrections occurred during the session (clean run through all phases). Only the lesson-writing steps (1-4) are skipped — progress cleanup below always runs.

### Progress Cleanup (always runs)

5. **Finalize progress** — Update `progress.md` with `## Status: Complete` and delete it. This step runs regardless of whether lessons were written, to prevent stale `progress.md` from triggering false resume in future sessions.

## Autonomy Guidelines

After the user approves the plan (end of Phase 3), the workflow should run autonomously through Phases 4–9 without requiring human input. The only exceptions where you should pause and ask:

1. **Phase 2.5 design-reviewer raises a `critical` concern** that is not
   purely a fix-in-design (architecturally ambiguous, requires changing
   the approved approach). `major` concerns that can be folded into the
   design doc are handled autonomously by editing the doc + committing.
2. **Phase 7b actionable finding** that is architecturally ambiguous —
   i.e., fixing it requires changing the design approved in Phase 2.
3. **Ambiguous review comments** (Phase 9d) — When a reviewer's intent
   is unclear.
4. **Persistent CI failures** (Phase 9c) — After 5 failed iterations.
5. **Architectural decisions** — When a fix requires changing the
   approved design.
6. **Genuine blockers** — Environment issues, missing credentials, etc.

For everything else — test failures, lint errors, design-review `minor`
or `major` findings, Phase 7 multi-model findings, CodeRabbit findings,
CI red — diagnose and fix autonomously. Each failure is structured
feedback, not a reason to stop.

**Things you may NEVER autonomously skip,** even under time pressure:

- Phase 8 (Verify): tests, typecheck, lint, build must actually run and
  pass before push.
- Phase 9d (Review-Comment Triage): the `gh api` fetches for inline
  comments, issue comments, and PR-level reviews are non-skippable on
  every PR, including PRs where 9b reported zero open queue items. "CI
  is green" is never sufficient to claim Done.

### Context Recovery

If a session is interrupted (context compression, timeout, crash):
1. Read `progress.md` to understand current state
2. Read the plan file linked in `progress.md`
3. Check `git log` for recent commits
4. Resume from the last incomplete phase — do not restart from Phase 0

This is the Ralph loop principle: each fresh context window re-orients from persistent artifacts (git history, progress.md, plan files), not from conversation memory.

## Quick Reference

| Phase | Skill/Command | Skip If |
|-------|---------------|---------|
| 0. Consult Lessons | Read `memory/lessons.md` + `progress.md` | Never |
| 1. Isolate | `superpowers:using-git-worktrees` | Already in a dedicated worktree |
| 2. Brainstorm | `superpowers:brainstorming` | Never |
| 2.5 Design Review | Agents: `supabase-design-reviewer` + `frontend-design-reviewer` (parallel) | Workflow/doc-only changes; per-reviewer skip if domain untouched |
| 3. Plan | `superpowers:writing-plans` | Never |
| 4. Build | `superpowers:test-driven-development` | Never |
| 5. UI Review | `frontend-design:frontend-design` | No UI changes |
| 6. Simplify | `code-simplifier:code-simplifier` | Never |
| 7a Multi-Model Review | Agents: `security`, `performance`, `maintainability`, `sound-logic` + `dev-tools/codex-adversarial-review.sh` (parallel) | Workflow/doc-only changes (no code diff) |
| 7b Fold Findings | Classify + fix `critical`/`major`, commit | No `critical`/`major` findings |
| 7c CodeRabbit | `coderabbit review --plain --type committed` | Never |
| 8. Verify | `superpowers:verification-before-completion` | Never (loop locally until green) |
| 9a Push & Create PR | `git push -u origin <branch>` + `gh pr create` | Never |
| 9b Watch CI + fix red | `gh pr checks <PR> --watch` + autonomous fix loop (max 5 iter) | Never |
| 9c Iteration limits | — | Informational only |
| 9d Comment triage | `dev-tools/refresh-queue.sh` + `gh api .../comments` + `gh pr view --json reviews` | Never — green CI does NOT exempt |
| 9e Done | All checks ✓, SonarCloud ✓, 9d triage transcript visible | Never |
| 10. Retrospective | Write to `memory/lessons.md` | No corrections occurred |
