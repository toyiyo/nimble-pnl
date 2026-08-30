export const meta = {
  name: 'dev-build-and-ship',
  description:
    'Autonomous /dev Phases 4-9: build (TDD), UI review, simplify, multi-model review, verify, ship + CI loop. Launched by the development-workflow skill AFTER the user approves the plan (Phase 3). Runs in the background; stops and hands back on any needs_human gate.',
  phases: [
    { title: 'Preflight' },
    { title: 'Build' },
    { title: 'UI Review' },
    { title: 'Simplify' },
    { title: 'Review' },
    { title: 'Verify' },
    { title: 'Ship' },
    { title: 'CI Loop' },
    { title: 'Triage' },
    { title: 'Done Gate' },
  ],
}

// ---------------------------------------------------------------------------
// IMPORTANT runtime facts this script is written against:
//   * The script itself has NO filesystem/shell access — EVERY git/gh/npm/
//     coderabbit/codex side effect happens INSIDE an agent() call.
//   * Subagents start with FRESH context. All state is injected via prompts
//     (the envelope() helper) or read from disk by the agent itself.
//   * Date.now()/Math.random() are unavailable — no wall-clock logic here.
//   * Human gates are IMPOSSIBLE mid-run. Any phase that would "pause and ask"
//     instead returns status:'needs_human'; the script halts and returns a
//     structured stop so the launching session can notify the user.
//
// DELIBERATE DESIGN DECISIONS (see chat for rationale):
//   1. Phase 4 TDD is SEQUENTIAL (one agent per plan task, in dependency
//      order, each committing to the shared worktree). Parallel TDD needs
//      per-task worktrees + merge-back, which this script cannot do safely
//      (no git access at the script layer). Parallelism is left as a future
//      enhancement, noted below.
//   2. Phase 9b CI wait uses a blocking `gh pr checks --watch` INSIDE an agent
//      (the runtime has no sleep primitive for script-level polling).
//   3. Phase 9e "done" is verified via on-disk ARTIFACTS, not transcript
//      visibility (which does not exist across fresh-context agents).
//
// RUNAWAY-BURN HARDENING (post-mortem of run wf_da8ba6ba-5bb: 1.10M subagent
// tokens, 59 min, zero commits — 97% of it ONE build task re-run six times).
// What the runtime does, verified against the 2.1.218 binary and that run's
// journal.jsonl, because it constrains what this layer can and cannot fix:
//   * The stall watchdog and its retry loop live INSIDE the runtime's agent()
//     implementation, not here. A stalled agent is retried with a BYTE-IDENTICAL
//     prompt up to a hardcoded 5 times (6 attempts total); the retry count and
//     the 180000ms interval are compile-time constants with no opts passthrough.
//     The journal proves it: six agentIds share one prompt cache key.
//     => "cap retries at 2" and "append the prior failure to the retry prompt"
//        are NOT implementable at the script layer. They need a runtime change.
//   * After the last attempt agent() THROWS. That is why the run died with a
//     raw Error instead of a structured stop. A throw IS catchable here, so the
//     three levers this script actually owns are:
//       (a) catch the throw and halt with a structured, actionable needs_human
//           (runAgent below) — one dead call can no longer kill the run blind;
//       (b) guarantee nothing further is spent after a stall, and refuse to
//           re-run a task already known to stall unless its prompt changed;
//       (c) cap total spend with budget.spent(), which works whether or not the
//           operator passed a "+Nk" directive (budget.total is usually null).
//   * The stalls did NOT follow a silent no-tool_use turn. In every transcript
//     the 180s gap follows a tool_result: the model was generating its NEXT turn
//     and never emitted it, in a context grown to 0.4-1.0 MB. Stall probability
//     therefore rises with context size, which makes prompt/context slimming
//     (inlining each task's own plan section instead of pointing nine agents at
//     the plan + design doc + a 42 KB skill file) a stall fix, not just a token
//     saving.
// ---------------------------------------------------------------------------

// ---- Inputs (passed via args by the /dev skill after Phase 3) ----
// args may arrive as a parsed object OR as a JSON string (a known Workflow
// footgun); accept both so a stringified payload doesn't look like "no args".
let ctx = {}
try {
  ctx = (typeof args === 'string' ? JSON.parse(args) : args) || {}
} catch {
  ctx = {}
}
const REQUIRED = ['worktreePath', 'branch', 'designDocPath', 'planPath']
const missingArgs = REQUIRED.filter((k) => !ctx[k])
if (missingArgs.length) {
  return {
    stopped: true,
    phase: 'Preflight',
    reason: `Missing required args: ${missingArgs.join(', ')}. The /dev skill must call Workflow with args {worktreePath, branch, designDocPath, planPath}.`,
  }
}

// Shared schema fragment: every phase agent reports a status so the script can
// enforce the needs_human / failed gates uniformly.
const STATUS = {
  status: { type: 'string', enum: ['completed', 'needs_human', 'failed'] },
  reason: {
    type: 'string',
    description: 'Required when status is needs_human or failed: the specific blocker or ambiguity, with enough context for a human to act cold.',
  },
  commits: {
    type: 'array',
    items: { type: 'string' },
    description: 'commit SHAs created during this phase (may be empty)',
  },
}
const statusSchema = (extraProps = {}, extraRequired = []) => ({
  type: 'object',
  additionalProperties: false,
  properties: { ...STATUS, ...extraProps },
  required: ['status', ...extraRequired],
})

