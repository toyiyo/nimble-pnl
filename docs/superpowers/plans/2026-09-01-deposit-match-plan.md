# Plan: Deposit Match (card rails MVP)

Date: 2026-09-01
Branch: `feature/deposit-match`
Design: `docs/superpowers/specs/2026-09-01-deposit-match-design.md`
Worktree: `.claude/worktrees/deposit-match`

## Goal

Ship one PR that adds the Deposit Match page. The page reconciles POS card
sales against bank deposits per business date. It supports every POS source
through the adapter contract in the design doc.

## Order of work

Build the database first, then the read layer, then the UI. Each task
writes its tests before its code (TDD). Each task ends with a commit.

### Task 0 — Verify the Square tender field (before any code)

The design defers one fact: the tender-type field name inside
`square_payments.raw_json`. Query production (read-only, pre-authorized):

```sql
SELECT raw_json FROM square_payments LIMIT 5;
```

- If rows exist: record the card/tender field name. The `square` adapter
  filters on it.
- If no rows exist: the `square` adapter sums all payments minus refunds and
  the rule ships inactive by default. Record the decision in the migration
  comment.

**Result (checked on production, 2026-09-01):** the tender field is
`raw_json->>'source_type'`. Production holds 146 rows, all with
`source_type = 'CASH'`. No card row exists yet. Decision: the `square`
adapter filters on `raw_json->>'source_type'` with the value list from
`p_config->'card_source_types'` (default `["CARD","WALLET"]`, from the
Square API contract). The adapter raises when the key is absent. The
default Square rule template ships with `active = false`, because no
production card row proves the settlement behavior.

### Task 1 — Migration: tables, RLS, triggers

One migration file. Pick the timestamp prefix AFTER a check against the
merge ref (`git log origin/main -- supabase/migrations` plus a directory
listing), not only the branch (lesson 2026-07-21, 2026-08-04).

Contents, exactly as the design specifies:

- `deposit_match_rules`, `deposit_match_items`, `deposit_match_links`;
- unique keys: rules `(restaurant_id, pos_source, rail)`, items
  `(restaurant_id, rule_id, business_date)`, links
  `(item_id, bank_transaction_id)`;
- indexes: `(restaurant_id, business_date)` on items;
  `(bank_transaction_id, state)` on links;
- RLS: ONE permissive SELECT policy per table with the single ANDed
  `USING` clause (`view:banking` AND `view:pos_sales`); one policy each for
  INSERT/UPDATE/DELETE with `edit:banking`;
- trigger: `connected_bank_id` tenant check on rules;
- trigger: confirmed-allocation cap on links, with
  `pg_advisory_xact_lock` on the bank transaction id first
  (pattern: `supabase/migrations/20260705130000_claim_open_shift_active_guard.sql:58`);
- `links.bank_transaction_id` is `ON DELETE CASCADE`.

pgTAP first (`supabase/tests/`): schema shape, RLS intersection with a
cross-restaurant denial, the tenant trigger, the allocation cap.

### Task 2 — Migration: adapters and dispatcher

One migration file. Six adapter functions with the fixed signature:

```sql
deposit_match_source_<source>(
  p_restaurant_id uuid, p_start date, p_end date, p_config jsonb
) RETURNS TABLE (business_date date, expected_amount numeric, row_count int)
```

- `focus`: sum `focus_payments.amount` where `name` is in
  `p_config->'card_tender_names'`; raise when the key is absent;
- `toast`: sum `toast_payments.amount + tip_amount` where
  `payment_type = 'CREDIT'` (the literal comes from `p_config`, same raise
  rule);
- `square`: payments minus refunds, filter per Task 0;
- `revel`: sum `revel_payments.amount + tip_amount` filtered by
  `payment_type` values from `p_config`;
- `shift4`: `shift4_charges` minus `shift4_refunds` by `service_date`;
- `clover`: return zero rows (documented in a function comment).

Dispatcher `deposit_match_dispatch(p_source, ...)`: static `CASE`, explicit
`ELSE RAISE EXCEPTION` that names the bad value.

All functions: `SECURITY DEFINER SET search_path = public`, `STABLE`, and
every table read filters `restaurant_id = p_restaurant_id`.

