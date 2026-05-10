# Time-Off Manager UX + Email Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the manager-facing Time-Off tab so pending requests are
unmissable (focused queue + always-visible Approve/Reject + tab badge),
collapse decided requests into history, and fix the silent PostgREST embed
in `buildEmails` so manager emails actually reach managers.

**Architecture:** Two independent tracks shipped together.
- **Track A (email fix):** Replace PostgREST embed in
  `buildEmails.ts` with a 2-step query (`user_restaurants` → `profiles`).
  Refactor the Vitest mock so a future re-introduction of an embed fails
  the test rather than masking the regression.
- **Track B (UI):** Rewrite `TimeOffList.tsx` as two pure sub-components:
  `<PendingQueue>` (focused, action-needed card) and `<DecidedHistory>`
  (collapsible, filterable). Add an `(N) pending` badge on the Time-Off
  `TabsTrigger` in `Scheduling.tsx`, mirroring the existing Shift Trades
  pattern.

**Tech Stack:** React 18, TypeScript, Vite, TailwindCSS, shadcn/ui,
React Query, Vitest, Supabase Edge Functions (Deno).

**Spec:** `docs/superpowers/specs/2026-05-10-timeoff-manager-ux-design.md`

---

## File Map

| File | Status | Responsibility |
|------|--------|----------------|
| `supabase/functions/send-time-off-notification/buildEmails.ts` | Modify | 2-step query: get user_ids, then their profile emails |
| `tests/unit/sendTimeOffNotification-buildEmails.test.ts` | Modify | Mock supports two `from()` calls; assert call shape; regression guard |
| `src/lib/timeOffUtils.ts` | Create | Pure helpers: `partitionByStatus`, `daysSince` |
| `tests/unit/timeOffUtils.test.ts` | Create | Cover partition + daysSince |
| `src/components/timeoff/PendingQueue.tsx` | Create | Focused "Action needed" card with always-visible action buttons |
| `src/components/timeoff/DecidedHistory.tsx` | Create | Collapsible history with All/Approved/Rejected chips |
| `src/components/timeoff/TimeOffRow.tsx` | Create | Shared row used by both queue + history (variant: pending vs decided) |
| `src/components/TimeOffList.tsx` | Modify | Becomes a thin orchestrator: query → partition → render queue + history |
| `tests/unit/TimeOffList.test.tsx` | Create | Pending appears on top, decided collapsed, action buttons visible |
| `src/pages/Scheduling.tsx` | Modify | Use `useTimeOffRequests`, add `(N) pending` badge to Time-Off `TabsTrigger` |
| `tests/unit/SchedulingTimeOffBadge.test.tsx` | Create | Badge appears when count > 0, hidden at 0 |

---

## Track A — Fix silent PostgREST embed in `buildEmails`

### Task 1: Refactor mock to model 2-step query and assert real shape

**Files:**
- Modify: `tests/unit/sendTimeOffNotification-buildEmails.test.ts`

The existing mock returns `data` with `profiles: { email: ... }` already
embedded — that's exactly the production behavior PostgREST does NOT
exhibit when the FK is missing. The new mock simulates two sequential
`.from()` calls and lets us assert that `buildEmails` issues both.

- [ ] **Step 1: Replace the mock and tests with the 2-step model**

Overwrite the test file with:

