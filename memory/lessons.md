# Lessons Learned

## Category: Domain — Bank Transactions / P&L

### [2026-04-26] Two transfer mechanisms must both be filtered out of P&L
- **Mistake:** Bank transactions assigned a Transfer category (asset/liability/equity-typed chart-of-accounts row, e.g. "Transfer Clearing Account") were rendered as Expenses on the dashboard. The read path filtered only on `is_transfer = false`, but `categorize_bank_transaction` does NOT flip `is_transfer` when assigning an asset-typed category — only the `mark_as_transfer` RPC does. So categorize-then-view was leaking transfers into expense aggregations.
- **Correction:** Added `isTransferCategoryType(account_type)` helper and applied it as a second exclusion (alongside `is_transfer = false`) to every read-path aggregation: `expenseDataFetcher` (transactions, pendingOutflows, splitDetails), `useExpenseHealth`, `useBankTransactions`, and the `Index.tsx` daily-spending filter. Also added pgTAP test pinning that `categorize_bank_transaction` does NOT auto-flip `is_transfer` — if that ever changes, the read-path filter must be revisited.
- **Rule:** A transaction is a transfer if EITHER `is_transfer = true` OR its category's `account_type` is `asset|liability|equity`. Every P&L read path must apply both filters. When adding a new aggregation hook, copy the dual-filter pattern.

---

## Category: TypeScript / React

### [2026-04-26] Widening an interface requires grepping all `as ... []` casts
- **Mistake:** Widened `BankTransaction.chart_account` to include `account_type: string | null`, then updated the projection in the primary `useBankTransactions` hook. Missed a sibling hook `useBankTransactionsWithRelations` that does `as unknown as BankTransaction[]` against a projection that still only selected `account_name`. Typecheck happily passed because `as unknown as` is unsafe by design. CodeRabbit caught it; would have shipped silent `undefined` for any future consumer applying the new transfer-exclusion filter through that hook.
- **Correction:** Added `account_type` to the second projection too. Lesson committed alongside fix.
- **Rule:** When widening an interface used by Supabase row casts, grep `as unknown as <Type>` AND `as <Type>[]` and verify every matching select projection now includes the new fields. Typecheck cannot catch projection drift behind `as unknown as`.

---

## Category: Supabase Edge Functions

### [2026-04-21] Edge function error handling — HTTP codes vs 200 workaround
- **Mistake:** Returned HTTP 200 for all application errors (expired invitation, invalid token) to avoid the Supabase SDK turning them into `error` instead of `data`.
- **Correction:** Return proper 4xx codes (410 expired, 404 invalid, 400 bad request). On the frontend, when `error` is set (from a non-2xx response), read the body with `await error.context.json()` to get the actual error message, then classify from there.
- **Rule:** Always use proper HTTP semantics in edge functions. Handle `FunctionsHttpError.context.json()` in the frontend catch block to extract business-level error messages from 4xx responses.

---

## Category: TypeScript / React

### [2026-04-21] useState setter naming consistency
- **Mistake:** Renamed a state variable but not its setter: `const [authSubmitting, setAuthLoading2] = useState(false)`.
- **Correction:** Rename both: `const [authSubmitting, setAuthSubmitting] = useState(false)`.
- **Rule:** Always rename state variable and setter together. Mismatched pairs compile fine but confuse readers and tools.

---

## Category: Testing

### [2026-04-21] Fake timer cleanup in Vitest
- **Mistake:** Used `vi.useFakeTimers()` in a test file without `afterEach(() => vi.useRealTimers())`, causing fake timers to leak into other test files and produce spurious failures.
- **Correction:** Add `afterEach(() => vi.useRealTimers())` to every `describe` block that calls `vi.useFakeTimers()`.
- **Rule:** Fake timer setup/teardown must be symmetric — always pair `useFakeTimers` with `useRealTimers` in `afterEach`.

---

## Category: Date/Time Calculations

### [2026-04-21] Math.round for day-remaining messages causes off-by-one
- **Mistake:** Used `Math.round(ms / DAY_MS)` to compute "days until expiry". A date 22 hours away rounds to 1 day → "Expires tomorrow" instead of "Expires today".
- **Correction:** Use `Math.floor` for future intervals (ms > 0) and `Math.ceil` for past intervals (ms < 0). Also fix the `days === 0 && ms < 0` case to return "Expired today" rather than "Expired yesterday".
- **Rule:** For UX-facing time-remaining messages, use floor/ceil to avoid premature label advancement. Round numbers belong in math, not calendar copy.

