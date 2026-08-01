# Tip pool role percentages — guaranteed and fixed shares

**Date:** 2026-07-31
**Branch:** `feature/tip-pool-percentage`
**Status:** Approved for planning — revised after Phase 2.5 design review

## Problem

Three complaints, from the manager who runs the daily tip split:

1. **Percentages are invisible.** Hours are entered one employee at a time in a plain number grid; nothing on screen says what fraction of the pool each person is landing on. The manager is typing hours blind and only discovers the result on the next screen.
2. **There is no way to pin someone to a percentage.** Allocation is derived from hours (or role weights, or an even split) and nothing else.
3. **There is no guarantee.** A manager or another designated role should take *the higher of* a configured percentage or their hours-derived share, so that working a short shift does not collapse their cut.

None of this exists today. `share_method` is constrained to `'hours' | 'role' | 'manual'` (`supabase/migrations/20251217000001_create_tip_pooling_tables.sql:10`), and `role_weights` is a relative multiplier feeding a ratio distribution (`src/utils/tipPooling.ts:99-119`) — a weight of 2 does not promise 2% or 20% of anything, it just doubles someone's slice relative to their peers. There is no floor concept anywhere in the module.

## Scope

**In scope:** the Full Pool model only — the flow at Tips → Hours worked → Review.

**Out of scope:** Percentage Contribution pools. Those distribute each sub-pool with its own `shareMethod` (`src/utils/tipPooling.ts:259-286`) and refund contributions proportionally when a pool has no eligible workers (`src/utils/tipPooling.ts:235-254`). Layering guarantees onto that refund interaction is a separate design.

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

`TipShare` (`src/utils/tipPooling.ts:3-9`) gains two optional fields so per-employee provenance travels with the allocation instead of in a parallel array:

```ts
export type TipShare = {
  // …existing fields
  appliedRule?: RoleAllocationRule;
  /** True when an `at_least` floor raised this share above its base-method value. */
  lifted?: boolean;
};
```

This is what makes "badges carry over from the entry screen" work mechanically: `rebalanceAllocations` rebuilds each entry as `{ ...a, amountCents }` (`src/utils/tipPooling.ts:141-144`), so the new fields survive a manual override for free, and `insertSplitItems` can persist them without a second lookup.

Steps:

1. **Convert rules to cents.** `exactCents[i] = round(total × pct / 100)` for `exactly`, `floorCents[i]` likewise for `at_least`.
2. **Feasibility.** If `sum(exactCents) + sum(floorCents) > total`, scale every guarantee by `total / (sum of guarantees)` and record `scaledDownFactor`. Reachable because rules are per-person — three managers at 40% each overshoot even though 40% alone is legal.
3. **Reserve.** Lock the `exactly` participants at their (possibly scaled) amount. `pool = total − sum(exactCents)`; candidates = everyone else.
4. **Water-fill.** Run `distributeRemainder(pool, candidates)`. Any candidate whose share fell below their floor is locked at the floor and marked `lifted`, `pool` is reduced by that amount, and they leave the candidate set. Repeat until a pass locks nobody new. Terminates because each iteration removes at least one candidate.
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

All amounts are non-negative, so the `Math.round(-0.5) === -0` hazard recorded in `memory/lessons.md:260-261` does not arise; the scaling factor in step 2 is likewise a positive ratio. Non-negativity is enforced at both ends — the UI clamps the input and the database rejects out-of-range values (below) — rather than being assumed.

## Data

### Settings column

Mirroring how `pooling_model` was added to the same table, including the re-runnable `DO` block for the constraint (`supabase/migrations/20260221000000_percentage_tip_pooling.sql:16-30`):

```sql
ALTER TABLE tip_pool_settings
  ADD COLUMN IF NOT EXISTS role_percentages JSONB NOT NULL DEFAULT '{}'::jsonb;

-- guarded by the same IF NOT EXISTS pg_constraint pattern as pooling_model
ALTER TABLE tip_pool_settings
  ADD CONSTRAINT tip_pool_settings_role_percentages_check
  CHECK (
    jsonb_typeof(role_percentages) = 'object'
    AND NOT jsonb_path_exists(role_percentages, '$.* ? (@.mode != "at_least" && @.mode != "exactly")')
    AND NOT jsonb_path_exists(role_percentages, '$.* ? (@.percentage < 0 || @.percentage > 100)')
    AND NOT jsonb_path_exists(role_percentages, '$.* ? (!exists(@.mode) || !exists(@.percentage))')
  );
```

