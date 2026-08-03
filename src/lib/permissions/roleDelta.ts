/**
 * What actually changes when a member moves between two roles.
 *
 * Deliberately NOT derived from `buildRolePreview`. `RolePreview` is
 * `{summary, navPreview, grantCount}` (preview.ts:64-68) — there is no
 * capability set on it to diff, and the two obvious approximations are both
 * silently wrong. `buildSummary`'s blocked-list checks only `view:costs` of
 * the three `SensitiveFlag`s (preview.ts:159), and `navPreview` does not
 * represent flags at all, so a move flipping only `view:pay_rates` or
 * `view:employee_pii` would render "same areas" — telling the admin nothing
 * changed at the exact moment pay-rate visibility changed hands.
 *
 * It is also not folded INTO `buildRolePreview`'s return shape: that function
 * feeds the role editor's live preview, and widening it to serve a two-role
 * diff would couple two unrelated screens through one growing struct.
 */
import {
  AREA_DEFINITIONS,
  SENSITIVE_FLAGS,
  grantMap,
  type AreaKey,
  type AreaLevel,
  type SensitiveFlag,
} from './areas';
import { rowLevel } from './preview';

/**
 * Why this file does NOT diff on `rowLevel` alone.
 *
 * `rowLevel` returns the *highest* level among a row's underlying `areaKeys`
 * (preview.ts:91-99), and four rows group two keys each (areas.ts:21-28).
 * Diffing the collapsed value therefore hides a real capability change whenever
 * the max is unmoved: `{inventory: manage, purchasing: view}` and
 * `{inventory: manage, purchasing: manage}` both collapse to `manage`, so the
 * picker would report "Same access" at the moment purchase-order editing
 * changed hands. The split exists precisely because the builtins do not
 * partition along the ten coarse rows.
 *
 * So the comparison runs per `AreaKey` and only the *labels* are grouped. A row
 * whose keys move in both directions is honest about it and appears in both
 * `gains` and `loses`.
 */

export interface RoleGrantSet {
  areas: ReadonlyArray<{ area_key: AreaKey; level: AreaLevel }>;
  flags: readonly SensitiveFlag[];
}

export interface AreaDeltaLine {
  /** The editor row's human label — `AreaDefinition.label`, never a raw key. */
  label: string;
  from: AreaLevel | null;
  to: AreaLevel | null;
}

export interface FlagDeltaLine {
  flag: SensitiveFlag;
  label: string;
}

export interface RoleDelta {
  gains: AreaDeltaLine[];
  loses: AreaDeltaLine[];
  flagGains: FlagDeltaLine[];
  flagLoses: FlagDeltaLine[];
  /** No area and no flag differs — the picker says so plainly. */
  isSame: boolean;
}

/** null < view < manage. */
function rank(level: AreaLevel | null): number {
  if (level === 'manage') return 2;
  if (level === 'view') return 1;
  return 0;
}

export function roleDelta(current: RoleGrantSet, candidate: RoleGrantSet): RoleDelta {
  const currentGrants = grantMap(current.areas);
  const candidateGrants = grantMap(candidate.areas);

  const gains: AreaDeltaLine[] = [];
  const loses: AreaDeltaLine[] = [];

  // Compare every underlying area key; group only the label. `from`/`to` stay
  // the row-level summary so the rendered line still reads the way the editor
  // and RoleAreaChips name things, but whether a line is emitted at all is
  // decided by the individual keys — see the note above this function.
  for (const row of AREA_DEFINITIONS) {
    const from = rowLevel(row, currentGrants);
    const to = rowLevel(row, candidateGrants);

    let anyRose = false;
    let anyFell = false;
    for (const areaKey of row.areaKeys) {
      const keyFrom = rank(currentGrants[areaKey] ?? null);
      const keyTo = rank(candidateGrants[areaKey] ?? null);
      if (keyTo > keyFrom) anyRose = true;
      else if (keyTo < keyFrom) anyFell = true;
    }

    if (anyRose) gains.push({ label: row.label, from, to });
    if (anyFell) loses.push({ label: row.label, from, to });
  }

  // Driven by SENSITIVE_FLAGS rather than a literal list, so a fourth flag
  // added later cannot be silently omitted from the delta.
  const flagGains: FlagDeltaLine[] = [];
  const flagLoses: FlagDeltaLine[] = [];
  for (const { flag, name } of SENSITIVE_FLAGS) {
    const had = current.flags.includes(flag);
    const has = candidate.flags.includes(flag);
    if (!had && has) flagGains.push({ flag, label: name });
    else if (had && !has) flagLoses.push({ flag, label: name });
  }

  return {
    gains,
    loses,
    flagGains,
    flagLoses,
    isSame:
      gains.length === 0 &&
      loses.length === 0 &&
      flagGains.length === 0 &&
      flagLoses.length === 0,
  };
}