```ts
import { describe, it, expect, vi } from 'vitest';
import { buildEmails } from '../../supabase/functions/send-time-off-notification/buildEmails';

interface UserRestaurantRow { user_id: string }
interface ProfileRow { user_id: string; email: string | null }

interface UserRestaurantsResult {
  data: UserRestaurantRow[] | null;
  error: { message: string } | null;
}
interface ProfilesResult {
  data: ProfileRow[] | null;
  error: { message: string } | null;
}

interface MockResults {
  userRestaurants: UserRestaurantsResult;
  profiles: ProfilesResult;
}

interface MockCalls {
  userRestaurants: { table: string; select: string; eqCol: string; eqVal: string; inCol: string; inVals: string[] };
  profiles: { table: string; select: string; inCol: string; inVals: string[] };
}

function makeSupabaseStub(results: MockResults) {
  const calls: MockCalls = {
    userRestaurants: { table: '', select: '', eqCol: '', eqVal: '', inCol: '', inVals: [] },
    profiles: { table: '', select: '', inCol: '', inVals: [] },
  };

  const userRestaurantsChain = {
    select: (cols: string) => {
      calls.userRestaurants.select = cols;
      return {
        eq: (col: string, val: string) => {
          calls.userRestaurants.eqCol = col;
          calls.userRestaurants.eqVal = val;
          return {
            in: async (col: string, vals: string[]) => {
              calls.userRestaurants.inCol = col;
              calls.userRestaurants.inVals = vals;
              return results.userRestaurants;
            },
          };
        },
      };
    },
  };

  const profilesChain = {
    select: (cols: string) => {
      calls.profiles.select = cols;
      return {
        in: async (col: string, vals: string[]) => {
          calls.profiles.inCol = col;
          calls.profiles.inVals = vals;
          return results.profiles;
        },
      };
    },
  };

  const supabase = {
    from: vi.fn((table: string) => {
      if (table === 'user_restaurants') {
        calls.userRestaurants.table = table;
        return userRestaurantsChain;
      }
      if (table === 'profiles') {
        calls.profiles.table = table;
        return profilesChain;
      }
      throw new Error(`Unexpected table: ${table}`);
    }),
  };

  return { supabase, calls };
}

describe('buildEmails', () => {
  it('CRITICAL: returns only employee when notifyEmployee=true and notifyManagers=false', async () => {
    const { supabase } = makeSupabaseStub({
      userRestaurants: { data: [], error: null },
      profiles: { data: [], error: null },
    });
    const result = await buildEmails({
      supabase: supabase as never,
      restaurantId: 'rest-1',
      employeeEmail: 'employee@example.com',
      notifyEmployee: true,
      notifyManagers: false,
    });
    expect(result.emails).toEqual(['employee@example.com']);
    expect(result.employeeIncluded).toBe(true);
    expect(result.managersFound).toBe(0);
    expect(result.managerLookupError).toBeUndefined();
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('CRITICAL: queries user_restaurants then profiles separately (no embed) and combines results', async () => {
    const { supabase, calls } = makeSupabaseStub({
      userRestaurants: { data: [{ user_id: 'u1' }, { user_id: 'u2' }], error: null },
      profiles: {
        data: [
          { user_id: 'u1', email: 'owner@example.com' },
          { user_id: 'u2', email: 'manager@example.com' },
        ],
        error: null,
      },
    });
    const result = await buildEmails({
      supabase: supabase as never,
      restaurantId: 'rest-1',
      employeeEmail: null,
      notifyEmployee: false,
      notifyManagers: true,
    });
    // First call must hit user_restaurants with the role filter.
    expect(calls.userRestaurants.table).toBe('user_restaurants');
    expect(calls.userRestaurants.select).toBe('user_id');
    expect(calls.userRestaurants.eqCol).toBe('restaurant_id');
    expect(calls.userRestaurants.eqVal).toBe('rest-1');
    expect(calls.userRestaurants.inCol).toBe('role');
    expect(calls.userRestaurants.inVals).toEqual(['owner', 'manager']);
    // Second call must hit profiles with the user_ids from step 1.
    expect(calls.profiles.table).toBe('profiles');
    expect(calls.profiles.select).toContain('email');
    expect(calls.profiles.inCol).toBe('user_id');
    expect(calls.profiles.inVals.sort()).toEqual(['u1', 'u2']);
    // Result merges both.
    expect(result.emails.sort()).toEqual(['manager@example.com', 'owner@example.com']);
    expect(result.managersFound).toBe(2);
    expect(result.employeeIncluded).toBe(false);
  });

  it('CRITICAL: skips profiles call when no users match the role filter', async () => {
    const { supabase, calls } = makeSupabaseStub({
      userRestaurants: { data: [], error: null },
      profiles: { data: [], error: null },
    });
    const result = await buildEmails({
      supabase: supabase as never,
      restaurantId: 'rest-1',
      employeeEmail: null,
      notifyEmployee: false,
      notifyManagers: true,
    });
    expect(calls.userRestaurants.table).toBe('user_restaurants');
    expect(calls.profiles.table).toBe(''); // never called
    expect(result.emails).toEqual([]);
    expect(result.managersFound).toBe(0);
  });

  it('CRITICAL: de-duplicates when employee email is also a manager email', async () => {
    const { supabase } = makeSupabaseStub({
      userRestaurants: { data: [{ user_id: 'u1' }, { user_id: 'u2' }], error: null },
      profiles: {
        data: [
          { user_id: 'u1', email: 'shared@example.com' },
          { user_id: 'u2', email: 'other@example.com' },
        ],
        error: null,
      },
    });
    const result = await buildEmails({
      supabase: supabase as never,
      restaurantId: 'rest-1',
      employeeEmail: 'shared@example.com',
      notifyEmployee: true,
      notifyManagers: true,
    });
    expect(result.emails.sort()).toEqual(['other@example.com', 'shared@example.com']);
    expect(result.employeeIncluded).toBe(true);
    expect(result.managersFound).toBe(2);
  });

  it('CRITICAL: captures managerLookupError when user_restaurants query errors', async () => {
    const { supabase } = makeSupabaseStub({
      userRestaurants: { data: null, error: { message: 'permission denied' } },
      profiles: { data: [], error: null },
    });
    const result = await buildEmails({
      supabase: supabase as never,
      restaurantId: 'rest-1',
      employeeEmail: null,
      notifyEmployee: false,
      notifyManagers: true,
    });
    expect(result.emails).toEqual([]);
    expect(result.managersFound).toBe(0);
    expect(result.managerLookupError).toBe('permission denied');
  });

  it('CRITICAL: captures managerLookupError when profiles query errors', async () => {
    const { supabase } = makeSupabaseStub({
      userRestaurants: { data: [{ user_id: 'u1' }], error: null },
      profiles: { data: null, error: { message: 'profiles unreachable' } },
    });
    const result = await buildEmails({
      supabase: supabase as never,
      restaurantId: 'rest-1',
      employeeEmail: null,
      notifyEmployee: false,
      notifyManagers: true,
    });
    expect(result.emails).toEqual([]);
    expect(result.managersFound).toBe(0);
    expect(result.managerLookupError).toBe('profiles unreachable');
  });

  it('CRITICAL: returns empty list when both flags are false', async () => {
    const { supabase } = makeSupabaseStub({
      userRestaurants: { data: [], error: null },
      profiles: { data: [], error: null },
    });
    const result = await buildEmails({
      supabase: supabase as never,
      restaurantId: 'rest-1',
      employeeEmail: 'employee@example.com',
      notifyEmployee: false,
      notifyManagers: false,
    });
    expect(result.emails).toEqual([]);
    expect(result.employeeIncluded).toBe(false);
    expect(result.managersFound).toBe(0);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('CRITICAL: skips profile rows with null email', async () => {
    const { supabase } = makeSupabaseStub({
      userRestaurants: { data: [{ user_id: 'u1' }, { user_id: 'u2' }, { user_id: 'u3' }], error: null },
      profiles: {
        data: [
          { user_id: 'u1', email: null },
          { user_id: 'u2', email: null },
          { user_id: 'u3', email: 'real@example.com' },
        ],
        error: null,
      },
    });
    const result = await buildEmails({
      supabase: supabase as never,
      restaurantId: 'rest-1',
      employeeEmail: null,
      notifyEmployee: false,
      notifyManagers: true,
    });
    expect(result.emails).toEqual(['real@example.com']);
    expect(result.managersFound).toBe(1);
  });
});
```

- [ ] **Step 2: Run the test — confirm RED**

Run: `npm run test -- tests/unit/sendTimeOffNotification-buildEmails.test.ts`
Expected: FAIL — the existing impl uses an embed, so calls to
`from('profiles')` never happen and the new assertions fail.

- [ ] **Step 3: No commit yet** — keep it red until Task 2 ships green.

---

### Task 2: Replace embed with 2-step query in `buildEmails`

**Files:**
- Modify: `supabase/functions/send-time-off-notification/buildEmails.ts`

- [ ] **Step 1: Replace the file with the 2-step implementation**

Overwrite `supabase/functions/send-time-off-notification/buildEmails.ts`
with:

```ts
/**
 * Resolves email recipients for a time-off notification.
 *
 * Uses two sequential queries instead of a PostgREST embed because
 * `public.profiles` has no foreign key to `auth.users` (or to anything),
 * so an embed like `select('user_id, profiles:user_id(email)')` silently
 * returns null and managers stop receiving emails. See spec
 * 2026-05-10-timeoff-manager-ux-design.md.
 *
 * Type-agnostic: accepts any object with a `.from()` method that returns
 * the expected chain shape, so the real Deno Supabase client and Vitest
 * stubs both satisfy the same interface.
 */

export interface BuildEmailsInput {
  supabase: TwoStepQueryClient;
  restaurantId: string;
  employeeEmail?: string | null;
  notifyEmployee: boolean;
  notifyManagers: boolean;
}

export interface BuildEmailsResult {
  emails: string[];
  employeeIncluded: boolean;
  managersFound: number;
  managerLookupError?: string;
}

interface UserRestaurantsChain {
  select(columns: string): {
    eq(column: string, value: string): {
      in(column: string, values: string[]): Promise<{
        data: { user_id: string }[] | null;
        error: { message: string } | null;
      }>;
    };
  };
}

interface ProfilesChain {
  select(columns: string): {
    in(column: string, values: string[]): Promise<{
      data: { user_id: string; email: string | null }[] | null;
      error: { message: string } | null;
    }>;
  };
}

interface TwoStepQueryClient {
  from(table: 'user_restaurants'): UserRestaurantsChain;
  from(table: 'profiles'): ProfilesChain;
  from(table: string): UserRestaurantsChain | ProfilesChain;
}

export async function buildEmails(
  input: BuildEmailsInput
): Promise<BuildEmailsResult> {
  const {
    supabase,
    restaurantId,
    employeeEmail,
    notifyEmployee,
    notifyManagers,
  } = input;

  const emails: string[] = [];
  let employeeIncluded = false;
  let managersFound = 0;
  let managerLookupError: string | undefined;

  if (notifyEmployee && employeeEmail) {
    emails.push(employeeEmail);
    employeeIncluded = true;
  }

  if (notifyManagers) {
    const { data: roleRows, error: rolesErr } = await (supabase.from(
      'user_restaurants',
    ) as UserRestaurantsChain)
      .select('user_id')
      .eq('restaurant_id', restaurantId)
      .in('role', ['owner', 'manager']);

    if (rolesErr) {
      managerLookupError = rolesErr.message;
    } else if (roleRows && roleRows.length > 0) {
      const userIds = roleRows.map((r) => r.user_id);
      const { data: profileRows, error: profErr } = await (supabase.from(
        'profiles',
      ) as ProfilesChain)
        .select('user_id, email')
        .in('user_id', userIds);

      if (profErr) {
        managerLookupError = profErr.message;
      } else if (profileRows) {
        for (const p of profileRows) {
          if (p.email) {
            emails.push(p.email);
            managersFound++;
          }
        }
      }
    }
  }

  return {
    emails: [...new Set(emails)],
    employeeIncluded,
    managersFound,
    managerLookupError,
  };
}
```

