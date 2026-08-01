# Tip pool role percentages — guaranteed and fixed shares

**Date:** 2026-07-31
**Branch:** `feature/tip-pool-percentage`
**Status:** Approved for planning

## Problem

Three complaints, from the manager who runs the daily tip split:

1. **Percentages are invisible.** Hours are entered one employee at a time in a plain number grid; nothing on screen says what fraction of the pool each person is landing on. The manager is typing hours blind and only discovers the result on the next screen.
2. **There is no way to pin someone to a percentage.** Allocation is derived from hours (or role weights, or an even split) and nothing else.
3. **There is no guarantee.** A manager or another designated role should take *the higher of* a configured percentage or their hours-derived share, so that working a short shift does not collapse their cut.

None of this exists today. `share_method` is constrained to `'hours' | 'role' | 'manual'` (`supabase/migrations/20251217000001_create_tip_pooling_tables.sql:10`), and `role_weights` is a relative multiplier feeding a ratio distribution (`src/utils/tipPooling.ts:99-119`) — a weight of 2 does not promise 2% or 20% of anything, it just doubles someone's slice relative to their peers. There is no floor concept anywhere in the module.

## Scope

**In scope:** the Full Pool model only — the flow at Tips → Hours worked → Review.

**Out of scope, deliberately:**

- **Percentage Contribution pools.** Those distribute each sub-pool with its own `shareMethod` (`src/utils/tipPooling.ts:259-286`) and refund contributions proportionally when a pool has no eligible workers (`src/utils/tipPooling.ts:235-254`). Layering guarantees onto that refund interaction is a separate design.
- **`tip_split_items` columns.** `insertSplitItems` currently hardcodes `role_weight: null` and `manually_edited: false` on every write (`src/hooks/useTipSplits.tsx:183-184`). That is a pre-existing gap unrelated to this feature. The `amount` column stays the record of truth for an approved split; nothing here depends on persisting the rule that produced it.

## Model

Each **role** carries an optional allocation rule. Rules are per-person: if the Manager role is set to 10% and two managers work, that is 20% of the pool committed to guarantees.

| Mode | Behaviour |
|---|---|
| `hours` (absent / default) | Current behaviour. Share comes entirely from the base share method. |
| `at_least` | The higher of the configured percentage or the base-method share. Only ever raises someone. |
| `exactly` | Exactly the configured percentage, off the top. The base method does not apply. |

Two properties follow, and both matter for the UI:

- **`at_least` never caps.** If the only person working is a manager on `at_least 10%`, they receive 100% of the pool, not 10%. The floor lifts, it does not hold down.
- **Money can only be stranded in the all-`exactly` case.** Anyone on `hours` or `at_least` participates in the remainder pass and absorbs whatever the `exactly` people did not claim. The pool is left short only when every participant that day is on `exactly` and their percentages total under 100%.

Rules overlay whichever base share method is selected. The base method decides how the *remainder* is divided, so guarantees compose with By Hours, By Role weights, and Even Split alike by reusing `calculateTipSplitByHours`, `calculateTipSplitByRole`, and `calculateTipSplitEven` (`src/utils/tipPooling.ts:50-119`) unchanged.

## Algorithm

A new pure function in `src/utils/tipPooling.ts`, alongside the existing splitters:

```ts
export type RoleAllocationMode = 'at_least' | 'exactly';

export type RoleAllocationRule = {
  mode: RoleAllocationMode;
  percentage: number; // 0–100
};

export type GuaranteedParticipant = {
  id: string;
  name: string;
  hours?: number;
  role?: string;
  rule?: RoleAllocationRule;
};

export type GuaranteedSplitResult = {
  shares: TipShare[];
  /** Employees whose `at_least` floor raised them above their base share. */
  liftedEmployeeIds: string[];
  /** Set when guarantees exceeded the pool and every rule was scaled down. */
  scaledDownFactor: number | null;
  /** Cents redistributed because only `exactly` participants worked. */
  redistributedLeftoverCents: number;
};

export function calculateTipSplitWithGuarantees(
  totalTipsCents: number,
  participants: GuaranteedParticipant[],
  distributeRemainder: (poolCents: number, subset: GuaranteedParticipant[]) => TipShare[],
): GuaranteedSplitResult;
```

Steps:

1. **Convert rules to cents.** `exactCents[i] = round(total × pct / 100)` for `exactly`, `floorCents[i]` likewise for `at_least`.
2. **Feasibility.** If `sum(exactCents) + sum(floorCents) > total`, scale every guarantee by `total / (sum of guarantees)` and record `scaledDownFactor`. Reachable because rules are per-person — three managers at 40% each overshoot even though 40% alone is legal.
3. **Reserve.** Lock the `exactly` participants at their (possibly scaled) amount. `pool = total − sum(exactCents)`; candidates = everyone else.
4. **Water-fill.** Run `distributeRemainder(pool, candidates)`. Any candidate whose share fell below their floor is locked at the floor, `pool` is reduced by that amount, and they leave the candidate set. Repeat until a pass locks nobody new. Terminates because each iteration removes at least one candidate.
5. **Leftover.** If the candidate set is empty and `pool > 0` — the all-`exactly` case — split `pool` among the locked participants in proportion to their configured percentages and record `redistributedLeftoverCents`.
6. **Reconcile.** Sum the allocations; add any residual cent to the last non-`exactly` participant, or to the last participant if all are `exactly`. The result must satisfy `sum(shares) === totalTipsCents` exactly, because `TipReviewScreen` disables "Approve tips" unless `remaining === 0` (`src/components/tips/TipReviewScreen.tsx:167`) — a one-cent drift would make the split unapprovable.

