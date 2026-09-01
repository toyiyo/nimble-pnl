#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import {
  accessSync,
  chmodSync,
  constants,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PHASES = [
  'build',
  'ui-review',
  'simplify',
  'review',
  'verify',
  'ship',
  'ci',
  'triage',
  'done',
];

export const REQUIRED_REVIEWERS = [
  'security',
  'performance',
  'maintainability',
  'logic',
  'rules',
];

export const REQUIRED_CHECKS = [
  'test',
  'test:db',
  'test:e2e',
  'typecheck',
  'lint',
  'build',
];

const CHECK_COMMANDS = Object.fromEntries(
  REQUIRED_CHECKS.map((name) => [name, ['npm', ['run', name]]]),
);
const VERIFY_MAX_BUFFER = 64 * 1024 * 1024;
const TERMINAL_PHASE_STATUSES = new Set(['completed']);
const HALT_STATUSES = new Set(['needs_human', 'failed']);
const SECTION_PHASES = {
  build: 'build',
  uiReview: 'ui-review',
  simplify: 'simplify',
  review: 'review',
  ship: 'ship',
  ci: 'ci',
  triage: 'triage',
  done: 'done',
};

export function createInitialState(context) {
  const now = new Date().toISOString();
  return {
    version: 1,
    status: 'active',
    currentPhase: 'build',
    createdAt: now,
    updatedAt: now,
    context: { ...context },
    phases: Object.fromEntries(PHASES.map((phase) => [phase, { status: 'pending' }])),
    evidence: {
      build: { tasks: [] },
      uiReview: {},
      simplify: {},
      review: { reviewers: {} },
      verify: { attempt: 0, checks: {} },
      ship: {},
      ci: {},
      triage: {},
      done: {},
    },
    events: [],
  };
}

export function advancePhase(state, phase) {
  assertKnownPhase(phase);
  const expected = firstIncompletePhase(state);
  if (expected !== phase) {
    throw new Error(`Cannot begin ${phase}; expected ${expected ?? 'no phase'}.`);
  }

  const current = state.phases[phase].status;
  if (current === 'in_progress') return state;
  if (current !== 'pending') throw new Error(`Cannot begin ${phase} from ${current}.`);

  state.phases[phase] = { status: 'in_progress', startedAt: new Date().toISOString() };
  state.currentPhase = phase;
  addEvent(state, 'phase_started', { phase });
  return state;
}

export function restartVerification(state, headSha) {
  if (!['ci', 'triage'].includes(state.currentPhase)) {
    throw new Error('Verification can restart only from an active CI or triage phase.');
  }
  const verifiedSha = state.phases.verify?.sha;
  if (!isNonEmptyString(verifiedSha)) {
    throw new Error('Cannot restart without a previously completed verification phase.');
  }
  if (verifiedSha === headSha) {
    throw new Error('Verification restart requires a new revision.');
  }

  for (const phase of PHASES.slice(PHASES.indexOf('verify'))) {
    state.phases[phase] = { status: 'pending' };
  }
  state.phases.verify = { status: 'in_progress', startedAt: new Date().toISOString() };
  state.evidence.verify = { attempt: 0, checks: {} };
  state.evidence.ship = {};
  state.evidence.ci = {};
  state.evidence.triage = {};
  state.evidence.done = {};
  state.currentPhase = 'verify';
  state.status = 'active';
  state.context.headSha = headSha;
  delete state.reason;
  addEvent(state, 'verification_restarted', { sha: headSha });
  return state;
}

export function applyEvidence(state, section, payload, headSha) {
  const phase = SECTION_PHASES[section];
  if (!phase) throw new Error(`Unknown evidence section: ${section}.`);
  if (state.currentPhase !== phase || state.phases[phase]?.status !== 'in_progress') {
    throw new Error(`Cannot record ${section} evidence during active phase ${state.currentPhase}.`);
  }

  if (['ship', 'ci', 'triage'].includes(section) && payload.sha !== headSha) {
    throw new Error(`${section} evidence is not from the current revision.`);
  }

  if (section === 'ci') {
    if (!['passed', 'failed'].includes(payload.status)) {
      throw new Error('CI evidence status must be passed or failed.');
    }
    const attempt = Number(state.evidence.ci.attemptCount ?? 0) + 1;
    if (attempt > 5) throw new Error('CI exhausted the five-attempt limit.');
    state.evidence.ci = {
      ...state.evidence.ci,
      ...payload,
      iteration: attempt,
      attemptCount: attempt,
    };
  } else {
    state.evidence[section] = { ...state.evidence[section], ...payload };
  }

  addEvent(state, 'evidence_recorded', { section, sha: headSha });
  return state;
}

