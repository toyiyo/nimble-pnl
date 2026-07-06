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
  imports the two exact specifiers `@vercel/analytics` and
  `@vercel/speed-insights` (scoped per design review — do not blanket-ban the
  `@vercel/` prefix so a deliberate future reintroduction stays legible).
- Sweep `.env*`, `docs/`, and deployment config for orphaned
  `VITE_ENABLE_SPEED_INSIGHTS` references and remove them.

### 2. Suppress unactionable masked exceptions client-side

- New pure helper `src/lib/errorTrackingFilter.ts`:
  `isUnactionableScriptError(event: CaptureResult | null | undefined): boolean`
  — true only
  when the event is a `$exception` whose exception list consists solely of
  synthetic, stack-frame-less entries whose message is **exactly** one of the
  two masked literals `Script error.` or `Script error` (the exhaustive set,
  exported as `MASKED_SCRIPT_ERROR_MESSAGES`). Everything else passes through
  untouched. Decided scope: we do **not** match browser-prefixed or otherwise
  wrapped variants — an unmatched variant safely falls through to "keep" (still
  reported) rather than risk mis-dropping a real error, so widening the set is a
  future change gated on real-world evidence, not a guess.
- Wire it as `before_send` **inside the existing module-level `posthogOptions`
  object literal** in `src/main.tsx` (return `null` to drop, else return the
  event unchanged) — not via a separate init call or post-hoc mutation. Add a
  one-line code comment noting the options object is intentionally a
  module-level constant and must be memoized if ever moved into a component
  (design-review major).
- Unit tests must enumerate the exact message literals the predicate matches
  (`Script error.` and `Script error`) so the predicate's scope is auditable at
  a glance, and must include keep-path cases proving a synthetic frame-less
  entry with a non-matching or absent message is NOT dropped (design-review +
  sound-logic minor).
- Rationale: every script we control already reports unmasked; remaining masked
  events are third-party-injected noise with zero diagnostic content. This is the
  same default posture Sentry ships with (`ignoreErrors: ['Script error.']`).
- Unit tests: drops synthetic no-stack "Script error."; keeps real exceptions;
  keeps "Script error." that has stack frames; passes through non-exception
  events and both `null` and `undefined` (both are supported no-op inputs).

### 3. Mobile sidebar accessible title

- In `src/components/ui/sidebar.tsx` mobile branch, add an `sr-only`
  `SheetHeader` with `SheetTitle` ("Navigation") and `SheetDescription`
  (matches the upstream shadcn fix). Kills both Radix console errors
  (missing title + missing description).
- Placement (design-review major): the sr-only header goes as the **first
  direct child of `SheetContent`, as a sibling before the existing
  `flex h-full w-full flex-col` wrapper div** — matching the upstream shadcn
  patch — so focus order and screen-reader announcement stay natural.
- Unit test: render mobile sidebar (mock `useIsMobile` → true), assert the
  dialog has an accessible name.

### Post-merge operational step

- Suppress PostHog issue `019e27d4-4df3-7a83-8fa5-9c9bb2b80a66` (user-approved)
  once the PR ships, so stale-bundle stragglers don't re-page. This is manual —
  add it as a checklist item in the PR description so it isn't forgotten
  (design-review minor).

### Bonus hygiene (found during Phase 1)

- `progress.md` from the categorization task is tracked on `main` (leaked via
  PR #573 despite `.gitignore` — recurrence of the 2026-06-19/28 lessons).
  `git rm --cached progress.md` on this branch so it leaves the repo.

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
