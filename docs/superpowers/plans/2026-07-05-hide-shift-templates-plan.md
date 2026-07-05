# Hide Shift Templates — Implementation Plan

**Design:** docs/superpowers/specs/2026-07-05-hide-shift-templates-design.md
**Branch:** `feature/hide-shift-templates`
**Mockup (source of truth for UX/UI):** https://claude.ai/code/artifact/21224a4a-5c0f-41a5-a104-32c5c96fbadb

Every task is TDD: RED (failing test) → GREEN (minimal code) → REFACTOR → COMMIT.
Conventions: CLAUDE.md Apple/Notion styling, semantic tokens only, import order,
`text-[NN px]` scale. New hook/lib code must carry unit tests (Sonar ≥80% on new code).

## Task 1 — `useShiftTemplates`: status filter + hide/restore mutations

**Files:** `src/hooks/useShiftTemplates.ts`, `tests/unit/useShiftTemplates.test.ts`

- Add `export type TemplateStatusFilter = 'active' | 'inactive' | 'all'` and an options
  param `useShiftTemplates(restaurantId, { status = 'active' } = {})`.
- Query key becomes `['shift_templates', restaurantId, status]`; queryFn applies
  `.eq('is_active', true)` for `'active'`, `.eq('is_active', false)` for `'inactive'`,
  no filter for `'all'`. Keep `staleTime: 30000`, `refetchOnWindowFocus: true`.
- Rename `deleteMutation` → `hideMutation`; input `{ id: string; name: string; keptShiftCount: number }`;
  update payload stays `{ is_active: false }`. Success toast: title `“<name>” hidden`,
  description `N assigned shift(s) kept` (N ≥ 1) or `Assigned shifts are kept` (N = 0),
  `duration: 8000`, `action: <ToastAction altText="Undo hiding <name>">Undo</ToastAction>`
  wired to `restoreMutation.mutate(id)`.
- Add `restoreMutation` (`is_active: true`), success toast `Template restored`.
- ALL mutations (`create`, `update`, `hide`, `restore`) invalidate the **prefix**
  `['shift_templates', restaurantId]` (no status segment).
- Return `{ templates, loading, error, createTemplate, updateTemplate, hideTemplate, restoreTemplate }`.
  Update all `deleteTemplate` call sites (grep; expected: `ShiftPlannerTab.tsx`).
- Tests: query filter per status; query key shape; hide/restore payloads; prefix
  invalidation (spy on `invalidateQueries`); toast contract incl. duration + altText;
  0-vs-N description branch.

## Task 2 — Pure planner helpers: display partition + hidden lane

**Files:** `src/hooks/useShiftPlanner.ts`, `tests/unit/useShiftPlanner*.test.ts`

- `export function partitionTemplatesForDisplay(templates, showHidden)` →
  `{ activeTemplates, hiddenTemplates, displayTemplates }`; `displayTemplates` is a
  **stable** active-first ordering (preserve relative order within partitions);
  `showHidden === false` → `displayTemplates === activeTemplates`.
- `export function collectHiddenLane(grid, hiddenTemplates, areaFilter)` →
  `Map<day, Shift[]>` merging the grid buckets of hidden templates. Honors `areaFilter`
  using the `t.area || UNASSIGNED` convention (identical to `groupTemplatesByArea`).
  Day arrays merge in template order; returns empty Map when nothing matches.
- Invariant tests: `computeTotalHours(shifts)` result is independent of template hiding
  (it never sees templates — pin with identical input); `buildTemplateGridData` with all
  templates buckets a hidden template's FK-linked shift under that template (not
  `__unmatched__`); `computeOpenShiftCount` (import from `Scheduling.tsx`) given only
  active templates counts nothing for a hidden template's slots.

## Task 3 — SQL: `claim_open_shift` active guard + pgTAP

**Files:** `supabase/migrations/20260705120000_claim_open_shift_active_guard.sql`,
`supabase/tests/60_claim_open_shift_active_guard.test.sql` (follow local numbering style)

- Recreate `claim_open_shift` copying the **latest** definition from
  `20260626120000_open_shift_coverage.sql` verbatim (same signature, SECURITY DEFINER,
  `SET search_path`, re-issued GRANT). Change the template fetch **inside the
  advisory-locked section** to a two-step branch: fetch by id+restaurant; if not found ⇒
  `'Template not found'`; if found and `is_active = false` ⇒
  `'This shift is no longer available'` (message constant regardless of any other state).
- pgTAP (CURRENT_DATE-relative dates, temp-table config, RLS off in txn, delete-before-
  insert fixtures, ON CONFLICT DO UPDATE where triggers exist):
  1. active template ⇒ `get_open_shifts` includes slot; hide ⇒ excluded.
  2. hidden template ⇒ `claim_open_shift` → `success: false`, error
     `'This shift is no longer available'`.
  3. random nonexistent template id ⇒ `'Template not found'` (branch stays distinct).
  4. restore ⇒ `get_open_shifts` includes again; `claim_open_shift` **succeeds** with a
     different employee than prior tests (avoid schedule-conflict masking).