export function validateCompletion(state, phase, headSha) {
  assertKnownPhase(phase);
  if (state.phases[phase]?.status !== 'in_progress') {
    throw new Error(`Phase ${phase} is not in progress.`);
  }

  const prior = PHASES.slice(0, PHASES.indexOf(phase));
  const incomplete = prior.filter((name) => state.phases[name].status !== 'completed');
  if (incomplete.length) throw new Error(`Prior phases are incomplete: ${incomplete.join(', ')}.`);

  switch (phase) {
    case 'build':
      validateBuild(state.evidence.build);
      break;
    case 'ui-review':
      validateUiReview(state.evidence.uiReview);
      break;
    case 'simplify':
      requireStatus(state.evidence.simplify, 'completed', 'simplify evidence');
      break;
    case 'review':
      validateReview(state.evidence.review);
      break;
    case 'verify':
      validateVerify(state.evidence.verify, headSha);
      break;
    case 'ship':
      validateShip(state.evidence.ship, headSha);
      break;
    case 'ci':
      validateCi(state.evidence.ci, headSha);
      break;
    case 'triage':
      validateTriage(state.evidence.triage, headSha);
      break;
    case 'done':
      validateVerify(state.evidence.verify, headSha);
      validateCi(state.evidence.ci, headSha);
      validateTriage(state.evidence.triage, headSha);
      break;
    default:
      throw new Error(`No completion validator for ${phase}.`);
  }
}

function validateBuild(evidence) {
  if (!Number.isInteger(evidence?.taskCount) || evidence.taskCount < 1) {
    throw new Error('Build evidence needs a positive taskCount.');
  }
  if (!Array.isArray(evidence.tasks) || evidence.tasks.length !== evidence.taskCount) {
    throw new Error('Build evidence task count does not match tasks.');
  }
  const invalid = evidence.tasks.filter(
    (task) => task.status !== 'completed'
      || !isNonEmptyString(task.commit)
      || !isNonEmptyString(task.redEvidence)
      || !isNonEmptyString(task.greenEvidence),
  );
  if (invalid.length) throw new Error('Every build task needs RED, GREEN, and commit evidence.');
}

function validateUiReview(evidence) {
  if (evidence?.status === 'reviewed' && isNonEmptyString(evidence.artifact)) return;
  if (evidence?.status === 'skipped' && isNonEmptyString(evidence.reason)) return;
  throw new Error('UI review needs a review artifact or an explicit skip reason.');
}

function validateReview(evidence) {
  const reviewers = evidence?.reviewers ?? {};
  const missing = REQUIRED_REVIEWERS.filter((reviewer) => {
    const item = reviewers[reviewer];
    return !item || !['clean', 'findings'].includes(item.status) || !isNonEmptyString(item.artifact);
  });
  if (missing.length) throw new Error(`Review is missing reviewer evidence: ${missing.join(', ')}.`);

  requireStatus(evidence.fold, 'completed', 'review fold');
  requireStatus(evidence.postSnapshot, 'completed', 'post-snapshot review');
  if (!Array.isArray(evidence.fold.deferred)) throw new Error('Review fold needs a deferred findings array.');
  if (!isNonEmptyString(evidence.postSnapshot.artifact)) {
    throw new Error('Post-snapshot review needs an artifact.');
  }

  const codeRabbit = evidence.codeRabbit;
  const availableResult = ['clean', 'completed'].includes(codeRabbit?.status);
  const unavailableWithReason = codeRabbit?.status === 'unavailable' && isNonEmptyString(codeRabbit.reason);
  if (!availableResult && !unavailableWithReason) {
    throw new Error('CodeRabbit needs a clean result or an explicit unavailable reason.');
  }
}

