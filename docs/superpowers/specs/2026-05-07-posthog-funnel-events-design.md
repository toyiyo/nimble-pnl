# PostHog Funnel Events — Design

**Date:** 2026-05-07
**Author:** Jose (with Claude)
**Status:** Proposed

## Goal

Wire the five funnel events that currently don't fire so we can measure where users drop off:

```
Visitor → Trial signup → POS connected → First P&L viewed → Subscription created
```

Events: `account_created`, `trial_started`, `pos_integration_completed`, `first_pnl_viewed`, `subscription_created` (+ `subscription_canceled` for churn).

## Non-goals

- Lead magnet page (separate branch)
- Trial-expiry emails (Resend, follow-up PR)
- Onboarding drawer gating (follow-up)
- Marketing site changes (separate)
- `.env` secret rotation (separate security ticket)
- `pos_integration_started` event — skipped until we wire it at the click site (see Decisions)

## Existing state (audited 2026-05-07)

- `src/main.tsx` initializes `PostHogProvider` conditionally on `VITE_PUBLIC_POSTHOG_KEY` + `VITE_PUBLIC_POSTHOG_HOST`.
- `posthog-js@^1.275.1` is installed. `posthog-node` is NOT.
- Zero `posthog.capture()` calls anywhere. One unused `usePostHog()` hook in `PurchaseOrderEditor.tsx`.
- `useAuth.tsx` has no new-user vs. returning-user branch.
- POS callbacks (Square/Toast/Clover) all use `setStatus('success')` at known line numbers.
- `Index.tsx` is the canonical dashboard with `periodData.net_revenue`.
- `subscription-handler.ts` handles `customer.subscription.created`/`updated`/`deleted` and `checkout.session.completed`.
- No PostHog mocking precedent in the test suite.

## Decisions

| # | Decision | Why |
|---|----------|-----|
| 1 | Server-side: `posthog-node` via Deno `npm:` specifier | User chose; matches doc snippet; built-in batching |
| 2 | `first_pnl_viewed` fires only from `Index.tsx` | Single source of truth; localStorage flag per user |
| 3 | `is_internal` covers `@easyshifthq.com` only (extensible constant) | Conservative default; partner domain can be added later |
| 4 | Skip `pos_integration_started` for now | Putting it in callback creates nonsense back-to-back events; do it right at click site in follow-up |
| 5 | New-account detection: `created_at` recency (≤5 min) AND localStorage flag | Avoids double-fire on session restore, magic-link clicks |
| 6 | Centralize cross-cutting helpers in `src/lib/analytics.ts` | Internal-domain logic + UTM persistence shouldn't be inlined 5 places |
| 7 | Inline `posthog.capture()` for simple events at the call site | Matches doc snippets; clear at the call site what fires |
| 8 | Server-side wrapper at `supabase/functions/_shared/posthogServer.ts` | Avoid duplication if we add more server-side events |

## Event schema

### `account_created` (browser, fired in `useAuth.tsx`)
**Distinct ID:** `session.user.id`
**Person properties** set via `posthog.identify(...)`:
- `email` (string)
- `signup_source` (string) — from stored attribution: `utm_source` || `referrer` || `'direct'`
- `signup_medium` (string) — `utm_medium` || `'organic'`
- `signup_campaign` (string | null)
- `is_internal` (boolean) — `isInternalEmail(email)`

**Event properties:**
- `email` (string)

### `trial_started` (browser, fired in `useAuth.tsx`)
- `trial_ends_at` (ISO string, +14 days from `now()`)

### `pos_integration_completed` (browser, fired in each `*Callback.tsx` success branch)
**Distinct ID:** `session.user.id`
**Event properties:**
- `pos_provider` (`'square' | 'toast' | 'clover'`)
- `seconds_from_trial_start` (number) — `(Date.now() - new Date(user.created_at).getTime()) / 1000`

