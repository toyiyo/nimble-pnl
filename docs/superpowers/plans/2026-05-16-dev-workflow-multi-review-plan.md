# Plan — Dev Workflow Multi-Review (Phase 2.5 + Phase 7)

**Spec:** `docs/superpowers/specs/2026-05-16-dev-workflow-multi-review-design.md`
**Branch:** `feature/dev-workflow-multi-review`

## Tasks

### Task 1: Install skill bundle (2 min)
Run the 10 `npx skills add -g -a "Claude Code" -y ...` commands from the spec.
Verify with `npx skills list -g | grep -E "<each-name>"`. Halt if any fail.

**Dependency:** none

### Task 2: Create `.claude/agents/` directory + author 6 sub-agent files (5 min)
For each of:
- `supabase-design-reviewer.md`
- `frontend-design-reviewer.md`
- `security-reviewer.md`
- `performance-reviewer.md`
- `maintainability-reviewer.md`
- `sound-logic-reviewer.md`

Write a markdown file with:
- YAML frontmatter (`name`, `description`, `subagent_type`).
- Skill loadout section.
- Review checklist section.
- Output format section (severity + file:line + reasoning).

These are *prompt templates* the `/dev` workflow invokes; they don't need to
be registered with Claude Code in any special way — they're just docs the
workflow points its `Agent` calls at.

**Dependency:** Task 1 (skills must exist before referencing them)

### Task 3: Write Codex adversarial runner (3 min)
Author `dev-tools/codex-adversarial-review.sh` exactly as in the spec.
- `chmod +x` it.
- Test: run with `codex` missing → must `echo "::skip::"` and `exit 0`.
- Document a `codex-adversarial-runner.md` agent doc in `.claude/agents/`
  that explains how Phase 7 invokes this script.

**Dependency:** none (parallel with Task 2)

### Task 4: Rewrite `.claude/skills/development-workflow.md` (5 min)
- Insert new "Phase 2.5: Design Review" section between current Phase 2 and
  Phase 3.
- Replace current Phase 7 section with three subsections: 7a multi-model
  fan-out, 7b fold findings, 7c CodeRabbit final gate.
- Update Quick Reference table: add Phase 2.5 row, expand Phase 7 row.
- Update Autonomy Guidelines pause-conditions.
- Update Overview paragraph to mention the new phases.

**Dependency:** Tasks 1, 2, 3 (so the doc refers to real files)

### Task 5: Smoke test the new flow (3 min)
- Invoke `frontend-design-reviewer` via the `Agent` tool against this very
  spec doc (which has frontend-relevant sections). Confirm it returns
  structured findings.
- Invoke the Codex runner shell script with a dummy diff. Confirm it skips
  cleanly with a WARN if codex is missing (we know it's missing right now
  due to the broken symlink — user will reinstall).
- No code is verified here; this is a dry run of the new wiring.

**Dependency:** Tasks 2, 3, 4

### Task 6: Verify (typecheck, lint, build) (2 min)
- `npm run typecheck` — must be clean (we changed no TS).
- `npm run lint` — must not introduce new errors from our changes.
- `npm run build` — must succeed (no source changes, just docs + shell).
- Skip `npm run test` — no test changes; the existing TZ-flaky test isn't
  ours.

**Dependency:** Task 5

### Task 7: Commit, push, open PR (2 min)
- Single commit on `feature/dev-workflow-multi-review`:
  `feat(dev-workflow): design review + multi-model code review`.
- Push and open PR with summary referencing the spec.
- Run autonomous CI loop per Phase 9.
- Run the NEW flow against itself? Not strictly — this PR is workflow-only,
  so Phase 2.5 reviewers skip per the doc-only skip condition. Phase 7 also
  has no source code to review, so we skip the new reviewers and let
  CodeRabbit be the only review.

**Dependency:** Task 6

## Schedule

Tasks 1, 3 in parallel. Then 2 (depends on 1). Then 4 (depends on 1, 2, 3).
Then 5, 6, 7 sequentially.

## Acceptance

All items in the spec's Acceptance Criteria section turn green.
