export const meta = {
  name: 'dev-continue-verify-and-ship',
  description: 'Continue /dev Phases 8-9e (Verify, Ship, CI loop, Triage, Done gate) after a Review-phase needs_human gate was resolved by hand.',
  whenToUse:
    'When dev-build-and-ship.js halted at the Review fold gate, the human resolved the finding and committed the fix, and Phases 8 onward still need to run. Resuming the original run would replay the cached fold agent and stop at the same gate.',
  phases: [
    { title: 'Verify', detail: 'full suite (+ optional prod-bundle probe)' },
    { title: 'Ship', detail: 'push + open PR' },
    { title: 'CI Loop', detail: 'watch checks, fix, re-push (max 5)' },
    { title: 'Triage', detail: 'reply to every review finding, audit exit 0' },
    { title: 'Done Gate', detail: 'verify against on-disk artifacts' },
  ],
}

let ctx = {}
try {
  ctx = (typeof args === 'string' ? JSON.parse(args) : args) || {}
} catch {
  ctx = {}
}
const REQUIRED = ['worktreePath', 'branch', 'designDocPath', 'planPath']
const missingArgs = REQUIRED.filter((k) => !ctx[k])
if (missingArgs.length) {
  return { stopped: true, phase: 'Preflight', reason: `Missing required args: ${missingArgs.join(', ')}` }
}

// ---- Optional per-run context, all caller-supplied -------------------------
// Nothing below may hardcode a fact about a particular branch — no feature
// name, no source file under review, no commit SHA. This script is reusable: it
// runs against whatever branch args.branch points at. It once carried one
// branch's error-boundary work inline — a "PRIOR STATE" paragraph asserting a
// commit had landed, and a Verify gate grepping that branch's probe string. On
// every other branch the paragraph actively misinformed the agent, and the grep
// matched nothing and passed vacuously. Per-run facts arrive through args or
// they do not get stated at all. (Naming this repo's own fixed landmarks —
// progress.md, origin/main — is fine; those are true on every branch.)
//
// Every optional arg below fails CLOSED. A malformed value halts Preflight
// instead of degrading to "feature off": silently disabling a gate the caller
// asked for reproduces the exact failure this file exists to prevent — a gate
// that never ran being indistinguishable from a gate that passed.
const shQuote = (s) => `'${String(s).replace(/'/g, "'\\''")}'`
const preflight = (reason) => ({ stopped: true, phase: 'Preflight', reason })
const trimmed = (v) => (typeof v === 'string' && v.trim() ? v.trim() : '')

// args.priorState — free text describing what the human resolved before this
// run was launched. The fallback asserts NOTHING: it cannot know that the build
// or review phases ran, so it sends the agent to the records instead of
// claiming they did. Telling it "phases 4-7 are complete" when no input
// establishes that is how required review work gets skipped.
const PRIOR_STATE =
  trimmed(ctx.priorState) ||
  'Determine what already happened on this branch by reading progress.md and `git log origin/main..HEAD --oneline`. Do NOT assume a phase ran or a finding was resolved unless those records show it. This script starts at Verify and does not itself run the build or review phases — if the records do not show them as complete, halt and say so rather than proceeding or starting them yourself.'

// args.bundleProbe — opt-in production-bundle gate. Either a bare string (the
// pattern, expected ABSENT from the build output) or
// { pattern, expect: 'absent'|'present', dir?, rationale? }.
// Omitted entirely → the gate is a genuine no-op: nothing is grepped, nothing
// asserted, and no returned field claims it passed. Supplied but malformed →
// Preflight halt, never a silent no-op.
const EXPECTATIONS = ['absent', 'present']
let PROBE = null
if (ctx.bundleProbe !== undefined && ctx.bundleProbe !== null) {
  const raw =
    typeof ctx.bundleProbe === 'string'
      ? { pattern: ctx.bundleProbe }
      : typeof ctx.bundleProbe === 'object' && !Array.isArray(ctx.bundleProbe)
        ? ctx.bundleProbe
        : null
  if (!raw) {
    return preflight(`args.bundleProbe must be a string or an object, got ${Array.isArray(ctx.bundleProbe) ? 'array' : typeof ctx.bundleProbe}.`)
  }
  const pattern = trimmed(raw.pattern)
  if (!pattern) return preflight('args.bundleProbe was supplied but carries no usable `pattern` string.')
  // An unrecognised `expect` must NOT fall through to the default. "present "
  // or "Present" quietly becoming "absent" would invert the gate and let it
  // pass while checking the opposite of what was asked for.
  if (raw.expect !== undefined && !EXPECTATIONS.includes(raw.expect)) {
    return preflight(`args.bundleProbe.expect must be exactly ${EXPECTATIONS.map((e) => `'${e}'`).join(' or ')} (got ${JSON.stringify(raw.expect)}).`)
  }
  if (raw.dir !== undefined && !trimmed(raw.dir)) return preflight('args.bundleProbe.dir was supplied but is not a non-empty string.')
  if (raw.rationale !== undefined && typeof raw.rationale !== 'string') return preflight('args.bundleProbe.rationale must be a string.')
  PROBE = { pattern, expect: raw.expect || 'absent', dir: trimmed(raw.dir) || 'dist/', rationale: trimmed(raw.rationale) }
}

