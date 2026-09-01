#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const event = process.argv[2];
const input = await readInput();

if (event === 'pre-tool') {
  const command = input?.tool_input?.command;
  if (input?.tool_name === 'Bash' && typeof command === 'string') {
    const reason = deniedCommandReason(command);
    if (reason) {
      write({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: reason,
        },
      });
      process.exit(0);
    }
  }
  write({});
  process.exit(0);
}

if (event === 'stop') {
  const statePath = findStatePath();
  if (!statePath || !existsSync(statePath)) {
    write({});
    process.exit(0);
  }

  let state;
  try {
    state = JSON.parse(readFileSync(statePath, 'utf8'));
  } catch {
    state = { status: 'active', currentPhase: 'unknown' };
  }
  if (['ready_for_merge', 'needs_human', 'failed'].includes(state.status)) {
    write({});
    process.exit(0);
  }

  if (!input?.stop_hook_active) {
    write({
      decision: 'block',
      reason: `The $dev workflow is incomplete at ${state.currentPhase ?? 'an unknown phase'}. Run the orchestrator status command, then complete or halt the active phase.`,
    });
  } else {
    write({
      systemMessage: 'The $dev workflow is still incomplete after one continuation. Report the active phase and blocker accurately.',
      suppressOutput: true,
    });
  }
  process.exit(0);
}

write({});

function deniedCommandReason(command) {
  const normalized = command.replace(/\\\s*\n/g, ' ');
  const gitCommands = normalized.matchAll(/\bgit\b([^;&|\n]*)/g);
  const protectedCommands = ['add', 'stage', 'commit', 'reset', 'clean', 'checkout', 'restore'];
  for (const match of gitCommands) {
    const tokens = tokenize(match[1]);
    const commandIndex = gitSubcommandIndex(tokens);
    if (commandIndex < 0 || !protectedCommands.includes(tokens[commandIndex])) continue;
    const subcommand = tokens[commandIndex];
    const args = tokens.slice(commandIndex + 1);

    if (['add', 'stage'].includes(subcommand) && args.some((arg) => ['-A', '--all', '-u', '--update', '.', ':/'].includes(arg)
      || arg.startsWith(':(top)')
      || /[*?\[]/.test(arg))) {
      return 'Broad Git staging is blocked. Stage explicit paths.';
    }
    if (subcommand === 'commit' && args.some((arg) => ['-a', '--all'].includes(arg))) {
      return 'git commit -a is blocked. Stage explicit paths first.';
    }
    if (subcommand === 'reset' && args.includes('--hard')) {
      return 'git reset --hard is blocked by repository policy.';
    }
    if (subcommand === 'clean' && args.some((arg) => arg === '--force' || /^-[^-]*f/.test(arg))) {
      return 'git clean with force is blocked by repository policy.';
    }
    if (subcommand === 'checkout') {
      return 'git checkout is blocked because it can discard user changes. Use git switch for branches.';
    }
    if (subcommand === 'restore') {
      return 'git restore is blocked because it can discard user changes.';
    }
  }
  return null;
}

function gitSubcommandIndex(tokens) {
  const optionsWithValues = new Set([
    '-c',
    '-C',
    '--config-env',
    '--git-dir',
    '--namespace',
    '--work-tree',
  ]);
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (optionsWithValues.has(token)) {
      index += 1;
      continue;
    }
    if (token.startsWith('-')) continue;
    return index;
  }
  return -1;
}

function tokenize(command) {
  return (command.match(/"(?:\\.|[^"])*"|'[^']*'|[^\s]+/g) ?? [])
    .map((token) => token
      .replace(/^["'$()]+/, '')
      .replace(/["'$()]+$/, ''));
}

async function readInput() {
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function write(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function findRepositoryRoot() {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return process.cwd();
  }
}

function findStatePath() {
  const root = findRepositoryRoot();
  try {
    const gitPath = execFileSync('git', ['rev-parse', '--git-path', 'codex-dev/state.json'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return path.resolve(root, gitPath);
  } catch {
    return null;
  }
}
