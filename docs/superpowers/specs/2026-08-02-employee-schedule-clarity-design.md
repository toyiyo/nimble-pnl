# Employee Schedule Clarity — Draft vs Published Design

**Date:** 2026-08-02
**Status:** Approved — product decisions recorded below; implementation scoped
**Scope:** Two parts. **Part I** — `src/pages/EmployeeSchedule.tsx` and its data layer (mobile +
desktop, web + Capacitor native). **Part II** — the five notification-delivery defects found while
debugging the original incident.

## Recorded Product Decisions

These were open questions in the first draft. They are now settled and binding on implementation:

| # | Question | Decision |
|---|---|---|
| 1 | Hide vs. show-marked draft shifts (§2) | **Show, marked as tentative.** The §2 *fallback* treatment is the primary path. Hiding is rejected. |
| 2 | Retraction notification threshold (§7a) | **Only weeks whose publication row had `notification_sent = true`.** Don't announce the retraction of something nobody was told about. |
| 3 | Retraction audience (§7a) | **Employees who had published shifts in the retracted version.** |

Decision 1 overrides this document's original recommendation. The tradeoff was raised explicitly
and accepted: because a retracted week (state D) has *no* published shifts by definition, showing
drafts means the whole week renders as dashed "tentative" rows under the red banner rather than as
an empty week. That is a weaker signal than an empty grid, so **the state-D banner carries
proportionally more of the burden** and must be unmissable (§1 State D).

Decision 3 has a mechanical consequence the first draft missed — see **Part II §D** — because
`unpublish_schedule()` sets `is_published = false` on every shift in the week, so *after* it runs
there is no way to reconstruct who "had published shifts." The audience must be captured at
retraction time and persisted.

## Problem Statement

`EmployeeSchedule.tsx` fetches shifts through `useShifts()` (`src/hooks/useShifts.tsx`), which
runs `select('*, employee:employees(*)')` against `shifts` with **no `is_published` filter**. RLS
on `shifts` allows any restaurant member to read every row for their restaurant, published or
not. The page never references `is_published`, `published_at`, or `locked` — every shift for the
viewed week renders identically, whether it is a manager's locked, published commitment or a
half-finished draft the manager is still dragging around.

**Real incident:** a manager published week Aug 3–9 on Aug 1 (employees got "New Schedule
Published" emails, sent from `notify-schedule-published`). On Aug 2 the manager unpublished the
whole week to make edits — 63 shifts flipped from `is_published: true` back to `false` via the
`unpublish_schedule()` Postgres function, and were unlocked. **No notification exists for this
event** — grepping the repo confirms there is no `notify-schedule-unpublished` (or equivalent)
edge function; `notify-schedule-published/index.ts` is the only notification function in the
schedule-publish family. The manager then edited shifts all morning. Any employee who opened the
app during that window saw the half-edited draft rendered with the exact same visual weight as a
confirmed schedule, with nothing on screen to say otherwise.

Two failures compound here:
1. **No visual distinction** between draft and published shifts on the employee page.
2. **No notification** when a published week is retracted, so employees who already saw the
   "published" version have no signal that what they're looking at is no longer real.

## What the Database Already Gives Us

This matters because it changes the design from "add new tracking" to "surface what's already
tracked":

- `shifts.is_published` (bool) / `shifts.locked` (bool) / `shifts.published_at` (timestamptz) —
  set true/true/now() by `publish_schedule()`, and set back to `false`/`false`/`NULL` by
  `unpublish_schedule()`. **`unpublish_schedule()` does not touch the historical
  `schedule_publications` row** — it only mutates `shifts` and inserts an audit row into
  `schedule_change_logs`.
- `schedule_publications` (`restaurant_id, week_start_date, week_end_date, published_at,
  published_by, shift_count, notes, notification_sent`) — one row is INSERTed per *publish*
  action (`20260729120000_publish_schedule_tz_bucketing.sql:113-127`, an unconditional INSERT).
  It is never deleted or updated by unpublish. This means **a row existing for a given week is
  durable proof that the week was published at least once**, independent of the shifts' current
  `is_published` state. This is the exact signal needed to detect "retracted."

  **Two production facts constrain how this row is looked up** (verified by direct query against
  prod, 2026-08-02):

  1. **Republishing accumulates rows.** Because the INSERT is unconditional, one week can have
     many publication rows — prod currently holds a week with **5**. Any "the publication for
     this week" lookup must therefore mean *latest by `published_at`*, never `.single()`, which
     would throw.
  2. **`week_end_date` is not a stable key.** Older rows use an 8-day Sun–Sun span
     (`2026-07-27 → 2026-08-03`) while newer ones use the current Monday-start 7-day span
     (`2026-08-03 → 2026-08-09`). A lookup matching on *both* dates silently misses historical
     rows. **Match on `(restaurant_id, week_start_date)` only.**
- `schedule_change_logs` — gets a `change_type = 'unpublished'` row (with an optional manager
  `reason`) on every unpublish, both per-shift (via the `log_shift_change()` trigger) and one
  aggregate row from the RPC itself. **RLS already allows any restaurant member to `SELECT` this
  table** (`"Users can view change logs for their restaurants"`, `USING (... user_restaurants
  ... auth.uid())` — no role restriction), so the employee page can read the manager's stated
  reason for a retraction without any RLS change.
- `src/hooks/useSchedulePublish.tsx` already contains `useWeekPublicationStatus(restaurantId,
  weekStart, weekEnd)`, used today on the manager side. It returns `{ publication, isPublished,
  loading }`, but **its `isPublished` collapses "never published" and "published-then-retracted"
  into the same `null`** (it early-returns `null` the moment `publishedShiftCount === 0`,
  regardless of whether a `schedule_publications` row exists). That collapse is precisely why the
  incident was invisible — even the manager-side hook, if it were reused as-is on the employee
  page, would show "not published" for both a fresh unedited week and a week mid-retraction.

This means the required new logic is small: query `schedule_publications` for *any* row matching
the viewed week (not gated on current shift state) to learn "has this week ever been published,"
and cross it with the current `is_published` count to learn "is it live right now." No RLS
changes, no new tables.

## State Model

Given the viewed week (`weekStart`/`weekEnd`, restaurant-local, Monday-start per
`WEEK_STARTS_ON`), and restricted to the current employee's shifts (`myShifts` in
`EmployeeSchedule.tsx`):

```
historicalPublication = latest-by-published_at schedule_publications row for
                         (restaurant_id, week_start_date)   [any status]
livePublishedCount    = count(myShifts where is_published = true)
draftCount            = count(myShifts where is_published = false)
```

Note the lookup key and the `latest-by-published_at` ordering — both are required by the two
production facts recorded above, not stylistic choices.

| State | Condition | Meaning |
|---|---|---|
| **A. Not yet published** | `historicalPublication == null` | Manager hasn't published this week. Nothing to show as "your schedule" — regardless of draft shift count. |
| **B. Published (clean)** | `historicalPublication != null` AND `livePublishedCount > 0` AND `draftCount == 0` | Every shift for this employee this week is published and locked. Normal view. |
| **C. Published, being revised** | `historicalPublication != null` AND `livePublishedCount > 0` AND `draftCount > 0` | Manager published, then added/changed shifts without re-publishing. Employee has a confirmed subset plus unconfirmed additions. |
| **D. Retracted** | `historicalPublication != null` AND `livePublishedCount == 0` | The exact incident: was published, is now fully unpublished. Whatever shifts exist for the week are draft-only, mid-edit. |

State D is the one the app currently cannot express at all. State C is the "partially published"
case named in the task. State A already degrades gracefully today by accident (an unpublished
week with zero shifts looks like an empty week) — but only by accident, and only if the manager
also has zero draft shifts scaffolded; today an all-draft week in state A renders identically to
state B.

## 1. Draft vs Published Week States

Typography is the same in every state and is stated explicitly rather than left to the primitive's
defaults (`AlertTitle` is `font-medium leading-none tracking-tight`, `AlertDescription` is
`text-sm` — `src/components/ui/alert.tsx:29-41`, close to but not on the project scale):
`AlertTitle` → `text-[14px] font-semibold text-foreground`, `AlertDescription` →
`text-[13px] text-muted-foreground`. Icons are `h-4 w-4`.

