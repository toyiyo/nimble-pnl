# Vercel Speed Insights Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Vercel Speed Insights to collect Core Web Vitals from real production web users.

**Architecture:** Add the `@vercel/speed-insights` package. Wrap `<SpeedInsights />` in a small component `SpeedInsightsGate` that renders on the web and returns `null` on native Capacitor builds. Mount the gate once in `src/App.tsx` inside `<BrowserRouter>`.

**Tech Stack:** React 18.3, TypeScript, Vite, React Router 6, `@vercel/speed-insights` v2, `@capacitor/core`, Vitest, `@testing-library/react`.

Design doc: `docs/superpowers/specs/2026-08-09-vercel-speed-insights-design.md`

## Global Constraints

- Write every word of prose in ASD-STE100 Simplified Technical English.
- Use `@vercel/speed-insights` v2. Import from `@vercel/speed-insights/react`.
- Render Speed Insights on the web only. Gate the render with `Capacitor.isNativePlatform()`. Native returns `null`.
- Add no environment flag. A runtime platform check gates the render.
- Add no `@vercel/analytics` (web analytics). PostHog already covers product analytics.
- Keep the file name `tests/unit/appNoVercelAnalytics.test.ts`. Two tests reference it by name.
- Stage explicit paths. Never `git add -A` or `git add .`. Never stage `progress.md`.

---

### Task 1: Add the `@vercel/speed-insights` dependency

**Files:**
- Modify: `package.json` (dependencies)
- Modify: `package-lock.json` (lockfile)

**Interfaces:**
- Consumes: nothing.
- Produces: the module `@vercel/speed-insights/react`, which exports the `SpeedInsights` React component. Task 2 imports it.

- [ ] **Step 1: Install the package**

Run from the worktree root:

```bash
npm install @vercel/speed-insights@^2 --no-audit --no-fund
```

- [ ] **Step 2: Confirm the package resolves**

Run: `npm ls @vercel/speed-insights`
Expected: prints `@vercel/speed-insights@2.x.x` (a 2.x version), no "missing" error.

- [ ] **Step 3: Confirm the react entry point resolves**

Run: `node -e "console.log(require.resolve('@vercel/speed-insights/package.json'))"`
Expected: prints an absolute path under `node_modules/@vercel/speed-insights`.

- [ ] **Step 4: Confirm package.json lists the dependency**

Run: `grep '"@vercel/speed-insights"' package.json`
Expected: prints one line in the `dependencies` block with a `^2` range.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json
git diff --cached --name-only
git commit -m "chore(deps): add @vercel/speed-insights v2"
```

---

### Task 2: Create `SpeedInsightsGate` with a behavior test (TDD)

**Files:**
- Create: `src/components/SpeedInsightsGate.tsx`
- Test: `tests/unit/speedInsightsGate.test.tsx`

**Interfaces:**
- Consumes: `SpeedInsights` from `@vercel/speed-insights/react` (Task 1); `Capacitor` from `@capacitor/core`.
- Produces: `SpeedInsightsGate` — a named export, a component with no props. Renders `<SpeedInsights />` on the web, `null` on native. Task 3 imports it.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/speedInsightsGate.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Capacitor } from '@capacitor/core';
import { SpeedInsightsGate } from '@/components/SpeedInsightsGate';

// Mock the platform check so each test picks web or native.
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: vi.fn() },
}));

// Mock the Vercel component. The real one injects a script tag; the test
// only checks that the gate renders it or skips it.
vi.mock('@vercel/speed-insights/react', () => ({
  SpeedInsights: () => <div data-testid="speed-insights" />,
}));

describe('SpeedInsightsGate', () => {
  beforeEach(() => {
    vi.mocked(Capacitor.isNativePlatform).mockReset();
  });

  it('renders Speed Insights on the web', () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
    render(<SpeedInsightsGate />);
    expect(screen.queryByTestId('speed-insights')).not.toBeNull();
  });

  it('renders nothing on native', () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    render(<SpeedInsightsGate />);
    expect(screen.queryByTestId('speed-insights')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- speedInsightsGate`
Expected: FAIL. The error names a missing module `@/components/SpeedInsightsGate`.

- [ ] **Step 3: Write the minimal component**

Create `src/components/SpeedInsightsGate.tsx`:

```tsx
import { Capacitor } from '@capacitor/core';
import { SpeedInsights } from '@vercel/speed-insights/react';

/**
 * Render Vercel Speed Insights on the web only.
 *
 * Native Capacitor builds serve the app from a local WebView, where the
 * Vercel script `/_vercel/speed-insights/script.js` 404s (BUG-001,
 * docs/superpowers/specs/2026-07-04-script-error-noise-design.md). So skip the
 * beacon on native platforms. See
 * docs/superpowers/specs/2026-08-09-vercel-speed-insights-design.md.
 */
export function SpeedInsightsGate() {
  if (Capacitor.isNativePlatform()) {
    return null;
  }
  return <SpeedInsights />;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -- speedInsightsGate`
