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
 *
 * The range has to be wide, not merely "not 4173". A hash is a birthday problem: with ~20 active
 * worktrees, a 400-port span collides ~38% of the time, which would quietly reinstate exactly the
 * cross-branch contamination this is meant to remove. 20k ports drops that to ~1%. Bounds are
 * chosen to dodge both the privileged range and the OS ephemeral range that bind() hands out on
 * its own (macOS 49152+, Linux 32768+) — a derived port must never land on one of those.
 * Collision is now rare rather than routine; it is not impossible, so E2E_PORT stays the escape
 * hatch if two checkouts ever do land together.
 */
const configDir = dirname(fileURLToPath(import.meta.url));
const derivedPort = 10000 + (Array.from(configDir).reduce((h, c) => (h * 33 + c.charCodeAt(0)) >>> 0, 5381) % 20000);
const PORT = Number(process.env.E2E_PORT) || (process.env.CI ? 4173 : derivedPort);
// Match the webServer's `--host 127.0.0.1` bind exactly. If this said `localhost`, a host that
// resolves `localhost` to IPv6 `::1` first would have Playwright dial `::1` while Vite listens
// only on IPv4 — intermittent connection failures that look like server-startup flake.
const BASE_URL = `http://127.0.0.1:${PORT}`;

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