---

## Category: Database Tests (pgTAP)

### [2026-04-21] Hardcoded dates in pgTAP tests cause time-dependent failures
- **Mistake:** pgTAP test `open_shift_claim_timezone.test.sql` used hardcoded dates `2026-04-13` to `2026-04-19`. Once those dates passed, `get_open_shifts` (which filters for future dates) returned NULL and tests 4–5 started failing.
- **Correction:** Replace hardcoded dates with `CURRENT_DATE + (7 - EXTRACT(DOW FROM CURRENT_DATE)::int)` to target the upcoming Sunday. Store computed dates and expected UTC timestamps in a `CREATE TEMP TABLE test_config AS SELECT ...` block; reference them via subqueries in `SELECT is(...)` calls.
- **Rule:** Never use hardcoded future dates in pgTAP tests. Always compute target dates relative to `CURRENT_DATE` so tests remain valid indefinitely.

---

## Category: UI Styling

### [2026-04-21] Direct color tokens in status indicators
- **Mistake:** Used `text-yellow-500` and `text-green-500` for pending/accepted status icons, and `bg-green-100 text-green-600` for the accepted state card.
- **Correction:** Use semantic tokens: `text-primary` for success/accepted, `text-muted-foreground` for neutral states. The amber/yellow warning state can use `bg-amber-500/10 border-amber-500/20` (the AI suggestion panel pattern from CLAUDE.md).
- **Rule:** No direct color classes per CLAUDE.md. Even "status" colors should use semantic tokens or the established amber warning pattern.

---

## Category: React State

### [2026-04-22] Scalar ID vs Set for tracking concurrent async operations
- **Mistake:** Used `resendingId: string | null` to track which invitation row is resending. Replacing the value on each click meant only one row could be in-flight at a time; a second click would clear the first spinner.
- **Correction:** Use `resendingIds: Set<string>` — add on start, delete in `onSettled`. Every row tracks its own state independently.
- **Rule:** Whenever multiple list-row operations can run concurrently, use `Set<id>` not `scalar | null`. The scalar pattern silently drops in-flight state when a second item is activated.

---

## Category: TypeScript

### [2026-04-22] `useState<any>` and `catch (err: any)` hide bugs
- **Mistake:** Used `useState<any>(null)` for invitation details and `catch (err: any)` in validateInvitation — both compile fine but defeat type safety.
- **Correction:** Define a typed interface (`InvitationDetails`) and use `catch (err: unknown)` with an `instanceof Error` guard: `err instanceof Error ? err.message : ''`.
- **Rule:** Never use `any` for component state or catch clauses. `unknown` + type guard is the correct widening strategy.

---

## Category: Security

### [2026-04-22] Leaking raw error messages from 500 responses
- **Mistake:** Edge function returned `error.message` verbatim for unrecognized errors, which could expose internal DB/library details to the client.
- **Correction:** Map known errors to their messages; fall back to a generic `"An unexpected error occurred"` for status 500.
- **Rule:** Only send client-facing messages for errors you explicitly anticipate (4xx). For anything else (5xx), return a generic string and log the real error server-side.

---

## Category: UI Patterns

### [2026-04-22] Card visibility guards that exclude history states
- **Mistake:** The Invitations card condition was `pendingInvites?.some(i => i.status === 'pending' || i.status === 'expired')` — the card disappeared entirely when all invites were cancelled.
- **Correction:** Use `pendingInvites && pendingInvites.length > 0` — show the card whenever any invitations exist (the internal toggle handles cancelled history).
- **Rule:** Card show/hide guards should reflect "does data exist?" not "does active data exist?". Hiding a card because all items are in a terminal state removes context the user might still need.

---

## Category: Development Workflow

