# Design: run every TLA+ model check in CI

## Problem

TLC runs only by hand through `.claude/skills/run-tla/tlc.sh`. CI does not
run it. A spec under `specs/tla/` can break without notice. Other sessions
add new specs now.

## Facts about the existing driver

- `tlc.sh install` downloads `tla2tools.jar` 1.7.4 to `TLA_TOOLS_DIR`
  (default `~/.cache/tla`) and checks its SHA-256
  (`.claude/skills/run-tla/tlc.sh:14-17`, `:24-34`).
- On a cache hit, `install` checks the SHA-256 again and returns
  (`.claude/skills/run-tla/tlc.sh:25`).
- `tlc.sh all <dir>` checks each `*.cfg` under `<dir>` and maps
  `Model_Variant.cfg` to `Model.tla` (`.claude/skills/run-tla/tlc.sh:91-101`).
- A `.cfg` whose first line has `EXPECT: violation` must fail TLC
  (`.claude/skills/run-tla/tlc.sh:49-50`).
- The driver writes each full log to `TLC_LOG_DIR/<cfg-name>.log`
  (`.claude/skills/run-tla/tlc.sh:18`, `:59-60`).
- On a mismatch, the driver prints a `FAIL  <name>: ... log=<path>` line and
  only the first 200 lines of the trace (`.claude/skills/run-tla/tlc.sh:80-84`).
- `all` exits 1 when one config does not match its EXPECT
  (`.claude/skills/run-tla/tlc.sh:101`).

## Design

Add `.github/workflows/tla-model-check.yml` with one job, `TLC model check`.

1. Trigger on `pull_request` to `main` and `develop`, on `push` to `main`,
   and on `workflow_dispatch`.
2. Filter on paths: `specs/tla/**`, `.claude/skills/run-tla/**`, and the
   workflow file itself. The full run takes less than 1 minute. The filter
   keeps it off PRs that cannot change the result.
3. Set up Java 21 (Temurin) with `actions/setup-java@v4`.
4. Cache `~/.cache/tla` with `actions/cache@v4`. The key is the hash of
   `tlc.sh`, because `tlc.sh` holds the version and the SHA-256. The
   driver checks the SHA-256 on each run, also on a cache hit.
5. Run `tlc.sh install`, then `tlc.sh all specs/tla`. Set `TLC_LOG_DIR`
   to `$RUNNER_TEMP/tlc-logs`. Write the summary lines to the job summary.
6. On failure, read each `FAIL` line, and print the full log of that config
   in a log group. Upload all logs as an artifact.
7. Set `timeout-minutes: 15`, `permissions: contents: read`, and a
   concurrency group that cancels a stale run on the same ref.

## Decided trade-offs

- **Path filter, not each PR.** If a person makes this check required in
  branch protection, a PR that skips the job waits for it. No branch
  protection rule uses it today. The doc section tells a developer this.
- **No change to `tlc.sh`.** The task limits changes to
  `.github/workflows/` and the TLA+ docs. The workflow prints the full log
  itself, so the 200-line limit of the driver does not hide data.

## TLA+ check

TLA+: not applicable (no concurrent writers). This change is CI config.

## Test

- The job runs green on the PR (9/9 configs).
- A test commit changes one invariant so the pass config fails. The job
  must fail and show the full log. Then revert the commit.
