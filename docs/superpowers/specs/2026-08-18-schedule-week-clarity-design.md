# Employee schedule: week clarity and a relative draft state

Date: 2026-08-18
Status: approved

## The problem

An employee did not come to work. She opened `/employee/schedule` at 11:42 PM
on a Sunday, 18 hours before her Monday shift. The page showed the week that
had just ended. Every shift in it was over, so the "Upcoming Shifts" card
showed nothing. The page gave a confident answer, and the answer was wrong.

Two earlier commits fixed the copy that caused two other no-shows:

- `790718c1` "show the draft state as a hue, not a warning". Body: "An employee
  read the alert and did not come to work."
- `809f1b9c` "delete the retraction alert from the employee page". Body: "An
  employee quoted that exact message as the source of the confusion."

This design fixes the third cause. The third cause is not a word. It is
position: the answer to "am I working?" lived below a week boundary.

## What the code does today

### The page shows one week, and derives everything from it

`src/pages/EmployeeSchedule.tsx:57` sets `currentWeekStart` to the current week.
`src/pages/EmployeeSchedule.tsx:73` calls `useMyShifts` with `currentWeekStart`
and `weekEnd`, so the query returns that week only.

`src/pages/EmployeeSchedule.tsx:165` derives `upcomingShifts` from the same
bounded array. The comment says "next 3 days", but the array cannot cross the
Sunday boundary. On Sunday night the filter at
`src/pages/EmployeeSchedule.tsx:169` keeps nothing, because every shift in the
week has started.

### The query is already self-scoped

`src/hooks/useShifts.tsx:88` adds `.eq('employee_id', employeeId)` when an
employee id is given, and `useMyShifts` at `src/hooks/useShifts.tsx:136` always
passes one. `src/hooks/useShifts.tsx:105` disables the query until the id
resolves. A wider date range therefore reads one employee's rows, not the
restaurant's.

The query key at `src/hooks/useShifts.tsx:76` contains
`startDate?.toISOString()`. An unstable `Date` in that position makes a new key
on every render.

### The week label carries no position

`src/pages/EmployeeSchedule.tsx:306` shows a `Badge variant="outline"` holding
`format(currentWeekStart, 'MMM d')` and `format(weekEnd, 'MMM d, yyyy')`. The
badge looks the same on every week. It states a range, not a position.

### The draft treatment is absolute

`src/components/employee/ShiftRow.tsx:104` sets `isDraft = !shift.is_published`.
`src/components/employee/ShiftRow.tsx:98` gives every draft
`bg-muted/20 border border-dashed border-border/60`.
`src/components/employee/ShiftRow.tsx:115` weakens the time text.
`src/components/employee/ShiftRow.tsx:135` adds an `sr-only` "Draft" label.

A restaurant that never publishes has `is_published = false` on every shift. Its
employees therefore see every row muted and dashed. The whole page reads as a
placeholder. A signal that never varies is not a signal.

### The heading still hedges

`src/pages/EmployeeSchedule.tsx:261` swaps the card title to
`'Upcoming (tentative)'` when `allUpcomingAreDrafts` is true
(`src/pages/EmployeeSchedule.tsx:176`). This is the same class of copy that
`790718c1` deleted.

## The design

### Change 1: a next-shift anchor

Add a block at the top of the page, above the week grid. It states the next
shift, or states that none is scheduled.

The anchor never depends on the week the employee views. A new query reads from
the start of today, in the restaurant timezone, to 21 days ahead.

The anchor states no publish status. A shift that exists gets stated.

### Change 2: a relative week label

Delete the `Badge` at `src/pages/EmployeeSchedule.tsx:306`. Put a relative label
in the centre of the week nav:

| Offset from the current week | Label |
|---|---|
| 0 | This week |
| +1 | Next week |
| -1 | Last week |
| +N | In N weeks |
| -N | N weeks ago |

The date range drops to a smaller second line.

Add a dot to the forward chevron when the next week holds a shift. Add a last
row to the grid that states the same count and navigates forward.

The dot and the footer row appear only when the employee views the current
week. That is the case that caused the no-show. A wider rule needs data for
every week the employee can reach, and gives no extra safety.

### Change 3: the draft treatment becomes relative

A restaurant counts as a publisher when it published the current week or the
previous week. Anchor both weeks to today, never to the viewed week.

- The restaurant publishes: keep the treatment at
  `src/components/employee/ShiftRow.tsx:98` unchanged.
- The restaurant does not publish: show every shift solid. No dashed border, no
  muted text, no `sr-only` "Draft".

The rule is schedule-shaped, not calendar-shaped. A restaurant that publishes
each week always passes. A restaurant that tried the publish flow and stopped
fails 2 weeks later.

`useSchedulePublications` at `src/hooks/useSchedulePublish.tsx:221` already
reads every publication row for the restaurant. The rule needs no new schema and
no new query. Publish invalidates that key at
`src/hooks/useSchedulePublish.tsx:288`, and unpublish invalidates it at
`src/hooks/useSchedulePublish.tsx:352`, so the flag stays fresh.