Shares are returned in the original `participants` order. This deliberately differs from `rebalanceAllocations`, which appends the changed employee last and reorders the array (`src/utils/tipPooling.ts:146-152`); a reordering splitter would make the entry grid jump around as hours are typed.

### Edge cases and their resolution

| Case | Result |
|---|---|
| No rules configured | Byte-identical to today's output. The function delegates straight to `distributeRemainder` with the full pool. |
| `totalTipsCents <= 0` | Every share is 0, matching the existing guards (`src/utils/tipPooling.ts:54-56`, `76-78`). |
| Empty participant list | Empty result. |
| All hours are 0 | The remainder pass falls back to an even split, which `calculateTipSplitByHours` already does (`src/utils/tipPooling.ts:80-84`). Floors still apply on top. |
| Floor of 0% | Never binds; equivalent to `hours`. |
| Rule on a role nobody worked | Ignored — rules are read per participating employee, not per configured role. |
| Guarantees total exactly 100% | Remainder pool is 0; everyone lands on their guarantee. No division by zero (`distributeByRatio` already guards `totalRatio > 0`, `src/utils/tipPooling.ts:24-27`). |

All amounts are non-negative, so the `Math.round(-0.5) === -0` hazard recorded in `memory/lessons.md` does not arise; the scaling factor in step 2 is likewise a positive ratio.

## Data

One column, mirroring how `pooling_model` was added to the same table (`supabase/migrations/20260221000000_percentage_tip_pooling.sql:16-17`):

```sql
ALTER TABLE tip_pool_settings
  ADD COLUMN IF NOT EXISTS role_percentages JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN tip_pool_settings.role_percentages IS
  'Per-role allocation rules: { "Manager": { "mode": "at_least", "percentage": 10 } }. Empty object means hours-only.';
```

Shape: `Record<string, { mode: 'at_least' | 'exactly'; percentage: number }>` — a sibling of the existing `role_weights JSONB DEFAULT '{}'::jsonb` (`supabase/migrations/20251217000001_create_tip_pooling_tables.sql:12`), so the round-trip pattern in `useTipPoolSettings` is already established (`src/hooks/useTipPoolSettings.tsx:16`, `26`).

No new table, no new RLS policy — the column inherits `tip_pool_settings`' existing policies. Existing rows default to `{}`, which the algorithm treats as "no rules", so the change is inert until a manager configures something.

`TipPoolSettings` and `TipPoolSettingsUpdate` gain the field (`src/hooks/useTipPoolSettings.tsx:10-31`), and `useAutoSaveTipSettings` gains it in both its params and its change detection, alongside the `JSON.stringify` comparison already used for `role_weights` (`src/hooks/useAutoSaveTipSettings.ts:15`, `42`).

## UI

### Settings — Role allocation

A new section in `TipPoolSettingsDialog`, rendered for `isFullPool` (`src/components/tips/TipPoolSettingsDialog.tsx:118`) and placed after Share Method (`src/components/tips/TipPoolSettingsDialog.tsx:261`). It is **not** gated on `shareMethod === 'role'` the way Role Weights is (`src/components/tips/TipPoolSettingsDialog.tsx:335`), because rules overlay every base method.

```
┌ ROLE ALLOCATION ─────────────────────────────────────────┐
│ Manager      [ By hours │ At least │ Exactly ]   [ 10 ] % │
│ Chef         [ By hours │ At least │ Exactly ]   [ 15 ] % │
│ Server       [ By hours │ At least │ Exactly ]      —     │
│ Bartender    [ By hours │ At least │ Exactly ]      —     │
├──────────────────────────────────────────────────────────┤
│ 25% of the pool is guaranteed before hours are applied.  │
└──────────────────────────────────────────────────────────┘
```

- Roles come from `uniqueRoles`, the same derivation Role Weights uses (`src/components/tips/TipPoolSettingsDialog.tsx:92`).
- Three-way segmented control per role. The percent input renders only for `at_least` / `exactly`, `min={0} max={100} step={1}`.
- Footer states the configured total. Above 100% it turns amber and reads "Over 100% — guarantees will be scaled down proportionally on days they don't fit." It **warns, it does not block**: settings auto-save on a 1s debounce with no explicit save button (`src/hooks/useAutoSaveTipSettings.ts:53-55`), and because rules are per-person the configured total is not the runtime total anyway — two managers at 10% commit 20%. Runtime scaling (algorithm step 2) is the real safety net.
- Container follows the existing section pattern: `rounded-xl border border-border/40 bg-muted/30 overflow-hidden` with a `bg-muted/50` header bar, matching Role Weights.
- The segmented control is a radio group with an accessible group label per role, so the role name is announced with the selection. The percent input gets a `<Label htmlFor>` reading "<Role> percentage".

