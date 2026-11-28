# Plan: run every TLA+ model check in CI

Design: `docs/superpowers/specs/2026-11-28-tla-ci-design.md`
Branch: `claude/exciting-ptolemy-ojvfr1`

This is a CI and doc change. There is no code under `src/` or `supabase/`.
Run the phases inline. Stage explicit paths only.

### Task 1: Add the workflow

- File: `.github/workflows/tla-model-check.yml`.
- Check: `actionlint` has no findings. Run the same commands as the job
  locally: `tlc.sh install`, then `tlc.sh all specs/tla` gives 9/9.

### Task 2: Add the doc section

- File: `.claude/skills/run-tla/SKILL.md`, new section "CI check".
- Tell a developer where to put a spec, how to name the files, and how
  to read a failed job.

### Task 3: Prove the gate in CI

1. Push and open a PR to `main`. The job must pass with 9/9.
2. Push a test commit that breaks one invariant in a pass config. The
   job must fail and print the full log.
3. Revert the test commit. The job must pass again.
