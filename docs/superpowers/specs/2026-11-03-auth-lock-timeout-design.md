# Auth Lock Timeout: Design

Date: 2026-11-03
Branch: `fix/auth-lock-timeout`
Status: Draft for approval

## Intent

One stuck tab must not block the app in other tabs indefinitely.

## Problem

Every tab of `app.easyshifthq.com` stopped at `Initializing...` with no console
error. The site was up. The Web Locks state in production Chrome showed these
values:

- `lock:sb-ncdujvdgqtaunuyigflp-auth-token` was held by one client.
- 55 requests were pending.
- 5 clients took part.

After the other tabs closed, the lock counts went to 0 and the page went to
`/auth`. Which tab held the lock, and why it did not release the lock, is not
known.

## How the hang occurs

1. `initializeAuth` awaits `supabase.auth.getSession()`
   (`src/hooks/useAuth.tsx:72`).
2. While that promise is open, `initialized` stays `false`
   (`src/hooks/useAuth.tsx:26`). The page shows `Initializing...`
   (`src/hooks/useAuth.tsx:289`).
3. `getSession` calls `_acquireLock(-1, ...)`
   (`node_modules/@supabase/auth-js/dist/main/GoTrueClient.js:908`).
4. A negative timeout gives `navigatorLock` no timer
   (`node_modules/@supabase/auth-js/dist/main/lib/locks.js:65`). The request
   stays in the queue until the holder releases the lock.

The lock is shared by all tabs of one origin. Thus one holder blocks all tabs.

## Goals

- A tab that waits for the auth lock recovers without user action.
- The recovery time is about 10 to 12 seconds.
- A recovery writes a console warning, so that the event is visible.
- A logged-in user stays logged in after a recovery.

## Non-goals

- Find why the holder did not release the lock. The evidence is gone. The
  console warning gives data for a later investigation.
- Upgrade `supabase-js`. The latest `auth-js` (2.118.0) has this recovery, but
  it also changes the default lock path. That upgrade can be a separate task.
- Repair the stuck tab. That tab stays stuck until the user reloads it.
- Change the UI.

## Anti-goals

The fix fails if any of these occur, even if the hang stops:

- A timeout sends a logged-in user to the sign-in page.
- One call runs its auth operation two times.
- Tabs steal the lock from each other in a repeated cycle.

## Design

### New file: `src/lib/authLock.ts`

The file exports one function with the signature of the `lock` client option:

```ts
authLock<R>(name: string, acquireTimeout: number, fn: () => Promise<R>): Promise<R>
```

The function has these behaviors:

| Case | Behavior |
|------|----------|
| `navigator.locks` does not exist | Run `fn` with no lock. |
| `acquireTimeout >= 0` | Call `navigatorLock` from `@supabase/supabase-js`, with no change. |
| `acquireTimeout < 0`, lock granted in time | Run `fn`. |
| `acquireTimeout < 0`, wait limit expires | Write a console warning, then request the lock with `steal: true` and run `fn`. |
| This call holds the lock, and another request steals it | Do not steal back. Return the result of the `fn` that is in progress. |

### Why each behavior is necessary

**No `navigator.locks`.** The client uses a custom lock whenever one is set
(`GoTrueClient.js:98-99`). The default code selects `navigatorLock` only when
the API exists, and otherwise selects `lockNoOp` (`GoTrueClient.js:102-105`).
`authLock` must keep that fallback.

**`acquireTimeout >= 0`.** The auto refresh tick uses a timeout of 0
(`GoTrueClient.js:1947`). It depends on an error with `isAcquireTimeout`
(`GoTrueClient.js:1975`). Delegation keeps this contract.

**Do not call `navigatorLock` with a positive timeout for the wait.** The
abort from a wait timeout and the abort from a stolen lock both reject with
`AbortError`. In 2.71.1, `navigatorLock` does not separate them and does not
clear its timer (`locks.js:65-72`). A wrapper around it can misread a stolen
lock as a timeout. It then steals back and runs `fn` a second time. Thus
`authLock` calls `navigator.locks.request` directly on this path. It records
whether the lock was granted, and it decides from that record. The upstream
2.118.0 code makes the same separation with `abortController.signal.aborted`.

**Stolen holder returns the result of `fn`.** Upstream 2.118.0 throws a timeout
error in this case. That is not correct for this app. The error reaches the
`catch` at `src/hooks/useAuth.tsx:90`, which sets `initialized` with no user. A
slow tab with a valid session then looks logged out. Per the Web Locks
specification, the callback of the old holder continues to run. Thus `authLock`
keeps the `fn` promise and returns it. An error from `fn` itself still reaches
the caller, and `authLock` must not treat that error as a wait timeout.

### Wait limit

The wait limit is 10 seconds plus a random value from 0 to 2 seconds, for each
call. The 10 seconds is a design choice. Normal lock operations take much less
time.

The random value prevents a burst of steals. The production case had 55 waiting
requests. Without the random value, requests that started together time out
together and all steal. With it, the first request steals the lock, finishes,
and releases it. The queue then drains in the normal way before the other
requests reach their limits. If the new holder also hangs, the next request to
reach its limit steals the lock.

### Console warning

The warning contains the lock name and the wait time. It contains no session
or user data.

### Change to `src/integrations/supabase/client.ts`

Add `lock: authLock` to the `auth` options at
`src/integrations/supabase/client.ts:18-20`. This file has the header
"automatically generated", but it also holds manual production defaults. A
later regeneration can remove this option. The builder adds a short comment at
the option.

### No change to `src/hooks/useAuth.tsx`

After a steal, `getSession` returns the real session. The startup logic stays
correct, and a timeout does not become a sign-out.

## Accepted risks

- **Two holders.** After a steal, the old `fn` can run together with the new
  `fn`. If both refresh the token, they use the same refresh token. This occurs
  only when a holder is slower than the wait limit. The stuck tab case has no
  active work. For a slow holder, the result depends on the refresh token reuse
  interval of the production auth project. `supabase/config.toml` does not set
  this value, and this design did not check the production value. The builder
  does not need this value, but the PR must state this risk.
- **A hang inside `fn`.** If `fn` hangs in the tab that steals the lock, that
  call stays open. Another tab can still recover by the same steal. The lock
  limits the wait, not the operation.
- **`lock` option deprecation.** The option is deprecated in later `auth-js`
  versions and goes away in v3. The future upgrade removes `authLock`.

## Tests

Unit tests in `tests/unit/authLock.test.ts` use a fake `navigator.locks` and
fake timers. They cover each row of the behavior table, and these cases:

- `fn` runs exactly one time when a holder loses the lock after the grant.
- An `AbortError` thrown by `fn` itself does not cause a steal.
- The wait timer does not fire after a grant.
- The steal occurs in the 10 to 12 second range.

A real browser test covers what a fake cannot: hold the lock in one page with a
promise that never settles, open a second page in the same browser context, and
confirm that the second page leaves `Initializing...` in about 12 seconds. A
Playwright spec is preferred if the local stack permits it.

## Left to the builder

- The names of internal helpers and constants.
- The exact warning text.
- The location of the E2E spec.