### State A — Not Yet Published

The employee has no confirmed schedule for the viewed week. Per **Decision 1**, draft shifts *are*
rendered — but in the tentative treatment from §2, so every row on the page is visibly dashed and
badged "Draft — not confirmed." The page-level banner tells the employee why the whole week looks
that way.

```
┌─────────────────────────────────────────────────────────┐
│ ⓘ  Schedule not published yet                            │
│    Your manager hasn't finalized the week of Aug 3–9.    │
│    Check back soon.                                       │
└─────────────────────────────────────────────────────────┘
```

Copy depends on whether anything is actually rendered below, because under Decision 1 the two
cases look completely different to the employee:

- `draftCount === 0` — **"Schedule not published yet"** / **"Your manager hasn't finalized the
  week of {weekStart} – {weekEnd}. Check back soon."**
- `draftCount > 0` — **"Schedule not published yet"** / **"Your manager hasn't finalized the week
  of {weekStart} – {weekEnd}. The {M} shift{s} below {is/are} still {a draft/drafts} — nothing is
  confirmed yet. Check back soon."**

The second variant is not optional polish. With drafts visible, the first variant's "check back
soon" sits directly above a full week of shift cards and reads as "there's nothing to see yet"
while the employee is looking straight at what appears to be their schedule. State C already
quantifies confirmed-vs-draft; state A must too, and for the same reason.

Component: `shadcn` `Alert` with `variant="default"`, icon `Clock` (lucide), classes
`bg-muted/30 border-border/40` (neutral — this is not an error, it's an expected pending state).

### State B — Published (Clean)

No banner. The banner slot instead holds a single quiet line — **"Published {date} at {time}"**,
`text-[13px] text-muted-foreground` — which keeps the slot's height constant across all four
states (§4, layout-shift note) and answers "is this final?" at the top of the page. The same
information also appears in the `Weekly Schedule` card header next to the date-range badge, per
§3a, which is where it belongs when the employee is looking at a specific week. This is the
default, quiet state; the redesign should not add ceremony to the common case.

### State C — Published, Being Revised

The employee has a confirmed schedule AND the manager has added/edited shifts since, not yet
re-published. This is the most nuanced state: employees should trust the published shifts and be
clearly warned that anything else is not final.

```
┌─────────────────────────────────────────────────────────┐
│ ⚠  Some shifts are still being finalized                 │
│    3 of your shifts this week are confirmed. 1 more is   │
│    a draft your manager hasn't published yet — treat it  │
│    as tentative until it shows a "Confirmed" badge.       │
└─────────────────────────────────────────────────────────┘
```

Copy: **"Some shifts are still being finalized"** / **"{N} of your shifts this week are
confirmed. {M} more {is/are} a draft your manager hasn't published yet — treat {it/them} as
tentative until {it/they} show{s} a 'Confirmed' badge."** (pluralize `is/are`, `it/them`,
`shows/show` via a small helper, not hardcoded — see `formatShiftChangeDescription`-style helper
already in `useShifts.tsx` for the existing singular/plural pattern to mirror.)

Component: `Alert` with `variant="default"`, icon `AlertTriangle`, classes
`bg-amber-500/10 border-amber-500/20 text-foreground` (mirrors the existing "AI suggestion panel"
amber convention from CLAUDE.md, repurposed here for "needs attention, not an error").

### State D — Retracted

The incident state. A published week whose shifts are now all draft again. This must be the most
visually distinct state on the page — it is actively correcting a wrong belief the employee may
already hold from an earlier visit or a "New Schedule Published" email already in their inbox.

```
┌─────────────────────────────────────────────────────────┐
│ ⚠  This schedule was pulled back for changes             │
│    Your manager published Aug 3–9 on Aug 1, then         │
│    unpublished it to make edits. Nothing below is final  │
│    — check back once it's republished.                    │
│    {optional: "Reason: fixing a coverage gap Thursday."}  │
└─────────────────────────────────────────────────────────┘
```

Copy: **"This schedule was pulled back for changes"** / **"Your manager published {weekStart} –
{weekEnd} on {publishedDate}, then unpublished it to make edits. Nothing below is final — check
back once it's republished."** Optional third line if `schedule_change_logs.reason` is non-null
and not the RPC's own auto-generated boilerplate string (`"Schedule unpublished for date range: …"`
— filter that default out, it's not manager-authored and would read as noise): **"Reason:
{reason}"**.

Component: `Alert` with `variant="destructive"` semantics but not full destructive-red saturation
(this isn't the employee's error) — classes `bg-destructive/10 border-destructive/30
text-foreground`, icon `AlertTriangle` in `text-destructive`. Placed at the very top of the page,
above `MyShiftTradesCard`, so it's the first thing seen — this is the one state where being
unmissable matters more than visual quietness.

Per **Decision 1**, the day grid below this banner shows **every shift, all in the tentative
treatment** — because in state D, by definition, `livePublishedCount == 0`, so every row is a
draft. The entire week renders dashed and badged.

This is the case where Decision 1 costs the most, and it was accepted knowingly: an empty grid
would have said "there is nothing real here" structurally, whereas a full grid of dashed rows
still *looks* like a schedule to someone skimming. Two consequences follow and are binding:

1. **The state-D banner is the primary signal, not a supporting one.** It must be the first
   content on the page and visually dominant (see component spec above).
2. **The tentative treatment must not be subtle in this state.** The dashed border and badge are
   carrying the whole load for anyone who skips the banner.

## 2. Per-Shift Treatment

### Chosen treatment (Decision 1): visible, clearly marked drafts

**This is the specification.** Drafts stay visible and are made impossible to mistake for
confirmed shifts. Managers want employees to see tentative plans early so conflicts get flagged
before publish, and that outweighed the skim-risk argument below.

The rejected alternative and its rationale are preserved at the end of this section, because the
risk it names is real and shapes how the chosen treatment must be built: a "Draft" pill alone is
exactly the kind of secondary visual information users tune out on a fast mobile glance, which is
the majority of how this page gets used (per §6). **Every element below is therefore
load-bearing** — the dashed border, the badge copy, the muted type, and the removed Trade button
each independently signal "not final." Do not drop one as redundant during implementation; they
are redundant *on purpose*, because the banner may go unread.

Treatment:

- Card background changes from `bg-muted/50` (current, for all shifts) to
  `bg-muted/20 border border-dashed border-border/60` — dashed border reads as "not solid/not
  final" independent of color, satisfying the accessibility no-color-alone rule in §5.
  **The `/20` and `/60` are a deliberate departure** from CLAUDE.md's `bg-muted/30` /
  `border-border/40` house values (which the §1 banners *do* follow): the draft row must sit
  *below* the ambient surface level while its border sits *above* it, so the contrast between a
  draft and a confirmed row is legible at a glance. Recorded here so a future
  convention-cleanup pass doesn't silently normalize it back to `/30` and `/40`.
