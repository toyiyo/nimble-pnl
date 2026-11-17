# Auth Lock Timeout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop one stuck tab from blocking the app in other tabs indefinitely.

**Architecture:** Add one custom `lock` function in `src/lib/authLock.ts` and pass it to the Supabase client. The function limits the wait for the auth Web Lock, checks the holder, and steals the lock when the holder makes no progress.

**Tech Stack:** TypeScript, Web Locks API, `@supabase/supabase-js` 2.57.4 with `@supabase/auth-js` 2.71.1, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-03-auth-lock-timeout-design.md`

## Global Constraints

- Wait limit: 10 000 ms plus a random value from 0 to 2 000 ms, for each wait limit.
- Each call runs `fn` exactly one time.
- Do not change `src/hooks/useAuth.tsx`.
- Do not upgrade `supabase-js`.
- The steal request has only `mode: 'exclusive'` and `steal: true`.
- The console warning has no session or user data.
- Write comments and commit messages in STE-aligned English.

## Review Focus

1. A stolen holder finishes late. Its call returns the normal result, and it does not steal back.
2. `navigator.locks.query()` rejects. The request steals, and the caller gets the `fn` result.
3. The lock is free at the limit, so the held list has no entry. The request stays in the queue and gets the grant.
4. The grant arrives during the `query()` call at the limit. No steal occurs.
5. The call ends. No timer stays active.

Task 1 has a test for each line.

---

### Task 1: The `authLock` function

**Files:**
- Create: `src/lib/authLock.ts`
- Test: `tests/unit/authLock.test.ts`

**Interfaces:**
- Consumes: `navigatorLock` from `@supabase/supabase-js`.
- Produces: `export async function authLock<R>(name: string, acquireTimeout: number, fn: () => Promise<R>): Promise<R>`

- [ ] **Step 1: Write a spec-accurate fake `navigator.locks` in the test file**

The fake has `request(name, options, callback)` and `query()`. It follows these rules:

- It grants requests in queue order.
- `steal: true` grants at once, and it rejects the `request()` promise of the old holder with a `DOMException` named `AbortError`. The old callback continues.
- It throws `NotSupportedError` for `steal` with `signal` or `ifAvailable`.
- An abort before the grant rejects with `AbortError` and deletes the request from the queue. An abort after the grant has no effect.
- `query()` returns `{ held: [{ name, clientId }], pending: [...] }`.

Install it with `vi.stubGlobal`. Use `vi.useFakeTimers()`, and stub `Math.random` to return `0`.

- [ ] **Step 2: Write the failing tests**

Each test asserts the `fn` call count, the steal count, and the result:

| Test name | Assertion |
|-----------|-----------|
| `runs fn with no lock when navigator.locks does not exist` | `fn` runs one time. |
| `delegates to navigatorLock when acquireTimeout is 0` | An unavailable lock rejects with `isAcquireTimeout === true`. |
| `runs fn when the lock is granted in time` | No steal, and no warning. |
| `steals when the same holder keeps the lock past the limit` | No steal at 9 999 ms. One steal at 10 000 ms. One warning that contains the lock name. |
| `steals within 12 seconds at the highest random value` | With `Math.random` at `0.999`, the steal occurs before 12 000 ms. |
| `sends only mode and steal on the steal request` | The options equal `{ mode: 'exclusive', steal: true }`. |
| `keeps the queue place when the holder changed` | No steal at the first limit. One steal at the next limit with the same holder. |
| `steals one time for two calls in one tab` | One steal, and each `fn` runs one time. |
| `returns the fn result when the lock is stolen from this call` | The caller gets the result, `fn` runs one time, and no steal back occurs. |
| `rejects with the fn error after the lock is stolen` | A non-abort error from `fn` reaches the caller. |
| `does not steal when fn throws AbortError` | The caller gets that error, and `fn` runs one time. |
| `steals when query rejects` | The caller gets the `fn` result. |
| `does not steal when the lock is free at the limit` | The queue grant runs `fn`, with no steal. |
| `does not steal when the grant arrives during the query at the limit` | No steal. |
| `leaves no active timer after the call ends` | `vi.getTimerCount()` is `0`. |

- [ ] **Step 3: Run the tests and see them fail**

Run: `npx vitest run tests/unit/authLock.test.ts`
Expected: FAIL. The import of `@/lib/authLock` does not resolve.

- [ ] **Step 4: Write `authLock` in `src/lib/authLock.ts`**

Check `globalThis.navigator?.locks` inside the function. Delegate `acquireTimeout >= 0` to `navigatorLock`. The `acquireTimeout < 0` path follows this algorithm. The code shows the decisions that the tests do not fix:

```ts
let work: Promise<R> | undefined;
const run = () => (work = fn());
const holderAtStart = readHolder(name); // no await before the request

