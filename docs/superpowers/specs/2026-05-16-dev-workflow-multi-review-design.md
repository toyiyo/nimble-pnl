# Dev Workflow Enhancement — Design Review (Phase 2.5) + Multi-Model Code Review (Phase 7)

**Date:** 2026-05-16
**Branch:** `feature/dev-workflow-multi-review`
**Author:** Jose M Delgado / Claude Code

## Problem

The current `/dev` workflow leans heavily on **CodeRabbit** as its third-party
code-review safety net (Phase 7 local CLI + Phase 9d PR-side bot). CodeRabbit
has been valuable, but two structural problems are showing up in practice:

1. **CodeRabbit throttles us.** We're hitting their rate limits often enough
   that it slows the autonomous CI loop in Phase 9. We need to stop putting all
   our review eggs in one third-party basket.
2. **Claude is grading its own homework.** Phases 4–6 (Build, UI Review,
   Simplify) all run Claude. The only non-Claude code-review signal we have
   before merge is CodeRabbit + the PR-side Codex/Copilot bots. When CodeRabbit
   is throttled or doesn't run, the only thing standing between Claude's draft
   and `main` is Claude's own review of Claude's own code.
3. **No design review.** Today brainstorm (Phase 2) flows directly into plan
   (Phase 3). Mistakes in the design propagate through TDD into reviewable
   code, where they're 10× more expensive to fix.

## Goals

1. Insert a mandatory **Phase 2.5 — Design Review** between brainstorm and
   plan. Two always-on focused sub-agents (Supabase + Frontend) load the
   appropriate skills and review the design doc against best practices before
   any code is written.
2. Replace the single-source Phase 7 with a **multi-model code-review fan-out**:
   four Claude sub-agents (security, performance, maintainability, sound logic)
   running in parallel, plus a **Codex adversarial reviewer** that exercises
   an independent (non-Claude) model on the same diff. CodeRabbit local
   becomes the *final* gate, not the *only* gate.
3. Install a curated bundle of skills.sh skills so each focused reviewer has
   a clear, narrow knowledge loadout instead of a sprawling generalist prompt.

## Non-Goals

- Replacing CodeRabbit. It still runs as the final Phase 7 gate, and the
  GitHub-side CodeRabbit bot still posts inline comments handled by Phase 9d.
- Reworking Phases 1, 3, 4, 5, 6, 8, 9, 10. They stay as-is.
- Adding new CI workflows on the GitHub side. The new reviewers run locally
  during the autonomous loop, like the existing CodeRabbit local CLI does.

## Phase 2.5 — Design Review

### Trigger

Runs **immediately after** the design doc is committed at the end of Phase 2,
**before** Phase 3 (Plan) begins.

### Sub-agents

Two focused sub-agents run **in parallel** via `Agent` tool with
`subagent_type=general-purpose` plus a custom prompt that loads the relevant
skills:

#### `supabase-design-reviewer`

- **When it runs:** The design touches database schema, RLS policies, edge
  functions, RPC, migrations, or any `restaurant_id`-scoped table. Detected
  by scanning the design doc for `supabase`, `migration`, `rpc`, `rls`,
  `edge function`, or `.sql` references.
- **Skill loadout (loaded into prompt):**
  - `supabase-postgres-best-practices`
  - `supabase-audit-rls`
  - `postgresql-code-review`
- **Reviews for:**
  - RLS policies on every new/changed table; `restaurant_id` isolation
  - Migration safety (NOT NULL on big tables, default backfills, locking)
  - Edge function CPU + memory limits (10s ceiling, batch processing)
  - Unified-sales-table writes (no POS-specific logic leaking)
  - Indexes implied by the proposed query patterns
- **Output:** Short markdown list of `severity:major|minor` concerns.

#### `frontend-design-reviewer`

- **When it runs:** The design touches UI/components, dialogs, forms, or
  styling. Detected by scanning the design doc for `component`, `dialog`,
  `form`, `page`, `mobile`, `viewport`, `tailwind`, `shadcn`, `Apple/Notion`,
  or any reference to `src/components/`.
