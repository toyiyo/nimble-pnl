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

// Orientation block injected into EVERY agent prompt (fresh context).
function envelope(body) {
  return [
    'WORKING CONTEXT (you have fresh context — this block is all you start with):',
    `- Worktree (cd here for every command): ${ctx.worktreePath}`,
    `- Branch: ${ctx.branch}`,
    `- Design doc (the approved design — do NOT deviate from it): ${ctx.designDocPath}`,
    `- Plan file: ${ctx.planPath}`,
    `- progress.md: ${ctx.worktreePath}/progress.md — read it for prior-phase state; update it when you finish your phase.`,
    `- The authoritative phase definitions live in ${ctx.worktreePath}/.claude/skills/development-workflow.md — consult the matching phase if you need detail.`,
    '',
    body,
  ].join('\n')
}

// Halt helper: stop the workflow cleanly when an agent needs a human or fails.
function gate(result, phase) {
  if (!result) return { halt: true, out: { stopped: true, phase, reason: 'agent returned null (user skipped or it errored)' } }
  if (result.status !== 'completed') {
    return { halt: true, out: { stopped: true, phase, status: result.status, reason: result.reason || `agent returned status=${result.status}` } }
  }
  return { halt: false }
}

// ===========================================================================
// PHASE: Preflight — verify the environment before any expensive work.
// ===========================================================================
phase('Preflight')
const pre = await agent(
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
const planRead = await agent(
  envelope('PHASE 4 setup. Read the plan file at ' + ctx.planPath + '. Extract the ordered list of implementation tasks (each a 2-5 min unit). Return them in dependency order — a task may only depend on earlier ones. Do not implement anything yet.'),
  {
    label: 'plan-read',
    phase: 'Build',
    schema: statusSchema(
      { tasks: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { id: { type: 'string' }, title: { type: 'string' } }, required: ['id', 'title'] } } },
      ['tasks'],
    ),
  },
)
{ const g = gate(planRead, 'Build'); if (g.halt) return g.out }

// Sequential TDD — each task commits before the next starts (shared worktree, safe).
// FUTURE: group tasks into dependency levels and parallel() the file-disjoint ones
// with isolation:'worktree' + a merge-back agent. Out of scope for v1.
for (let i = 0; i < planRead.tasks.length; i++) {
  const t = planRead.tasks[i]
  const r = await agent(
    envelope(
      `PHASE 4 (Build, strict TDD) — task ${i + 1}/${planRead.tasks.length}: "${t.title}" (id ${t.id}).\n` +
        'Cycle: RED (write a failing test) -> GREEN (minimal code to pass) -> REFACTOR (tests stay green) -> COMMIT (descriptive message). ' +
        'Use the repo test stack (vitest / pgTAP / playwright as appropriate). After committing, update progress.md with the task and its commit SHA. ' +
        'If implementing this task correctly would require changing the approved design, do NOT improvise — return status=needs_human with specifics.',
    ),
    { label: `build:${t.id}`, phase: 'Build', schema: statusSchema() },
  )
  const g = gate(r, 'Build'); if (g.halt) return g.out
  log(`Build ${i + 1}/${planRead.tasks.length}: ${t.title}`)
}