- [ ] **Step 2: Run the test — confirm GREEN**

Run: `npm run test -- tests/unit/sendTimeOffNotification-buildEmails.test.ts`
Expected: PASS — all 8 cases.

- [ ] **Step 3: Commit Track A**

```bash
git add supabase/functions/send-time-off-notification/buildEmails.ts \
        tests/unit/sendTimeOffNotification-buildEmails.test.ts
git commit -m "$(cat <<'EOF'
fix(time-off): replace silent PostgREST embed with 2-step manager lookup

public.profiles has no FK, so the embed `profiles:user_id(email)` from
buildEmails silently returns null in production and managers stop
receiving "New Time-Off Request" emails. Use two sequential queries
(user_restaurants -> profiles by user_id) and update the test mock to
the 2-step shape, so any future re-introduction of an embed fails the
test instead of masking the regression.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Track B — Manager UX redesign

### Task 3: Add pure utilities `partitionByStatus` and `daysSince`

**Files:**
- Create: `src/lib/timeOffUtils.ts`
- Create: `tests/unit/timeOffUtils.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/timeOffUtils.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { partitionByStatus, daysSince } from '../../src/lib/timeOffUtils';
import type { TimeOffRequest } from '../../src/types/scheduling';

const make = (overrides: Partial<TimeOffRequest>): TimeOffRequest => ({
  id: 'r1',
  restaurant_id: 'rest-1',
  employee_id: 'e1',
  start_date: '2026-05-01',
  end_date: '2026-05-01',
  status: 'pending',
  requested_at: '2026-05-01T00:00:00Z',
  created_at: '2026-05-01T00:00:00Z',
  updated_at: '2026-05-01T00:00:00Z',
  ...overrides,
});

describe('partitionByStatus', () => {
  it('splits requests into pending and decided buckets', () => {
    const requests = [
      make({ id: 'a', status: 'pending', created_at: '2026-05-01T00:00:00Z' }),
      make({ id: 'b', status: 'approved', start_date: '2026-05-10' }),
      make({ id: 'c', status: 'rejected', start_date: '2026-05-11' }),
      make({ id: 'd', status: 'pending', created_at: '2026-04-25T00:00:00Z' }),
    ];
    const { pending, decided } = partitionByStatus(requests);
    expect(pending.map((r) => r.id)).toEqual(['d', 'a']); // oldest pending first
    expect(decided.map((r) => r.id)).toEqual(['c', 'b']); // start_date desc
  });

  it('returns empty arrays for empty input', () => {
    expect(partitionByStatus([])).toEqual({ pending: [], decided: [] });
  });

  it('puts unknown statuses into decided to avoid silent loss', () => {
    const requests = [make({ id: 'x', status: 'weird' as 'approved' })];
    expect(partitionByStatus(requests).decided.map((r) => r.id)).toEqual(['x']);
    expect(partitionByStatus(requests).pending).toEqual([]);
  });
});