- **Skill loadout:**
  - `frontend-design`
  - `web-quality-skills/accessibility`
  - `web-quality-skills/performance`
  - `shadcn`
- **Reviews for:**
  - CLAUDE.md compliance: typography scale, semantic tokens, no direct colors,
    border/40 + muted/30 patterns, loading/empty/error states
  - Accessibility: aria-labels on icon buttons, label↔input association,
    keyboard reachability, focus traps in modals
  - Performance: lists with 100+ items virtualized, memoization, no per-row
    dialog, query staleTime ≤ 60s
  - shadcn idioms: correct Radix primitive use, no leaking internal state
    out of compound components
- **Output:** Short markdown list of `severity:major|minor` concerns.

### Skip conditions

- **Supabase reviewer skipped** when no DB/edge-function/SQL surface is
  touched. The detection is keyword-based; when ambiguous, the reviewer
  runs.
- **Frontend reviewer skipped** when no UI/component surface is touched.
  Same detection rule.
- Both skipped when the task is a workflow/doc-only change (like this one).
- **Hard rule:** When applicable, NEITHER can be silently skipped. If the
  detection says "applicable" the reviewer MUST run.

### Folding feedback in

After both reviewers return:

1. Read the combined concerns list.
2. For each `major` concern, decide:
   - **Fix in design** → Edit the design doc, commit the change.
   - **Defer with rationale** → Add a "Decided trade-offs" section to the
     design doc explaining why the concern is accepted as-is.
3. For `minor` concerns, decide:
   - **Fix in design** → Edit + commit.
   - **Skip** → Note in retrospective so we can refine the reviewer prompt.
4. Proceed to Phase 3 (Plan) only after the design doc has been updated.

## Phase 7 — Multi-Model Code Review

### Trigger

Runs **after Phase 6 (Simplify)** and **before** Phase 8 (Verify).

### Topology

```
Phase 6  Simplify
   |
   v
Phase 7a  Multi-model fan-out (PARALLEL)
   ├─ claude:security-reviewer
   ├─ claude:performance-reviewer
   ├─ claude:maintainability-reviewer
   ├─ claude:sound-logic-reviewer
   └─ codex:adversarial-reviewer  (independent model)
   |
   v
Phase 7b  Fold findings: fix actionable items, commit fixes
   |
   v
Phase 7c  CodeRabbit local CLI (final gate, max 3 iterations)
   |
   v
Phase 8  Verify
```

### Claude sub-agents (4)

All implemented as `Agent` calls with `subagent_type=feature-dev:code-reviewer`,
each prompt scoped to one review dimension and loading the relevant skills.
They all read the same input: `git diff origin/main...HEAD` plus a `git log`
summary so they can see what was built.

#### `security-reviewer`

- **Focus:** OWASP top 10 — XSS, SQL injection, command injection, auth bypass,
  CSRF, broken access control, secret leakage, RLS bypass.
- **Skill loadout:** `security-best-practices` (Codex side, re-readable),
  `supabase-audit-rls`.
- **Output:** Findings tagged `security:critical|major|minor`.

#### `performance-reviewer`

- **Focus:** N+1 queries, unnecessary re-renders, missing virtualization, hot
  paths, missed concurrency, query bloat, missing staleTime tuning.
- **Skill loadout:** `web-quality-skills/performance`, `vercel-react-best-practices`.
- **Output:** Findings tagged `performance:critical|major|minor`.

#### `maintainability-reviewer`

- **Focus:** CLAUDE.md hygiene (no manual cache, semantic tokens, import
  order, comment hygiene), abstraction smells, naming, dead code, nested
  conditionals, unnecessary JSX nesting, leaky abstractions.
- **Skill loadout:** `typescript-react-reviewer`, `shadcn`.
- **Output:** Findings tagged `maintainability:major|minor`.

#### `sound-logic-reviewer`

- **Focus:** Edge cases, off-by-one, null/undefined paths, race conditions,
  state inconsistencies (e.g., stale closures), error boundaries, retry
  storms.
- **Skill loadout:** `vercel-react-best-practices`, `requesting-code-review`.
- **Output:** Findings tagged `logic:critical|major|minor`.

