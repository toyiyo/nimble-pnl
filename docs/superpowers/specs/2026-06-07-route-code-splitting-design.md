# Design: Route-level code splitting (mobile LCP fix) — PR1

**Date:** 2026-06-07
**Branch:** `perf/route-code-splitting`
**Author:** Claude (via `/dev`)
**Status:** Approved (design)

## Context / Root cause

Production RUM (Grafana Faro) shows a mobile brownout:

- **Mobile Safari LCP p75 ≈ 23,200 ms** vs **desktop Chrome ≈ 1,070 ms** (same 6h window) — a 21× gap.
- Worst routes by p75 LCP: `/employee/pay` ≈ 12 s, `/integrations` ≈ 3.8 s.
- LCP is dominated by `element_render_delay` (13–47 s) with tiny TTFB (~143 ms) → the device is **parsing/executing JS on the main thread**, not waiting on the network. Backend/API is healthy (Supabase queries 90–700 ms).

Root cause: **all 57 pages are statically imported in `src/App.tsx`**, so the entry chunk is **`index-*.js` = 5,833 KB raw / 1,587 KB gzip** (total JS 9,527 KB / 2,669 KB gzip). Every route — even `/auth` — must download, parse, and execute that whole chunk before React renders. There are **zero** `React.lazy` / dynamic `import()` calls for routes today. Fast on desktop V8; catastrophic on iPhone CPUs.

This is not a regression (last deploy was 6 days before the incident); it is a latent architectural issue that crossed the LCP alert threshold under peak mobile load.

## Goals

- Shrink the initial/entry JS chunk so mobile devices parse far less before first paint.
- Split each route into an on-demand chunk loaded only when visited.
- Do so **without** introducing white screens (chunk-load failures) or breaking the Capacitor native app.
- Measure real before/after entry-chunk size and (post-deploy) mobile LCP.

## Non-goals (deferred to follow-up PRs)

- Runtime fixes #2–#5 from the perf analysis (`/employee/pay` payroll waterfall, mobile banking virtualization + O(n²) lookup, dashboard `autoLoadAll`, `useMonthlyMetrics`/integration/restaurants hooks → React Query).
- Click-time dynamic import of `xlsx` / `jspdf` (route-splitting already removes them from the **entry** chunk).
- Chrome-preserving per-content Suspense (Approach B) and lazy `AiChatPanel`.

## Approach (chosen: A)

**React.lazy + top-level Suspense + ErrorBoundary + retry helper.**

1. Convert all 57 page imports in `src/App.tsx` from static to lazy via a `lazyWithRetry()` helper:
   - Default-export pages: `lazyWithRetry(() => import('./pages/X'))`.
   - The 3 **named-export** pages — `Inventory` (`./pages/Inventory`), `ReceiptImport` (`@/pages/ReceiptImport`), `AcceptInvitation` (`./pages/AcceptInvitation`) — use `lazyWithRetry(() => import('./pages/X').then(m => ({ default: m.X })))`.
2. Wrap `<Routes>` in a single top-level `<Suspense fallback={<RouteFallback />}>`. On first visit to a route the loader shows briefly; repeat visits are instant (chunk cached). On first load this is the win — the device paints a loader fast instead of freezing on 5.8 MB of JS.
3. Wrap the Suspense in a new `<RouteErrorBoundary>` so a failed chunk load shows a recoverable "Couldn't load — reload" UI instead of a white screen.

### Alternatives considered

- **B — Suspense inside the layout** (keep sidebar/header during inter-route navigation, swap only content). Nicer nav UX, but more invasive (two boundaries + public-route handling) and the *first-load* win (the actual root cause) is identical. → Deferred fast-follow.
- **C — data-driven route config** (refactor the inline `<Routes>` into an array mapped to lazy components). Cleaner long-term but a much larger diff/risk during an active incident. → Not now.

## Detailed design

### New: `src/lib/lazyWithRetry.ts`

