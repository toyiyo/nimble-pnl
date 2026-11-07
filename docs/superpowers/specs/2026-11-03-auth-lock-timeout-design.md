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
3. `getSession` first awaits `initializePromise`
   (`node_modules/@supabase/auth-js/dist/main/GoTrueClient.js:907`). The client
   starts that work at creation, and it calls `_acquireLock(-1, ...)`
   (`GoTrueClient.js:188`). A stuck holder blocks this call first.
   `getSession` then makes its own `_acquireLock(-1, ...)` call
   (`GoTrueClient.js:908`).
4. A negative timeout gives `navigatorLock` no timer
   (`node_modules/@supabase/auth-js/dist/main/lib/locks.js:65`). The request
   stays in the queue until the holder releases the lock.

The lock is shared by all tabs of one origin. Thus one holder blocks all tabs.

The citations use `dist/main`. The browser build uses `dist/module`, which has
the same code. The installed version is `@supabase/auth-js` 2.71.1.

## Goals

- A tab that waits for the auth lock recovers without user action.
- The recovery time is up to 12 seconds after a tab starts to wait.
- A recovery writes a console warning, so that the event is visible.
- A logged-in user stays logged in after a recovery.

## Non-goals

- Find why the holder did not release the lock. The evidence is gone. The
  console warning gives data for a later investigation.
- Upgrade `supabase-js`. The latest `auth-js` (2.118.0) has this recovery, but
  it also changes the default lock path. That upgrade can be a separate task.
- Fix the stuck tab. In that tab `lockAcquired` stays `true`
  (`GoTrueClient.js:942`), so later calls join `pendingInLock`
  (`GoTrueClient.js:921-936`) and never reach `authLock`. That tab stays stuck
  until the user reloads it.
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
| `navigator.locks` does not exist | Run `fn` with no lock. Check this inside the function on each call, not at module load. |
| `acquireTimeout >= 0` | Call `navigatorLock` from `@supabase/supabase-js`, with no change. |
| `acquireTimeout < 0`, lock granted in time | Run `fn`. |
| `acquireTimeout < 0`, wait limit expires, holder is the same | Write one console warning, then request the lock with `steal: true` and run `fn`. |
| `acquireTimeout < 0`, wait limit expires, holder changed | The lock is in use and moves between holders. Keep the request in the queue and start a new wait limit. |
| This call holds the lock, and another request steals it | Do not steal back. Return the result of the `fn` that is in progress. If `fn` rejects, reject with that error. |

Each call runs `fn` exactly one time.

### Why each behavior is necessary

**No `navigator.locks`.** The client uses a custom lock whenever one is set
(`GoTrueClient.js:98-99`). The default code selects `navigatorLock` only in a
browser with the API, and otherwise selects `lockNoOp`
(`GoTrueClient.js:101-105`). The jsdom unit test environment has no
`navigator.locks`.
`authLock` must keep that fallback.

**`acquireTimeout >= 0`.** All `_acquireLock` callers in 2.71.1 use `-1` or `0`.
The auto refresh tick uses a timeout of 0
(`GoTrueClient.js:1947`). It depends on an error with `isAcquireTimeout`
(`GoTrueClient.js:1975`). Delegation keeps this contract.

**Do not call `navigatorLock` with a positive timeout for the wait.** The
abort from a wait timeout and the abort from a stolen lock both reject with
`AbortError`. In 2.71.1, `navigatorLock` does not separate them and does not
clear its timer (`locks.js:65-72`). A wrapper around it can misread a stolen
lock as a timeout. It then steals back and runs `fn` a second time. Thus
`authLock` calls `navigator.locks.request` directly on this path. It records
whether the lock was granted, and it decides from that record. The upstream
2.118.0 code makes the same separation with `abortController.signal.aborted`
(`dist/main/lib/locks.js:178-226` in the npm package).