// args.prNotes — extra material the PR ## Summary must call out (design
// asymmetries, amended design sections, anything the diff alone won't convey).
const PR_NOTES = trimmed(ctx.prNotes)
if (ctx.prNotes !== undefined && !PR_NOTES) return preflight('args.prNotes was supplied but is not a non-empty string.')

// args.resolvedFindings — findings settled by hand before this run, so Triage
// can answer a reviewer who re-raises one instead of re-fixing or reverting it.
// Entries: { topic, commit, note? }. `commit` is REQUIRED, because the reply
// this drives ("agreed, resolved in <sha>") is audited against the PR's commit
// list — an entry with nothing checkable to cite would either block the audit
// or, worse, get the agent to vouch for a fix on faith. That unverifiable
// vouching is the original bug in this file.
const RESOLVED = []
if (ctx.resolvedFindings !== undefined) {
  if (!Array.isArray(ctx.resolvedFindings)) return preflight('args.resolvedFindings must be an array.')
  for (let i = 0; i < ctx.resolvedFindings.length; i++) {
    const f = ctx.resolvedFindings[i]
    if (!f || typeof f !== 'object' || Array.isArray(f)) {
      return preflight(`args.resolvedFindings[${i}] must be an object with { topic, commit, note? }.`)
    }
    const topic = trimmed(f.topic)
    const commit = trimmed(f.commit)
    const note = trimmed(f.note)
    if (!topic) return preflight(`args.resolvedFindings[${i}] is missing a non-empty \`topic\` string.`)
    if (!commit) {
      return preflight(
        `args.resolvedFindings[${i}] ("${topic}") is missing a non-empty \`commit\`. ` +
          'Every resolved finding must cite a commit the triage audit can verify against the PR; ' +
          'if there is no such commit, leave the finding out and let Triage handle it normally.',
      )
    }
    if (f.note !== undefined && !note) return preflight(`args.resolvedFindings[${i}] ("${topic}") has a \`note\` that is not a non-empty string.`)
    RESOLVED.push({ topic, commit, note })
  }
}

const STATUS = {
  status: { type: 'string', enum: ['completed', 'needs_human', 'failed'] },
  reason: {
    type: 'string',
    description: 'Required when status is needs_human or failed: the specific blocker, with enough context for a human to act cold.',
  },
  commits: { type: 'array', items: { type: 'string' }, description: 'commit SHAs created during this phase (may be empty)' },
}
const statusSchema = (extraProps = {}, extraRequired = []) => ({
  type: 'object',
  additionalProperties: false,
  properties: { ...STATUS, ...extraProps },
  required: ['status', ...extraRequired],
})

// skillRef is opt-in: development-workflow.md is 42 KB and every prompt below
// already states what its phase must do. See the runaway-burn notes in
// dev-build-and-ship.js — context size is what drives the 180s stall.
// Unsatisfiable-wait guard — see the WAIT_DISCIPLINE comment in
// dev-build-and-ship.js for the incident. This script matters more for it than
// that one does: Verify starts dev servers and Playwright, and the CI loop
// waits on GitHub, so every phase here is a place a wait can be built wrong.
const WAIT_DISCIPLINE = [
  'WAIT DISCIPLINE (a poll loop with an impossible exit condition once spun 4h before a human killed it):',
  '- Before ANY wait loop, evaluate the condition ONCE and print the raw value. If it already sits on the wrong side of the exit test, do not loop — looping cannot move it.',
  '- Never test process state with `ps aux | grep -c <name>`. Every Claude Code process carries the MCP config on its command line, so grepping a tool name ("playwright", "vitest", "supabase") matches dozens of unrelated processes and the count never drops. Wait on a PID you started (`cmd & pid=$!; wait $pid`) or use the tool\'s own blocking mode (`gh pr checks --watch`, a foreground test run).',
  "- Every wait needs a bound, but `timeout` and `gtimeout` do NOT exist on this BSD/bash-3.2 machine (nor does `tail --pid`) — do not reach for them. Run the command in the FOREGROUND and let the Bash tool's own timeout parameter bound it (default 120s, max 600s). If you must iterate, cap the count and exit non-zero printing the last observed value. An unbounded wait is indistinguishable from a hang.",
  "- Kill every background process you start before you return, on the failure path too (`trap 'kill $pid 2>/dev/null' EXIT`). Orphans outlive the agent that spawned them.",
].join('\n')

