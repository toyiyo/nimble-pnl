/**
 * Regression tests for the runaway-token-burn guards in the /dev workflow
 * scripts, written against the post-mortem of run wf_da8ba6ba-5bb: 1,103,050
 * subagent tokens over 59 minutes, 279 tool calls, ZERO commits, ~97% of it a
 * single build task the runtime re-ran six times with a byte-identical prompt
 * before throwing `agent stalled on all 6 attempts`.
 *
 * The runtime owns the watchdog, the six retries and the 180s interval — none
 * of them are reachable from the script layer (the retry loop and its
 * hardcoded limit live inside the runtime's own agent() implementation). What
 * the script layer owns, and what these tests pin down, is everything that
 * happens AROUND that: a dead agent must halt the run with an actionable
 * needs_human instead of killing it with a bare Error, must not be re-run
 * blind, and must never be followed by more spend.
 */

import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { runWorkflow, labelsOf, callNamed } from '../../dev-tools/workflow-harness.mjs'

const BUILD_SCRIPT = path.resolve(__dirname, '../../.claude/workflows/dev-build-and-ship.js')
const CONTINUE_SCRIPT = path.resolve(__dirname, '../../.claude/workflows/dev-continue-verify-and-ship.js')

const BASE_ARGS = {
  worktreePath: '/tmp/wt',
  branch: 'fix/shift-create-tz',
  designDocPath: 'docs/design.md',
  planPath: 'docs/plan.md',
}

/** The real error the runtime throws once every attempt has stalled. */
const STALL_ERROR = 'agent stalled on all 6 attempts (no progress for 180000ms each)'

const TASKS = Array.from({ length: 9 }, (_, i) => ({
  id: `task-${i + 1}`,
  title: `Task ${i + 1} title`,
  body: `Steps for task ${i + 1}. Completion criterion: the new specs fail.`,
}))

/**
 * Default happy-path agent responses, keyed by label prefix. Individual tests
 * override single labels to inject the failure they care about.
 */
function defaultResponder(label: string) {
  if (label === 'preflight') return { result: { status: 'completed', codexAvailable: false, sonarConfigured: false } }
  if (label === 'plan-read') return { result: { status: 'completed', tasks: TASKS } }
  if (label.startsWith('build:')) return { result: { status: 'completed' } }
  if (label === 'review-snapshot') return { result: { status: 'completed', diff: 'd', gitLog: 'l', designDoc: 'dd', headSha: 'abc123' } }
  if (label.startsWith('review:')) return { result: { status: 'completed', findings: [] } }
  if (label === 'fold-findings') return { result: { status: 'completed', deferred: [] } }
  if (label.startsWith('coderabbit:')) return { result: { status: 'completed', clean: true } }
  if (label === 're-review-snapshot') return { result: { status: 'completed', newCommits: '', diff: '' } }
  if (label === 'verify') return { result: { status: 'completed', allPass: true, probeAbsentFromBundle: true } }
  if (label === 'ship') return { result: { status: 'completed', prNumber: 42 } }
  if (label.startsWith('ci:')) return { result: { status: 'completed', ciGreen: true } }
  if (label === 'triage') return { result: { status: 'completed', openCriticalOrMajor: 0, pushedFix: false } }
  if (label === 'done-gate') return { result: { status: 'completed', donePassed: true } }
  return { result: { status: 'completed' } }
}

/** What the harness accepts back from `onAgent`. */
type AgentOutcome = { result?: unknown; error?: string; tokens?: number }
/** What the harness hands to `onAgent` (prompt omitted where unused). */
type AgentCall = { prompt?: string; opts: { label?: string } }

/** A CI round that fixed something and pushed, so the loop wants another turn. */
const CI_RED: AgentOutcome = { result: { status: 'completed', ciGreen: false } }

/** Build an onAgent handler: happy path everywhere, `overrides` where given. */
function responder(overrides: Record<string, AgentOutcome> = {}, costPerCall = 1000) {
  return ({ opts }: AgentCall): AgentOutcome => {
    const label = String(opts.label)
    const override = overrides[label] ?? (label.startsWith('build:') ? overrides['build:*'] : undefined)
    const base = override ?? defaultResponder(label)
    return { tokens: costPerCall, ...base }
  }
}