Resilient wrapper around `React.lazy`. Dependencies (`storage`, `reload`) are injectable for testability.

- `loadModuleWithRetry(factory, { retries = 1, reloadOnFail = true, storage = sessionStorage, reload = () => window.location.reload() })`:
  - Try `factory()`. On success: clear the reload-guard key, return the module.
  - On failure: retry up to `retries` times (covers transient network blips).
  - On persistent failure: if the reload-guard key is **not** set → set it and call `reload()` once (recovers from **stale chunks after a web deploy** — the classic SPA `ChunkLoadError`), returning a non-resolving promise so React keeps showing the fallback until the reload happens; if the key **is** set (already reloaded) → clear it and rethrow, surfacing to `RouteErrorBoundary`.
- `lazyWithRetry(factory, opts?) = React.lazy(() => loadModuleWithRetry(factory, opts))`.

Rationale: code-splitting introduces a **new** failure mode (chunk fetch can fail) that did not exist with a single bundle. The "Failed to fetch" / "Load failed" errors already in RUM mean we must not amplify them — retry + one-shot reload + error boundary keeps a flaky load recoverable.

### New: `src/components/RouteErrorBoundary.tsx`

Class component (`getDerivedStateFromError` + `componentDidCatch`). No error boundary exists in the app today.
- On error: render an accessible fallback (`role="alert"`, semantic tokens, Apple/Notion styling) with a **Reload** button (`window.location.reload()`, injectable for tests).
- Logs the error to `console.error` (Faro captures console errors) for observability.
- Renders `children` normally when no error.

### New: `src/components/RouteFallback.tsx`

Presentational full-screen loader matching the existing `ProtectedRoute` loading state (lines 120–128 of `App.tsx`).
- `role="status"`, accessible name "Loading", semantic tokens (`bg-background`, `text-muted-foreground`), centered.

### Modified: `src/App.tsx`

- Replace the 57 static page imports with `lazyWithRetry(...)` declarations.
- Wrap `<Routes>` with `<RouteErrorBoundary><Suspense fallback={<RouteFallback/>}>…</Suspense></RouteErrorBoundary>`.
- No change to route paths, `ProtectedRoute`, `StaffRoleChecker`, `LayoutSwitcher`, or provider order.
- `App.tsx` is route wiring and is already in both `vitest.config.ts:coverage.exclude` and `sonar.coverage.exclusions` — no coverage impact.
- **Implementation check:** confirm no page module is imported by another module (only by `App.tsx`); a page imported elsewhere statically won't fully split. Grep during build.

### Modified: `src/services/ocrService.ts`

- Change top-level `import { createWorker } from 'tesseract.js'` to a dynamic `const { createWorker } = await import('tesseract.js')` inside the worker-creation function. `tesseract.js` is a multi-MB OCR/WASM library loaded eagerly today and used only in OCR flows; defer it to point-of-use. Update/extend the `ocrService` unit test to mock the dynamic import (this file is **not** coverage-excluded).

### Modified: self-defeating dynamic imports (build-flagged)

The build warns these are imported **both** statically and dynamically (so the dynamic split is negated and they fall back into the entry chunk). Normalize to **static** (each is core and already statically imported in dozens of files), which clears the warnings:
- `@/utils/mappingTemplates` — `POSSalesFileUpload.tsx` imports it statically (line 14) *and* dynamically (line 312) in the same file → use the static import at line 312.
- `@/integrations/supabase/client` — dynamic imports in `ReceiptMappingReview.tsx`, `pages/Inventory.tsx`, `services/ocrService.ts` while it is statically imported in 40+ files → make those static.
- `@/lib/enhancedUnitConversion` — dynamic import in `hooks/useRecipes.tsx` (line 367) while statically imported widely → make static.

## Capacitor / mobile-app compatibility

The product ships a **Capacitor 7 native app** (`capacitor.config.ts`, `webDir: dist`, `ios/` + `android/` present; `build:mobile` runs `CAPACITOR_BUILD=true npm run build` then `npx cap sync`). Code-splitting is compatible:

- **Chunks are local in native.** Capacitor serves `dist/` from a local origin (`capacitor://localhost` iOS / `https://localhost` Android). Dynamic-import chunks are local files → they load offline, no CDN. `base: './'` (already set for `CAPACITOR_BUILD=true`) makes asset refs relative so they resolve against the local app root; Vite resolves dynamic-chunk URLs via `import.meta.url`, robust to client-side route depth.
- **No version skew in native.** There is **no OTA/live-update plugin** — the web bundle and its `index.html` ship together inside the binary and change only on App/Play Store update. A chunk hash can never mismatch the index in native, so `ChunkLoadError` is effectively impossible there; `lazyWithRetry`'s reload path is a harmless safety net (it matters for the *web* app, e.g. a stale tab after a Vercel deploy), and `RouteErrorBoundary` is the backstop.
- **Service worker is irrelevant.** `public/sw.js` is push-only (no `fetch` handler, no caching) → it cannot serve stale chunks or interfere with dynamic imports. No change needed.
- **Likely a native win.** The 23s "Mobile Safari" p75 includes the iOS WKWebView (the native app's engine reports as Mobile Safari); a smaller entry chunk speeds native cold start too.

**Verification:** Phase 8 adds a `CAPACITOR_BUILD=true npm run build` check (relative asset refs correct, build green). A full `npx cap sync` + iOS/Android **simulator smoke-load of 2–3 routes** is flagged as a **manual pre-release step** (cannot boot a simulator from CI/this environment).

## Testing strategy

- `src/lib/lazyWithRetry.ts` (TDD): success returns module + clears guard; transient failure then success returns module; persistent failure with no guard → calls `reload` + sets guard; persistent failure with guard set → rethrows (no reload). Inject `storage`/`reload` mocks.
- `src/components/RouteErrorBoundary.tsx` (RTL): renders children normally; on child throw renders `role="alert"` + Reload button; clicking Reload calls injected reload. Assert by **role**, not text (per lessons).
- `src/components/RouteFallback.tsx` (RTL): renders `role="status"` with accessible name.
- `src/services/ocrService.ts`: update tests to mock `import('tesseract.js')`; assert worker creation still works.
- `App.tsx`: covered by existing Playwright E2E route suite + the production build; coverage-excluded.

## Verification & success metrics (Phase 8)

- `npm run build`: capture entry-chunk size before/after (target entry ~5.8 MB → ~1–2 MB raw; each route a small on-demand chunk).
- `npm run typecheck && npm run lint && npm run test && npm run build` all green.
- `CAPACITOR_BUILD=true npm run build` green with correct relative refs.
- Post-deploy: re-check `feo11y:lcp_p75{service_name="easyshifthq"}` by `browser_mobile` — target mobile p75 < 2.5 s.

## Decided trade-offs

- **Single top-level Suspense (A) over chrome-preserving Suspense (B):** A delivers the entire first-load (root-cause) win with minimal diff/risk; B is UX polish for inter-route nav and is deferred. Accepted: a brief loader on first visit to each route (replaces a 15–47 s frozen screen).
- **tesseract dynamic import included; `xlsx`/`jspdf` deferred:** tesseract is one file and the heaviest single lib; `xlsx`/`jspdf` span several files and are already removed from the *entry* chunk by route-splitting, so their click-time deferral is lower-value follow-up.

## Risks & mitigations

- **Named-export pages** → handled explicitly via `.then(m => ({ default: m.X }))`.
- **New chunk-load failure mode** → `lazyWithRetry` (retry + one-shot reload) + `RouteErrorBoundary`.
- **Capacitor relative-base resolution** → standard/ documented setup, push-only SW won't interfere; verified by a `CAPACITOR_BUILD=true` build + manual simulator smoke.
- **A page imported outside `App.tsx`** would not fully split → grep check during implementation.
