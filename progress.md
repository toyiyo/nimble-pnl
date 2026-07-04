# Progress: Focus POS near-real-time sync (30-min freshness at fleet scale)

## Spec
Link: docs/superpowers/specs/2026-07-04-focus-sync-frequency-design.md (committed 74cd0b43)

## Current Phase
Phases 4–9: dev-build-and-ship workflow — in-progress (launched after user plan approval)

## Completed Tasks
- [x] Phase 0: lessons consulted (migration-version uniqueness, live pg_cron in pgTAP, REVOKE pattern, gate-less workers, hardcoded cron URLs)
- [x] Phase 1: worktree `.claude/worktrees/focus-sync-frequency`, branch `feature/focus-sync-frequency` @ 98d1212f; deps installed; baseline green (5,418 tests, Focus files pass)
- [x] Phase 2: design doc committed (74cd0b43); leaked progress.md untracked (e39e481a)
- [x] Phase 2.5: supabase-design-reviewer APPROVE-WITH-CHANGES; all findings folded (fd70278b). Frontend reviewer skipped (no UI surface).
- [x] Phase 3: plan committed (891aa0c3) — docs/superpowers/plans/2026-07-04-focus-sync-frequency-plan.md; user approved ("Approve — build it")
- [x] Phase 4, Task 1/7: Migration + pgTAP — scheduler schema, claim RPC, cron fan-out (57c740a4)
  - Migration: `supabase/migrations/20260704200320_focus_sync_frequency.sql` (timestamp generated at creation time; clean vs origin/main)
  - pgTAP: `supabase/tests/51_focus_sync_scheduler.sql` (19/19 pass)
  - Fixed stale schedule assertion in `supabase/tests/42_focus_cron.sql` (was asserting the removed `30 1,7,13,19 * * *`; now `*/5 * * * *`)
  - Full `npm run test:db`: 1573/1573 pass, zero regressions
  - `migrationVersionUniqueness.test.ts`: pass
- [x] Phase 4, Task 2/7: Fingerprint module (`extractChecksBlock` export + SHA-256 + state store) (50064d84)
  - `supabase/functions/_shared/focusDatafeedParser.ts`: `extractChecksBlock` now exported (no other changes)
  - `supabase/functions/_shared/focusDatafeedFingerprint.ts` (new): `computeChecksFingerprint` (SHA-256 + byte length of `<Checks>` block via Web Crypto), `createDatafeedStateStore` (fail-open `get`/`touch`/`record` over `focus_datafeed_state`)
  - `tests/unit/focusDatafeedFingerprint.test.ts` (new): 7/7 pass
  - Regression check: `tests/unit/focusDatafeedParser.test.ts` 11/11 pass (export change non-breaking); full `npx vitest run tests/unit/` 5,577 passed / 2 skipped, 414 files — zero regressions
  - `npm run typecheck`: clean; `npx eslint` on touched files: clean