### Codex adversarial reviewer (1)

- **Focus:** Find a single sharp adversarial concern Claude missed. Bring
  GPT-class-model perspective independent of Claude's training distribution.
- **Mechanism:** `dev-tools/codex-adversarial-review.sh` (new) wraps
  `codex exec`. The script:
  1. Captures `git diff origin/main...HEAD` and the design doc text.
  2. Pipes both into `codex exec` with an adversarial prompt:
     > You are reviewing code written by Claude Sonnet. Find one concrete
     > bug, security issue, or correctness flaw it would miss. Be specific:
     > file, line, and the failure mode. If you genuinely can't find one,
     > say so — don't invent.
  3. Captures Codex's stdout. Parses structured `file:line:severity:message`
     lines into the findings list.
  4. Stores the raw output in `dev-tools/codex-review-output.md` for the
     workflow to ingest.
- **Skill loadout (Codex side, already global):** `security-best-practices`.
- **Output:** Findings tagged `adversarial:critical|major|minor`.

### Pre-requisite

Codex CLI must be installed and authenticated. Detection in the workflow:

```bash
if ! command -v codex >/dev/null; then
  echo "WARN: codex CLI not on PATH. Adversarial review will be SKIPPED."
  echo "      Install: brew install --cask codex && codex login"
fi
```

If codex is missing, the workflow logs a warning and **continues without
the adversarial reviewer**. Adversarial review is "best-effort" because the
binary may not be installed everywhere we run the workflow. The 4 Claude
reviewers still run.

### Folding findings in (Phase 7b)

1. Collect all `critical` + `major` findings from all 5 reviewers.
2. Deduplicate (same file:line from multiple reviewers → keep highest
   severity, merge messages).
3. For each, classify:
   - **Actionable bug/security** → Fix it. Commit `"fix(review): <area> —
     addresses <reviewer> finding"`.
   - **Style/nit** → Skip (CodeRabbit catches these in Phase 7c).
   - **False positive** → Note in retrospective; skip.
4. Re-run any reviewer that flagged a fixed issue to confirm.

### CodeRabbit (Phase 7c)

Existing CodeRabbit local CLI loop, unchanged. Up to 3 iterations.
CodeRabbit's role narrows: it's the *final consistency check*, not the
*primary review*. Most issues should already be caught by 7a.

## Skill bundle

Install all 10 globally (matches existing pattern where Claude skills live
under `~/.agents/skills/`):

```bash
# Recommended set (Core 7)
npx skills add -g -a "Claude Code" -y yoanbernabeu/supabase-pentest-skills@supabase-audit-rls
npx skills add -g -a "Claude Code" -y github/awesome-copilot@postgresql-code-review
npx skills add -g -a "Claude Code" -y addyosmani/web-quality-skills@accessibility
npx skills add -g -a "Claude Code" -y addyosmani/web-quality-skills@performance
npx skills add -g -a "Claude Code" -y dotneet/claude-code-marketplace@typescript-react-reviewer
npx skills add -g -a "Claude Code" -y currents-dev/playwright-best-practices-skill@playwright-best-practices
npx skills add -g -a "Claude Code" -y shadcn/ui@shadcn

# Plus
npx skills add -g -a "Claude Code" -y poteto/noodle@adversarial-review
npx skills add -g -a "Claude Code" -y antfu/skills@vitest
npx skills add -g -a "Claude Code" -y obra/superpowers@requesting-code-review
```

Verification step in Phase 4 (build): `npx skills list -g` must show all 10.

## Sub-agent files

Add the following to `.claude/agents/` (project-scope):

```
.claude/agents/
├─ supabase-design-reviewer.md
├─ frontend-design-reviewer.md
├─ security-reviewer.md
├─ performance-reviewer.md
├─ maintainability-reviewer.md
├─ sound-logic-reviewer.md
└─ codex-adversarial-runner.md   # documentation only; actual runner is dev-tools/codex-adversarial-review.sh
```

Each markdown file has:
- YAML frontmatter: `name`, `description`, `subagent_type` (defaulted to
  `general-purpose` or `feature-dev:code-reviewer`).
