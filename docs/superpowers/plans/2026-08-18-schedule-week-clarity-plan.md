# Employee schedule week clarity implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Answer "am I working?" on `/employee/schedule` without a week boundary, and show the draft hue only when it carries a meaning.

**Architecture:** Four pure functions in `src/lib/` hold every rule. One bounded React Query hook reads `schedule_publications`. One new card renders the anchor. `EmployeeSchedule.tsx` wires them behind a single PostHog flag, and keeps the current page as the default.

**Tech Stack:** React 18, TypeScript, Vite, React Query, date-fns, shadcn/ui, Tailwind, PostHog (`posthog-js` 1.275.1), Vitest.

**Design doc:** `docs/superpowers/specs/2026-08-18-schedule-week-clarity-design.md`

## Global constraints

- Write every comment in ASD-STE100. See `docs/STE100_STYLE.md`.
- Use semantic Tailwind tokens only. Never `bg-white` or `text-black`.
- Handle the loading, error, and empty state in every component.
- Never compute a week start from `new Date()` in the host timezone. Always pass the restaurant IANA timezone.
- The flag key is `employee_schedule_clarity`. It is one key for the whole page treatment.
- When the flag is off, or PostHog is unconfigured, the page must render exactly as it does today.
- Do not delete `upcomingShifts` or `allUpcomingAreDrafts`. The flag keeps both paths alive.
- Do not change `src/hooks/useSchedulePublish.tsx`. A parallel branch owns that file.
- Never send a restaurant name to PostHog. Send the restaurant id only.
- Stage explicit paths in every commit. Never `git add -A`, `git add .`, or `git commit -a`.
- End every commit message with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

---

## File structure

| File | Responsibility |
|---|---|
| `src/lib/scheduleWeek.ts` | The restaurant-timezone week start, and the relative week label |
| `src/lib/nextShift.ts` | Pick the upcoming shifts, and count the shifts in a week |
| `src/lib/schedulePublisher.ts` | Decide whether a restaurant publishes |
| `src/hooks/useRestaurantPublishes.tsx` | The bounded `schedule_publications` read |
| `src/components/employee/NextShiftCard.tsx` | The anchor view |
| `src/components/employee/ShiftRow.tsx` | Gate the draft treatment on a new prop |
| `src/contexts/RestaurantContext.tsx` | Send the restaurant group to PostHog |
| `src/pages/EmployeeSchedule.tsx` | Wire every unit behind the flag |

---

### Task 1: The restaurant week start and the relative label

**Files:**
- Create: `src/lib/scheduleWeek.ts`
- Test: `tests/unit/scheduleWeek.test.ts`

**Interfaces:**
- Consumes: `WEEK_STARTS_ON` from `src/lib/dateConfig.ts`, `formatLocalDateInTz` from `src/lib/shiftInterval.ts`.
- Produces:
  - `getRestaurantWeekStart(now: Date, tz: string): Date`
  - `getRelativeWeekLabel(viewedWeekStart: Date, now: Date, tz: string): string`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/scheduleWeek.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { getRestaurantWeekStart, getRelativeWeekLabel } from '@/lib/scheduleWeek';

const NY = 'America/New_York';

describe('getRestaurantWeekStart', () => {
  it('returns the Monday of the restaurant week', () => {
    const now = new Date('2026-08-19T16:00:00Z');
    expect(getRestaurantWeekStart(now, NY)).toEqual(new Date(2026, 7, 17));
  });

  it('uses the restaurant day, not the UTC day', () => {
    // 02:00 UTC on Monday is 22:00 Sunday in New York, so the restaurant
    // week has not turned over yet.
    const now = new Date('2026-08-17T02:00:00Z');
    expect(getRestaurantWeekStart(now, NY)).toEqual(new Date(2026, 7, 10));
    expect(getRestaurantWeekStart(now, 'UTC')).toEqual(new Date(2026, 7, 17));
  });
});

describe('getRelativeWeekLabel', () => {
  const now = new Date('2026-08-19T16:00:00Z');

  it('labels the current week', () => {
    expect(getRelativeWeekLabel(new Date(2026, 7, 17), now, NY)).toBe('This week');
  });

  it('labels the next week', () => {
    expect(getRelativeWeekLabel(new Date(2026, 7, 24), now, NY)).toBe('Next week');
  });

  it('labels the previous week', () => {
    expect(getRelativeWeekLabel(new Date(2026, 7, 10), now, NY)).toBe('Last week');
  });

  it('labels a week further ahead', () => {
    expect(getRelativeWeekLabel(new Date(2026, 8, 7), now, NY)).toBe('In 3 weeks');
  });

  it('labels a week further back', () => {
    expect(getRelativeWeekLabel(new Date(2026, 6, 27), now, NY)).toBe('3 weeks ago');
  });

  it('labels the current week from the restaurant day, not the UTC day', () => {
    const sundayNight = new Date('2026-08-17T02:00:00Z');
    expect(getRelativeWeekLabel(new Date(2026, 7, 10), sundayNight, NY)).toBe('This week');
  });
});
```

- [ ] **Step 2: Run the test to check that it fails**

Run: `npx vitest run tests/unit/scheduleWeek.test.ts`
Expected: FAIL with `Failed to resolve import "@/lib/scheduleWeek"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/scheduleWeek.ts`:

```ts
import { startOfWeek, differenceInCalendarWeeks } from 'date-fns';
import { WEEK_STARTS_ON } from '@/lib/dateConfig';
import { formatLocalDateInTz } from '@/lib/shiftInterval';

