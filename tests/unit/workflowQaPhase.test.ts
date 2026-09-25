/**
 * Script-layer tests for /dev Phase 8.5 (QA). Design:
 * docs/superpowers/specs/2026-09-25-qa-skill-design.md
 *
 * Both workflow scripts run Verify, then QA, then Ship. The script, not the
 * prompt, enforces that order: a QA failure halts before any push, and QA
 * fixes that land after Verify get a full re-verify before Ship.
 */

import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { runWorkflow, labelsOf, callNamed } from '../../dev-tools/workflow-harness.mjs'

const BUILD_SCRIPT = path.resolve(__dirname, '../../.claude/workflows/dev-build-and-ship.js')
const CONTINUE_SCRIPT = path.resolve(__dirname, '../../.claude/workflows/dev-continue-verify-and-ship.js')
const SCRIPTS = [
  ['dev-build-and-ship', BUILD_SCRIPT],
  ['dev-continue-verify-and-ship', CONTINUE_SCRIPT],
] as const

const BASE_ARGS = {
  worktreePath: '/tmp/wt',
  branch: 'feature/qa-phase',
  designDocPath: 'docs/design.md',
  planPath: 'docs/plan.md',
}

const REPORT = 'dev-tools/qa/qa-report-feature-qa-phase.md'
const QA_PASS = { status: 'completed', qaPassed: true, reportPath: REPORT, commits: [], minorFindings: [] }

type AgentOutcome = { result?: unknown; error?: string; tokens?: number }

function defaultResponder(label: string): AgentOutcome {
  if (label === 'preflight') return { result: { status: 'completed', codexAvailable: false, sonarConfigured: false } }
  if (label === 'plan-read') return { result: { status: 'completed', tasks: [{ id: 'task-1', title: 'Only task', body: 'Steps.' }] } }
  if (label === 'review-snapshot') return { result: { status: 'completed', diff: 'd', gitLog: 'l', designDoc: 'dd', headSha: 'abc123' } }
  if (label.startsWith('review:')) return { result: { status: 'completed', findings: [] } }
  if (label === 'fold-findings') return { result: { status: 'completed', deferred: [] } }
  if (label.startsWith('coderabbit:')) return { result: { status: 'completed', clean: true } }
  if (label === 're-review-snapshot') return { result: { status: 'completed', newCommits: '', diff: '' } }
  if (label === 'verify' || label === 'verify:post-qa') return { result: { status: 'completed', allPass: true } }
  if (label === 'qa') return { result: QA_PASS }
  if (label === 'ship') return { result: { status: 'completed', prNumber: 42 } }
  if (label.startsWith('ci:')) return { result: { status: 'completed', ciGreen: true } }
  if (label === 'triage') return { result: { status: 'completed', openCriticalOrMajor: 0, pushedFix: false } }
  if (label === 'done-gate') return { result: { status: 'completed', donePassed: true } }
  return { result: { status: 'completed' } }
}

function responder(overrides: Record<string, AgentOutcome> = {}, costPerCall = 1000) {
  return ({ opts }: { opts: { label?: string } }): AgentOutcome => {
    const label = String(opts.label)
    return { tokens: costPerCall, ...(overrides[label] ?? defaultResponder(label)) }
  }
}