- "Skill loadout" section: explicit list of skills the agent should `Skill`-invoke
  before working.
- "Review checklist" section: the dimension-specific items.
- "Output format" section: severity tags + file:line + short reasoning.

## Codex runner script

`dev-tools/codex-adversarial-review.sh`:

```bash
#!/usr/bin/env bash
# Run Codex adversarial review on the current branch diff.
# Usage: codex-adversarial-review.sh [--base main]

set -euo pipefail

BASE="${1:-main}"

if ! command -v codex >/dev/null 2>&1; then
  echo "::skip:: codex CLI not on PATH — install with: brew install --cask codex"
  exit 0
fi

DIFF=$(git diff "origin/${BASE}...HEAD")
DESIGN_DOC=$(find docs/superpowers/specs -name "$(date +%Y-%m-%d)-*-design.md" -print -quit 2>/dev/null || true)
DESIGN_CONTEXT=""
if [ -n "$DESIGN_DOC" ] && [ -f "$DESIGN_DOC" ]; then
  DESIGN_CONTEXT=$(cat "$DESIGN_DOC")
fi

PROMPT=$(cat <<EOF
You are reviewing code written by Claude Sonnet, deployed into a
multi-tenant restaurant-management React/Supabase app. Find ONE concrete
bug, security issue, or correctness flaw a self-reviewing Claude would
miss.

Be specific: cite file:line and the failure mode. If you genuinely cannot
find a concrete issue, say "No adversarial finding." — do not invent
findings.

Output format (one per finding):
  ::finding:: severity=<critical|major|minor> file=<path> line=<n>
  <one-paragraph description of the bug and the trigger>

Design context:
$DESIGN_CONTEXT

---
Diff:
$DIFF
EOF
)

codex exec "$PROMPT" > dev-tools/codex-review-output.md
echo "Codex adversarial review written to dev-tools/codex-review-output.md"
```

Made executable; checked in.

## Updates to `development-workflow.md`

1. Renumber sections so Phase 2.5 is its own section between Phase 2 and Phase 3.
2. Replace the existing Phase 7 section with the 7a/7b/7c three-step block.
3. Update the Quick Reference table at the bottom.
4. Update the Autonomy Guidelines pause-conditions list to include "design
   reviewer raised a `major` concern" → continue if you can fix in the design
   doc; pause only if it's architecturally ambiguous.

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Codex CLI broken / not installed on contributor machines | Workflow auto-skips with a WARN. Adversarial review is best-effort. |
| 5 parallel sub-agents blow up context budget | Each sub-agent runs in its own `Agent` call — context isolated. Only their summarized findings flow back. |
| Reviewers nitpick infinitely | Phase 7b explicitly only acts on `critical|major`. Style nits deferred to CodeRabbit Phase 7c. |
| Skill installs fail or change names | Phase 4 verifies `npx skills list -g` shows all 10 before proceeding. If install fails, plan halts at that task. |
| Design reviewer flag pre-existing patterns as concerns | Design reviewer reviews the **design doc**, not existing code. Existing-code concerns are out of scope for Phase 2.5. |
| Over-eager design review blocks small fixes | The phase auto-skips on doc/workflow-only changes (keyword detection). |
| Codex prompt leaks internal context | The runner only passes the diff and the design doc text — both of which are about to be public on a PR. No secrets, .env, or `lessons.md`. |

## Acceptance criteria

- [x] User has approved skill bundle (Core 7 + adversarial + vitest + requesting-code-review).
- [ ] `npx skills list -g` shows all 10 new skills.
- [ ] `.claude/agents/` contains 6 reviewer agent definitions + the codex
  runner doc.
- [ ] `dev-tools/codex-adversarial-review.sh` is executable and exits 0
  with a "skip" message when `codex` is missing.
- [ ] `.claude/skills/development-workflow.md` has Phase 2.5 and the
  rewritten Phase 7 (7a/7b/7c) and an updated Quick Reference.
- [ ] Smoke test: invoke `frontend-design-reviewer` against a known
  trivial design doc; it returns a concerns list.
- [ ] PR opens, CI green, no regressions to existing dev workflow.