// Second runaway mode, distinct from the stall retries: a wait whose exit
// condition is unsatisfiable by construction. Observed for real — an agent left
// a shell spinning `until [ "$(ps aux | grep -c '[p]laywright')" -lt 2 ]`. The
// [p] trick stops grep matching itself but not the ~30 Claude Code processes
// that carry "playwright" inside the MCP config on their own command lines, so
// the count sat at 31 and could never fall. It ran 4h07m, orphaned from an
// agent that had already died, until a human noticed and killed it.
//
// Nothing at the script layer can see a shell an agent spawned, let alone reap
// one that outlives it. The only lever is the prompt, so this ships in the
// envelope every agent gets — including phases that do not obviously wait,
// because the next phase that starts a server should inherit it for free.
const WAIT_DISCIPLINE = [
  'WAIT DISCIPLINE (a poll loop with an impossible exit condition once spun 4h before a human killed it):',
  '- Before ANY wait loop, evaluate the condition ONCE and print the raw value. If it already sits on the wrong side of the exit test, do not loop — looping cannot move it.',
  '- Never test process state with `ps aux | grep -c <name>`. Every Claude Code process carries the MCP config on its command line, so grepping a tool name ("playwright", "vitest", "supabase") matches dozens of unrelated processes and the count never drops. Wait on a PID you started (`cmd & pid=$!; wait $pid`) or use the tool\'s own blocking mode (`gh pr checks --watch`, a foreground test run).',
  "- Every wait needs a bound, but `timeout` and `gtimeout` do NOT exist on this BSD/bash-3.2 machine (nor does `tail --pid`) — do not reach for them. Run the command in the FOREGROUND and let the Bash tool's own timeout parameter bound it (default 120s, max 600s). If you must iterate, cap the count and exit non-zero printing the last observed value. An unbounded wait is indistinguishable from a hang.",
  "- Kill every background process you start before you return, on the failure path too (`trap 'kill $pid 2>/dev/null' EXIT`). Orphans outlive the agent that spawned them.",
].join('\n')

// Third failure mode, and the only one that reaches the PR: staging. The phase
// prompts say "fix it and commit" and leave HOW to stage to each agent, so they
// reach for `git add -A`. One worktree is shared by every phase, so that sweeps
// in per-run scratch and whatever an earlier phase left dirty — it has produced
// PR diffs carrying ~8k lines of workflow noise, and merge conflicts located
// entirely inside regenerated artifacts (memory/lessons.md:386, :693, :1454,
// :1770 — four incidents, one pattern).
//
// Gitignoring the scratch is a backstop, not the fix: a broad add still picks up
// unrelated TRACKED files. Explicit paths are what actually bound a commit, and
// like WAIT_DISCIPLINE the only lever is the prompt — the script layer cannot
// see, let alone veto, an agent's git invocation.
const STAGING_DISCIPLINE = [
  'STAGING DISCIPLINE (applies to every commit you make, in every phase):',
  `- Stage EXPLICIT paths, always with -C so the command cannot act on the wrong checkout: git -C ${ctx.worktreePath} add <path> [<path>...]`,
  '- NEVER `git add -A`, `git add .`, or `git commit -a`. This worktree is shared across phases and accumulates per-run scratch (dev-tools/*.patch, dev-tools/*-output.md, dev-tools/9d-triage-*) plus whatever an earlier phase left dirty; a broad add sweeps all of it into your commit, where it becomes PR noise and conflicts with other branches regenerating the same files.',
  '- `progress.md` is gitignored and must NEVER be staged — not even with `git add -f`.',
  `- Before each commit, confirm the index holds only what you intended: git -C ${ctx.worktreePath} diff --cached --name-only`,
].join('\n')

// Fourth lever, same mechanism: prose style. Every agent starts with fresh
// context, so none of them sees CLAUDE.md's ASD-STE100 rule unless it ships in
// the prompt. These agents write the PR body, the commit messages, the review
// findings and the retrospective — the text a human actually reads. The full
// standard is docs/STE100_STYLE.md; this is the compressed form.
const WRITING_STANDARD = [
  'WRITING STANDARD — ASD-STE100 Simplified Technical English (applies to every commit message, PR body, review finding, progress.md update, and code comment you write):',
  '- One idea per sentence. Maximum 20 words for an instruction, 25 for a description.',
  '- Active voice. Start an instruction with the verb ("Run the tests", not "The tests should be run").',
  '- One word for one meaning: use fix (not repair/resolve/address/patch), change (not modify/tweak/alter), delete (not remove/drop/purge), show (not display/surface/render), check (not verify/validate/ensure).',
  '- Simple tenses only. No -ing word as a noun ("The sync fails", not "Syncing is failing"). Keep the articles. Maximum 3 nouns in a cluster.',
  '- No idioms, no metaphors, no hedges ("basically", "just", "simply", "I think", "it seems").',
  '- Keep EXACT: code identifiers, file paths, tool output, error messages, log lines, and quotes from CodeRabbit/Codex/SonarCloud. Do not rewrite them.',
  `- Full standard: ${ctx.worktreePath}/docs/STE100_STYLE.md`,
].join('\n')

// Orientation block injected into EVERY agent prompt (fresh context).
// The development-workflow.md pointer is OPT-IN (skillRef), not default: it is a
// 42 KB file and every phase prompt below already states what that phase must do.
// Nine build agents each reading it from scratch was pure context bloat, and
// context size is what drives the 180s stall (see the runtime notes above).
function envelope(body, { skillRef = false } = {}) {
  return [
    'WORKING CONTEXT (you have fresh context — this block is all you start with):',
    `- Worktree (cd here for every command): ${ctx.worktreePath}`,
    `- Branch: ${ctx.branch}`,
    `- Design doc (the approved design — do NOT deviate from it): ${ctx.designDocPath}`,
    `- Plan file: ${ctx.planPath}`,
    `- progress.md: ${ctx.worktreePath}/progress.md — read it for prior-phase state; update it when you finish your phase.`,
    ...(skillRef
      ? [`- The authoritative phase definitions live in ${ctx.worktreePath}/.claude/skills/development-workflow.md — consult the matching phase if you need detail.`]
      : []),
    '',
    STAGING_DISCIPLINE,
    '',
    WAIT_DISCIPLINE,
    '',
    WRITING_STANDARD,
    '',
    body,
  ].join('\n')
}

// ---- Spend accounting -----------------------------------------------------
// budget.total is null unless the operator passed a "+Nk" directive, so
// budget.remaining() is usually Infinity and cannot backstop anything. spent()
// always works, so the ceiling here is script-owned and measured against it.
const TOKEN_CEILING = Number(ctx.tokenCeiling) > 0 ? Number(ctx.tokenCeiling) : 2000000
const TASK_TOKEN_CEILING = Number(ctx.taskTokenCeiling) > 0 ? Number(ctx.taskTokenCeiling) : 350000
// Phase 7c reads CodeRabbit output from disk instead of running the CLI itself —
// see the 7c prompt. The launching session runs the review out-of-band and drops
// its NDJSON here; ctx.coderabbitOutDir overrides the location per run.
const CODERABBIT_OUT = ctx.coderabbitOutDir || '/tmp'
function spent() {
  try {
    return typeof budget !== 'undefined' && budget && typeof budget.spent === 'function' ? budget.spent() || 0 : 0
  } catch {
    return 0
  }
}