Shape: `Record<string, { mode: 'at_least' | 'exactly'; percentage: number }>` — a sibling of the existing `role_weights JSONB DEFAULT '{}'::jsonb` (`supabase/migrations/20251217000001_create_tip_pooling_tables.sql:12`), so the round-trip pattern in `useTipPoolSettings` is already established (`src/hooks/useTipPoolSettings.tsx:16`, `28`).

The constraint is not optional. RLS gates rows, not column shape, so without it any client with write access to `tip_pool_settings` could store `{"Manager": {"mode": "bogus", "percentage": -50}}` and the algorithm's non-negativity assumption would rest entirely on a UI `min`/`max` attribute.

`ADD COLUMN … NOT NULL DEFAULT '{}'` is a metadata-only operation on a constant default in modern Postgres, so it does not rewrite the table, and it is orthogonal to `unique_active_settings UNIQUE(restaurant_id, active)`. Existing rows read back `{}`, which the algorithm treats as "no rules", so the change is inert until a manager configures something.

No new RLS policy: `tip_pool_settings` policies scope by `restaurant_id` and owner/manager role via `user_restaurants` (`supabase/migrations/20251217000001_create_tip_pooling_tables.sql:91-125`) with no column-level grants, and no edge function touches this table.

### Split-item provenance

```sql
ALTER TABLE tip_split_items
  ADD COLUMN IF NOT EXISTS applied_rule JSONB;
```

Nullable, no default — `NULL` means "no rule applied", which is every existing row and every hours-only allocation. `insertSplitItems` writes `share.appliedRule ?? null` alongside the fields it already builds (`src/hooks/useTipSplits.tsx:177-185`).

This is a deliberate addition to an area the first draft of this spec put out of scope. The reason: tips are money, the schema carries a `tip_disputes` table with a `wrong_role` dispute type (`supabase/migrations/20251217000001_create_tip_pooling_tables.sql:52-57`), and this feature is the first thing in the product that makes an explicit promise to an employee ("you are guaranteed 10%"). Without this column there is no record anywhere of whether a given `amount` came from a floor lift, a fixed share, or plain hours — the split-level audit trigger logs only status transitions on `tip_splits` (`supabase/migrations/20260103000000_add_tip_split_audit.sql:54-88`).

Scope limit: this column is written for audit, not read for display. Resuming a split already re-derives amounts live — `handleResumeDraft` restores only `hours_worked` from the stored items and lets `previewShares` recompute (`src/pages/Tips.tsx:458-470`, `394-409`) — so badges and amounts on a reopened split stay consistent with each other under current settings. Building a historical-rules display path is a separate change and is not proposed here.

### Generated types

`src/integrations/supabase/types.ts` is kept in sync per-migration in this repo — it already carries `pooling_model` and `role_weights` on `tip_pool_settings` (`src/integrations/supabase/types.ts:8434-8436`). Both new columns require regenerating it as part of this change; the repo has a `sync-types` skill for exactly this.

`TipPoolSettings` / `TipPoolSettingsUpdate` gain `role_percentages` (`src/hooks/useTipPoolSettings.tsx:10-31`), `TipSplitItem` gains `applied_rule` (`src/hooks/useTipSplits.tsx:23-33`), and `useAutoSaveTipSettings` gains the field in both its params and its change detection, alongside the `JSON.stringify` comparison already used for `role_weights` (`src/hooks/useAutoSaveTipSettings.ts:15`, `43`).

## UI

### Settings — Role allocation

A new `src/components/tips/RoleAllocationSection.tsx`, rendered by `TipPoolSettingsDialog` for `isFullPool` (`src/components/tips/TipPoolSettingsDialog.tsx:118`) and placed after Share Method (`src/components/tips/TipPoolSettingsDialog.tsx:261`). It is **not** gated on `shareMethod === 'role'` the way Role Weights is (`src/components/tips/TipPoolSettingsDialog.tsx:336`), because rules overlay every base method.

```
┌ ROLE ALLOCATION ─────────────────────────────────────────┐
│ Manager      [ By hours │ At least │ Exactly ]   [ 10 ] % │
│ Chef         [ By hours │ At least │ Exactly ]   [ 15 ] % │
│ Server       [ By hours │ At least │ Exactly ]      —     │
│ Bartender    [ By hours │ At least │ Exactly ]      —     │
├──────────────────────────────────────────────────────────┤
│ ⚠ 10% + 15% per person on these roles                    │
└──────────────────────────────────────────────────────────┘
```

**Component contract.** Fully controlled, matching Role Weights rather than `ContributionPoolEditor`. `ContributionPoolEditor` owns local state because it manages server-side pool rows with their own mutations; this section edits one JSONB field that the parent already owns and auto-saves.