// ===========================================================================
// PHASE 5: UI Review (conditional — agent decides skip via git diff).
// ===========================================================================
phase('UI Review')
const ui = await agent(
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
const simp = await agent(
  envelope('PHASE 6 (Simplify). Run: git diff origin/main...HEAD --name-only to scope recently-changed files. Use the code-simplifier skill to improve clarity/consistency/maintainability WITHOUT changing behavior. Commit any simplifications.'),
  { label: 'simplify', phase: 'Simplify', schema: statusSchema() },
)
{ const g = gate(simp, 'Simplify'); if (g.halt) return g.out }

// ===========================================================================
// PHASE 7: Multi-model review. snapshot -> parallel reviewers -> fold -> CR loop
// ===========================================================================
phase('Review')

// 7a-prep: snapshot diff/log/design as STRINGS before fan-out (fresh-context agents
// can't reliably re-derive them).
const snap = await agent(
  envelope(
    'PHASE 7 setup. In the worktree, capture and RETURN as strings: (1) git diff origin/main...HEAD ; (2) git log origin/main..HEAD --oneline ; (3) the full contents of the design doc at ' + ctx.designDocPath + '. ' +
      'If the diff exceeds ~60000 chars, set diffTruncated=true, return it truncated, and ALSO write the full patch to dev-tools/phase7-diff.patch in the worktree.',
  ),
  { label: 'review-snapshot', phase: 'Review', schema: statusSchema({ diff: { type: 'string' }, gitLog: { type: 'string' }, designDoc: { type: 'string' }, diffTruncated: { type: 'boolean' } }, ['diff', 'gitLog', 'designDoc']) },
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
  { key: 'security', promptFile: '.claude/agents/security-reviewer.md' },
  { key: 'performance', promptFile: '.claude/agents/performance-reviewer.md' },
  { key: 'maintainability', promptFile: '.claude/agents/maintainability-reviewer.md' },
  { key: 'sound-logic', promptFile: '.claude/agents/sound-logic-reviewer.md' },
  { key: 'ocr-rules', promptFile: '.claude/agents/ocr-rules-reviewer.md' },
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
  let r = await agent(reviewerPrompt(d), { label: `review:${d.key}`, phase: 'Review', agentType: 'feature-dev:code-reviewer', schema: FINDINGS })
  if (!r) r = await agent(reviewerPrompt(d), { label: `review:${d.key}:retry`, phase: 'Review', agentType: 'feature-dev:code-reviewer', schema: FINDINGS })
  return r
}
const reviewResults = await parallel([
  ...REVIEWERS.map((d) => () => runReviewer(d)),
  () =>
    codexAvailable
      ? agent(
          envelope('PHASE 7a — Codex adversarial review. Run: bash dev-tools/codex-adversarial-review.sh main (it writes dev-tools/codex-review-output.md). If the output contains ::skip:: return status=completed with findings=[] (Codex unavailable). Otherwise parse dev-tools/codex-review-output.md into findings with severity.'),
          { label: 'review:codex', phase: 'Review', schema: FINDINGS },
        )
      : Promise.resolve({ status: 'completed', findings: [] }),
])

// 7b: fold findings (single agent holds all results) -> fix actionable critical/major.
const foldInput = JSON.stringify(
  reviewResults.filter(Boolean).map((r, i) => ({ reviewer: i, status: r.status, findings: r.findings || [] })),
)
const fold = await agent(
  envelope(
    'PHASE 7b (Fold findings). Below is JSON with findings from all reviewers (5 Claude — security, performance, maintainability, sound-logic, ocr-rules — plus Codex). Deduplicate by file:line (keep highest severity, merge messages). For each critical/major finding that is an actionable bug/security/correctness issue: FIX it and commit ("fix(review): <area> — addresses <reviewer>"). Style/nits -> skip (CodeRabbit catches them in 7c). ' +
      'If a critical/major fix would require changing the approved design (' + ctx.designDocPath + '), return status=needs_human with details — do NOT improvise. After fixing, re-verify critical/security findings only. Also read dev-tools/codex-review-output.md if it exists.\n\n' +
      '=== findings JSON ===\n' + foldInput,
  ),
  { label: 'fold-findings', phase: 'Review', schema: statusSchema() },
)
{ const g = gate(fold, 'Review'); if (g.halt) return g.out }

// 7c: CodeRabbit loop (script-level counter, max 3).
let crClean = false
for (let it = 1; it <= 3 && !crClean; it++) {
  const cr = await agent(
    envelope(
      `PHASE 7c (CodeRabbit) iteration ${it}/3. Run: coderabbit review --plain --type committed (in the worktree). Fix ONLY actionable findings and commit them. ` +
        'Return clean=true if there were NO actionable findings this run; clean=false if you fixed some (we re-run). On iteration 3 with findings still remaining, return clean=false and list the remaining items in reason — the script will escalate. ' +
        'BEST-EFFORT: if the CodeRabbit CLI is not installed, not authenticated, or returns a billing/credits/quota error (e.g. "run out of usage credits"), treat 7c as skipped — return status=completed, clean=true, and note "CodeRabbit skipped (unavailable/credits)" in reason. Do NOT return needs_human for environment/billing problems; the CodeRabbit GitHub bot still reviews the PR and is triaged in Phase 9d. Reserve needs_human only for genuinely ambiguous findings.',
    ),
    { label: `coderabbit:${it}`, phase: 'Review', schema: statusSchema({ clean: { type: 'boolean' } }, ['clean']) },
  )
  const g = gate(cr, 'Review'); if (g.halt) return g.out
  crClean = cr.clean
  log(`CodeRabbit ${it}/3: ${crClean ? 'clean' : 'fixed findings, re-running'}`)
}

// ===========================================================================
// PHASE 8: Verify (single agent, internal 5-iteration fix loop).
// ===========================================================================
phase('Verify')
const verify = await agent(
  envelope(
    'PHASE 8 (Verify). Ensure the .env.local symlink exists in the worktree. Run the FULL suite: npm run test ; npm run test:db ; npm run test:e2e (start npm run dev:full / local Supabase as needed, then TEAR DOWN the dev server) ; npm run typecheck ; npm run lint ; npm run build. ' +
      'If anything fails, fix + commit and re-run, up to 5 iterations. Return allPass=true ONLY if every check passes with real output evidence. If still failing after 5 iterations, return status=failed listing the failing checks. Always tear down any background servers you start.',
  ),
  { label: 'verify', phase: 'Verify', schema: statusSchema({ allPass: { type: 'boolean' } }, ['allPass']) },
)
{ const g = gate(verify, 'Verify'); if (g.halt) return g.out }
if (!verify.allPass) return { stopped: true, phase: 'Verify', reason: 'local verification did not pass after 5 iterations' }

// ===========================================================================
// PHASE 9a: Ship — push + open PR, return the PR number (load-bearing state).
// ===========================================================================
phase('Ship')
const ship = await agent(
  envelope(
    'PHASE 9a (Ship). Push the branch: git push -u origin ' + ctx.branch + '. Open a PR with gh pr create: concise title (<70 chars), body with ## Summary (bullets from the plan), ## Test plan, and a link to the design doc. ' +
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
  const ci = await agent(
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
  log(`CI ${it}/5: ${ciGreen ? 'green' : 'fixed + pushed, re-watching'}`)
}
if (!ciGreen) return { stopped: true, phase: 'CI Loop', reason: 'CI not green after 5 iterations — escalating to human' }

// ===========================================================================
// PHASE 9d: Review-comment triage (NON-SKIPPABLE). Writes a disk artifact.
// ===========================================================================
phase('Triage')
const triage = await agent(
  envelope(
    `PHASE 9d (Review-comment triage) for PR #${PR} — NON-SKIPPABLE. CI green is NOT done.\n` +
      '1. Capture the latest commit: git rev-parse HEAD.\n' +
      `2. Run: dev-tools/refresh-queue.sh --pr ${PR} --skip-tests.\n` +
      '3. Run ALL THREE and print every row (do not summarize):\n' +
      `   - gh api repos/{owner}/{repo}/pulls/${PR}/comments --paginate   (inline review comments — Codex posts here)\n` +
      `   - gh api repos/{owner}/{repo}/issues/${PR}/comments --paginate  (PR conversation)\n` +
      `   - gh pr view ${PR} --json reviews                               (PR-level reviews)\n` +
      '4. Classify EVERY row: bug/correctness -> fix + commit + push (set pushedFix=true); refactor/suggestion -> implement OR reply on the PR declining with a reason; nit/info -> read only.\n' +
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
  const reCi = await agent(
    envelope(`A triage fix was pushed to PR #${PR}. Run: gh pr checks ${PR} --watch, confirm all green + Sonar gate. Return ciGreen.`),
    { label: 'ci:post-triage', phase: 'Triage', schema: statusSchema({ ciGreen: { type: 'boolean' } }, ['ciGreen']) },
  )
  const g = gate(reCi, 'Triage'); if (g.halt) return g.out
  if (!reCi.ciGreen) return { stopped: true, phase: 'Triage', reason: 'CI not green after triage fix push' }
}

// ===========================================================================
// PHASE 9e: Done gate — verified against ON-DISK ARTIFACTS, not transcript.
// ===========================================================================
phase('Done Gate')
const done = await agent(
  envelope(
    `PHASE 9e (Done gate) for PR #${PR}. Verify against the LATEST commit (git rev-parse HEAD):\n` +
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
  triage: {
    fixesCommitted: triage.fixesCommitted || 0,
    declinedWithReply: triage.declinedWithReply || 0,
    informational: triage.informational || 0,
  },
  note: done.donePassed
    ? `PR #${PR} green AND all review comments triaged — ready for review/merge.`
    : `PR #${PR} reached the done gate but did NOT fully pass — see reason; human attention needed.`,
}
