# Owner dashboard: today-first briefing — plan

Design: `docs/superpowers/specs/2026-09-30-dashboard-briefing-design.md`

Rules for every task:

- Do not change a hook, query, RPC or calculation.
- Use semantic tokens only. Use the type scale in CLAUDE.md.
- Write the test first. Run it and see it fail. Then write the code.
- Stage explicit paths. Commit after each task.

## Tasks

1. **Headline builder.** Write `tests/unit/breakEvenHeadline.test.ts` (fails).
   Cover above, below, at, no target (0 or non-finite `dailyBreakEven`) and
   `null` data. Add `src/lib/breakEvenHeadline.ts` with
   `buildBreakEvenHeadline({ todayStatus, todayDelta, dailyBreakEven, todaySales })`.
   It returns `{ tone, sentence, progressPercent }`. Commit.

2. **Day grid helper.** (Deleted after the preview review. See design 4.7.) Write `tests/unit/breakEvenDayGrid.test.ts` (fails).
   Cover the order of days, `isPartial` before `status`, the `aria-label`
   text and an empty history. Add `src/lib/breakEvenDayGrid.ts` with
   `buildDayGridCells(history)`. Commit.

3. **Active section hook.** Write `tests/unit/useActiveSection.test.ts`
   (fails). Stub `IntersectionObserver` with `vi.stubGlobal` in the test file.
   Cover the first section as default, a change on intersect, and cleanup on
   unmount. Cover one `dashboard_section_viewed` call per section per mount,
   with a mocked `posthog.capture`. Add `src/hooks/useActiveSection.ts`.
   Commit.

4. **Section list.** Add `src/components/dashboard/dashboardSections.ts`. It
   exports the ordered list of `{ id, label }` for the 13 sections in design
   section 4.8. Cover the ids and uniqueness in
   `tests/unit/dashboardSections.test.ts`. Commit.

5. **Attention list.** Write `tests/unit/DashboardAttentionList.test.tsx`
   (fails). Cover the empty state text "Nothing needs your attention.", the
   count badge, one `<li>` per alert, and navigation on the action button.
   Add `src/components/dashboard/DashboardAttentionList.tsx`. It takes the
   `CriticalAlert[]` shape from `CriticalAlertsBar.tsx:4-14`. Move that type
   to `src/types/dashboard.ts` and export it. Commit.

6. **Today card.** Write `tests/unit/DashboardTodayCard.test.tsx` (fails).
   Cover the visible headline sentence, the `progressbar` role and values, the
   four values, the KPI `<dl>` (cash, runway, prime cost, month to date), the
   "Last 14d" line, the skeleton while `breakEvenLoading`, and the text
   "Break-even is not available right now." on error. Add
   `src/components/dashboard/DashboardTodayCard.tsx`. Keep the
   `formatRunway` output from `OwnerSnapshotWidget.tsx`. Move `formatRunway`
   to `src/lib/formatRunway.ts` with a unit test. Commit.

7. **Day grid component.** (Deleted after the preview review. See design 4.7.) Write `tests/unit/BreakEvenDayGrid.test.tsx`
   (fails). Cover one focusable `<button>` per day, the `aria-label`, the
   partial-day "so far" text, and the empty state text. Add
   `src/components/dashboard/BreakEvenDayGrid.tsx`. Commit.

8. **Section rail.** Write `tests/unit/DashboardSectionRail.test.tsx`
   (fails). Cover `nav[aria-label="Dashboard sections"]`, the
   `aria-label` "Go to <section>" on each link, `aria-current="location"` on
   the active link, and the `onNavigate(id)` callback. Cover the compact chip
   variant with its own `nav` label. Add
   `src/components/dashboard/DashboardSectionRail.tsx`. Commit.

9. **Wire the page.** Change `src/pages/Index.tsx`:
   - Change the header per design section 4.2. Keep the `h1` text and all
     actions. Put Banking, Reports and Inventory in a "More" menu below `sm`.
   - Replace `CriticalAlertsBar` and `OwnerSnapshotWidget` with the new top:
     Today card, then the attention list and `MonthlyBreakEvenStrip` side by
     side at `xl`, then the day grid.
   - Wrap each lower block in `<section id="dash-…" className="scroll-mt-24">`.
     Do not change the text or the classes inside the blocks.
   - Add the two-column layout with the sticky rail and the mobile chip row.
   - Add `handleSectionNavigate(id)`. It opens the matching collapsible state
     (`src/pages/Index.tsx:138-147`: `metricsOpen`, `revenueOpen`,
     `moneyOutOpen`, `cashflowOpen`, `monthlyOpen`, `bankingOpen`,
     `operationsOpen`, `quickActionsOpen`, `laborEfficiencyOpen`,
     `laborCostOpen`), then
     scrolls. It uses `behavior: 'auto'` under `prefers-reduced-motion`. It
     sends `dashboard_rail_clicked`.
   - Do not change any hook call or any `useMemo` body.
   Extend `tests/unit/indexLaborCostSection.test.ts` only if its selectors
   break. Commit.

10. **Skeleton.** Change `src/components/DashboardSkeleton.tsx` to match the
    new top (one card and two half cards). Commit.

11. **Delete old components.** Run `grep -rn "OwnerSnapshotWidget\|CriticalAlertsBar" src tests`.
    If only the old files match, delete
    `src/components/dashboard/OwnerSnapshotWidget.tsx` and
    `src/components/dashboard/CriticalAlertsBar.tsx`. Commit.

12. **Checks.** Run `npm run typecheck`, `npm run lint`, `npm run test` and
    `npm run build`. Run
    `npx playwright test tests/e2e/dashboard-basis-labels.spec.ts tests/e2e/labor-cost-alignment.spec.ts --reporter=line`
    in the foreground. Fix all failures.

13. **UI check.** Open the dashboard in the preview at 1440, 1280, 1024 and
    375 px, in light and dark mode. Check the rail jumps, the open of closed
    sections, the half-width month strip and the keyboard focus order. Take
    screenshots for the PR.

14. Push the branch.

15. **Preview review fixes.** Delete the day grid. Make the rail sticky
    (`overflow-x-clip` on the app shell, the rail in a full-height `aside`).
    Make the active rail link follow the scroll position. Show skeletons,
    not fake values, while cash, runway and alerts load. Do not show the
    Today headline in red while the day is open. Use one money format.
    Delete the duplicate section titles. Restyle Smart Alerts and the
    monthly table to the type scale and semantic tokens.

16. **Accessibility review fixes.** Add the strong text tokens for contrast.
    Move focus to the section on a rail jump. Add focus rings and 24 px
    targets. Make the mobile chips sticky. Add Smart Alerts to the rail. Put
    the period selector in Performance Overview. Give the charts and the
    attention count a name. Add the Today card caption and "Not tracked" food
    cost. Fix the bank empty state. Add a skip link. See design 6.1.

## Not in this plan

- The runway data fix (M1). It is a separate PR from `main`.
- M2, M3 and M4. The user validates each one first.
