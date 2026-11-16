# Scheduling URL Routes — Implementation Plan

Design: `docs/superpowers/specs/2026-11-12-scheduling-url-routes-design.md`
Branch: `feature/scheduling-url-routes`
Method: TDD. Write the failing test first, then the code. Run `npm run typecheck`
and the related unit tests after each task. Commit after each task. Stage
explicit paths only.

## Task 1 — Param registry

Files: `src/lib/schedulingUrlParams.ts` (new),
`tests/unit/schedulingUrlParams.test.ts` (new).

1. Write tests for each module-level parser:
   - `parseTab`: accepts the 6 values in `SCHEDULING_TABS`, else `null`.
   - `parseGroupBy`: accepts `none | area | position`.
   - `parsePlannerView`: accepts `plan | timeline`.
   - `parseIsoDay`: accepts a real `YYYY-MM-DD` date, rejects `2026-02-30` and other text.
   - `parseFlag`: `'1'` gives `'1'`, else `null`.
   - `parseFreeText`: accepts a non-empty string up to 200 characters (area, position, template id).
2. Export `SCHEDULING_TABS`, `SCHEDULING_PARAMS`, the parsers, and one
   `ParamSpec` object for each param (key, fallback, parse, `keepDefault`).
3. Commit.

## Task 2 — URL state hooks

Files: `src/hooks/useSearchParamState.ts` (new),
`tests/unit/useSearchParamState.test.ts` (new).

1. Write the tests with `BrowserRouter`, not `MemoryRouter`, because the setter
   reads `window.location.search`. Set the start URL with
   `window.history.replaceState` in `beforeEach`. Test:
   - The fallback shows when the param is missing or not valid.
   - A value equal to the fallback deletes the param. `keepDefault` keeps it.
   - `push` adds a history entry (`window.history.length` grows). `replace` does not.
   - The setter keeps other params.
   - Two setter calls in one handler (`week` then `tab`) keep both values.
   - The setter identity stays the same after a param change (`renderHook` + `rerender`).
   - `useSetSearchParams({ a: 'x', b: null })` sets `a` and deletes `b` in one write.
2. Write the hooks. The setter builds `new URLSearchParams(window.location.search)`,
   applies the patch, and calls
   `navigate({ pathname, search, hash: window.location.hash }, { replace })`.
   `navigate({ search })` alone drops the hash. Never call the setter during
   render: `navigate` does nothing before its layout effect runs. The read uses `useSearchParams()` and
   `useMemo` on the raw value.
3. Commit.

## Task 3 — Move `useSharedWeek` to the new setter

Files: `src/hooks/useSharedWeek.ts`, its existing tests (find with
`grep -rl useSharedWeek tests/unit`).

1. Change `tests/unit/useSharedWeek.test.tsx` from `MemoryRouter` to
   `BrowserRouter` with `window.history.replaceState`. Under `MemoryRouter`, the
   router location and `window.location` differ, so the tests are not valid.
   Add a test: `setWeekStart(monday)` and a tab setter call in one handler keep both.
2. Change the setter to `useSetSearchParams` with `replace`. Keep the public API.
3. Run all `useSharedWeek` and `useShiftPlanner` tests. Commit.

## Task 4 — Page tab, permissions, and the draft guard

Files: `src/pages/Scheduling.tsx`.

1. Replace `activeTab` (`:268`) with `useSearchParamState(tabSpec)`.
2. Delete `pendingTab` state (`:271`) and the effects at `:333-337` and `:341-345`.
3. Derive `effectiveTab`, `leavingDirty`, `renderedTab`, and `discardOpen` (design §4, §5).
4. `<Tabs value={renderedTab} activationMode="manual">` (`:957`). `onValueChange`
   calls the tab setter with `push`.
5. While `!isResolved` and the URL tab is `trades` or `templates`, show a
   `Skeleton` panel with `aria-busy="true"`.
6. Add one effect: after `isResolved`, if `effectiveTab !== urlTab` and not
   `leavingDirty`, write `tab=schedule` with `replace`.
7. Discard dialog (`:1815-1832`): open is `discardOpen`. The "Discard"
   `onClick` calls `event.preventDefault()`, then `setTemplatesDirty(false)`.
   Radix `composeEventHandlers` skips `onOpenChange` for a default-prevented
   event, so no ref is necessary. `onOpenChange(false)` runs only for Esc,
   Cancel, and an overlay click. It writes `tab=templates` with `replace`.
8. `handleEditTemplates` (`:347`) uses the tab setter with `push`.
   `handleViewTemplateWeek` (`:348-354`) uses `useSetSearchParams({ week, tab: null }, { history: 'push' })`.
   The old code did not add a history entry for this week change. `push` is
   correct now, because the tab changes in the same write. Say this in the
   commit message.
9. Run typecheck and the scheduling unit tests. Commit.

## Task 5 — Schedule tab filters and group by

Files: `src/pages/Scheduling.tsx`, `src/components/scheduling/WeekScheduleMobile.tsx`.

