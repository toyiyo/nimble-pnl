# Design: Add Vercel Speed Insights

Date: 2026-08-09
Branch: `feature/vercel-speed-insights`

## Goal

Collect Core Web Vitals from real production web users. Production now deploys
to Vercel, so Vercel Speed Insights can report field performance data.

## Problem

The app sends no Core Web Vitals data today. `src/App.tsx` has no
`@vercel/speed-insights` import (verified — `grep '@vercel/' src/` returns
nothing). `package.json` has no `@vercel/speed-insights` dependency (verified —
`grep 'vercel' package.json` returns 0 matches). PostHog captures product
analytics only: pageviews (`src/main.tsx:27`) and pageleaves
(`src/main.tsx:28`). Grafana Faro captures frontend errors and traces
(`initFaro()` at `src/main.tsx:11`; config in `src/lib/faro.ts`). Neither
reports Largest Contentful Paint, Cumulative Layout Shift, or the other Web
Vitals that Speed Insights measures.

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

Production now moves to Vercel. The 404 premise no longer holds for the web
build. This design reverses the Speed Insights half of BUG-001 part 1. The
BUG-001 PostHog `before_send` filter (`src/main.tsx:29-30`) and the
mobile-sidebar accessibility fix stay unchanged.

## Two production surfaces (both matter)

The app has two production surfaces:

1. **Web on Vercel.** The sole production web host (user-confirmed 2026-08-09).
2. **Native Capacitor apps for iOS and Android.** `@capacitor/ios`
   (`package.json:46`) and `@capacitor/android` (`package.json:39`) are
   dependencies. Native builds serve the bundled app from a local WebView
   (`webDir: 'dist'`, no `server.url` — `capacitor.config.ts:6`), not the Vercel
   URL.

Speed Insights works on the web surface only. On native, the injected script
`/_vercel/speed-insights/script.js` resolves against the local WebView origin
and 404s on every page load — the exact BUG-001 symptom. So Speed Insights must
render on the web only, not on native.

A runtime platform check gates the render. No environment flag gates it. An
environment flag would add a silent-no-op risk: a missing flag would disable the
feature with no error. `Capacitor.isNativePlatform()` cannot be unset or
misconfigured; the codebase already uses it in 15 files
(for example `src/components/InstallBanner.tsx:22`).

## Approved design

### 1. Add the dependency

Add `@vercel/speed-insights` (v2) to `dependencies` in `package.json`. Run
`npm install` in the worktree.

### 2. Add a platform-gated component `src/components/SpeedInsightsGate.tsx`

Create a small component that renders Speed Insights on the web only:

```tsx
import { Capacitor } from '@capacitor/core';
import { SpeedInsights } from '@vercel/speed-insights/react';

// Render Vercel Speed Insights on the web only. Native Capacitor builds serve
// the app from a local WebView, where the Vercel script 404s (BUG-001). So skip
// the beacon on native platforms.
export function SpeedInsightsGate() {
  if (Capacitor.isNativePlatform()) {
    return null;
  }
  return <SpeedInsights />;
}
```

The `/react` entry point is the correct one for a Vite plus React app. The app
uses React Router 6 (`react-router-dom` `^6.30.1`, `package.json:118`), not
Next.js. The native guard copies the pattern in
`src/components/InstallBanner.tsx:22-24`.

### 3. Wire the gate in `src/App.tsx`

Add the import:

```tsx
import { SpeedInsightsGate } from '@/components/SpeedInsightsGate';
```

Render `<SpeedInsightsGate />` inside `<BrowserRouter>` (`src/App.tsx:350`), next
to `<InstallBanner />` (`src/App.tsx:351`). This groups the beacon with the other
global chrome, inside the router scope.

### 4. Change the guard test and add a behavior test

Change `tests/unit/appNoVercelAnalytics.test.ts`:

- Delete the `@vercel/speed-insights` negative assertion
  (`tests/unit/appNoVercelAnalytics.test.ts:26-28`). Speed Insights is now a
  deliberate dependency, wired through `SpeedInsightsGate`.
- Keep the `@vercel/analytics` assertion
  (`tests/unit/appNoVercelAnalytics.test.ts:22-24`). The app does not add web
  analytics.
- Change the file doc comment to cite this design.

Keep the file name `appNoVercelAnalytics.test.ts`. The name stays accurate: the
file still bans `@vercel/analytics`. Two other tests reference it by name
(`tests/unit/appLaborRoute.test.ts:9`, `tests/unit/App.viewModeWiring.test.ts:9`);
a rename would break those comments.

Add `tests/unit/speedInsightsGate.test.tsx`:

- Mock `@capacitor/core` and `@vercel/speed-insights/react`.
- Web case (`isNativePlatform` returns false): assert `SpeedInsights` renders.
- Native case (`isNativePlatform` returns true): assert `SpeedInsights` does not
  render.

`src/components/SpeedInsightsGate.tsx` is excluded from coverage in both
`vitest.config.ts` (`src/components/**`) and `sonar-project.properties`
(`src/components/**/*.tsx`). The behavior test still runs and guards the native
logic; the exclusion only drops the file from the coverage percent.

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

- **Unit (behavior):** `tests/unit/speedInsightsGate.test.tsx` proves the gate
  renders Speed Insights on the web and renders nothing on native.
- **Unit (guard):** the changed `tests/unit/appNoVercelAnalytics.test.ts` keeps
  the `@vercel/analytics` ban.
- **Typecheck:** `npm run typecheck` proves the import resolves and the props
  type-check.
- **Build:** `npm run build` proves the package bundles.
- **E2E — justified exception:** the gate renders no visible output. It sends
  beacons only from Vercel production, which local and CI Playwright cannot
  exercise. The existing E2E suite already proves the app boots
  (`tests/e2e/navigate-in-app.spec.ts` loads `/auth` and asserts on the rendered
  UI). A new E2E would assert nothing that the gate behavior test and the build
  do not already cover.

## Post-merge operational step

Enable Speed Insights in the Vercel project dashboard after the PR ships. Open
the project, select the Speed Insights tab, and enable it. Vercel provisions the
`/_vercel/speed-insights/*` route only after this step; the npm package alone
does not create it. Add this as a checklist item in the PR description so an
operator does not forget it.

## Risks

- **Native WebView 404.** Native Capacitor builds serve the app from a local
  WebView, where `/_vercel/speed-insights/script.js` 404s (BUG-001). The
  `SpeedInsightsGate` native guard fixes this: it renders nothing on native.
- **Vercel dashboard step.** Vercel provisions the `/_vercel/speed-insights/*`
  route only after an operator enables Speed Insights in the project dashboard.
  If the operator skips this step, the feature collects no data. See the
  post-merge operational step.
- **Local-dev 404.** In local dev the script 404s. The package auto-enables
  `debug` mode when `NODE_ENV` is development or test, so it sends no beacons and
  logs a debug note, not a hard error.

## Non-goals

- No change to PostHog, Faro, or the BUG-001 `before_send` filter.
- No Vercel Web Analytics.
- No `route`-prop dynamic-route grouping.
- No environment flag (a runtime platform check gates the render instead).