describe('dev-build-and-ship: a stalled build agent', () => {
  it('halts the run with an actionable needs_human instead of dying with a bare Error', async () => {
    const run = await runWorkflow(BUILD_SCRIPT, {
      args: BASE_ARGS,
      onAgent: responder({ 'build:task-1': { error: STALL_ERROR, tokens: 1_100_000 } }),
    })

    // The incident killed the workflow outright. It must not any more.
    expect(run.error).toBeNull()
    expect(run.result.stopped).toBe(true)
    expect(run.result.phase).toBe('Build')
    expect(run.result.status).toBe('needs_human')
    expect(run.result.task).toBe('task-1')
    expect(run.result.taskIndex).toBe(1)

    // The reason must be actionable cold, and must name the two levers that
    // actually change the outcome (the prompt is what the runtime replays).
    expect(run.result.reason).toContain('never produced a result')
    expect(run.result.reason).toContain(STALL_ERROR)
    expect(run.result.reason).toMatch(/resolutionNotes/)
    expect(run.result.reason).toMatch(/stalledTasks/)

    // The stall signature travels with the stop payload.
    expect(run.result.stalls).toHaveLength(1)
    expect(run.result.stalls[0]).toMatchObject({ label: 'build:task-1', message: STALL_ERROR })
    expect(run.result.tokensSpent).toBeGreaterThan(1_000_000)
  })

  it('spends nothing further — the remaining 8 tasks and the six-way review fan-out never start', async () => {
    const run = await runWorkflow(BUILD_SCRIPT, {
      args: BASE_ARGS,
      onAgent: responder({ 'build:task-1': { error: STALL_ERROR, tokens: 1_100_000 } }),
    })

    expect(labelsOf(run)).toEqual(['preflight', 'plan-read', 'build:task-1'])
    expect(labelsOf(run)).not.toContain('build:task-2')
    expect(labelsOf(run)).not.toContain('review:security')
  })

  it('refuses to re-run a task already known to stall, spending zero on it', async () => {
    const run = await runWorkflow(BUILD_SCRIPT, {
      args: { ...BASE_ARGS, stalledTasks: ['task-1'] },
      onAgent: responder({ 'build:task-1': { error: STALL_ERROR, tokens: 1_100_000 } }),
    })

    // build:task-1 is never dispatched at all.
    expect(labelsOf(run)).toEqual(['preflight', 'plan-read'])
    expect(run.result.status).toBe('needs_human')
    expect(run.result.task).toBe('task-1')
    expect(run.result.reason).toContain('byte-identical')
    expect(run.tokensSpent).toBeLessThan(10_000)
  })

  it('re-runs a known-stalled task once its prompt actually differs, and the difference is visible', async () => {
    const prompts: Record<string, string> = {}
    const capture = (overrides: Record<string, AgentOutcome>, runArgs: unknown) =>
      runWorkflow(BUILD_SCRIPT, {
        args: runArgs,
        onAgent: ({ prompt, opts }: AgentCall) => {
          prompts[String(opts.label)] = String(prompt)
          return responder(overrides)({ opts })
        },
      })

    const withoutNote = await capture({}, BASE_ARGS)
    const baseline = prompts['build:task-1']

    const RESOLUTION = 'Task 1 is a reproduction task: land the failing specs and STOP. Do not touch src/.'
    const withNote = await capture({}, { ...BASE_ARGS, stalledTasks: ['task-1'], resolutionNotes: { 'task-1': RESOLUTION } })
    const retried = prompts['build:task-1']

    expect(withoutNote.result.stopped).toBe(false)
    expect(withNote.result.stopped).toBe(false)
    expect(retried).not.toEqual(baseline)
    expect(retried).toContain(RESOLUTION)
    expect(retried).toContain('do not re-litigate')
  })
})