### Hours entry — live percentage

The fix for the original complaint. The `grid md:grid-cols-2` of hour inputs (`src/pages/Tips.tsx:648-745`) gains derived feedback per row.

```
Pool $300.00 · 5 people · 100% allocated

Jose Delgado                        Maria Lopez           Guaranteed 10%
Manager                             Chef
[ 6.0 ] hrs    18.2% · $54.60       [ 8.0 ] hrs    10.0% · $30.00  ↑
```

- The `18.2% · $54.60` recomputes on every keystroke, driven by the same `previewShares` memo that already feeds the review screen (`src/pages/Tips.tsx:394-409`). Styled `text-[13px] text-muted-foreground tabular-nums` so digits do not jitter as they change.
- Roles carrying a rule show a badge — `text-[11px] px-1.5 py-0.5 rounded-md bg-muted` — reading "Guaranteed 10%" or "Fixed 15%".
- An arrow marks rows in `liftedEmployeeIds`, where the floor actually raised someone above their hours share, with an `aria-label` spelling it out ("Guaranteed minimum applied"). Icon-only indicators are never the sole carrier of meaning: the percentage text itself already shows the outcome.
- A summary line above the grid gives pool total, headcount, and allocation status.
- The section currently renders only when `shareMethod === 'hours'` (`src/pages/Tips.tsx:648`). That gate is unchanged — this is the hours-entry screen — but the percentage readout is computed from `previewShares` regardless of method, so the same component is reusable if the gate is ever widened.

### Review — percentage column

`AllocationTable` (`src/components/tips/TipReviewScreen.tsx:196-284`) gains a **% of pool** column between Hours and Tip. Right-aligned, `tabular-nums`.

The column is derived from `amountCents / totalTipsCents`, not from the rule, so it stays correct after a manual override — amounts are click-to-edit and route through `handleAmountChange` → `rebalanceAllocations` (`src/components/tips/TipReviewScreen.tsx:58`, `125-126`). Guarantee badges carry over from the entry screen.

An amber note renders above the Approve button, next to the existing "Total remaining" block (`src/components/tips/TipReviewScreen.tsx:146-153`), when either lossy branch fired:

- scaled down — "Guarantees totalled more than the pool and were reduced proportionally."
- leftover redistributed — "No hourly staff worked; the remaining $X was split across the fixed percentages."

Neither blocks approval. Both use `text-[13px]` amber-on-`amber-500/10` consistent with the existing advisory panel styling.

## Testing

**Unit** — `tests/unit/tipPooling-guarantees.test.ts`, against the pure function. The module already has five sibling suites (`tests/unit/tipPooling*.test.ts`), and keeping the logic in `src/utils` rather than in a component is what makes it countable toward the 80%-on-new-code SonarCloud gate.

Cases: no rules (identical output to the current splitter); floor binding; floor not binding; `exactly` mode; mixed modes; the `at_least`-only case reaching 100%; all-`exactly` leftover redistribution; overshoot scaling; per-person multiplication with two people in one role; cent exactness across many participants; zero hours; zero total; empty participants; 0% rule; guarantees summing to exactly 100%.

**Component** — extend `tests/unit/TipPoolSettingsDialog.test.tsx` for the new section: mode switching, percent input clamping, the over-100% warning, and that changing a rule propagates to the parent callback.

**Database** — a pgTAP test asserting `role_percentages` exists on `tip_pool_settings`, is `NOT NULL`, defaults to `{}`, and that a pre-existing row reads back `{}` after migration. Follows `supabase/tests/34_percentage_tip_pooling.sql`.

**E2E** — extend the tip-sharing spec: configure a role guarantee, enter hours that would otherwise put that person below the floor, assert the percentage readout on the entry screen and the guaranteed amount plus badge in review. Accessible selectors per the project convention.

## Files

| File | Change |
|---|---|
| `supabase/migrations/<ts>_tip_role_percentages.sql` | New — add `role_percentages` column |
| `supabase/tests/35_tip_role_percentages.sql` | New — column assertions |
| `src/utils/tipPooling.ts` | Add types + `calculateTipSplitWithGuarantees` |
| `src/hooks/useTipPoolSettings.tsx` | Add `role_percentages` to both interfaces |
| `src/hooks/useAutoSaveTipSettings.ts` | Track the new field in change detection |
| `src/components/tips/RoleAllocationSection.tsx` | New — settings section |
| `src/components/tips/TipPoolSettingsDialog.tsx` | Render the new section |
| `src/pages/Tips.tsx` | Wire rules through; percentage readout in the hours grid |
| `src/components/tips/TipReviewScreen.tsx` | % column, badges, advisory note |
| `tests/unit/tipPooling-guarantees.test.ts` | New |
| `tests/unit/TipPoolSettingsDialog.test.tsx` | Extend |
| `tests/e2e/tip-sharing.spec.ts` | Extend |
