# Plan: split the SonarCloud scan into its own job

Design: [docs/superpowers/specs/2026-07-29-split-sonarcloud-job-design.md](../specs/2026-07-29-split-sonarcloud-job-design.md)

## Tasks

1. **Confirm the lcov path assumption empirically.**
   Run a single-file coverage pass and inspect `coverage/lcov.info` — confirm
   it exists at that path and note whether `SF:` entries are absolute or
   relative (absolute still resolves in CI, since both jobs use the same
   `/home/runner/work/nimble-pnl/nimble-pnl` workspace, but relative is
   cleaner and worth knowing).
   *No commit.*

2. **RED — write the guard test.**
   `tests/unit/unitTestsWorkflowSplit.test.ts`, asserting the six properties
   listed in the design. Run it against the un-split workflow; it must fail
   on the "no Sonar step in the `test` job" and "`sonarcloud` job exists"
   assertions.
   *No commit (RED state).*

3. **GREEN — split the workflow.**
   Edit `.github/workflows/unit-tests.yml`: drop the Sonar step from `test`,
   raise its `timeout-minutes` to 15, add the `sonarcloud` job with
   `needs: [test]`, checkout `fetch-depth: 0`, `download-artifact` into
   `coverage`, and the Sonar action. Re-run the guard test → green.
   *Commit: `ci(unit-tests): split SonarCloud scan into its own job`.*

4. **Validate the YAML is well-formed and the graph is what I think it is.**
   Parse the workflow with a throwaway script (transitive `yaml`, not a new
   dep) and print the job list, each job's `needs`, `timeout-minutes`, and
   step `uses`/`with`. Confirm `sonarcloud` depends on `test`, no job-level
   `permissions` block shadows the workflow default, and there is exactly one
   Sonar action invocation.
   *No commit.*

5. **Phase 6 — simplify.**
   Re-read the diff for clarity: comment density matching the file, no
   redundant keys, job/step names that read well in the GitHub UI.
   *Amend or follow-up commit as needed.*

6. **Phase 7c — CodeRabbit local CLI.**
   `coderabbit review --plain --type committed`, fix actionable findings.
   Best-effort: if the CLI is absent, record the skip.

7. **Phase 8 — verify.**
   `npm run typecheck`, `npm run lint`, `npm run test` (full suite, so the new
   guard test runs alongside everything else), `npm run build`.
   E2E is not applicable — this change has no user-facing surface and no
   cross-layer seam; the behavior it changes is CI job topology, which is
   covered by the guard test plus the real CI run in task 8.

8. **Phase 9 — ship.**
   Push, open the PR, watch CI. The verification the task actually asks for
   lives here: confirm **`Unit Tests` and `SonarCloud` report as two separate
   checks**, and that SonarCloud still decorates the PR (quality-gate status
   + any inline issues). Then run the 9d comment-triage gate.

## Dependencies

1 → 2 → 3 → 4 → 5 → 6 → 7 → 8, strictly sequential. Task 1 informs nothing in
the YAML but would change the design if lcov landed somewhere unexpected, so
it runs first.