- A badge reading **"Draft — not confirmed"** (not just "Draft"; the copy should imply "you cannot
  rely on this" without requiring an explicit legend) sits where `getShiftStatusBadge()` normally
  renders its status badge — draft state takes priority over the existing Completed/In
  Progress/Today/Upcoming badges, since "is it real" outranks "when is it."
  **It must not be `variant="outline"`.** The pre-existing "Upcoming" badge
  (`EmployeeSchedule.tsx:99-105`) is already `variant="outline"`, so an outline draft badge would
  be a second identical grey pill in the same slot — precisely the "just another status pill"
  failure §2 is written to avoid. Give it a filled, warmer treatment plus a leading icon:
  `bg-amber-500/15 text-foreground border-amber-500/30` with a `FileEdit`/`PencilLine` (lucide)
  icon at `h-3 w-3`, matching the state-C banner's amber so "amber = not final" is one consistent
  language across the page. The icon is supplementary, not the signal — the text carries it (§5).
- Times and position text drop from `font-medium text-foreground` to
  `font-normal text-muted-foreground` — visually recedes relative to confirmed shifts on the same
  day.
- The Trade button (`ArrowLeftRight`) is **not shown** on draft shifts — trading a shift that
  might not exist tomorrow doesn't make sense; `isFuture(...) && shift.status !== 'cancelled'`
  gains `&& shift.is_published`.

`myShifts` keeps its current, unfiltered definition (employee match only) — no `is_published`
filter is added. `publishedCount` / `draftCount` are derived alongside it to drive the §1 banner,
and each rendered row branches on `shift.is_published` for the treatment above.

### The "Upcoming Shifts" card must get the same treatment — it is the worst offender

The first draft of this section only covered the day-grid rows in the `Weekly Schedule` card, and
that is an outright gap. `src/pages/EmployeeSchedule.tsx:241-294` renders a **second, separate
list** — the "Upcoming Shifts" card — from `upcomingShifts`, computed at `:170-179` by filtering
the same unfiltered `myShifts` on `startTime >= now && status !== 'cancelled'` with **no
`is_published` check**. It sits between the proposed banner (top of page) and the day grid
(below), and it renders each shift in a *solid* `bg-background border` card inside a green-tinted
`Card` (`from-green-500/5 to-green-600/5 border-green-500/20`) with `getShiftStatusBadge(shift)`
(`:287`) showing "Today"/"Upcoming".

Left untouched, state D produces this: a banner saying "Nothing below is final," and two sections
later the exact same draft shifts rendered solid, green-framed and badged "Upcoming" — reading as
*more* confirmed than the correctly-dashed rows further down. That inverts the whole point of
Decision 1. Two changes, both required:

1. **Rows branch identically.** Each row in this card takes the same `is_published` branch as the
   day grid — dashed border, muted type, "Draft — not confirmed" badge replacing the
   `getShiftStatusBadge()` output. This falls out for free once the row is a shared component (see
   the note on `ShiftRow` below).
2. **The card's own chrome must stop asserting confidence when nothing in it is confirmed.** When
   `upcomingShifts.every(s => !s.is_published)`, drop the green gradient and border for neutral
   `bg-muted/20 border-border/40`, and title the card **"Upcoming (tentative)"**. Green framing is
   itself a confirmation signal, and it is read before any badge is.

The card is **not** suppressed in states A/D. Suppressing it would contradict Decision 1 in the
same way hiding rows would, and it would make the page silently restructure itself between states.

### One `ShiftRow`, not a separate `DraftShiftRow`

An earlier version of this document proposed a new `DraftShiftRow.tsx` rendering only
`is_published === false` rows, leaving confirmed rows as inline JSX in the page's day-grid `.map()`
(`EmployeeSchedule.tsx:368-416`). That forks one conceptual row into two independently-maintained
render paths — duration/break formatting, Trade-button gating, badge placement — that then have to
be kept in sync by hand. **Superseded:** build a single `ShiftRow` parameterized on
`{ shift, isPublished, onTrade? }` that branches internally, and use it in *both* the day grid and
the Upcoming Shifts card. That is also what makes requirement 1 above a one-line change rather than
a second copy of the treatment.

### Rejected alternative: hide unpublished shifts

Recorded for provenance, since this was the first draft's recommendation and was overridden.

The argument for hiding: the cost of a false negative (employee doesn't realize a shift is a
draft, and shows up or doesn't show up based on wrong info) is categorically worse than the cost
of a false positive (employee doesn't see a shift that later gets published — they find out when
it publishes, same as the pre-existing baseline). Hiding would also have fixed the incident
structurally, since state D's shifts are all drafts and would simply not render.

Why it was rejected: it withholds information managers actively want employees to have, and an
empty week is itself ambiguous — it reads identically to "you're off this week." The chosen
treatment keeps the information and spends its complexity budget on making the distinction
unmissable instead.

## 3. "Last Updated / Published On" Affordance

Two related but distinct needs:

**(a) "When was this confirmed?"** — always answerable from data already fetched. Add a small,
persistent line in the `Weekly Schedule` card header, next to the existing date-range `Badge`:

```
Weekly Schedule                    [< Today >]  [Aug 3 – Aug 9, 2026]
                                                  Published Aug 1 at 6:42 PM
```

Copy: **"Published {format(publication.published_at, 'MMM d')} at {format(publication.published_at, 'h:mm a')}"**,
computed in the restaurant's timezone via the existing `formatLocalDateInTz` /
`formatLocalHHMMInTz` helpers from `src/lib/shiftInterval.ts` (not the browser's local time —
consistent with the recent timezone-bucketing fixes referenced in the recent commit history).
Rendered as `text-[12px] text-muted-foreground`, directly under the date-range badge. Omitted
entirely in state A (nothing to date).

**(b) "Has this changed since I last looked?"** — there is no existing per-user "last viewed
schedule" tracking anywhere in the schema, and adding server-tracked read-receipts is a
meaningfully bigger feature (new table, RLS, write-on-view). For v1, propose a **client-side
"seen" fingerprint**, the same pattern already used by `EnableNotificationsBanner`'s
`push_banner_dismissed_at` localStorage key (per the browser-push design doc) — this is UI-state
bookkeeping, not the "manual caching of server data" CLAUDE.md prohibits, since it never
substitutes for or delays a React Query fetch; it only decides whether to show a "New" pill on
top of data that was fetched normally.

- Key: `schedule_seen_${restaurantId}_${employeeId}_${weekStartISO}` → value = a hash of the
  fingerprint input below. Keys accumulate one per week ever viewed, unbounded over an employee's
  tenure, so the helper prunes on write: drop any `schedule_seen_*` key whose `weekStartISO`
  segment is more than 8 weeks in the past. Cheap, synchronous, and keeps the namespace bounded
  without needing a migration or a scheduled job.
- Value: a hash of
  `{publication.published_at, myShifts.map(s => [s.id, s.start_time, s.end_time, s.position,
  s.status]).sort()}` (cheap `JSON.stringify` + a non-cryptographic hash is sufficient; this is
  a change-detection fingerprint, not a security boundary).
- On mount/data-load, compare current fingerprint to stored value for the viewed week. Mismatch
  (or no stored value but a fingerprint now exists) → render a small **"Updated since you last
  checked"** `Badge` next to the "Published …" line, `bg-primary/10 text-primary
  border-primary/20`. The pill clears **only on interaction** — any interaction with the week, or
  an explicit "Got it" tap — at which point the new fingerprint is written.
- **No time-based auto-dismiss.** An earlier draft also cleared the pill after N visible seconds.
  That is a WCAG 2.2.1 (Timing Adjustable) failure and a practical one: the pill would vanish
  *and* permanently clear its underlying signal before a slow-reading, low-vision, or
  motor-impaired user had processed it, with no way to bring it back. Interaction-based dismissal
  already covers the "they've seen it" case, so the timer buys nothing.
- This only ever adds a *pill*, never hides or alters what's rendered — it degrades to "no pill"
  silently if `localStorage` is unavailable (Capacitor native webview, private browsing), which
  is an acceptable v1 limitation, not a broken state.

This is flagged as an explicit open product decision in "Open Questions" — a server-tracked "last viewed"
column would be more robust (works across devices, survives cache clears, and could feed manager
analytics like "did the team see the update") but is a larger scope than this design's core fix.

## 4. Empty / Loading / Error States

CLAUDE.md requires all three be handled explicitly; auditing what exists today:

| State | Current | Proposed |
|---|---|---|
| Loading | `EmployeePageSkeleton` (page-level, on `employeeLoading`) + inline `Skeleton` rows in the `Weekly Schedule` card (on `shiftsLoading`) — already present. | Unchanged, but the new publication-status query (§"State Model") must not block the shift skeleton — render the week's day grid skeleton immediately; let the publication banner resolve a beat later from its own (fast, single-row) query, rather than gating the whole page on it. **The banner slot must reserve its space while that query is in flight** — a fixed `min-h-[76px]` placeholder (roughly one `Alert` with a two-line description) at the top of the page. Without it the banner's arrival pushes `MyShiftTradesCard` and everything below it down on an already-painted page: a CLS regression, and on mobile a live mis-tap hazard for anyone who started interacting during that beat. Reserving space only during the fetch would just defer the jump to resolve-time (the placeholder collapsing is a shift too), so state B — the state with no banner — fills the slot with a single-line confirmation chip of the same height: **"Published {date} at {time}"**, `text-[13px] text-muted-foreground`. That makes the slot height constant across every state, and gives the common case a top-of-page answer to "is this final?" instead of nothing. |
| Empty (genuinely zero shifts, any state) | Per-day **"No shifts scheduled"** text only — indistinguishable from "you have the week off" on a published week. | Day-level text unchanged (still correct for a genuinely published week off), but now sits underneath the state A/D banner from §1, which supplies the missing "why." Note that under Decision 1 this row is now *rare* in states A and D — a week with draft shifts renders those shifts as tentative rows rather than as an empty grid, so "empty" here means the manager truly scheduled nobody. |
| Empty (state B/C, employee genuinely has no shifts some days) | Same "No shifts scheduled" | Unchanged — this is a legitimately different case (published week, this employee just isn't on Wednesday) and should not be confused with "not published yet." |
| Error (`useShifts` `error`) | **Not handled at all** — `EmployeeSchedule.tsx` destructures `shifts, loading` from `useShifts` but never reads `error`; a query failure silently renders an empty week, which is actively dangerous here (looks identical to "day off"). | Add an explicit error branch: if `shiftsError`, render an `Alert variant="destructive"` — **"Couldn't load your schedule"** / **"Something went wrong loading shifts. Pull to refresh or try again in a moment."** — in place of the day grid, with a `Button` "Retry" that calls `queryClient.invalidateQueries(['shifts', ...])`. This must not silently fall through to the empty-week UI. |
| Error (new publication-status query) | N/A (doesn't exist yet) | Fails soft — if the publication-status query errors, treat as state A/unknown (don't claim "not published" or "published" with false confidence) and simply omit the banner + "Published on" line, while the shift list itself still renders normally from `useShifts` (which is a separate, independently-erroring query). A silent banner is an acceptable degradation; a wrong banner is not. |

## 5. Accessibility

- **No color-only signaling.** Every state in §1 pairs an icon (`AlertTriangle`, `Clock`) with
  text copy that states the status in words ("not published yet," "pulled back for changes"),
  never relying on the alert's tint alone. The fallback draft treatment in §2 uses a **dashed
  border** (shape, not just color) plus explicit badge text "Draft — not confirmed."
- **aria-live announcements.** The page-level banner container (§1) is wrapped in a persistent
  `<div role="status" aria-live="polite" aria-atomic="true">` that exists on every render (empty
  when there's nothing to say) so that a state transition triggered by data refetch — e.g. the
  employee has the page open when a manager retracts the week mid-session, and `refetchOnMount:
  true` / `refetchOnWindowFocus: true` on `useShifts` pulls the change in — is announced to
  screen reader users without requiring them to re-navigate. The "Updated since you last checked"
  pill from §3 is announced the same way, once, when it first appears.
- **The `Alert` itself must carry `role="status"`, or "polite" is a lie.**
  `src/components/ui/alert.tsx:25` hardcodes `role="alert"` on the primitive — an implicit
  **assertive** live region. Nesting that inside the polite wrapper above does not soften it; the
  inner assertive region is what governs AT behavior, so every banner state would interrupt the
  user mid-sentence. Because `{...props}` is spread *after* the hardcoded attribute on that line,
  passing `role="status"` straight to `<Alert>` overrides it cleanly. **Do that** — override on
  the `Alert`, and drop the redundant outer wrapper for the banner (the wrapper is still the right
  mechanism for the §3 "Updated" pill, which is not an `Alert`). The one deliberate exception is
  state D: a retraction *is* worth interrupting for, so state D keeps the primitive's default
  `role="alert"`.
- **Keyboard reachability.** The banners are static content (no interactive controls beyond the
  "Retry" button in the error state and the "Got it" dismiss on the "Updated" pill, which per §3b
  is always interactive — there is no timed auto-clear) — both existing patterns in the file
  already use `min-h-[44px]` touch/click targets and visible `aria-label`s (`Previous week`,
  `Next week`); any new interactive element in this design must match that convention.
- **Draft status must be announced per row, not just styled.** Under Decision 1 the dashed border
  and muted type are purely visual and convey nothing to a screen reader; the "Draft — not
  confirmed" badge text is the only part of the treatment that carries into the accessibility
  tree. Each draft row must therefore announce its status as part of the row's accessible name —
  the badge text must be real text inside the row (not a `::before`, background image, or
  `aria-hidden` decoration), so a user navigating row-by-row hears "Draft — not confirmed"
  without having to reach the page banner. This is the direct accessibility cost of showing
  drafts instead of hiding them, and it is not optional.
- **The banner is announced first.** The page-level banner in §1 must be the first
  focusable/announced content on the page in states A, C and D (already true structurally since
  it's placed above `MyShiftTradesCard`), not an easily-skipped aside.
- **Not relying on hover.** All new affordances (banner, "Published on" line, "Updated" pill) are
  always-visible on render, never hover-revealed — consistent with mobile-first (§6) where hover
  doesn't exist.

## 6. Mobile-First Considerations

This page is used primarily on phones by restaurant staff, both in mobile Safari/Chrome and
inside the Capacitor-wrapped native app (per
`docs/superpowers/specs/2026-03-28-capacitor-native-employee-app-design.md`).

- **Banner placement survives small viewports.** The state A/C/D banners use the same
  `EmployeeInfoAlert`-style full-width `Alert` pattern already in the file (see the existing
  "Your schedule may change" note at the bottom of the page) — full-width, wraps naturally, no
  fixed width assumptions. Placed above the fold on a typical phone (before the `Weekly Schedule`
  card), so no scrolling is required to see it.
- **"Published on" line must not crowd the week-nav row.** The existing header row
  (`flex flex-col sm:flex-row sm:items-center sm:justify-between`) already stacks vertically
  below `sm:`. The new "Published Aug 1 at 6:42 PM" line goes on its own row beneath the badge on
  mobile, not inline with it — inline would force the date-range badge to wrap awkwardly on
  narrow screens (tested widths: 375px iPhone SE class).
- **Two notification channels, not one.** The Capacitor app has its own native push path
  (`send-push-notification` edge function + device token table, per the Capacitor design doc),
  separate from the existing web-push path (`send-web-push` / `sendWebPushToUser`, used by
  `notify-schedule-published`). Any new "schedule retracted" notification (§7) must fan out
  through **both** channels, or native-app users get silently worse coverage than web-app users —
  this is a real gap risk since the two channels currently live in different edge functions with
  no shared trigger point.
- **Pull-to-refresh expectation.** Native apps train users to pull-to-refresh; the error-state
  Retry button (§4) should not be the *only* recovery path — if the page already wires up
  `refetchOnWindowFocus`/`refetchOnMount` (it does, via `useShifts`), returning to the app from
  background after a manager's change already triggers a refetch, which is the more common real
  recovery path on mobile than a manual button tap.
- **Touch targets.** Any new interactive element (Retry button, optional "Got it" dismiss on the
  Updated pill) must meet the file's existing `min-h-[44px]` convention.

## 7. Notification Copy

Two notifications are currently missing entirely. Both should reuse the existing dual-channel
pattern from `notify-schedule-published/index.ts` (Resend email + web push via
`sendWebPushToUser`) and additionally cover the native push channel per §6.

### (a) Schedule retracted / being revised

Fires when `unpublish_schedule()` runs against a week that had `notification_sent = true` on its
latest `schedule_publications` row (Decision 2), targeting the employees who held published
shifts in the version being retracted (Decision 3). The mechanism that makes this possible is
specified in **Part II §D** — the audience cannot be recomputed after the fact and must be
captured inside the RPC transaction.

The edge function derives *everything* from persisted state given only
`{restaurantId, weekStart}`: it looks up the retraction row, and from there the audience, the
week, and the `notification_sent` gate. **No caller-supplied employee list.** This follows the
existing lesson that notification functions must derive the send decision from the database
rather than the request body — otherwise any authenticated user could POST an arbitrary
recipient list to the function and use it as a mail relay.

**Email**
- Subject: `Schedule update: {weekStart} – {weekEnd} at {restaurant.name} is being revised`
- Body (plain-language, matching the existing template's tone in
  `notify-schedule-published/index.ts`):
  > Hi {employee.name},
  >
  > Your schedule for **{weekStart} – {weekEnd}** at **{restaurant.name}** is being revised by
  > your manager. The version you may have seen is no longer final — please don't rely on it yet.
  >
  > You'll get another notification as soon as the updated schedule is published. If you have
  > questions in the meantime, contact your manager.

**Push** (web + native, same payload shape as `notifySchedulePublishedPush`)
- Title: `Schedule Being Revised`
- Body: `{weekStart}–{weekEnd} is no longer final — your manager is making changes.`
- `url: "/employee/schedule"`, `tag: "schedule-unpublished"` (distinct tag from
  `"schedule-published"` so the two don't clobber each other in the notification tray if both
  fire in a short window).

### (b) Re-published after a change (schedule changed since you last saw it)

This is the recovery half of (a) — when the manager finishes editing and re-publishes, the
existing `notify-schedule-published` fires again as-is (it's not gated on "first time"), but its
copy currently reads identically whether this is the first publish of the week or a republish
after retraction, which undersells "this is different from what you saw before." Propose a small
copy branch inside the existing function based on whether a prior `schedule_publications` row for
the same week already had `notification_sent = true`:

**Email** (branch: `isRepublish`)
- Subject (first publish, unchanged): `New Schedule Published: {weekStart} - {weekEnd}`
- Subject (republish): `Updated Schedule: {weekStart} – {weekEnd} at {restaurant.name} — changes made`
- Body addition for republish (appended after the existing "Your schedule for … has been
  published" paragraph):
  > This is an updated version — some shifts changed since your manager's earlier schedule for
  > this week. Please review your shifts below before your next scheduled shift.

**Push** (branch: `isRepublish`)
- Title (first publish, unchanged): `Schedule Updated`
- Title (republish): `Schedule Updated Again`
- Body (republish): `{weekStart}–{weekEnd} was revised and republished — check what changed.`
- Same `url`/`tag` as today (`"schedule-published"`) — this is intentionally the *same* tag as a
  first publish, so a republish notification correctly replaces/collapses with an earlier
  published-notification still sitting in the tray rather than stacking a duplicate.

## Component-by-Component Breakdown

| File | Change |
|---|---|
| `src/pages/EmployeeSchedule.tsx` | Keep `myShifts` unfiltered (Decision 1); derive `publishedCount`/`draftCount` for banner copy; replace the inline day-grid row JSX (`:368-416`) **and** the Upcoming Shifts card's row JSX (`:252-290`) with the shared `ShiftRow`; neutralize the Upcoming card's green chrome and retitle it "Upcoming (tentative)" when every row in it is a draft (§2); suppress the Trade button on drafts; add error branch on `useShifts().error` (§4); render new `ScheduleStatusBanner` above `MyShiftTradesCard` in a fixed-height slot (§4 layout-shift note); add "Published on …" line + "Updated" pill to the `Weekly Schedule` card header. |
| `src/hooks/useShifts.tsx` | No change — it already fetches all shifts regardless of `is_published`, which Decision 1 requires. (Note: this hook is shared with manager surfaces; adding a publish filter here would have broken them, which is a further reason the filtering lives in the page.) |
| `src/hooks/useSchedulePublish.tsx` | New hook `useWeekScheduleStatus(restaurantId, weekStart, weekEnd)` — wraps a query for the latest `schedule_publications` row matching the week regardless of current shift state (`historicalPublication`), combined with the existing published-shift-count logic, to return the 4-state model from "State Model" above: `{ state: 'not_published' \| 'published' \| 'published_revising' \| 'retracted', publication: SchedulePublication \| null, publishedCount: number, draftCount: number, loading }`. Distinct from the existing `useWeekPublicationStatus`, which stays as-is for the manager side (its `null`-collapsing behavior may be intentional there — manager UI has other cues for "was this ever published"). |
| `src/components/employee/ScheduleStatusBanner.tsx` (new) | Renders the 4 banner variants from §1 given the `useWeekScheduleStatus` result, plus state B's one-line "Published …" chip. Pure presentational, no data fetching. Passes `role="status"` to `Alert` in states A/B/C to override the primitive's hardcoded `role="alert"`; state D keeps the assertive default (§5). Owns the fixed-height slot so the height is constant while loading. |
| `src/components/employee/ShiftRow.tsx` (new) | One row component for both the day grid and the Upcoming Shifts card, parameterized on `{ shift, isPublished, onTrade? }`. Branches internally for the §2 tentative treatment — dashed border, muted type, filled amber "Draft — not confirmed" badge, no Trade button. Badge text must be real in-tree text (§5). Replaces the earlier `DraftShiftRow` proposal, which would have forked confirmed and draft rows into two hand-synced render paths. |
| `src/lib/scheduleSeenFingerprint.ts` (new) | Pure fingerprint + localStorage read/write helpers for the "Updated since you last checked" pill (§3b). Small, unit-testable, no React dependency. |
| `supabase/functions/notify-schedule-unpublished/index.ts` (new) | Sends the retraction email + web push + native push from §7(a). Built on `_shared/notificationHelpers.ts` — **not** modeled on `notify-schedule-published`, which hand-rolls all of it (§C). Takes `{restaurantId, weekStart}` only and derives audience and gate from `schedule_retractions` per §D; claims the `notified_at` latch before sending. |
| `supabase/functions/notify-schedule-published/index.ts` | Add the `isRepublish` branch from §7(b) — check for a prior `notification_sent = true` publication row for the same week before composing subject/body. |
| `supabase/functions/_shared/schedulePublishedPush.ts` | Extend or sibling with a `notifyScheduleUnpublishedPush` helper mirroring `notifySchedulePublishedPush`, for the retraction push payload. |
| `src/hooks/useSchedulePublish.tsx` (`useUnpublishSchedule`) | Invoke `notify-schedule-unpublished` with `{restaurantId, weekStart}` on success, **awaited** and surfaced per §B rather than fire-and-forget. The `notification_sent = true` gate lives in the edge function against persisted state (§D), not here — a client-side gate would be advisory only. Also fix the browser-local week bucketing at `:169-175` to match the RPC's restaurant-timezone bucketing (§F). |
| `tests/unit/scheduleSeenFingerprint.test.ts` (new) | Fingerprint stability (same input → same hash), change detection (any of published_at/shift fields differing → different hash), localStorage-unavailable fallback. |
| `tests/unit/useWeekScheduleStatus.test.ts` (new) | All 4 states derived correctly from mocked `schedule_publications` + shift rows; the specific incident scenario (row exists, `notification_sent: true`, `publishedCount: 0`) resolves to `'retracted'`. |
| `tests/unit/ScheduleStatusBanner.test.tsx` (new) | Correct copy/component per state; state A's two copy variants (`draftCount === 0` vs `> 0`); retracted-state reason line shown only for a non-boilerplate manager reason; `role="status"` in A/B/C and `role="alert"` in D. |
| `tests/unit/ShiftRow.test.tsx` (new) | Draft rows render the badge text and omit the Trade button; published rows render `getShiftStatusBadge` output and keep it. Guards the single-path invariant that replaced `DraftShiftRow`. |
| `tests/e2e/employee-schedule-retraction.spec.ts` (new) | Publish a week as a manager test user, verify employee view shows clean published state; unpublish; verify employee view (same session, on refetch) shows the retracted banner **and** that every shift row is now in the tentative treatment — rows still present per Decision 1, each carrying the "Draft — not confirmed" badge and no Trade button. Asserting zero rows here would encode the rejected hide-drafts alternative. |

---

# Part II — Notification Delivery Defects

Five defects found while debugging the original report ("not all my users get notifications").
All are confirmed against production. **The originally-reported symptom was a false alarm**: the
11 delivered emails the user pasted for Jul 27 – Aug 2 match, one for one, the count of distinct
employees with published shifts for that week at
`restaurant_id = 7c0c76e3-e770-401b-a2a9-c1edd407efed` — a production `SELECT count(DISTINCT
employee_id)` over `shifts` for the week, bucketed in `America/Chicago`, returns 11. Nobody was
missed. (The addresses themselves were not cross-checked against the roster row by row; the claim
is a count match plus the absence of any failure signal, which is sufficient to rule out "some
employees were skipped" but not to prove each specific address was the right one.) The employees
working Aug 3–9 received nothing because that week *was not published* at the time — it had 0
published shifts and 8–14 drafts per day. The real defects are the five below, which the
investigation surfaced.

## A. `notification_sent` is never recorded

`supabase/functions/notify-schedule-published/index.ts:259-262` performs the write with the
**user-scoped** client (`supabase`, built from the anon key at index.ts:33-41), not the
`serviceClient` already constructed and in scope at index.ts:81-84:

```typescript
await supabase
  .from("schedule_publications")
  .update({ notification_sent: true })
  .eq("id", publicationId);
```

`schedule_publications` has exactly two RLS policies — `INSERT` (`Managers can create schedule
publications`) and `SELECT` (`Users can view schedule publications for their restaurants`).
**There is no `UPDATE` policy**, so under RLS this statement matches zero rows. The result is
never destructured or error-checked, so it fails silently. Confirmed: **every** publication row
in production reads `notification_sent = false`, including the one that demonstrably delivered
11 emails.

**Fix:** issue the update via `serviceClient`, check the returned `error`, and log it. Use
`.select('id')` so the row count is observable rather than assumed.

### Scope correction: do *not* add a broad UPDATE policy

The approved scope said "use `serviceClient` **and** add the missing UPDATE RLS policy
migration." Those two are alternatives, not complements, and only the first is correct:

- `serviceClient` uses the service-role key, which **bypasses RLS entirely**. Once the write goes
  through it, an UPDATE policy is not required for the fix to work.
- Adding an UPDATE policy broad enough to satisfy the old code path (i.e. one that lets a manager
  update `schedule_publications`) would let any manager-role client **forge** `notification_sent`
  — and, once Part II §D lands, the retraction state and audience too. That is a net loss of
  integrity for zero functional gain.

**Recommendation: keep `schedule_publications` free of an UPDATE policy.** Every legitimate write
to it comes from a service-role edge function or a `SECURITY DEFINER` RPC, both of which bypass
RLS by design. In place of the policy, add a pgTAP test that *asserts the absence* — that an
`authenticated` client cannot UPDATE the table — which locks in the current correct posture and
fails loudly if someone later adds a permissive policy. This satisfies the "pgTAP for the RLS
change" testing requirement by pinning the invariant rather than by widening access.

**The test must assert zero affected rows, not an exception.** RLS with no matching policy does
not raise — it silently filters, which is the entire mechanism behind this defect. A `throws_ok`
assertion would fail against correct behavior and pass only if someone later added a policy that
errors. Assert the row count instead:

```sql
SET LOCAL ROLE authenticated;
WITH attempted AS (
  UPDATE public.schedule_publications SET notification_sent = true
   WHERE id = <fixture id> RETURNING 1
)
SELECT is((SELECT count(*)::int FROM attempted), 0,
          'authenticated role cannot UPDATE schedule_publications');
```

Flagged for the user at plan approval; if a policy is wanted anyway, the narrow form is
`FOR UPDATE USING (false) WITH CHECK (false)`, which documents intent without granting anything.

## B. Send failures are invisible

Two independent layers swallow failures:

- `supabase/functions/notify-schedule-published/index.ts:241-244` computes `successCount` /
  `failureCount`, then returns **HTTP 200** with them in the body (index.ts:269-280) regardless of
  how many failed. A run where every single email failed is indistinguishable, at the HTTP layer,
  from a fully successful one.
- `src/hooks/useSchedulePublish.tsx:71-87` invokes the function **fire-and-forget** — the promise
  is not awaited into the mutation result, and both branches only `console.error` / `console.log`.
  The publishing manager sees an unconditional success toast.

**Fix:** return a non-2xx status when `failureCount > 0` (partial failure included), per the
existing lesson that edge functions should use real HTTP codes instead of a 200-with-error-body
workaround. On the client, await the invoke and read `error.context.json()` for the structured
body, then surface a distinct toast: full success, partial ("Published — but N of M
notifications failed to send"), or total failure. **Publishing must still succeed** even if
notification fails — the RPC has already committed by then, so the toast must never imply the
schedule wasn't published.

## C. The Resend fan-out is unthrottled

`supabase/functions/notify-schedule-published/index.ts:154-238` builds one promise per recipient
and fires them all at once via `Promise.allSettled` (index.ts:238). Resend's default rate limit is
**2 requests/second**. Eleven recipients happened to get through; a 25-person roster very likely
will not, and the resulting 429s are invisible because of defect B.

**Fix:** send through a small concurrency-limited queue with a paced interval (≤2/s), and treat a
429 as retryable with backoff rather than as a terminal failure. Keep the per-recipient result
shape so defect B's reporting still works. This is a shared helper — both this function and the
new one in §D need it — so it belongs in `supabase/functions/_shared/`.

**The pacing fits inside the edge-function budget; here is the actual ceiling.** CLAUDE.md warns
that edge functions have a strict CPU limit (~10s), which at first glance looks incompatible with
deliberately slowing a fan-out down. It isn't, for two reasons, and both were checked rather than
assumed:

- **Size.** Queried against production: the largest active roster with an email address is **25**
  employees (p95 = 25, median = 2, across 10 restaurants; exactly one is above 20). So the worst
  real case today is 25 emails, and 25 at 2/s is ~12.5 s of wall time.
- **Kind of time.** That 12.5 s is `await`ed idle wall time — the isolate is parked on a timer and
  a `fetch`, consuming no CPU. The ~10 s ceiling that CLAUDE.md's Toast notes are about is a
  **CPU** budget, exhausted by per-row work in a tight loop, not by waiting. The relevant limit
  for waiting is the request wall-clock timeout, which is far larger.

The design is therefore safe at present scale, but the bound is worth stating because it is not
open-ended: at ~2/s, any roster beyond roughly a few hundred would start pressing the wall-clock
timeout, and the answer then is a queue/cron drain rather than a faster loop. The rate limiter
should log the recipient count and total elapsed time so that ceiling is observable before it is
hit, rather than discovered as a timeout.

### Build on the existing notification toolkit, don't clone the hand-rolled one

`supabase/functions/_shared/notificationHelpers.ts` (308 lines) already provides
`sendEmail` (:159), `getEmployeeEmails` (:66), `getAllActiveEmployeeEmails` (:90),
`shouldSendNotification` (:135), `verifyRestaurantPermission` (:208), `NOTIFICATION_FROM` (:197),
`APP_URL` (:202), `corsHeaders` (:229), `handleCorsPreflightRequest` (:237),
`createAuthenticatedClient` (:244), `authenticateRequest` (:266), `errorResponse` (:287) and
`successResponse` (:300).

`notify-schedule-published` uses **none of them** — it hand-rolls its own client construction
(index.ts:33-41), permission check (index.ts:57-66), Resend `fetch` (index.ts:219-226) and
response shaping (index.ts:269-291). The first draft of this document said to model the new
`notify-schedule-unpublished` "directly on `notify-schedule-published`'s structure," which would
propagate that duplication. **Superseded:** the new function is built on the shared helpers.
Refactoring the existing publish function onto them is *not* in scope — it is noted as a
follow-up so this change stays reviewable.

**One blocker for reuse.** `sendEmail` returns a bare `boolean` (:159-192) — it catches the error
text and the HTTP status and discards both (:181-185). A 429 is therefore indistinguishable from
a hard bounce, which is exactly the distinction §C's backoff needs, and §B needs the error detail
to report partial failure meaningfully.

It has **6 call sites outside its own module** (`bank-reauth-notices`, `broadcast-open-shifts`,
`notify-availability-reminder`, `notify-open-shift-claim`, `_shared/availabilityReminderHandler`,
`_shared/bankReauthNoticesHandler`), so changing its return type is a breaking change well beyond
this task's scope. **Approach: add a sibling `sendEmailResult()` returning
`{ ok: boolean; status: number; error?: string }`, and reimplement the existing `sendEmail` as a
one-line wrapper (`(await sendEmailResult(...)).ok`).** Existing callers are untouched and their
behavior is provably identical; the rate limiter consumes the structured version.

## D. Retraction notifies nobody — and the audience must be persisted

There is no `notify-schedule-unpublished` function; `useUnpublishSchedule`
(`src/hooks/useSchedulePublish.tsx:111-152`) invokes nothing at all. On Aug 2 a manager
unpublished 63 live shifts for the already-announced week of Aug 3–9 and no employee was told.

**The mechanical problem Decision 3 creates.** `unpublish_schedule()` sets `is_published = false`
on every shift in the week (`20260729120000_publish_schedule_tz_bucketing.sql:170-179`). So by the
time any edge function runs *after* the RPC, the set of "employees who had published shifts in the
retracted version" **no longer exists anywhere**. It cannot be recomputed. And per the lesson that
notification functions must derive their decision from persisted DB state, it must *not* be passed
in from the client — a caller-supplied recipient list turns the function into an open mail relay.

**Therefore the audience must be captured inside the RPC transaction and persisted.** New table:

```sql
CREATE TABLE public.schedule_retractions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id   UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  publication_id  UUID REFERENCES public.schedule_publications(id) ON DELETE SET NULL,
  week_start_date DATE NOT NULL,
  week_end_date   DATE NOT NULL,
  employee_ids    UUID[] NOT NULL DEFAULT '{}',   -- audience snapshot, captured pre-flip
  shift_count     INTEGER NOT NULL DEFAULT 0,
  retracted_by    UUID,
  retracted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  notified_at     TIMESTAMPTZ                      -- idempotency latch
);

CREATE INDEX idx_schedule_retractions_lookup
  ON public.schedule_retractions (restaurant_id, week_start_date, retracted_at DESC)
  WHERE notified_at IS NULL;
```

The partial index matches the §D step-1 lookup exactly (unnotified rows for a week, newest first).

A separate table rather than columns on `schedule_publications`, because a week can cycle
publish → retract → publish → retract, and each retraction needs its own audience snapshot and
its own `notified_at` latch.

`unpublish_schedule` gains, inside its existing transaction, a data-modifying CTE that captures
the affected rows' distinct `employee_id`s from the `UPDATE ... RETURNING` **before** the flip is
externally observable. **Its `RETURNS INTEGER` signature is unchanged** — deliberately, since
`CREATE OR REPLACE` cannot alter a return type and a `DROP`/recreate would risk the known hazard
of a later-merged migration silently reverting it. The client therefore keeps calling it exactly
as today.

Two implementation hazards, both of which break *existing* behavior if handled naively:

**(i) `GET DIAGNOSTICS` must be removed, not kept.** The current function derives `v_shift_count`
via `GET DIAGNOSTICS v_shift_count = ROW_COUNT` immediately after the plain UPDATE
(`20260729120000_publish_schedule_tz_bucketing.sql:182`). Once the UPDATE is wrapped in a CTE
feeding an INSERT, `GET DIAGNOSTICS` reports the **INSERT's** row count (1), not the number of
shifts unpublished. That value is returned to the caller and rendered directly in the manager's
toast at `src/hooks/useSchedulePublish.tsx:141` — a 63-shift unpublish would silently report
"1 shift". Derive both values from the CTE instead:

```sql
WITH updated_shifts AS (
  UPDATE public.shifts s
     SET is_published = false, locked = false, published_at = NULL, published_by = NULL
   WHERE s.restaurant_id = p_restaurant_id
     AND (s.start_time AT TIME ZONE v_tz)::date >= p_week_start
     AND (s.start_time AT TIME ZONE v_tz)::date <= p_week_end
     AND s.is_published = true
  RETURNING s.employee_id
)
SELECT count(*), COALESCE(array_agg(DISTINCT employee_id) FILTER (WHERE employee_id IS NOT NULL), '{}')
  INTO v_shift_count, v_employee_ids
  FROM updated_shifts;
```

Note `array_agg` over zero rows yields `NULL`, not `'{}'` — hence the `COALESCE`. The
`FILTER` guards against open shifts, whose `employee_id` is nullable.

**(ii) The retraction INSERT must be guarded on `v_shift_count > 0`.** Unpublishing a week that
has no currently-published shifts is routine — a double-click, or unpublishing an
already-retracted week. Inserting an empty retraction row would (a) violate `NOT NULL` if the
`COALESCE` above were omitted, aborting the entire unpublish transaction, and (b) even with the
`COALESCE`, create a meaningless retraction with an empty audience that the edge function would
then have to special-case. Wrap the INSERT in `IF v_shift_count > 0 THEN ... END IF;`.

The publication link resolves to the latest row for `(restaurant_id, week_start_date)` —
`ORDER BY published_at DESC LIMIT 1`, never `.single()`, per the production facts recorded in
Part I.

The edge function is invoked with `{restaurantId, weekStart}` only, and derives everything else:

1. Load the latest unnotified `schedule_retractions` row for the week —
   `WHERE notified_at IS NULL ORDER BY retracted_at DESC LIMIT 1`. Retractions accumulate per
   week across publish→retract cycles, so this must be ordered and limited, never `.single()`.
2. `LEFT JOIN` its `publication_id` and **abort unless `notification_sent = true`** (Decision 2).
   The join must be null-safe: `publication_id` is `ON DELETE SET NULL`, so a NULL publication is
   a legitimate state and must be treated as "abort", not allowed to throw.
3. **Atomically claim the row before sending** (see below).
4. Send to `employee_ids` (Decision 3), through the §C rate limiter.

**The latch must be claimed before the send, not stamped after it.** Load-check-send-then-stamp
is not race-safe: two concurrent invokes (a retry after a network hiccup, a double-tap) can both
pass the gate before either stamps, and every employee gets the retraction twice. Claim it with a
conditional update and only proceed if a row comes back:

```sql
UPDATE public.schedule_retractions
   SET notified_at = now()
 WHERE id = $1 AND notified_at IS NULL
RETURNING *;
```

Zero rows returned means another invocation already owns this retraction — exit quietly. If the
send subsequently fails outright, reset `notified_at` back to `NULL` so a retry can still fire.

**Known limitation, stated plainly:** because defect A means *every* production publication row
currently reads `notification_sent = false`, the Decision 2 gate will suppress **all** retraction
notifications until a week is published *after* this change ships. That is the correct
conservative behavior — for those historical rows we genuinely cannot tell whether employees were
emailed — and it self-heals on the next publish. No backfill is proposed: setting
`notification_sent = true` retroactively would be asserting a delivery we cannot verify, and would
be a production write requiring separate explicit approval.

## E. Employees cannot distinguish draft from published

`src/hooks/useShifts.tsx:48-80` selects shifts with no `is_published` predicate, and the `shifts`
SELECT policy is plain restaurant membership (`EXISTS (SELECT 1 FROM user_restaurants WHERE
restaurant_id = shifts.restaurant_id AND user_id = auth.uid())`) — so every employee can read
every draft. `src/pages/EmployeeSchedule.tsx` never references `is_published`.

This is **Part I** of this document. No RLS change is proposed: Decision 1 requires employees to
*see* drafts, so restricting the read path would defeat the chosen design. The distinction is made
in the UI, per Part I §1/§2.

## F. Manager "Published" badge disagrees with what publish actually did

`src/hooks/useSchedulePublish.tsx:169-175` counts published shifts using browser-local instants:

```typescript
.gte('start_time', weekStart.toISOString())
.lte('start_time', weekEnd.toISOString())
```

while the RPC buckets by restaurant-local calendar day
(`(s.start_time AT TIME ZONE v_tz)::date`, `20260729120000_publish_schedule_tz_bucketing.sql:101-102`).
For a manager whose browser timezone differs from the restaurant's, the two disagree at week
edges — the badge can read "not published" for a week that was published, or vice versa.

**Fix:** bucket the count the same way the RPC does, using the restaurant's IANA timezone via the
existing `fromZonedTime` approach already used in `notify-schedule-published/index.ts:110-116`.
This is the same class of bug as the recently-merged `publish_schedule` timezone fix, in the read
path rather than the write path.

## Part II — Files

| File | Change |
|---|---|
| `supabase/migrations/20260802120000_schedule_retractions.sql` (new) | `schedule_retractions` table + RLS (SELECT for restaurant members; no INSERT/UPDATE policy — writes come only from the `SECURITY DEFINER` RPC and service role); `CREATE OR REPLACE unpublish_schedule` re-declared **in full** carrying forward `SECURITY DEFINER`, `SET search_path = public, pg_temp`, and the existing `user_has_restaurant_access` guard, plus the audience-capturing CTE. Signature unchanged. |
| `supabase/functions/_shared/rateLimitedSend.ts` (new) | Paced, concurrency-limited sender with 429 backoff (§C). Consumes `sendEmailResult`. Shared by both notify functions. |
| `supabase/functions/_shared/notificationHelpers.ts` | Add `sendEmailResult()` returning `{ ok, status, error? }`; reimplement existing `sendEmail` as a wrapper over it. Purely additive — the 6 existing call sites keep identical behavior. |
| `supabase/functions/notify-schedule-published/index.ts` | §A `serviceClient` + error check; §B non-2xx on partial failure; §C route sends through the limiter. (Not refactored onto the shared helpers — out of scope, noted as follow-up.) |
| `supabase/functions/notify-schedule-unpublished/index.ts` (new) | §D. Built on `notificationHelpers`, not cloned from the publish function. Derives audience and gate entirely from `schedule_retractions` + `schedule_publications`; idempotent via `notified_at`. |
| `src/hooks/useSchedulePublish.tsx` | §B await the invoke and surface partial/total failure; §D invoke the new function from `useUnpublishSchedule`; §F timezone-correct published-shift count. |
| `supabase/tests/schedule_retractions.test.sql` (new) | pgTAP: audience snapshot captured correctly; `notified_at` latch; `authenticated` cannot UPDATE `schedule_publications` (§A) or write `schedule_retractions`; cross-tenant access denied. |
| `tests/unit/rateLimitedSend.test.ts` (new) | Pacing, 429 retry/backoff, per-recipient result shape preserved. |
| `tests/unit/useWeekScheduleStatus.test.ts` (new) | Part I 4-state model; plus §F timezone bucketing at week edges. |

## Open Questions / Product Decisions

Questions 1–3 of the original draft are **resolved** — see "Recorded Product Decisions" at the top.
The remainder stay open and are explicitly *not* being built in this pass:

1. **Server-tracked "last viewed" vs. client-side fingerprint (§3b).** The localStorage approach
   is cheap and ships fast but is per-device and invisible to managers. Is manager-visible
   "did the team see this" reporting a real near-term need? If yes, this should be a
   `schedule_views` table from the start rather than a client-only stopgap that gets thrown away
   later.
2. **Reason surfacing in the retracted banner (§1, State D).** `schedule_change_logs.reason` is
   optional and today defaults to an auto-generated, not-manager-authored string when the manager
   doesn't supply one. Should the unpublish UI (manager side, out of scope for this doc but
   adjacent) be changed to *require* a reason when unpublishing an already-notified week, so the
   employee-facing banner always has something meaningful to show instead of silently omitting
   the reason line?
3. **Partial-publish threshold for state C.** Is "any draft shift alongside any published shift
   for this employee this week" the right bar for showing the amber "being finalized" banner, or
   should it only fire once draft shifts cross some materiality threshold (e.g., a single
   draft note-only change vs. a genuinely new unconfirmed shift)? This design treats all drafts
   equally for simplicity; may need refinement once real data volume is seen.
4. **Capacitor native push wiring (§6, §7).** Native push currently has no equivalent trigger
   point wired to the publish/unpublish mutations — confirm whether `send-push-notification`
   (native) should be called from the same new `notify-schedule-unpublished` function (server-side
   fan-out) or requires a separate client-triggered call, matching whatever pattern the existing
   native shift-created/time-off notifications already use (not audited in this pass — worth a
   quick check before implementation).

---

## As Built — where the shipped code departs from this document

This design was written before implementation and is kept as the record of what was intended.
Where the build learned something the design got wrong, the code is authoritative and the
divergence is listed here rather than edited into the sections above.

1. **State D no longer fires on zero shifts (§1, §2).** The design's condition — a historical
   publication plus zero live published shifts — classifies an employee with *no shifts at all*
   as "retracted". Unpublishing flips shifts to draft, it never deletes them, so a real retraction
   always leaves drafts behind. `deriveWeekScheduleState` therefore returns `published` when both
   counts are zero: that employee simply isn't on the roster this week. Without it, every
   part-timer would be told their schedule was withdrawn on every week they have off.
   Pinned by a test in `tests/unit/useWeekScheduleStatus.test.ts`.

2. **A failed publication query renders no banner (§4).** The design maps the error case onto
   `not_published`, which asserts something false. `deriveWeekScheduleState` returns `null` while
   loading or on error, and the banner's fixed-height slot stays empty. Shift rendering is
   unaffected.

3. **Paths.** The paced sender shipped as `supabase/functions/_shared/emailQueue.ts` (tests in
   `tests/unit/emailQueue.test.ts`), not `rateLimitedSend.ts`. The pgTAP file is
   `supabase/tests/schedule_retractions.test.sql`.

4. **Retry bound (§ paced sender).** Retries are 429-only, capped at 3 after the initial attempt,
   with 1s/2s/3s backoff; anything else — including a request aborted at the 15s per-request
   timeout — fails terminally at status 0 rather than retrying. Covered by "gives up after
   maxRetries and reports the last 429" and "aborts a request Resend accepts but never answers".

5. **`notification_sent` means "reached somebody", not "reached everybody".** The design left this
   ambiguous. A partial failure still marks the week announced, because the retraction gate's job
   is to avoid announcing the withdrawal of something *nobody* heard about; the manager's failure
   toast is what prompts a republish, and republishing writes a fresh row. Reaching nobody on
   either channel leaves the flag false.

6. **`notified_at` is a whole-retraction latch, not per-recipient.** Recipient-level delivery
   state would need its own table. Partial failure is logged and returned in the response; the
   latch still claims, so a retry does not re-mail the recipients who succeeded. Accepted
   limitation, not an oversight.

7. **Only the newest retraction for a week can ever be announced.** The notifier selects the
   latest row for the week outright — `notified_at` is checked *after* the ordering, not folded
   into it — so older rows are permanently audit-only whether or not they were ever mailed. The
   ordering matters: filtering on `notified_at IS NULL` first picks the newest *unnotified* row,
   which is a different row. Retract twice in quick succession and a retry would find the older,
   still-unlatched row and announce a version that was superseded before anyone heard of it.
   Sending one message per revision is the confusion this change set exists to remove.

8. **The fingerprint keys on `published_at` plus shift fields (§3b), not `is_published`.** A
   retraction changes the banner, which is far louder than the pill; the pill's job is to catch
   *silent* edits inside an already-published week.

9. **Open question 4 (native push) is resolved.** `notify-schedule-unpublished` calls
   `send-push-notification` server-side with the service-role key, matching the existing
   web-push fan-out. No client-triggered path.

10. **The notifier authenticates before it claims (§7a's flow sketch omits this).** The sketch
    goes straight from request to row lookup. The shipped function runs `authenticateRequest`
    and then `verifyRestaurantPermission` for the caller against `restaurantId` *before* it
    touches `schedule_retractions`, so an unauthenticated or non-manager request cannot burn the
    `notified_at` latch and silence a real retraction. It follows the repo's standard edge
    ordering: CORS → auth → permission → business logic.

11. **`employee_ids` is readable by restaurant members, and that is not new exposure.** The
    SELECT policy scopes rows to `user_restaurants` membership, the same boundary `shifts`
    already uses — any member can already read every shift in the restaurant, employee ids
    included, so the snapshot column reveals nothing the roster didn't. The protections that
    matter are the ones on writes: no INSERT/UPDATE/DELETE grant and no UPDATE policy, both
    pinned by `supabase/tests/schedule_retractions.test.sql`, so a client cannot rewrite the
    audience or pre-claim `notified_at`. Narrowing reads to a self-scoped function would be
    real work with no attacker benefit until `shifts` is narrowed first.

12. **`notified_at` doubles as claim and completion; the reclaim is `release()`, not a token.**
    A crash between the claim and the send would strand the row latched. The function nulls
    `notified_at` back on every early return it controls, which covers the paths that actually
    occur; a hard kill mid-send still strands it. Claim tokens with expiry would fix the
    remaining window and are deliberately out of scope — the failure mode is one missed
    retraction notice on a function crash, and the next republish writes a fresh row.

13. **Delivery is client-invoked, not a durable outbox.** `useUnpublishSchedule` invokes the
    function after the RPC commits, so a browser closed in that beat means the retraction is
    never announced. A transactional outbox drained by cron is the correct shape and is out of
    scope here; the persisted `schedule_retractions` row means the work is recoverable when
    that lands, rather than lost. The publish path has the same shape today.
