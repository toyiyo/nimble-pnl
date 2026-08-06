/**
 * The live preview (roles-and-areas design, Phase 4 task 9b)
 *
 * A pure derivation, `(grants, flags) -> { summary, navPreview, grantCount }`,
 * with no queries of its own — the design doc's "The live preview" section
 * calls this out explicitly so the editor's preview column and the real
 * sidebar can both consume the same function and never drift apart. This
 * module is that function; `RoleEditor.tsx`/`RolePreviewPanel.tsx` (later in
 * task 9) render its output, they don't recompute it.
 *
 * The three parts:
 *   1. `summary` — a prose sentence naming what's granted (the "can" half)
 *      and, crucially, what's still blocked (the "can't" half — this is what
 *      makes an over-grant obvious). Wording (the PHRASE map, the exact
 *      four-item blocked-list check, joinList's comma/semicolon switch) is
 *      transcribed verbatim from the approved interactive prototype,
 *      docs/design-reference/roles-and-areas.html (`summarize`/`PHRASE`/
 *      `joinList`) — the design doc itself quotes the output of this exact
 *      algorithm as its own worked example under "The live preview".
 *   2. `navPreview` — the real sidebar nav groups (imported from
 *      `AppSidebar.nav.ts`, not re-typed here, so a label can't drift),
 *      tagged reachable/unreachable, read-only at view level, and "opens
 *      here" for the landing item — reusing `AREA_LANDING_PATHS`/
 *      `AREA_PRIORITY` from `areas.ts` (also used by `usePermissions.ts`'s
 *      `landingPath`) so the preview's landing item is always the page the
 *      role would actually land on.
 *   3. `grantCount` — `expandAreas(grants, flags).length`. Deliberately not
 *      a separately-maintained count: the number badge and the capability
 *      set it's counting must be the same computation.
 */

import { navigationGroups } from '@/components/AppSidebar.nav';
import {
  AREA_DEFINITIONS,
  AREA_LANDING_PATHS,
  AREA_PRIORITY,
  expandAreas,
  landingAreaKey,
  type AreaDefinition,
  type AreaKey,
  type AreaLevel,
  type SensitiveFlag,
} from './areas';

export interface NavPreviewItem {
  path: string;
  /** Read from the real sidebar nav data (`AppSidebar.nav.ts`), never re-typed here. */
  label: string;
  /** Reachable, but only at `'view'` — the prototype's "READ ONLY" badge. */
  readOnly: boolean;
  /** This item's `area_key` is the highest-priority granted area — the prototype's "OPENS HERE" badge. */
  isLanding: boolean;
}

export interface NavPreviewGroup {
  /** The sidebar's own `ui_group` (Main / Operations / Inventory / Accounting / Admin). */
  label: string;
  items: NavPreviewItem[];
}

export interface RolePreview {
  summary: string;
  navPreview: NavPreviewGroup[];
  grantCount: number;
}

/**
 * Real nav labels for every `area_key`'s representative path
 * (`AREA_LANDING_PATHS`), looked up from `navigationGroups` — the exact data
 * the sidebar itself renders — rather than hand-copied, so a rename in
 * `AppSidebar.nav.ts` shows up here automatically instead of silently
 * drifting.
 */
function findNavLabel(path: string): string | undefined {
  for (const group of navigationGroups) {
    const item = group.items.find((navItem) => navItem.path === path);
    if (item) return item.label;
  }
  return undefined;
}

/**
 * The grant level for one editor row, or `null` if ungranted. Exported
 * (task 9c) so `RolesList.tsx`'s per-role chip derivation reads the same
 * per-row level this file already computes for the editor's live preview,
 * instead of a second hand-written copy. One `AreaDefinition` row is one
 * `area_key` (post menu-mirror re-cut, areas.ts) — no fan-out to reduce.
 */
export function rowLevel(row: AreaDefinition, grants: Partial<Record<AreaKey, AreaLevel>>): AreaLevel | null {
  return grants[row.key] ?? null;
}

/**
 * Joins a list with a trailing conjunction. Phrases can themselves contain
 * commas ("build schedules, fix punches, and run tips"), so the separator
 * switches to a semicolon when any item does — otherwise the list reads as
 * one run-on clause. Transcribed verbatim from the prototype's `joinList`.
 */
function joinList(items: readonly string[], conjunction: string): string {
  if (items.length === 1) return items[0];
  const separator = items.some((item) => item.includes(',')) ? '; ' : ', ';
  return items.slice(0, -1).join(separator) + separator + conjunction + ' ' + items[items.length - 1];
}