// Broad-staging guard — see the STAGING_DISCIPLINE comment in
// dev-build-and-ship.js for the incidents. This script needs it just as much:
// it resumes mid-task, so the worktree it inherits is already carrying another
// phase's scratch and dirty files when its first agent goes to commit.
const STAGING_DISCIPLINE = [
  'STAGING DISCIPLINE (applies to every commit you make, in every phase):',
  `- Stage EXPLICIT paths, always with -C so the command cannot act on the wrong checkout: git -C ${ctx.worktreePath} add <path> [<path>...]`,
  '- NEVER `git add -A`, `git add .`, or `git commit -a`. This worktree is shared across phases and accumulates per-run scratch (dev-tools/*.patch, dev-tools/*-output.md, dev-tools/9d-triage-*) plus whatever an earlier phase left dirty; a broad add sweeps all of it into your commit, where it becomes PR noise and conflicts with other branches regenerating the same files.',
  '- `progress.md` is gitignored and must NEVER be staged — not even with `git add -f`.',
  `- Before each commit, confirm the index holds only what you intended: git -C ${ctx.worktreePath} diff --cached --name-only`,
].join('\n')

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
    `PRIOR STATE: ${PRIOR_STATE}`,
    '',
    body,
  ].join('\n')
}

// ---- Spend accounting + crash containment ---------------------------------
// Same rationale as dev-build-and-ship.js (read the RUNAWAY-BURN block there):
// the stall watchdog, its 6 identical retries and the 180s interval all live in
// the runtime, and a stalled-out agent() THROWS. This script has no build loop,
// so the levers that apply here are: catch the throw into a structured halt,
// and cap total spend with budget.spent() (budget.total is usually null).
const TOKEN_CEILING = Number(ctx.tokenCeiling) > 0 ? Number(ctx.tokenCeiling) : 1200000
function spent() {
  try {
    return typeof budget !== 'undefined' && budget && typeof budget.spent === 'function' ? budget.spent() || 0 : 0
  } catch {
    return 0
  }
}

const stalls = []

function stop(phase, extra = {}) {
  return { stopped: true, phase, tokensSpent: spent(), ...(stalls.length ? { stalls } : {}), ...extra }
}

function gate(result, phase, extra = {}) {
  if (!result) return { halt: true, out: stop(phase, { reason: 'agent returned null (user skipped or it errored)', ...extra }) }
  if (result.status !== 'completed') {
    return { halt: true, out: stop(phase, { status: result.status, reason: result.reason || `agent returned status=${result.status}`, ...extra }) }
  }
  return { halt: false }
}

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
        `It burned ~${cost} tokens across the runtime's internal attempts, all with the same prompt — ` +
        'relaunching unchanged will reproduce it identically. Change the prompt or do this phase by hand.',
    }
  }
}

// Returns a stop payload once the ceiling is reached, or null to continue.
function budgetHalt(phaseName, extra = {}) {
  const s = spent()
  if (s < TOKEN_CEILING) return null
  return stop(phaseName, {
    status: 'needs_human',
    reason:
      `Token ceiling reached: ~${s} output tokens spent against a ceiling of ${TOKEN_CEILING}. ` +
      'Halting before spending more. Relaunch with args.tokenCeiling raised if this run legitimately needs it.',
    ...extra,
  })
}

// ===========================================================================
// PHASE 8: Verify
// ===========================================================================
phase('Verify')
// Verify is this script's first phase, so a ceiling check here only fires on a
// resumed run that arrives with spend already on the clock. The check that
// actually bites is the one before Ship.
{ const b = budgetHalt('Verify'); if (b) return b }
// Probe block is emitted only when the caller configured one. Note the explicit
// reading of grep's exit code: 1 (no match) and 2 (grep could not run — e.g. no
// build output) are different outcomes, and conflating them is what let an
// unconfigured gate report success.
const probeInstruction = PROBE
  ? 'ADDITIONALLY — this run was launched with a production-bundle gate. After npm run build, run:\n' +
    `  grep -rF -- ${shQuote(PROBE.pattern)} ${shQuote(PROBE.dir)} ; echo "exit=$?"\n` +
    `The pattern MUST be ${PROBE.expect.toUpperCase()} in the build output, i.e. exit=${PROBE.expect === 'present' ? '0' : '1'}.\n` +
    'Read the exit code literally: 0 = matched, 1 = no match, 2 = grep itself failed (missing directory, unreadable path). Exit 2 is NOT a pass — it means there was no build output to check, so investigate and re-run rather than recording the gate as satisfied.\n' +
    (PROBE.rationale ? `Why this gate exists: ${PROBE.rationale}\n` : '') +
    'If the observed result contradicts the expectation, fix the cause and re-run; do NOT proceed. Record the raw grep output and its exit code in progress.md under a "Production bundle verification" heading, and set bundleProbeOk=true only if what you observed matches the expectation.\n'
  : ''
