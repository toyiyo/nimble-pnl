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
  /** Whether the granted areas include this item's `area_key` at any level. */
  reachable: boolean;
  /** Reachable, but only at `'view'` — the prototype's "READ ONLY" badge. */
  readOnly: boolean;
  /** This item's `area_key` is the highest-priority granted area — the prototype's "OPENS HERE" badge. */
  isLanding: boolean;
}

export interface NavPreviewGroup {
  /** One of AREA_DEFINITIONS' three bands (Operations / Money / People & admin). */
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
 * Highest grant level among a UI row's underlying `area_key`s, or `null` if
 * none are granted. Exported (task 9c) so `RolesList.tsx`'s per-role chip
 * derivation reads the same per-row level this file already computes for the
 * editor's live preview, instead of a second hand-written copy.
 */
export function rowLevel(row: AreaDefinition, grants: Partial<Record<AreaKey, AreaLevel>>): AreaLevel | null {
  let level: AreaLevel | null = null;
  for (const areaKey of row.areaKeys) {
    const granted = grants[areaKey];
    if (granted === 'manage') return 'manage';
    if (granted === 'view') level = 'view';
  }
  return level;
}

/**
 * Prose fragments per UI row per level, transcribed verbatim from the
 * approved prototype's `PHRASE` map (docs/design-reference/roles-and-areas.html).
 * Keyed by `AreaDefinition.key` (the same ten keys the prototype uses).
 */
const PHRASE: Record<string, { view: string; manage: string }> = {
  reports: { view: 'read the dashboard and reports', manage: 'read the dashboard and reports' },
  sales: { view: 'see POS sales', manage: 'see POS sales' },
  inventory: { view: 'look at inventory', manage: 'count and receive inventory' },
  recipes: { view: 'read recipes', manage: 'build and edit recipes' },
  scheduling: { view: 'view the schedule', manage: 'build schedules, fix punches, and run tips' },
  books: { view: 'read the books', manage: 'keep the books' },
  payroll: { view: 'see payroll', manage: 'run payroll' },
  employees: { view: 'see the roster', manage: 'manage employee records' },
  team: { view: 'see the team list', manage: 'invite people and set roles' },
  settings: { view: 'view settings', manage: 'change settings and integrations' },
};

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

  const canPhrases = grantedRows.map((row) => {
    const level = rowLevel(row, grants);
    // level is non-null here — grantedRows was filtered on exactly that.
    return PHRASE[row.key][level as 'view' | 'manage'];
  });
  const uniquePhrases = canPhrases.filter((phrase, index) => canPhrases.indexOf(phrase) === index);
  const canStr = joinList(uniquePhrases, 'and');

  // Fixed four-item check, transcribed from the prototype: only these
  // categories surface in the "can't" half, not every ungranted area.
  const blocked: string[] = [];
  const booksRow = AREA_DEFINITIONS.find((row) => row.key === 'books');
  const payrollRow = AREA_DEFINITIONS.find((row) => row.key === 'payroll');
  const teamRow = AREA_DEFINITIONS.find((row) => row.key === 'team');
  if (booksRow && rowLevel(booksRow, grants) === null) blocked.push('the books');
  if (payrollRow && rowLevel(payrollRow, grants) === null) blocked.push('payroll');
  if (teamRow && rowLevel(teamRow, grants) === null) blocked.push('team settings');
  if (!flags.includes('view:costs')) blocked.push('costs and margins');

  let summary = `${roleName} can ${canStr}.`;
  if (blocked.length > 0) {
    summary += ` Can't touch ${joinList(blocked, 'or')}.`;
  }
  return summary;
}

function buildNavPreview(grants: Partial<Record<AreaKey, AreaLevel>>): NavPreviewGroup[] {
  const landingKey = landingAreaKey(grants);

  return AREA_DEFINITIONS.reduce<NavPreviewGroup[]>((groups, row) => {
    let group = groups.find((g) => g.label === row.band);
    if (!group) {
      group = { label: row.band, items: [] };
      groups.push(group);
    }

    for (const areaKey of row.areaKeys) {
      const path = AREA_LANDING_PATHS[areaKey];
      const level = grants[areaKey] ?? null;
      group.items.push({
        path,
        label: findNavLabel(path) ?? path,
        reachable: level !== null,
        readOnly: level === 'view',
        isLanding: areaKey === landingKey,
      });
    }

    return groups;
  }, []);
}

/**
 * `grants` are keyed by the fourteen SQL `area_key`s (matching `role_areas`
 * row granularity and `expandAreas`' own signature), not the ten editor UI
 * rows — the same grants object the rest of the client-side permission model
 * (`expandAreas`, `usePermissions.ts`'s `landingPath`) already uses.
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
