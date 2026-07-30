# Split the SonarCloud scan out of the Unit Tests job

- **Date:** 2026-07-29
- **Branch:** `claude/priceless-kapitsa-f0edad`
- **Scope:** `.github/workflows/unit-tests.yml` + one guard test. No `src/`,
  `supabase/`, or `dev-tools/` code.

## Problem

`.github/workflows/unit-tests.yml` runs the unit suite, uploads coverage, and
scans with SonarCloud in a single job named `Unit Tests`
([unit-tests.yml:16-54](.github/workflows/unit-tests.yml#L16-L54)). The Sonar
step is the last one ([unit-tests.yml:50-54](.github/workflows/unit-tests.yml#L50-L54)),
costing ~1m45s of a ~9m30s job.

Because the two live in one job, one status check carries two independent
signals. Any Sonar slowness — or a cancellation during the Sonar upload —
surfaces to PR authors as **"Unit Tests: fail"** with all 8017 tests green.
Runs `30472141373` and `30480912925` both died this way at the 10-minute cap.

Raising `timeout-minutes` (commit `0fc61e44`, on the unmerged branch
`ci/unit-tests-timeout-headroom`) bought slack but did not decouple the
signals: a Sonar-side hang still reports as a unit-test failure.

## Current state (verified)

| Claim | Citation |
|---|---|
| Sonar runs as the final step of the `test` job | [unit-tests.yml:50-54](.github/workflows/unit-tests.yml#L50-L54) |
| The `test` job checks out with `fetch-depth: 0` for Sonar | [unit-tests.yml:22-25](.github/workflows/unit-tests.yml#L22-L25) |
| Coverage is already uploaded as artifact `coverage-report` from `coverage/`, `if: always()` | [unit-tests.yml:42-48](.github/workflows/unit-tests.yml#L42-L48) |
| `pull-requests: read` is declared at **workflow** level, not job level | [unit-tests.yml:11-13](.github/workflows/unit-tests.yml#L11-L13) |
| The `test` job cap is currently `timeout-minutes: 10` on `main` | [unit-tests.yml:19](.github/workflows/unit-tests.yml#L19) |
| Sonar reads lcov from `coverage/lcov.info` | [sonar-project.properties:41-42](sonar-project.properties#L41-L42) |
| Sonar analyses `src` and `tests` from the checkout | [sonar-project.properties:8-9](sonar-project.properties#L8-L9) |
| Vitest writes lcov into `./coverage` | [vitest.config.ts:18,46](vitest.config.ts#L46) |

## Design

Split into two jobs in the same workflow file.

### `test` — "Unit Tests"

Unchanged except: the Sonar step is removed, and `timeout-minutes` goes
`10 → 15`.

On sizing the cap: the two measurements available disagree slightly. The
combined job clocked ~9m30s end to end with a ~1m45s Sonar tail, which puts
the remainder near ~7m45s; summing the per-step figures (~30s install, ~7m50s
`test:coverage`, ~10s `test:tz`) gives ~8m30s. Both are approximate, so take
the larger — ~8m30s — and 15 minutes is still comfortably under 2× it. This
supersedes the `20` on `ci/unit-tests-timeout-headroom`, which was sized for a
job that still carried Sonar.

`fetch-depth: 0` is **dropped** from this job. Its only stated purpose was
Sonar (the comment read "Full history for SonarQube"), which now lives
elsewhere, and nothing in the unit suite reads git history — the one test that
shells out (`tests/unit/schedule-prompt-builder-retired.test.ts:42`) invokes
`grep`, not `git`. Leaving a full-history clone behind with no consumer is
cruft, so it goes with the step that needed it.

### `sonarcloud` — "SonarCloud"

```yaml
sonarcloud:
  name: SonarCloud
  needs: [test]
  runs-on: ubuntu-latest
  timeout-minutes: 10
  steps:
    - checkout (fetch-depth: 0)
    - setup-node + npm ci
    - download-artifact: coverage-report → coverage/
    - SonarSource/sonarcloud-github-action@v5
```

Five things this has to get right:

1. **Full git history.** Jobs run on separate runners with separate
   checkouts, so the `test` job's `fetch-depth: 0` does not carry over. The
   new job needs its own `actions/checkout@v4` with `fetch-depth: 0` for
   Sonar's new-code/blame detection.

2. **Coverage file path.** `upload-artifact@v4` with `path: coverage/` stores
   the *contents* of `coverage/` at the artifact root, so
   `download-artifact@v4` with `name: coverage-report` and `path: coverage`
   restores `coverage/lcov.info` — the exact path
   `sonar.javascript.lcov.reportPaths` expects. Asserted by the guard test
   (below) rather than left to a comment, because this is silent-failure
   shaped: a wrong path makes Sonar report 0% new-code coverage and fail the
   quality gate without any "file not found" error. This is the same failure
   mode as the 2026-05-16 lesson on `sonar.coverage.exclusions` drift.

3. **Analysis parity — `node_modules`.** SonarJS resolves imported types
   through `node_modules`, and the combined job happened to have them
   installed (`npm ci` ran before the scan). A fresh runner would not, so the
   scan could report a different issue set — and move the quality gate — with
   no code change behind it. The new job therefore repeats `setup-node` +
   `npm ci` (~30s with the npm cache). Not a theoretical concern in the narrow
   sense CodeRabbit first raised it — no `tsconfig*.json` here `extends` a
   package under `node_modules` — but type resolution for third-party imports
   is reason enough. The split is meant to separate two signals, not to change
   what the analysis can see.

4. **PR decoration.** `permissions:` is workflow-level
   ([unit-tests.yml:11-13](.github/workflows/unit-tests.yml#L11-L13)), so it
   already applies to every job including the new one. No job-level
   `permissions` block is added — adding one would *replace* the workflow
   default, not merge with it, which is the easy way to silently break
   decoration.

5. **Gating.** Plain `needs: [test]` with no `if:`. When the suite fails,
   the Sonar job is skipped, which matches today's behaviour exactly (the
   Sonar *step* already only ran when preceding steps succeeded) and avoids
   publishing a quality gate computed from partial coverage.

### Guard test

`tests/unit/unitTestsWorkflowSplit.test.ts` — a regex-driven read of the
workflow file, in the style of the guard test on
`ci/unit-tests-timeout-headroom`. It pins the properties that, if silently
reverted, would restore the coupled-signal bug or break the scan:

- The `test` job declares `timeout-minutes >= 15` and contains **no** Sonar step.
- A `sonarcloud` job exists, with `needs: [test]` and the Sonar action.
- That job checks out with `fetch-depth: 0` and installs dependencies.
- It downloads artifact `coverage-report` into a directory that **matches the
  directory in `sonar.javascript.lcov.reportPaths`** — a cross-file
  consistency check, so the two halves of one config cannot drift apart.
- Workflow-level `permissions` still grants `pull-requests: read`, and the
  `sonarcloud` job declares no job-level `permissions` block that would
  override it.

No YAML parser dependency is added: `yaml` is not a declared dep
(`package.json` has none), and pulling one in for a single CI-shape test is
more churn than a small block-splitting helper.

## Decided trade-offs

- **End-to-end wall-clock is worse, on purpose.** The scan now waits for the
  whole test job instead of running inside it, and it repeats work that job
  already did: checkout, `npm ci`, and the artifact download, call it ~45s
  once the npm cache is warm. So the Sonar verdict lands roughly
  `test job (~8m30s) + ~45s + scan (~1m45s)` ≈ **~11m** into the run, versus
  ~9m30s before. The unit-test verdict, which is what a PR author is usually
  waiting on, arrives *earlier* — it no longer has the Sonar tail bolted to
  it. Trading ~1m30s of Sonar latency for two signals that mean what they say
  is the whole point of the change.
- **Branch protection is a repo setting, not a file.** Splitting the job
  introduces a new check name, `SonarCloud`. If the quality gate is meant to
  block merges, that check has to be added to the required-checks list in
  GitHub branch-protection settings — I cannot do that from the repo, so it
  is called out in the PR body.
- **Superseding `ci/unit-tests-timeout-headroom`.** Per the user's decision,
  this lands fresh off `main`; that branch should be dropped rather than
  merged, since its 20-minute cap was sized for a job that still carried
  Sonar.
