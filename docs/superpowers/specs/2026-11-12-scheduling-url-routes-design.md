# Scheduling URL Routes — Design

Date: 2026-11-12
Branch: `feature/scheduling-url-routes`
Status: Approved by the user (scope: "Views + filters"; approach: "A: hook per component").

## 1. Problem

The scheduling page keeps most of its view state in React state. A reload or a
shared link opens the default view. The user loses the place. A peer cannot see
the same view from a link.

Only the week is in the URL today. `useSharedWeek` writes `?week=YYYY-MM-DD`
(`src/hooks/useSharedWeek.ts:6`, `:41-47`).

## 2. Audit of the state

| # | State | Location today | URL param |
|---|-------|----------------|-----------|
| 1 | Top-level tab | `useState('schedule')`, `src/pages/Scheduling.tsx:268` | `tab` |
| 2 | Week | `?week=`, `src/hooks/useSharedWeek.ts:6` | `week` (no change) |
| 3 | Schedule area filter | `useState('all')`, `src/pages/Scheduling.tsx:428` | `area` |
| 4 | Schedule position filter | `useState('all')`, `src/pages/Scheduling.tsx:427` | `position` |
| 5 | Schedule group by | `localStorage 'schedule-group-by'`, `src/pages/Scheduling.tsx:438`, `:573` | `group` |
| 6 | Mobile selected day | `useState(pickDefaultMobileDay(...))`, `src/components/scheduling/WeekScheduleMobile.tsx:257` | `day` |
| 7 | Planner view | `useState<'plan'\|'timeline'>('plan')`, `src/components/scheduling/ShiftPlanner/ShiftPlannerTab.tsx:652` | `view` |
| 8 | Planner area filter | `useState<string\|null>(null)`, `ShiftPlannerTab.tsx:305` | `plannerArea` |
| 9 | Planner show hidden | `useState(false)`, `ShiftPlannerTab.tsx:219` | `hidden` |
| 10 | Timeline selected day | `useState(defaultDay(weekDays))`, `src/components/scheduling/ShiftTimeline/ShiftTimelineTab.tsx:297` | `day` (shared with #6) |
| 11 | Timeline group by | `useState<GroupByMode>('area')`, `ShiftTimelineTab.tsx:302` | `timelineGroup` |
| 12 | Availability week | Own `useState(getMondayOfWeek(today))`, `src/components/scheduling/TeamAvailabilityGrid.tsx:384` | `week` (joined to #2) |
| 13 | Selected week template | `useState<string\|null>(null)`, `src/components/scheduling/WeekTemplates/WeekTemplatesTab.tsx:74` | `template` |

Out of scope (the user chose "Views + filters"):

- Dialog open states, `src/pages/Scheduling.tsx:282-320`.
- The Time Off tab and the Trades tab. They have no filters. They hold only
  dialog and selection state (`src/components/TimeOffList.tsx`,
  `src/components/schedule/TradeApprovalQueue.tsx`).
- The planner employee sidebar search and filters
  (`src/components/scheduling/ShiftPlanner/EmployeeSidebar.tsx:205-209`). These
  are short-lived search inputs.
- The labor efficiency panel open state (`ShiftPlannerTab.tsx:655`) and its
  granularity (`src/components/scheduling/ShiftPlanner/LaborEfficiencyPanel.tsx:93`).
- The Templates mobile list/editor toggle (`WeekTemplatesTab.tsx:78`).

`GroupByMode` is `'none' | 'area' | 'position'` (`src/lib/scheduleGrouping.ts:3`).

## 3. Approach

The user chose Approach A: a typed hook in each component. Three design
reviewers checked the first version (frontend, Supabase, and
`vercel-react-best-practices`). Section 9 lists their findings and the fixes.

### 3.1 Param registry

A new module, `src/lib/schedulingUrlParams.ts`, holds every param name, the
allowed values, and a module-level `parse` function for each param. Two
features cannot use the same name by accident. A module-level `parse` has a
stable identity, so it does not break `useMemo` dependencies.

```ts
export const SCHEDULING_TABS = ['schedule','timeoff','availability','trades','planner','templates'] as const;
export const SCHEDULING_PARAMS = {
  tab: 'tab', week: 'week', area: 'area', position: 'position', group: 'group',
  day: 'day', view: 'view', plannerArea: 'plannerArea', hidden: 'hidden',
  timelineGroup: 'timelineGroup', template: 'template',
} as const;
```

### 3.2 The hooks

React Router builds the functional `setSearchParams` value from the params of
the last render (`node_modules/react-router-dom/dist/index.js:1039`). Two calls
in one handler do not queue. The second call overwrites the first.
`handleViewTemplateWeek` (`Scheduling.tsx:348-354`) sets the week and then the
tab, so it would lose the week.

Fix: the new setters do not use `setSearchParams`. They read the latest URL
from `window.location.search` and call `navigate({ search }, options)`.
`BrowserRouter` updates `window.location` synchronously in `navigate`, so the
next call in the same handler reads the new value.

A new file, `src/hooks/useSearchParamState.ts`, exports two hooks:

```ts
// One param.
useSearchParamState<T extends string>(spec: ParamSpec<T>): [T, (next: T, opts?: SetOpts) => void]

// Many params in one URL write.
useSetSearchParams(): (patch: Record<string, string | null>, opts?: SetOpts) => void

type SetOpts = { history?: 'push' | 'replace' };  // default 'replace'
```

Rules:

- The setter keeps all other params.
- A value equal to the fallback deletes the param, so a link holds only the
  values that are not the default. A spec can set `keepDefault: true` to always
  write the value (see `group`, Section 3.3).
- A value that `parse` rejects gives the fallback. A read never writes to the URL.
- The setter depends only on `navigate` and the key. It keeps a stable
  identity, so `useCallback` wrappers in the page stay stable.
- `useSharedWeek` (`src/hooks/useSharedWeek.ts:41-47`) moves to the same setter
  base. A week change and a tab change in one handler then do not overwrite
  each other.

The router is `BrowserRouter` (`src/App.tsx:353`), on `react-router-dom`
`^6.30.1`. `useBlocker` does not work, because it needs a data router.

### 3.3 Each param

- **`tab`** (`Scheduling.tsx:268`). Replace `useState` with the hook, fallback
  `'schedule'`. A click on a tab trigger writes with `push`, so the Back button
  goes to the last tab. Radix `Tabs` uses automatic activation, so each arrow
  key press would add a history entry. The `Tabs` root gets
  `activationMode="manual"`. An arrow key then moves focus only. Enter or Space
  selects the tab. This is a pattern that the WAI-ARIA tabs guide permits.
- **`area`** (`Scheduling.tsx:428`), Schedule tab only. Fallback `'all'`. The
  page derives the value during render:
  `effectiveArea = !areasLoading && !areas.includes(area) ? 'all' : area`.
  `useEmployeeAreas` returns `isLoading` (`src/hooks/useEmployeeAreas.ts:55`).
  The reset effect at `Scheduling.tsx:431-435` is deleted. No code clears the
  param.
- **`position`** (`Scheduling.tsx:427`). Fallback `'all'`. The page derives the
  value against `positions` after `positionsLoading` is false
  (`Scheduling.tsx:425`).
- **`group`** (`Scheduling.tsx:436-442`, `:573`). The spec uses
  `keepDefault: true`. An explicit choice always writes `group`, also for
  `none`. When the URL has no `group`, the page reads `localStorage` once (lazy
  init, in try/catch) and writes that value to the URL with `replace`, once, from
  the page only. A copied link then always holds `group`. A change still writes to
  `localStorage`, as today. This is the existing UI preference, not a data cache.
- **`day`** (`WeekScheduleMobile.tsx:257`, `ShiftTimelineTab.tsx:297`). The value
  is an ISO date (`YYYY-MM-DD`). Each component derives the effective day: if the
  date is in the displayed week, use it. If not, use the current default
  (`pickDefaultMobileDay`; `defaultDay` at `ShiftTimelineTab.tsx:178`). The mobile
  component maps the date to its index with `weekDays.findIndex`. The
  week-change reset effect at `WeekScheduleMobile.tsx:262-266` is deleted. A day
  outside the new week falls back during render. The mobile tree is always mounted
  in the Schedule tab, also at desktop width (the desktop grid is in
  `hidden md:block`, `Scheduling.tsx:1337`). For this reason, no mount effect may
  write `day`.
- **`view`** (`ShiftPlannerTab.tsx:652`). `'plan' | 'timeline'`, fallback `'plan'`.
- **`plannerArea`** (`ShiftPlannerTab.tsx:305`). A separate param. The planner
  filters by `templateAreas` (`ShiftPlannerTab.tsx:984`). The Schedule tab
  filters by employee areas. These lists are different. Fallback `'all'`. The
  planner converts `'all'` to `null` at the read. It derives the value against
  `templateAreas` and does not clear the param.
- **`hidden`** (`ShiftPlannerTab.tsx:219`). `'1'` means true. No param means
  false. Change the comment at `ShiftPlannerTab.tsx:216`. It says "never
  persisted". The URL is view state, not a cache.
- **`timelineGroup`** (`ShiftTimelineTab.tsx:302`). `GroupByMode`, fallback `'area'`.
- **`template`** (`WeekTemplatesTab.tsx:74`). A template id. If no template has
  this id after the list loads, the existing auto-select effect
  (`WeekTemplatesTab.tsx:105-107`) selects the first template. That selection
  writes its id with `replace`. The tab writes the id only after `guard()`
  confirms the switch. The tab never writes `NEW_DRAFT_ID` to the URL.
- **Availability week** (`TeamAvailabilityGrid.tsx:384`, `:429`). The grid calls
  `useSharedWeek()` and deletes its own state. The callbacks at
  `TeamAvailabilityGrid.tsx:411-423` use `setWeekStart(prev => ...)`. They change
  to `setWeekStart(addDays(weekStart, ±7))`, with `weekStart` in the deps. This is
  a behavior change: the Availability tab shows the shared week, not always the
  current week.

When the tab changes, the hooks keep all other params. A user who goes back to a
tab sees the same filters.

### 3.4 Re-render cost

Each `useSearchParams` reader re-renders on any URL change. Today the local
state re-renders only its own component. Radix `Tabs` unmounts inactive
content, so the mounted readers are the page and one tab.

- Readers read only the params that they use and pass primitives down.
- The parse functions come from the registry (Section 3.1).
- The Phase 7a performance reviewer checks the planner. If a `hidden` or
  `plannerArea` toggle re-renders the full page, the plan wraps the heavy
  children in `memo`.

## 4. Permission gates

`canManageSchedule = isResolved && hasCapability('edit:scheduling')`
(`Scheduling.tsx:240`) gates the Trades tab and the Templates tab.

The two fallback effects (`Scheduling.tsx:333-337`, `:341-345`) are deleted.
The page derives the tab during render:

```ts
const gated = urlTab === 'trades' || urlTab === 'templates';
const effectiveTab = gated && isResolved && !canManageSchedule ? 'schedule' : urlTab;
```

- While `!isResolved` and the URL tab is gated, the page shows a skeleton with
  `aria-busy="true"`. It does not show a blank panel, and it does not jump to
  `schedule`. A deep link to `?tab=trades` then works after the permissions load.
- The Trades effect today does not wait for `isResolved`. The derived value
  fixes this.
- After the permissions load, one effect writes `tab=schedule` with `replace`
  when `effectiveTab` differs from `urlTab`. The Back button then does not return
  to a tab that the user cannot open.

## 5. Templates unsaved-draft guard

Today `handleTabChange` (`Scheduling.tsx:272-281`) opens a discard dialog
(`Scheduling.tsx:1815-1832`) when the user leaves a dirty template draft. The
`beforeunload` handler (`WeekTemplatesTab.tsx:129-130`) covers a reload and a
close.

With a URL tab, the Back button can change the tab without `handleTabChange`.
A tab click and the Back button follow one path. The page derives:

```ts
const leavingDirty = templatesDirty && urlTab !== 'templates';
const renderedTab = leavingDirty ? 'templates' : effectiveTab;   // <Tabs value>
const discardOpen = leavingDirty;                                // dialog open
const pendingTab = urlTab;                                       // dialog target
```

- `activeTab` state and `pendingTab` state are deleted.
- `renderedTab` stays `templates`, so no render unmounts the draft.
- "Discard" sets `templatesDirty` to false. The URL tab then shows.
- `onOpenChange(false)` writes `tab=templates` with `replace`. Esc, an overlay
  click, and "Keep editing" all use this path. "Discard" does not.

Known limits. We accept these:

- After Back and "Keep editing", the `replace` puts `templates` in the entry that
  Back reached. History then has two `templates` entries. The next Back shows
  no visible change.
- While the dialog is open, the URL shows the new tab. A link copied at that
  time opens the new tab.

## 6. Links into the page

- `supabase/functions/_shared/shiftTradeReminderContent.ts:43`:
  `SCHEDULER_REMINDER_PATH = '/scheduling'` changes to
  `'/scheduling?tab=trades'`. Two places use this constant: the scheduler push
  URL at `:162` and the email CTA at `:215`. The trade reminder then opens the
  trade queue. The service worker (`public/sw.js:28-43`) passes the query string
  through unchanged. `.github/workflows/deploy-supabase.yml` deploys all edge
  functions on a merge to `main` that changes `supabase/**`. If the function
  deploys before the app, the old page ignores `?tab=` and opens the default
  tab. This is safe.
- `src/components/dashboard/LaborEfficiencyCard.tsx:131` calls
  `navigate('/scheduling')`. This card is about labor efficiency. It changes to
  `/scheduling?tab=planner`.
- `handleEditTemplates` (`Scheduling.tsx:347`) uses the tab setter.
  `handleViewTemplateWeek` (`Scheduling.tsx:348-354`) uses
  `useSetSearchParams` to write `week` and `tab` in one call.

## 7. Tests

- Unit (`tests/unit/useSearchParamState.test.ts`):
  - the fallback, a value that is not valid, and the delete of a default value
  - `keepDefault`
  - push compared to replace
  - the setter keeps other params
  - two setter calls in one handler do not overwrite each other
  - the setter identity is stable across param changes
- Unit (`tests/unit/schedulingUrlParams.test.ts`): each parser.
- Unit: the email CTA equals `${appUrl}/scheduling?tab=trades`, and the
  scheduler push URL equals `SCHEDULER_REMINDER_PATH`.
- Change the existing tests that assert the old literal. Import the constant
  instead: `tests/unit/shiftTradeReminderContent.test.ts:166`, and
  `tests/unit/shiftTradeRemindersHandler.test.ts:435` and `:445`.
- E2E (`tests/e2e/scheduling-url-routes.spec.ts`):
  - `/scheduling?tab=planner&view=timeline` shows the timeline.
  - The selected tab trigger matches `?tab=`.
  - Change the tab, press Back, and the last tab shows.
  - A reload keeps the area filter and `group`.
  - At 375 px width, `?day=` selects that day in the mobile picker.
  - A dirty template draft, then Back: the discard dialog opens, and the draft
    stays.
  - Use role queries with `{ exact: true }`, because the responsive layout
    mounts two trees (lesson PR #621).

## 8. Risks

- **Hidden tab content reads params.** A param can change while its tab is
  unmounted. Each reader derives a valid value on read, so this is safe.
- **Two mounted trees.** No reader writes the URL from a mount effect, except
  the page-level `group` write (Section 3.3), which runs once.
- **Many URL writes.** Each filter change is one `replace`. It adds no history
  entries.

## 9. Review findings and fixes

| Reviewer | Finding | Fix (section) |
|----------|---------|---------------|
| vercel-react | Functional `setSearchParams` loses the first of two writes | Setter reads `window.location.search`; multi-key setter (3.2) |
| vercel-react | Setter identity changes on each param change | Setter depends on `navigate` and key only (3.2) |
| vercel-react, frontend | Reset effects write the URL and clear deep links | Derive during render; delete the effects (3.3) |
| vercel-react, frontend | Permission effects; blank page before permissions load | Derived `effectiveTab`; skeleton while loading (4) |
| vercel-react, frontend | Back button skips the dirty guard; Esc path | Derived `renderedTab` and `discardOpen`; restore on `onOpenChange(false)` (5) |
| vercel-react, frontend | `group` cannot select `none`; link depends on the peer `localStorage` | `keepDefault`; write the stored value to the URL once (3.3) |
| vercel-react | Re-render cost of many readers | Module-level parse; primitives; `memo` if needed (3.4) |
| frontend | Planner area and Schedule area are different lists | Separate `plannerArea` param (3.3) |
| frontend | Arrow keys fill the history | `activationMode="manual"` (3.3) |
| frontend, vercel-react | Availability grid uses functional setState | `addDays(weekStart, ±7)`; behavior change stated (3.3) |
| frontend | `template` wording; `NEW_DRAFT_ID` | Auto-select writes with `replace`; never write the draft id (3.3) |
| supabase | Three tests assert the old literal | Import the constant (7) |
| supabase | Constant feeds push and CTA | Both named (6) |
