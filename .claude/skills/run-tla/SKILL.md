---
name: run-tla
description: Decide if a planned change needs a TLA+ model, then write the spec and run the TLC model checker on it. Use when you plan or review work with concurrent writers, cron jobs, retries, cursors, watermarks, locks, idempotency, or multi-step state machines, or when asked to "run TLA+", "model check", "run TLC", or "check the design for races".
---

# TLA+ design checks (TLC)

This skill checks a **plan**, not code. You write a small TLA+ model of the
design. TLC then tries every interleaving and returns a counterexample trace
if an invariant can break. The driver is `.claude/skills/run-tla/tlc.sh`.
All paths are relative to the repo root.

## Step 1: Decide if TLA+ fits

Use TLA+ when the design has **two or more actors that touch the same state**
and the order of their steps can change. In this repo, these are the triggers:

| Trigger | Example in this repo |
|---|---|
| A cron job and an edge function write the same rows | `sync_all_toast_to_unified_sales()` (pg_cron jobid 4) and `toast-bulk-sync` |
| A skip, a cursor, or a watermark decides if work runs | `rollup_source_watermark`, `sync_cursor`, `initial_sync_done` |
| A read-then-write across two statements or two requests | Read `max(synced_at)`, then upsert in a second statement (READ COMMITTED) |
| Retries, webhooks, or at-least-once delivery | Stripe webhooks, POS re-sync of the same order |
| A status field with more than 3 states and many writers | Shift publish flow, payroll run status, bank connection status |
| "This can never happen" is part of the argument | Any design doc that relies on an ordering assumption |

Worked examples in `specs/tla/`:

| Model | Design doc | Result |
|---|---|---|
| `toast-rollup-watermark/` | `docs/superpowers/specs/2026-08-14-toast-rollup-watermark-design.md` | The design passes. Without `last_sync_time`, a row is lost. |
| `focus-backfill-cas/` | `docs/superpowers/specs/2026-09-01-focus-backfill-cron-timeout-design.md` | The CAS keeps the data correct with 2 workers. The HTTP 400 banner needs 2 workers. Without the CAS, the cursor moves back. |

Do **not** use TLA+ for UI layout, single-statement CRUD, math or unit
conversion (write a unit test), or code with one writer and no retries.
If no trigger matches, write "TLA+: not applicable (no concurrent writers)"
in the design doc and stop.

## Step 2: Write the model

1. Make `specs/tla/<topic>/<Module>.tla`. Copy the structure of
   `specs/tla/toast-rollup-watermark/ToastRollupWatermark.tla`.
2. Give each real step its own action. Split a step where another actor can
   run in the middle (for example, stamp a row, then commit it).
3. Cite the source `file:line` for each action in a comment.
4. Write the invariant as the bad outcome that the design must prevent.
5. Make `<Module>.cfg` for the planned design. Expect a pass.
6. Make `<Module>_<Variant>.cfg` with first line `\* EXPECT: violation. ...`.
   Turn off the one guard that the design adds. TLC must find the bug.
   This proves that the invariant can fail and is not vacuous.

## Step 3: Run it (agent path)

```bash
.claude/skills/run-tla/tlc.sh install     # once: downloads tla2tools 1.7.4 to ~/.cache/tla, checks sha256
.claude/skills/run-tla/tlc.sh parse specs/tla/toast-rollup-watermark/ToastRollupWatermark.tla
.claude/skills/run-tla/tlc.sh check specs/tla/toast-rollup-watermark/ToastRollupWatermark.tla
.claude/skills/run-tla/tlc.sh check specs/tla/toast-rollup-watermark/ToastRollupWatermark.tla \
    specs/tla/toast-rollup-watermark/ToastRollupWatermark_NoLastSync.cfg
.claude/skills/run-tla/tlc.sh all          # every *.cfg under specs/tla
.claude/skills/run-tla/tlc.sh trace FocusBackfill_NoCas cursor wpc lc   # last trace, one line per state
```

Expected output of `all`:

```text
OK    ToastRollupWatermark: pass (expected pass; 275 distinct states found) log=/tmp/tlc-logs/ToastRollupWatermark.log
OK    ToastRollupWatermark_NoLastSync: violation (expected violation; 151 distinct states found) log=/tmp/tlc-logs/ToastRollupWatermark_NoLastSync.log
---- 2/2 configs matched their EXPECT
```

- Exit code 0 means every config matched its EXPECT. Exit code 1 means one did not.
- On a mismatch, the driver prints the TLC error and the full counterexample trace.
- The full log is in `/tmp/tlc-logs/<cfg-name>.log`. Set `TLC_LOG_DIR` to change it.
- A spec with `--algorithm` (PlusCal) is translated in place before the check.
  Commit the translated `.tla`.

## Step 4: Use the result

- **Pass on the design config, violation on the counterfactual:** add a
  "TLA+ check" section to the design doc. Give the spec path, the invariant,
  the state count, and the `tlc.sh all` output.
- **Violation on the design config:** read the trace state by state. Decide
  if it is a design bug or a model error (see Gotchas). Fix the design or
  the model. Do not change the invariant to make the check pass.
- **Error (exit 75+):** a parse or config error. Run `tlc.sh parse`.

## Gotchas

- **False counterexamples from a coarse clock.** The first version of the
  watermark model let two `new Date()` calls return the same value. TLC
  then "broke" the shipped design with a tie. Real timestamps have
  microsecond precision. Model each clock read as `clock' = clock + 1`.
  Model clock skew only as an explicit, named variant.
- **Model statements, not functions.** PL/pgSQL under READ COMMITTED takes a
  new snapshot per statement. A function that reads, then writes, is two
  actions, and other writers can run between them.
- **Model commit separately from the write.** An edge function stamps
  `synced_at` before the upsert commits. The watermark race only shows when
  "stamp" and "commit" are separate actions.
- **SANY exits 0 on semantic errors** such as `Unknown operator`. The driver
  reads the output and returns 1. Do not call `tla2sany.SANY` directly in a
  script and trust its exit code.
- **State growth is fast.** Two syncs give 275 states. Three syncs give
  10,645 states (1.7 s). Start with 2 actors and small bounds. Add one
  actor only after the small model passes.
- **`all` maps `Model_Variant.cfg` to `Model.tla`.** Do not put `_` in a
  module name.
- **The state count on a violation changes between runs** (151 or 146 for
  `ToastRollupWatermark_NoLastSync`). TLC stops at the first error, and
  workers run in parallel. Compare only the pass counts.
- **`Error: Deadlock reached.` (exit 11) in a model with bounded runs.**
  When each worker has a fixed number of runs, the final state has no next
  step. Add `CHECK_DEADLOCK FALSE` to the cfg
  (`specs/tla/focus-backfill-cas/*.cfg`). The watermark model does not need
  it, because its rollup skip step is always enabled.
- **Bound the run with the Bash tool `timeout`.** TLC has no default time
  limit. A model that runs for more than 2 minutes has bounds that are too big.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Picked up JAVA_TOOL_OPTIONS: ...` on each run | The container proxy sets it. It is not an error. The driver hides it. |