// Agents that died rather than returned. Carried into every stop payload so the
// operator sees the stall signature without digging through transcripts.
const stalls = []

// True when this label already died inside the runtime's retry loop. A null
// from a THROWN stall is not the same as a null from an agent that simply
// returned nothing: the runtime has already spent six byte-identical attempts
// on that prompt, so any script-level retry buys six more of exactly the burn
// this file exists to contain.
function didCrash(label) {
  return stalls.some((s) => s.label === label)
}

function stop(phase, extra = {}) {
  return { stopped: true, phase, tokensSpent: spent(), ...(stalls.length ? { stalls } : {}), ...extra }
}

// Halt helper: stop the workflow cleanly when an agent needs a human or fails.
function gate(result, phase, extra = {}) {
  if (!result) return { halt: true, out: stop(phase, { reason: 'agent returned null (user skipped or it errored)', ...extra }) }
  if (result.status !== 'completed') {
    return { halt: true, out: stop(phase, { status: result.status, reason: result.reason || `agent returned status=${result.status}`, ...extra }) }
  }
  return { halt: false }
}

// Every agent() call goes through here. A stalled-out agent THROWS (see the
// runtime notes at the top) and that throw would otherwise kill the run with a
// bare Error and no structured stop. Converting it to a needs_human envelope
// lets the normal gate() path halt cleanly with the stall signature attached.
async function runAgent(prompt, opts, { nullOnCrash = false } = {}) {
  const before = spent()
  try {
    return await agent(prompt, opts)
  } catch (e) {
    const message = String((e && e.message) || e)
    const cost = spent() - before
    stalls.push({ label: (opts && opts.label) || 'unlabelled', message, tokens: cost })
    log(`✖ agent "${(opts && opts.label) || 'unlabelled'}" produced no result after ~${cost} tokens: ${message}`)
    if (nullOnCrash) return null
    return {
      status: 'needs_human',
      crashed: true,
      reason:
        `Agent "${(opts && opts.label) || 'unlabelled'}" never produced a result (${message}). ` +
        `It burned ~${cost} tokens across the runtime's internal attempts, all with the same prompt. ` +
        'Resuming as-is will reproduce it identically — change the prompt first (fix the task in the plan, ' +
        'or pass args.resolutionNotes for this task), and pass the task id in args.stalledTasks so this ' +
        'script refuses to re-run it blind.',
    }
  }
}

// Global spend ceiling, checked between agent() calls (the only point at which
// this layer regains control). Returns a stop payload, or null to continue.
function budgetHalt(phaseName, extra = {}) {
  const s = spent()
  if (s < TOKEN_CEILING) return null
  return stop(phaseName, {
    status: 'needs_human',
    reason:
      `Token ceiling reached: ~${s} output tokens spent against a ceiling of ${TOKEN_CEILING}. ` +
      'Halting before spending more. If this run legitimately needs a bigger budget, relaunch with ' +
      'args.tokenCeiling raised; if it does not, this is the runaway you wanted caught.',
    ...extra,
  })
}

// ===========================================================================
// PHASE: Preflight — verify the environment before any expensive work.
// ===========================================================================
phase('Preflight')
const pre = await runAgent(
  envelope(
    'PHASE: Preflight. Verify the environment is ready for autonomous build + ship. In the worktree, check and report:\n' +
      '- gh auth status; presence of jq, node, coderabbit (run coderabbit --version); presence of codex (best-effort).\n' +
      '- that the worktree exists and is on branch ' + ctx.branch + ' (git rev-parse --abbrev-ref HEAD).\n' +
      '- create the .env.local symlink in the worktree if missing (link to the main repo .env.local) so tests can read env vars.\n' +
      '- whether SONAR_TOKEN and SONAR_PROJECT_KEY are set.\n' +
      'Return status=completed only if gh, jq, node, AND coderabbit are available and the worktree is on the right branch. ' +
      'If a hard dependency (gh/jq/node/coderabbit) is missing, return status=failed naming it. codex and Sonar absence are WARNINGS — note them in reason but still return completed, and set codexAvailable/sonarConfigured accordingly.',
  ),
  { label: 'preflight', phase: 'Preflight', schema: statusSchema({ codexAvailable: { type: 'boolean' }, sonarConfigured: { type: 'boolean' } }) },
)
{ const g = gate(pre, 'Preflight'); if (g.halt) return g.out }
const codexAvailable = !!pre.codexAvailable

// ===========================================================================
// PHASE 4: Build (TDD). Read plan -> one sequential agent per task.
// ===========================================================================
phase('Build')
// This agent is the ONLY one that reads the whole plan. It returns each task's
// own section verbatim so the per-task prompts can inline just that slice —
// nine fresh agents re-parsing the full plan is the context bloat that makes
// build agents stall.
const planRead = await runAgent(
  envelope(
    'PHASE 4 setup. Read the plan file at ' + ctx.planPath + '. Extract the ordered list of implementation tasks (each a 2-5 min unit). ' +
      'Return them in dependency order — a task may only depend on earlier ones. Do not implement anything yet.\n' +
      'For EACH task also return `body`: that task\'s own section of the plan, VERBATIM — its steps, the files it names, and its ' +
      'completion/acceptance criterion (including any criterion that deliberately differs from a normal red-green-refactor cycle, ' +
      'e.g. "complete when these tests fail"). Copy the text; do not summarise or rewrite it, because the build agent will see your ' +
      'copy INSTEAD of the plan. If a section exceeds ~4000 characters, include the first 4000 and end with ' +
      '"…[truncated — open the plan file for the rest]".',
  ),
  {
    label: 'plan-read',
    phase: 'Build',
    schema: statusSchema(
      { tasks: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { id: { type: 'string' }, title: { type: 'string' }, body: { type: 'string' } }, required: ['id', 'title'] } } },
      ['tasks'],
    ),
  },
)
{ const g = gate(planRead, 'Build'); if (g.halt) return g.out }

// Sequential TDD — each task commits before the next starts (shared worktree, safe).
// FUTURE: group tasks into dependency levels and parallel() the file-disjoint ones
// with isolation:'worktree' + a merge-back agent. Out of scope for v1.
// Tasks a previous run already burned six identical attempts on. The runtime
// will do exactly the same thing again — same prompt, same stall, same cost —
// so refuse to spend on one unless its prompt has actually changed (which, for
// this loop, means a resolutionNotes entry).
const knownStalled = new Set(Array.isArray(ctx.stalledTasks) ? ctx.stalledTasks : [])

