/**
 * Test harness for `.claude/workflows/*.js` orchestration scripts.
 *
 * Those scripts are not modules — the Workflow runtime evaluates their body as
 * an async function with `agent`/`parallel`/`pipeline`/`log`/`phase`/`args`/
 * `budget`/`workflow` injected as globals, and a top-level `return` producing
 * the run's result. This harness reproduces that calling convention with
 * scripted agents, so the control flow (halt gates, budget ceilings, stall
 * containment) can be exercised deterministically in milliseconds instead of by
 * burning a real multi-agent run.
 *
 * It verifies the SCRIPT layer only. The stall watchdog, its six identical
 * retries and the 180s interval live inside the runtime's own agent()
 * implementation and are not reachable from here — which is exactly why the
 * scripts model a stalled-out agent as a thrown Error (what the runtime
 * actually does after the last attempt) rather than pretending to control it.
 */

import { readFileSync } from 'node:fs'

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor

/**
 * @param {string} scriptPath           path to the workflow script
 * @param {object} options
 * @param {any}    options.args         value exposed to the script as `args`
 * @param {(call: {prompt: string, opts: object, index: number}) => object} options.onAgent
 *        Returns `{ result }` to resolve, `{ error }` to throw (the runtime's
 *        stalled-out behaviour), and optionally `{ tokens }` to charge the
 *        budget — charged either way, as the runtime accumulates the tokens
 *        burned by attempts that never produced a result.
 * @param {number|null} [options.budgetTotal]  `budget.total` (null = no "+Nk" directive)
 */
export async function runWorkflow(scriptPath, { args, onAgent, budgetTotal = null } = {}) {
  const source = readFileSync(scriptPath, 'utf8').replace(/^export\s+const\s+meta\s*=/m, 'const meta =')

  const calls = []
  const logs = []
  const phases = []
  let tokens = 0

  const agent = async (prompt, opts = {}) => {
    const index = calls.length
    const call = { prompt, opts, index, label: opts.label }
    calls.push(call)
    const outcome = (await onAgent({ prompt, opts, index })) || {}
    tokens += outcome.tokens || 0
    call.tokens = outcome.tokens || 0
    if (outcome.error) {
      call.threw = outcome.error
      throw new Error(outcome.error)
    }
    call.result = outcome.result
    return outcome.result === undefined ? null : outcome.result
  }

  // Mirrors the runtime: a thunk that throws resolves to null rather than
  // rejecting the whole call.
  const parallel = async (thunks) => Promise.all(thunks.map((t) => Promise.resolve().then(t).catch(() => null)))

  const pipeline = async (items, ...stages) =>
    Promise.all(
      items.map(async (item, i) => {
        let value = item
        try {
          for (const stage of stages) value = await stage(value, item, i)
          return value
        } catch {
          return null
        }
      }),
    )

  const budget = {
    get total() {
      return budgetTotal
    },
    spent: () => tokens,
    remaining: () => (budgetTotal == null ? Infinity : Math.max(0, budgetTotal - tokens)),
  }

  const body = new AsyncFunction('agent', 'parallel', 'pipeline', 'log', 'phase', 'args', 'budget', 'workflow', source)

  let result
  let error = null
  try {
    result = await body(
      agent,
      parallel,
      pipeline,
      (m) => logs.push(String(m)),
      (t) => phases.push(t),
      args,
      budget,
      async () => {
        throw new Error('nested workflow() not supported in the harness')
      },
    )
  } catch (e) {
    error = e
  }

  return { result, error, calls, logs, phases, tokensSpent: tokens }
}

/** All agent labels in call order — the cheapest assertion for "what ran". */
export const labelsOf = (run) => run.calls.map((c) => c.label)

/** The single call with this label, or undefined. */
export const callNamed = (run, label) => run.calls.find((c) => c.label === label)