### [2026-04-22] Worktree must be created BEFORE brainstorm/plan, not after
- **Mistake:** Ran `/dev` brainstorm + plan phases from the main branch, committing `docs/superpowers/specs/*-design.md` and `docs/superpowers/plans/*-plan.md` directly to `main`. The development-workflow skill's phase order was Brainstorm → Plan → Isolate, which guarantees that every spec and plan commit lands on `main`.
- **Correction:** Always create the feature worktree FIRST, before any artifact is written. Design docs, plans, and code all get authored in the worktree and commit to the feature branch. `main` never receives work-in-progress artifacts for a task.
- **Rule:** `main` is read-only from the workflow's perspective. The very first action after Phase 0 (consult lessons) is Phase 1: Isolate — create a feature branch and worktree. Reordered the development-workflow skill phases accordingly: Phase 0 Consult Lessons → Phase 1 Isolate → Phase 2 Brainstorm → Phase 3 Plan → Phase 4 Build.
- **Recovery pattern when caught mid-flight (corrected 2026-04-22 post-CodeRabbit):** If commits or uncommitted edits have landed on `main`:
  1. `git stash push --include-untracked --message "pre-recover-$(date +%s)"` — preserve uncommitted tracked+untracked edits first (otherwise step 3 destroys them).
  2. `git branch <feature> HEAD && git reset --hard origin/main` — only if there are accidental commits to move; skip if HEAD is already at origin/main.
  3. `git worktree add .claude/worktrees/<feature> <feature>` then `git stash pop` inside the worktree.
- **Why the earlier recovery was wrong:** `git branch <feature> HEAD` only snapshots committed HEAD; `git reset --hard origin/main` then destroys the working tree. The most common case this HARD-GATE catches is uncommitted edits, so skipping the stash defeats the point.

---

## Category: Database (PostgREST / Supabase)

### [2026-04-22] PostgREST cross-schema joins silently return null
- **Mistake:** Edge function queried `user_restaurants` with `user:auth.users(email)` embed. PostgREST cannot traverse from `public` to the `auth` schema by default — the join returned `null` for every row, no error thrown. Manager emails silently went missing; only employees got notified on time-off requests.
- **Correction:** Use the `profiles` table in the `public` schema, which has its own FK to `auth.users`. Embed via `profiles:user_id(email)`. The email is the same data but reachable through a public-schema join.
- **Rule:** When a Supabase embed needs auth.users data, always route through `profiles` (or another public-schema mirror) — never embed `auth.users` directly. Whenever a fanout-to-recipients query "returns fewer rows than expected" without throwing, suspect a cross-schema join first.

### [2026-04-22] pgTAP fixture flakiness from ON CONFLICT DO NOTHING
- **Mistake:** Test used `INSERT ... ON CONFLICT (id) DO NOTHING` for fixture rows with fixed UUIDs. A stale row from a prior failed run could survive and make the test pass/fail based on prior state rather than the current transaction's inserts.
- **Correction:** Delete-before-insert in FK order inside the same `BEGIN ... ROLLBACK` transaction. Also `ALTER TABLE ... DISABLE ROW LEVEL SECURITY` so fixture inserts don't depend on the caller's role. Keep `ON CONFLICT DO UPDATE` (not `DO NOTHING`) on tables that have auto-create triggers (e.g., `profiles` auto-created from `auth.users`), so the fixture deterministically lands its values regardless of trigger timing.
- **Rule:** Deterministic pgTAP fixtures: (1) RLS off inside the txn, (2) delete-before-insert in FK-safe order, (3) use `ON CONFLICT DO UPDATE` not `DO NOTHING` when a trigger may have pre-created the row.

---

## Category: React Query

### [2026-04-22] `enabled: !!id` is the codebase's "waiting" signal — don't bypass it
- **Mistake:** First draft of a hook early-returned `{ data: 0 }` for an undefined id. Tests and the first UI consumer both passed, but the pattern diverged from every other hook: the rest of the codebase relies on `enabled: !!id` leaving `data: undefined` while waiting, and downstream components check `isLoading` / `data !== undefined` accordingly.
- **Correction:** Use `enabled: !!restaurantId` in the query config. Inside `queryFn`, use the non-null assertion (`restaurantId!`) since the query is gated above. Consumers must then handle `data: undefined` explicitly instead of getting a synthetic `0`.
- **Rule:** Match the codebase's React Query conventions even when your own test works with a shortcut. `enabled: !!id` + `data: undefined` while disabled is the house style; synthetic defaults create asymmetry that downstream components won't expect.

### [2026-04-22] Warning heuristics must guard against error states
- **Mistake:** UI warning computed `(approverCount ?? 0) === 0` to show "No approvers configured". On transient query errors (network, RLS), `data` is undefined with `isLoading: false` — the heuristic treated that as zero and rendered a misleading warning on top of a silent failure.
- **Correction:** Destructure `isError` too and guard `!isError && data !== undefined && data === 0`. Add a unit test for the error path.
- **Rule:** Any UI that derives "empty/zero" from a query result must also check `isError`. React Query returns `data: undefined` for both "still loading (disabled)" and "errored"; conflating either with "genuinely zero" creates confident-looking misinformation.