for (let i = 0; i < planRead.tasks.length; i++) {
  const t = planRead.tasks[i]
  // A prior run may have halted this task with status=needs_human. The human's
  // decision comes back in via ctx.resolutionNotes, keyed by task id or by
  // 1-based position. Appending it changes the prompt, which is also what makes
  // resumeFromRunId re-run this task instead of replaying its cached halt —
  // tasks without a note keep their cache and return instantly.
  const note = (ctx.resolutionNotes || {})[t.id] ?? (ctx.resolutionNotes || {})[String(i + 1)]

  if (knownStalled.has(t.id) && !note) {
    return stop('Build', {
      status: 'needs_human',
      task: t.id,
      taskIndex: i + 1,
      reason:
        `Task ${t.id} ("${t.title}") is listed in args.stalledTasks and has no args.resolutionNotes entry. ` +
        'Its prompt would be byte-identical to the run that already stalled on it, and the runtime retries a stalled ' +
        'agent with the same prompt six times before giving up — so re-running it now buys nothing and costs the same. ' +
        'Fix the task in the plan, or pass a resolutionNotes entry for it, then relaunch.',
    })
  }

  const overall = budgetHalt('Build', { task: t.id, taskIndex: i + 1, completedTasks: i })
  if (overall) return overall

  const before = spent()
  const r = await runAgent(
    envelope(
      `PHASE 4 (Build, strict TDD) — task ${i + 1}/${planRead.tasks.length}: "${t.title}" (id ${t.id}).\n` +
        (t.body
          ? 'THIS TASK\'S SECTION OF THE PLAN IS INLINED BELOW — it is authoritative. Where its completion criterion ' +
            'differs from the generic cycle, the plan wins. Some tasks deliberately end RED (a reproduction task lands ' +
            'failing tests and NO source change; it is complete when the tests fail, and "fixing" them defeats its ' +
            'purpose). Do not force such a task to green. Only open the plan file itself if the section below is ' +
            'truncated or genuinely ambiguous — do not re-read the whole plan or the design doc for context you already have.\n' +
            '=== plan section for ' + t.id + ' ===\n' + t.body + '\n=== end plan section ===\n'
          : 'FIRST: open the plan file and read THIS task\'s own section (the plan-read step could not extract it). The plan is ' +
            'authoritative — where its completion criterion differs from the generic cycle below, the plan wins. Some tasks ' +
            'deliberately end RED (a reproduction task lands failing tests and NO source change; it is complete when the tests ' +
            'fail, and "fixing" them defeats its purpose). Do not force such a task to green.\n') +
        'ALSO FIRST: check whether this task is already done — `git log --oneline origin/main..HEAD` plus the ' +
        'plan/progress.md. If its commit already exists, verify it briefly and return status=completed without redoing it.\n' +
        'Otherwise the cycle is: RED (write a failing test) -> GREEN (minimal code to pass) -> REFACTOR (tests stay green) -> COMMIT (descriptive message). ' +
        'Use the repo test stack (vitest / pgTAP / playwright as appropriate). After committing, update progress.md with the task and its commit SHA. ' +
        'If implementing this task correctly would require changing the approved design, do NOT improvise — return status=needs_human with specifics.\n' +
        'PACING: a watchdog kills you if you go 180s without emitting a tool call, and it gets easier to trip the longer ' +
        'your context grows — so keep the context small. Read narrow (ranged reads and targeted greps, not whole files or ' +
        'whole directories), act, commit. Do not plan the entire task in one long silent reasoning block, and do not ' +
        're-derive the design from source when the section above already tells you what to change.\n' +
        'SALVAGE (the kill gives you no warning and leaves nothing behind unless you wrote it down): commit early and ' +
        'often — every green step is a commit. Before any long-running command (the full test suite, a broad search), ' +
        'first record where you are: either commit what you have as `wip(' + t.id + '): <state>`, or append a short ' +
        '"### ' + t.id + ' in progress — <what is done, what is next>" note to progress.md and commit that. A kill then ' +
        'leaves a resumable branch instead of zero. Leave those small commits in place; make the LAST commit of the task ' +
        'the descriptive one and do NOT rewrite history to tidy them up.' +
        (note
          ? `\n\nRESOLUTION FROM A PRIOR HALT ON THIS TASK — this is a decision already made by the human operator; treat it as binding and do not re-litigate it:\n${note}`
          : ''),
    ),
    { label: `build:${t.id}`, phase: 'Build', schema: statusSchema() },
  )

  const used = spent() - before
  const g = gate(r, 'Build', { task: t.id, taskIndex: i + 1, completedTasks: i, taskTokens: used })
  if (g.halt) return g.out

  log(`Build ${i + 1}/${planRead.tasks.length}: ${t.title} — ~${used} tokens (run total ~${spent()})`)

  // A task that completes but costs far more than budgeted is the shape of the
  // wf_da8ba6ba-5bb runaway. Warn always; halt only when carrying that cost
  // across the remaining tasks would blow the ceiling anyway.
  if (used > TASK_TOKEN_CEILING) {
    const remaining = planRead.tasks.length - (i + 1)
    const projected = spent() + used * remaining
    log(`⚠️ Build task ${t.id} used ~${used} tokens (per-task ceiling ${TASK_TOKEN_CEILING}); projected run total ~${projected}`)
    if (projected > TOKEN_CEILING) {
      return stop('Build', {
        status: 'needs_human',
        task: t.id,
        taskIndex: i + 1,
        completedTasks: i + 1,
        taskTokens: used,
        reason:
          `Task ${t.id} completed but cost ~${used} tokens (per-task ceiling ${TASK_TOKEN_CEILING}). At that rate the ` +
          `${remaining} remaining task(s) would take the run to ~${projected}, past the ${TOKEN_CEILING} ceiling. ` +
          'Work committed so far is on the branch. Split the oversized tasks in the plan, or relaunch with a raised ' +
          'args.tokenCeiling if this cost is genuinely expected.',
      })
    }
  }
}