- [x] Phase 4, Task 3/7: Delta-skip inside `processDayTransactions` (17ae75bf)
  - `supabase/functions/_shared/focusTransactionSyncHandler.ts`: `TransactionSyncDeps` gains optional `stateStore?: DatafeedStateStore`; `TransactionSyncResult` gains `{ status: 'unchanged' }`; new step 2.5 between fetch and parse — fingerprints `result.xml`, compares to `stateStore.get()`, on match calls `touch()` and returns `unchanged` (fail-open: no stateStore or a store error → normal processing); on mismatch/first-pull, `record()` is called after the upsert loop succeeds, before the unified_sales RPC
  - `processDateRangeTransactions`: `lastStatus` fold widened to `result.status === 'empty' ? 'empty' : 'ok'` (defensive only — the range path never wires a `stateStore`, so `'unchanged'` cannot occur there yet)
  - Grepped all `processDayTransactions` consumers (`focusSyncDataHandler.ts`, `focusBulkSyncHandler.ts`, `focusBackfillBatch.ts`) — all use `===` equality checks, not exhaustive switches; none throws on `'unchanged'`; none currently wires a `stateStore` (Task 6 wires it in the bulk handler only)
  - `tests/unit/focusTransactionSyncHandler.test.ts`: new `describe('delta skip (optional stateStore dep)')` — match→unchanged+touch+no writes, mismatch→ok+record, no-prior-state→ok+record, no-stateStore→unchanged behavior, plus two self-added edge cases (empty datafeed matching an empty-block fingerprint → `unchanged`+touch; empty datafeed with no prior state → still `empty`, no `record`)
  - RED confirmed (3 plan tests failed pre-implementation) → GREEN (47/47 in-file); full `npx vitest run tests/unit/`: 5,583 passed / 2 skipped, 414 files — zero regressions (net +6 vs Task 2's 5,577 baseline)
  - `npm run typecheck`: clean; `npx eslint` on touched files: clean
- [x] Phase 4, Task 4/7: `lynkIncrementalDates` window helper (89e5f008)
  - `supabase/functions/_shared/focusReportClient.ts`: new `lynkIncrementalDates(tz, now, yesterdayFetchedAt)` next to `recentBusinessDays` — today always via `todayInTz`, yesterday via `subtractDays(today, 1)` included only when `yesterdayFetchedAt` is null/unparseable or `now - fetchedMs >= 6h` (`YESTERDAY_REFRESH_MS` const); `recentBusinessDays` untouched (still used by focusSyncDataHandler.ts + focusBulkSyncHandler.ts — Task 6 wires the new helper into the bulk handler's Lynk branch)
  - `tests/unit/focusReportClient.test.ts`: new `describe('lynkIncrementalDates', ...)` — 4/4 pass (never-fetched → both dates, ≥6h stale → both dates, <6h fresh → today only, unparseable fetchedAt → fail-toward-refetch/both dates)
  - RED confirmed (4 new tests failed: `is not a function`, 25 pre-existing passed) → GREEN (29/29 in-file)
  - Full `npx vitest run tests/unit/`: 5,587 passed / 2 skipped, 414 files — zero regressions (net +4 vs Task 3's 5,583 baseline)
  - `npm run typecheck`: clean; `npx eslint` on both touched files: clean
  - `package-lock.json` has a pre-existing unrelated modification (not touched by this task, left unstaged)
- [x] Phase 4, Task 5/7: Bulk handler — claim-RPC selection + backoff contract (36ddc309)
  - `supabase/functions/_shared/focusBulkSyncHandler.ts`: `ServiceClient.rpc(fn, args)` added; the old `select().eq().order().limit()` chain removed from the interface (nothing else in this handler used `select`). `FocusConnectionRow` gains `sync_interval_minutes`, `next_attempt_at`, `consecutive_failures` (consumed by column name only, never positionally). Connection selection now calls `deps.serviceClient.rpc('claim_focus_sync_batch', { p_limit: LIMIT })`, preserving existing error→500 and empty→`processed:0` handling. New module-scope `backoffAfterFailure(priorFailures, nowMs)` + `BACKOFF_BASE_MS`/`BACKOFF_CAP_MS` constants (15min × 2^n, capped at 6h). The catch-block's best-effort `last_sync_time` bump is replaced with a best-effort backoff write (`consecutive_failures`, `next_attempt_at`, `updated_at` — explicitly no `last_sync_time`, since the claim already bumped it). The success-path update gains `consecutive_failures: 0, next_attempt_at: null`. B5 skip guard and the Lynk-branch error-state write are unchanged.
  - `tests/unit/focusBulkSyncHandler.test.ts`: `makeServiceClientMock` rewritten to expose `{ from, rpc }` (select-chain mocks removed); all fixtures gain the three new scheduling columns; new `lynkRow()` helper; every `serviceClientOpts: { connections: [...] }` renamed to `{ claimRows: [...] }`; new `claim-based selection` describe block (claim RPC called with `p_limit: 5`, 500 on claim error, `processed:0` on empty claim); new `backoff contract (design review #4)` describe block (failure → `consecutive_failures+1` + future `next_attempt_at` within [59m,61m] of a fixed clock, no `last_sync_time` in that payload; 6h cap at `consecutive_failures=9`; success → reset to `0`/`null`). B5's last test renamed to assert the backoff write supersedes the old bump.
  - RED confirmed first (30 tests failed: `deps.serviceClient.from(...).select is not a function`, since `makeServiceClientMock` no longer builds a select-chain) → GREEN (30/30 in-file)
  - Full `npx vitest run tests/unit/`: 5,591 passed / 2 skipped, 414 files — zero regressions (net +4 vs Task 4's 5,587 baseline)
  - `npm run typecheck`: clean; `npx eslint` on both touched files: clean
  - Verified no other file imports `ServiceClient` from this module (each Focus handler defines its own local interface) and the real edge-function entry point (`supabase/functions/focus-bulk-sync/index.ts`) passes a genuine `@supabase/supabase-js` client, which natively implements `.rpc()` — no other file needed changes
- [x] Phase 4, Task 6/7: Bulk handler — today-inclusive window + wire the state store (1191bb0b)
  - `supabase/functions/_shared/focusBulkSyncHandler.ts`: Lynk branch of `processConnection` now builds a `stateStore` via `createDatafeedStateStore(deps.serviceClient)`, wires it onto `txDeps.stateStore`, and computes the sync window via `lynkIncrementalDates(tz, now, yesterdayState?.fetchedAt ?? null)` — today via `todayInTz`, yesterday via `subtractDays(today, 1)`, with the yesterday-fingerprint lookup done through `stateStore.get(row.restaurant_id, yesterday)`. Replaces the old `recentBusinessDays(tz, now)` (yesterday + day-before) window for this path only; legacy portal (SSRS) branch keeps `recentBusinessDays` unchanged. `ServiceClient` interface gains a `select().eq().eq().maybeSingle()` chain (required by the state store's `get()`); no other file imports this local interface, and the real edge-function's `@supabase/supabase-js` client already implements it natively — no other production file needed changes. Module docblock updated to distinguish legacy-portal (unchanged, "last 2 business days") from Lynk (new: today always + yesterday only when its state-store fingerprint is missing/≥6h stale).
  - Did NOT add a new `BulkSyncDeps.processDayTransactions` injectable override (unlike the plan snippet's `dayProcessor` indirection) — the test file's existing module-level `vi.mock(...)` of `processDayTransactions` already gives full testability, so `processDayTransactions` is called directly, matching the pre-existing pattern and keeping the change minimal.
  - `tests/unit/focusBulkSyncHandler.test.ts`: new `describe('Lynk incremental window (today + conditional yesterday)', ...)` — both dates when yesterday has no fingerprint row, today-only when yesterday was fingerprinted <6h ago, `stateStore` present on the `txDeps` seen by `processDayTransactions`, and an `'unchanged'` day result still counts as a processed success (no `connection_status: 'error'` write). `makeServiceClientMock` extended with a `stateFetchedAt?: string | null` option wiring a `focus_datafeed_state` select→eq→eq→maybeSingle branch (mirrors `createDatafeedStateStore().get()`'s real query shape).
  - Used a local `WINDOW_NOW_MS = Date.parse('2026-07-04T18:00:00Z')` constant scoped to the new describe block instead of the file's shared `NOW_MS` — verified `NOW_MS` resolves to `2024-07-03` (not `2026-07-04`) in `America/Chicago`, which would not match the plan's expected test-date assertions.
  - RED confirmed first (3 of 4 new tests failed: wrong dates / `stateStore` undefined; all 30 pre-existing tests stayed green) → GREEN (34/34 in-file).
  - Full `npx vitest run tests/unit/`: 5,595 passed / 2 skipped, 414 files — zero regressions (net +4 vs Task 5's 5,591 baseline).
  - `npm run typecheck`: clean; `npx eslint` on both touched files and full-repo `npm run lint`: clean (touched files do not appear in the repo-wide pre-existing problem list).
  - `package-lock.json` pre-existing unrelated modification (documented since Task 4) left unstaged, not part of this commit.
- [x] Phase 4, Task 7/7: Full verification + pre-PR checklist (verification only — no commit; nothing to change)
  - `npx vitest run`: 5,597 passed / 2 skipped, 415 files passed / 1 skipped (416 total) — zero failures (file-count reporting drifted +1 vs Task 6's 5,595/414-file snapshot; no regressions, no new test files added by this task)
  - `npm run typecheck`: clean
  - `npm run lint`: repo-wide baseline unchanged (1483 problems / 1384 errors / 99 warnings — confirmed via `git stash` + re-run, identical count with only the feature commits and no working changes); isolated `npx eslint` on all 9 files touched across Tasks 1–6 (both focusDatafeedFingerprint/Parser, focusTransactionSyncHandler, focusReportClient, focusBulkSyncHandler + their 4 test files): zero output, fully clean
  - `npm run build`: success (only the pre-existing >500kB chunk-size advisory, unrelated to this feature)
  - `npm run test:db`: 1573/1573 pass; confirmed `51_focus_sync_scheduler.sql` ran with `1..19` plan and all 19 passed within the total
  - Migration collision check: `git fetch origin` + `git ls-tree origin/main supabase/migrations/ | grep 20260704200320` → clean (no collision). Additionally confirmed `origin/main` HEAD (98d1212f) equals the branch's merge-base — origin/main has not advanced since this worktree branched, so there is no risk of an interim same-timestamp migration landing upstream.
  - `migrationVersionUniqueness.test.ts` run in isolation: 1/1 pass
  - `package-lock.json` pre-existing unrelated modification (documented since Task 4) remains unstaged — confirmed via `git stash` that it exists independent of any feature commit
- [x] Phase 5: UI review — skipped (no UI surface in this feature; Phase 2.5's frontend-reviewer skip already covers this)
- [x] Phase 6: Code-simplify (ea98b157)
  - `code-simplifier:code-simplifier` skill unavailable to this subagent (no further sub-dispatch capability); used the `/simplify` skill's 4-lens methodology (Reuse, Simplification, Efficiency, Altitude) applied sequentially by hand against `git diff origin/main...HEAD --name-only`'s 12 in-scope code/test/migration files (docs + progress.md excluded)
  - **Fixed — Efficiency**: `focusBulkSyncHandler.ts`'s `processConnection` Lynk branch awaited `stateStore.get(row.restaurant_id, yesterday)` (a genuine DB round-trip) serially before starting `today`'s `processDayTransactions`, despite today's processing having zero dependency on the yesterday-fingerprint lookup. Restructured via `Promise.all([processDayTransactions(.... today), stateStore.get(...)])`, keeping `results` array order (`todayResult` first, then remaining dates) — consumption is order-independent (`results.find(...)` only).
  - **Fixed — Altitude**: `ServiceClient`'s `from()` return type hand-duplicated the `select→eq→eq→maybeSingle` chain already declared on the imported `StateStoreClient` (from `focusDatafeedFingerprint.ts`), forcing a double `as unknown as StateStoreClient` cast at the `createDatafeedStateStore` call site. Composed via `from(table): ReturnType<StateStoreClient['from']> & { update(...) }` instead; the cast is now a plain `createDatafeedStateStore(deps.serviceClient)`. Also dropped the `upsert(...).onConflict(...)` branch — confirmed dead (grepped every `.upsert(` call in the file: none exist; grepped every real `onConflict` usage across `supabase/functions/_shared/*.ts`: always passed as the second-argument options object, never as a chained `.onConflict()` method, so this branch never matched any real Supabase call shape).
  - Verified `ServiceClient` is genuinely local to this file before touching it: `grep -rln "ServiceClient" supabase/functions/ | grep -v "\.test\."` returns 5 files, each declaring its own independent interface (confirmed via per-file grep — `focusSyncDataHandler.ts:124`, `focusSaveConnectionHandler.ts:37`, `focusTestConnectionHandler.ts:81` each have their own `export interface ServiceClient`; `focusBackfillSyncHandler.ts` doesn't declare one at all); `focus-bulk-sync/index.ts` only imports `handleBulkSync`, never `ServiceClient`. Matches the established pattern already documented in Task 5/6.
  - **Skipped** (rationale recorded, not silently dropped): (a) SHA-256-to-hex duplication between `focusDatafeedFingerprint.ts` and pre-existing `lighthouseSync.ts` — out of scope, cosmetic, pre-existing pattern not introduced by this diff; (b) `MOCK_LYNK_INCREMENTAL`/`lynkRow()` fixture near-duplication in `focusBulkSyncHandler.test.ts` — test-only readability nit, low value, would touch pre-existing call sites outside this diff's new code; (c) `processDateRangeTransactions`'s `lastStatus` fold (`result.status === 'empty' ? 'empty' : 'ok'`) — already well-reasoned and documented as a deliberate non-widening choice, not simplifiable without losing type safety.
  - Verification bar applied to both fixes together: `npx vitest run tests/unit/focusBulkSyncHandler.test.ts` → 34/34 pass; full `npx vitest run tests/unit/` → 414 passed/1 skipped files (415), 5595 passed/2 skipped tests (5597) — exactly matches the Task 7 baseline, zero regressions; `npm run typecheck` clean; `npx eslint supabase/functions/_shared/focusBulkSyncHandler.ts` clean.
  - `package-lock.json` pre-existing unrelated modification (documented since Task 4) remains unstaged, not part of this commit.
- [ ] Phases 7–9: CodeRabbit review / verify / ship

## CI Status
- PR: not yet created
- Side thread CLOSED: PR #575 fully green @ 32277b67, MERGEABLE — awaiting user merge

## Blockers
- (none)

## Key Decisions
- Due predicate lives in ONE SQL function (`_focus_connection_is_due`) shared by claim RPC + cron fan-out count.
- Claim bumps `last_sync_time` (claim marker) — replaces worker-side failure-bump; pgTAP "second claim returns 0" is deterministic via the bump, not SKIP LOCKED contention.
- Delta-skip lives inside processDayTransactions between fetch and parse, opt-in via injectable state-store dep — only bulk handler wires it initially; manual/backfill paths unchanged (worst case one redundant reprocess, no correctness issue). New result status: 'unchanged' (skips upserts AND the day-scoped unified_sales RPC).
- `extractChecksBlock` gets exported from focusDatafeedParser for fingerprinting (currently internal, focusDatafeedParser.ts:191).
- Lynk incremental window: today every claim; yesterday only when focus_datafeed_state.fetched_at for yesterday is missing/older than 6h. Wired into focusBulkSyncHandler's Lynk branch in Task 6 (state store built once per connection from the service client, shared by the window decision and the delta-skip dep passed to processDayTransactions).
- Legacy portal rows seeded sync_interval_minutes=360 (keep 6-h rhythm through the new scheduler); old 6-h cron schedule replaced by '*/5' fan-out.
- Existing partial index focus_connections_active_sync_idx (last_sync_time ASC NULLS FIRST WHERE is_active) already matches the claim ORDER BY.