pgTAP first: one fixture per adapter with known card totals; the missing
`source_config` key raises; the dispatcher rejects an unknown source.

### Task 3 — Migration: refresh engine and report RPC

One migration file with two functions:

- `refresh_deposit_matches(p_restaurant_id, p_start_date, p_end_date)` —
  SECURITY DEFINER, capability intersection check first. Visits EVERY rule;
  inactive rules set items to `incomplete` / `rule_inactive`; each rule runs
  in its own `BEGIN ... EXCEPTION` block that lands failures as
  `rule_error`. Match steps 1-5 from the design, with the global fit-ranked
  pair assignment (NOT date-order greedy). Never overwrite `resolution` or a
  confirmed manual link.
- `get_deposit_match_report(p_restaurant_id, p_start_date, p_end_date)` —
  STABLE, same auth check, returns the one JSONB payload (summary, streams,
  ledger rows with links, freshness per bank).

pgTAP first: idempotent refresh; the greedy-order regression (two adjacent
days where a date-order pass fails); a stale bank never yields `late` or
`short`; an unconfirmed rule keeps items `incomplete`; resolution survives a
refresh; the report summary equals the ledger sum.

Run `npm run test:db` locally. If a sibling worktree holds the Supabase
stack, defer the GREEN signal to CI (lesson 2026-08-20) and say so in the
commit message.

### Task 4 — Types and hook

- `src/types/depositMatch.ts`: payload types, the status union, type guards
  for the RPC payload.
- `src/hooks/useDepositMatch.ts`: read query on key
  `['deposit-match', restaurantId, start, end]`, `staleTime: 30000`,
  `refetchOnWindowFocus: true`, NO `placeholderData`. The refresh RPC is a
  mutation; one effect runs it once per `(restaurantId, range)` change and
  invalidates the read key on success.
- Mutation hooks for: rule create/update, resolution write
  (accept/dispute), link confirm.

Vitest first (`tests/unit/`): payload parsing and type guards, status/fee
helper functions, the query-key shape.

### Task 5 — Page and components

Files per the design (`src/pages/DepositMatch.tsx` plus the eight
components under `src/components/deposit-match/`). Key constraints:

- the page self-guards with `usePermissions()` on the capability
  intersection;
- all UI content comes from the report payload; no hardcoded POS names;
- `DailyLedger` tabs map over the payload streams; `activeTab` is a string
  with a first-stream default and fallback;
- ONE instance of each dialog at page level, driven by `activeItem`;
- `SetupDialog` marks non-measured defaults "Suggested values — check them
  against your bank";
- the dispute dialog labels a cause only with POS evidence; otherwise
  "unknown";
- CLAUDE.md styling tokens, all four render states, `aria-label` on
  icon-only controls.

Register the route `/banking/deposit-match` next to `/banking`
(src/App.tsx:415). Add an entry link from the Banking page.

### Task 6 — E2E

Playwright (`tests/e2e/`): open the page, create a rule, see the ledger,
accept a short day, and verify a banking-only collaborator cannot open the
route. Use `generateTestUser()` and accessible selectors.

### Task 7 — Verify and ship

- `npm run typecheck`, `npm run lint`, `npm run test`, `npm run test:db`;
- the dev-build-and-ship workflow then runs the UI review, code-simplify,
  the Phase 7a reviewers, CodeRabbit, the PR, and the CI loop.

## Execution

After user approval, launch the workflow:

```
Workflow({
  scriptPath: ".claude/workflows/dev-build-and-ship.js",
  args: {
    worktreePath: "/Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/deposit-match",
    branch: "feature/deposit-match",
    designDocPath: "docs/superpowers/specs/2026-09-01-deposit-match-design.md",
    planPath: "docs/superpowers/plans/2026-09-01-deposit-match-plan.md"
  }
})
```

## Out of scope

See the design doc non-goals: cash rail, Clover card reconciliation, PDF
export, cron refresh, holiday calendars, cross-restaurant aggregation.

## Risks

- Square `raw_json` field unknown until Task 0 — the plan carries both
  outcomes.
- Migration prefix collision — Task 1 checks the merge ref.
- Shared local Supabase stack — defer pgTAP GREEN to CI on contention.