// ===========================================================================
// PHASE 5: UI Review (conditional — agent decides skip via git diff).
// ===========================================================================
phase('UI Review')
{ const b = budgetHalt('UI Review'); if (b) return b }
const ui = await runAgent(
  envelope(
    'PHASE 5 (UI Review). Run: git diff origin/main...HEAD --name-only. ' +
      'If NO UI/component files changed (src/components, src/pages, *.tsx UI), return status=completed, reason="skipped: no UI changes". ' +
      'Otherwise use the frontend-design skill to review changed UI against the CLAUDE.md Apple/Notion guidelines (typography scale, semantic tokens, three-state rendering, accessibility), fix violations, and commit.',
  ),
  { label: 'ui-review', phase: 'UI Review', schema: statusSchema() },
)
{ const g = gate(ui, 'UI Review'); if (g.halt) return g.out }

// ===========================================================================
// PHASE 6: Simplify.
// ===========================================================================
phase('Simplify')
{ const b = budgetHalt('Simplify'); if (b) return b }
const simp = await runAgent(
  envelope('PHASE 6 (Simplify). Run: git diff origin/main...HEAD --name-only to scope recently-changed files. Use the code-simplifier skill to improve clarity/consistency/maintainability WITHOUT changing behavior. Commit any simplifications.'),
  { label: 'simplify', phase: 'Simplify', schema: statusSchema() },
)
{ const g = gate(simp, 'Simplify'); if (g.halt) return g.out }

// ===========================================================================
// PHASE 7: Multi-model review. snapshot -> parallel reviewers -> fold -> CR loop
// ===========================================================================
phase('Review')
// Last hard budget gate before the six-way fan-out — the single most expensive
// step in the script.
{ const b = budgetHalt('Review'); if (b) return b }
log(`Entering Phase 7 review fan-out at ~${spent()} tokens (ceiling ${TOKEN_CEILING})`)

// 7a-prep: snapshot diff/log/design as STRINGS before fan-out (fresh-context agents
// can't reliably re-derive them).
const snap = await runAgent(
  envelope(
    'PHASE 7 setup. In the worktree, capture and RETURN as strings: (1) git diff origin/main...HEAD ; (2) git log origin/main..HEAD --oneline ; (3) the full contents of the design doc at ' + ctx.designDocPath + ' ; (4) headSha = `git rev-parse HEAD` (used later to re-review anything committed after this snapshot). ' +
      'If the diff exceeds ~60000 chars, set diffTruncated=true, return it truncated, and ALSO write the full patch to dev-tools/phase7-diff.patch in the worktree.',
  ),
  { label: 'review-snapshot', phase: 'Review', schema: statusSchema({ diff: { type: 'string' }, gitLog: { type: 'string' }, designDoc: { type: 'string' }, headSha: { type: 'string' }, diffTruncated: { type: 'boolean' } }, ['diff', 'gitLog', 'designDoc', 'headSha']) },
)
{ const g = gate(snap, 'Review'); if (g.halt) return g.out }

const FINDINGS = statusSchema(
  {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: { file: { type: 'string' }, line: { type: 'number' }, severity: { type: 'string', enum: ['critical', 'major', 'minor', 'info'] }, message: { type: 'string' } },
        required: ['severity', 'message'],
      },
    },
  },
  ['findings'],
)

const REVIEWERS = [
  { key: 'security', agentType: 'security-reviewer', promptFile: '.claude/agents/security-reviewer.md' },
  { key: 'performance', agentType: 'performance-reviewer', promptFile: '.claude/agents/performance-reviewer.md' },
  { key: 'maintainability', agentType: 'maintainability-reviewer', promptFile: '.claude/agents/maintainability-reviewer.md' },
  { key: 'sound-logic', agentType: 'sound-logic-reviewer', promptFile: '.claude/agents/sound-logic-reviewer.md' },
  { key: 'ocr-rules', agentType: 'ocr-rules-reviewer', promptFile: '.claude/agents/ocr-rules-reviewer.md' },
]
function reviewerPrompt(d) {
  return envelope(
    `PHASE 7a — ${d.key} review. Read your reviewer instructions at ${ctx.worktreePath}/${d.promptFile} and load the skills it names. Review ONLY the change below. Report findings with severity. DO NOT fix anything (that is Phase 7b).\n\n` +
      '=== git log (origin/main..HEAD) ===\n' + snap.gitLog + '\n\n' +
      '=== design doc ===\n' + snap.designDoc + '\n\n' +
      '=== diff (origin/main...HEAD)' + (snap.diffTruncated ? ' [TRUNCATED — full patch at dev-tools/phase7-diff.patch] ' : ' ') + '===\n' + snap.diff,
  )
}

// 7a: five Claude reviewers (retry-once on null — a missing review is unsafe),
// including the non-skippable ocr-rules reviewer, plus the best-effort Codex
// adversarial reviewer.
async function runReviewer(d) {
  // Each dimension runs as its registered agent type from .claude/agents/.
  // The ocr-rules-reviewer type enforces the full rulebook without a
  // confidence filter, so no dimension needs a general-purpose fallback.
  const agentType = d.agentType
  // nullOnCrash: this path treats null as "reviewer produced nothing" and
  // retries exactly once, which is the bounded script-level retry the build
  // loop cannot have. But a null that came from a THROWN stall must NOT be
  // retried — the runtime already burned six identical attempts on that
  // prompt, and re-dispatching it buys six more, roughly doubling the very
  // runaway this file contains. Retry only a reviewer that came back empty
  // without dying, and never into a blown budget.
  const label = `review:${d.key}`
  let r = await runAgent(reviewerPrompt(d), { label, phase: 'Review', agentType, schema: FINDINGS }, { nullOnCrash: true })
  if (!r && didCrash(label)) {
    log(`⚠️ Phase 7a reviewer "${d.key}" stalled out — NOT retrying (the prompt would be byte-identical); its findings are absent this run`)
    return null
  }
  if (!r && spent() < TOKEN_CEILING) {
    r = await runAgent(reviewerPrompt(d), { label: `review:${d.key}:retry`, phase: 'Review', agentType, schema: FINDINGS }, { nullOnCrash: true })
  }
  return r
}
const reviewResults = await parallel([
  ...REVIEWERS.map((d) => () => runReviewer(d)),
  () =>
    codexAvailable
      ? runAgent(
          envelope('PHASE 7a — Codex adversarial review. Run: bash dev-tools/codex-adversarial-review.sh main (it writes dev-tools/codex-review-output.md). If the output contains ::skip:: return status=completed with findings=[] (Codex unavailable). Otherwise parse dev-tools/codex-review-output.md into findings with severity.'),
          { label: 'review:codex', phase: 'Review', schema: FINDINGS },
          { nullOnCrash: true },
        )
      : Promise.resolve({ status: 'completed', findings: [] }),
])