1. `area`, `position` (`:427-428`): use the hook. Derive `effectiveArea` and
   `effectivePosition` after `areasLoading` / `positionsLoading` (design §3.3).
   Get `isLoading` from `useEmployeeAreas` (`:426`). Delete the effect at `:431-435`.
2. `group` (`:436-442`, `:573`): use the hook with `keepDefault: true`. Read
   `localStorage` once in a lazy ref (try/catch). Add one page effect: if the URL
   has no `group` and the tab is `schedule`, write the stored value with
   `replace`. Test raw presence with
   `new URLSearchParams(window.location.search).has('group')`. Do not compare the
   parsed value to the fallback: a stored `none` equals the fallback and the
   write would repeat. Add a unit test for a stored `none`. `handleGroupByChange`
   writes the URL and `localStorage`.
3. `WeekScheduleMobile` (`:257-266`): replace the index state with the `day`
   param. Derive the index with `weekDays.findIndex`. Fall back to
   `pickDefaultMobileDay`. Delete the reset effect. The day picker writes `day`
   with `replace`.
4. Run typecheck and tests. Commit.

## Task 6 — Planner and timeline

Files: `src/components/scheduling/ShiftPlanner/ShiftPlannerTab.tsx`,
`src/components/scheduling/ShiftTimeline/ShiftTimelineTab.tsx`.

1. `view` (`ShiftPlannerTab.tsx:652`), `hidden` (`:219`), `plannerArea` (`:305`):
   use the hook. Derive the planner area against `templateAreas` (`:984`); map
   `'all'` to `null`. Change the comment at `:216`.
2. Timeline `day` (`ShiftTimelineTab.tsx:297-301`) and `timelineGroup` (`:302`):
   use the hook. Keep the derive at `:301`.
3. Open the React Profiler on the Planner tab. Toggle `hidden` and
   `plannerArea`. If the full `Scheduling` page renders again, wrap the heavy
   planner children in `memo` and pass primitives.
4. Run typecheck and tests. Commit.

## Task 7 — Availability week and selected template

Files: `src/components/scheduling/TeamAvailabilityGrid.tsx`,
`src/components/scheduling/WeekTemplates/WeekTemplatesTab.tsx`.

1. Grid: delete `weekStart` state (`:384`). Call `useSharedWeek()`. Change
   `goToPrevWeek`, `goToNextWeek` (`:411-423`), and the "today" handler (`:429`)
   to non-functional calls with `weekStart` in the deps.
2. Templates: delete `selectedId` state (`:74`). Derive the selected id from
   the `template` param. Do not keep a copy in state. The click handler calls
   `guard()` first, then writes the param. When the list loads, select the
   matching template. If no match, the auto-select effect (`:105-107`) selects
   the first and writes its id with `replace`. Never write when the list is empty. Write the id only after `guard()`
   confirms. Never write `NEW_DRAFT_ID`.
3. Run typecheck and tests. Commit.

## Task 8 — Links into the page

Files: `supabase/functions/_shared/shiftTradeReminderContent.ts`,
`tests/unit/shiftTradeReminderContent.test.ts`,
`tests/unit/shiftTradeRemindersHandler.test.ts`,
`src/components/dashboard/LaborEfficiencyCard.tsx`.

1. Change the tests at `shiftTradeReminderContent.test.ts:166` and
   `shiftTradeRemindersHandler.test.ts:435`, `:445` to import
   `SCHEDULER_REMINDER_PATH`. Add a test: the CTA equals
   `${appUrl}/scheduling?tab=trades`.
2. Set `SCHEDULER_REMINDER_PATH = '/scheduling?tab=trades'`.
3. `LaborEfficiencyCard.tsx:131`: `navigate('/scheduling?tab=planner')`.
4. Update the help docs in `src/content/help/scheduling-and-time/*.md` if they
   describe how to reach a tab. Add one line about shareable links.
5. Run tests. Commit.

## Task 9 — E2E

File: `tests/e2e/scheduling-url-routes.spec.ts` (new).

Cases (design §7): planner timeline deep link; the selected trigger matches
`?tab=`; tab change then Back; reload keeps `area` and `group`; 375 px `?day=`;
dirty template draft then Back opens the dialog and keeps the draft; keyboard:
an arrow key moves focus and does not change `?tab=`, then Enter changes it. Use
`generateTestUser()` and role queries with `{ exact: true }`. If local signup
hangs, use the `page.setContent` harness (lesson in `memory/lessons.md`).
Run with `npx playwright test tests/e2e/scheduling-url-routes.spec.ts --reporter=line`
in the foreground. Commit.

## Task 10 — Full check

Run `npm run typecheck`, `npm run lint`, `npm run test`, and the scheduling E2E
specs (`tests/e2e/schedule-*.spec.ts`, `scheduling-*.spec.ts`). Then Phases 6–9
of the workflow: UI review, code-simplify, the Phase 7a reviewers (they include
`vercel-react-best-practices`), CodeRabbit, verify, PR, and CI.

## Out of scope

Dialogs, the Time Off and Trades tab internals, the planner employee sidebar
filters, the labor panel state, and the Templates mobile list/editor toggle
(design §2).
