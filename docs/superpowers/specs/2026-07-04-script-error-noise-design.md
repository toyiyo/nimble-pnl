# Design: Kill masked "Script error." noise + dead-analytics console spam (BUG-001)

Date: 2026-07-04
Branch: `fix/cross-origin-script-error`
Error-tracking issue: PostHog `019e27d4-4df3-7a83-8fa5-9c9bb2b80a66` ("Script error.")

## Problem

BUG-001 reported cross-origin "Script error." breaking iOS Mobile Safari sessions
(14 occurrences / 11 sessions / 9 users in 7 days), with two invited users landing
with 18–22 console errors and "essentially zero app interaction". The ticket's
suggested fix was to add `crossorigin="anonymous"` to cross-origin script tags and
identify a crash-looping third-party SDK.

## Investigation findings (evidence)

1. **No script we control is missing `crossorigin`.** Verified against the deployed
   HTML and shipped bundles:
   - Vite emits the app bundle with `crossorigin` (same-origin anyway).
   - `posthog-js` 1.275.1 sets `crossOrigin = "anonymous"` on its lazily injected
     recorder/surveys scripts (verified in `node_modules/posthog-js/dist/module.js`).
   - Lovable-host-injected scripts (`/~flock.js`, `/__l5e/events.js`,
     `/__l5e/rrweb-record.js`) are all same-origin, no redirects (verified via curl).
   - Stripe.js only loads on Banking/Accounting pages — not the affected pages.
   The ticket's proposed `crossorigin` fix is therefore a no-op.

2. **The masked errors come from scripts outside our control.** Every sampled event
   is iOS Mobile Safari 26.5 / iOS 18.7.0, exclusively on `/auth`,
   `/accept-invitation`, and first-landing employee pages — the fingerprint of
   iOS-injected / password-manager / content-blocker scripts engaging on auth
   surfaces. All events are `synthetic: true`, zero stack frames.

3. **Sessions were not actually broken.** Replay console timelines for both invited
   users show: land → masked error → reload → `Auth state change: SIGNED_IN`.
   Users completed sign-in within minutes.

4. **The real, recurring console noise is ours:**
   - `@vercel/analytics` (`<Analytics />` in `src/App.tsx`) tries to load
     `/_vercel/insights/script.js`, which 404s on Lovable hosting — a console
     message on **every page load for every user**. `@vercel/speed-insights` is
     also installed (env-gated, same failure mode when enabled).
   - The mobile sidebar (`src/components/ui/sidebar.tsx`) renders `SheetContent`
     without a `SheetTitle`/`SheetDescription`, producing Radix accessibility
     errors on every mobile sidebar open (visible in the affected sessions).

## Approved scope (user-confirmed 2026-07-04)

### 1. Remove dead Vercel analytics

- Delete `<Analytics />`, `{enableSpeedInsights && <SpeedInsights />}`, their
  imports, and the `enableSpeedInsights` flag from `src/App.tsx`.
- Remove `@vercel/analytics` and `@vercel/speed-insights` from `package.json`.
- Regression guard: negative source-text test asserting `src/App.tsx` no longer
  references `@vercel/`.

### 2. Suppress unactionable masked exceptions client-side

- New pure helper `src/lib/errorTrackingFilter.ts`:
  `isUnactionableScriptError(event: CaptureResult | null): boolean` — true only
  when the event is a `$exception` whose exception list consists solely of
  synthetic, stack-frame-less entries with the CORS-masked message
  (`Script error.` variants: `Script error`, `Script error.`, browser-prefixed
  forms). Everything else passes through untouched.
- Wire it as `before_send` in the PostHog options in `src/main.tsx`
  (return `null` to drop, else return the event unchanged).
- Rationale: every script we control already reports unmasked; remaining masked
  events are third-party-injected noise with zero diagnostic content. This is the
  same default posture Sentry ships with (`ignoreErrors: ['Script error.']`).
- Unit tests: drops synthetic no-stack "Script error."; keeps real exceptions;
  keeps "Script error." that has stack frames; passes through non-exception
  events and `null`.

### 3. Mobile sidebar accessible title

- In `src/components/ui/sidebar.tsx` mobile branch, add an `sr-only`
  `SheetHeader` with `SheetTitle` ("Navigation") and `SheetDescription`
  (matches the upstream shadcn fix). Kills both Radix console errors
  (missing title + missing description).
- Unit test: render mobile sidebar (mock `useIsMobile` → true), assert the
  dialog has an accessible name.

### Post-merge operational step

- Suppress PostHog issue `019e27d4-4df3-7a83-8fa5-9c9bb2b80a66` (user-approved)
  once the PR ships, so stale-bundle stragglers don't re-page.

## Non-goals / decided trade-offs

- **No `crossorigin` attribute changes** — investigated, nothing to change.
- **Not attempting to identify the injected third-party script** (TrustedTypes
  beacons, UA-level fingerprinting) — cost outweighs value; sessions complete
  successfully.
- **Not removing PostHog/Faro/Lovable observability** — all functioning and
  CORS-clean.
- The invited-user "unusable app" premise is contradicted by replay evidence; if
  invitation-flow friction resurfaces it should be a separate investigation with
  its own evidence.

## Risks

- `before_send` must be additive-safe: a bug there could drop legitimate
  exceptions. Mitigated by the narrow predicate (synthetic + no frames + exact
  message family) and unit tests for the keep-paths.
- Removing `@vercel/analytics` loses nothing (script never loaded in prod), but
  double-check no code imports `track()` from it.