// Visibility: a non-skippable Claude reviewer that returned null (both attempts
// failed) is otherwise silently dropped by the fold's filter below. Surface it so
// a missing reviewer — especially the ocr-rules one, which must run on every
// invocation — is never invisible.
REVIEWERS.forEach((d, i) => {
  if (!reviewResults[i]) log(`⚠️ Phase 7a reviewer "${d.key}" returned no result (both attempts failed) — findings absent this run`)
})

// Shared return shape for the fold steps: every finding a fold agent chooses NOT
// to fix must come back in `deferred[]`, so nothing is dropped on the floor.
const DEFERRED = statusSchema(
  {
    deferred: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: { file: { type: 'string' }, line: { type: 'number' }, severity: { type: 'string' }, message: { type: 'string' }, reason: { type: 'string' } },
        required: ['severity', 'message', 'reason'],
      },
    },
  },
  ['deferred'],
)

// 7b: fold findings (single agent holds all results) -> fix actionable critical/major.
const reviewerNames = [...REVIEWERS.map((d) => d.key), 'codex']
const foldInput = JSON.stringify(
  reviewResults
    .map((r, i) => (r ? { reviewer: reviewerNames[i] || `#${i}`, status: r.status, findings: r.findings || [] } : null))
    .filter(Boolean),
)
const fold = await runAgent(
  envelope(
    'PHASE 7b (Fold findings). Below is JSON with findings from all reviewers (5 Claude — security, performance, maintainability, sound-logic, ocr-rules — plus Codex). Deduplicate by file:line (keep highest severity, merge messages). For each critical/major finding that is an actionable bug/security/correctness issue: FIX it and commit ("fix(review): <area> — addresses <reviewer>"). ' +
      'MINOR/INFO findings: fix any that are trivially safe (one-line, mechanical, no behaviour change) in the same commit. For every minor/info finding you do NOT fix, you MUST return it in `deferred[]` with file, line, severity, message and a one-line reason. ' +
      'NEVER discard a finding silently — "CodeRabbit will catch it in 7c" is NOT a valid reason to drop one, because 7c reviews a different surface and regularly misses them. Anything omitted from both your fixes and `deferred[]` is lost.\n' +
      'If a critical/major fix would require changing the approved design (' + ctx.designDocPath + '), return status=needs_human with details — do NOT improvise. After fixing, re-verify critical/security findings only. Also read dev-tools/codex-review-output.md if it exists.\n' +
      // The design gate above is what this phase halts on, and the resolution is
      // always the same shape: the human amends the design to authorize the fix.
      // Appending the note changes the prompt, which is also what makes
      // resumeFromRunId re-run the fold instead of replaying its cached halt.
      (ctx.foldResolutionNote
        ? '\nRESOLUTION FROM A PRIOR HALT ON THIS PHASE — this is a decision already made by the human operator; treat it as binding and do not re-litigate it:\n' + ctx.foldResolutionNote + '\n'
        : '') +
      '\n=== findings JSON ===\n' + foldInput,
  ),
  { label: 'fold-findings', phase: 'Review', schema: DEFERRED },
)
{ const g = gate(fold, 'Review'); if (g.halt) return g.out }

// Carry unfixed findings forward so Phase 9 can surface them in the PR body.
// Silent drops are how minor findings reached a PR unaddressed in the past.
const deferredFindings = fold.deferred || []
if (deferredFindings.length) log(`Phase 7b deferred ${deferredFindings.length} minor/info finding(s) — will be listed in the PR body`)

// 7c: CodeRabbit loop (script-level counter, max 3).
let crClean = false
for (let it = 1; it <= 3 && !crClean; it++) {
  const cr = await runAgent(
    envelope(
      `PHASE 7c (CodeRabbit) iteration ${it}/3. ` +
        'The CodeRabbit review for this branch has already been completed by the launching session, using `coderabbit review --agent --committed --base origin/main` from the worktree — base pinned to origin/main so the whole branch was reviewed as one coherent change. Your job is to act on its results, so there is no need to run the CLI again. ' +
        'The results are newline-delimited JSON on disk. Read these files (a later one supersedes an earlier one; some may not exist):\n' +
        '  1. ' + CODERABBIT_OUT + '/coderabbit-7c.md\n' +
        '  2. ' + CODERABBIT_OUT + '/coderabbit-7c-retry.md\n' +
        'Each line is a JSON object with a `type` field. `review_comment` lines are findings. A line with `"type":"error"` (for example `"errorType":"timeout"`) means the review service itself did not return results — that is the unavailable/best-effort case described below, and it is not the same as a clean review. ' +
        'Fix ONLY actionable findings and commit them. ' +
        (it > 1
          ? 'NOTE: this iteration reads the same on-disk results as the previous one, so it cannot contain anything new. Confirm that findings fixed earlier are addressed on the branch, then return clean=true, rather than re-applying fixes that are already committed. '
          : '') +
        'Return clean=true if there were NO actionable findings this run; clean=false if you fixed some (we re-run). On iteration 3 with findings still remaining, return clean=false and list the remaining items in reason — the script will escalate. ' +
        'BEST-EFFORT: if the CodeRabbit CLI is not installed, not authenticated, or returns a billing/credits/quota error (e.g. "run out of usage credits"), treat 7c as skipped — return status=completed, clean=true, and note "CodeRabbit skipped (unavailable/credits)" in reason. Do NOT return needs_human for environment/billing problems; the CodeRabbit GitHub bot still reviews the PR and is triaged in Phase 9d. Reserve needs_human only for genuinely ambiguous findings.',
    ),
    { label: `coderabbit:${it}`, phase: 'Review', schema: statusSchema({ clean: { type: 'boolean' } }, ['clean']) },
  )
  const g = gate(cr, 'Review'); if (g.halt) return g.out
  crClean = cr.clean
  log(`CodeRabbit ${it}/3: ${crClean ? 'clean' : 'fixed findings, re-running'}`)
  // The 7c prompt promises "the script will escalate" on a still-dirty round 3.
  // It used to just fall through, so the last observed state vanished. A capped
  // loop must report what it saw when the cap is what ended it.
  if (!crClean && it === 3) {
    const remaining = cr.reason || 'CodeRabbit still reported actionable findings on iteration 3 (no detail returned)'
    log(`⚠️ CodeRabbit still dirty after 3 iterations — carrying forward as deferred: ${remaining}`)
    deferredFindings.push(`CodeRabbit (unresolved after 3 iterations): ${remaining}`)
  }
}