describe('daysSince', () => {
  it('returns 0 for the same day', () => {
    const now = new Date('2026-05-10T12:00:00Z');
    expect(daysSince('2026-05-10T08:00:00Z', now)).toBe(0);
  });

  it('returns the floor of elapsed full days', () => {
    const now = new Date('2026-05-10T12:00:00Z');
    expect(daysSince('2026-05-08T12:00:00Z', now)).toBe(2);
    expect(daysSince('2026-05-08T13:00:00Z', now)).toBe(1);
  });

  it('returns 0 for a future timestamp (defensive, not negative)', () => {
    const now = new Date('2026-05-10T12:00:00Z');
    expect(daysSince('2026-05-12T12:00:00Z', now)).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests — confirm RED**

Run: `npm run test -- tests/unit/timeOffUtils.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement utilities**

Create `src/lib/timeOffUtils.ts`:

```ts
import type { TimeOffRequest } from '@/types/scheduling';

export interface Partitioned {
  pending: TimeOffRequest[];
  decided: TimeOffRequest[];
}

/**
 * Split time-off requests into pending vs decided.
 * - pending: sorted oldest first (created_at asc) so managers work the
 *   queue FIFO.
 * - decided: sorted by start_date desc (matches existing audit ordering).
 * Unknown statuses fall into `decided` so we never silently drop rows.
 */
export function partitionByStatus(requests: TimeOffRequest[]): Partitioned {
  const pending: TimeOffRequest[] = [];
  const decided: TimeOffRequest[] = [];

  for (const r of requests) {
    if (r.status === 'pending') pending.push(r);
    else decided.push(r);
  }

  pending.sort((a, b) => a.created_at.localeCompare(b.created_at));
  decided.sort((a, b) => b.start_date.localeCompare(a.start_date));

  return { pending, decided };
}

const MS_PER_DAY = 1000 * 60 * 60 * 24;

/**
 * Whole days elapsed since `iso`. Negative inputs (future dates) clamp to 0.
 * `now` is injectable for deterministic tests.
 */
export function daysSince(iso: string, now: Date = new Date()): number {
  const then = new Date(iso).getTime();
  const diff = now.getTime() - then;
  if (diff < 0) return 0;
  return Math.floor(diff / MS_PER_DAY);
}
```

- [ ] **Step 4: Run tests — confirm GREEN**

Run: `npm run test -- tests/unit/timeOffUtils.test.ts`
Expected: PASS — 6 cases.

- [ ] **Step 5: Commit**

```bash
git add src/lib/timeOffUtils.ts tests/unit/timeOffUtils.test.ts
git commit -m "feat(time-off): add partitionByStatus + daysSince helpers

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 4: Build `<TimeOffRow>` shared row component

**Files:**
- Create: `src/components/timeoff/TimeOffRow.tsx`
- Create: `tests/unit/TimeOffRow.test.tsx`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/TimeOffRow.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TimeOffRow } from '../../src/components/timeoff/TimeOffRow';
import type { TimeOffRequest } from '../../src/types/scheduling';

const baseRequest: TimeOffRequest = {
  id: 'r1',
  restaurant_id: 'rest-1',
  employee_id: 'e1',
  start_date: '2026-05-31',
  end_date: '2026-06-07',
  reason: 'Family wedding',
  status: 'pending',
  requested_at: '2026-05-08T17:20:00Z',
  created_at: '2026-05-08T17:20:00Z',
  updated_at: '2026-05-08T17:20:00Z',
  employee: {
    id: 'e1',
    restaurant_id: 'rest-1',
    name: 'Shy Harrison',
    user_id: 'u1',
    is_active: true,
    created_at: '2026-04-01T00:00:00Z',
    updated_at: '2026-04-01T00:00:00Z',
  },
};

const fixedNow = new Date('2026-05-10T12:00:00Z');

describe('TimeOffRow (variant=pending)', () => {
  it('renders Approve and Reject buttons that are visible without hover', () => {
    render(
      <TimeOffRow
        variant="pending"
        request={baseRequest}
        now={fixedNow}
        onApprove={vi.fn()}
        onReject={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    );
    const approve = screen.getByRole('button', { name: /approve/i });
    const reject = screen.getByRole('button', { name: /reject/i });
    expect(approve).toBeInTheDocument();
    expect(reject).toBeInTheDocument();
    // Critical regression: action buttons must NOT be hover-only.
    expect(approve.className).not.toMatch(/opacity-0/);
    expect(reject.className).not.toMatch(/opacity-0/);
  });

  it('renders the days-since-requested counter', () => {
    render(
      <TimeOffRow
        variant="pending"
        request={baseRequest}
        now={fixedNow}
        onApprove={vi.fn()}
        onReject={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    );
    expect(screen.getByText(/requested 2 days ago/i)).toBeInTheDocument();
  });

  it('renders "today" instead of "0 days ago" when requested today', () => {
    render(
      <TimeOffRow
        variant="pending"
        request={{ ...baseRequest, created_at: '2026-05-10T10:00:00Z' }}
        now={fixedNow}
        onApprove={vi.fn()}
        onReject={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    );
    expect(screen.getByText(/requested today/i)).toBeInTheDocument();
  });

  it('truncates long reasons and exposes the full text via title attribute', () => {
    const longReason = 'A'.repeat(120);
    render(
      <TimeOffRow
        variant="pending"
        request={{ ...baseRequest, reason: longReason }}
        now={fixedNow}
        onApprove={vi.fn()}
        onReject={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    );
    const reason = screen.getByTestId('time-off-row-reason');
    expect(reason.textContent?.length).toBeLessThan(longReason.length);
    expect(reason).toHaveAttribute('title', longReason);
  });

  it('calls onApprove with the request id', () => {
    const onApprove = vi.fn();
    render(
      <TimeOffRow
        variant="pending"
        request={baseRequest}
        now={fixedNow}
        onApprove={onApprove}
        onReject={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /approve/i }));
    expect(onApprove).toHaveBeenCalledWith(baseRequest);
  });
});

describe('TimeOffRow (variant=decided)', () => {
  it('renders status badge and no approve/reject buttons', () => {
    render(
      <TimeOffRow
        variant="decided"
        request={{ ...baseRequest, status: 'approved' }}
        now={fixedNow}
        onApprove={vi.fn()}
        onReject={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    );
    expect(screen.getByText(/approved/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^approve$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^reject$/i })).not.toBeInTheDocument();
  });

  it('does not render the days-since-requested counter on decided rows', () => {
    render(
      <TimeOffRow
        variant="decided"
        request={{ ...baseRequest, status: 'approved' }}
        now={fixedNow}
        onApprove={vi.fn()}
        onReject={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    );
    expect(screen.queryByText(/requested .* ago/i)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests — confirm RED**

Run: `npm run test -- tests/unit/TimeOffRow.test.tsx`
Expected: FAIL — component does not exist.

- [ ] **Step 3: Implement `<TimeOffRow>`**

Create `src/components/timeoff/TimeOffRow.tsx`:

```tsx
import { memo, useMemo } from 'react';
import { format } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Calendar, Check, X, Edit, Trash2, User, Clock } from 'lucide-react';
import { TimeOffRequest } from '@/types/scheduling';
import { daysSince } from '@/lib/timeOffUtils';
import { formatDateOnly } from '@/lib/dateUtils';

const REASON_PREVIEW_MAX = 80;

export type TimeOffRowVariant = 'pending' | 'decided';

interface TimeOffRowProps {
  variant: TimeOffRowVariant;
  request: TimeOffRequest;
  /** Injectable clock for deterministic tests. */
  now?: Date;
  onApprove: (request: TimeOffRequest) => void;
  onReject: (request: TimeOffRequest) => void;
  onEdit: (request: TimeOffRequest) => void;
  onDelete: (request: TimeOffRequest) => void;
  isApproving?: boolean;
  isRejecting?: boolean;
}

const STATUS_BADGE: Record<TimeOffRequest['status'], { label: string; className: string; icon: typeof Check }> = {
  approved: { label: 'Approved', className: 'bg-emerald-500/15 text-emerald-700 border-emerald-500/30', icon: Check },
  rejected: { label: 'Rejected', className: 'bg-rose-500/15 text-rose-700 border-rose-500/30', icon: X },
  pending: { label: 'Pending', className: 'bg-amber-500/15 text-amber-700 border-amber-500/30', icon: Clock },
};

function formatDaysAgo(days: number): string {
  if (days === 0) return 'requested today';
  if (days === 1) return 'requested 1 day ago';
  return `requested ${days} days ago`;
}

function truncate(text: string): { display: string; truncated: boolean } {
  if (text.length <= REASON_PREVIEW_MAX) return { display: text, truncated: false };
  return { display: `${text.slice(0, REASON_PREVIEW_MAX - 1).trimEnd()}…`, truncated: true };
}

export const TimeOffRow = memo(function TimeOffRow({
  variant,
  request,
  now,
  onApprove,
  onReject,
  onEdit,
  onDelete,
  isApproving,
  isRejecting,
}: TimeOffRowProps) {
  const days = useMemo(() => daysSince(request.created_at, now), [request.created_at, now]);
  const dateRange = useMemo(() => {
    const start = format(formatDateOnly(request.start_date) ?? new Date(request.start_date), 'MMM d, yyyy');
    const end = format(formatDateOnly(request.end_date) ?? new Date(request.end_date), 'MMM d, yyyy');
    return start === end ? start : `${start} – ${end}`;
  }, [request.start_date, request.end_date]);
  const reasonPreview = request.reason ? truncate(request.reason) : null;
  const isPending = variant === 'pending';

  return (
    <div className="group flex items-start gap-3 p-4 rounded-xl border border-border/40 bg-background hover:border-border transition-colors">
      <div className="h-10 w-10 rounded-xl bg-muted/50 flex items-center justify-center flex-shrink-0">
        <User className="h-5 w-5 text-foreground" />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[14px] font-medium text-foreground truncate">
            {request.employee?.name || 'Unknown employee'}
          </span>
          {!isPending && (
            <Badge variant="outline" className={`text-[11px] ${STATUS_BADGE[request.status].className}`}>
              {STATUS_BADGE[request.status].label}
            </Badge>
          )}
          {isPending && (
            <span className="text-[12px] text-muted-foreground">{formatDaysAgo(days)}</span>
          )}
        </div>
        <div className="flex items-center gap-1 text-[13px] text-muted-foreground mt-1">
          <Calendar className="h-3 w-3" />
          <span>{dateRange}</span>
        </div>
        {reasonPreview && (
          <p
            className="text-[13px] text-muted-foreground mt-1.5"
            data-testid="time-off-row-reason"
            title={reasonPreview.truncated ? request.reason : undefined}
          >
            {reasonPreview.display}
          </p>
        )}
      </div>

      {isPending ? (
        <div className="flex items-center gap-2 flex-shrink-0">
          <Button
            type="button"
            size="sm"
            onClick={() => onApprove(request)}
            disabled={isApproving}
            className="h-9 px-3 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 text-[13px] font-medium"
            aria-label={`Approve time-off for ${request.employee?.name ?? 'employee'}`}
          >
            <Check className="h-4 w-4 mr-1" />
            Approve
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => onReject(request)}
            disabled={isRejecting}
            className="h-9 px-3 rounded-lg text-[13px] font-medium"
            aria-label={`Reject time-off for ${request.employee?.name ?? 'employee'}`}
          >
            <X className="h-4 w-4 mr-1" />
            Reject
          </Button>
          <div className="flex opacity-0 group-hover:opacity-100 transition-opacity">
            <Button
              type="button"
              size="icon"
              variant="ghost"
              onClick={() => onEdit(request)}
              aria-label="Edit request"
              className="h-8 w-8"
            >
              <Edit className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              onClick={() => onDelete(request)}
              aria-label="Delete request"
              className="h-8 w-8 text-destructive hover:text-destructive/80"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onClick={() => onDelete(request)}
            aria-label="Delete request"
            className="h-8 w-8 text-destructive hover:text-destructive/80"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
});
```

Note: `formatDateOnly` already exists in `src/lib/dateUtils.ts` (used by
prior time-off TZ fixes). If the import path differs, adjust to match the
real export name found in that file.

- [ ] **Step 4: Run tests — confirm GREEN**

Run: `npm run test -- tests/unit/TimeOffRow.test.tsx`
Expected: PASS — 7 cases.

- [ ] **Step 5: Commit**

```bash
git add src/components/timeoff/TimeOffRow.tsx tests/unit/TimeOffRow.test.tsx
git commit -m "feat(time-off): add TimeOffRow with always-visible actions

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 5: Build `<PendingQueue>` focused card

**Files:**
- Create: `src/components/timeoff/PendingQueue.tsx`
- Create: `tests/unit/PendingQueue.test.tsx`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/PendingQueue.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PendingQueue } from '../../src/components/timeoff/PendingQueue';
import type { TimeOffRequest } from '../../src/types/scheduling';

const make = (id: string, overrides: Partial<TimeOffRequest> = {}): TimeOffRequest => ({
  id,
  restaurant_id: 'rest-1',
  employee_id: `e-${id}`,
  start_date: '2026-05-31',
  end_date: '2026-06-07',
  status: 'pending',
  requested_at: '2026-05-08T17:20:00Z',
  created_at: '2026-05-08T17:20:00Z',
  updated_at: '2026-05-08T17:20:00Z',
  employee: { id: `e-${id}`, restaurant_id: 'rest-1', name: `Emp ${id}`, user_id: `u-${id}`, is_active: true, created_at: '2026-04-01T00:00:00Z', updated_at: '2026-04-01T00:00:00Z' } as TimeOffRequest['employee'],
  ...overrides,
});

const fixedNow = new Date('2026-05-10T12:00:00Z');

describe('PendingQueue', () => {
  it('renders header with count and "Action needed" label', () => {
    render(
      <PendingQueue
        requests={[make('a'), make('b')]}
        now={fixedNow}
        onApprove={vi.fn()}
        onReject={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    );
    expect(screen.getByRole('heading', { name: /action needed/i })).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('renders the empty state when there are no pending requests', () => {
    render(
      <PendingQueue
        requests={[]}
        now={fixedNow}
        onApprove={vi.fn()}
        onReject={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    );
    expect(screen.getByText(/all caught up/i)).toBeInTheDocument();
  });

  it('renders one TimeOffRow per request', () => {
    render(
      <PendingQueue
        requests={[make('a'), make('b'), make('c')]}
        now={fixedNow}
        onApprove={vi.fn()}
        onReject={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    );
    expect(screen.getAllByRole('button', { name: /^approve/i })).toHaveLength(3);
    expect(screen.getAllByRole('button', { name: /^reject/i })).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run tests — confirm RED**

Run: `npm run test -- tests/unit/PendingQueue.test.tsx`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `<PendingQueue>`**

Create `src/components/timeoff/PendingQueue.tsx`:

```tsx
import { CalendarCheck, Inbox } from 'lucide-react';
import { TimeOffRow } from './TimeOffRow';
import { TimeOffRequest } from '@/types/scheduling';

interface PendingQueueProps {
  requests: TimeOffRequest[];
  now?: Date;
  onApprove: (request: TimeOffRequest) => void;
  onReject: (request: TimeOffRequest) => void;
  onEdit: (request: TimeOffRequest) => void;
  onDelete: (request: TimeOffRequest) => void;
  isApproving?: boolean;
  isRejecting?: boolean;
}

export function PendingQueue({
  requests,
  now,
  onApprove,
  onReject,
  onEdit,
  onDelete,
  isApproving,
  isRejecting,
}: PendingQueueProps) {
  return (
    <section
      aria-label="Pending time-off requests"
      className="rounded-xl border border-amber-500/20 bg-amber-500/5 overflow-hidden"
    >
      <header className="flex items-center justify-between px-5 py-3 border-b border-amber-500/15 bg-amber-500/10">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-lg bg-amber-500/15 flex items-center justify-center">
            <Inbox className="h-4 w-4 text-amber-700" />
          </div>
          <h3 className="text-[14px] font-semibold text-foreground">Action needed</h3>
        </div>
        {requests.length > 0 && (
          <span className="text-[11px] font-medium text-amber-700 px-2 py-0.5 rounded-md bg-amber-500/15">
            {requests.length}
          </span>
        )}
      </header>

      {requests.length === 0 ? (
        <div className="flex flex-col items-center justify-center px-5 py-10 text-center">
          <CalendarCheck className="h-10 w-10 text-muted-foreground/60 mb-3" />
          <p className="text-[14px] font-medium text-foreground">You&apos;re all caught up</p>
          <p className="text-[13px] text-muted-foreground mt-1">No time-off requests waiting on a decision.</p>
        </div>
      ) : (
        <div className="px-3 py-3 space-y-2">
          {requests.map((r) => (
            <TimeOffRow
              key={r.id}
              variant="pending"
              request={r}
              now={now}
              onApprove={onApprove}
              onReject={onReject}
              onEdit={onEdit}
              onDelete={onDelete}
              isApproving={isApproving}
              isRejecting={isRejecting}
            />
          ))}
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Run tests — confirm GREEN**

Run: `npm run test -- tests/unit/PendingQueue.test.tsx`
Expected: PASS — 3 cases.

- [ ] **Step 5: Commit**

```bash
git add src/components/timeoff/PendingQueue.tsx tests/unit/PendingQueue.test.tsx
git commit -m "feat(time-off): add PendingQueue card

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 6: Build `<DecidedHistory>` collapsible

**Files:**
- Create: `src/components/timeoff/DecidedHistory.tsx`
- Create: `tests/unit/DecidedHistory.test.tsx`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/DecidedHistory.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DecidedHistory } from '../../src/components/timeoff/DecidedHistory';
import type { TimeOffRequest } from '../../src/types/scheduling';

const make = (id: string, status: TimeOffRequest['status']): TimeOffRequest => ({
  id,
  restaurant_id: 'rest-1',
  employee_id: `e-${id}`,
  start_date: '2026-05-31',
  end_date: '2026-06-07',
  status,
  requested_at: '2026-05-01T00:00:00Z',
  created_at: '2026-05-01T00:00:00Z',
  updated_at: '2026-05-01T00:00:00Z',
  employee: { id: `e-${id}`, restaurant_id: 'rest-1', name: `Emp ${id}`, user_id: `u-${id}`, is_active: true, created_at: '2026-04-01T00:00:00Z', updated_at: '2026-04-01T00:00:00Z' } as TimeOffRequest['employee'],
});

describe('DecidedHistory', () => {
  it('renders header showing the total count', () => {
    render(
      <DecidedHistory
        requests={[make('a', 'approved'), make('b', 'rejected')]}
        onApprove={vi.fn()}
        onReject={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    );
    expect(screen.getByRole('button', { name: /decided/i })).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('is collapsed by default — request rows are not visible', () => {
    render(
      <DecidedHistory
        requests={[make('a', 'approved')]}
        onApprove={vi.fn()}
        onReject={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    );
    expect(screen.queryByText('Emp a')).not.toBeInTheDocument();
  });

  it('expands on header click and shows rows', () => {
    render(
      <DecidedHistory
        requests={[make('a', 'approved'), make('b', 'rejected')]}
        onApprove={vi.fn()}
        onReject={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /decided/i }));
    expect(screen.getByText('Emp a')).toBeInTheDocument();
    expect(screen.getByText('Emp b')).toBeInTheDocument();
  });

  it('filters to Approved when the Approved chip is clicked', () => {
    render(
      <DecidedHistory
        requests={[make('a', 'approved'), make('b', 'rejected')]}
        onApprove={vi.fn()}
        onReject={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /decided/i }));
    fireEvent.click(screen.getByRole('button', { name: /^approved$/i }));
    expect(screen.getByText('Emp a')).toBeInTheDocument();
    expect(screen.queryByText('Emp b')).not.toBeInTheDocument();
  });

  it('filters to Rejected when the Rejected chip is clicked', () => {
    render(
      <DecidedHistory
        requests={[make('a', 'approved'), make('b', 'rejected')]}
        onApprove={vi.fn()}
        onReject={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /decided/i }));
    fireEvent.click(screen.getByRole('button', { name: /^rejected$/i }));
    expect(screen.queryByText('Emp a')).not.toBeInTheDocument();
    expect(screen.getByText('Emp b')).toBeInTheDocument();
  });

  it('renders an empty placeholder when there are zero decided requests', () => {
    render(
      <DecidedHistory
        requests={[]}
        onApprove={vi.fn()}
        onReject={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /decided/i }));
    expect(screen.getByText(/no decided requests yet/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests — confirm RED**

Run: `npm run test -- tests/unit/DecidedHistory.test.tsx`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `<DecidedHistory>`**

Create `src/components/timeoff/DecidedHistory.tsx`:

```tsx
import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, History } from 'lucide-react';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { TimeOffRow } from './TimeOffRow';
import { TimeOffRequest } from '@/types/scheduling';

type Filter = 'all' | 'approved' | 'rejected';

interface DecidedHistoryProps {
  requests: TimeOffRequest[];
  onApprove: (request: TimeOffRequest) => void;
  onReject: (request: TimeOffRequest) => void;
  onEdit: (request: TimeOffRequest) => void;
  onDelete: (request: TimeOffRequest) => void;
}

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
];

export function DecidedHistory({ requests, onApprove, onReject, onEdit, onDelete }: DecidedHistoryProps) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');

  const visible = useMemo(() => {
    if (filter === 'all') return requests;
    return requests.filter((r) => r.status === filter);
  }, [requests, filter]);

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-xl border border-border/40 bg-background overflow-hidden">
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="w-full flex items-center justify-between px-5 py-3 hover:bg-muted/30 transition-colors"
          aria-label={`Decided requests (${requests.length})`}
        >
          <span className="flex items-center gap-3">
            <span className="h-8 w-8 rounded-lg bg-muted/50 flex items-center justify-center">
              <History className="h-4 w-4 text-foreground" />
            </span>
            <span className="text-[14px] font-semibold text-foreground">Decided</span>
            <span className="text-[11px] font-medium text-muted-foreground px-2 py-0.5 rounded-md bg-muted">
              {requests.length}
            </span>
          </span>
          {open ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
        </button>
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="px-5 py-3 border-t border-border/40 flex items-center gap-2">
          {FILTERS.map((f) => {
            const isActive = filter === f.value;
            return (
              <button
                key={f.value}
                type="button"
                onClick={() => setFilter(f.value)}
                aria-pressed={isActive}
                className={`text-[12px] font-medium px-3 py-1 rounded-full transition-colors ${
                  isActive
                    ? 'bg-foreground text-background'
                    : 'bg-muted/50 text-muted-foreground hover:bg-muted'
                }`}
              >
                {f.label}
              </button>
            );
          })}
        </div>

        <div className="px-3 py-3 space-y-2">
          {visible.length === 0 ? (
            <p className="text-[13px] text-muted-foreground text-center py-6">
              {requests.length === 0 ? 'No decided requests yet.' : 'No requests match this filter.'}
            </p>
          ) : (
            visible.map((r) => (
              <TimeOffRow
                key={r.id}
                variant="decided"
                request={r}
                onApprove={onApprove}
                onReject={onReject}
                onEdit={onEdit}
                onDelete={onDelete}
              />
            ))
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
```

- [ ] **Step 4: Run tests — confirm GREEN**

Run: `npm run test -- tests/unit/DecidedHistory.test.tsx`
Expected: PASS — 6 cases.

- [ ] **Step 5: Commit**

```bash
git add src/components/timeoff/DecidedHistory.tsx tests/unit/DecidedHistory.test.tsx
git commit -m "feat(time-off): add DecidedHistory collapsible with status filter

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 7: Rewrite `TimeOffList` to compose the new sub-components

**Files:**
- Modify: `src/components/TimeOffList.tsx`
- Create: `tests/unit/TimeOffList.test.tsx`

- [ ] **Step 1: Write failing tests for the orchestrator**

Create `tests/unit/TimeOffList.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TimeOffList } from '../../src/components/TimeOffList';
import type { TimeOffRequest } from '../../src/types/scheduling';

vi.mock('../../src/hooks/useTimeOffRequests', () => ({
  useTimeOffRequests: vi.fn(),
  useApproveTimeOffRequest: () => ({ mutate: vi.fn(), isPending: false }),
  useRejectTimeOffRequest: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteTimeOffRequest: () => ({ mutate: vi.fn() }),
}));

import * as hookMod from '../../src/hooks/useTimeOffRequests';

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
);

const make = (id: string, status: TimeOffRequest['status'], created_at = '2026-05-08T00:00:00Z'): TimeOffRequest => ({
  id,
  restaurant_id: 'rest-1',
  employee_id: `e-${id}`,
  start_date: '2026-05-31',
  end_date: '2026-06-07',
  status,
  requested_at: created_at,
  created_at,
  updated_at: created_at,
  employee: { id: `e-${id}`, restaurant_id: 'rest-1', name: `Emp ${id}`, user_id: `u-${id}`, is_active: true, created_at: '2026-04-01T00:00:00Z', updated_at: '2026-04-01T00:00:00Z' } as TimeOffRequest['employee'],
});

describe('TimeOffList', () => {
  it('shows the loading skeleton while data is loading', () => {
    (hookMod.useTimeOffRequests as ReturnType<typeof vi.fn>).mockReturnValue({
      timeOffRequests: [],
      loading: true,
    });
    render(<TimeOffList restaurantId="rest-1" />, { wrapper });
    expect(document.querySelectorAll('[data-testid="skeleton"], .animate-pulse').length).toBeGreaterThan(0);
  });

  it('renders the empty hero when there are zero requests of any kind', () => {
    (hookMod.useTimeOffRequests as ReturnType<typeof vi.fn>).mockReturnValue({
      timeOffRequests: [],
      loading: false,
    });
    render(<TimeOffList restaurantId="rest-1" />, { wrapper });
    expect(screen.getByText(/no time-off requests yet/i)).toBeInTheDocument();
  });

  it('always renders PendingQueue (with empty state) when there are decided but no pending', () => {
    (hookMod.useTimeOffRequests as ReturnType<typeof vi.fn>).mockReturnValue({
      timeOffRequests: [make('a', 'approved')],
      loading: false,
    });
    render(<TimeOffList restaurantId="rest-1" />, { wrapper });
    expect(screen.getByRole('heading', { name: /action needed/i })).toBeInTheDocument();
    expect(screen.getByText(/all caught up/i)).toBeInTheDocument();
  });

  it('renders pending in a focused queue and decided in a collapsed history', () => {
    (hookMod.useTimeOffRequests as ReturnType<typeof vi.fn>).mockReturnValue({
      timeOffRequests: [make('a', 'pending'), make('b', 'approved'), make('c', 'rejected')],
      loading: false,
    });
    render(<TimeOffList restaurantId="rest-1" />, { wrapper });
    expect(screen.getByRole('heading', { name: /action needed/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /decided/i })).toBeInTheDocument();
    // Decided is collapsed: emp b/c rows not visible
    expect(screen.queryByText('Emp b')).not.toBeInTheDocument();
    expect(screen.queryByText('Emp c')).not.toBeInTheDocument();
    // Pending row IS visible
    expect(screen.getByText('Emp a')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests — confirm RED**

Run: `npm run test -- tests/unit/TimeOffList.test.tsx`
Expected: FAIL — current `TimeOffList` doesn't render PendingQueue/DecidedHistory.

- [ ] **Step 3: Replace `src/components/TimeOffList.tsx`**

Overwrite the file with:

```tsx
import { useState } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent } from '@/components/ui/card';
import { Calendar } from 'lucide-react';
import { TimeOffRequest } from '@/types/scheduling';
import {
  useTimeOffRequests,
  useApproveTimeOffRequest,
  useRejectTimeOffRequest,
  useDeleteTimeOffRequest,
} from '@/hooks/useTimeOffRequests';
import { TimeOffRequestDialog } from './TimeOffRequestDialog';
import { PendingQueue } from './timeoff/PendingQueue';
import { DecidedHistory } from './timeoff/DecidedHistory';
import { partitionByStatus } from '@/lib/timeOffUtils';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface TimeOffListProps {
  restaurantId: string;
}

export const TimeOffList = ({ restaurantId }: TimeOffListProps) => {
  const { timeOffRequests, loading } = useTimeOffRequests(restaurantId);
  const approveRequest = useApproveTimeOffRequest();
  const rejectRequest = useRejectTimeOffRequest();
  const deleteRequest = useDeleteTimeOffRequest();

  const [editingRequest, setEditingRequest] = useState<TimeOffRequest | undefined>();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [requestToDelete, setRequestToDelete] = useState<TimeOffRequest | null>(null);

  const handleEdit = (request: TimeOffRequest) => {
    setEditingRequest(request);
    setDialogOpen(true);
  };
  const handleApprove = (request: TimeOffRequest) =>
    approveRequest.mutate({ id: request.id, restaurantId });
  const handleReject = (request: TimeOffRequest) =>
    rejectRequest.mutate({ id: request.id, restaurantId });
  const handleDelete = (request: TimeOffRequest) => setRequestToDelete(request);

  const confirmDelete = () => {
    if (requestToDelete) {
      deleteRequest.mutate(
        { id: requestToDelete.id, restaurantId },
        { onSuccess: () => setRequestToDelete(null) },
      );
    }
  };

  if (loading) {
    return (
      <div className="space-y-4 p-4" data-testid="time-off-loading">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  if (timeOffRequests.length === 0) {
    return (
      <Card className="border-border/40 bg-muted/20">
        <CardContent className="py-12 text-center">
          <Calendar className="h-12 w-12 mx-auto text-muted-foreground/60 mb-4" />
          <h3 className="text-[15px] font-semibold mb-1">No time-off requests yet</h3>
          <p className="text-[13px] text-muted-foreground">
            New employee requests will appear here for your review.
          </p>
        </CardContent>
      </Card>
    );
  }

  const { pending, decided } = partitionByStatus(timeOffRequests);

  return (
    <>
      <div className="space-y-4 p-4">
        <PendingQueue
          requests={pending}
          onApprove={handleApprove}
          onReject={handleReject}
          onEdit={handleEdit}
          onDelete={handleDelete}
          isApproving={approveRequest.isPending}
          isRejecting={rejectRequest.isPending}
        />
        <DecidedHistory
          requests={decided}
          onApprove={handleApprove}
          onReject={handleReject}
          onEdit={handleEdit}
          onDelete={handleDelete}
        />
      </div>

      <TimeOffRequestDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        restaurantId={restaurantId}
        request={editingRequest}
      />

      <AlertDialog open={!!requestToDelete} onOpenChange={() => setRequestToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete time-off request</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this time-off request? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
```

- [ ] **Step 4: Run tests — confirm GREEN**

Run: `npm run test -- tests/unit/TimeOffList.test.tsx`
Expected: PASS — 4 cases.

- [ ] **Step 5: Commit**

```bash
git add src/components/TimeOffList.tsx tests/unit/TimeOffList.test.tsx
git commit -m "refactor(time-off): split TimeOffList into PendingQueue + DecidedHistory

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 8: Add `(N) pending` badge on Time-Off tab

**Files:**
- Modify: `src/pages/Scheduling.tsx`
- Create: `tests/unit/SchedulingTimeOffBadge.test.tsx`

- [ ] **Step 1: Write failing test**

The test isolates the rendering of the Time-Off tab badge by exporting a
small pure helper component if it doesn't already exist, OR by mocking
React Query at the page level. Simplest path: extract a tiny pure
function and unit-test it instead of rendering the whole Scheduling page.

Create `tests/unit/SchedulingTimeOffBadge.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TimeOffTabBadge } from '../../src/pages/SchedulingTimeOffTabBadge';

describe('TimeOffTabBadge', () => {
  it('renders the count when count > 0', () => {
    render(<TimeOffTabBadge count={3} />);
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('renders nothing when count is 0', () => {
    const { container } = render(<TimeOffTabBadge count={0} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing for negative or NaN counts (defensive)', () => {
    const { container } = render(<TimeOffTabBadge count={Number.NaN} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('uses warning-tinted styling consistent with the trades badge', () => {
    render(<TimeOffTabBadge count={1} />);
    const badge = screen.getByText('1');
    expect(badge.className).toMatch(/warning|amber/);
  });
});
```

- [ ] **Step 2: Run test — confirm RED**

Run: `npm run test -- tests/unit/SchedulingTimeOffBadge.test.tsx`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Create the badge component**

Create `src/pages/SchedulingTimeOffTabBadge.tsx`:

```tsx
import { Badge } from '@/components/ui/badge';

interface TimeOffTabBadgeProps {
  count: number;
}

export function TimeOffTabBadge({ count }: TimeOffTabBadgeProps) {
  if (!Number.isFinite(count) || count <= 0) return null;
  return (
    <Badge className="ml-1 h-5 min-w-5 px-1.5 bg-warning text-warning-foreground text-[10px] font-bold animate-pulse">
      {count}
    </Badge>
  );
}
```

- [ ] **Step 4: Run test — confirm GREEN**

Run: `npm run test -- tests/unit/SchedulingTimeOffBadge.test.tsx`
Expected: PASS — 4 cases.

- [ ] **Step 5: Wire badge into Scheduling.tsx**

In `src/pages/Scheduling.tsx`:

1. Add import (group 4: hooks/components):

```tsx
import { useTimeOffRequests } from '@/hooks/useTimeOffRequests';
import { TimeOffTabBadge } from './SchedulingTimeOffTabBadge';
```

2. Below the `useShiftTrades` call (around line 375), add:

```tsx
const { timeOffRequests } = useTimeOffRequests(restaurantId);
const pendingTimeOffCount = timeOffRequests.filter((r) => r.status === 'pending').length;
```

3. Replace the Time-Off `TabsTrigger` (~lines 1090-1096) with:

```tsx
<TabsTrigger
  value="timeoff"
  className="data-[state=active]:bg-background data-[state=active]:shadow-sm px-4 py-2.5 gap-2 relative"
>
  <CalendarX className="h-4 w-4" />
  <span className="hidden sm:inline">Time-Off</span>
  <TimeOffTabBadge count={pendingTimeOffCount} />
</TabsTrigger>
```

- [ ] **Step 6: Run typecheck + tests**

Run: `npm run typecheck && npm run test -- tests/unit/SchedulingTimeOffBadge.test.tsx tests/unit/TimeOffList.test.tsx`
Expected: PASS for both. Typecheck PASS.

- [ ] **Step 7: Commit**

```bash
git add src/pages/Scheduling.tsx \
        src/pages/SchedulingTimeOffTabBadge.tsx \
        tests/unit/SchedulingTimeOffBadge.test.tsx
git commit -m "feat(time-off): add pending count badge to Time-Off tab

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 9: Manual verification + cross-tab smoke

**Files:** none modified.

- [ ] **Step 1: Start dev environment**

Run (in worktree):
```bash
npm run dev
```

- [ ] **Step 2: Walk-through**

1. Sign in as a restaurant manager (any user with `owner` or `manager`
   role on a restaurant). Navigate to `/scheduling` and click the
   "Time-Off" tab.
2. Verify: pending requests appear in the focused "Action needed" card
   at the top with visible Approve / Reject buttons (no hover required).
3. Verify: each pending row shows "requested N days ago" and a
   truncated reason.
4. Verify: Decided section is collapsed by default, expands on click,
   filter chips switch between All / Approved / Rejected.
5. Verify: tab label shows `(N) pending` badge when there are pending
   requests; badge disappears at zero.
6. Submit a fresh time-off request as an employee (e.g., from the
   Employee Portal). Confirm in the Resend dashboard / function logs
   that:
   - The "New Time-Off Request" email is sent to manager email(s) AND
     the employee.
   - Function log shows `managersFound: <N>` where N > 0.

If everything looks right, no commit (verification-only step). If
anything regresses, file findings as a fix in a small follow-up commit
inside this plan.

---

### Task 10: Final verification suite

- [ ] **Step 1: Run unit + lint + typecheck + build**

```bash
npm run test
npm run lint
npm run typecheck
npm run build
```

Expected: ALL pass with zero errors. If any fail, fix and re-run.

- [ ] **Step 2: Run pgTAP**

```bash
npm run test:db
```

Expected: PASS, including the existing
`notification_approver_resolution.test.sql` (untouched, but must still
green to confirm we didn't break the underlying SQL pattern).

- [ ] **Step 3: Update progress.md**

In the worktree's `progress.md`, set the current phase to "Phase 4
complete" and note the verification results.

- [ ] **Step 4: No new commit needed if everything passes** — Phase 4
  done. Continue to Phase 5+ via the development-workflow skill.

---

## Self-Review

**Spec coverage:**
- ✅ "Pending requests appear in focused card at top" — Task 5 + 7
- ✅ "Always-visible Approve/Reject" — Task 4 (assertion regresses
  hover-only)
- ✅ "Days-pending counter" — Task 4
- ✅ "Reason preview truncated" — Task 4
- ✅ "Decided collapsible, default closed, filter chips" — Task 6
- ✅ "Decided default filter All" — Task 6
- ✅ "Decided sort by start_date desc" — Task 3 partition util
- ✅ "Tab badge mirroring Trades style" — Task 8
- ✅ "Empty pending: All caught up" — Task 5
- ✅ "buildEmails 2-step query + regression test" — Tasks 1-2
- ✅ "Manager emails reach managers" — Task 2 + Task 9 manual
- ✅ "Test would fail if embed re-introduced" — Task 1 mock requires two
  `from()` calls

**Placeholder scan:** none.

**Type consistency:**
- `partitionByStatus` returns `{ pending, decided }` — used identically
  in Task 7.
- `TimeOffRow` props (`variant`, `request`, `now`, callbacks,
  `isApproving`, `isRejecting`) — consistent across Tasks 4-7.
- `TimeOffTabBadge` `count: number` — consistent with usage in Task 8
  (`pendingTimeOffCount` from `.filter(...).length`).
- `BuildEmailsInput` / `BuildEmailsResult` shapes — preserved in Task 2.

Plan ready.
