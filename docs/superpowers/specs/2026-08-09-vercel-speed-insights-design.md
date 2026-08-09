# Design: Add Vercel Speed Insights

Date: 2026-08-09
Branch: `feature/vercel-speed-insights`

## Goal

Collect Core Web Vitals from real production users. Production now deploys to
Vercel, so Vercel Speed Insights can report field performance data.

## Problem

The app sends no Core Web Vitals data today. `src/App.tsx` has no
`@vercel/speed-insights` import (verified — `grep '@vercel/' src/` returns
nothing). `package.json` has no `@vercel/speed-insights` dependency (verified —
`grep 'vercel' package.json` returns 0 matches). PostHog captures product
analytics only: pageviews (`src/main.tsx:27`) and pageleaves
(`src/main.tsx:28`). Grafana Faro captures frontend errors and traces
(`src/main.tsx:11`). Neither reports Largest Contentful Paint, Cumulative
Layout Shift, or the other Web Vitals that Speed Insights measures.

## Prior art: this reverses part of BUG-001

BUG-001 removed the Vercel analytics packages
(`docs/superpowers/specs/2026-07-04-script-error-noise-design.md:48-58`). The
reason was the host: the app ran on Lovable, where `<Analytics />` and
`<SpeedInsights />` tried to load `/_vercel/insights/script.js`, which 404s off
Vercel (`docs/superpowers/specs/2026-07-04-script-error-noise-design.md:38-41`).
The removal added a regression guard: a source-text test that asserts
`src/App.tsx` imports neither `@vercel/analytics` nor `@vercel/speed-insights`
(`tests/unit/appNoVercelAnalytics.test.ts:22-28`). The BUG-001 author scoped
the guard to the two exact specifiers "so a deliberate future reintroduction
stays legible" (`tests/unit/appNoVercelAnalytics.test.ts:12-14`).

Production now moves to Vercel. The 404 premise no longer holds for Speed
Insights. This design reverses the Speed Insights half of BUG-001 part 1. The
BUG-001 PostHog `before_send` filter (`src/main.tsx:29-30`) and the
mobile-sidebar accessibility fix stay unchanged.

## Hosting decision (user-confirmed 2026-08-09)

Vercel is the sole production host. So Speed Insights renders unconditionally.
No environment flag gates it. An environment flag would add a silent-no-op
risk: a missing flag would disable the feature with no error.

## Approved design

### 1. Add the dependency

Add `@vercel/speed-insights` (v2) to `dependencies` in `package.json`. Run
`npm install` in the worktree.

### 2. Wire the component in `src/App.tsx`

Add the import:

```tsx
import { SpeedInsights } from '@vercel/speed-insights/react';
```

The `/react` entry point is the correct one for a Vite plus React app. The app
uses React Router 6 (`react-router-dom` `^6.30.1`, `package.json:118`), not
Next.js.

Render `<SpeedInsights />` inside `<BrowserRouter>` (`src/App.tsx:350`), next to
`<InstallBanner />` (`src/App.tsx:351`). This groups the beacon component with
the other global chrome, inside the router scope.

### 3. Change the guard test

Change `tests/unit/appNoVercelAnalytics.test.ts`:

- Flip the `@vercel/speed-insights` assertion. The old test asserts `src/App.tsx`
  does not import the specifier (`tests/unit/appNoVercelAnalytics.test.ts:26-28`).
  The new test asserts `src/App.tsx` imports `@vercel/speed-insights/react` and
  renders `<SpeedInsights`.
- Keep the `@vercel/analytics` assertion
  (`tests/unit/appNoVercelAnalytics.test.ts:22-24`). The app does not add web
  analytics.
- Rename the file to `appAnalyticsWiring.test.ts`. The old name describes the
  old, fully-negative intent.
- Change the file doc comment to cite this design and the Vercel-only fact.

The source-text guard is the established pattern for `src/App.tsx`. This file is
excluded from unit-test coverage (`vitest.config.ts:42`), as is `src/main.tsx`
(`vitest.config.ts:43`).

## Decided trade-offs

### No web analytics (`@vercel/analytics`)

The app adds Speed Insights only. PostHog already captures pageviews
(`src/main.tsx:27`) and pageleaves (`src/main.tsx:28`), so Vercel Web Analytics
would duplicate that product-analytics data. Speed Insights is complementary: it
adds Core Web Vitals, which PostHog does not measure. The user asked for Speed
Insights only.

### No `route` prop (dynamic-route grouping deferred)

The `/react` variant does not auto-set the `route` prop. Only Next.js, Nuxt,
SvelteKit, and Remix auto-detect the route pattern. So the five dynamic routes
report concrete paths, not grouped patterns:

- `/r/:slug` (`src/App.tsx:359`)
- `/purchase-orders/:id` (`src/App.tsx:391`)
- `/invoices/:id` (`src/App.tsx:410`)
- `/invoices/:id/edit` (`src/App.tsx:411`)
- `/help/:slug` (`src/App.tsx:429`)

The app renders routes with element-based `<Routes>` (`src/App.tsx:352`), not the
`createBrowserRouter` data router. So there is no `useMatches` hook to read the
matched pattern cheaply. A `route`-prop helper is a documented future
enhancement. It is not needed for a first integration, and most routes are
static.

## Testing

- **Unit:** the changed source-text guard on `src/App.tsx`.
- **Typecheck:** `npm run typecheck` proves the import resolves and the props
  type-check.
- **Build:** `npm run build` proves the package bundles.
- **E2E — justified exception:** `<SpeedInsights />` renders no visible output.
  It sends beacons only from Vercel production, which local and CI Playwright
  cannot exercise. The existing E2E suite already proves the app boots. A new
  E2E would assert nothing that the unit guard and the build do not already
  cover.

## Risks

- **Console 404 off Vercel.** In local dev the injected script
  `/_vercel/speed-insights/script.js` 404s. The package auto-enables `debug`
  mode when `NODE_ENV` is development or test, so it sends no beacons and logs a
  debug note instead of a hard error. Production on Vercel serves the script, so
  no 404 reaches real users. This is the exact failure mode BUG-001 fixed for
  Lovable; Vercel hosting removes the cause.

## Non-goals

- No change to PostHog, Faro, or the BUG-001 `before_send` filter.
- No Vercel Web Analytics.
- No `route`-prop dynamic-route grouping.
- No environment flag.