/**
 * Turn a `YYYY-MM-DD` string into a floating local date at midnight.
 *
 * `startOfWeek` reads `getDay()`, which is host-local. A floating date keeps
 * the day of the week that the string names, whatever the host timezone is.
 */
function civilDate(dateStr: string): Date {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day);
}

/**
 * The Monday of the week that today falls in, in the restaurant timezone.
 *
 * Warning: never call `startOfWeek(new Date(), ...)` for this. A host-timezone
 * week start caused a $2,246 wage error. See `memory/lessons.md:272`.
 */
export function getRestaurantWeekStart(now: Date, tz: string): Date {
  return startOfWeek(civilDate(formatLocalDateInTz(now, tz)), {
    weekStartsOn: WEEK_STARTS_ON,
  });
}

/** State the viewed week as a position, not as a date range. */
export function getRelativeWeekLabel(viewedWeekStart: Date, now: Date, tz: string): string {
  const currentWeekStart = getRestaurantWeekStart(now, tz);
  const offset = differenceInCalendarWeeks(viewedWeekStart, currentWeekStart, {
    weekStartsOn: WEEK_STARTS_ON,
  });

  if (offset === 0) return 'This week';
  if (offset === 1) return 'Next week';
  if (offset === -1) return 'Last week';
  if (offset > 1) return `In ${offset} weeks`;
  return `${Math.abs(offset)} weeks ago`;
}
```

- [ ] **Step 4: Run the test to check that it passes**

Run: `npx vitest run tests/unit/scheduleWeek.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/scheduleWeek.ts tests/unit/scheduleWeek.test.ts
git commit -m "feat(scheduling): add the restaurant week start and the relative label"
```

---

### Task 2: Pick the upcoming shifts

**Files:**
- Create: `src/lib/nextShift.ts`
- Test: `tests/unit/nextShift.test.ts`

**Interfaces:**
- Consumes: `Shift` from `src/types/scheduling.ts`.
- Produces:
  - `selectUpcomingShifts(shifts: Shift[], now: Date, limit?: number): Shift[]`. The first element is the next shift.
  - `countShiftsInWeek(shifts: Shift[], weekStart: Date, tz: string): number`. The footer row and the chevron dot read this.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/nextShift.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { selectUpcomingShifts, countShiftsInWeek } from '@/lib/nextShift';
import type { Shift } from '@/types/scheduling';

const NY = 'America/New_York';

function shift(id: string, start: string, end: string, status = 'scheduled'): Shift {
  return { id, start_time: start, end_time: end, status } as Shift;
}

const NOW = new Date('2026-08-19T16:00:00Z');

describe('selectUpcomingShifts', () => {
  it('returns an empty list when no shift is upcoming', () => {
    const past = shift('a', '2026-08-18T12:00:00Z', '2026-08-18T20:00:00Z');
    expect(selectUpcomingShifts([past], NOW)).toEqual([]);
  });

  it('returns the soonest shift first', () => {
    const later = shift('b', '2026-08-22T12:00:00Z', '2026-08-22T20:00:00Z');
    const sooner = shift('c', '2026-08-20T12:00:00Z', '2026-08-20T20:00:00Z');
    const result = selectUpcomingShifts([later, sooner], NOW);
    expect(result.map((s) => s.id)).toEqual(['c', 'b']);
  });

  it('keeps a shift that is in progress', () => {
    const running = shift('d', '2026-08-19T12:00:00Z', '2026-08-19T20:00:00Z');
    expect(selectUpcomingShifts([running], NOW).map((s) => s.id)).toEqual(['d']);
  });

  it('skips a cancelled shift', () => {
    const cancelled = shift('e', '2026-08-20T12:00:00Z', '2026-08-20T20:00:00Z', 'cancelled');
    expect(selectUpcomingShifts([cancelled], NOW)).toEqual([]);
  });

  it('keeps a draft shift', () => {
    const draft = { ...shift('f', '2026-08-20T12:00:00Z', '2026-08-20T20:00:00Z'), is_published: false } as Shift;
    expect(selectUpcomingShifts([draft], NOW).map((s) => s.id)).toEqual(['f']);
  });

  it('respects the limit', () => {
    const many = [1, 2, 3, 4, 5, 6, 7].map((n) =>
      shift(`s${n}`, `2026-08-2${n}T12:00:00Z`, `2026-08-2${n}T20:00:00Z`)
    );
    expect(selectUpcomingShifts(many, NOW, 5)).toHaveLength(5);
  });
});

describe('countShiftsInWeek', () => {
  const nextWeekStart = new Date(2026, 7, 24);

  it('counts a shift inside the week', () => {
    const inside = shift('a', '2026-08-26T16:00:00Z', '2026-08-27T00:00:00Z');
    expect(countShiftsInWeek([inside], nextWeekStart, NY)).toBe(1);
  });

  it('skips a shift before the week', () => {
    const before = shift('b', '2026-08-21T16:00:00Z', '2026-08-22T00:00:00Z');
    expect(countShiftsInWeek([before], nextWeekStart, NY)).toBe(0);
  });

  it('skips a shift after the week', () => {
    const after = shift('c', '2026-09-01T16:00:00Z', '2026-09-02T00:00:00Z');
    expect(countShiftsInWeek([after], nextWeekStart, NY)).toBe(0);
  });

  it('counts by the restaurant day, not the UTC day', () => {
    // 01:00 UTC on Monday is 21:00 Sunday in New York, so the shift belongs
    // to the week that ends, not to the week that starts.
    const sundayNight = shift('d', '2026-08-24T01:00:00Z', '2026-08-24T05:00:00Z');
    expect(countShiftsInWeek([sundayNight], nextWeekStart, NY)).toBe(0);
    expect(countShiftsInWeek([sundayNight], nextWeekStart, 'UTC')).toBe(1);
  });

  it('skips a cancelled shift', () => {
    const cancelled = shift('e', '2026-08-26T16:00:00Z', '2026-08-27T00:00:00Z', 'cancelled');
    expect(countShiftsInWeek([cancelled], nextWeekStart, NY)).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to check that it fails**

Run: `npx vitest run tests/unit/nextShift.test.ts`
Expected: FAIL with `Failed to resolve import "@/lib/nextShift"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/nextShift.ts`:

```ts
import { addDays } from 'date-fns';
import { formatLocalDate, formatLocalDateInTz } from '@/lib/shiftInterval';
import type { Shift } from '@/types/scheduling';