```ts
type RoleAllocationSectionProps = {
  roles: string[];
  rules: Record<string, RoleAllocationRule>;
  onChange: (rules: Record<string, RoleAllocationRule>) => void;
};
```

The parent mirrors the `localRoleWeights` pattern — local state synced from props via `useEffect` and pushed up on change (`src/components/tips/TipPoolSettingsDialog.tsx:84-89`, `113-115`) — so the existing 1s autosave debounce (`src/hooks/useAutoSaveTipSettings.ts:53-55`) picks it up unchanged.

**Primitive.** `ToggleGroup` (`src/components/ui/toggle-group.tsx`, already installed), `type="single"`, one per role. Not `RadioGroup`: the three existing radio groups in this dialog are full-width stacked option cards (`src/components/tips/TipPoolSettingsDialog.tsx:227-256`, `274-330`, `383-418`), which is the wrong footprint for a compact per-row three-way control. Accessibility follows the toggle-group pattern accordingly — the root carries `aria-label={`${role} allocation mode`}`, not radiogroup semantics.

- Roles come from `uniqueRoles`, the same derivation Role Weights uses (`src/components/tips/TipPoolSettingsDialog.tsx:92`).
- The percent input renders only for `at_least` / `exactly`, `min={0} max={100} step={0.5}`, with a `<Label htmlFor>` reading "<Role> percentage". Half-point steps because 12.5% is a plausible guarantee.
- **Footer copy states per-person totals, not a pool fraction.** "10% + 15% per person on these roles" — never "25% of the pool is guaranteed". With two managers configured at 10% the day's real commitment is 20%, so a summed "% of the pool" figure would actively mislead, which is the opposite of what this feature is for. When the sum exceeds 100% the footer turns amber, pairs with an `AlertTriangle` icon per the existing advisory pattern (`src/components/tips/TipReviewScreen.tsx:400-405`), and reads "Over 100% — guarantees will be scaled down proportionally on days they don't fit."
- The warning does not block. Settings auto-save on a debounce with no save button, and because rules are per-person a settings-time check cannot see the runtime total anyway. Runtime scaling (algorithm step 2) is the real safeguard.
- Container follows the existing section pattern: `rounded-xl border border-border/40 bg-muted/30 overflow-hidden` with a `bg-muted/50` header bar, matching Role Weights (`src/components/tips/TipPoolSettingsDialog.tsx:337-343`).

### Hours entry — live percentage

The fix for the original complaint. Each row in the hours grid is currently a two-part stack: a `flex items-center justify-between` header holding the employee `Label` (name plus an optional auto-calculated clock icon) and a conditional "No punches" note, above a full-width `Input` (`src/pages/Tips.tsx:699-729`).

The percentage goes in the header row's right-hand slot, which is where "No punches" sits today. That keeps the existing two-line structure and the full-width input intact — no width juggling, no new role line:

```
Pool $300.00 · 5 people · 100% allocated

Jose Delgado                        Maria Lopez  Guaranteed 10%
              18.2% · $54.60                     10.0% · $30.00 ↑
[  6.0                    ]         [  8.0                    ]
```

- The right slot becomes a small flex cluster: the "No punches" note (unchanged), then the percentage readout. Styled `text-[13px] text-muted-foreground tabular-nums`.
- Roles carrying a rule show a badge next to the name — `text-[11px] px-1.5 py-0.5 rounded-md bg-muted` — reading "Guaranteed 10%" or "Fixed 15%".
- Rows where `share.lifted` is true get an arrow with `aria-label="Guaranteed minimum applied"`. The percentage text already carries the outcome, so the icon is never the sole signal.
- **The readout is debounced 200ms; the underlying state is not.** `previewShares` is a single memo across all participants (`src/pages/Tips.tsx:394-409`), so a keystroke in one row shifts every other row's percentage. Typing "12" one digit at a time would otherwise flash the whole grid through the intermediate "1" state. Debouncing only the displayed value leaves `hoursByEmployee`, the manual-edit flags, and autosave on their existing immediate path. The cost is display-only, so no correctness risk.
- A summary line above the grid gives pool total, headcount, and allocation status.
- The section's render gate is `!isPercentageContribution && shareMethod === 'hours'` (`src/pages/Tips.tsx:648`) and is unchanged.

### Review — percentage column

`AllocationTable` (`src/components/tips/TipReviewScreen.tsx:196-284`) gains a **% of pool** column before Tip. Right-aligned, `tabular-nums`.