function validateVerify(evidence, headSha) {
  const checks = evidence?.checks ?? {};
  const missing = REQUIRED_CHECKS.filter((name) => checks[name]?.status !== 'passed');
  if (missing.length) throw new Error(`Verify is missing passing checks: ${missing.join(', ')}.`);

  const stale = REQUIRED_CHECKS.filter((name) => checks[name].sha !== headSha);
  if (stale.length) throw new Error(`Verify checks are not from the current revision: ${stale.join(', ')}.`);

  const e2e = evidence.e2eCoverage;
  if (!e2e || !['covered', 'exception'].includes(e2e.status) || !isNonEmptyString(e2e.detail)) {
    throw new Error('Verify needs E2E coverage or a justified exception.');
  }
}

function validateShip(evidence, headSha) {
  if (!Number.isInteger(evidence?.prNumber) || evidence.prNumber < 1) {
    throw new Error('Ship evidence needs a pull request number.');
  }
  if (evidence.sha !== headSha) throw new Error('Ship evidence is not from the current revision.');
}

function validateCi(evidence, headSha) {
  if (evidence?.status !== 'passed') throw new Error('CI has not passed.');
  if (evidence.sha !== headSha) throw new Error('CI evidence is not from the current revision.');
  if (!Number.isInteger(evidence.iteration) || evidence.iteration < 1 || evidence.iteration > 5) {
    throw new Error('CI iteration must be between 1 and 5.');
  }
}

function validateTriage(evidence, headSha) {
  if (!evidence?.queueFetched) throw new Error('Triage did not refresh the review queue.');
  if (!evidence.directApiFetched) throw new Error('Triage did not fetch the direct GitHub API comments.');
  for (const key of ['total', 'fixed', 'declinedWithReply']) {
    if (!Number.isInteger(evidence[key]) || evidence[key] < 0) {
      throw new Error(`Triage ${key} must be a non-negative integer.`);
    }
  }
  if (evidence.fixed + evidence.declinedWithReply !== evidence.total) {
    throw new Error('Every triage comment must be fixed or declined with a reply.');
  }
  if (!isNonEmptyString(evidence.artifact)) throw new Error('Triage needs an audit artifact.');
  if (evidence.sha !== headSha) throw new Error('Triage evidence is not from the current revision.');
}