Expected: PASS. Both cases green.

- [ ] **Step 5: Commit**

```bash
git add src/components/SpeedInsightsGate.tsx tests/unit/speedInsightsGate.test.tsx
git diff --cached --name-only
git commit -m "feat(speed-insights): add SpeedInsightsGate, web-only beacon"
```

---

### Task 3: Wire the gate into App.tsx and update the guard test

**Files:**
- Modify: `src/App.tsx` (add import; render `<SpeedInsightsGate />` at line 351)
- Modify: `tests/unit/appNoVercelAnalytics.test.ts` (delete the speed-insights assertion; update the comment)

**Interfaces:**
- Consumes: `SpeedInsightsGate` from `@/components/SpeedInsightsGate` (Task 2).
- Produces: nothing for later tasks. This is the last task.

- [ ] **Step 1: Update the guard test first (RED for the change)**

Replace the whole body of `tests/unit/appNoVercelAnalytics.test.ts` with:

```ts
import { readFileSync } from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

/**
 * Regression guard: `src/App.tsx` does not add Vercel Web Analytics
 * (`@vercel/analytics`). PostHog already captures product analytics
 * (pageviews and pageleaves in `src/main.tsx`), so Web Analytics would
 * duplicate it. See
 * docs/superpowers/specs/2026-08-09-vercel-speed-insights-design.md.
 *
 * BUG-001 history: this file once also banned `@vercel/speed-insights`,
 * because the app ran on Lovable, where the Vercel script 404s. Production
 * now deploys to Vercel, so Speed Insights is deliberately reintroduced
 * through `src/components/SpeedInsightsGate.tsx` (web only, off on native
 * Capacitor builds). So the speed-insights ban is gone; the
 * `@vercel/analytics` ban stays. See
 * docs/superpowers/specs/2026-07-04-script-error-noise-design.md.
 */
describe('App.tsx does not import Vercel Web Analytics', () => {
  const appSource = readFileSync(
    path.resolve(__dirname, '../../src/App.tsx'),
    'utf-8'
  );

  it('does not contain the "@vercel/analytics" specifier', () => {
    expect(appSource).not.toContain('@vercel/analytics');
  });
});
```

- [ ] **Step 2: Run the guard test to confirm it still passes**

Run: `npm run test -- appNoVercelAnalytics`
Expected: PASS. One test. `src/App.tsx` does not yet import anything Vercel.

- [ ] **Step 3: Add the import to `src/App.tsx`**

Find the import of `InstallBanner` in `src/App.tsx` (the `@/components/InstallBanner` line). Add this line directly below it:

```tsx
import { SpeedInsightsGate } from '@/components/SpeedInsightsGate';
```

- [ ] **Step 4: Render the gate in `src/App.tsx`**

At `src/App.tsx:351`, change:

```tsx
        <BrowserRouter>
          <InstallBanner />
          <Routes>
```

to:

```tsx
        <BrowserRouter>
          <InstallBanner />
          <SpeedInsightsGate />
          <Routes>
```

- [ ] **Step 5: Run the guard test again**

Run: `npm run test -- appNoVercelAnalytics`
Expected: PASS. `src/App.tsx` imports `@/components/SpeedInsightsGate`, not `@vercel/analytics`, so the ban holds.

- [ ] **Step 6: Typecheck and build**

Run: `npm run typecheck`
Expected: PASS. No type error.

Run: `npm run build`
Expected: PASS. The bundle includes `@vercel/speed-insights`.

- [ ] **Step 7: Commit**

```bash
git add src/App.tsx tests/unit/appNoVercelAnalytics.test.ts
git diff --cached --name-only
git commit -m "feat(speed-insights): mount SpeedInsightsGate in App"
```

---

## Self-Review Notes

- **Spec coverage:** Task 1 adds the package. Task 2 builds the web-only gate plus its behavior test. Task 3 mounts the gate and updates the BUG-001 guard test. The design's "no web analytics" and "no route prop" trade-offs need no task; they are decisions, not code. The Vercel dashboard step is a post-merge operational item; it goes in the PR body, not a task.
- **Type consistency:** `SpeedInsightsGate` — same name in Task 2 (created), Task 3 (imported). No props anywhere.
- **File name:** the guard-test file keeps its name `appNoVercelAnalytics.test.ts`, so the references in `appLaborRoute.test.ts:9` and `App.viewModeWiring.test.ts:9` stay valid.
