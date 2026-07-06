# Plan: Kill masked "Script error." noise + dead-analytics console spam (BUG-001)

Spec: docs/superpowers/specs/2026-07-04-script-error-noise-design.md
Branch: `fix/cross-origin-script-error`

Each task is TDD: RED (failing test) → GREEN (minimal code) → verify → commit.

## Task 1 — PostHog `before_send` exception filter

1. **RED:** Write `tests/unit/errorTrackingFilter.test.ts` for a new pure
   predicate `isUnactionableScriptError(event)` in
   `src/lib/errorTrackingFilter.ts`. Cases (enumerate exact literals):
   - drops: `$exception` event, `$exception_list` entries all
     `synthetic: true` (or mechanism absent but no frames), zero stack
     frames, value exactly `"Script error."` → `true`
   - drops: same but value `"Script error"` (no trailing period) → `true`
   - keeps: `$exception` with a real message (`"TypeError: x is not a function"`) → `false`
   - keeps: value `"Script error."` but WITH stack frames → `false`
   - keeps: mixed list where one entry is a real error → `false`
   - keeps: non-`$exception` events (e.g. `$pageview`) → `false`
   - keeps: `null`/`undefined` event → `false`
   - keeps: `$exception` with empty/missing `$exception_list` → `false`
   Run `npm run test -- tests/unit/errorTrackingFilter.test.ts` — confirm RED
   (module missing).
2. **GREEN:** Implement `src/lib/errorTrackingFilter.ts`. Narrow predicate:
   event is `$exception` AND `$exception_list` is a non-empty array AND every
   entry has (no stacktrace frames) AND its `value` is in the masked-message
   set {`Script error.`, `Script error`}. Export the message set for test
   auditability. Confirm GREEN.
3. **Wire:** In `src/main.tsx`, add to the module-level `posthogOptions`
   literal: `before_send: (event) => isUnactionableScriptError(event) ? null : event`,
   plus the one-line comment that the options object is intentionally a
   module-level constant (memoize if ever moved into a component).
   `npm run typecheck` clean.
4. **Commit:** `fix(observability): drop CORS-masked synthetic Script error events client-side`

## Task 2 — Remove dead Vercel analytics

1. **RED:** Write `tests/unit/appNoVercelAnalytics.test.ts` — reads
   `src/App.tsx` source and asserts it does NOT contain the exact specifiers
   `@vercel/analytics` or `@vercel/speed-insights`. Confirm RED.
2. **GREEN:** Edit `src/App.tsx`: remove both imports, `<Analytics />`,
   `{enableSpeedInsights && <SpeedInsights />}`, and the
   `enableSpeedInsights` const. Remove `@vercel/analytics` and
   `@vercel/speed-insights` from `package.json`; run `npm install` to sync
   the lockfile. Confirm GREEN + `npm run build` succeeds.
3. **Commit:** `fix(observability): remove @vercel/analytics — app is on Lovable, script 404s every load`

## Task 3 — Mobile sidebar accessible title

1. **RED:** Write `tests/unit/sidebarMobileA11y.test.tsx` — mock
   `@/hooks/use-mobile` `useIsMobile` → `true`; render `SidebarProvider` +
   `Sidebar` with a test child that calls `useSidebar().setOpenMobile(true)`
   on mount; assert `getByRole('dialog')` has accessible name matching
   /navigation/i. Confirm RED (dialog has no accessible name).
2. **GREEN:** In `src/components/ui/sidebar.tsx` mobile branch, add as the
   FIRST direct child of `SheetContent` (sibling before the flex wrapper
   div): sr-only `SheetHeader` containing `SheetTitle` "Navigation" and
   `SheetDescription` "Displays the mobile navigation sidebar.". Import
   `SheetHeader`, `SheetTitle`, `SheetDescription` from ui/sheet. Confirm
   GREEN.
3. **Commit:** `fix(a11y): mobile sidebar sheet gets sr-only title/description (Radix console errors)`

## Task 4 — Full local verify (Phase 8 pre-pass)

1. `npm run test` (full unit suite), `npm run typecheck`, `npm run lint`
   (changed files clean), `npm run build`. No db/e2e surface touched —
   `npm run test:db` not applicable (no SQL changes); run `npm run test:e2e`
   per Phase 8 policy in the workflow's Verify phase.
2. No commit unless fixes needed.

## Notes for Ship phase (9a)

- PR description must include the manual post-merge checklist item:
  "Suppress PostHog error-tracking issue 019e27d4-4df3-7a83-8fa5-9c9bb2b80a66".
- Branch already carries: design doc, this plan, and the `git rm --cached
  progress.md` hygiene fix (leaked via PR #573).

## Dependencies

Tasks 1–3 are independent (workflow runs them sequentially). Task 4 last.
