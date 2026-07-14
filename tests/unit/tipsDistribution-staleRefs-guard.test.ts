/**
 * Tips "Distribution" tab — stale-reference regression guard.
 *
 * Phase 4 task 4 of the Tips Distribution View plan: the manager-facing
 * "History" tab (with its broken "locked periods" placeholder copy) was
 * renamed/replaced by the "Distribution" tab (see src/pages/Tips.tsx and
 * tests/unit/Tips.distributionTab.test.tsx for the behavioral coverage).
 *
 * These tests read the relevant source/spec files as raw strings and assert
 * that no dangling references to the removed tab survive:
 *   - the literal ViewMode value `'history'`
 *   - the label/copy `"Tip History"` (case-insensitive)
 *   - the placeholder copy `"Locked periods"` (case-insensitive)
 *   - an E2E assertion that still expects a "History" tab button on the
 *     Tips page
 *
 * They will FAIL immediately if a future edit reintroduces any of these.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const repoRoot = path.resolve(__dirname, '../..');

function read(relPath: string): string {
  return fs.readFileSync(path.join(repoRoot, relPath), 'utf-8');
}

describe('Tips Distribution tab guard: no residual "History"/"Locked periods" references', () => {
  it('src/pages/Tips.tsx has no history-tab ViewMode literal', () => {
    const src = read('src/pages/Tips.tsx');
    // The ViewMode union and switch statements must not reintroduce the old
    // 'history' mode value (as a quoted string literal).
    expect(src).not.toMatch(/['"]history['"]/i);
  });

  it('src/pages/Tips.tsx has no "Tip History" or "Locked periods" copy', () => {
    const src = read('src/pages/Tips.tsx');
    expect(src).not.toMatch(/tip history/i);
    expect(src).not.toMatch(/locked periods/i);
  });

  const e2eTipsSpecs = [
    'tests/e2e/tips-flow.spec.ts',
    'tests/e2e/tips-complete-flow.spec.ts',
    'tests/e2e/tip-sharing.spec.ts',
    'tests/e2e/tip-double-counting-prevention.spec.ts',
    'tests/e2e/tip-split-reopen.spec.ts',
    'tests/e2e/tip-payouts.spec.ts',
  ];

  for (const relPath of e2eTipsSpecs) {
    it(`${relPath} does not assert a "History" tab button on the Tips page`, () => {
      const src = read(relPath);
      // Guard against the specific pattern that would break if the tab
      // were ever renamed back / a stale spec still clicked "History".
      expect(src).not.toMatch(/name:\s*['"]History['"]/);
      expect(src).not.toMatch(/name:\s*\/history\/i/);
      expect(src).not.toMatch(/locked periods/i);
    });
  }
});