**Stolen holder returns the result of `fn`.** Upstream 2.118.0 throws a timeout
error in this case. That is not correct for this app. The error reaches the
`catch` at `src/hooks/useAuth.tsx:90`, which sets `initialized` with no user. A
slow tab with a valid session then looks logged out. Per the
[Web Locks specification](https://w3c.github.io/web-locks/), the `request()`
promise of the old holder rejects with `AbortError`, and its callback continues
to run. Thus `authLock` keeps the `fn` promise and returns it. An error from
`fn` itself still reaches the caller, and `authLock` must not treat that error
as a wait timeout.

**Holder check.** The wait limit starts when the request starts, not when the
current holder starts. A request can reach its limit behind a queue of healthy
holders. Thus `authLock` calls `navigator.locks.query()` at the start of the
wait and again at the limit. It compares the `clientId` of the held entry for
this lock name. A changed holder means that the lock moves, so the request
stays in the queue with a new limit. The same holder means that no progress
occurred, so the request steals. If `query()` fails, the request steals. The
start query must not delay the lock request.

**Steal request options.** The specification rejects `steal: true` together
with `signal` or `ifAvailable`, and it requires `mode: 'exclusive'`. Thus the
steal request has only `mode` and `steal`. `fn` runs inside the steal callback.

### Wait limit

The wait limit is 10 seconds plus a random value from 0 to 2 seconds, for each
call. The 10 seconds is a design choice. Normal lock operations take much less
time.

The random value and the holder check together prevent a burst of steals. The
production case had 55 waiting requests. The first request to reach its limit
steals the lock. A steal goes ahead of the queue, but it does not cancel the
queue. The other requests see a changed holder at their limits, so they keep
their places. When the new holder releases the lock, the queue moves in the
normal order. If the new holder hangs, the next request sees the same holder at
its following limit, and it steals. Thus a slow stealer delays the queue by one
more wait limit, and the wait stays bounded while no holder makes progress.

### Console warning

Each steal writes one warning. The warning contains the lock name and the wait
time. It contains no session or user data.

### Change to `src/integrations/supabase/client.ts`

Add `lock: authLock` to the `auth` options at
`src/integrations/supabase/client.ts:19-23`. This file has the header
"automatically generated", but it also holds manual production defaults. A
later regeneration can remove this option. The builder adds a short comment at
the option.

### No change to `src/hooks/useAuth.tsx`

After a steal, `getSession` returns the real session. The startup logic stays
correct, and a timeout does not become a sign-out.

## Other code that sees this change

All `_acquireLock(-1, ...)` callers get the new wait limit
(`GoTrueClient.js:188, 450, 829, 908, 1072, 1121, 1171, 1232, 1380, 1428, 2026,
2129, 2162, 2228`).

| Group | Result |
|-------|--------|
| Startup (`initialize`, `src/hooks/useAuth.tsx:72`) | The call completes after a recovery. |
| Visibility handler (`src/hooks/useAuth.tsx:35`) | Same as startup. |
| Auto refresh tick (`GoTrueClient.js:1947`) | No change. It uses a timeout of 0. |
| User actions (`signOut`, `signInWithPassword`, and other calls) | The call runs after a recovery. Before this change, it never ran. |
| Native deep links (`setSession`, `exchangeCodeForSession` in `capacitorAuth.ts`) | Same as user actions. |

Several calls in one tab can wait together. `_acquireLock` keeps one
`lockAcquired` flag for each client (`GoTrueClient.js:942`). Two calls in one tab
that both steal can clear that flag early. The holder check prevents this: after
the first steal the holder changed, so the second call keeps its place in the
queue. A unit test covers this case.

## Accepted risks

- **Sign-out after a steal during a token refresh.** This is the worst failure
  of this design, and it goes against the first anti-goal. Assume a holder sent
  a refresh, the server rotated the token, and the tab never stored the reply.
  The stealer then reads the old token and uses it. If this occurs outside the
  reuse interval and reuse detection is on, the server can revoke the token
  family. `_callRefreshToken` then deletes the session
  (`GoTrueClient.js:1745-1749`), and all tabs sign out. The risk is accepted
  for this reason: a user who closes or reloads that tab today gets the same
  result, and that was the only recovery before this change. The steal adds no
  new way to lose the token. It only makes that recovery automatic. The PR must
  state this risk.
- **Production reuse interval not checked.** `supabase/config.toml` does not set
  the value, and the auth settings are not in the database. A check of the value
  does not change this design (see "Decided trade-offs").
- **Same `clientId`, new operation.** One client can release and take the lock
  again between two checks. The check then shows the same holder, and a healthy
  holder can lose the lock. The stolen holder rule keeps that call correct.
- **A hang inside `fn`.** If `fn` hangs in the tab that steals the lock, that
  call stays open. Another tab can still recover by the same steal. The lock
  limits the wait, not the operation.
- **`lock` option deprecation.** The option is deprecated in later `auth-js`
  versions and goes away in v3. The future upgrade removes `authLock`.

## Tests

Unit tests in `tests/unit/authLock.test.ts` use a fake `navigator.locks` and
fake timers. They cover each row of the behavior table, and these cases:

- `fn` runs exactly one time when a holder loses the lock after the grant.
- A non-abort error from `fn` reaches the caller after a steal.
- An `AbortError` thrown by `fn` itself does not cause a steal.
- The wait timer does not fire after a grant.
- The steal occurs in the 10 to 12 second range.
- The steal options have no `signal` and no `ifAvailable`.
- A changed holder at the limit causes no steal, and the same holder at the next
  limit causes a steal.
- Two calls in one tab cause one steal, and each `fn` runs one time.

The fake must follow the specification. A steal rejects the `request()` promise
of the old holder with `AbortError`, the old callback continues, and an abort
after a grant has no effect. Stub `Math.random`, and use `vi.useFakeTimers()`.

A Playwright spec is the check on the fake. It runs in CI with the other E2E
tests, so it is a merge gate. The spec has these rules:

- Get the lock name from the local client, not from the production ref. Compute
  `lock:sb-<first hostname label>-auth-token` from the test `SUPABASE_URL`.
- Hold the lock from a blank page on the app origin. Use `context.route` to
  fulfill that page. Do not load the app in this page, because the app there
  steals the lock and hides the result of the second page.
- Hold the lock with a promise that never settles, in `page.evaluate`, with no
  `await`.
- Open the app in a second page. Confirm that `Initializing...` shows, and that
  it goes away within 20 seconds. Confirm the console warning.
- Case 1: no session. The page goes to `/auth`.
- Case 2: a valid session in storage. The user stays logged in. This case
  checks the first anti-goal.

## Decided trade-offs

- **Keep the wait limit at 10 seconds, and do not raise it above the reuse
  interval.** A review proposed 15 to 20 seconds. A longer wait does not lower
  the sign-out risk. A reuse inside the interval is safe, and a reuse after it
  is not. Thus a later steal is more likely to fall outside the interval, not
  less. A shorter wait steals from more healthy holders. The 10 seconds stays.
- **No UI change.** A review proposed `role="status"`, `aria-live`, and a second
  message on the `Initializing...` screen (`src/hooks/useAuth.tsx:283-294`). The
  screen already has this gap, and the wait drops from no limit to 12 seconds.
  The review also said that a reload adds to the queue. A reload deletes the
  requests of that page, so it does not. This can be a separate change.
- **No guard on the stored refresh token before a steal.** A review proposed a
  comparison of the stored token inside the stolen path. That logic is in
  `auth-js`, and this design does not change `auth-js`.

## Left to the builder

- The names of internal helpers and constants.
- The exact warning text.
- The location of the E2E spec.
