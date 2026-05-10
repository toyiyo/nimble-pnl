# Signup-Path Attribution Design

**Date:** 2026-05-10
**Branch:** `fix/posthog-signup-path-attribution`
**Brief reference:** Claude Code Brief — *Distinguish self-serve signups from team-invitation accepts* (filed by Jose Delgado, 2026-05-10).

## Problem

The PostHog `account_created` event fires for every new Supabase account, regardless of how the account was created. Today the signup path is only visible on **person properties** (`signup_medium`, `signup_source`, `$initial_pathname: /accept-invitation`) — NOT on the event itself, so funnel filters can't see it at the right time.

A new `account_created` on 2026-05-10 03:39 UTC came from `/accept-invitation?token=…` and ended up on `/employee/schedule`. Master Funnel `iXyETFXb` counted that user against trial-→-paid conversion math even though they will never personally purchase a subscription. As more existing customers add seats, every invited employee further dilutes the prospect funnel.

## Goal

Tag every `account_created` event at capture time with three new event properties so saved funnels can filter directly:

- `signup_path: 'self_serve' | 'invitation_accept'`
- `account_role: string` (e.g. `'owner'`, `'manager'`, `'chef'`, `'staff'`, `'employee'`)
- `invited_to_org_id: string | null` — `null` for now (the `validate-invitation` endpoint does not expose `restaurant_id` to the client; deferred to a follow-up PR)

