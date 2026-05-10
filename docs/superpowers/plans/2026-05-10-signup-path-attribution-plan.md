# Signup-Path Attribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tag every PostHog `account_created` event with `signup_path`/`account_role`/`invited_to_org_id` at capture time, suppress `trial_started` for invitation accepts, and emit a new `team_member_joined` event so prospect funnels stop counting invited employees as failed trials.

**Architecture:** Add three new localStorage helpers in `src/lib/analytics.ts` (`storeSignupPath`, `readStoredSignupClassification`, `clearStoredSignupPath`) and extend `recordAuthEvents` to read the classification at capture time. Two entry-page components (`Auth.tsx`, `AcceptInvitation.tsx`) write to localStorage on mount. Person properties are mirrored via the existing `posthog.identify(id, props)` pattern (no `people.set` — the current `PostHogLike` interface doesn't expose it).

**Tech Stack:** TypeScript, React 18, Vitest (jsdom), PostHog JS SDK, React Router 6, Vite.

**Spec:** `docs/superpowers/specs/2026-05-10-signup-path-attribution-design.md`

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `src/lib/analytics.ts` | Modify | Add `SIGNUP_PATH_STORAGE_KEY` etc., `storeSignupPath`, `readStoredSignupClassification`, `clearStoredSignupPath`, and extend `recordAuthEvents` with classification logic + `team_member_joined` capture. |
| `src/pages/Auth.tsx` | Modify | Tag `signup_path: 'self_serve'` in localStorage on mount (gated by `!isOAuthCallback` and `!localStorage.getItem(...)` first-touch). |
| `src/pages/AcceptInvitation.tsx` | Modify | Tag `signup_path: 'invitation_accept'` + role on mount and again when `invitation.role` resolves. |
| `tests/unit/analytics.test.ts` | Modify | Update existing `recordAuthEvents` assertions for new event-prop shape; add new `describe` block for the three new helpers; add new tests for invitation classification and pathname fallback. |

No new files. All changes additive within existing files.

---

## Pre-flight checks

- [ ] **Confirm dev environment.** Run from the worktree root: `pwd` → `/Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/posthog-signup-path-attribution`. Run `git rev-parse --abbrev-ref HEAD` → `fix/posthog-signup-path-attribution`.

- [ ] **Confirm test command works.** Run: `npm test -- tests/unit/analytics.test.ts --run` → existing 30+ tests pass.

---

## Task 1: Add signup-path constants, types, and storage helpers in `analytics.ts`

**Goal:** Introduce the storage keys, the `SignupPath` type, and the three helpers (`storeSignupPath`, `readStoredSignupClassification`, `clearStoredSignupPath`). No behavior change to `recordAuthEvents` yet — that comes in Task 2.

**Files:**
- Modify: `src/lib/analytics.ts`
- Test: `tests/unit/analytics.test.ts` (new `describe` block)

- [ ] **Step 1.1: Write the failing tests for the new helpers**

Append a new `describe` block to `tests/unit/analytics.test.ts` (after the `clearStoredAttribution` block, before `recordAuthEvents`):

```ts
describe('storeSignupPath / readStoredSignupClassification / clearStoredSignupPath', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('storeSignupPath writes path and role keys', () => {
    storeSignupPath('self_serve', 'owner');
    expect(localStorage.getItem(SIGNUP_PATH_STORAGE_KEY)).toBe('self_serve');
    expect(localStorage.getItem(SIGNUP_ACCOUNT_ROLE_STORAGE_KEY)).toBe('owner');
    expect(localStorage.getItem(SIGNUP_INVITED_TO_ORG_ID_STORAGE_KEY)).toBeNull();
  });

  it('storeSignupPath writes invited_to_org_id when provided', () => {
    storeSignupPath('invitation_accept', 'manager', 'org-123');
    expect(localStorage.getItem(SIGNUP_PATH_STORAGE_KEY)).toBe('invitation_accept');
    expect(localStorage.getItem(SIGNUP_ACCOUNT_ROLE_STORAGE_KEY)).toBe('manager');
    expect(localStorage.getItem(SIGNUP_INVITED_TO_ORG_ID_STORAGE_KEY)).toBe('org-123');
  });

  it('storeSignupPath does not write invited_to_org_id when null is passed', () => {
    storeSignupPath('invitation_accept', 'employee', null);
    expect(localStorage.getItem(SIGNUP_INVITED_TO_ORG_ID_STORAGE_KEY)).toBeNull();
  });

  it('readStoredSignupClassification returns self_serve defaults when nothing stored', () => {
    const result = readStoredSignupClassification('/auth');
    expect(result).toEqual({
      signup_path: 'self_serve',
      account_role: 'owner',
      invited_to_org_id: null,
    });
  });

  it('readStoredSignupClassification derives invitation_accept from /accept-invitation pathname', () => {
    const result = readStoredSignupClassification('/accept-invitation?token=abc');
    expect(result).toEqual({
      signup_path: 'invitation_accept',
      account_role: 'employee',
      invited_to_org_id: null,
    });
  });

  it('readStoredSignupClassification returns stored values when present', () => {
    storeSignupPath('invitation_accept', 'manager', 'org-456');
    const result = readStoredSignupClassification('/auth');
    expect(result).toEqual({
      signup_path: 'invitation_accept',
      account_role: 'manager',
      invited_to_org_id: 'org-456',
    });
  });

  it('readStoredSignupClassification: invitation_accept without role falls back to employee', () => {
    localStorage.setItem(SIGNUP_PATH_STORAGE_KEY, 'invitation_accept');
    const result = readStoredSignupClassification('/auth');
    expect(result.signup_path).toBe('invitation_accept');
    expect(result.account_role).toBe('employee');
  });

  it('readStoredSignupClassification: self_serve always returns null org id even with stale value', () => {
    // Defensive: a stale invited_to_org_id key from a prior incomplete flow
    // should not leak into a self_serve classification.
    localStorage.setItem(SIGNUP_INVITED_TO_ORG_ID_STORAGE_KEY, 'stale-org');
    const result = readStoredSignupClassification('/auth');
    expect(result.signup_path).toBe('self_serve');
    expect(result.invited_to_org_id).toBeNull();
  });

  it('clearStoredSignupPath removes all three keys', () => {
    storeSignupPath('invitation_accept', 'manager', 'org-789');
    clearStoredSignupPath();
    expect(localStorage.getItem(SIGNUP_PATH_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(SIGNUP_ACCOUNT_ROLE_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(SIGNUP_INVITED_TO_ORG_ID_STORAGE_KEY)).toBeNull();
  });

  it('storeSignupPath survives a localStorage that throws on setItem (no rethrow)', () => {
    const setItemMock = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });
    expect(() => storeSignupPath('self_serve', 'owner')).not.toThrow();
    setItemMock.mockRestore();
  });
});
```

Update the imports at the top of `tests/unit/analytics.test.ts` to include the new symbols:

```ts
import {
  ATTRIBUTION_STORAGE_KEY,
  INTERNAL_DOMAINS,
  NEW_SIGNUP_WINDOW_MS,
  SIGNUP_ACCOUNT_ROLE_STORAGE_KEY,
  SIGNUP_INVITED_TO_ORG_ID_STORAGE_KEY,
  SIGNUP_PATH_STORAGE_KEY,
  TRIAL_DURATION_DAYS,
  accountCreatedFlagKey,
  clearStoredAttribution,
  clearStoredSignupPath,
  firstPnlViewedFlagKey,
  getStoredAttribution,
  isInternalEmail,
  posIntegrationCompletedFlagKey,
  readStoredSignupClassification,
  recordAuthEvents,
  recordFirstPnlViewed,
  recordPosIntegrationCompleted,
  storeAttribution,
  storeSignupPath,
} from '../../src/lib/analytics';
```

- [ ] **Step 1.2: Run tests to verify they fail**

Run: `npm test -- tests/unit/analytics.test.ts --run`
Expected: 10 new tests fail with import errors / `is not a function` errors. Existing tests still pass.

- [ ] **Step 1.3: Implement the helpers in `src/lib/analytics.ts`**

After the `clearStoredAttribution` function (around line 95), insert the new constants, type, and helpers (before the `NEW_SIGNUP_WINDOW_MS` constant):

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

const ACCEPT_INVITATION_PATHNAME_PREFIX = '/accept-invitation';

function defaultRoleForPath(path: SignupPath): string {
  return path === 'invitation_accept' ? 'employee' : 'owner';
}

export function storeSignupPath(
  path: SignupPath,
  accountRole: string,
  invitedToOrgId?: string | null,
): void {
  try {
    localStorage.setItem(SIGNUP_PATH_STORAGE_KEY, path);
    localStorage.setItem(SIGNUP_ACCOUNT_ROLE_STORAGE_KEY, accountRole);
    if (invitedToOrgId) {
      localStorage.setItem(SIGNUP_INVITED_TO_ORG_ID_STORAGE_KEY, invitedToOrgId);
    }
  } catch {
    // Storage disabled / quota exceeded — analytics must never block signup.
  }
}

export function readStoredSignupClassification(currentPathname: string): SignupClassification {
  let storedPath: string | null = null;
  let storedRole: string | null = null;
  let storedOrgId: string | null = null;
  try {
    storedPath = localStorage.getItem(SIGNUP_PATH_STORAGE_KEY);
    storedRole = localStorage.getItem(SIGNUP_ACCOUNT_ROLE_STORAGE_KEY);
    storedOrgId = localStorage.getItem(SIGNUP_INVITED_TO_ORG_ID_STORAGE_KEY);
  } catch {
    // ignore — fall through to defaults
  }

  const isInvitationByPathname =
    typeof currentPathname === 'string' && currentPathname.startsWith(ACCEPT_INVITATION_PATHNAME_PREFIX);
  const signup_path: SignupPath =
    storedPath === 'invitation_accept' || isInvitationByPathname ? 'invitation_accept' : 'self_serve';

  const account_role = storedRole && storedRole.length > 0 ? storedRole : defaultRoleForPath(signup_path);
  const invited_to_org_id = signup_path === 'invitation_accept' ? storedOrgId : null;

  return { signup_path, account_role, invited_to_org_id };
}

export function clearStoredSignupPath(): void {
  try {
    localStorage.removeItem(SIGNUP_PATH_STORAGE_KEY);
    localStorage.removeItem(SIGNUP_ACCOUNT_ROLE_STORAGE_KEY);
    localStorage.removeItem(SIGNUP_INVITED_TO_ORG_ID_STORAGE_KEY);
  } catch {
    // ignore
  }
}
```

- [ ] **Step 1.4: Run tests to verify they pass**

Run: `npm test -- tests/unit/analytics.test.ts --run`
Expected: All tests pass (existing + 10 new). No `recordAuthEvents` tests changed yet.

- [ ] **Step 1.5: Commit**

```bash
git add src/lib/analytics.ts tests/unit/analytics.test.ts
git commit -m "feat(analytics): add signup-path classification helpers

Adds storeSignupPath, readStoredSignupClassification, clearStoredSignupPath
plus the SIGNUP_PATH_STORAGE_KEY family of constants. recordAuthEvents is
unchanged; classification wiring lands in the next commit.

Co-Authored-By: Jose Delgado <jose.delgado@easyshifthq.com>
Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 2: Wire classification into `recordAuthEvents` and emit `team_member_joined`

**Goal:** Read the classification inside the fresh-signup branch, mirror it onto `posthog.identify` and `account_created`, and branch trial_started vs team_member_joined by `signup_path`.

**Files:**
- Modify: `src/lib/analytics.ts:118-173` (the `recordAuthEvents` body)
- Test: `tests/unit/analytics.test.ts` (update existing `recordAuthEvents` assertions; add 4 new tests)

- [ ] **Step 2.1: Update existing `recordAuthEvents` test assertions**

In `tests/unit/analytics.test.ts`, find the test `'fires identify + account_created + trial_started for a fresh signup'` (around line 192). Modify the assertions to expect the default `self_serve` classification:

```ts
it('fires identify + account_created + trial_started for a fresh signup', () => {
  storeAttribution('?utm_source=google&utm_medium=cpc&utm_campaign=launch', '', '/auth');

  recordAuthEvents({
    userId: 'user-1',
    email: 'jose@example.com',
    createdAt: RECENT_CREATED_AT,
    posthog,
    now: FIXED_NOW,
  });

  expect(posthog.identify).toHaveBeenCalledTimes(1);
  expect(posthog.identify).toHaveBeenCalledWith('user-1', expect.objectContaining({
    signup_source: 'google',
    signup_medium: 'cpc',
    signup_campaign: 'launch',
    is_internal: false,
    signup_path: 'self_serve',
    account_role: 'owner',
    invited_to_org_id: null,
  }));
  // PII: email is NOT forwarded to PostHog
  const identifyProps = posthog.identify.mock.calls[0][1];
  expect(identifyProps).not.toHaveProperty('email');

  expect(posthog.capture).toHaveBeenCalledTimes(2);
  expect(posthog.capture).toHaveBeenCalledWith('account_created', {
    signup_path: 'self_serve',
    account_role: 'owner',
    invited_to_org_id: null,
  });
  const trialEndsAt = new Date(FIXED_NOW.getTime() + TRIAL_DURATION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  expect(posthog.capture).toHaveBeenCalledWith('trial_started', {
    trial_ends_at: trialEndsAt,
    signup_path: 'self_serve',
    account_role: 'owner',
    invited_to_org_id: null,
  });

  expect(localStorage.getItem(accountCreatedFlagKey('user-1'))).toBeTruthy();
  expect(localStorage.getItem(ATTRIBUTION_STORAGE_KEY)).toBeNull();
});
```

In `'handles missing email gracefully (still identifies, is_internal:false)'` (around line 318), update the last assertion:

```ts
expect(posthog.capture).toHaveBeenCalledWith('account_created', {
  signup_path: 'self_serve',
  account_role: 'owner',
  invited_to_org_id: null,
});
```

In `'does not re-fire account_created if trial_started capture throws (atomic dedup)'` (around line 350), the existing assertions use `expect.anything()` and string-only matchers — those continue to hold without changes.

In `'does not double-fire account_created if the flag is set'` (around line 270), the assertions use `expect.anything()` — also unchanged.

- [ ] **Step 2.2: Add 4 new `recordAuthEvents` tests**

Append these tests to the existing `describe('recordAuthEvents')` block, before its closing `})`:

```ts
it('classifies invitation_accept from localStorage and fires team_member_joined instead of trial_started', () => {
  storeSignupPath('invitation_accept', 'manager');

  recordAuthEvents({
    userId: 'user-invite-1',
    email: 'jose@example.com',
    createdAt: RECENT_CREATED_AT,
    posthog,
    now: FIXED_NOW,
  });

  expect(posthog.identify).toHaveBeenCalledWith('user-invite-1', expect.objectContaining({
    signup_path: 'invitation_accept',
    account_role: 'manager',
    invited_to_org_id: null,
  }));

  expect(posthog.capture).toHaveBeenCalledWith('account_created', {
    signup_path: 'invitation_accept',
    account_role: 'manager',
    invited_to_org_id: null,
  });
  expect(posthog.capture).toHaveBeenCalledWith('team_member_joined', {
    signup_path: 'invitation_accept',
    account_role: 'manager',
    invited_to_org_id: null,
  });
  expect(posthog.capture).not.toHaveBeenCalledWith('trial_started', expect.anything());
});

it('derives invitation_accept from /accept-invitation pathname when localStorage is empty', () => {
  // Stub window.location.pathname for this test.
  const originalLocation = window.location;
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...originalLocation, pathname: '/accept-invitation' },
  });

  try {
    recordAuthEvents({
      userId: 'user-invite-fallback',
      email: 'jose@example.com',
      createdAt: RECENT_CREATED_AT,
      posthog,
      now: FIXED_NOW,
    });

    expect(posthog.capture).toHaveBeenCalledWith('account_created', {
      signup_path: 'invitation_accept',
      account_role: 'employee',
      invited_to_org_id: null,
    });
    expect(posthog.capture).toHaveBeenCalledWith('team_member_joined', expect.objectContaining({
      signup_path: 'invitation_accept',
    }));
    expect(posthog.capture).not.toHaveBeenCalledWith('trial_started', expect.anything());
  } finally {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: originalLocation,
    });
  }
});

it('clears signup_path localStorage keys on success alongside attribution', () => {
  storeAttribution('?utm_source=google', '', '/auth');
  storeSignupPath('invitation_accept', 'chef');

  recordAuthEvents({
    userId: 'user-cleanup',
    email: 'jose@example.com',
    createdAt: RECENT_CREATED_AT,
    posthog,
    now: FIXED_NOW,
  });

  expect(localStorage.getItem(ATTRIBUTION_STORAGE_KEY)).toBeNull();
  expect(localStorage.getItem(SIGNUP_PATH_STORAGE_KEY)).toBeNull();
  expect(localStorage.getItem(SIGNUP_ACCOUNT_ROLE_STORAGE_KEY)).toBeNull();
  expect(localStorage.getItem(SIGNUP_INVITED_TO_ORG_ID_STORAGE_KEY)).toBeNull();
});

it('passes invited_to_org_id through when stored', () => {
  storeSignupPath('invitation_accept', 'staff', 'org-xyz');

  recordAuthEvents({
    userId: 'user-org-id',
    email: 'jose@example.com',
    createdAt: RECENT_CREATED_AT,
    posthog,
    now: FIXED_NOW,
  });

  expect(posthog.capture).toHaveBeenCalledWith('account_created', {
    signup_path: 'invitation_accept',
    account_role: 'staff',
    invited_to_org_id: 'org-xyz',
  });
});
```

- [ ] **Step 2.3: Run tests to verify they fail**

Run: `npm test -- tests/unit/analytics.test.ts --run`
Expected: The 4 new tests fail; the modified existing tests fail (because `recordAuthEvents` still fires the old shape). Other tests still pass.

- [ ] **Step 2.4: Modify `recordAuthEvents` in `src/lib/analytics.ts`**

Find the existing implementation (around line 134-168, the inside of the `try` block). Replace it with:

```ts
  try {
    if (isRecentSignup && !flagAlreadySet) {
      // Set the dedup flag BEFORE firing events so a partial failure
      // (e.g. trial_started throws after account_created succeeds) doesn't
      // re-fire account_created on the next session restore. account_created
      // is a one-time signup signal — losing it on a transient outage is
      // preferable to double-counting it.
      try {
        localStorage.setItem(accountCreatedFlagKey(userId), '1');
      } catch {
        // ignore
      }

      const attribution = getStoredAttribution();
      const trialEndsAt = new Date(now.getTime() + TRIAL_DURATION_DAYS * 24 * 60 * 60 * 1000).toISOString();

      // Classify signup path. The entry-page components (Auth.tsx for self-serve,
      // AcceptInvitation.tsx for invites) write the signup_path/account_role keys
      // to localStorage on mount. We fall back to deriving from the current pathname
      // for the edge case where localStorage was unavailable at the entry-page mount.
      const initialPathname =
        typeof window !== 'undefined' && window.location ? window.location.pathname : '';
      const classification = readStoredSignupClassification(initialPathname);

      // Email is used locally to compute is_internal and then discarded —
      // it is NOT forwarded to PostHog (PII minimization).
      const safeEmail = email ?? null;
      posthog.identify(userId, {
        signup_source: attribution?.utm_source || attribution?.referrer || 'direct',
        signup_medium: attribution?.utm_medium || 'organic',
        signup_campaign: attribution?.utm_campaign ?? null,
        is_internal: isInternalEmail(safeEmail),
        ...classification,
      });

      posthog.capture('account_created', { ...classification });

      // trial_started fires only for self-serve signups. Invited team members
      // join an existing tenant's existing subscription/trial — they don't
      // start their own. team_member_joined gives us a separate top-of-funnel
      // for "team growth at existing customers" without polluting the prospect
      // funnel.
      if (classification.signup_path === 'self_serve') {
        posthog.capture('trial_started', { trial_ends_at: trialEndsAt, ...classification });
      } else {
        posthog.capture('team_member_joined', { ...classification });
      }

      clearStoredAttribution();
      clearStoredSignupPath();
    } else {
      posthog.identify(userId, {
        last_login_at: now.toISOString(),
      });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[analytics] recordAuthEvents failed:', msg);
  }
```

- [ ] **Step 2.5: Run tests to verify they pass**

Run: `npm test -- tests/unit/analytics.test.ts --run`
Expected: All `recordAuthEvents` tests pass — existing (modified) + 4 new. All `storeSignupPath` tests still pass. All other tests still pass.

- [ ] **Step 2.6: Commit**

```bash
git add src/lib/analytics.ts tests/unit/analytics.test.ts
git commit -m "feat(analytics): tag signups with path/role/org_id, emit team_member_joined

recordAuthEvents now reads the signup classification from localStorage (with
/accept-invitation pathname fallback) and mirrors it onto posthog.identify
person properties + the account_created event. trial_started fires only for
self_serve; invitation_accept fires team_member_joined instead.

Co-Authored-By: Jose Delgado <jose.delgado@easyshifthq.com>
Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 3: Tag self-serve path in `Auth.tsx`

**Goal:** Have `/auth` write `signup_path: 'self_serve'`, `account_role: 'owner'` to localStorage on mount, gated by the existing `isOAuthCallback` check and a first-touch `!localStorage.getItem(...)` guard.

**Files:**
- Modify: `src/pages/Auth.tsx:18,31-44`

- [ ] **Step 3.1: Update the import**

In `src/pages/Auth.tsx`, change line 18:

```ts
import { storeAttribution } from '@/lib/analytics';
```

to:

```ts
import { SIGNUP_PATH_STORAGE_KEY, storeAttribution, storeSignupPath } from '@/lib/analytics';
```

- [ ] **Step 3.2: Extend the existing useEffect**

Find the existing `useEffect` at line 31-44 and replace it with:

```ts
useEffect(() => {
  // Auth.tsx is also the OAuth callback URI. We want first-touch UTMs and
  // legitimate referrers (e.g. user clicked a link from a blog post with no
  // UTM tags), but we DON'T want an OAuth redirect to capture the OAuth
  // provider's domain as the referrer. The narrowest signal for that is the
  // OAuth response params: providers always echo back `?code=…` on success
  // and `?error=…` on denial. Skip those; storeAttribution itself takes care
  // of first-touch preservation for the rest.
  const params = new URLSearchParams(window.location.search);
  const isOAuthCallback =
    params.has('code') || params.has('error') || params.has('error_description');
  if (isOAuthCallback) return;
  storeAttribution(window.location.search, document.referrer, window.location.pathname);

  // Tag the signup path so recordAuthEvents can disambiguate self-serve
  // from invitation accepts. Only write if not already set (an
  // /accept-invitation flow may have set it first; preserve first-touch).
  if (!localStorage.getItem(SIGNUP_PATH_STORAGE_KEY)) {
    storeSignupPath('self_serve', 'owner');
  }
}, []);
```

- [ ] **Step 3.3: Run typecheck and lint**

Run: `npm run typecheck`
Expected: No errors.

Run: `npm run lint -- src/pages/Auth.tsx`
Expected: No errors.

- [ ] **Step 3.4: Commit**

```bash
git add src/pages/Auth.tsx
git commit -m "feat(auth): tag self_serve signup path on /auth mount

Writes signup_path='self_serve', signup_account_role='owner' to localStorage
unless the path was already tagged (e.g. by /accept-invitation). Gated by the
existing isOAuthCallback short-circuit so OAuth callback redirects don't
clobber a prior tag.

Co-Authored-By: Jose Delgado <jose.delgado@easyshifthq.com>
Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 4: Tag invitation_accept path in `AcceptInvitation.tsx`

**Goal:** Have `/accept-invitation` write `signup_path: 'invitation_accept'` immediately on mount with default role `'employee'`, then re-write with the real role once the invitation validates.

**Files:**
- Modify: `src/pages/AcceptInvitation.tsx:14,41-45`

- [ ] **Step 4.1: Update the import**

In `src/pages/AcceptInvitation.tsx`, change line 14:

```ts
import { classifyInvitationError } from '@/lib/invitationUtils';
```

Add immediately after it:

```ts
import { storeSignupPath } from '@/lib/analytics';
```

- [ ] **Step 4.2: Add the tagging useEffect**

Find the existing `useEffect` at lines 41-45:

```ts
useEffect(() => {
  if (token) {
    validateInvitation();
  }
}, [token]);
```

Add a new `useEffect` immediately after it (and before the `useEffect` that handles `[user, invitation, status]`):

```ts
useEffect(() => {
  if (!token) return;
  // Tag the signup path BEFORE auth completes so recordAuthEvents can
  // distinguish invited employees from prospective customers. Use the
  // invitation's role when known (e.g. 'manager', 'chef'); fall back to
  // 'employee' while the invitation is still validating.
  storeSignupPath('invitation_accept', invitation?.role ?? 'employee');
}, [token, invitation?.role]);
```

- [ ] **Step 4.3: Run typecheck and lint**

Run: `npm run typecheck`
Expected: No errors.

Run: `npm run lint -- src/pages/AcceptInvitation.tsx`
Expected: No errors.

- [ ] **Step 4.4: Commit**

```bash
git add src/pages/AcceptInvitation.tsx
git commit -m "feat(invitation): tag invitation_accept signup path on mount

Writes signup_path='invitation_accept' to localStorage as soon as the token
query param is present, with default role 'employee'. Re-writes with the
real role once the invitation validates.

Co-Authored-By: Jose Delgado <jose.delgado@easyshifthq.com>
Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 5: Full-suite verification

**Goal:** Confirm all tests pass and the project still builds.

- [ ] **Step 5.1: Run all unit tests**

Run: `npm test -- --run`
Expected: All tests pass. No new failures elsewhere in the suite.

- [ ] **Step 5.2: Typecheck**

Run: `npm run typecheck`
Expected: No errors.

- [ ] **Step 5.3: Lint**

Run: `npm run lint`
Expected: No new errors. (Pre-existing warnings unchanged.)

- [ ] **Step 5.4: Build**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 5.5: If any of the above fail, fix and re-commit**

Loop locally until green before proceeding to PR. Max 5 iterations per CLAUDE.md.

---

## Self-Review checklist

- [x] Spec coverage: Every requirement in `2026-05-10-signup-path-attribution-design.md` maps to a Task (1=helpers, 2=recordAuthEvents+team_member_joined, 3=Auth, 4=AcceptInvitation, 5=verify).
- [x] No placeholders: every code block is fully written.
- [x] Type consistency: `SignupPath`, `SignupClassification`, `storeSignupPath`, `readStoredSignupClassification`, `clearStoredSignupPath` used consistently across tasks 1, 2, 3, 4.
- [x] PII contract preserved: tests assert email not in identify props; no test or code adds email to event props.
- [x] Atomic dedup preserved: `accountCreatedFlagKey` is set BEFORE any capture, including the new `team_member_joined`.
- [x] First-touch preservation: `Auth.tsx` only writes if path key is absent; `AcceptInvitation.tsx` re-runs when `invitation.role` resolves so it can overwrite the default 'employee' with the real role.