/**
 * The shifts the employee still has to work, soonest first.
 *
 * A shift that has started but not ended stays in the list. The employee is
 * at work, and the anchor must agree with that.
 *
 * The publish state is not a filter. A draft shift is a shift.
 */
export function selectUpcomingShifts(shifts: Shift[], now: Date, limit = 5): Shift[] {
  return shifts
    .filter((s) => s.status !== 'cancelled' && new Date(s.end_time) > now)
    .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime())
    .slice(0, limit);
}

/**
 * How many shifts fall in one week, on the restaurant calendar.
 *
 * The bucket comes from `start_time` in the restaurant timezone. A shift that
 * starts at 21:00 on a Sunday belongs to the week that ends, even when the
 * viewer sits in a timezone where the clock already reads Monday.
 */
export function countShiftsInWeek(shifts: Shift[], weekStart: Date, tz: string): number {
  const firstDay = formatLocalDate(weekStart);
  const lastDay = formatLocalDate(addDays(weekStart, 6));

  return shifts.filter((s) => {
    if (s.status === 'cancelled') return false;
    const day = formatLocalDateInTz(new Date(s.start_time), tz);
    return day >= firstDay && day <= lastDay;
  }).length;
}
```

- [ ] **Step 4: Run the test to check that it passes**

Run: `npx vitest run tests/unit/nextShift.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/nextShift.ts tests/unit/nextShift.test.ts
git commit -m "feat(scheduling): add the upcoming shift selection and the week count"
```

---

### Task 3: Decide whether a restaurant publishes

**Files:**
- Create: `src/lib/schedulePublisher.ts`
- Test: `tests/unit/schedulePublisher.test.ts`

**Interfaces:**
- Consumes: `getRestaurantWeekStart` from Task 1.
- Produces:
  - `publishWindowStart(now: Date, tz: string): string` — a `YYYY-MM-DD` string, for the query bound.
  - `isPublishingRestaurant(publications: PublicationWeek[], now: Date, tz: string): boolean`
  - `interface PublicationWeek { week_start_date: string }`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/schedulePublisher.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { isPublishingRestaurant, publishWindowStart } from '@/lib/schedulePublisher';

const NY = 'America/New_York';
const NOW = new Date('2026-08-19T16:00:00Z');

describe('publishWindowStart', () => {
  it('returns 8 days before the current week start', () => {
    expect(publishWindowStart(NOW, NY)).toBe('2026-08-09');
  });
});

describe('isPublishingRestaurant', () => {
  it('returns false for an empty list', () => {
    expect(isPublishingRestaurant([], NOW, NY)).toBe(false);
  });

  it('returns true when the current week is published', () => {
    expect(isPublishingRestaurant([{ week_start_date: '2026-08-17' }], NOW, NY)).toBe(true);
  });

  it('returns true when the previous week is published', () => {
    expect(isPublishingRestaurant([{ week_start_date: '2026-08-10' }], NOW, NY)).toBe(true);
  });

  it('returns false when the newest publication is 2 weeks old', () => {
    expect(isPublishingRestaurant([{ week_start_date: '2026-08-03' }], NOW, NY)).toBe(false);
  });

  it('accepts a week start that a manager device shifted by one day', () => {
    // The manager device wrote Sunday, not Monday. The 8-day window keeps it.
    expect(isPublishingRestaurant([{ week_start_date: '2026-08-09' }], NOW, NY)).toBe(true);
  });

  it('reads the window from the restaurant day, not the UTC day', () => {
    const sundayNight = new Date('2026-08-17T02:00:00Z');
    // In New York the current week still starts 2026-08-10, so the window
    // opens on 2026-08-02.
    expect(isPublishingRestaurant([{ week_start_date: '2026-08-03' }], sundayNight, NY)).toBe(true);
    expect(isPublishingRestaurant([{ week_start_date: '2026-08-03' }], sundayNight, 'UTC')).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to check that it fails**

Run: `npx vitest run tests/unit/schedulePublisher.test.ts`
Expected: FAIL with `Failed to resolve import "@/lib/schedulePublisher"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/schedulePublisher.ts`:

```ts
import { subDays } from 'date-fns';
import { formatLocalDate } from '@/lib/shiftInterval';
import { getRestaurantWeekStart } from '@/lib/scheduleWeek';