function requireStatus(value, expected, label) {
  if (value?.status !== expected) throw new Error(`${label} must have status ${expected}.`);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function firstIncompletePhase(state) {
  return PHASES.find((phase) => !TERMINAL_PHASE_STATUSES.has(state.phases[phase].status));
}

function assertKnownPhase(phase) {
  if (!PHASES.includes(phase)) throw new Error(`Unknown phase: ${phase}.`);
}

function addEvent(state, type, detail = {}) {
  state.updatedAt = new Date().toISOString();
  state.events.push({ type, at: state.updatedAt, ...detail });
}

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function currentHead(cwd) {
  return git(cwd, ['rev-parse', 'HEAD']);
}

function getStatePath(cwd) {
  const gitPath = git(cwd, ['rev-parse', '--git-path', 'codex-dev/state.json']);
  return path.resolve(cwd, gitPath);
}

function loadState(cwd) {
  const statePath = getStatePath(cwd);
  if (!existsSync(statePath)) throw new Error('No active $dev state. Run init first.');
  const state = JSON.parse(readFileSync(statePath, 'utf8'));
  validateStateContext(cwd, state);
  return { statePath, state };
}

function validateStateContext(cwd, state) {
  const branch = git(cwd, ['branch', '--show-current']);
  const worktree = realpathSync(git(cwd, ['rev-parse', '--show-toplevel']));
  const expectedBranch = state.context?.branch;
  const expectedWorktree = realpathSync(state.context?.worktreePath ?? '');
  if (branch !== expectedBranch) {
    throw new Error(`$dev state belongs to branch ${expectedBranch}; current branch is ${branch || 'detached HEAD'}.`);
  }
  if (worktree !== expectedWorktree) {
    throw new Error(`$dev state belongs to worktree ${expectedWorktree}; current worktree is ${worktree}.`);
  }
}

function saveState(cwd, statePath, state) {
  mkdirSync(path.dirname(statePath), { recursive: true });
  state.updatedAt = new Date().toISOString();
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
  writeProgress(cwd, state);
}

function writeProgress(cwd, state) {
  const status = state.status === 'ready_for_merge' ? 'Ready for merge' : titleCase(state.status);
  const phase = state.currentPhase ?? 'none';
  const lines = [
    `# Progress: ${state.context.branch}`,
    '',
    `## Status: ${status}`,
    '',
    '## Spec',
    `Design: ${state.context.designDocPath}`,
    `Plan: ${state.context.planPath}`,
    '',
    '## Current Phase',
    `${phase}: ${state.phases[phase]?.status ?? state.status}`,
    '',
    '## Phases',
    ...PHASES.map((name) => `- [${state.phases[name].status === 'completed' ? 'x' : ' '}] ${name}: ${state.phases[name].status}`),
    '',
  ];
  if (state.reason) lines.push('## Blocker', state.reason, '');
  writeFileSync(path.join(cwd, 'progress.md'), `${lines.join('\n')}\n`);
}

function titleCase(value) {
  return value.charAt(0).toUpperCase() + value.slice(1).replaceAll('_', ' ');
}

function parseArgs(argv) {
  const result = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (!value.startsWith('--')) {
      result._.push(value);
      continue;
    }
    const key = value.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) result[key] = true;
    else {
      result[key] = next;
      i += 1;
    }
  }
  return result;
}

