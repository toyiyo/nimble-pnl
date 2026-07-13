import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import picomatch from 'picomatch';

// Guards that the new SPLH hooks/lib introduced by this feature stay aligned
// with the vitest and sonar coverage-exclusion configs (which the repo's own
// sonar-project.properties comment says "Must stay aligned with
// vitest.config.ts `coverage.exclude`"). If either config's hook-exclusion
// pattern is ever broadened in a way that accidentally swallows a `.ts` hook,
// this test catches it before coverage silently drops.

const repoRoot = resolve(__dirname, '../..');
const vitestConfigSrc = readFileSync(resolve(repoRoot, 'vitest.config.ts'), 'utf8');
const sonarPropsSrc = readFileSync(resolve(repoRoot, 'sonar-project.properties'), 'utf8');

function parseVitestCoverageExclude(src: string): string[] {
  const match = src.match(/coverage:\s*\{[\s\S]*?exclude:\s*\[([\s\S]*?)\]/);
  if (!match) throw new Error('Could not locate `coverage.exclude` array in vitest.config.ts');
  return match[1]
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, '').trim())
    .filter(Boolean)
    .map((line) => line.replace(/^['"]/, '').replace(/['",]+$/, ''))
    .filter(Boolean);
}

function parseSonarCoverageExclusions(src: string): string[] {
  const key = 'sonar.coverage.exclusions=';
  const startIdx = src.indexOf(key);
  if (startIdx === -1) throw new Error('Could not locate `sonar.coverage.exclusions` in sonar-project.properties');
  const rest = src.slice(startIdx + key.length);
  const patterns: string[] = [];
  for (const rawLine of rest.split('\n')) {
    const trimmed = rawLine.trim();
    const hasContinuation = trimmed.endsWith('\\');
    const withoutBackslash = hasContinuation ? trimmed.slice(0, -1) : trimmed;
    const value = withoutBackslash.replace(/,$/, '').trim();
    if (value) patterns.push(value);
    if (!hasContinuation) break;
  }
  return patterns;
}

const vitestExclude = parseVitestCoverageExclude(vitestConfigSrc);
const sonarExclude = parseSonarCoverageExclusions(sonarPropsSrc);

function matchesAnyPattern(patterns: string[], filePath: string): boolean {
  return patterns.some((pattern) => picomatch(pattern)(filePath));
}

describe('SPLH hooks vs. coverage exclusion configs', () => {
  const splhHookFiles = [
    'src/hooks/useSplhData.ts',
    'src/hooks/useSplhAnalytics.ts',
    'src/hooks/useSplhSummary.ts',
  ];

  it.each(splhHookFiles)('%s is a real, unit-tested source file', (hookFile) => {
    expect(existsSync(resolve(repoRoot, hookFile))).toBe(true);
  });

  it.each(splhHookFiles)('%s has a matching test in tests/unit/', (hookFile) => {
    const baseName = hookFile.split('/').pop()!.replace(/\.ts$/, '');
    const candidates = [
      `tests/unit/${baseName}.test.ts`,
      `tests/unit/${baseName}.test.tsx`,
    ];
    const hasDirectTest = candidates.some((candidate) => existsSync(resolve(repoRoot, candidate)));
    expect(hasDirectTest).toBe(true);
  });

  it.each(splhHookFiles)('%s is not excluded from vitest coverage', (hookFile) => {
    expect(matchesAnyPattern(vitestExclude, hookFile)).toBe(false);
  });

  it.each(splhHookFiles)('%s is not excluded from sonar coverage', (hookFile) => {
    expect(matchesAnyPattern(sonarExclude, hookFile)).toBe(false);
  });

  it('src/lib/splhAnalytics.ts (pure SPLH math) is not excluded from either coverage config', () => {
    expect(matchesAnyPattern(vitestExclude, 'src/lib/splhAnalytics.ts')).toBe(false);
    expect(matchesAnyPattern(sonarExclude, 'src/lib/splhAnalytics.ts')).toBe(false);
  });

  it('both configs still explicitly exclude useWeekStaffingSuggestions.ts (the one intentionally-untested hook)', () => {
    expect(vitestExclude).toContain('src/hooks/useWeekStaffingSuggestions.ts');
    expect(sonarExclude).toContain('src/hooks/useWeekStaffingSuggestions.ts');
  });

  it("sonar's `src/hooks/use*.tsx` pattern matches .tsx hooks but not the new SPLH .ts hooks", () => {
    const tsxPattern = sonarExclude.find((p) => p === 'src/hooks/use*.tsx');
    expect(tsxPattern).toBeDefined();
    const isMatch = picomatch(tsxPattern!);
    expect(isMatch('src/hooks/useEmployees.tsx')).toBe(true);
    for (const hookFile of splhHookFiles) {
      expect(isMatch(hookFile)).toBe(false);
    }
  });
});
