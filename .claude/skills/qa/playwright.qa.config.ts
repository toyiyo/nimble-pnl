/**
 * Playwright config for the QA skill's scratch specs (.claude/skills/qa/SKILL.md).
 *
 * It reuses the main config — the per-checkout port, the webServer, and the
 * base URL — and changes only where specs and output live. The scratch specs sit
 * in the gitignored dev-tools/qa/scratch/, outside the main testDir, so
 * `npm run test:e2e` never runs them.
 *
 * Run from the repo root:
 *   npx playwright test --config .claude/skills/qa/playwright.qa.config.ts --reporter=line
 */
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import base from '../../../playwright.config';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const qaDir = resolve(repoRoot, 'dev-tools/qa');

export default defineConfig({
  ...base,
  testDir: resolve(qaDir, 'scratch'),
  testMatch: ['**/*.spec.ts'],
  outputDir: resolve(qaDir, 'test-results'),
  // QA runs each row once and reads every failure; a retry hides a real bug.
  retries: 0,
  reporter: 'line',
  use: {
    ...base.use,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  // The main projects match only **/unit/** and **/e2e/**, which the scratch folder is not.
  projects: [{ name: 'qa', use: { ...devices['Desktop Chrome'] }, timeout: 90000 }],
  // webServer's cwd defaults to this config's folder; the dev server must start from the repo root.
  webServer: Array.isArray(base.webServer) || !base.webServer ? base.webServer : { ...base.webServer, cwd: repoRoot },
});