## Task 4 — `TemplateRowHeader`: Hide/Restore menu + Hidden badge

**Files:** `src/components/scheduling/ShiftPlanner/TemplateRowHeader.tsx`

- Props: replace `onDelete` with `onHide: (template: ShiftTemplate) => void` and
  `onRestore: (templateId: string) => void` (hide needs the full template for name/count).
- Active template menu: `Edit` (unchanged) + `Hide template` (`EyeOff` icon,
  `text-muted-foreground`, right-aligned hint `<span className="ml-auto pl-3 text-[11px] text-muted-foreground">keeps shifts</span>`).
  **Remove** the `Trash2` Delete item entirely.
- Hidden template menu: `Edit` + `Restore template` (`Eye` icon).
- Hidden badge next to name (desktop): `Hidden` text + `EyeOff` icon with `aria-hidden`,
  classes `text-[10px] font-medium uppercase tracking-wider text-muted-foreground border border-dashed border-border rounded-md px-1.5 inline-flex items-center gap-1`.
  Mobile (56px column): badge text only, no icon.
- memo comparator adds `prev.template.is_active === next.template.is_active`.

## Task 5 — `ShiftCell`: ghost (read-only) mode

**Files:** `src/components/scheduling/ShiftPlanner/ShiftCell.tsx`

- New prop `isHiddenTemplate?: boolean`. When true: suppress drop-target/assign
  affordances and mobile tap-to-assign, no open-slot rendering, no coverage indicator;
  chips render dimmed (`opacity-60`); cell gets
  `aria-label={`${dayLabel}, hidden template`}` (mirror inactive-day branch pattern).
  Chip remove buttons keep `focus-visible` outline.

## Task 6 — `HiddenTemplatesRow` lane component

**Files:** `src/components/scheduling/ShiftPlanner/HiddenTemplatesRow.tsx`

- Same grid column contract as `OffTemplateRow` (label cell + 7 day cells).
- Label: `EyeOff` icon (aria-hidden) + `From hidden templates`
  (`text-[13px] font-medium text-muted-foreground`), subtitle
  `N shift(s) kept · ` + `<button>` `Show templates`
  (`text-[12px] underline underline-offset-2 text-foreground`) calling `onShowHidden`.
- Chips: dimmed treatment + remove action + preserved focus-visible outline.
- Rendered only when it has shifts (caller guards).

## Task 7 — `TemplateGrid`: ghost rows + lane wiring

**Files:** `src/components/scheduling/ShiftPlanner/TemplateGrid.tsx`

- Props: `onDeleteTemplate` → `onHideTemplate` + `onRestoreTemplate`;
  new `hiddenLaneByDay?: Map<string, Shift[]>`, `onShowHidden?: () => void`.
- Row wrapper for `!template.is_active`: add `opacity-60 bg-muted/20` to the row header
  cell and day cells; pass `isHiddenTemplate` to `ShiftCell`.
- Render `HiddenTemplatesRow` after all area groups (and after orphan off-template
  lanes) when `hiddenLaneByDay` has any shifts.

## Task 8 — `ShiftPlannerTab`: state, derivation, toggle pill, handlers

**Files:** `src/components/scheduling/ShiftPlanner/ShiftPlannerTab.tsx`

- Fetch `useShiftTemplates(restaurantId, { status: 'all' })`; derive via
  `partitionTemplatesForDisplay(templates, showHidden)`.
- **Invariant:** every existing consumer of `templates` for math — coverage strip,
  `coverageByTemplateDay`, allocation statuses, open-shift affordances — now receives
  `activeTemplates`. Grid receives `displayTemplates` + all-templates `gridData`
  (`buildTemplateGridData(shifts, templates, weekDays)`).
- `showHidden` `useState(false)`; when false compute
  `hiddenLaneByDay = collectHiddenLane(gridData, hiddenTemplates, areaFilter)`.
- Hidden pill in the Plan/Timeline `ToggleGroup` row, right-aligned, only when
  `hiddenTemplates.length > 0`: `EyeOff` icon + `Hidden` +
  `<span className="text-[11px] px-1.5 py-0.5 rounded-md bg-muted">{n}</span>`;
  `aria-pressed={showHidden}`; pressed `bg-foreground text-background hover:bg-foreground/90`.
- `handleHideTemplate = useCallback((template) => { const kept = countShiftsForTemplate(gridData, template.id); hideTemplate({ id, name, keptShiftCount: kept }); }, [gridData, hideTemplate])`;
  `handleRestoreTemplate = useCallback((id) => restoreTemplate(id), [restoreTemplate])`.
- Off-template `__unmatched__` lane behavior unchanged.

## Task 9 — Verify UX against mockup + states

- Walk the mockup interactions against the running UI (loading/error/empty states per
  CLAUDE.md three-state rule; toggle only rendered when hidden templates exist).
- `npm run typecheck && npm run lint && npm run test` green.

## Dependencies

```
Task 1 ──► Task 8
Task 2 ──► Task 7, Task 8
Task 3 (independent)
Task 4, 5, 6 ──► Task 7 ──► Task 8 ──► Task 9
```