function buildSummary(
  grants: Partial<Record<AreaKey, AreaLevel>>,
  flags: readonly SensitiveFlag[],
  roleName: string
): string {
  const grantedRows = AREA_DEFINITIONS.filter((row) => rowLevel(row, grants) !== null);

  if (grantedRows.length === 0) {
    return 'No areas yet. This role can sign in and see nothing.';
  }

  // Per row: its own `hint` (view) or `manageHint` (manage, falling back to
  // `hint` for the handful of manage-tier rows that don't reword it) — read
  // straight off the AREA_DEFINITIONS row instead of a second hand-kept
  // phrase map, so a page's copy can't drift between the editor and the
  // preview sentence.
  const canPhrases = grantedRows.map((row) => {
    const level = rowLevel(row, grants);
    return level === 'manage' && row.manageHint ? row.manageHint : row.hint;
  });
  const uniquePhrases = canPhrases.filter((phrase, index) => canPhrases.indexOf(phrase) === index);
  const canStr = joinList(uniquePhrases, 'and');

  // Per sidebar group, how much of it this role reaches — "Accounting: 3 of
  // 12 pages" — the same roll-up shape PR 2's header needs. A group the role
  // fully reaches has nothing worth naming in the "can't" half. Counted by
  // unique `path`, not by row: `team`/`collaborators` are two AREA_DEFINITIONS
  // rows sharing one sidebar page (/team), and this text says "pages".
  const totalByGroup = new Map<string, Set<string>>();
  const reachedByGroup = new Map<string, Set<string>>();
  for (const row of AREA_DEFINITIONS) {
    const total = totalByGroup.get(row.uiGroup) ?? new Set<string>();
    total.add(row.path);
    totalByGroup.set(row.uiGroup, total);

    if (rowLevel(row, grants) !== null) {
      const reached = reachedByGroup.get(row.uiGroup) ?? new Set<string>();
      reached.add(row.path);
      reachedByGroup.set(row.uiGroup, reached);
    }
  }
  const blocked: string[] = [];
  for (const [group, total] of totalByGroup) {
    const reached = reachedByGroup.get(group)?.size ?? 0;
    if (reached < total.size) blocked.push(`${group}: ${reached} of ${total.size} pages`);
  }
  if (!flags.includes('view:costs')) blocked.push('costs and margins');

  let summary = `${roleName} can ${canStr}.`;
  if (blocked.length > 0) {
    summary += ` Can't fully reach ${joinList(blocked, 'or')}.`;
  }
  return summary;
}

/** The more permissive of two levels, treating `null` as "not granted". */
function higherLevel(a: AreaLevel | null, b: AreaLevel | null): AreaLevel | null {
  if (a === 'manage' || b === 'manage') return 'manage';
  if (a === 'view' || b === 'view') return 'view';
  return null;
}

function buildNavPreview(grants: Partial<Record<AreaKey, AreaLevel>>): NavPreviewGroup[] {
  const landingKey = landingAreaKey(grants);
  const groups: NavPreviewGroup[] = [];
  // Tracks each item's actual level (not just readOnly) so merging a second
  // row onto the same path — `team`/`collaborators` both land on /team — is a
  // plain `higherLevel` call, not a round trip through the boolean.
  const levelByPath = new Map<string, AreaLevel>();

  // AREA_DEFINITIONS is already in sidebar order, so groups come out in
  // sidebar order (Main, Operations, Inventory, Accounting, Admin) for free.
  for (const row of AREA_DEFINITIONS) {
    const level = grants[row.key] ?? null;
    if (level === null) continue; // a literal render of the sidebar this role gets — ungranted pages are absent, not decorated.

    let group = groups.find((g) => g.label === row.uiGroup);
    if (!group) {
      group = { label: row.uiGroup, items: [] };
      groups.push(group);
    }

    // `team` and `collaborators` are two rows that both land on /team — the
    // sidebar renders that item once, so the preview must too, at the
    // higher level and landing status either area grants.
    const existing = group.items.find((item) => item.path === row.path);
    if (existing) {
      const mergedLevel = higherLevel(levelByPath.get(row.path) ?? null, level) as AreaLevel;
      levelByPath.set(row.path, mergedLevel);
      existing.readOnly = mergedLevel === 'view';
      existing.isLanding = existing.isLanding || row.key === landingKey;
      continue;
    }

    levelByPath.set(row.path, level);
    group.items.push({
      path: row.path,
      label: findNavLabel(row.path) ?? row.path,
      readOnly: level === 'view',
      isLanding: row.key === landingKey,
    });
  }

  return groups;
}

/**
 * `grants` are keyed by the 33 SQL `area_key`s, one per UI row (post
 * menu-mirror re-cut, matching `role_areas` row granularity and
 * `expandAreas`' own signature) — the same grants object the rest of the
 * client-side permission model (`expandAreas`, `usePermissions.ts`'s
 * `landingPath`) already uses.
 */
export function buildRolePreview(
  grants: Partial<Record<AreaKey, AreaLevel>>,
  flags: readonly SensitiveFlag[] = [],
  roleName = 'This role'
): RolePreview {
  return {
    summary: buildSummary(grants, flags, roleName),
    navPreview: buildNavPreview(grants),
    grantCount: expandAreas(grants, flags).length,
  };
}

// AREA_PRIORITY is re-exported for consumers (e.g. RoleEditor.tsx) that need
// the same priority order preview.ts uses for "opens here", without a second
// import from areas.ts.
export { AREA_PRIORITY };
