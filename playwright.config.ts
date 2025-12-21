import { defineConfig, devices } from '@playwright/test';

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: './tests',
  testMatch: ['**/*.spec.ts'],
  fullyParallel: true, // Enable parallel execution - tests use unique timestamps for isolation
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // Allow overriding worker count via PLAYWRIGHT_WORKERS; default to 10 locally and 2 in CI for safety
  workers: process.env.PLAYWRIGHT_WORKERS
    ? Number(process.env.PLAYWRIGHT_WORKERS)
    : process.env.CI
      ? 2
      : 10,
  reporter: 'html',
  
  use: {
    baseURL: 'http://localhost:8080', // Vite dev server (override port to avoid sandbox restrictions)
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
      timeout: 300000, // 5 minutes for complex e2e tests
    },
  ],

  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4173',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 180000, // Increased to 3 minutes for CI
  },
});