// 7d: bounded re-review of code committed AFTER the 7a snapshot.
// The 7a diff is frozen, so 7b/7c fixes — and any late edits — otherwise ship
// completely unreviewed. Exactly one extra pass; skipped when nothing changed.
const postSnap = await runAgent(
  envelope(
    'PHASE 7d setup. In the worktree, return as strings: (1) newCommits = output of `git log ' + snap.headSha + '..HEAD --oneline` (empty string if there are none); ' +
      '(2) diff = output of `git diff ' + snap.headSha + '..HEAD -- . ":(exclude)dev-tools" ":(exclude)progress.md"` (empty string if empty). Truncate diff to ~60000 chars if larger. Do NOT modify anything.',
  ),
  { label: 're-review-snapshot', phase: 'Review', schema: statusSchema({ newCommits: { type: 'string' }, diff: { type: 'string' } }, ['newCommits', 'diff']) },
)
{ const g = gate(postSnap, 'Review'); if (g.halt) return g.out }

if (postSnap.diff && postSnap.diff.trim()) {
  log('Phase 7d: re-reviewing code committed after the 7a snapshot')
  const reResults = await parallel(
    REVIEWERS.map((d) => () =>
      runAgent(
        envelope(
          `PHASE 7d — ${d.key} re-review. Read your reviewer instructions at ${ctx.worktreePath}/${d.promptFile} and load the skills it names. ` +
            'The changes below were committed AFTER the main review pass (Phase 7b/7c fixes and any late edits) and have NEVER been reviewed. Review ONLY this diff. Report findings with severity. DO NOT fix anything.\n\n' +
            '=== new commits ===\n' + postSnap.newCommits + '\n\n=== diff ===\n' + postSnap.diff,
        ),
        { label: `re-review:${d.key}`, phase: 'Review', agentType: d.agentType, schema: FINDINGS },
        { nullOnCrash: true },
      ),
    ),
  )
  const reFindings = reResults.map((r, i) => (r ? { reviewer: REVIEWERS[i].key, findings: r.findings || [] } : null)).filter(Boolean)
  if (reFindings.some((r) => r.findings.length)) {
    const reFold = await runAgent(
      envelope(
        'PHASE 7d (fold re-review). The findings below come from re-reviewing code committed AFTER the main review pass. Deduplicate by file:line. FIX actionable critical/major findings and commit ("fix(review): <area> — addresses <reviewer> re-review"). ' +
          'Fix trivially-safe minors too; return EVERY unfixed minor/info in `deferred[]` with a reason. Never discard a finding silently. ' +
          'If a fix would require changing the approved design (' + ctx.designDocPath + '), return status=needs_human — do NOT improvise.\n\n' +
          '=== findings JSON ===\n' + JSON.stringify(reFindings),
      ),
      { label: 're-review-fold', phase: 'Review', schema: DEFERRED },
    )
    const g = gate(reFold, 'Review'); if (g.halt) return g.out
    deferredFindings.push(...(reFold.deferred || []))
  } else {
    log('Phase 7d: re-review found nothing in post-snapshot code')
  }
} else {
  log('Phase 7d: no new commits since the 7a snapshot — re-review skipped')
}

// ===========================================================================
// PHASE 8: Verify (single agent, internal 5-iteration fix loop).
// ===========================================================================
phase('Verify')
// Final hard budget gate. From Ship onward the ceiling is advisory only: a PR
// exists (or is one push away) and abandoning mid-CI strands finished work in a
// worse state than finishing it, so those phases log spend instead of halting.
{ const b = budgetHalt('Verify'); if (b) return b }
const verify = await runAgent(
  envelope(
    'PHASE 8 (Verify). Ensure the .env.local symlink exists in the worktree. Run the FULL suite: npm run test ; npm run test:db ; npm run test:e2e (start npm run dev:full / local Supabase as needed, then TEAR DOWN the dev server) ; npm run typecheck ; npm run lint ; npm run build. ' +
      'If anything fails, fix + commit and re-run, up to 5 iterations. Return allPass=true ONLY if every check passes with real output evidence. If still failing after 5 iterations, return status=failed listing the failing checks. Always tear down any background servers you start.' +
      // A distinct note re-keys the agent cache, so resumeFromRunId can
      // re-run a halted Verify instead of replaying its cached halt.
      // Same pattern as ctx.foldResolutionNote in Phase 7b.
      (ctx.verifyResolutionNote
        ? '\n\nRESOLUTION FROM A PRIOR HALT ON THIS PHASE — this is a decision already made by the human operator; treat it as binding and do not re-litigate it:\n' + ctx.verifyResolutionNote
        : ''),
  ),
  { label: 'verify', phase: 'Verify', schema: statusSchema({ allPass: { type: 'boolean' } }, ['allPass']) },
)
{ const g = gate(verify, 'Verify'); if (g.halt) return g.out }
if (!verify.allPass) return stop('Verify', { reason: 'local verification did not pass after 5 iterations' })

// ===========================================================================
// PHASE 9a: Ship — push + open PR, return the PR number (load-bearing state).
// ===========================================================================
phase('Ship')
const ship = await runAgent(
  envelope(
    'PHASE 9a (Ship). Push the branch: git push -u origin ' + ctx.branch + '. Open a PR with gh pr create: concise title (<70 chars), body with ## Summary (bullets from the plan), ## Test plan, and a link to the design doc. ' +
      (deferredFindings.length
        ? 'ALSO add a "## Known deferred review findings" section listing each item below verbatim (file:line — severity — message — why deferred), so reviewers see what was consciously not fixed rather than it being silently dropped:\n' +
          JSON.stringify(deferredFindings, null, 2) + '\n'
        : '') +
      'Return the PR number as prNumber. Update progress.md with it.',
  ),
  { label: 'ship', phase: 'Ship', schema: statusSchema({ prNumber: { type: 'number' } }, ['prNumber']) },
)
{ const g = gate(ship, 'Ship'); if (g.halt) return g.out }
const PR = ship.prNumber