describe('dev-build-and-ship: spend ceilings', () => {
  it('halts at the global ceiling rather than grinding through every task', async () => {
    const run = await runWorkflow(BUILD_SCRIPT, {
      args: { ...BASE_ARGS, tokenCeiling: 500_000, taskTokenCeiling: 1_000_000 },
      onAgent: responder({}, 120_000),
    })

    expect(run.result.stopped).toBe(true)
    expect(run.result.phase).toBe('Build')
    expect(run.result.status).toBe('needs_human')
    expect(run.result.reason).toContain('Token ceiling reached')
    expect(run.result.reason).toContain('tokenCeiling')
    // Stopped mid-build, not after all nine tasks.
    expect(run.result.completedTasks).toBeLessThan(TASKS.length)
    expect(run.tokensSpent).toBeLessThan(700_000)
  })

  it('halts when one completed task is so expensive the remaining tasks would blow the ceiling', async () => {
    const run = await runWorkflow(BUILD_SCRIPT, {
      args: { ...BASE_ARGS, tokenCeiling: 2_000_000, taskTokenCeiling: 100_000 },
      onAgent: responder({ 'build:*': { result: { status: 'completed' }, tokens: 400_000 } }),
    })

    expect(run.result.stopped).toBe(true)
    expect(run.result.task).toBe('task-1')
    expect(run.result.completedTasks).toBe(1)
    expect(run.result.reason).toContain('per-task ceiling')
    expect(run.logs.join('\n')).toContain('projected run total')
  })

  it('logs spend as it goes, so a burn is visible during the run and not only in the post-mortem', async () => {
    const run = await runWorkflow(BUILD_SCRIPT, { args: BASE_ARGS, onAgent: responder({}, 5_000) })
    const text = run.logs.join('\n')
    expect(text).toMatch(/Build 1\/9: .* tokens \(run total/)
    expect(text).toContain('Entering Phase 7 review fan-out at')
  })

  it('leaves the happy path intact and reports what it spent', async () => {
    const run = await runWorkflow(BUILD_SCRIPT, { args: BASE_ARGS, onAgent: responder({}, 5_000) })

    expect(run.error).toBeNull()
    expect(run.result.stopped).toBe(false)
    expect(run.result.prNumber).toBe(42)
    expect(run.result.done).toBe(true)
    expect(run.result.buildTasks).toBe(9)
    expect(run.result.tokensSpent).toBe(run.tokensSpent)
    expect(run.result.stalls).toBeUndefined()
  })
})

describe('dev-build-and-ship: per-task context is inlined, not re-derived', () => {
  it('inlines the task section and drops the 42 KB skill-file pointer', async () => {
    const run = await runWorkflow(BUILD_SCRIPT, { args: BASE_ARGS, onAgent: responder() })
    const prompt = callNamed(run, 'build:task-1')!.prompt

    expect(prompt).toContain('=== plan section for task-1 ===')
    expect(prompt).toContain(TASKS[0].body)
    expect(prompt).toContain('do not re-read the whole plan')
    expect(prompt).toContain('SALVAGE')

    // No agent gets pointed at development-workflow.md by default any more.
    for (const call of run.calls) expect(call.prompt).not.toContain('development-workflow.md')
  })

  it('falls back to reading the plan when plan-read could not extract a section', async () => {
    const run = await runWorkflow(BUILD_SCRIPT, {
      args: BASE_ARGS,
      onAgent: responder({ 'plan-read': { result: { status: 'completed', tasks: [{ id: 'task-1', title: 'Only task' }] } } }),
    })
    const prompt = callNamed(run, 'build:task-1')!.prompt

    expect(prompt).toContain('open the plan file and read THIS task')
    expect(prompt).not.toContain('=== plan section for')
  })
})

describe('dev-continue-verify-and-ship: same containment', () => {
  it('converts a stalled verify agent into a structured halt and ships nothing after it', async () => {
    const run = await runWorkflow(CONTINUE_SCRIPT, {
      args: BASE_ARGS,
      onAgent: responder({ verify: { error: STALL_ERROR, tokens: 900_000 } }),
    })

    expect(run.error).toBeNull()
    expect(run.result.stopped).toBe(true)
    expect(run.result.phase).toBe('Verify')
    expect(run.result.status).toBe('needs_human')
    expect(run.result.stalls[0].message).toBe(STALL_ERROR)
    expect(labelsOf(run)).toEqual(['verify'])
  })

  it('enforces its own token ceiling before it pushes anything', async () => {
    const run = await runWorkflow(CONTINUE_SCRIPT, {
      args: { ...BASE_ARGS, tokenCeiling: 300_000 },
      onAgent: responder({ verify: { result: { status: 'completed', allPass: true, probeAbsentFromBundle: true }, tokens: 400_000 } }),
    })

    expect(run.result.stopped).toBe(true)
    expect(run.result.phase).toBe('Ship')
    expect(run.result.reason).toContain('Token ceiling reached')
    // Verify ran and passed, but nothing was pushed and no PR was opened.
    expect(labelsOf(run)).toEqual(['verify'])
  })
})

/**
 * Regression for the incomplete #695 fix. envelope() emitted TWO "PRIOR
 * STATE:" paragraphs: the parameterized one, then a stale hardcoded one from
 * the error-boundary branch. The stale paragraph told every agent that phases
 * 4-7 were complete and that commit ff3776c1 resolved a Codex finding. On
 * every other branch both claims were false. The guard: each prompt carries
 * exactly ONE "PRIOR STATE:" line, and its text comes only from
 * args.priorState or the claim-free fallback.
 */
describe('dev-continue-verify-and-ship: PRIOR STATE comes only from the caller', () => {
  const priorStateCount = (prompt: string) => prompt.split('PRIOR STATE:').length - 1

  it('emits exactly one PRIOR STATE line, carrying the supplied text', async () => {
    const SUPPLIED = 'The human fixed the fold-gate finding in commit abc1234 on this branch.'
    const run = await runWorkflow(CONTINUE_SCRIPT, {
      args: { ...BASE_ARGS, priorState: SUPPLIED },
      onAgent: responder(),
    })

    expect(run.calls.length).toBeGreaterThan(0)
    for (const call of run.calls) {
      expect(priorStateCount(call.prompt), String(call.label)).toBe(1)
      expect(call.prompt, String(call.label)).toContain(SUPPLIED)
      // The stale paragraph's landmarks, none of which may survive anywhere.
      expect(call.prompt, String(call.label)).not.toContain('ff3776c1')
      expect(call.prompt, String(call.label)).not.toContain('c0872b91')
      expect(call.prompt, String(call.label)).not.toContain('RouteShellBoundary')
      expect(call.prompt, String(call.label)).not.toContain('Phases 4-7 are COMPLETE')
    }
  })

  it('falls back to claim-free text that sends the agent to the records', async () => {
    const run = await runWorkflow(CONTINUE_SCRIPT, { args: BASE_ARGS, onAgent: responder() })

    expect(run.calls.length).toBeGreaterThan(0)
    for (const call of run.calls) {
      expect(priorStateCount(call.prompt), String(call.label)).toBe(1)
      expect(call.prompt, String(call.label)).toContain('progress.md')
      expect(call.prompt, String(call.label)).not.toContain('ff3776c1')
      expect(call.prompt, String(call.label)).not.toContain('RouteShellBoundary')
      expect(call.prompt, String(call.label)).not.toContain('Phases 4-7 are COMPLETE')
    }
  })
})

describe('both scripts still stop cleanly on ordinary gates', () => {
  it('missing args halts before any agent runs', async () => {
    for (const script of [BUILD_SCRIPT, CONTINUE_SCRIPT]) {
      const run = await runWorkflow(script, { args: {}, onAgent: responder() })
      expect(run.error).toBeNull()
      expect(run.result.stopped).toBe(true)
      expect(run.result.reason).toContain('Missing required args')
      expect(run.calls).toHaveLength(0)
    }
  })

  it('a needs_human return from an agent still halts with its own reason', async () => {
    const run = await runWorkflow(BUILD_SCRIPT, {
      args: BASE_ARGS,
      onAgent: responder({ 'build:task-3': { result: { status: 'needs_human', reason: 'the design does not cover DST fall-back' } } }),
    })

    expect(run.result.stopped).toBe(true)
    expect(run.result.status).toBe('needs_human')
    expect(run.result.reason).toBe('the design does not cover DST fall-back')
    expect(run.result.task).toBe('task-3')
    expect(labelsOf(run)).not.toContain('build:task-4')
  })
})

/**
 * Second runaway mode, unrelated to the token-burn retries: a wait whose exit
 * condition can never be satisfied. Observed as a shell left spinning
 * `until [ "$(ps aux | grep -c '[p]laywright')" -lt 2 ]` — the count sat at 31
 * because every Claude Code process carries "playwright" in its MCP config on
 * its own command line. 4h07m, orphaned from a dead agent, killed by hand.
 *
 * The script layer cannot see or reap a shell an agent spawned, so the guard is
 * prompt-side. What IS testable: that the guidance reaches every agent, and
 * that the script's own capped loops report the state that ended them instead
 * of falling through silently.
 */
describe('unsatisfiable waits', () => {
  it('warns every agent in both scripts, including phases that do not obviously wait', async () => {
    for (const script of [BUILD_SCRIPT, CONTINUE_SCRIPT]) {
      const run = await runWorkflow(script, { args: BASE_ARGS, onAgent: responder() })
      expect(run.calls.length).toBeGreaterThan(0)
      for (const call of run.calls) {
        expect(call.prompt, `${script} / ${call.label}`).toContain('WAIT DISCIPLINE')
        // The exact footgun, named — generic "be careful with loops" would not
        // have stopped this one.
        expect(call.prompt, `${script} / ${call.label}`).toContain('ps aux | grep -c')
        expect(call.prompt, `${script} / ${call.label}`).toContain('evaluate the condition ONCE')
        expect(call.prompt, `${script} / ${call.label}`).toContain('trap')
        // The bound must point at a mechanism that exists here. `timeout` and
        // `gtimeout` are absent on this BSD/bash-3.2 box, so telling agents to
        // prefix with them produces "command not found" instead of a bound —
        // the first cut of this block did exactly that (caught in review).
        expect(call.prompt, `${script} / ${call.label}`).toContain("Bash tool's own timeout parameter")
        expect(call.prompt, `${script} / ${call.label}`).not.toMatch(/prefix `timeout/)
      }
    }
  })

  it('bounds the CI loop at 5 and escalates rather than watching forever', async () => {
    const run = await runWorkflow(BUILD_SCRIPT, {
      args: BASE_ARGS,
      onAgent: responder({ 'ci:1': CI_RED, 'ci:2': CI_RED, 'ci:3': CI_RED, 'ci:4': CI_RED, 'ci:5': CI_RED }),
    })

    expect(labelsOf(run).filter((l) => l?.startsWith('ci:'))).toEqual(['ci:1', 'ci:2', 'ci:3', 'ci:4', 'ci:5'])
    expect(run.result.stopped).toBe(true)
    expect(run.result.phase).toBe('CI Loop')
    expect(run.result.reason).toContain('not green after 5 iterations')
    // It never silently proceeded to triage on a red PR.
    expect(labelsOf(run)).not.toContain('triage')
  })

  it('bounds the CodeRabbit loop at 3 and carries the last observed state forward', async () => {
    const dirty = { result: { status: 'completed', clean: false, reason: '2 actionable findings remain in useShifts.tsx' } }
    const run = await runWorkflow(BUILD_SCRIPT, {
      args: BASE_ARGS,
      onAgent: responder({ 'coderabbit:1': dirty, 'coderabbit:2': dirty, 'coderabbit:3': dirty }),
    })

    expect(labelsOf(run).filter((l) => l?.startsWith('coderabbit:'))).toEqual(['coderabbit:1', 'coderabbit:2', 'coderabbit:3'])
    // A capped loop must not fall through as if the condition had been met.
    expect(run.logs.join('\n')).toContain('still dirty after 3 iterations')
    expect(run.logs.join('\n')).toContain('2 actionable findings remain in useShifts.tsx')
    // Best-effort phase: it escalates into the PR body rather than halting.
    expect(labelsOf(run)).toContain('ship')
  })
})

/**
 * Phase 7a retries a reviewer that came back empty, because a silently missing
 * review is unsafe. That retry must distinguish its two nulls: an agent that
 * returned nothing (retry it) from an agent that THREW after the runtime's six
 * identical attempts (retrying buys six more, roughly doubling the runaway this
 * file exists to contain). Caught in review on #681 — the first cut treated
 * both nulls the same.
 */
describe('the Phase 7a reviewer retry knows which null it got', () => {
  it('retries a reviewer that returned nothing, but never one that stalled out', async () => {
    const run = await runWorkflow(BUILD_SCRIPT, {
      args: BASE_ARGS,
      onAgent: responder({
        'review:security': { error: STALL_ERROR, tokens: 1_100_000 },
        'review:performance': { tokens: 1000 }, // no result -> null, without dying
      }),
    })

    const labels = labelsOf(run)
    // Came back empty on its own: one bounded script-level retry is correct.
    expect(labels).toContain('review:performance')
    expect(labels).toContain('review:performance:retry')
    // Stalled out: the prompt would be byte-identical, so it must not re-run.
    expect(labels).toContain('review:security')
    expect(labels).not.toContain('review:security:retry')

    expect(run.logs.join('\n')).toContain('stalled out — NOT retrying')
    // The stall is still surfaced rather than silently dropped.
    expect(run.logs.join('\n')).toContain('findings are absent this run')
  })

  it('does not let a stalled reviewer double the burn', async () => {
    const run = await runWorkflow(BUILD_SCRIPT, {
      args: BASE_ARGS,
      onAgent: responder({ 'review:security': { error: STALL_ERROR, tokens: 1_100_000 } }),
    })

    // Exactly one dispatch of the doomed prompt, not two rounds of six.
    expect(labelsOf(run).filter((l) => l?.startsWith('review:security'))).toEqual(['review:security'])
  })
})

/**
 * The third failure mode, and the only one that reaches the PR. The phase
 * prompts say "fix it and commit" and leave HOW to stage to each agent, so they
 * reach for `git add -A`. One worktree is shared by every phase, so that sweeps
 * in per-run scratch and whatever an earlier phase left dirty: PR diffs carrying
 * ~8k lines of workflow noise (#679, #628, #590) and merge conflicts located
 * entirely inside regenerated artifacts. memory/lessons.md records it four
 * times (:386, :693, :1454, :1770) — the recurrence is why it is pinned here.
 *
 * Gitignoring the scratch is a backstop, not the fix: a broad add still picks up
 * unrelated TRACKED files. As with WAIT_DISCIPLINE the only lever is the prompt,
 * so the guard is only real if EVERY agent in BOTH scripts carries it.
 */
describe('broad staging', () => {
  it('warns every agent in both scripts, naming the exact commands', async () => {
    for (const script of [BUILD_SCRIPT, CONTINUE_SCRIPT]) {
      const run = await runWorkflow(script, { args: BASE_ARGS, onAgent: responder() })
      expect(run.calls.length).toBeGreaterThan(0)
      for (const call of run.calls) {
        expect(call.prompt, `${script} / ${call.label}`).toContain('STAGING DISCIPLINE')
        // The footgun named exactly — a generic "stage carefully" would not have
        // stopped any of the four incidents.
        expect(call.prompt, `${script} / ${call.label}`).toContain('git add -A')
        expect(call.prompt, `${script} / ${call.label}`).toContain('git add .')
        expect(call.prompt, `${script} / ${call.label}`).toContain('git commit -a')
        // progress.md is gitignored, and was still force-added into PR #542.
        expect(call.prompt, `${script} / ${call.label}`).toContain('git add -f')
        // A rule with no check is a suggestion; the index must be verifiable.
        expect(call.prompt, `${script} / ${call.label}`).toContain('diff --cached --name-only')
        // Staging from an ambient cwd is how the same accident starts, so the
        // form agents are given to copy must already carry -C.
        expect(call.prompt, `${script} / ${call.label}`).toMatch(/git -C \S+ add <path>/)
      }
    }
  })

  it('never itself instructs an agent to stage broadly', async () => {
    for (const script of [BUILD_SCRIPT, CONTINUE_SCRIPT]) {
      const run = await runWorkflow(script, { args: BASE_ARGS, onAgent: responder() })
      for (const call of run.calls) {
        // Only the prohibition may mention these; no prompt may direct one.
        const directives = call.prompt.split('\n').filter((l: string) => /\b(?:run|use|then):?\s*`?git add (?:-A|\.)/i.test(l))
        expect(directives, `${script} / ${call.label}`).toEqual([])
      }
    }
  })
})