export interface PublicationWeek {
  week_start_date: string;
}

/**
 * The oldest `week_start_date` that still counts as a recent publication.
 *
 * 8 days, not 7. `week_start_date` records the manager device day, not the
 * restaurant day, so a manager in another timezone can write a Monday one day
 * away from the restaurant Monday. The extra day absorbs that skew.
 */
export function publishWindowStart(now: Date, tz: string): string {
  return formatLocalDate(subDays(getRestaurantWeekStart(now, tz), 8));
}

/**
 * Does this restaurant publish its schedule?
 *
 * A restaurant that never publishes has `is_published = false` on every shift.
 * Its employees would see every row dashed and muted, and a signal that never
 * varies is not a signal. Anchor the window to today, never to the viewed week.
 *
 * A `YYYY-MM-DD` string sorts the same way as the date it names, so a string
 * compare is correct here.
 */
export function isPublishingRestaurant(
  publications: PublicationWeek[],
  now: Date,
  tz: string
): boolean {
  const windowStart = publishWindowStart(now, tz);
  return publications.some((p) => p.week_start_date >= windowStart);
}
```

- [ ] **Step 4: Run the test to check that it passes**

Run: `npx vitest run tests/unit/schedulePublisher.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/schedulePublisher.ts tests/unit/schedulePublisher.test.ts
git commit -m "feat(scheduling): add the publisher restaurant rule"
```

---

### Task 4: The bounded publication query

**Files:**
- Create: `src/hooks/useRestaurantPublishes.tsx`

**Interfaces:**
- Consumes: `publishWindowStart` and `isPublishingRestaurant` from Task 3.
- Produces: `useRestaurantPublishes(restaurantId: string | null, tz: string): { publishes: boolean; isLoading: boolean }`

- [ ] **Step 1: Write the implementation**

Create `src/hooks/useRestaurantPublishes.tsx`:

```tsx
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import {
  isPublishingRestaurant,
  publishWindowStart,
  type PublicationWeek,
} from '@/lib/schedulePublisher';

/**
 * Does this restaurant publish its schedule right now?
 *
 * Warning: do not reuse `useSchedulePublications`. That hook selects `*` with
 * no week filter and no limit, so it reads the whole publish history on every
 * page load. This query is bounded, and the range scan uses
 * `idx_schedule_publications_week_lookup`.
 *
 * The key keeps the `['schedule_publications', restaurantId]` prefix. Publish
 * and unpublish invalidate that prefix, and React Query matches an
 * invalidation by prefix, so this key stays fresh.
 */
export function useRestaurantPublishes(
  restaurantId: string | null,
  tz: string
): { publishes: boolean; isLoading: boolean } {
  // Recomputed once per calendar day, not once per render. An unstable value
  // here would make a new query key on every render.
  const windowStart = useMemo(() => publishWindowStart(new Date(), tz), [tz]);

  const { data, isLoading } = useQuery({
    queryKey: ['schedule_publications', restaurantId, 'window', windowStart],
    queryFn: async (): Promise<PublicationWeek[]> => {
      if (!restaurantId) return [];

      const { data, error } = await supabase
        .from('schedule_publications')
        .select('week_start_date')
        .eq('restaurant_id', restaurantId)
        .gte('week_start_date', windowStart);

      if (error) throw error;
      return (data ?? []) as PublicationWeek[];
    },
    enabled: !!restaurantId,
    staleTime: 30000,
  });

  // While the query loads, report false. A shift row must render something, so
  // it cannot wait. A false draft hue caused a no-show. A late draft hue did
  // not.
  const publishes = data ? isPublishingRestaurant(data, new Date(), tz) : false;

  return { publishes, isLoading };
}
```

- [ ] **Step 2: Check the types**

Run: `npm run typecheck`
Expected: no error.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useRestaurantPublishes.tsx
git commit -m "feat(scheduling): add the bounded publication query"
```

