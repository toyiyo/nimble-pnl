# PostHog Funnel Events — Plan

**Spec:** [`docs/superpowers/specs/2026-05-07-posthog-funnel-events-design.md`](../specs/2026-05-07-posthog-funnel-events-design.md)
**Branch:** `feature/posthog-funnel-events`

## Task list (TDD order)

### T1 — `src/lib/analytics.ts` + tests (RED → GREEN)
**Test first:** `tests/unit/analytics.test.ts`
- [ ] `isInternalEmail('foo@easyshifthq.com')` → true
- [ ] `isInternalEmail('foo@easyshifthq.COM')` → true (case-insensitive)
- [ ] `isInternalEmail('foo@example.com')` → false
- [ ] `isInternalEmail(null)` / `isInternalEmail(undefined)` / `isInternalEmail('')` → false
- [ ] `storeAttribution('?utm_source=google&utm_medium=cpc&utm_campaign=launch', '', '/auth')` writes JSON with those fields + `referrer:''` + `landing_page:'/auth'` + `captured_at`
- [ ] `storeAttribution('', '', '/auth')` (no UTM, no referrer) does NOT write
- [ ] `storeAttribution('', 'https://google.com', '/auth')` writes (referrer alone is sufficient)
- [ ] `storeAttribution(...)` does not clobber existing data when called twice — second call adds nothing if no fresh data
- [ ] `getStoredAttribution()` returns the parsed object; returns null when key missing
- [ ] `getStoredAttribution()` returns null when value is malformed JSON (no throw)
- [ ] `clearStoredAttribution()` removes the key
- [ ] `INTERNAL_DOMAINS` constant exported as readonly array

**Implementation:** `src/lib/analytics.ts`. No React, no posthog imports — pure utilities. ~70 LOC.

**Commit:** `feat(analytics): add internal-domain + UTM attribution helpers`

### T2 — `supabase/functions/_shared/posthogServer.ts` + Deno test
**Test first:** `supabase/functions/_shared/posthogServer.test.ts`
- [ ] When `POSTHOG_PROJECT_KEY` is unset → `captureServerEvent` resolves, no fetch made
- [ ] When `POSTHOG_HOST` is unset → same
- [ ] When both set → invokes the SDK (we mock `npm:posthog-node` via `import.meta.resolve` shim or stub `globalThis.fetch` since posthog-node uses fetch underneath)
- [ ] Errors thrown by the SDK are caught and logged; function still resolves

**Implementation:** ~40 LOC. Single async function. Pinned to `npm:posthog-node@4.18.0` (latest stable; pin exact version).

**Commit:** `feat(analytics): add server-side PostHog capture helper`

### T3 — Wire `useAuth.tsx` (account_created + trial_started + identify + last_login)
**Test first:** `tests/unit/useAuth.posthog.test.tsx`
- [ ] When user appears with `created_at` within last 5 min and no localStorage flag → `posthog.identify` called with `is_internal:false` for `@example.com`, `is_internal:true` for `@easyshifthq.com`
- [ ] `account_created` and `trial_started` capture calls fire exactly once
- [ ] localStorage flag `posthog_account_created_${id}` is set
- [ ] Stored attribution from `getStoredAttribution()` is merged into person properties on identify
- [ ] On second mount with same user → no duplicate `account_created` fire
- [ ] When user appears with old `created_at` (>5 min) → only `last_login_at` identify fires; no `account_created`
- [ ] When user is null → nothing fires

**Implementation:** add a new effect in `AuthProvider`. Mock `posthog-js` default export with `vi.mock('posthog-js', ...)`. Don't touch existing auth logic.

**Commit:** `feat(analytics): identify users + fire account_created/trial_started in useAuth`

### T4 — Wire `Auth.tsx` UTM capture
**Test first:** `tests/unit/Auth.attribution.test.tsx`
- [ ] Mount with `?utm_source=g&utm_medium=cpc` → `localStorage.signup_attribution` is set with parsed values
- [ ] Mount without params and no referrer → localStorage not set
- [ ] Mount fires once (mount-only effect with empty deps)

**Implementation:** Add a `useEffect(() => { storeAttribution(...) }, [])` near the top of `Auth`. ~5 lines.

**Commit:** `feat(analytics): capture signup attribution to localStorage on Auth mount`

### T5 — Wire POS callbacks (pos_integration_completed × 3)
**Test first:** Smoke test per file via mocking — vitest with `vi.mock('@/integrations/supabase/client')` for the success path:
- [ ] On `setStatus('success')` in SquareCallback, `posthog.capture('pos_integration_completed', { pos_provider: 'square', seconds_from_trial_start: <number> })` fires
- [ ] Same for Toast → `'toast'`
- [ ] Same for Clover → `'clover'`
- [ ] On the error branch, no capture call fires

**Implementation:** Three near-identical edits. Add `useAuth` import where missing. Compute `secondsFromTrialStart` from `user?.created_at`.

**Commit:** `feat(analytics): fire pos_integration_completed on POS callbacks`

### T6 — Wire `Index.tsx` first_pnl_viewed
**Test first:** `tests/unit/Index.firstPnlViewed.test.tsx`
- [ ] When `periodData` resolves with `net_revenue > 0` and no localStorage flag → capture fires with `has_real_data:true`
- [ ] When `periodData` resolves with `net_revenue === 0` → capture fires with `has_real_data:false`
- [ ] On second render with same user → no duplicate capture
- [ ] When `periodData` is null → no capture

**Implementation:** Add a `useEffect` in `Index` with guards. ~15 lines.

**Commit:** `feat(analytics): fire first_pnl_viewed once per user on Index`

### T7 — Wire Stripe webhook subscription_created/canceled
**Test first:** Extend `subscription-handler.test.ts`:
- [ ] On `customer.subscription.created` event → after DB update, server-side capture invoked with `tier`, `billing_period`, `mrr_cents`, `is_annual`, `restaurant_id`
- [ ] On `customer.subscription.updated` (NOT created) → no `subscription_created` fire (avoid double-count on plan changes)
- [ ] On `customer.subscription.deleted` → after DB update, `subscription_canceled` fires with `restaurant_id`
- [ ] When PostHog server helper throws → handler still returns successfully (telemetry must not break webhook)

**Implementation:** Use the same owner lookup pattern as `syncVolumeDiscountsForOwner`. Wrap in try/catch like the volume discount sync does.

**Commit:** `feat(analytics): fire subscription_created/canceled from Stripe webhook`

## Dependencies

- T1 has no dependency
- T2 has no dependency on T1
- T3 depends on T1 (uses `getStoredAttribution`, `isInternalEmail`)
- T4 depends on T1 (uses `storeAttribution`)
- T5 depends on nothing (uses inline event constants)
- T6 depends on nothing
- T7 depends on T2

T1 and T2 can be done in parallel; same for T5 and T6; T3 needs T1 first; T4 needs T1; T7 needs T2.

## Sequencing

Sequential commit order (single-developer flow): **T1 → T2 → T3 → T4 → T5 → T6 → T7**

Each task is one commit. ~7 commits total.

## Acceptance criteria

- [ ] All 7 tasks committed
- [ ] `npm run test` green
- [ ] `npm run typecheck` green
- [ ] `npm run lint` green
- [ ] `npm run build` green
- [ ] `coderabbit review --plain --type committed` returns no actionable findings
- [ ] PR opened, CI green, SonarCloud quality gate green
- [ ] Phase 9d: every CodeRabbit/Codex comment triaged