// On each limit: if `work` exists, stop. Read the holder. If `work` now exists,
// stop. If the holder differs from the last holder, store it and start a new
// limit. Otherwise abort the request.
try {
  return await locks.request(name, { mode: 'exclusive', signal }, run);
} catch (error) {
  if (work) return work; // The lock was stolen, or fn rejected.
  if (!isAbortError(error)) throw error;
}
console.warn(/* lock name and wait time */);
try {
  return await locks.request(name, { mode: 'exclusive', steal: true }, run);
} catch (error) {
  if (work) return work;
  throw error;
}
```

`readHolder` returns the `clientId` of the held entry for `name`. It returns a value that means "failed" when `query()` rejects, and that value counts as the same holder. Clear the timer in a `finally` block.

- [ ] **Step 5: Run the tests and see them pass**

Run: `npx vitest run tests/unit/authLock.test.ts`
Expected: PASS, 15 tests.

- [ ] **Step 6: Commit**

```bash
git add src/lib/authLock.ts tests/unit/authLock.test.ts
git commit -m "fix(auth): limit the wait for the auth lock"
```

### Task 2: Connect the lock to the client

**Files:**
- Modify: `src/integrations/supabase/client.ts:19-23`
- Test: `tests/unit/authLock.test.ts`

**Interfaces:**
- Consumes: `authLock` from Task 1.

- [ ] **Step 1: Write the failing test**

Add `configures the supabase client with authLock`. Mock `createClient` from `@supabase/supabase-js`, import `@/integrations/supabase/client`, and assert that the `auth.lock` option is `authLock`.

- [ ] **Step 2: Run the test and see it fail**

Run: `npx vitest run tests/unit/authLock.test.ts -t "configures the supabase client"`
Expected: FAIL. `auth.lock` is `undefined`.

- [ ] **Step 3: Add `lock: authLock` to the `auth` options**

Add a one-line comment that says why the option exists. The file header says that the file is generated, so a later regeneration can delete the option.

- [ ] **Step 4: Run the checks**

Run: `npx vitest run tests/unit/authLock.test.ts tests/unit/useAuth.test.tsx && npm run typecheck`
Expected: PASS, with no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/integrations/supabase/client.ts tests/unit/authLock.test.ts
git commit -m "fix(auth): use the limited auth lock in the client"
```

### Task 3: Real browser test

**Files:**
- Create: `tests/e2e/auth-lock-recovery.spec.ts`

**Interfaces:**
- Consumes: the app with Task 2 applied, and `'../helpers/e2e-supabase'`.

- [ ] **Step 1: Write the spec with the rules in the design "Tests" section**

Add two tests:

- `a page with no session recovers from a stuck auth lock`: the page reaches `/auth`.
- `a page with a session stays logged in after a stuck auth lock`: the page stays out of `/auth`.

Both tests assert that `Initializing...` shows and goes away within `{ timeout: 20_000 }`. Both tests assert the console warning. Compute the lock name from the test Supabase URL. Hold the lock from a blank page on the app origin.

- [ ] **Step 2: Show that the spec fails with no fix**

Change `client.ts` for this one run so that it has no `lock` option.
Run: `npx playwright test tests/e2e/auth-lock-recovery.spec.ts --reporter=line`
Expected: FAIL. `Initializing...` stays. This proves that the test holds the correct lock.
Put the `lock` option back.

- [ ] **Step 3: Run the spec with the fix**

Run: `npx playwright test tests/e2e/auth-lock-recovery.spec.ts --reporter=line`
Expected: PASS, 2 tests.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/auth-lock-recovery.spec.ts
git commit -m "test(auth): cover the auth lock recovery in a real browser"
```

## PR notes

The PR body must state these items:

- The accepted sign-out risk from the design, and that nobody checked the production reuse interval.
- The stuck tab stays stuck until the user reloads it.
- The `lock` option goes away in a later `auth-js` major version.