const verify = await runAgent(
  envelope(
    'PHASE 8 (Verify). Ensure the .env.local symlink exists in the worktree. Run the FULL suite: npm run test ; npm run test:db ; npm run test:e2e (start npm run dev:full / local Supabase as needed, then TEAR DOWN the dev server) ; npm run typecheck ; npm run lint ; npm run build.\n' +
      probeInstruction +
      'If anything fails, fix + commit and re-run, up to 5 iterations. Return allPass=true ONLY if every check passes with real output evidence. If still failing after 5 iterations, return status=failed listing the failing checks. Always tear down any background servers you start.',
  ),
  {
    label: 'verify',
    phase: 'Verify',
    schema: statusSchema(
      { allPass: { type: 'boolean' }, ...(PROBE ? { bundleProbeOk: { type: 'boolean' } } : {}) },
      ['allPass', ...(PROBE ? ['bundleProbeOk'] : [])],
    ),
  },
)
{ const g = gate(verify, 'Verify'); if (g.halt) return g.out }
if (!verify.allPass) return stop('Verify', { reason: 'local verification did not pass after 5 iterations' })
if (PROBE && !verify.bundleProbeOk) {
  return stop('Verify', {
    reason: `production-bundle gate failed: "${PROBE.pattern}" was required to be ${PROBE.expect} in ${PROBE.dir} and was not`,
  })
}

// ===========================================================================
// PHASE 9a: Ship
// ===========================================================================
phase('Ship')
// Last clean halt point: nothing has been pushed yet, so stopping here strands
// nothing. From here on the ceiling is advisory — abandoning mid-CI with a live
// PR leaves a worse state than finishing, so those phases log spend instead.
{ const b = budgetHalt('Ship'); if (b) return b }
log(`Entering Ship at ~${spent()} tokens (ceiling ${TOKEN_CEILING})`)
const ship = await runAgent(
  envelope(
    'PHASE 9a (Ship). Push the branch: git push -u origin ' + ctx.branch + '. Open a PR with gh pr create: concise title (<70 chars), body with ## Summary (bullets from the plan), ## Test plan, and a link to the design doc.\n' +
      (PR_NOTES ? `ALSO call the following out explicitly in ## Summary — it is the context the diff alone will not convey:\n${PR_NOTES}\n` : '') +
      'Return the PR number as prNumber. Update progress.md with it.',
  ),
  { label: 'ship', phase: 'Ship', schema: statusSchema({ prNumber: { type: 'number' } }, ['prNumber']) },
)
{ const g = gate(ship, 'Ship'); if (g.halt) return g.out }
const PR = ship.prNumber

// ===========================================================================
// PHASE 9b: CI loop (max 5)
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
// PHASE 9d: Review-comment triage (NON-SKIPPABLE)
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
      (RESOLVED.length
        ? 'ALREADY RESOLVED BEFORE THIS RUN — if a reviewer re-raises one of these, reply "agreed" citing the commit named here instead of re-fixing or reverting:\n' +
          RESOLVED.map((f) => `- ${f.topic} — resolved in ${f.commit}${f.note ? ` — ${f.note}` : ''}`).join('\n') +
          '\nConfirm each cited commit is actually on this branch (`git log origin/main..HEAD --oneline`) BEFORE citing it. If it is not there, this note is stale — treat the finding as unresolved and handle it normally. Anything NOT in this list is unresolved by default; handle it normally.\n'
        : '') +
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

if (triage.pushedFix) {
  const reCi = await runAgent(
    envelope(`A triage fix was pushed to PR #${PR}. Run: gh pr checks ${PR} --watch, confirm all green + Sonar gate. Return ciGreen.`),
    { label: 'ci:post-triage', phase: 'Triage', schema: statusSchema({ ciGreen: { type: 'boolean' } }, ['ciGreen']) },
  )
  const g = gate(reCi, 'Triage'); if (g.halt) return g.out
  if (!reCi.ciGreen) return stop('Triage', { reason: 'CI not green after triage fix push' })
}

// ===========================================================================
// PHASE 9e: Done gate
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
  tokensSpent: spent(),
  ...(stalls.length ? { stalls } : {}),
  ...(PROBE ? { bundleProbeOk: verify.bundleProbeOk } : {}),
  triage: {
    fixesCommitted: triage.fixesCommitted || 0,
    declinedWithReply: triage.declinedWithReply || 0,
    informational: triage.informational || 0,
    openCriticalOrMajor: triage.openCriticalOrMajor,
  },
}