function resolveInside(worktree, candidate) {
  const resolved = path.resolve(worktree, candidate);
  const relative = path.relative(worktree, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Path must be inside the worktree: ${candidate}.`);
  }
  return resolved;
}

function requireCleanWorktree(cwd) {
  const status = git(cwd, ['status', '--porcelain']);
  if (status) throw new Error(`Worktree must be clean before this gate:\n${status}`);
}

function checkWorktreeReady(cwd) {
  const vite = path.join(cwd, 'node_modules/.bin/vite');
  accessSync(vite, constants.X_OK);
  const envPath = path.join(cwd, '.env.local');
  const env = readFileSync(envPath, 'utf8');
  const assignments = env
    .split(/\r?\n/)
    .filter((line) => /^\s*(?:export\s+)?VITE_SUPABASE_URL\s*=/.test(line));
  if (assignments.length !== 1) {
    throw new Error('.env.local must contain exactly one VITE_SUPABASE_URL assignment.');
  }
  const match = assignments[0].match(/^\s*(?:export\s+)?VITE_SUPABASE_URL\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s#]+))\s*(?:#.*)?$/);
  const supabaseUrl = match?.[1] ?? match?.[2] ?? match?.[3];
  if (!isLocalSupabaseUrl(supabaseUrl)) {
    throw new Error('.env.local does not target local Supabase on port 54321.');
  }
  return supabaseUrl;
}

function printReadiness(cwd) {
  checkWorktreeReady(cwd);
  process.stdout.write('Worktree dependencies and local Supabase URL are ready.\n');
}

export function isLocalSupabaseUrl(value) {
  if (!isNonEmptyString(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'http:'
      && ['localhost', '127.0.0.1'].includes(url.hostname)
      && url.port === '54321'
      && url.username === ''
      && url.password === '';
  } catch {
    return false;
  }
}

export function environmentForCheck(name, localSupabaseUrl, baseEnv = process.env) {
  if (name !== 'test:e2e') return baseEnv;
  return {
    ...baseEnv,
    SUPABASE_URL: localSupabaseUrl,
    VITE_SUPABASE_URL: localSupabaseUrl,
  };
}

function checkDependency(command, required = true) {
  const result = spawnSync(command, ['--version'], { encoding: 'utf8' });
  if (result.status !== 0 && required) throw new Error(`Required command is unavailable: ${command}.`);
  return result.status === 0;
}

function initialize(options) {
  for (const key of ['worktree', 'branch', 'design', 'plan']) {
    if (!options[key]) throw new Error(`init requires --${key}.`);
  }

  const cwd = realpathSync(path.resolve(options.worktree));
  const branch = git(cwd, ['branch', '--show-current']);
  if (branch !== options.branch) throw new Error(`Expected branch ${options.branch}; found ${branch}.`);
  if (['main', 'master'].includes(branch)) throw new Error('The $dev workflow cannot run on the trunk branch.');

  const designPath = resolveInside(cwd, options.design);
  const planPath = resolveInside(cwd, options.plan);
  if (!existsSync(designPath)) throw new Error(`Design does not exist: ${designPath}.`);
  if (!existsSync(planPath)) throw new Error(`Plan does not exist: ${planPath}.`);

  requireCleanWorktree(cwd);
  checkWorktreeReady(cwd);
  checkDependency('git');
  checkDependency('node');
  checkDependency('npm');
  checkDependency('gh');

  const statePath = getStatePath(cwd);
  if (existsSync(statePath)) {
    const existing = JSON.parse(readFileSync(statePath, 'utf8'));
    if (existing.status !== 'ready_for_merge') {
      throw new Error('An active $dev state already exists. Use status or resume.');
    }
  }

  const state = createInitialState({
    branch,
    worktreePath: cwd,
    designDocPath: path.relative(cwd, designPath),
    planPath: path.relative(cwd, planPath),
    baseRef: options.base ?? 'origin/main',
    headSha: currentHead(cwd),
    codeRabbitAvailable: checkDependency('coderabbit', false),
  });
  addEvent(state, 'initialized');
  saveState(cwd, statePath, state);
  process.stdout.write(`Initialized $dev on ${branch}. Next phase: build.\n`);
}

function recordEvidence(cwd, section, file) {
  const sectionAliases = { 'ui-review': 'uiReview' };
  const normalizedSection = sectionAliases[section] ?? section;
  const validSections = ['build', 'uiReview', 'simplify', 'review', 'ship', 'ci', 'triage', 'done'];
  if (!validSections.includes(normalizedSection)) throw new Error(`Unknown evidence section: ${section}.`);
  if (!file) throw new Error('evidence requires --file.');
  const payload = JSON.parse(readFileSync(path.resolve(cwd, file), 'utf8'));
  const { statePath, state } = loadState(cwd);
  const sha = currentHead(cwd);
  validateEvidenceArtifacts(cwd, normalizedSection, payload, sha);
  applyEvidence(state, normalizedSection, payload, sha);
  saveState(cwd, statePath, state);
}

export function validateEvidenceArtifacts(cwd, section, payload, headSha) {
  const artifacts = [];
  if (section === 'uiReview' && payload.status === 'reviewed') artifacts.push(payload.artifact);
  if (section === 'review') {
    for (const reviewer of REQUIRED_REVIEWERS) artifacts.push(payload.reviewers?.[reviewer]?.artifact);
    artifacts.push(payload.postSnapshot?.artifact);
  }
  if (section === 'triage') artifacts.push(payload.artifact);

  for (const artifact of artifacts) {
    if (!isNonEmptyString(artifact) || !existsSync(path.resolve(cwd, artifact))) {
      throw new Error(`Evidence artifact does not exist: ${String(artifact)}.`);
    }
  }

  if (section === 'triage') {
    if (payload.sha !== headSha) throw new Error('Triage evidence is not from the current revision.');
    let audit;
    try {
      audit = JSON.parse(readFileSync(path.resolve(cwd, payload.artifact), 'utf8'));
    } catch {
      throw new Error('Triage artifact must be valid JSON.');
    }
    if (audit.sha !== payload.sha) {
      throw new Error('Triage artifact is not from the current revision.');
    }
  }

  if (section === 'build' && Array.isArray(payload.tasks)) {
    for (const task of payload.tasks) {
      if (!isNonEmptyString(task.commit)) throw new Error('Build task commit must be a string.');
      try {
        git(cwd, ['cat-file', '-e', `${task.commit}^{commit}`]);
      } catch {
        throw new Error(`Build task commit does not exist: ${task.commit}.`);
      }
    }
  }
}

export function runBufferedCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    ...options,
    encoding: 'utf8',
    maxBuffer: VERIFY_MAX_BUFFER,
  });
  const launchError = result.error
    ? `${result.error.code ?? result.error.name}: ${result.error.message}`
    : null;
  const failure = launchError
    ?? (result.status === 0
      ? null
      : result.signal
        ? `terminated by signal ${result.signal}`
        : `exit code ${String(result.status)}`);
  const diagnostic = launchError ? `\n[spawn error] ${launchError}\n` : '';
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}${diagnostic}`;
  return { result, output, failure };
}

function runVerification(cwd, dryRun) {
  if (dryRun) {
    for (const name of REQUIRED_CHECKS) {
      const [command, args] = CHECK_COMMANDS[name];
      process.stdout.write(`${command} ${args.join(' ')}\n`);
    }
    return;
  }

  const { statePath, state } = loadState(cwd);
  if (state.currentPhase !== 'verify' || state.phases.verify.status !== 'in_progress') {
    throw new Error('Begin verify before running the full suite.');
  }
  requireCleanWorktree(cwd);
  const localSupabaseUrl = checkWorktreeReady(cwd);
  const attempt = Number(state.evidence.verify.attempt ?? 0) + 1;
  if (attempt > 5) throw new Error('Verify exhausted the five-attempt limit. Halt with needs_human.');

  const sha = currentHead(cwd);
  const logDir = path.join(path.dirname(statePath), 'logs', `verify-${attempt}`);
  mkdirSync(logDir, { recursive: true });
  state.evidence.verify.attempt = attempt;
  state.evidence.verify.checks = {};

  for (const name of REQUIRED_CHECKS) {
    const [command, args] = CHECK_COMMANDS[name];
    const started = Date.now();
    process.stdout.write(`\n[$dev verify ${attempt}/5] ${command} ${args.join(' ')}\n`);
    const { result, output, failure } = runBufferedCommand(command, args, {
      cwd,
      env: environmentForCheck(name, localSupabaseUrl),
    });
    process.stdout.write(output);
    const log = path.join(logDir, `${name.replaceAll(':', '-')}.log`);
    writeFileSync(log, output);
    state.evidence.verify.checks[name] = {
      status: failure === null ? 'passed' : 'failed',
      sha,
      log,
      durationMs: Date.now() - started,
      exitCode: result.status,
      errorCode: result.error?.code ?? null,
    };
    saveState(cwd, statePath, state);
    if (failure !== null) {
      throw new Error(`${command} ${args.join(' ')} failed (${failure}). See ${log}.`);
    }
  }

  addEvent(state, 'verification_passed', { attempt, sha });
  saveState(cwd, statePath, state);
}

function setE2eCoverage(cwd, status, detail) {
  if (!['covered', 'exception'].includes(status)) {
    throw new Error('e2e --status must be covered or exception.');
  }
  if (!detail) throw new Error('e2e requires --detail.');
  const { statePath, state } = loadState(cwd);
  if (state.currentPhase !== 'verify' || state.phases.verify.status !== 'in_progress') {
    throw new Error(`Cannot record E2E coverage during active phase ${state.currentPhase}.`);
  }
  state.evidence.verify.e2eCoverage = { status, detail };
  addEvent(state, 'e2e_coverage_recorded', { status });
  saveState(cwd, statePath, state);
}

function completePhase(cwd, phase) {
  const { statePath, state } = loadState(cwd);
  const sha = currentHead(cwd);
  const section = phase === 'ui-review' ? 'uiReview' : phase;
  if (SECTION_PHASES[section]) {
    validateEvidenceArtifacts(cwd, section, state.evidence[section], sha);
  }
  validateCompletion(state, phase, sha);

  if (phase === 'done') requireCleanWorktree(cwd);
  state.phases[phase] = {
    ...state.phases[phase],
    status: 'completed',
    completedAt: new Date().toISOString(),
    sha,
  };
  addEvent(state, 'phase_completed', { phase, sha });

  const next = PHASES[PHASES.indexOf(phase) + 1] ?? null;
  state.currentPhase = next;
  if (!next) state.status = 'ready_for_merge';
  saveState(cwd, statePath, state);
  process.stdout.write(next ? `Completed ${phase}. Next phase: ${next}.\n` : 'Workflow is ready for merge.\n');
}

function halt(cwd, status, reason) {
  if (!HALT_STATUSES.has(status)) throw new Error('halt --status must be needs_human or failed.');
  if (!reason) throw new Error('halt requires --reason.');
  const { statePath, state } = loadState(cwd);
  const phase = state.currentPhase;
  state.status = status;
  state.reason = reason;
  state.phases[phase] = { ...state.phases[phase], status, reason };
  addEvent(state, 'halted', { phase, status, reason });
  saveState(cwd, statePath, state);
}

function resume(cwd) {
  const { statePath, state } = loadState(cwd);
  if (!HALT_STATUSES.has(state.status)) throw new Error('The workflow is not halted.');
  const phase = state.currentPhase;
  state.status = 'active';
  delete state.reason;
  state.phases[phase] = { ...state.phases[phase], status: 'in_progress' };
  addEvent(state, 'resumed', { phase });
  saveState(cwd, statePath, state);
}

function recheck(cwd) {
  const { statePath, state } = loadState(cwd);
  restartVerification(state, currentHead(cwd));
  saveState(cwd, statePath, state);
  process.stdout.write('Revision changed after verification. Restarted at verify.\n');
}

function printStatus(cwd, json) {
  const { state } = loadState(cwd);
  if (json) process.stdout.write(`${JSON.stringify(state, null, 2)}\n`);
  else {
    process.stdout.write(`Status: ${state.status}\n`);
    process.stdout.write(`Phase: ${state.currentPhase ?? 'none'}\n`);
    for (const phase of PHASES) process.stdout.write(`- ${phase}: ${state.phases[phase].status}\n`);
  }
}

function showHelp() {
  process.stdout.write(`Usage:
  orchestrate.mjs init --worktree PATH --branch NAME --design PATH --plan PATH
  orchestrate.mjs check-ready
  orchestrate.mjs status [--json]
  orchestrate.mjs begin PHASE
  orchestrate.mjs evidence SECTION --file PATH
  orchestrate.mjs e2e --status covered|exception --detail TEXT
  orchestrate.mjs verify [--dry-run]
  orchestrate.mjs recheck
  orchestrate.mjs complete PHASE
  orchestrate.mjs halt --status needs_human|failed --reason TEXT
  orchestrate.mjs resume
`);
}

async function main() {
  const [command, ...argv] = process.argv.slice(2);
  const options = parseArgs(argv);
  const cwd = process.cwd();

  switch (command) {
    case 'init':
      initialize(options);
      break;
    case 'check-ready':
      printReadiness(cwd);
      break;
    case 'status':
      printStatus(cwd, options.json);
      break;
    case 'begin': {
      const phase = options._[0];
      const { statePath, state } = loadState(cwd);
      advancePhase(state, phase);
      saveState(cwd, statePath, state);
      break;
    }
    case 'evidence':
      recordEvidence(cwd, options._[0], options.file);
      break;
    case 'e2e':
      setE2eCoverage(cwd, options.status, options.detail);
      break;
    case 'verify':
      runVerification(cwd, options.dryRun);
      break;
    case 'recheck':
      recheck(cwd);
      break;
    case 'complete':
      completePhase(cwd, options._[0]);
      break;
    case 'halt':
      halt(cwd, options.status, options.reason);
      break;
    case 'resume':
      resume(cwd);
      break;
    case 'help':
    case '--help':
    case '-h':
    case undefined:
      showHelp();
      break;
    default:
      throw new Error(`Unknown command: ${command}.`);
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    chmodSync(fileURLToPath(import.meta.url), 0o755);
  } catch {
    // The script remains runnable through `node` on read-only filesystems.
  }
  main().catch((error) => {
    process.stderr.write(`$dev: ${error.message}\n`);
    process.exitCode = 1;
  });
}