### `first_pnl_viewed` (browser, fired once per user in `Index.tsx`)
**Dedup:** `localStorage.getItem(\`pnl_first_view_seen_${user.id}\`)`
**Event properties:**
- `seconds_from_trial_start` (number)
- `has_real_data` (boolean) — `periodData.net_revenue > 0`

### `subscription_created` / `subscription_canceled` (server, in Stripe webhook)
**Distinct ID:** `userId` looked up from `restaurants.stripe_subscription_id` → owner via `user_restaurants`.
**Event properties (`subscription_created`):**
- `tier` (`'starter' | 'growth' | 'pro'`) — already computed in handler
- `billing_period` (`'monthly' | 'annual'`)
- `mrr_cents` (number) — `price.unit_amount`
- `is_annual` (boolean)
- `restaurant_id` (string)

**Event properties (`subscription_canceled`):**
- `restaurant_id` (string)

We fire `subscription_created` inside the `customer.subscription.created` case (NOT `customer.subscription.updated`) to avoid double-firing on plan changes. We fire `subscription_canceled` from `customer.subscription.deleted`.

## Files to add

### `src/lib/analytics.ts`
Public surface:
```ts
export const INTERNAL_DOMAINS = ['@easyshifthq.com'] as const;
export function isInternalEmail(email?: string | null): boolean;
export interface SignupAttribution { ... }
export function storeAttribution(search: string, referrer: string, pathname: string): void;
export function getStoredAttribution(): SignupAttribution | null;
export function clearStoredAttribution(): void;
export const ATTRIBUTION_STORAGE_KEY = 'signup_attribution';
```
Pure functions, no React. Tested directly.

### `supabase/functions/_shared/posthogServer.ts`
```ts
export interface ServerEventInput { distinctId: string; event: string; properties?: Record<string, unknown>; }
export async function captureServerEvent(input: ServerEventInput): Promise<void>;
```
- Reads `POSTHOG_PROJECT_KEY` and `POSTHOG_HOST` from `Deno.env`
- If either is missing, logs a warning and no-ops (keeps webhook robust if we ever rotate keys)
- Uses `npm:posthog-node@^4.0.0` (latest stable as of writing; pinned)
- Lazily instantiates a single `PostHog` client per process; calls `capture()` then `await ph.shutdown()` per event (edge functions are short-lived; flush before return)
- Wraps everything in try/catch; errors are logged but never thrown — funnel telemetry must NEVER break a webhook

## Files to modify

### `src/hooks/useAuth.tsx`
- Add new `useEffect` on `[user?.id]` that:
  - If `user` is set AND `localStorage[\`posthog_account_created_${user.id}\`]` is empty AND `user.created_at` is within 5 minutes:
    - Read attribution via `getStoredAttribution()`
    - Call `posthog.identify(user.id, { email, signup_source, signup_medium, signup_campaign, is_internal })`
    - `posthog.capture('account_created', { email })`
    - `posthog.capture('trial_started', { trial_ends_at })`
    - Set localStorage flag
    - Clear stored attribution
  - Else if `user` is set AND flag exists: fire `posthog.identify(user.id, { last_login_at })` (returning user)
- Don't touch `signIn`/`signUp`/`signOut` business logic.

### `src/pages/Auth.tsx`
- Add `useEffect` on `[]` (mount-only):
  - Call `storeAttribution(window.location.search, document.referrer, window.location.pathname)`
- That's it. Mount-time only so refresh-without-params doesn't clobber.

### `src/pages/SquareCallback.tsx`, `ToastCallback.tsx`, `CloverCallback.tsx`
In each `setStatus('success')` block:
- Compute `secondsFromTrialStart = user?.created_at ? (Date.now() - new Date(user.created_at).getTime()) / 1000 : null`
- `posthog.capture('pos_integration_completed', { pos_provider: 'square'|'toast'|'clover', seconds_from_trial_start: secondsFromTrialStart })`