// ===========================================================================
// PHASE 9b: CI loop (script-level counter, max 5). Agent blocks on --watch.
// ===========================================================================
phase('CI Loop')
let ciGreen = false
for (let it = 1; it <= 5 && !ciGreen; it++) {
  const ci = await runAgent(
    envelope(
      `PHASE 9b (CI) iteration ${it}/5 for PR #${PR}. Run: gh pr checks ${PR} --watch (blocks until checks finish). Then run dev-tools/refresh-queue.sh --pr ${PR} --skip-tests and check the SonarCloud quality gate (poll up to 3x with 60s gaps if Sonar lags CI).\n` +
        '- If all checks pass AND the Sonar gate passes (or Sonar is unconfigured — note it), return ciGreen=true.\n' +
        '- If checks fail, fix the actionable failures, commit, push, and return ciGreen=false (we re-run).\n' +
        '- If a review item genuinely needs human clarification, return status=needs_human with the items.',
    ),
    { label: `ci:${it}`, phase: 'CI Loop', schema: statusSchema({ ciGreen: { type: 'boolean' } }, ['ciGreen']) },
  )
  const g = gate(ci, 'CI Loop'); if (g.halt) return g.out
  ciGreen = ci.ciGreen
  log(`CI ${it}/5: ${ciGreen ? 'green' : 'fixed + pushed, re-watching'} (run total ~${spent()} tokens)`)
}
if (!ciGreen) return stop('CI Loop', { reason: 'CI not green after 5 iterations — escalating to human' })

// ===========================================================================
// PHASE 9d: Review-comment triage (NON-SKIPPABLE). Writes a disk artifact.
// ===========================================================================
phase('Triage')
const triage = await runAgent(
  envelope(
    `PHASE 9d (Review-comment triage) for PR #${PR} — NON-SKIPPABLE. CI green is NOT done.\n` +
      '1. Capture the latest commit: git rev-parse HEAD.\n' +
      `2. Run: dev-tools/refresh-queue.sh --pr ${PR} --skip-tests.\n` +
      '3. Run ALL THREE and print every row (do not summarize):\n' +
      `   - gh api repos/{owner}/{repo}/pulls/${PR}/comments --paginate   (inline review comments — Codex posts here)\n` +
      `   - gh api repos/{owner}/{repo}/issues/${PR}/comments --paginate  (PR conversation)\n` +
      `   - gh pr view ${PR} --json reviews                               (PR-level reviews)\n` +
      `4. Fix first, PUSH, and only then reply. An "agreed" reply must cite a commit already on the PR — the audit verifies the SHA against the PR's commit list, so replying before pushing makes the reply fail the gate.\n` +
      `4b. Reply to EVERY finding: node dev-tools/pr-triage.js reply --pr ${PR} --comment <id> --verdict <agreed|pushed-back|ignored> [--commit <sha>] --rationale "<why>". For a CHANGES_REQUESTED review (no thread to nest under) use --review <reviewer-login> instead of --comment. A fix is an "agreed" reply naming the commit, NOT a substitute for replying. Use \`node dev-tools/pr-triage.js list --pr ${PR}\` to enumerate unanswered findings and their comment ids.\n` +
      `4c. Then run: node dev-tools/pr-triage.js audit --pr ${PR} — it must exit 0 before you return. Exit 1 means a finding is unanswered; exit 2 means the audit could not read the PR (fail closed — investigate, never treat as a pass).\n` +
      `5. Write the full classified list to dev-tools/9d-triage-${ctx.branch}.md (persistent artifact for the done gate).\n` +
      'Return counts + latestSha. If there are genuinely ambiguous comments you cannot resolve, return status=needs_human with them.',
  ),
  {
    label: 'triage',
    phase: 'Triage',
    schema: statusSchema(
      { latestSha: { type: 'string' }, fixesCommitted: { type: 'number' }, declinedWithReply: { type: 'number' }, informational: { type: 'number' }, openCriticalOrMajor: { type: 'number' }, pushedFix: { type: 'boolean' } },
      ['openCriticalOrMajor'],
    ),
  },
)
{ const g = gate(triage, 'Triage'); if (g.halt) return g.out }

// If triage pushed a fix, CI must re-run before the done gate.
if (triage.pushedFix) {
  const reCi = await runAgent(
    envelope(`A triage fix was pushed to PR #${PR}. Run: gh pr checks ${PR} --watch, confirm all green + Sonar gate. Return ciGreen.`),
    { label: 'ci:post-triage', phase: 'Triage', schema: statusSchema({ ciGreen: { type: 'boolean' } }, ['ciGreen']) },
  )
  const g = gate(reCi, 'Triage'); if (g.halt) return g.out
  if (!reCi.ciGreen) return stop('Triage', { reason: 'CI not green after triage fix push' })
}

// ===========================================================================
// PHASE 9e: Done gate — verified against ON-DISK ARTIFACTS, not transcript.
// ===========================================================================
phase('Done Gate')
const done = await runAgent(
  envelope(
    `PHASE 9e (Done gate) for PR #${PR}. Verify against the LATEST commit (git rev-parse HEAD):\n` +
      `- node dev-tools/pr-triage.js audit --pr ${PR} exits 0 (every finding has a verdict reply on the PR).\n` +
      `- gh pr checks ${PR} : all passing.\n` +
      '- SonarCloud quality gate: PASS (or explicitly note it is unconfigured).\n' +
      `- dev-tools/9d-triage-${ctx.branch}.md exists and every row is fixed / replied / classified-as-nit.\n` +
      '- dev-tools/review_queue.json: zero OPEN critical or major items.\n' +
      'Return donePassed=true ONLY if ALL hold; otherwise donePassed=false with what failed in reason. Then update progress.md: ## Status: Ready for merge (only if donePassed).',
  ),
  { label: 'done-gate', phase: 'Done Gate', schema: statusSchema({ donePassed: { type: 'boolean' } }, ['donePassed']) },
)
{ const g = gate(done, 'Done Gate'); if (g.halt) return g.out }

return {
  stopped: false,
  prNumber: PR,
  done: done.donePassed,
  buildTasks: planRead.tasks.length,
  tokensSpent: spent(),
  ...(stalls.length ? { stalls } : {}),
  triage: {
    fixesCommitted: triage.fixesCommitted || 0,
    declinedWithReply: triage.declinedWithReply || 0,
    informational: triage.informational || 0,
  },
  note: done.donePassed
    ? `PR #${PR} green AND all review comments triaged — ready for review/merge.`
    : `PR #${PR} reached the done gate but did NOT fully pass — see reason; human attention needed.`,
}
