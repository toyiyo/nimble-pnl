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
| 8 | Planner area filter | `useState<string\|null>(null)`, `ShiftPlannerTab.tsx:305` | `area` (shared with #3) |
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
  granularity (`LaborEfficiencyPanel.tsx:93`).
- The Templates mobile list/editor toggle (`WeekTemplatesTab.tsx:78`).

`GroupByMode` is `'none' | 'area' | 'position'` (`src/lib/scheduleGrouping.ts:3`).

## 3. Approach

The user chose Approach A: a typed hook in each component.

### 3.1 Param registry

A new module, `src/lib/schedulingUrlParams.ts`, holds every param name and the
allowed values. Two features cannot use the same name by accident.

```ts
export const SCHEDULING_TABS = ['schedule','timeoff','availability','trades','planner','templates'] as const;
export const SCHEDULING_PARAMS = {
  tab: 'tab', week: 'week', area: 'area', position: 'position', group: 'group',
  day: 'day', view: 'view', hidden: 'hidden', timelineGroup: 'timelineGroup',
  template: 'template',
} as const;
```

### 3.2 The hook

A new hook, `src/hooks/useSearchParamState.ts`:

```ts
useSearchParamState<T extends string>(key, {
  fallback: T,
  parse?: (raw: string) => T | null,   // returns null for a value that is not valid
  history?: 'push' | 'replace',        // default 'replace'
}): [T, (next: T) => void]
```

Rules:

- The hook uses the functional form of `setSearchParams`. It keeps all other
  params. This is the same pattern as `useSharedWeek.ts:41-47`.
- A value equal to `fallback` removes the param. A link holds only the values
  that are not the default.
- A value that `parse` rejects gives `fallback`. The hook does not write to the
  URL on read.
- `history: 'push'` adds a history entry. The tab uses `push`, so the Back
  button goes to the last tab. All filters use `replace`.

The router is `BrowserRouter` (`src/App.tsx:353`), on `react-router-dom`
`^6.30.1`. `useSearchParams` works. `useBlocker` does not work, because it
needs a data router.

### 3.3 Each param

- **`tab`** (`Scheduling.tsx:268`). Replace `useState` with
  `useSearchParamState('tab', { fallback: 'schedule', history: 'push' })`.
  The parse accepts only `SCHEDULING_TABS`.
- **`area`, `position`** (`Scheduling.tsx:427-428`). Fallback `'all'`. The reset
  effect at `Scheduling.tsx:431-435` stays. It now clears the param when the area
  does not exist. It must wait until the area list loads, so a deep link does not
  lose its area during the first render.
- **`group`** (`Scheduling.tsx:436-442`, `:573`). The URL value wins. If the URL
  has no value, the page uses the `localStorage` value, as today. A change writes
  to both. This keeps the current preference for users who open the page with no
  params. This is not a data cache. It is the existing UI preference.
- **`day`** (`WeekScheduleMobile.tsx:257`, `ShiftTimelineTab.tsx:297`). The value
  is an ISO date (`YYYY-MM-DD`). If the date is not in the displayed week, the
  component uses its current default (`pickDefaultMobileDay`, `defaultDay` at
  `ShiftTimelineTab.tsx:178`). The week-change reset effect at
  `WeekScheduleMobile.tsx:262-266` removes the param when the week changes.
- **`view`** (`ShiftPlannerTab.tsx:652`). `'plan' | 'timeline'`, fallback `'plan'`.
- **`area` in the planner** (`ShiftPlannerTab.tsx:305`). The planner uses `null`
  for "all areas". The URL value `''` (no param) maps to `null`. The planner and
  the Schedule tab share the param, because it has the same meaning.
- **`hidden`** (`ShiftPlannerTab.tsx:219`). `'1'` means true. No param means false.
- **`timelineGroup`** (`ShiftTimelineTab.tsx:302`). `GroupByMode`, fallback `'area'`.
- **`template`** (`WeekTemplatesTab.tsx:74`). A template id. If no template has
  this id after the list loads, the tab selects nothing and removes the param.
- **Availability week** (`TeamAvailabilityGrid.tsx:384`, `:429`). The grid calls
  `useSharedWeek()` and does not keep its own state. The Availability tab then
  shows the same week as the other tabs.

When the tab changes, the hook keeps all other params. A user who goes back to a
tab sees the same filters.

## 4. Permission gates

`canManageSchedule = isResolved && hasCapability('edit:scheduling')`
(`Scheduling.tsx:240`) gates the Trades tab and the Templates tab.

- The Trades fallback effect (`Scheduling.tsx:333-337`) does NOT wait for
  `isResolved` today. With a URL tab, a deep link to `?tab=trades` would go to
  `schedule` before the permissions load. The design adds the `isResolved`
  check, the same as the Templates effect at `Scheduling.tsx:341-345`.
- Both fallbacks set the tab with `replace`, so the Back button does not return
  to a tab that the user cannot open.

## 5. Templates unsaved-draft guard

Today `handleTabChange` (`Scheduling.tsx:272-281`) opens a discard dialog
(`Scheduling.tsx:1815-1832`) when the user leaves a dirty template draft. The
`beforeunload` handler (`WeekTemplatesTab.tsx:129-130`) covers a page reload.

With a URL tab, the Back button can change the tab without `handleTabChange`.

- The page keeps the rendered tab on `templates` while the draft is dirty and
  the URL asks for another tab. No render unmounts the draft.
- The page sets `pendingTab` to the URL tab and opens the same dialog.
- "Discard" keeps the URL tab. "Keep editing" writes `tab=templates` back with
  `replace`.

## 6. Links into the page

- `supabase/functions/_shared/shiftTradeReminderContent.ts:43`:
  `SCHEDULER_REMINDER_PATH = '/scheduling'` changes to
  `'/scheduling?tab=trades'`. The CTA at `:215` uses this constant. The trade
  reminder then opens the trade queue. The edge function must be deployed.
- `src/components/dashboard/LaborEfficiencyCard.tsx:131` calls
  `navigate('/scheduling')`. This card is about labor efficiency. It changes to
  `/scheduling?tab=planner`.
- `handleEditTemplates` (`Scheduling.tsx:347`) and `handleViewTemplateWeek`
  (`Scheduling.tsx:348-354`) use the new setter.

## 7. Tests

- Unit (`tests/unit/useSearchParamState.test.ts`): the fallback, a value that is
  not valid, removal of a default value, push compared to replace, and the hook
  keeps other params.
- Unit (`tests/unit/schedulingUrlParams.test.ts`): each parser.
- Unit: the trade reminder CTA URL contains `?tab=trades`.
- E2E (`tests/e2e/scheduling-url-routes.spec.ts`): open
  `/scheduling?tab=planner&view=timeline`, and the timeline shows. Change the
  tab, then press Back, and the last tab shows. A reload keeps the area filter.
  Use role queries with `{ exact: true }`, because the responsive layout mounts
  two trees (lesson PR #621).

## 8. Risks

- **Hidden tab content reads params.** Radix `Tabs` unmounts inactive content.
  A shared param (`area`, `day`) can change while a tab is hidden. Each reader
  validates on read, so this is safe.
- **Week change and `day`.** A `day` outside the new week falls back to the
  default. The mobile reset effect removes it.
- **Many URL writes.** Each filter change is one `replace`. This does not add
  history entries.