---

## Category: Testing (React)

### [2026-04-22] Prefer structural (role) assertions over text assertions
- **Mistake:** Tests asserted `queryByText('No approvers configured')` to verify an alert renders. A regression that kept the `role="alert"` div but emptied its text children would pass — the test can't tell the difference between "alert rendered correctly" and "alert rendered as an empty shell".
- **Correction:** Assert `getByRole('alert')` / `queryByRole('alert')` for presence/absence. Keep one belt-and-suspenders text check in the happy-path test; the rest use role only.
- **Rule:** When testing a component's presence/absence, assert on the accessibility role, not the content text. Role assertions catch structural regressions that text-only assertions miss.

### [2026-04-22] Tautological tests that can't fail
- **Mistake:** A test case "chef email is excluded" asserted that a chef's email was not in the approvers list — but the mock data passed to the function never contained a chef to begin with, so the assertion was vacuously true.
- **Correction:** Either include the chef in the mock data (so exclusion is observable) or delete the test. Added the chef to the role filter and asserted it was filtered out.
- **Rule:** Every test should be able to fail if the code regresses. If the test setup doesn't include the thing being tested against, the assertion is tautological and provides no coverage.

---

## Category: Code Review Process

### [2026-04-22] Two-stage review (spec → quality) catches different classes of issue
- **Observation:** The subagent-driven workflow ran two reviewers after each task: spec compliance first, then code quality. Spec review caught "managerCount → managersFound" naming drift from the spec and a tautological chef test (scope issues). Quality review caught `enabled: !!id` convention mismatch and `select('*')` CLAUDE.md violation (craft issues). Neither reviewer caught all the issues alone.
- **Rule:** Keep the two-stage review. Spec review asks "does this match what we agreed to build?" and catches drift; quality review asks "is this the right way to build it?" and catches conventions and smells. They're complementary, not redundant.

### [2026-04-22] CodeRabbit feedback triage: fix, defer, or push back
- **Observation:** CodeRabbit surfaced 7 items on one PR. Triage: 1 real bug (error-state warning), 2 quick quality wins (fixture determinism, test prefixes), 1 plan-doc drift (deferred as historical artifact), 1 markdown lint nit (deferred), 1 style-guide disagreement (pushed back — `bg-amber-500/10` is the documented CLAUDE.md pattern).
- **Rule:** Not every CodeRabbit finding must be addressed. Fix real bugs and quick wins. Defer nits. Push back when the finding contradicts an existing codebase convention — but document the reasoning in a PR comment so future readers know it's intentional, not overlooked.

---

## Category: SonarCloud / Coverage

### [2026-04-25] SonarCloud "new code" coverage ignores vitest excludes
- **Mistake:** Added `src/assets/fonts/micr-e13b.ts` for MICR PDF font registration, but every test file that exercised it (`tests/unit/checkPrinting.test.ts`) used `vi.mock('@/assets/fonts/micr-e13b', ...)` to stub the module. The module showed 0% line coverage in the lcov report. SonarCloud's new-code coverage gate dropped to 67.6% (threshold 80%) and the PR went red — even though `vitest.config.ts` excludes other untested folders.
- **Correction:** Wrote a dedicated `tests/unit/micrPdfChars.test.ts` that imports the real module and tests `MICR_PDF_CHAR_MAP`, `toMicrPdfText`, and `registerMicrFont` directly (stubbing `global.fetch` so the TTF `?url` import resolves under jsdom). Coverage on the file went 0% → 92%, and the SonarCloud gate flipped green on the next push.
- **Rule:** SonarCloud's new-code coverage measures every changed file regardless of vitest's `coverage.exclude` config — excludes only suppress local report noise. If the file is small and 100% mocked elsewhere, write a dedicated direct-import test for it before pushing, or accept that the SonarCloud gate will fail. Mock-only coverage is functionally 0%.

### [2026-04-25] Module-level fetch cache leaks across test cases
- **Mistake:** First draft of `micrPdfChars.test.ts` had two `registerMicrFont` tests — one for the success path (stubbed `fetch` → 200), one for the failure path (stubbed `fetch` → 404). The 404 test always passed-by-accident because the success test had populated a module-scoped `cachedBase64` variable inside `micr-e13b.ts`; the second call short-circuited and never touched the stubbed fetch.
- **Correction:** Removed the 404 test rather than papering over it with `vi.resetModules()`. The success path provides 92% coverage on its own and the cache itself is desired runtime behavior; testing the un-cached failure path requires module-state surgery that has higher maintenance cost than value.
- **Rule:** When a module memoizes async results at module scope (`let cached = null` pattern), tests that depend on running the un-cached path more than once need `vi.resetModules()` + `await import(...)` per case, otherwise the second test silently no-ops. Prefer testing the cache contract once and skipping ambiguous "second-call" tests rather than fighting the memoization.