While the publication query loads, treat the restaurant as a non-publisher and
show shifts solid. A false draft hue caused a no-show. A late draft hue did not.
`src/components/employee/ScheduleStatusBanner.tsx:39` states the same principle
for the banner: "A wrong line is worse than no line."

### Change 4: delete the tentative heading

Delete the conditional at `src/pages/EmployeeSchedule.tsx:261` and
`src/pages/EmployeeSchedule.tsx:259`. The card is always "Upcoming shifts".
Delete `allUpcomingAreDrafts` at `src/pages/EmployeeSchedule.tsx:176`.

## Timezone rule

`WEEK_STARTS_ON` in `src/lib/dateConfig.ts` is 1, and
`src/pages/EmployeeSchedule.tsx:58` calls `startOfWeek(new Date(), …)`. That
call uses the host timezone.

Lesson `memory/lessons.md:274` records a $2,246 wage error from exactly this.
Every comparison in this design therefore takes an explicit IANA timezone:

- Today's week start comes from `formatLocalDateInTz`
  (`src/lib/shiftInterval.ts:207`), then `startOfWeek`.
- The anchor's lower bound is the start of today in the restaurant timezone.

The page already reads `restaurantTimezone` at
`src/pages/EmployeeSchedule.tsx:75`.

## New units

Each unit is a pure function with no React dependency, so each is testable
alone.

| File | Export | Purpose |
|---|---|---|
| `src/lib/schedulePublisher.ts` | `isPublishingRestaurant(publications, now, tz)` | The Change 3 rule |
| `src/lib/scheduleWeekLabel.ts` | `getRelativeWeekLabel(viewedWeekStart, now, tz)` | The Change 2 label |
| `src/lib/nextShift.ts` | `selectNextShift(shifts, now)` | The Change 1 selection |
| `src/components/employee/NextShiftCard.tsx` | `NextShiftCard` | The Change 1 view |

## Changed files

| File | Change |
|---|---|
| `src/pages/EmployeeSchedule.tsx` | anchor query, relative label, footer row, delete Change 4 |
| `src/components/employee/ShiftRow.tsx` | add a `restaurantPublishes` prop that gates the draft branch |
| `src/hooks/useSchedulePublish.tsx` | add a thin hook over the existing query |

## States

`NextShiftCard` renders three states, per CLAUDE.md:

- loading: a `Skeleton` at the card's fixed height.
- error: "We couldn't load your next shift." The card never states that no shift
  exists when the read failed. `src/pages/EmployeeSchedule.tsx:326` already
  applies this rule to the grid.
- empty: "No shift scheduled in the next 3 weeks."

The card holds a constant height across all three states. A collapsed card would
push the grid down on an already-painted page.
`src/components/employee/ScheduleStatusBanner.tsx:21` records the same hazard.

## Accessibility

- The dot on the forward chevron is colour alone, so it fails WCAG 1.4.1 by
  itself. The chevron's `aria-label` becomes "Next week, 2 shifts".
- The footer row is a `button`, reachable by keyboard.
- The nav buttons keep `min-h-[44px]`.
- A shadcn `Badge` renders a `div`. Never put one inside a `<p>`.
  `memory/lessons.md:2818` records a DOM-nesting error from that mistake.

## Testing

| Unit | Test |
|---|---|
| `isPublishingRestaurant` | current week, previous week, 2 weeks ago, empty list, timezone edge |
| `getRelativeWeekLabel` | 0, +1, -1, +3, -3, timezone edge at a week boundary |
| `selectNextShift` | future shift, cancelled shift skipped, in-progress shift, empty |
| `NextShiftCard` | the three states render |

All tests go in `tests/unit/`.

## Decided trade-offs

- **The dot and footer appear on the current week only.** A rule for every
  reachable week needs a query per week. It adds no safety for the failure this
  design fixes.
- **The backward chevron gets no dot.** An employee needs the future.
- **A publisher restaurant keeps the draft hue.** This design does not fix the
  hue. It fixes who sees it.

## The mail storm is already fixed

Restaurants stopped publishing because a one-shift correction forced an
unpublish, and both halves mailed every employee. PR #756 (commit `26e9e296`,
"quiet publish and live edit of published shifts") fixed both halves:

- `src/components/PublishScheduleDialog.tsx:186` gives the manager a "Notify
  employees about this schedule" option.
- `src/hooks/usePublishedShiftGuard.tsx` lets a manager edit a locked shift
  with no unpublish.

Design: `docs/superpowers/specs/2026-08-15-quiet-publish-live-edit-design.md`.

Change 3 stays necessary. A restaurant that gave up before PR #756 still
publishes nothing today, so its employees still see every shift dashed. Change 3
also self-corrects: when such a restaurant publishes again, the rule sees the
new row and the draft hue returns with a meaning.

## Out of scope

- The missing audit trail. `shifts` has no `created_by`, and
  `schedule_change_logs` records no `created` or `published` row. The only proof
  of who created a shift was a PostHog autocapture label, which expires after 30
  days.