describe.each(SCRIPTS)('%s: Phase 8.5 QA', (_name, script) => {
  it('runs QA after Verify and before Ship, and shows QA in meta.phases', async () => {
    const run = await runWorkflow(script, { args: BASE_ARGS, onAgent: responder() })
    const labels = labelsOf(run)

    expect(run.error).toBeNull()
    expect(run.result.stopped).toBe(false)
    expect(labels.indexOf('verify')).toBeLessThan(labels.indexOf('qa'))
    expect(labels.indexOf('qa')).toBeLessThan(labels.indexOf('ship'))
    expect(run.phases.indexOf('Verify')).toBeLessThan(run.phases.indexOf('QA'))
    expect(run.phases.indexOf('QA')).toBeLessThan(run.phases.indexOf('Ship'))
    expect(callNamed(run, 'qa')!.prompt).toContain('.claude/skills/qa/SKILL.md')
  })

  it('halts at QA when qaPassed is false, and pushes nothing', async () => {
    const run = await runWorkflow(script, {
      args: BASE_ARGS,
      onAgent: responder({
        qa: { result: { ...QA_PASS, qaPassed: false, reason: '1 major bug open: staff role sees the Delete button' } },
      }),
    })

    expect(run.result.stopped).toBe(true)
    expect(run.result.phase).toBe('QA')
    expect(run.result.status).toBe('needs_human')
    expect(run.result.reason).toContain('staff role sees the Delete button')
    expect(run.result.reportPath).toBe(REPORT)
    expect(labelsOf(run)).not.toContain('ship')
  })

  it('halts at QA with the agent reason when QA returns needs_human', async () => {
    const run = await runWorkflow(script, {
      args: BASE_ARGS,
      onAgent: responder({ qa: { result: { status: 'needs_human', reason: '.env.local does not point at local Supabase' } } }),
    })

    expect(run.result.stopped).toBe(true)
    expect(run.result.phase).toBe('QA')
    expect(run.result.reason).toBe('.env.local does not point at local Supabase')
    expect(labelsOf(run)).not.toContain('ship')
  })

  it('re-runs the full Verify suite before Ship when QA committed fixes', async () => {
    const run = await runWorkflow(script, {
      args: BASE_ARGS,
      onAgent: responder({ qa: { result: { ...QA_PASS, commits: ['f1x0001'] } } }),
    })
    const labels = labelsOf(run)

    expect(labels.indexOf('qa')).toBeLessThan(labels.indexOf('verify:post-qa'))
    expect(labels.indexOf('verify:post-qa')).toBeLessThan(labels.indexOf('ship'))
    expect(callNamed(run, 'verify:post-qa')!.prompt).toContain('npm run test:e2e')
  })

  it('skips the re-verify when QA committed nothing', async () => {
    const run = await runWorkflow(script, { args: BASE_ARGS, onAgent: responder() })
    expect(labelsOf(run)).not.toContain('verify:post-qa')
  })

  it('halts when the post-QA re-verify fails, and pushes nothing', async () => {
    const run = await runWorkflow(script, {
      args: BASE_ARGS,
      onAgent: responder({
        qa: { result: { ...QA_PASS, commits: ['f1x0001'] } },
        'verify:post-qa': { result: { status: 'completed', allPass: false } },
      }),
    })

    expect(run.result.stopped).toBe(true)
    expect(run.result.phase).toBe('QA')
    expect(run.result.reason).toContain('after QA fixes')
    expect(labelsOf(run)).not.toContain('ship')
  })

  it('carries the QA report and open minor findings into the Ship prompt', async () => {
    const minor = { title: 'Save button label wraps at 390px', severity: 'minor', evidence: 'dev-tools/qa/evidence/save-390.png' }
    const run = await runWorkflow(script, {
      args: BASE_ARGS,
      onAgent: responder({ qa: { result: { ...QA_PASS, minorFindings: [minor] } } }),
    })
    const ship = callNamed(run, 'ship')!.prompt

    expect(ship).toContain('## QA')
    expect(ship).toContain(REPORT)
    expect(ship).toContain('Save button label wraps at 390px')
    expect(callNamed(run, 'done-gate')!.prompt).toContain(REPORT)
  })

  it('re-keys the QA prompt when a qaResolutionNote is supplied', async () => {
    const NOTE = 'The human confirmed the staff Delete button is intended for managers only; fixed in abc1234.'
    const plain = await runWorkflow(script, { args: BASE_ARGS, onAgent: responder() })
    const noted = await runWorkflow(script, { args: { ...BASE_ARGS, qaResolutionNote: NOTE }, onAgent: responder() })

    expect(callNamed(plain, 'qa')!.prompt).not.toContain(NOTE)
    expect(callNamed(noted, 'qa')!.prompt).toContain(NOTE)
  })

  it('checks the token ceiling before the QA agent runs', async () => {
    const run = await runWorkflow(script, {
      args: { ...BASE_ARGS, tokenCeiling: 300_000 },
      onAgent: responder({ verify: { result: { status: 'completed', allPass: true }, tokens: 400_000 } }),
    })

    expect(run.result.stopped).toBe(true)
    expect(run.result.phase).toBe('QA')
    expect(run.result.reason).toContain('Token ceiling reached')
    expect(labelsOf(run)).not.toContain('qa')
  })
})