Need to add `useAuth()` import in callbacks that don't have it.

### `src/pages/Index.tsx`
Add `useEffect` on `[periodData, user?.id, user?.created_at]`:
- Guard: `user?.id && periodData && !localStorage.getItem(\`pnl_first_view_seen_${user.id}\`)`
- Capture `first_pnl_viewed` with `seconds_from_trial_start` and `has_real_data`
- Set the localStorage flag

### `supabase/functions/stripe-subscription-webhook/subscription-handler.ts`
- Import the new `captureServerEvent` helper.
- In `customer.subscription.created` case (only this case, not `updated`):
  - After successful DB update, look up owner via `user_restaurants` (similar query already in `syncVolumeDiscountsForOwner`).
  - Compute `mrr_cents`, `billing_period`, `is_annual` from the existing `subscription.items.data[0].price`.
  - Call `captureServerEvent({ distinctId: ownerUserId, event: 'subscription_created', properties: { ... } })`
  - Wrap in try/catch — never break the webhook.
- In `customer.subscription.deleted` case, after successful DB update:
  - Look up owner same way.
  - `captureServerEvent({ distinctId: ownerUserId, event: 'subscription_canceled', properties: { restaurant_id } })`
- Use `event.type === 'customer.subscription.created'` to distinguish — switch case label is shared with `updated` today, so we'll need a runtime check inside.

## Test plan

### Unit tests (vitest)
- `tests/unit/analytics.test.ts`:
  - `isInternalEmail` — true for `@easyshifthq.com` (case-insensitive), false for others, false for null/undefined/empty
  - `storeAttribution` — writes parsed UTM/referrer/landing/captured_at; no-ops when no params and no referrer
  - `storeAttribution` — overwrites only when there's something to store (refresh without params doesn't clobber)
  - `getStoredAttribution` — returns parsed object; returns null if missing/malformed JSON
  - `clearStoredAttribution` — removes the key

### Edge function test (Deno.test)
- `supabase/functions/_shared/posthogServer.test.ts`:
  - When `POSTHOG_PROJECT_KEY`/`POSTHOG_HOST` are unset, `captureServerEvent` resolves without throwing (no-op path)
  - When set, builds correct payload via stubbed `globalThis.fetch` (we'll mock `posthog-node` by stubbing fetch)

### Manual / smoke
- Local: with prod-like env vars in `.env.local`, sign up with a fresh account; verify in PostHog Live Events:
  - `account_created` + `trial_started` fire
  - `pos_integration_completed` after a real Square sandbox connect
  - `first_pnl_viewed` after dashboard load
  - Server: trigger a Stripe test webhook → `subscription_created` appears
- Confirm `is_internal: true` for the test account

## Lessons applied (from `memory/lessons.md`)

- **2026-04-22 — Worktree first:** done before any artifact ✓
- **2026-04-22 — `unknown` not `any` in catches:** webhook try/catch will use `instanceof Error` ✓
- **2026-04-22 — PostgREST cross-schema:** owner lookup goes through `user_restaurants` (public schema) ✓
- **2026-04-26 — CI green ≠ comments addressed:** Phase 9d triage required ✓
- **2026-05-01 — Bot review claims about prior version:** if any bot says "the previous version did X," diff before believing ✓

## Risks / concerns

1. **PostHog server SDK reliability:** `posthog-node` over `npm:` specifier in Deno edge functions. If it fails to import, the whole webhook breaks. Mitigation: import inside try/catch in the helper; fall back to no-op.
2. **Webhook latency:** PostHog `capture()` + `shutdown()` adds ~100-300ms per webhook event. Acceptable; webhook is async from Stripe's perspective.
3. **Magic-link / session restore double-fire:** Mitigated by the localStorage flag + `created_at` recency window.
4. **Test account hygiene:** Without `is_internal` filtering, all your testing skews funnel data. We're shipping the property; you must remember to add the filter to PostHog insights.
