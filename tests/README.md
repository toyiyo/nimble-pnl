# E2E Testing Guide

This project uses Playwright for end-to-end testing with a local Supabase instance.

## Prerequisites

- Node.js 20+
- Supabase CLI installed (`brew install supabase/tap/supabase` or see [Supabase CLI docs](https://supabase.com/docs/guides/cli))
- Docker Desktop running (required for Supabase local)

## Quick Start

### 1. Install Dependencies

```bash
npm install
npx playwright install chromium
```

### 2. Start Local Supabase

```bash
npm run test:supabase:start
```

This will:
- Start PostgreSQL, Auth, Storage, and Edge Functions locally
- Apply all migrations from `supabase/migrations/`
- Output connection details (API URL, keys, etc.)

### 3. Run Tests

In a separate terminal:

```bash
# Run all E2E tests
npm run test:e2e

# Run with UI (interactive mode)
npm run test:e2e:ui

# Run in headed mode (see browser)
npm run test:e2e:headed

# Debug a specific test
npm run test:e2e:debug
```

### 4. Stop Supabase

```bash
npm run test:supabase:stop
```

## Project Structure

```
tests/
├── e2e/                      # E2E test files
│   └── inventory/
│       └── add-product.spec.ts
├── helpers/                  # Test utilities
│   ├── supabase.ts          # Supabase client helpers
│   └── auth.ts              # User/restaurant setup helpers
└── README.md                # This file
```

## Writing Tests

### Test Template

```typescript
import { test, expect } from '@playwright/test';
import { createTestUser, createTestRestaurant, cleanupTestUser } from '../../helpers/auth';
import { getTestSupabaseClient } from '../../helpers/supabase';

test.describe('Feature Name', () => {
  let testUserId: string;
  let testRestaurantId: string;
  const testEmail = `test-${Date.now()}@example.com`;
  const testPassword = 'TestPassword123!';

  test.beforeAll(async () => {
    const user = await createTestUser(testEmail, testPassword, 'Test User');
    testUserId = user.id;
    testRestaurantId = await createTestRestaurant(testUserId, 'Test Restaurant');
  });

  test.afterAll(async () => {
    await cleanupTestUser(testUserId);
  });

  test('should do something', async ({ page }) => {
    // Login
    await page.goto('/auth');
    await page.fill('input[type="email"]', testEmail);
    await page.fill('input[type="password"]', testPassword);
    await page.click('button[type="submit"]:has-text("Sign In")');
    await page.waitForURL('/', { timeout: 10000 });
    
    // Your test steps here
  });
});
```

### Best Practices

1. **Use unique test data** - Always use `Date.now()` for unique emails/names
2. **Clean up after tests** - Use `afterAll` to delete test data
3. **Wait for elements** - Use `waitForSelector`, `waitForURL`, etc.
4. **Verify in database** - Use `getTestSupabaseClient()` to verify data persistence
5. **Test user experience** - Focus on what users actually do, not implementation details

## CI/CD Integration

Tests run automatically on:
- Push to `main` or `develop` branches
- Pull requests to `main` or `develop`
- Manual workflow dispatch

See `.github/workflows/e2e-tests.yml` for configuration.

## Troubleshooting

### Supabase won't start
- Ensure Docker Desktop is running
- Try: `supabase stop && supabase start`

### Tests failing locally but passing in CI
- Check your local Supabase is using latest migrations: `npm run test:supabase:reset`

### Tests are flaky
- Increase timeouts for slow operations
- Add explicit waits: `await page.waitForLoadState('networkidle')`
- Use `waitForSelector` instead of `waitForTimeout`

### Can't see what's happening
- Run in headed mode: `npm run test:e2e:headed`
- Use debug mode: `npm run test:e2e:debug`
- Check videos in `test-results/` folder

## Environment Variables

When running locally, the following are set automatically by the helpers:

- `SUPABASE_URL` - Local Supabase URL (http://localhost:54321)
- `SUPABASE_ANON_KEY` - Extracted from `supabase status`
- `SUPABASE_SERVICE_ROLE_KEY` - Extracted from `supabase status`

In CI, these are set by the GitHub Actions workflow.

## Resources

- [Playwright Documentation](https://playwright.dev)
- [Supabase CLI Documentation](https://supabase.com/docs/guides/cli)
- [Supabase Local Development](https://supabase.com/docs/guides/cli/local-development)