Derived from `amountCents / totalTipsCents`, not from the rule, so it stays correct after a manual override — amounts are click-to-edit and route through `handleAmountChange` → `rebalanceAllocations` (`src/components/tips/TipReviewScreen.tsx:58`, `125-126`). Guarantee badges render next to the name from `share.appliedRule`.

**Narrow-viewport handling, which the table does not have today.** The wrapper at `src/components/tips/TipReviewScreen.tsx:214` is `rounded-xl border border-border/40 overflow-hidden` with no horizontal scroll anywhere in the file, and Hours and Role are mutually exclusive (`:219-224`) so the table has never exceeded three columns. Making % unconditional pushes it to four permanently. Three changes, all confined to this component:

- Add `overflow-x-auto` to the wrapper so the table can scroll rather than crush.
- Add `truncate max-w-[12rem]` to the employee-name cell (`:235`), which has no truncation today.
- The edit-mode `Input` is a fixed `w-32` that cannot shrink (`:266`); make it `w-24 sm:w-32`.

The Hours column hides below `sm:` — hours are entered on the previous screen and remain visible there, whereas the percentage is the new information this feature exists to surface.

An advisory note renders above the Approve button, beside the existing "Total remaining" block (`src/components/tips/TipReviewScreen.tsx:146-153`), when either lossy branch fired. Both use `AlertTriangle` on `amber-500/10` matching the refunded-pool notice (`src/components/tips/TipReviewScreen.tsx:400-405`):

- scaled down — "Guarantees totalled more than the pool and were reduced proportionally."
- leftover redistributed — "No hourly staff worked; the remaining $X was split across the fixed percentages."

Neither blocks approval.

## Testing

**Unit** — `tests/unit/tipPooling-guarantees.test.ts`, against the pure function. The module already has five sibling suites (`tests/unit/tipPooling*.test.ts`), and keeping the logic in `src/utils` rather than in a component is what makes it countable toward the 80%-on-new-code SonarCloud gate.

Cases: no rules (identical output to the current splitter); floor binding; floor not binding; `exactly` mode; mixed modes; the `at_least`-only case reaching 100%; all-`exactly` leftover redistribution; overshoot scaling; per-person multiplication with two people in one role; `appliedRule` and `lifted` surviving a `rebalanceAllocations` override; cent exactness across many participants; zero hours; zero total; empty participants; 0% rule; guarantees summing to exactly 100%.

**Component** — extend `tests/unit/TipPoolSettingsDialog.test.tsx`: mode switching via the toggle group, percent input clamping, the over-100% warning copy, and propagation to the parent callback.

**Database** — `supabase/tests/tip_role_percentages.test.sql`, following the descriptive-name convention used by the newer tests (numeric prefixes are exhausted through `62_`). Asserts both columns exist with the right nullability and defaults, that a pre-existing settings row reads back `{}`, and — mirroring `supabase/tests/34_percentage_tip_pooling.sql:61` — `throws_ok` cases for each rejected shape: non-object, unknown `mode`, `percentage` outside 0–100, and a missing key.

**E2E** — extend `tests/e2e/tip-sharing.spec.ts`: configure a role guarantee, enter hours that would otherwise put that person below the floor, assert the percentage readout on the entry screen and the guaranteed amount plus badge in review. Accessible selectors per the project convention.

## Files

| File | Change |
|---|---|
| `supabase/migrations/<ts>_tip_role_percentages.sql` | New — `role_percentages` + CHECK, `applied_rule` |
| `supabase/tests/tip_role_percentages.test.sql` | New — column and constraint assertions |
| `src/integrations/supabase/types.ts` | Regenerate |
| `src/utils/tipPooling.ts` | Add types, extend `TipShare`, add `calculateTipSplitWithGuarantees` |
| `src/hooks/useTipPoolSettings.tsx` | Add `role_percentages` to both interfaces |
| `src/hooks/useTipSplits.tsx` | Add `applied_rule` to `TipSplitItem`; persist in `insertSplitItems` |
| `src/hooks/useAutoSaveTipSettings.ts` | Track the new field in change detection |
| `src/components/tips/RoleAllocationSection.tsx` | New — settings section |
| `src/components/tips/TipPoolSettingsDialog.tsx` | Render the new section |
| `src/pages/Tips.tsx` | Wire rules through; debounced percentage readout in the hours grid |
| `src/components/tips/TipReviewScreen.tsx` | % column, narrow-viewport handling, badges, advisory notes |
| `tests/unit/tipPooling-guarantees.test.ts` | New |
| `tests/unit/TipPoolSettingsDialog.test.tsx` | Extend |
| `tests/e2e/tip-sharing.spec.ts` | Extend |
