import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

/**
 * See https://playwright.dev/docs/test-configuration.
 */

/**
 * Give every checkout its own dev-server port.
 *
 * `reuseExistingServer` is on locally, and Playwright's only test for "is a server already
 * running?" is whether the URL answers. With a hardcoded port, a run started in worktree A
 * silently adopts whatever server is already listening — typically worktree B's, serving a
 * different branch against a different Supabase. Tests then pass or fail for reasons that have
 * nothing to do with the code under test, and the result changes depending on which worktree
 * happened to have a server up. (This repo keeps ~20 worktrees under `.claude/worktrees/`, so
 * the collision is the normal case, not the edge case.)
 *
 * Deriving the port from the checkout's own path means "reuse" can only ever reuse *our* server.
 * Set E2E_PORT to override. CI keeps the fixed port: one checkout, and it never reuses anyway.
 */
const configDir = dirname(fileURLToPath(import.meta.url));
const derivedPort = 4200 + (Array.from(configDir).reduce((h, c) => (h * 33 + c.charCodeAt(0)) >>> 0, 5381) % 400);
const PORT = Number(process.env.E2E_PORT) || (process.env.CI ? 4173 : derivedPort);
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './tests',
  testMatch: ['**/*.spec.ts'],
  fullyParallel: true, // Enable parallel execution - tests use unique timestamps for isolation
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // Allow overriding worker count via PLAYWRIGHT_WORKERS; increase to 4 in CI for faster execution
  workers: process.env.PLAYWRIGHT_WORKERS
    ? Number(process.env.PLAYWRIGHT_WORKERS)
    : process.env.CI
      ? 4
      : 2,
  reporter: process.env.CI ? 'blob' : 'html',
  
  use: {
    baseURL: BASE_URL, // Vite dev server (non-default port to avoid sandbox restrictions)
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    {
      name: 'unit',
      testMatch: ['**/unit/**/*.spec.ts'],
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'e2e',
      testMatch: ['**/e2e/**/*.spec.ts'],
      use: { ...devices['Desktop Chrome'] },
      timeout: 90000, // 90 seconds for e2e tests (optimized)
    },
  ],

  webServer: {
    command: `npm run dev -- --host 127.0.0.1 --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 90000, // 90 seconds for server startup
  },
});
