import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const skillRoot = path.join(repoRoot, '.agents/skills/dev');
const orchestratorPath = path.join(skillRoot, 'scripts/orchestrate.mjs');
const hookPath = path.join(skillRoot, 'scripts/hook.mjs');

const {
  PHASES,
  REQUIRED_CHECKS,
  REQUIRED_REVIEWERS,
  advancePhase,
  applyEvidence,
  createInitialState,
  environmentForCheck,
  isLocalSupabaseUrl,
  restartVerification,
  runBufferedCommand,
  validateEvidenceArtifacts,
  validateCompletion,
} = await import(orchestratorPath);

test('skill metadata exposes the repository workflow as $dev', () => {
  const skill = readFileSync(path.join(skillRoot, 'SKILL.md'), 'utf8');
  const agent = readFileSync(path.join(skillRoot, 'agents/openai.yaml'), 'utf8');
  const workflow = readFileSync(path.join(skillRoot, 'references/workflow.md'), 'utf8');

  assert.match(skill, /^---\nname: dev\n/m);
  assert.match(skill, /description: Use when /);
  assert.match(skill, /scripts\/orchestrate\.mjs init/);
  assert.doesNotMatch(skill, /Use `\$(brainstorming|writing-plans|code-simplifier)`/);
  assert.match(
    workflow.replace(/\s+/g, ' '),
    /build`, `ui-review`, `simplify`, `review`, `verify`, `ship`, `ci`, `triage`, and `done`/,
  );
  assert.match(agent, /default_prompt: "Use \$dev /);
});

test('workflow keeps every post-approval gate in strict order', () => {
  assert.deepEqual(PHASES, [
    'build',
    'ui-review',
    'simplify',
    'review',
    'verify',
    'ship',
    'ci',
    'triage',
    'done',
  ]);

  const state = createInitialState({
    branch: 'codex/example',
    worktreePath: '/tmp/example',
    designDocPath: 'docs/example-design.md',
    planPath: 'docs/example-plan.md',
    baseRef: 'origin/main',
    headSha: 'abc123',
  });

  assert.throws(() => advancePhase(state, 'verify'), /expected build/);
  assert.equal(advancePhase(state, 'build').phases.build.status, 'in_progress');
});

test('review cannot complete without every reviewer and fold audit', () => {
  const state = stateAt('review', 'review-sha');
  assert.deepEqual(REQUIRED_REVIEWERS, [
    'security',
    'performance',
    'maintainability',
    'logic',
    'rules',
  ]);

  assert.throws(
    () => validateCompletion(state, 'review', 'review-sha'),
    /missing reviewer evidence: security, performance, maintainability, logic, rules/,
  );

  state.evidence.review.reviewers = Object.fromEntries(
    REQUIRED_REVIEWERS.map((reviewer) => [reviewer, { status: 'clean', artifact: `${reviewer}.json` }]),
  );
  state.evidence.review.fold = { status: 'completed', deferred: [] };
  state.evidence.review.postSnapshot = { status: 'completed', artifact: 'post-snapshot.json' };
  state.evidence.review.codeRabbit = { status: 'unavailable', reason: 'CLI is not installed' };

  assert.doesNotThrow(() => validateCompletion(state, 'review', 'review-sha'));

  state.evidence.review.reviewers.security.artifact = true;
  assert.throws(() => validateCompletion(state, 'review', 'review-sha'), /security/);
});

test('verify requires the full suite on the current revision', () => {
  const state = stateAt('verify', 'verify-sha');
  assert.deepEqual(REQUIRED_CHECKS, [
    'test',
    'test:db',
    'test:e2e',
    'typecheck',
    'lint',
    'build',
  ]);

  state.evidence.verify.checks = Object.fromEntries(
    REQUIRED_CHECKS.map((name) => [name, { status: 'passed', sha: 'old-sha', log: `${name}.log` }]),
  );
  assert.throws(() => validateCompletion(state, 'verify', 'verify-sha'), /current revision/);

  for (const check of Object.values(state.evidence.verify.checks)) check.sha = 'verify-sha';
  state.evidence.verify.e2eCoverage = { status: 'covered', detail: 'tests/e2e/example.spec.ts' };
  assert.doesNotThrow(() => validateCompletion(state, 'verify', 'verify-sha'));
});

test('CI and triage evidence are mandatory before done', () => {
  const ciState = stateAt('ci', 'ship-sha');
  ciState.evidence.ship = { prNumber: 123, sha: 'ship-sha' };
  ciState.evidence.ci = { status: 'passed', sha: 'old-sha', iteration: 1 };
  assert.throws(() => validateCompletion(ciState, 'ci', 'ship-sha'), /current revision/);

  const triageState = stateAt('triage', 'ship-sha');
  triageState.evidence.ship = { prNumber: 123, sha: 'ship-sha' };
  triageState.evidence.ci = { status: 'passed', sha: 'ship-sha', iteration: 1 };
  triageState.evidence.triage = {
    queueFetched: true,
    directApiFetched: false,
    total: 3,
    fixed: 2,
    declinedWithReply: 1,
    artifact: 'triage.json',
  };
  assert.throws(() => validateCompletion(triageState, 'triage', 'ship-sha'), /direct GitHub API/);

  triageState.evidence.triage.directApiFetched = true;
  assert.throws(() => validateCompletion(triageState, 'triage', 'ship-sha'), /current revision/);

  triageState.evidence.triage.sha = 'ship-sha';
  assert.doesNotThrow(() => validateCompletion(triageState, 'triage', 'ship-sha'));
});

test('a post-CI or triage commit restarts verification on the new revision', () => {
  const state = stateAt('triage', 'old-sha');
  state.phases.verify.sha = 'old-sha';
  state.evidence.verify = {
    attempt: 1,
    checks: Object.fromEntries(
      REQUIRED_CHECKS.map((name) => [name, { status: 'passed', sha: 'old-sha' }]),
    ),
  };
  state.evidence.ship = { prNumber: 123, sha: 'old-sha' };
  state.evidence.ci = { status: 'passed', sha: 'old-sha', iteration: 1 };

  restartVerification(state, 'new-sha');

  assert.equal(state.currentPhase, 'verify');
  assert.equal(state.phases.verify.status, 'in_progress');
  assert.equal(state.phases.ship.status, 'pending');
  assert.equal(state.phases.ci.status, 'pending');
  assert.equal(state.phases.triage.status, 'pending');
  assert.deepEqual(state.evidence.verify, { attempt: 0, checks: {} });
  assert.deepEqual(state.evidence.ci, {});
  assert.throws(() => restartVerification(state, 'newer-sha'), /CI or triage/);
});

test('evidence is phase-scoped, revision-scoped, and counts CI attempts', () => {
  const buildState = stateAt('build', 'build-sha');
  assert.throws(
    () => applyEvidence(buildState, 'ci', { status: 'passed', sha: 'build-sha' }, 'build-sha'),
    /active phase build/,
  );

  const triageState = stateAt('triage', 'current-sha');
  assert.throws(
    () => applyEvidence(triageState, 'triage', {
      queueFetched: true,
      directApiFetched: true,
      total: 0,
      fixed: 0,
      declinedWithReply: 0,
      artifact: 'triage.json',
      sha: 'old-sha',
    }, 'current-sha'),
    /current revision/,
  );

  const ciState = stateAt('ci', 'ci-sha');
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    applyEvidence(ciState, 'ci', { status: 'failed', sha: 'ci-sha' }, 'ci-sha');
    assert.equal(ciState.evidence.ci.iteration, attempt);
  }
  assert.throws(
    () => applyEvidence(ciState, 'ci', { status: 'failed', sha: 'ci-sha' }, 'ci-sha'),
    /five-attempt limit/,
  );

  const temp = mkdtempSync(path.join(tmpdir(), 'codex-dev-triage-'));
  try {
    writeFileSync(path.join(temp, 'triage.json'), JSON.stringify({ sha: 'old-sha' }));
    assert.throws(
      () => validateEvidenceArtifacts(temp, 'triage', {
        artifact: 'triage.json',
        sha: 'current-sha',
      }, 'current-sha'),
      /artifact is not from the current revision/,
    );

    writeFileSync(path.join(temp, 'triage.json'), JSON.stringify({ sha: 'current-sha' }));
    assert.doesNotThrow(() => validateEvidenceArtifacts(temp, 'triage', {
      artifact: 'triage.json',
      sha: 'current-sha',
    }, 'current-sha'));
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test('init creates resumable state in a real feature worktree', () => {
  const temp = mkdtempSync(path.join(tmpdir(), 'codex-dev-init-'));
  try {
    execFileSync('git', ['init', '-q'], { cwd: temp });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: temp });
    execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: temp });
    mkdirSync(path.join(temp, 'docs'), { recursive: true });
    mkdirSync(path.join(temp, 'node_modules/.bin'), { recursive: true });
    mkdirSync(path.join(temp, 'bin'), { recursive: true });
    writeFileSync(path.join(temp, 'docs/design.md'), '# Design\n');
    writeFileSync(path.join(temp, 'docs/plan.md'), '# Plan\n');
    writeFileSync(path.join(temp, '.gitignore'), 'node_modules\nbin\n*.local\nprogress.md\n');
    writeFileSync(path.join(temp, '.env.local'), 'VITE_SUPABASE_URL=http://127.0.0.1:54321\n');
    writeFileSync(path.join(temp, 'node_modules/.bin/vite'), '#!/bin/sh\nexit 0\n');
    writeFileSync(path.join(temp, 'bin/gh'), '#!/bin/sh\necho gh version test\n');
    chmodSync(path.join(temp, 'node_modules/.bin/vite'), 0o755);
    chmodSync(path.join(temp, 'bin/gh'), 0o755);
    execFileSync('git', ['add', 'docs/design.md', 'docs/plan.md', '.gitignore'], { cwd: temp });
    execFileSync('git', ['commit', '-qm', 'docs: add plan'], { cwd: temp });
    execFileSync('git', ['checkout', '-qb', 'codex/example'], { cwd: temp });

    const env = { ...process.env, PATH: `${path.join(temp, 'bin')}:${process.env.PATH}` };
    execFileSync('node', [
      orchestratorPath,
      'init',
      '--worktree', temp,
      '--branch', 'codex/example',
      '--design', 'docs/design.md',
      '--plan', 'docs/plan.md',
    ], { cwd: temp, env });

    const state = JSON.parse(execFileSync('node', [orchestratorPath, 'status', '--json'], {
      cwd: temp,
      encoding: 'utf8',
      env,
    }));
    assert.equal(state.currentPhase, 'build');
    assert.equal(state.context.branch, 'codex/example');
    assert.match(readFileSync(path.join(temp, 'progress.md'), 'utf8'), /## Status: Active/);

    writeFileSync(path.join(temp, '.env.local'), [
      'VITE_SUPABASE_URL=http://127.0.0.1:54321',
      'export VITE_SUPABASE_URL=https://production.example.com',
      '',
    ].join('\n'));
    const duplicateEnv = spawnSync('node', [orchestratorPath, 'check-ready'], {
      cwd: temp,
      encoding: 'utf8',
      env,
    });
    assert.notEqual(duplicateEnv.status, 0);
    assert.match(duplicateEnv.stderr, /exactly one VITE_SUPABASE_URL/);

    execFileSync('git', ['checkout', '-qb', 'codex/other'], { cwd: temp });
    const wrongBranch = spawnSync('node', [orchestratorPath, 'status', '--json'], {
      cwd: temp,
      encoding: 'utf8',
      env,
    });
    assert.notEqual(wrongBranch.status, 0);
    assert.match(wrongBranch.stderr, /belongs to branch codex\/example/);

    execFileSync('git', ['checkout', '-q', 'codex/example'], { cwd: temp });
    const statePath = path.join(temp, '.git/codex-dev/state.json');
    const wrongWorktreeState = JSON.parse(readFileSync(statePath, 'utf8'));
    mkdirSync(path.join(temp, 'other-worktree'));
    wrongWorktreeState.context.worktreePath = path.join(temp, 'other-worktree');
    writeFileSync(statePath, JSON.stringify(wrongWorktreeState));
    const wrongWorktree = spawnSync('node', [orchestratorPath, 'status', '--json'], {
      cwd: temp,
      encoding: 'utf8',
      env,
    });
    assert.notEqual(wrongWorktree.status, 0);
    assert.match(wrongWorktree.stderr, /belongs to worktree/);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test('local Supabase validation parses the complete URL', () => {
  for (const url of [
    'http://localhost:54321',
    'http://127.0.0.1:54321',
  ]) {
    assert.equal(isLocalSupabaseUrl(url), true, url);
  }

  for (const url of [
    'http://localhost:54321@prod.example.com',
    'http://user:password@localhost:54321',
    'https://localhost:54321',
    'http://localhost:54322',
    'http://prod.example.com:54321',
  ]) {
    assert.equal(isLocalSupabaseUrl(url), false, url);
  }
});

test('E2E checks override inherited Supabase URLs with the validated local URL', () => {
  const baseEnv = {
    KEEP_ME: 'yes',
    SUPABASE_URL: 'https://production.example.com',
    VITE_SUPABASE_URL: 'https://production.example.com',
  };
  const localUrl = 'http://127.0.0.1:54321';
  const e2eEnv = environmentForCheck('test:e2e', localUrl, baseEnv);

  assert.notEqual(e2eEnv, baseEnv);
  assert.equal(e2eEnv.KEEP_ME, 'yes');
  assert.equal(e2eEnv.SUPABASE_URL, localUrl);
  assert.equal(e2eEnv.VITE_SUPABASE_URL, localUrl);
  assert.equal(environmentForCheck('test', localUrl, baseEnv), baseEnv);
});

test('verification refuses to attribute a dirty worktree to HEAD', () => {
  const temp = mkdtempSync(path.join(tmpdir(), 'codex-dev-verify-'));
  try {
    execFileSync('git', ['init', '-q'], { cwd: temp });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: temp });
    execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: temp });
    mkdirSync(path.join(temp, 'bin'));
    writeFileSync(path.join(temp, '.gitignore'), 'bin\nmarker\n');
    writeFileSync(path.join(temp, 'tracked.txt'), 'tracked\n');
    writeFileSync(path.join(temp, 'bin/npm'), '#!/bin/sh\ntouch "$MARKER"\nexit 0\n');
    chmodSync(path.join(temp, 'bin/npm'), 0o755);
    execFileSync('git', ['add', '.gitignore', 'tracked.txt'], { cwd: temp });
    execFileSync('git', ['commit', '-qm', 'test fixture'], { cwd: temp });
    execFileSync('git', ['checkout', '-qb', 'codex/example'], { cwd: temp });

    const state = stateAt('verify', execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: temp,
      encoding: 'utf8',
    }).trim());
    state.context.branch = 'codex/example';
    state.context.worktreePath = temp;
    mkdirSync(path.join(temp, '.git/codex-dev'), { recursive: true });
    writeFileSync(path.join(temp, '.git/codex-dev/state.json'), JSON.stringify(state));
    writeFileSync(path.join(temp, 'dirty.txt'), 'not committed\n');

    const marker = path.join(temp, 'marker');
    const result = spawnSync('node', [orchestratorPath, 'verify'], {
      cwd: temp,
      encoding: 'utf8',
      env: { ...process.env, PATH: `${path.join(temp, 'bin')}:${process.env.PATH}`, MARKER: marker },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Worktree must be clean before this gate/);
    assert.equal(existsSync(marker), false);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test('verification command capture handles large output and launch errors', () => {
  const large = runBufferedCommand(process.execPath, [
    '-e',
    "process.stdout.write('x'.repeat(2 * 1024 * 1024))",
  ], { cwd: repoRoot, env: process.env });
  assert.equal(large.failure, null);
  assert.equal(large.result.status, 0);
  assert.equal(large.output.length, 2 * 1024 * 1024);

  const missing = runBufferedCommand('codex-command-that-does-not-exist', [], {
    cwd: repoRoot,
    env: process.env,
  });
  assert.match(missing.failure, /ENOENT/);
  assert.match(missing.output, /ENOENT/);
});

test('verification dry-run prints every mandatory command without executing it', () => {
  const output = execFileSync('node', [orchestratorPath, 'verify', '--dry-run'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  for (const command of [
    'npm run test',
    'npm run test:db',
    'npm run test:e2e',
    'npm run typecheck',
    'npm run lint',
    'npm run build',
  ]) {
    assert.match(output, new RegExp(command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('pre-tool hook rejects broad staging and permits explicit staging', () => {
  for (const command of [
    'git add -A',
    'git add -- .',
    'git add -u',
    'git add --update; git status',
    'git -c core.quotePath=false add .',
    'echo "$(git add .)"',
    'git add *',
    "git add '**/*'",
    'git stage -A',
    'git checkout .',
    'git checkout -- src/example.ts',
    'git checkout HEAD src/example.ts',
    'git restore src/example.ts',
    'git restore --source HEAD .',
  ]) {
    const denied = runHook('pre-tool', {
      tool_name: 'Bash',
      tool_input: { command },
    });
    assert.equal(denied.hookSpecificOutput.permissionDecision, 'deny', command);
  }

  const allowed = runHook('pre-tool', {
    tool_name: 'Bash',
    tool_input: { command: 'git add src/example.ts tests/example.test.ts' },
  });
  assert.deepEqual(allowed, {});

  const branchSwitch = runHook('pre-tool', {
    tool_name: 'Bash',
    tool_input: { command: 'git switch codex/other' },
  });
  assert.deepEqual(branchSwitch, {});

  const branchNamedCheckout = runHook('pre-tool', {
    tool_name: 'Bash',
    tool_input: { command: 'git switch checkout' },
  });
  assert.deepEqual(branchNamedCheckout, {});
});

test('the repository CI job runs the workflow regression suite', () => {
  const ci = readFileSync(path.join(repoRoot, '.github/workflows/unit-tests.yml'), 'utf8');
  assert.match(ci, /run: npm run test:dev-workflow/);
});

test('stop hook continues an incomplete workflow at most once', () => {
  const temp = mkdtempSync(path.join(tmpdir(), 'codex-dev-hook-'));
  try {
    execFileSync('git', ['init', '-q'], { cwd: temp });
    mkdirSync(path.join(temp, '.git/codex-dev'), { recursive: true });
    writeFileSync(path.join(temp, '.git/codex-dev/state.json'), JSON.stringify({
      status: 'active',
      currentPhase: 'verify',
    }));
    writeFileSync(path.join(temp, 'progress.md'), [
      '# Progress: test',
      '',
      '## Status: Active',
      '',
      '## Current Phase',
      'Phase 8: verify - in-progress',
      '',
    ].join('\n'));

    const first = runHook('stop', { stop_hook_active: false }, temp);
    assert.equal(first.decision, 'block');
    assert.match(first.reason, /workflow is incomplete/i);

    const second = runHook('stop', { stop_hook_active: true }, temp);
    assert.equal(second.decision, undefined);
    assert.match(second.systemMessage, /still incomplete/i);

    mkdirSync(path.join(temp, 'src'));
    const nested = runHook('stop', { stop_hook_active: false }, path.join(temp, 'src'));
    assert.equal(nested.decision, 'block');

    writeFileSync(path.join(temp, 'progress.md'), '## Status: Ready for merge\n');
    const tamperedProgress = runHook('stop', { stop_hook_active: false }, temp);
    assert.equal(tamperedProgress.decision, 'block');

    writeFileSync(path.join(temp, '.git/codex-dev/state.json'), JSON.stringify({
      status: 'ready_for_merge',
      currentPhase: null,
    }));
    const completed = runHook('stop', { stop_hook_active: false }, temp);
    assert.deepEqual(completed, {});
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

function stateAt(phase, headSha) {
  const state = createInitialState({
    branch: 'codex/example',
    worktreePath: '/tmp/example',
    designDocPath: 'docs/example-design.md',
    planPath: 'docs/example-plan.md',
    baseRef: 'origin/main',
    headSha,
  });
  const index = PHASES.indexOf(phase);
  for (let i = 0; i < index; i += 1) state.phases[PHASES[i]].status = 'completed';
  state.phases[phase].status = 'in_progress';
  state.currentPhase = phase;
  return state;
}

function runHook(event, input, cwd = repoRoot) {
  const result = spawnSync('node', [hookPath, event], {
    cwd,
    encoding: 'utf8',
    input: JSON.stringify(input),
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}
