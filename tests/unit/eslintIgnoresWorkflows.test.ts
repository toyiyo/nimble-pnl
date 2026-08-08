import { describe, it, expect, beforeAll } from 'vitest';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { ESLint } from 'eslint';

/**
 * Workflow scripts under `.claude/workflows/` run inside an async wrapper
 * supplied by the Workflow tool, so they legally combine a top-level `return`
 * (the runtime's early-halt contract) with a top-level `export const meta`.
 * No single ESLint/Node parse mode accepts both, so `eslint .` reported a
 * permanent `Parsing error: 'return' outside of function` for every one of
 * them — phantom `major` items in `dev-tools/review_queue.json`, since
 * `dev-tools/ingest-feedback.js` maps ESLint severity 2 to `major`.
 *
 * These files match zero rules in `eslint.config.js` (verified with
 * `eslint --print-config`), so ignoring them loses no coverage. This test
 * pins that the ignore stays in place — and, just as importantly, that it
 * never widens far enough to silence the app itself.
 */
describe('ESLint ignores .claude/workflows', () => {
  const repoRoot = path.resolve(__dirname, '../..');
  const workflowDir = path.join(repoRoot, '.claude/workflows');
  let eslint: ESLint;
  let scripts: string[];

  beforeAll(() => {
    eslint = new ESLint({ cwd: repoRoot });
    scripts = readdirSync(workflowDir)
      .filter((f) => f.endsWith('.js'))
      .map((f) => path.join(workflowDir, f));
  });

  it('finds at least one workflow script to guard', () => {
    expect(scripts.length).toBeGreaterThan(0);
  });

  it('reports every workflow script as ignored', async () => {
    const ignored = await Promise.all(
      scripts.map(async (file) => [file, await eslint.isPathIgnored(file)] as const),
    );
    expect(ignored.filter(([, isIgnored]) => !isIgnored)).toEqual([]);
  });

  it('enumerates no files in the workflow directory, so `eslint .` stays clean', async () => {
    // `errorOnUnmatchedPattern: false` mirrors what `eslint .` does with a
    // fully-ignored subtree: skip it silently. Without it ESLint throws
    // "All files matched by ... are ignored" for an explicitly-named path.
    const tolerant = new ESLint({ cwd: repoRoot, errorOnUnmatchedPattern: false });
    const results = await tolerant.lintFiles([workflowDir]);
    const messages = results.flatMap((r) =>
      r.messages.map((m) => `${path.basename(r.filePath)}:${m.line} ${m.message}`),
    );
    expect(messages).toEqual([]);
    expect(results).toEqual([]);
  });

  it('still lints application source (the ignore must stay narrow)', async () => {
    await expect(eslint.isPathIgnored(path.join(repoRoot, 'src/main.tsx'))).resolves.toBe(false);

    const config = (await eslint.calculateConfigForFile(
      path.join(repoRoot, 'src/main.tsx'),
    )) as { rules?: Record<string, unknown> };
    expect(Object.keys(config.rules ?? {})).toContain('react-hooks/rules-of-hooks');
    expect(Object.keys(config.rules ?? {})).toContain('no-restricted-syntax');
  });
});