Branch by path:
- `self_serve` continues to fire `trial_started` (with the same three props mixed in).
- `invitation_accept` does **not** fire `trial_started` (an invited member joins an existing tenant's subscription/trial). Instead it fires a new event `team_member_joined` so we have a separate top-of-funnel for "team growth at existing customers."

Mirror the props onto person properties so cohorting and downstream events inherit them.

Out of scope: PostHog insight updates (separate AQ item via PostHog MCP), `is_internal` filter fix (AQ-013), `subscription_created` event (AQ-012), historical-event migration.

## How the brief reconciles with the actual code

The brief was written from a prior file map (`easyshifthq/proposed-changes/2026-05-07-04-nimble-pnl-posthog-events.md`). Three points have moved since:

| Brief assumption | Reality | Decision |
|---|---|---|
| `account_created` captured inline in `useAuth.tsx`'s `onAuthStateChange('SIGNED_IN')` handler | Capture lives in `src/lib/analytics.ts`'s `recordAuthEvents()`, called from a `useEffect` in `useAuth.tsx`. Has a 5-min `NEW_SIGNUP_WINDOW_MS` (not 60s) and a per-user localStorage dedup flag. | Add classification logic to `recordAuthEvents`, not to `useAuth.tsx`. Keep `useAuth.tsx` untouched. |
| `posthog.people.set(signupProps)` | The `PostHogLike` interface only declares `identify` and `capture`. The codebase already sets person properties via the second arg to `posthog.identify(distinctId, props)`. | Mirror props by extending the existing `identify` call: `posthog.identify(userId, { ...attribution, ...signupProps })`. No interface change. |
| `account_created` carries `email` + `attribution` event props | Today `account_created` fires with no props (PII minimization for email; attribution is on `identify` only — see existing test `'PII: email is NOT forwarded to PostHog'`). | Add `signupProps` only to `account_created`. Do NOT forward email or attribution event props (preserve PII contract). |
| `account_role` defaults to `'employee'` for invitations | The validated invitation already carries a `role` field (`'manager'`, `'chef'`, `'staff'`, etc.). | Use `invitation.role` when known; fall back to `'employee'` only while the invitation is still loading. |
| `invited_to_org_id` exposed by validate-invitation | The current `validate-invitation` response returns `restaurant: { name, address }` — no `restaurant_id` on the client. | Send `null` this PR. The brief itself flagged this as optional. Backend exposure is a follow-up. |

## Architecture

### Data flow

```
Auth.tsx mount         → storeSignupPath('self_serve', 'owner')              ↘
                                                                              localStorage signup_path keys
AcceptInvitation mount → storeSignupPath('invitation_accept', role)          ↗
                                                                                          ↓
                                                  useAuth.tsx user resolves → recordAuthEvents
                                                                                          ↓
                            readStoredSignupClassification(window.location.pathname)
                                                                                          ↓
                identify(userId, { ...attribution, ...classification })
                + capture('account_created', classification)
                                                                                          ↓
            self_serve         → capture('trial_started', { trial_ends_at, ...classification })
            invitation_accept  → capture('team_member_joined', classification)
                                                                                          ↓
                                                  clearStoredSignupPath()  +  clearStoredAttribution()
```

### Files

#### 1. `src/lib/analytics.ts` (extend)

New exports:

```ts
export const SIGNUP_PATH_STORAGE_KEY = 'signup_path';
export const SIGNUP_ACCOUNT_ROLE_STORAGE_KEY = 'signup_account_role';
export const SIGNUP_INVITED_TO_ORG_ID_STORAGE_KEY = 'signup_invited_to_org_id';

export type SignupPath = 'self_serve' | 'invitation_accept';

export interface SignupClassification {
  signup_path: SignupPath;
  account_role: string;
  invited_to_org_id: string | null;
}

export function storeSignupPath(
  path: SignupPath,
  accountRole: string,
  invitedToOrgId?: string | null,
): void;

export function readStoredSignupClassification(
  currentPathname: string,
): SignupClassification;

export function clearStoredSignupPath(): void;
```

Behavior:

- `storeSignupPath` writes the three keys (treats `undefined` `invitedToOrgId` as no-write; explicit `null` is also no-write since we never want to broadcast `'null'` as a string). Wraps `setItem` in try/catch (analytics never blocks signup).
- `readStoredSignupClassification(currentPathname)`:
  - If localStorage has `signup_path === 'invitation_accept'`, OR the current pathname starts with `/accept-invitation`, classify as `invitation_accept`.
  - Otherwise classify as `self_serve`.
  - `account_role`: stored value if present; else `'employee'` for `invitation_accept` and `'owner'` for `self_serve`.
  - `invited_to_org_id`: stored value if path is `invitation_accept`; else `null`.
- `clearStoredSignupPath` removes all three keys, swallows any storage exception.

Modify `recordAuthEvents` fresh-signup branch:

```ts
const initialPathname = typeof window !== 'undefined' ? window.location.pathname : '';
const classification = readStoredSignupClassification(initialPathname);

posthog.identify(userId, {
  signup_source: ...,
  signup_medium: ...,
  signup_campaign: ...,
  is_internal: ...,
  ...classification,
});

posthog.capture('account_created', classification);

if (classification.signup_path === 'self_serve') {
  posthog.capture('trial_started', { trial_ends_at, ...classification });
} else {
  posthog.capture('team_member_joined', classification);
}

clearStoredAttribution();
clearStoredSignupPath();
```

The atomic-dedup pattern (set the flag BEFORE firing events) is preserved unchanged.

#### 2. `src/pages/Auth.tsx` (extend the existing `useEffect`)

After the `isOAuthCallback` early return (which already gates `storeAttribution`), add:

```ts
if (!localStorage.getItem(SIGNUP_PATH_STORAGE_KEY)) {
  storeSignupPath('self_serve', 'owner');
}
```

This is gated by the same OAuth-callback bypass so an OAuth redirect to `/auth` does not reset a path that was already tagged by `AcceptInvitation`. The `!localStorage.getItem(...)` first-touch check is the second line of defense.

Imports: `SIGNUP_PATH_STORAGE_KEY, storeSignupPath` from `@/lib/analytics`.

#### 3. `src/pages/AcceptInvitation.tsx` (add a `useEffect`)

```ts
useEffect(() => {
  if (!token) return;
  storeSignupPath('invitation_accept', invitation?.role ?? 'employee');
}, [token, invitation?.role]);
```

Runs on mount with default role `'employee'`, then re-runs once `invitation.role` resolves to overwrite with the real role (`'manager'`, `'chef'`, etc.).

Imports: `storeSignupPath` from `@/lib/analytics`.

#### 4. `tests/unit/analytics.test.ts` (extend)

New `describe('storeSignupPath / readStoredSignupClassification / clearStoredSignupPath')`:
1. `storeSignupPath('self_serve', 'owner')` writes the path and role keys; `invited_to_org_id` key absent.
2. `storeSignupPath('invitation_accept', 'manager', 'org-123')` writes all three keys.
3. `readStoredSignupClassification('/auth')` returns `self_serve` defaults when nothing stored.
4. `readStoredSignupClassification('/accept-invitation?token=abc')` returns `invitation_accept` / `'employee'` / `null` even with empty localStorage (pathname fallback).
5. `readStoredSignupClassification` returns stored values when present; pathname doesn't override.
6. Stored `signup_path: 'invitation_accept'` with no role → `account_role: 'employee'` default.
7. Stored `signup_path: 'self_serve'` returns `invited_to_org_id: null` even if a stale org id key is present (defensive against leftover state).
8. `clearStoredSignupPath()` removes all three keys.
9. `storeSignupPath` survives a `localStorage.setItem` that throws (no rethrow).

Updated existing `recordAuthEvents` tests + new tests:
- The "fires identify + account_created + trial_started" test asserts `account_created` and `trial_started` carry the default `self_serve / owner / null` classification, and `identify` props include `signup_path: 'self_serve'`.
- New: `'classifies invitation_accept from localStorage and fires team_member_joined instead of trial_started'` — given stored `signup_path: 'invitation_accept'`, `account_role: 'manager'`, the test asserts:
  - `account_created` carries `{signup_path: 'invitation_accept', account_role: 'manager', invited_to_org_id: null}`
  - `team_member_joined` fires once with the same classification
  - `trial_started` does NOT fire
- New: `'derives invitation_accept from /accept-invitation pathname when localStorage is empty'` — empty localStorage, pass `now` and stub `window.location.pathname = '/accept-invitation'`. Assert classification is `invitation_accept / 'employee' / null`.
- New: `'clears signup_path localStorage keys on success alongside attribution'` — after fresh signup, all three signup_path keys are gone.

(The existing PII assertion `expect(identifyProps).not.toHaveProperty('email')` continues to hold — we don't add email anywhere.)

## Open questions / risks

- The pathname-fallback in `recordAuthEvents` is defensive belt-and-suspenders. If the entry-page `useEffect` always sets localStorage first, the fallback is unreachable. Keeping it costs nothing and protects against incognito edge cases where a localStorage write might silently fail.
- `team_member_joined` is a new event name. Brief notes "flag if you'd prefer a different convention (`account_invitation_accepted`, etc.)." — easy to rename later.
- Existing tests covering `account_created` / `trial_started` need updates to assert the new classification props. The diff is mechanical (~6 assertions).

## Verification plan

- Unit tests (vitest): all new + updated assertions pass.
- TypeScript: `npm run typecheck` clean.
- Lint: `npm run lint` clean.
- Build: `npm run build` clean.
- Manual smoke test in dev (per brief Edit 4): sign up self-serve → confirm `account_created` and `trial_started` carry `signup_path: 'self_serve'`. Open `/accept-invitation?token=…` → sign up via the invite flow → confirm `account_created` carries `signup_path: 'invitation_accept'` and `team_member_joined` fires (no `trial_started`).

## Out of scope

- PostHog insight filter updates (Jose will queue separately via PostHog MCP after this PR merges).
- `is_internal` filter fix (AQ-013).
- `subscription_created` event (AQ-012).
- Historical-event migration. The 2026-05-10 03:39 UTC `account_created` remains unattributed; we accept that.
- Exposing `restaurant_id` from `validate-invitation` (potential follow-up).