---

## Category: Transactional Ordering (UI Mutations)

### [2026-04-25] Fetch encrypted secrets BEFORE writing audit/state
- **Mistake:** First version of `PrintCheckButton.handlePrint` claimed the next check number, updated the pending outflow to `payment_method: 'check'`, wrote a `printed` audit-log row, and only then fetched the encrypted routing/account secrets needed to render the MICR line. If the secrets fetch failed (network blip, RLS, missing vault entry) the user got an error toast but the audit log already said the check was "printed" — and the next user got a check number that was never used.
- **Correction:** Reordered every print/reprint flow so the secrets fetch (and the precondition checks for missing routing / account_number_last4) runs first. Only after secrets resolve do we claim the check number, mutate the outflow, and write the audit row. Same fix applied to `PrintChecks.tsx` `handlePrint` and `handleReprint` — both had the identical ordering bug.
- **Rule:** In any "fetch sensitive data + write side effects + render artifact" flow, fetch all the inputs first. Side effects (number claims, audit logs, status mutations) only fire after every input has resolved successfully. This way a late-stage failure leaves the system in its starting state instead of a half-printed-half-not state that has to be reconciled by hand.

---

## Category: Testing (Vite/jsdom)

### [2026-04-25] Vite `?url` imports don't resolve in Node — stub fetch instead
- **Mistake:** `src/assets/fonts/micr-e13b.ts` uses `import micrFontUrl from './MICR-E13B.ttf?url'` so Vite emits the asset and gives back a runtime URL. Under vitest+jsdom there's no Vite dev server, so the URL resolves to a path that `fetch()` can't load — tests that exercised `registerMicrFont` failed with `TypeError: Failed to fetch`.
- **Correction:** Stub `global.fetch` per-test with `vi.stubGlobal('fetch', vi.fn(async () => new Response(ttfBytes, { status: 200 })))` and `vi.unstubAllGlobals()` in `afterEach`. Verified the fake bytes flowed through `addFileToVFS` / `addFont` with a base64 string argument matcher.
- **Rule:** Anything imported via Vite's `?url` (or `?raw`, `?inline`) suffix needs runtime stubbing in vitest. Stub `fetch` at the global level with the exact `Response` shape your code consumes; don't try to monkey-patch the import.

---

## Category: Workflow / PR Hygiene

### [2026-04-26] CI green ≠ review comments addressed
- **Mistake:** On PR #479 I notified the user "PR is green and ready for review" the moment `gh pr checks` showed all green. I conflated CodeRabbit's "pass" status (the review-bot's check just means it ran, not that comments are addressed) with "comments handled." When the user asked "did you review the PR comments?" I had to triage 12 real comments — 2 Codex P2 + 10 CodeRabbit — uncovering 2 Major security bugs (PostgreSQL column-level REVOKE bypass via table-level GRANT, cross-restaurant existence probe via distinct error messages), 1 transactional ordering bug (audit row written before secret fetch could fail), and 7 smaller bugs (false-positive regex tests, missing combined `isPending`, leaked secret render, etc.). All of this would have shipped if the user hadn't asked.
- **Correction:** Hardened `.claude/skills/development-workflow.md` Phase 9d into a non-skippable triage gate: must run `dev-tools/refresh-queue.sh --pr <N>`, must `gh api /pulls/<N>/comments` and `/issues/<N>/comments` filtered by author for `coderabbitai|codex|copilot`, and must classify+act on every result before declaring 9e Done. Also added a clarification to Phase 7 that the CodeRabbit CLI run is independent of the GitHub bot — passing one does not satisfy the other. Phase 9e now requires the triage outcome in the user notification ("12 comments: 10 fixed, 2 declined with reply").
- **Rule:** Two independent gates must both be green before claiming a PR is ready: (1) all status checks pass AND (2) every inline / issue comment from a known reviewer (CodeRabbit, Codex, Copilot, human) is either fixed-with-commit or declined-with-reply on the PR. Treat "the bot's check is green" as a signal the bot finished running, not a signal the bot was happy. When in doubt, fetch comments by author and read every one.