---

### Task 5: Gate the draft treatment in ShiftRow

**Files:**
- Modify: `src/components/employee/ShiftRow.tsx:96-116`
- Test: `tests/unit/ShiftRow.publishes.test.tsx`

**Interfaces:**
- Produces: `ShiftRowProps` gains `restaurantPublishes?: boolean`. It defaults to `true`, so every current call site keeps its behaviour.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/ShiftRow.publishes.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ShiftRow } from '@/components/employee/ShiftRow';
import type { Shift } from '@/types/scheduling';

const draft = {
  id: 'a',
  start_time: '2026-08-20T12:00:00Z',
  end_time: '2026-08-20T20:00:00Z',
  status: 'scheduled',
  is_published: false,
  break_minutes: 0,
} as Shift;

describe('ShiftRow draft treatment', () => {
  it('marks a draft when the restaurant publishes', () => {
    const { container } = render(<ShiftRow shift={draft} restaurantPublishes />);
    expect(screen.getByText('Draft')).toBeInTheDocument();
    expect(container.querySelector('.border-dashed')).not.toBeNull();
  });

  it('shows a solid row when the restaurant does not publish', () => {
    const { container } = render(<ShiftRow shift={draft} restaurantPublishes={false} />);
    expect(screen.queryByText('Draft')).toBeNull();
    expect(container.querySelector('.border-dashed')).toBeNull();
  });

  it('marks a draft by default, so current call sites do not change', () => {
    render(<ShiftRow shift={draft} />);
    expect(screen.getByText('Draft')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to check that it fails**

Run: `npx vitest run tests/unit/ShiftRow.publishes.test.tsx`
Expected: FAIL. The second test fails, because the row still marks the draft.

- [ ] **Step 3: Write the implementation**

In `src/components/employee/ShiftRow.tsx`, add the prop to the interface, after `variant`:

```tsx
  /**
   * Does the restaurant publish its schedule? A restaurant that never
   * publishes has `is_published = false` on every shift, so the draft
   * treatment would mark every row and mean nothing. Defaults to `true`, so a
   * call site that does not know keeps the current behaviour.
   */
  restaurantPublishes?: boolean;
```

Change the component signature and the `isDraft` line:

```tsx
export function ShiftRow({
  shift,
  variant = 'day',
  onTrade,
  restaurantPublishes = true,
}: ShiftRowProps): JSX.Element {
  const isDraft = restaurantPublishes && !shift.is_published;
```

Leave every other line unchanged. `getSurfaceClass`, `timeText`, and `draftSrLabel` all read `isDraft`, so one gate covers all three.

- [ ] **Step 4: Run the test to check that it passes**

Run: `npx vitest run tests/unit/ShiftRow.publishes.test.tsx`
Expected: PASS, 3 tests.

- [ ] **Step 5: Check that no current test broke**

Run: `npx vitest run tests/unit/ShiftRow`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/employee/ShiftRow.tsx tests/unit/ShiftRow.publishes.test.tsx
git commit -m "feat(scheduling): gate the draft treatment on the restaurant"
```

---

### Task 6: The next-shift anchor card

**Files:**
- Create: `src/components/employee/NextShiftCard.tsx`
- Test: `tests/unit/NextShiftCard.test.tsx`

**Interfaces:**
- Consumes: `Shift`, and the output of `selectUpcomingShifts` from Task 2.
- Produces:
  ```tsx
  interface NextShiftCardProps {
    shifts: Shift[];
    isLoading: boolean;
    isError: boolean;
    timezone: string;
  }
  export function NextShiftCard(props: NextShiftCardProps): JSX.Element
  ```
  The parent passes the already-selected list. The card does no selection.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/NextShiftCard.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NextShiftCard } from '@/components/employee/NextShiftCard';
import type { Shift } from '@/types/scheduling';

const shift = {
  id: 'a',
  start_time: '2026-08-20T13:00:00Z',
  end_time: '2026-08-20T21:00:00Z',
  status: 'scheduled',
} as Shift;

const base = { isLoading: false, isError: false, timezone: 'America/New_York' };

describe('NextShiftCard', () => {
  it('shows a skeleton while it loads', () => {
    render(<NextShiftCard {...base} shifts={[]} isLoading />);
    expect(screen.getByTestId('next-shift-loading')).toBeInTheDocument();
  });

  it('states an error, and does not claim that no shift exists', () => {
    render(<NextShiftCard {...base} shifts={[]} isError />);
    expect(screen.getByText("We couldn't load your next shift.")).toBeInTheDocument();
    expect(screen.queryByText(/No shift scheduled/)).toBeNull();
  });

  it('states the empty case', () => {
    render(<NextShiftCard {...base} shifts={[]} />);
    expect(screen.getByText('No shift scheduled in the next 3 weeks.')).toBeInTheDocument();
  });

  it('states the next shift', () => {
    render(<NextShiftCard {...base} shifts={[shift]} />);
    expect(screen.getByText('You work next')).toBeInTheDocument();
    expect(screen.getByText(/9:00 AM/)).toBeInTheDocument();
  });

  it('lists the shifts that follow', () => {
    const second = { ...shift, id: 'b', start_time: '2026-08-22T13:00:00Z', end_time: '2026-08-22T21:00:00Z' } as Shift;
    render(<NextShiftCard {...base} shifts={[shift, second]} />);
    expect(screen.getByTestId('next-shift-following').children).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the test to check that it fails**

Run: `npx vitest run tests/unit/NextShiftCard.test.tsx`
Expected: FAIL with `Failed to resolve import "@/components/employee/NextShiftCard"`.

- [ ] **Step 3: Write the implementation**

Create `src/components/employee/NextShiftCard.tsx`:

```tsx
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Shift } from '@/types/scheduling';
import { formatInstant } from '@/lib/restaurantClock';

interface NextShiftCardProps {
  shifts: Shift[];
  isLoading: boolean;
  isError: boolean;
  timezone: string;
}

/**
 * The answer to "am I working?", above the week grid.
 *
 * The card never depends on the week the employee views. An employee opened
 * the page on a Sunday night, saw the week that had just ended, and did not
 * come to work.
 *
 * The card states no publish status. A shift that exists gets stated.
 *
 * The height stays constant across the three states on purpose. A collapsed
 * card would push the grid down on a page that is already painted.
 */
export function NextShiftCard({
  shifts,
  isLoading,
  isError,
  timezone,
}: NextShiftCardProps): JSX.Element {
  const [next, ...following] = shifts;

  return (
    <Card className="min-h-[132px]">
      <CardContent className="p-5">
        <p className="text-[13px] text-muted-foreground mb-2">You work next</p>

        {isLoading ? (
          <div data-testid="next-shift-loading" className="space-y-2">
            <Skeleton className="h-7 w-48" />
            <Skeleton className="h-4 w-64" />
          </div>
        ) : isError ? (
          // Never state that no shift exists when the read failed. A wrong
          // line is worse than no line.
          <p className="text-[14px] text-muted-foreground">
            We couldn't load your next shift.
          </p>
        ) : !next ? (
          <p className="text-[14px] text-muted-foreground">
            No shift scheduled in the next 3 weeks.
          </p>
        ) : (
          <>
            <p className="text-[22px] font-semibold text-foreground">
              {formatInstant(next.start_time, timezone, 'EEEE')}{' '}
              {formatInstant(next.start_time, timezone, 'h:mm a')}
            </p>
            <p className="text-[14px] text-muted-foreground mt-0.5">
              {formatInstant(next.start_time, timezone, 'MMM d')} ·{' '}
              {formatInstant(next.start_time, timezone, 'h:mm a')} –{' '}
              {formatInstant(next.end_time, timezone, 'h:mm a')}
            </p>

            {following.length > 0 && (
              <div
                data-testid="next-shift-following"
                className="mt-3 pt-3 border-t border-border/40 space-y-1"
              >
                {following.map((s) => (
                  <p key={s.id} className="text-[13px] text-muted-foreground">
                    {formatInstant(s.start_time, timezone, 'EEE MMM d')} ·{' '}
                    {formatInstant(s.start_time, timezone, 'h:mm a')} –{' '}
                    {formatInstant(s.end_time, timezone, 'h:mm a')}
                  </p>
                ))}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
```

`formatInstant(value, tz, pattern)` is at `src/lib/restaurantClock.ts:122`. It
takes a date-fns pattern. Never use `formatLocalTimeInTz` here. That helper
returns `HH:MM:SS` on a 24-hour clock, and this card shows a 12-hour clock.

- [ ] **Step 4: Run the test to check that it passes**

Run: `npx vitest run tests/unit/NextShiftCard.test.tsx`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/components/employee/NextShiftCard.tsx tests/unit/NextShiftCard.test.tsx
git commit -m "feat(scheduling): add the next shift anchor card"
```

---

### Task 7: Send the restaurant group to PostHog

**Files:**
- Modify: `src/contexts/RestaurantContext.tsx`

**Interfaces:**
- Produces: nothing that other tasks import. It makes the flag targetable by restaurant.

- [ ] **Step 1: Write the implementation**

In `src/contexts/RestaurantContext.tsx`, add the import:

```tsx
import { usePostHog } from 'posthog-js/react';
```

Add this effect inside the provider, after `selectedRestaurant` is computed:

```tsx
  const posthog = usePostHog();

  // Tell PostHog which restaurant the user works in, so a feature flag can
  // target named customers.
  //
  // The group call belongs here, not in `recordAuthEvents`. A user can hold
  // several restaurants, and `recordAuthEvents` runs before any selection.
  //
  // Send the restaurant id only. Never send the restaurant name. See the
  // "PII minimization" rule at `src/lib/analytics.ts:223`.
  useEffect(() => {
    if (!posthog || !selectedRestaurant?.restaurant_id) return;
    posthog.group('restaurant', selectedRestaurant.restaurant_id);
  }, [posthog, selectedRestaurant?.restaurant_id]);
```

- [ ] **Step 2: Check the types and the lint**

Run: `npm run typecheck && npm run lint`
Expected: no error.

- [ ] **Step 3: Commit**

```bash
git add src/contexts/RestaurantContext.tsx
git commit -m "feat(analytics): send the restaurant group to PostHog"
```

---

### Task 8: Wire the page behind the flag

**Files:**
- Modify: `src/pages/EmployeeSchedule.tsx`

**Interfaces:**
- Consumes: every unit from Tasks 1 to 6.
- Produces: the finished page.

- [ ] **Step 1: Add the imports and the flag**

Add to the imports in `src/pages/EmployeeSchedule.tsx`:

Add `addDays` to the existing `date-fns` block at
`src/pages/EmployeeSchedule.tsx:31-41`. Never add a second `from 'date-fns'`
import line.

```tsx
import { useFeatureFlagEnabled } from 'posthog-js/react';
import { NextShiftCard } from '@/components/employee/NextShiftCard';
import { useRestaurantPublishes } from '@/hooks/useRestaurantPublishes';
import { getRelativeWeekLabel, getRestaurantWeekStart } from '@/lib/scheduleWeek';
import { selectUpcomingShifts, countShiftsInWeek } from '@/lib/nextShift';
import { wallClockToInstant, formatLocalDateInTz } from '@/lib/shiftInterval';
```

Add inside the component, near the top:

```tsx
  // One key for the whole page treatment. `useFeatureFlagEnabled` returns
  // `undefined` when PostHog is unconfigured, so compare to `true`. The
  // default is the current page.
  const showClarity = useFeatureFlagEnabled('employee_schedule_clarity') === true;
```

- [ ] **Step 2: Fix the host-timezone week start**

Change `src/pages/EmployeeSchedule.tsx:57`. This is the variable that decides which week loads.

```tsx
  const restaurantTimezone = safeTz(selectedRestaurant?.restaurant?.timezone);

  const [currentWeekStart, setCurrentWeekStart] = useState(() =>
    getRestaurantWeekStart(new Date(), restaurantTimezone)
  );
```

Move the `restaurantTimezone` line above the `useState`, so the initializer can read it.

Change `handleToday` at `src/pages/EmployeeSchedule.tsx:192`:

```tsx
  const handleToday = () => {
    setCurrentWeekStart(getRestaurantWeekStart(new Date(), restaurantTimezone));
  };
```

- [ ] **Step 3: Add the anchor query**

Add after the existing `useMyShifts` call:

```tsx
  // The anchor never depends on the viewed week. Both bounds come from one
  // value that changes once per restaurant calendar day. A `Date` built in the
  // render body would make a new query key on every render, because the key at
  // `src/hooks/useShifts.tsx:76` holds `startDate?.toISOString()`.
  const todayStr = formatLocalDateInTz(new Date(), restaurantTimezone);

  const anchorRange = useMemo(() => {
    const start = wallClockToInstant(todayStr, '00:00', restaurantTimezone);
    return { start, end: addDays(start, 21) };
  }, [todayStr, restaurantTimezone]);

  const {
    shifts: anchorShifts,
    loading: anchorLoading,
    error: anchorError,
  } = useMyShifts(
    restaurantId,
    currentEmployee?.id ?? null,
    anchorRange.start,
    anchorRange.end
  );

  const upcomingAnchorShifts = useMemo(
    () => selectUpcomingShifts(anchorShifts ?? [], new Date(), 5),
    [anchorShifts]
  );
```

`UseShiftsResult` at `src/hooks/useShifts.tsx:49` names the fields `shifts`,
`loading`, `error`, and `refetch`. The field is `loading`, not `isLoading`.

- [ ] **Step 4: Add the publisher flag**

```tsx
  const { publishes: restaurantPublishes } = useRestaurantPublishes(
    restaurantId,
    restaurantTimezone
  );
```

- [ ] **Step 5: Render the anchor, and keep the old card behind the flag**

Above the "Upcoming Shifts" block at `src/pages/EmployeeSchedule.tsx:247`, add:

```tsx
      {showClarity && (
        <NextShiftCard
          shifts={upcomingAnchorShifts}
          isLoading={anchorLoading}
          isError={!!anchorError}
          timezone={restaurantTimezone}
        />
      )}
```

Change the condition on the current card, so the two never show together:

```tsx
      {!showClarity && upcomingShifts.length > 0 && (
```

Leave `upcomingShifts` and `allUpcomingAreDrafts` in place. The flag keeps both paths alive.

- [ ] **Step 6: Add the relative week label**

Replace the `Badge` at `src/pages/EmployeeSchedule.tsx:306` with a conditional:

```tsx
        {showClarity ? (
          <div className="text-center">
            <p className="text-[15px] font-semibold text-foreground">
              {getRelativeWeekLabel(currentWeekStart, new Date(), restaurantTimezone)}
            </p>
            <p className="text-[13px] text-muted-foreground">
              {format(currentWeekStart, 'MMM d')} - {format(weekEnd, 'MMM d, yyyy')}
            </p>
          </div>
        ) : (
          <Badge variant="outline" className="px-3 py-1">
            {format(currentWeekStart, 'MMM d')} - {format(weekEnd, 'MMM d, yyyy')}
          </Badge>
        )}
```

Warning: a shadcn `Badge` renders a `div`. Never put one inside a `<p>`. See
`memory/lessons.md:2818`. The new branch uses no `Badge`, so it is safe. Keep
the old branch byte-identical, hyphen separator included.

- [ ] **Step 7: Add the next-week count, the chevron dot, and the footer row**

Add the count. It reads the anchor list, so it needs no new query:

```tsx
  // The anchor query covers today to +21 days, so next week sits inside it.
  const nextWeekShiftCount = useMemo(
    () =>
      countShiftsInWeek(
        anchorShifts ?? [],
        addDays(getRestaurantWeekStart(new Date(), restaurantTimezone), 7),
        restaurantTimezone
      ),
    [anchorShifts, restaurantTimezone]
  );

  const viewsCurrentWeek =
    getRelativeWeekLabel(currentWeekStart, new Date(), restaurantTimezone) === 'This week';

  const showNextWeekHint = showClarity && viewsCurrentWeek && nextWeekShiftCount > 0;
```

Add the dot to the forward chevron. Keep the button markup, and add a wrapper
with `relative`:

```tsx
                <div className="relative">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleNextWeek}
                    aria-label={
                      showNextWeekHint
                        ? `Next week, ${nextWeekShiftCount} ${nextWeekShiftCount === 1 ? 'shift' : 'shifts'}`
                        : 'Next week'
                    }
                    className="min-h-[44px] min-w-[44px]"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                  {showNextWeekHint && (
                    // A dot alone would fail WCAG 1.4.1. The footer row below
                    // carries the same fact in words, and the aria-label
                    // carries it for a screen reader. `border-background`
                    // holds the 3:1 non-text contrast of WCAG 1.4.11.
                    <span
                      aria-hidden="true"
                      className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-primary border-2 border-background"
                    />
                  )}
                </div>
```

Add the footer row. Put it after the closing `</CardContent>` of the week grid
card, inside the same `Card`:

```tsx
        {showNextWeekHint && (
          <div className="px-6 pb-4">
            <button
              type="button"
              onClick={handleNextWeek}
              className="w-full min-h-[44px] flex items-center justify-between px-3 rounded-lg border border-border/40 text-[13px] text-muted-foreground hover:text-foreground hover:border-border transition-colors"
            >
              <span>
                Next week: {nextWeekShiftCount}{' '}
                {nextWeekShiftCount === 1 ? 'shift' : 'shifts'}
              </span>
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        )}
```

Add `countShiftsInWeek` to the `@/lib/nextShift` import.

- [ ] **Step 8: Thread the publisher flag into the grid rows**

Change the `ShiftRow` call at `src/pages/EmployeeSchedule.tsx:367`:

```tsx
                          <ShiftRow
                            key={shift.id}
                            shift={shift}
                            onTrade={handleTradeShift}
                            restaurantPublishes={showClarity ? restaurantPublishes : true}
                          />
```

The `showClarity` guard keeps the current behaviour when the flag is off.

- [ ] **Step 9: Check the types, the lint, and every test**

Run: `npm run typecheck && npm run lint && npx vitest run tests/unit`
Expected: no error, every test passes.

- [ ] **Step 10: Commit**

```bash
git add src/pages/EmployeeSchedule.tsx
git commit -m "feat(scheduling): wire the employee schedule clarity flag"
```

---

## After the plan

Record the cleanup change before the rollout starts. A flag left forever is
worse than no flag. The cleanup change deletes `upcomingShifts`,
`allUpcomingAreDrafts`, the old card at `src/pages/EmployeeSchedule.tsx:247`,
and every `showClarity` branch.
