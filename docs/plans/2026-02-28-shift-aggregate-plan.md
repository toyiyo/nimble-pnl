# Shift Aggregate Domain Layer — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement a pure TypeScript event-sourced Shift aggregate with decide/evolve/replay, ShiftInterval value object, invariants, policy interfaces, and ~50 TDD tests.

**Architecture:** Functional event-sourcing. Commands → `decide(state, command)` → events or DomainError. State derived via `evolve(state, event)`. `replay(shiftId, events)` folds from empty. All pure functions, no I/O. ShiftInterval is a value object for time math. Policies are interfaces evaluated outside the aggregate.

**Tech Stack:** TypeScript, Vitest

**Design doc:** `docs/plans/2026-02-28-shift-aggregate-design.md`

---

## Task 1: Core Types

**Files:**
- Create: `src/domain/scheduling/types.ts`
- Test: None (types only — validated by compiler)

**Step 1: Create the types file**

```typescript
// src/domain/scheduling/types.ts

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export type UUID = string;
export type Instant = string; // ISO 8601 UTC timestamp

// ---------------------------------------------------------------------------
// Domain Error
// ---------------------------------------------------------------------------

export class DomainError extends Error {
  readonly code: string;
  constructor(code: string, message?: string) {
    super(message || code);
    this.code = code;
    this.name = 'DomainError';
  }
}

// ---------------------------------------------------------------------------
// Actor
// ---------------------------------------------------------------------------

export interface Actor {
  type: 'manager' | 'employee' | 'system';
  actorId: string;
}

// ---------------------------------------------------------------------------
// Shift Status & State
// ---------------------------------------------------------------------------

export type ShiftStatus = 'Draft' | 'Published' | 'Canceled';

export interface ShiftState {
  shiftId: UUID;
  restaurantId?: UUID;
  locationId?: UUID;
  timezone?: string;
  businessDate?: string;
  startAt?: Instant;
  endAt?: Instant;
  roleId?: UUID;
  shiftTypeId?: UUID | null;
  employeeId?: UUID | null;
  stations?: string[];
  notes?: string;
  status?: ShiftStatus;
  publishedAt?: Instant;
  canceledAt?: Instant;
  cancelReasonCode?: string;
  version: number;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export interface EventEnvelope {
  eventId: UUID;
  shiftId: UUID;
  occurredAt: Instant;
  actor: Actor;
  correlationId?: UUID;
  causationId?: UUID;
}

export interface ShiftCreatedEvent extends EventEnvelope {
  type: 'ShiftCreated';
  payload: {
    restaurantId: UUID;
    locationId: UUID;
    timezone: string;
    businessDate: string;
    startAt: Instant;
    endAt: Instant;
    roleId: UUID;
    shiftTypeId?: UUID | null;
    employeeId?: UUID | null;
    stations?: string[];
    notes?: string;
  };
}

export interface ShiftTimeChangedEvent extends EventEnvelope {
  type: 'ShiftTimeChanged';
  payload: {
    oldStartAt: Instant;
    oldEndAt: Instant;
    newStartAt: Instant;
    newEndAt: Instant;
    reason?: string;
  };
}

export interface ShiftRoleChangedEvent extends EventEnvelope {
  type: 'ShiftRoleChanged';
  payload: { oldRoleId: UUID; newRoleId: UUID; reason?: string };
}

export interface ShiftTypeChangedEvent extends EventEnvelope {
  type: 'ShiftTypeChanged';
  payload: { oldShiftTypeId?: UUID | null; newShiftTypeId?: UUID | null; reason?: string };
}

export interface ShiftStationsChangedEvent extends EventEnvelope {
  type: 'ShiftStationsChanged';
  payload: { oldStations?: string[]; newStations?: string[] };
}

export interface ShiftNotesChangedEvent extends EventEnvelope {
  type: 'ShiftNotesChanged';
  payload: { oldNotes?: string; newNotes?: string };
}

export interface ShiftAssignedEvent extends EventEnvelope {
  type: 'ShiftAssigned';
  payload: { employeeId: UUID; reason?: string };
}

export interface ShiftUnassignedEvent extends EventEnvelope {
  type: 'ShiftUnassigned';
  payload: { oldEmployeeId: UUID; reason?: string };
}

export interface ShiftReassignedEvent extends EventEnvelope {
  type: 'ShiftReassigned';
  payload: { oldEmployeeId: UUID; newEmployeeId: UUID; reason?: string };
}

export interface ShiftPublishedEvent extends EventEnvelope {
  type: 'ShiftPublished';
  payload: { publishedAt: Instant };
}

export interface ShiftUnpublishedEvent extends EventEnvelope {
  type: 'ShiftUnpublished';
  payload: { reason?: string };
}

export interface ShiftCanceledEvent extends EventEnvelope {
  type: 'ShiftCanceled';
  payload: { canceledAt: Instant; reasonCode: string; notes?: string };
}

export type ShiftEvent =
  | ShiftCreatedEvent
  | ShiftTimeChangedEvent
  | ShiftRoleChangedEvent
  | ShiftTypeChangedEvent
  | ShiftStationsChangedEvent
  | ShiftNotesChangedEvent
  | ShiftAssignedEvent
  | ShiftUnassignedEvent
  | ShiftReassignedEvent
  | ShiftPublishedEvent
  | ShiftUnpublishedEvent
  | ShiftCanceledEvent;

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export interface CommandEnvelope {
  commandId: UUID;
  shiftId: UUID;
  expectedVersion: number;
  actor: Actor;
}

export interface CreateShiftCommand extends CommandEnvelope {
  type: 'CreateShift';
  payload: {
    restaurantId: UUID;
    locationId: UUID;
    timezone: string;
    businessDate?: string;
    startAt: Instant;
    endAt: Instant;
    roleId: UUID;
    shiftTypeId?: UUID | null;
    employeeId?: UUID | null;
    stations?: string[];
    notes?: string;
  };
}

export interface ChangeShiftTimeCommand extends CommandEnvelope {
  type: 'ChangeShiftTime';
  payload: { newStartAt: Instant; newEndAt: Instant; reason?: string };
}

export interface ChangeRoleCommand extends CommandEnvelope {
  type: 'ChangeRole';
  payload: { newRoleId: UUID; reason?: string };
}

export interface AssignEmployeeCommand extends CommandEnvelope {
  type: 'AssignEmployee';
  payload: { employeeId: UUID; reason?: string };
}

export interface UnassignEmployeeCommand extends CommandEnvelope {
  type: 'UnassignEmployee';
  payload: { reason?: string };
}

export interface ReassignEmployeeCommand extends CommandEnvelope {
  type: 'ReassignEmployee';
  payload: { newEmployeeId: UUID; reason?: string };
}

export interface PublishShiftCommand extends CommandEnvelope {
  type: 'PublishShift';
  payload: Record<string, never>;
}

export interface CancelShiftCommand extends CommandEnvelope {
  type: 'CancelShift';
  payload: { reasonCode: string; notes?: string };
}

export type ShiftCommand =
  | CreateShiftCommand
  | ChangeShiftTimeCommand
  | ChangeRoleCommand
  | AssignEmployeeCommand
  | UnassignEmployeeCommand
  | ReassignEmployeeCommand
  | PublishShiftCommand
  | CancelShiftCommand;

// ---------------------------------------------------------------------------
// Policies
// ---------------------------------------------------------------------------

export interface PolicyResult {
  outcome: 'ok' | 'warn' | 'block';
  code?: string;
  message?: string;
}

export interface PolicyContext {
  employeeId: UUID;
  proposedStartAt: Instant;
  proposedEndAt: Instant;
  businessDate: string;
  existingShifts: Array<{ startAt: Instant; endAt: Instant; shiftId: UUID }>;
  weeklyMinutesWorked?: number;
  availability?: Array<{ dayOfWeek: number; startTime: string; endTime: string; isAvailable: boolean }>;
  timeOffRequests?: Array<{ startDate: string; endDate: string; status: string }>;
}

export interface ShiftPolicy {
  evaluate(context: PolicyContext): PolicyResult;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const MIN_SHIFT_MINUTES = 15;
export const MAX_SHIFT_HOURS = 16;
export const MIN_REST_HOURS = 8;
export const DEFAULT_OT_WEEKLY_MINUTES = 40 * 60; // 2400 minutes
```

**Step 2: Verify it compiles**

Run: `npx tsc --noEmit src/domain/scheduling/types.ts`
Expected: No errors (or use `npx vitest run` later to verify)

**Step 3: Commit**

```bash
git add src/domain/scheduling/types.ts
git commit -m "feat(domain): add shift aggregate core types

Event-sourced types: ShiftState, 12 events (discriminated union),
8 commands, Actor, DomainError, PolicyResult, PolicyContext."
```

---

## Task 2: ShiftInterval Value Object

**Files:**
- Create: `src/domain/scheduling/shift-interval.ts`
- Create: `tests/unit/domain/shift-interval.test.ts`

**Step 1: Write the failing tests**

```typescript
// tests/unit/domain/shift-interval.test.ts
import { describe, it, expect } from 'vitest';
import { ShiftInterval } from '@/domain/scheduling/shift-interval';

describe('ShiftInterval', () => {
  describe('creation & duration', () => {
    it('calculates duration for standard daytime shift', () => {
      const interval = ShiftInterval.create('2026-02-28', '10:00', '16:00');
      expect(interval.durationInHours).toBe(6);
      expect(interval.durationInMinutes).toBe(360);
    });

    it('handles midnight crossing (22:00 to 02:00 = 4h)', () => {
      const interval = ShiftInterval.create('2026-02-28', '22:00', '02:00');
      expect(interval.durationInHours).toBe(4);
      expect(interval.endsOnNextDay).toBe(true);
    });

    it('handles midnight crossing (20:00 to 04:00 = 8h)', () => {
      const interval = ShiftInterval.create('2026-02-28', '20:00', '04:00');
      expect(interval.durationInHours).toBe(8);
      expect(interval.endsOnNextDay).toBe(true);
    });

    it('marks endsOnNextDay false for daytime shifts', () => {
      const interval = ShiftInterval.create('2026-02-28', '09:00', '17:00');
      expect(interval.endsOnNextDay).toBe(false);
    });

    it('rejects zero-duration shift (start == end)', () => {
      expect(() => ShiftInterval.create('2026-02-28', '09:00', '09:00'))
        .toThrow('INTERVAL_ZERO_DURATION');
    });

    it('rejects shift exceeding max endurance (16h)', () => {
      // 08:00 to 02:00 next day = 18h
      expect(() => ShiftInterval.create('2026-02-28', '08:00', '02:00'))
        .toThrow('INTERVAL_EXCEEDS_MAX');
    });

    it('allows exactly 16h shift', () => {
      // 06:00 to 22:00 = 16h
      const interval = ShiftInterval.create('2026-02-28', '06:00', '22:00');
      expect(interval.durationInHours).toBe(16);
    });
  });

  describe('overlapsWith', () => {
    it('detects overlapping day shifts', () => {
      const a = ShiftInterval.create('2026-02-28', '09:00', '14:00');
      const b = ShiftInterval.create('2026-02-28', '12:00', '17:00');
      expect(a.overlapsWith(b)).toBe(true);
    });

    it('returns false for non-overlapping day shifts', () => {
      const a = ShiftInterval.create('2026-02-28', '09:00', '12:00');
      const b = ShiftInterval.create('2026-02-28', '13:00', '17:00');
      expect(a.overlapsWith(b)).toBe(false);
    });

    it('returns false for adjacent shifts (end == start)', () => {
      const a = ShiftInterval.create('2026-02-28', '09:00', '12:00');
      const b = ShiftInterval.create('2026-02-28', '12:00', '17:00');
      expect(a.overlapsWith(b)).toBe(false);
    });

    it('detects identical ranges as overlapping', () => {
      const a = ShiftInterval.create('2026-02-28', '09:00', '17:00');
      const b = ShiftInterval.create('2026-02-28', '09:00', '17:00');
      expect(a.overlapsWith(b)).toBe(true);
    });

    it('detects overnight shifts overlapping', () => {
      const a = ShiftInterval.create('2026-02-28', '22:00', '04:00');
      const b = ShiftInterval.create('2026-02-28', '23:00', '05:00');
      expect(a.overlapsWith(b)).toBe(true);
    });

    it('detects daytime shift overlapping with overnight evening portion', () => {
      const overnight = ShiftInterval.create('2026-02-28', '20:00', '04:00');
      const evening = ShiftInterval.create('2026-02-28', '21:00', '23:00');
      expect(overnight.overlapsWith(evening)).toBe(true);
    });

    it('detects containment (one range inside another)', () => {
      const outer = ShiftInterval.create('2026-02-28', '08:00', '18:00');
      const inner = ShiftInterval.create('2026-02-28', '10:00', '14:00');
      expect(outer.overlapsWith(inner)).toBe(true);
    });
  });

  describe('restHoursBefore', () => {
    it('calculates rest hours between consecutive day shifts', () => {
      const first = ShiftInterval.create('2026-02-28', '09:00', '17:00');
      const second = ShiftInterval.create('2026-03-01', '09:00', '17:00');
      // 17:00 Feb 28 to 09:00 Mar 1 = 16h
      expect(first.restHoursBefore(second)).toBe(16);
    });

    it('calculates clopening rest hours (closing then opening)', () => {
      const closing = ShiftInterval.create('2026-02-28', '18:00', '02:00');
      const opening = ShiftInterval.create('2026-03-01', '08:00', '14:00');
      // 02:00 Mar 1 to 08:00 Mar 1 = 6h
      expect(closing.restHoursBefore(opening)).toBe(6);
    });

    it('returns 0 for overlapping shifts', () => {
      const a = ShiftInterval.create('2026-02-28', '09:00', '14:00');
      const b = ShiftInterval.create('2026-02-28', '12:00', '17:00');
      expect(a.restHoursBefore(b)).toBe(0);
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/domain/shift-interval.test.ts`
Expected: FAIL (module not found)

**Step 3: Write the implementation**

```typescript
// src/domain/scheduling/shift-interval.ts
import { DomainError, MAX_SHIFT_HOURS } from './types';

/**
 * Parse "HH:MM" into total minutes since midnight.
 */
function parseTime(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

/**
 * Convert a businessDate + HH:MM to a UTC-epoch-millis value.
 * If `nextDay` is true, adds 24h (for overnight end times).
 */
function toEpoch(businessDate: string, time: string, nextDay: boolean): number {
  const [y, mo, d] = businessDate.split('-').map(Number);
  const [h, m] = time.split(':').map(Number);
  const date = new Date(Date.UTC(y, mo - 1, d, h, m));
  if (nextDay) date.setUTCDate(date.getUTCDate() + 1);
  return date.getTime();
}

export class ShiftInterval {
  readonly businessDate: string;
  readonly startTime: string;
  readonly endTime: string;
  readonly startEpoch: number;
  readonly endEpoch: number;

  private constructor(businessDate: string, startTime: string, endTime: string) {
    this.businessDate = businessDate;
    this.startTime = startTime;
    this.endTime = endTime;

    const crossesMidnight = parseTime(endTime) <= parseTime(startTime);
    this.startEpoch = toEpoch(businessDate, startTime, false);
    this.endEpoch = toEpoch(businessDate, endTime, crossesMidnight);
  }

  static create(businessDate: string, startTime: string, endTime: string): ShiftInterval {
    const interval = new ShiftInterval(businessDate, startTime, endTime);

    if (interval.durationInMinutes <= 0) {
      throw new DomainError('INTERVAL_ZERO_DURATION', 'Shift must have positive duration');
    }
    if (interval.durationInHours > MAX_SHIFT_HOURS) {
      throw new DomainError(
        'INTERVAL_EXCEEDS_MAX',
        `Shift exceeds maximum endurance limit of ${MAX_SHIFT_HOURS}h`,
      );
    }

    return interval;
  }

  get durationInMinutes(): number {
    return (this.endEpoch - this.startEpoch) / 60_000;
  }

  get durationInHours(): number {
    return this.durationInMinutes / 60;
  }

  get endsOnNextDay(): boolean {
    return parseTime(this.endTime) <= parseTime(this.startTime);
  }

  /**
   * Two intervals overlap if their epoch ranges intersect (exclusive of endpoints).
   */
  overlapsWith(other: ShiftInterval): boolean {
    return this.startEpoch < other.endEpoch && other.startEpoch < this.endEpoch;
  }

  /**
   * Hours of rest between this shift's end and the other shift's start.
   * Returns 0 if shifts overlap.
   */
  restHoursBefore(other: ShiftInterval): number {
    const gap = other.startEpoch - this.endEpoch;
    return gap <= 0 ? 0 : gap / 3_600_000;
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/domain/shift-interval.test.ts`
Expected: All 14 tests PASS

**Step 5: Commit**

```bash
git add src/domain/scheduling/shift-interval.ts tests/unit/domain/shift-interval.test.ts
git commit -m "feat(domain): add ShiftInterval value object with TDD

Handles midnight crossing, duration, overlap detection, rest hours.
Enforces max 16h endurance and positive duration. 14 tests."
```

---

## Task 3: Invariants

**Files:**
- Create: `src/domain/scheduling/invariants.ts`
- Create: `tests/unit/domain/invariants.test.ts`

**Step 1: Write the failing tests**

```typescript
// tests/unit/domain/invariants.test.ts
import { describe, it, expect } from 'vitest';
import {
  assertTimeValidity,
  assertIdentityComplete,
  assertNotCanceled,
  assertEditable,
  assertHasEmployee,
  assertIsOpen,
} from '@/domain/scheduling/invariants';
import type { ShiftState } from '@/domain/scheduling/types';

const base: ShiftState = {
  shiftId: 's1',
  restaurantId: 'r1',
  locationId: 'l1',
  timezone: 'America/Chicago',
  businessDate: '2026-02-28',
  startAt: '2026-02-28T14:00:00Z',
  endAt: '2026-02-28T22:00:00Z',
  roleId: 'cashier',
  employeeId: null,
  status: 'Draft',
  version: 1,
};

describe('assertTimeValidity', () => {
  it('passes for valid times', () => {
    expect(() => assertTimeValidity('2026-02-28T14:00:00Z', '2026-02-28T22:00:00Z')).not.toThrow();
  });

  it('rejects end <= start', () => {
    expect(() => assertTimeValidity('2026-02-28T22:00:00Z', '2026-02-28T22:00:00Z'))
      .toThrow('CMD_BAD_TIME');
  });

  it('rejects duration < 15 minutes', () => {
    expect(() => assertTimeValidity('2026-02-28T14:00:00Z', '2026-02-28T14:10:00Z'))
      .toThrow('CMD_TOO_SHORT');
  });
});

describe('assertIdentityComplete', () => {
  it('passes when all required fields present', () => {
    expect(() => assertIdentityComplete(base)).not.toThrow();
  });

  it('rejects missing restaurantId', () => {
    expect(() => assertIdentityComplete({ ...base, restaurantId: undefined }))
      .toThrow('INV_MISSING_FIELDS');
  });

  it('rejects missing roleId', () => {
    expect(() => assertIdentityComplete({ ...base, roleId: undefined }))
      .toThrow('INV_MISSING_FIELDS');
  });
});

describe('assertNotCanceled', () => {
  it('passes for Draft', () => {
    expect(() => assertNotCanceled({ ...base, status: 'Draft' })).not.toThrow();
  });

  it('passes for Published', () => {
    expect(() => assertNotCanceled({ ...base, status: 'Published' })).not.toThrow();
  });

  it('rejects Canceled', () => {
    expect(() => assertNotCanceled({ ...base, status: 'Canceled' })).toThrow('SHIFT_CANCELED');
  });
});

describe('assertEditable', () => {
  it('passes for Draft', () => {
    expect(() => assertEditable({ ...base, status: 'Draft' })).not.toThrow();
  });

  it('passes for Published', () => {
    expect(() => assertEditable({ ...base, status: 'Published' })).not.toThrow();
  });

  it('rejects Canceled', () => {
    expect(() => assertEditable({ ...base, status: 'Canceled' })).toThrow('SHIFT_CANCELED');
  });
});

describe('assertHasEmployee', () => {
  it('passes when employee assigned', () => {
    expect(() => assertHasEmployee({ ...base, employeeId: 'e1' })).not.toThrow();
  });

  it('rejects when no employee', () => {
    expect(() => assertHasEmployee({ ...base, employeeId: null })).toThrow('SHIFT_NOT_ASSIGNED');
  });
});

describe('assertIsOpen', () => {
  it('passes when no employee', () => {
    expect(() => assertIsOpen({ ...base, employeeId: null })).not.toThrow();
  });

  it('rejects when employee assigned', () => {
    expect(() => assertIsOpen({ ...base, employeeId: 'e1' })).toThrow('SHIFT_ALREADY_ASSIGNED');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/domain/invariants.test.ts`
Expected: FAIL (module not found)

**Step 3: Write the implementation**

```typescript
// src/domain/scheduling/invariants.ts
import { DomainError, MIN_SHIFT_MINUTES } from './types';
import type { ShiftState, Instant } from './types';

function minutesBetween(a: Instant, b: Instant): number {
  return Math.floor((Date.parse(b) - Date.parse(a)) / 60_000);
}

export function assertTimeValidity(startAt: Instant, endAt: Instant): void {
  if (Date.parse(endAt) <= Date.parse(startAt)) {
    throw new DomainError('CMD_BAD_TIME', 'Shift end must be after start');
  }
  if (minutesBetween(startAt, endAt) < MIN_SHIFT_MINUTES) {
    throw new DomainError('CMD_TOO_SHORT', `Shift must be at least ${MIN_SHIFT_MINUTES} minutes`);
  }
}

export function assertIdentityComplete(state: ShiftState): void {
  if (
    !state.restaurantId ||
    !state.locationId ||
    !state.timezone ||
    !state.startAt ||
    !state.endAt ||
    !state.roleId
  ) {
    throw new DomainError('INV_MISSING_FIELDS', 'Shift is missing required identity fields');
  }
}

export function assertNotCanceled(state: ShiftState): void {
  if (state.status === 'Canceled') {
    throw new DomainError('SHIFT_CANCELED', 'Cannot modify a canceled shift');
  }
}

export function assertEditable(state: ShiftState): void {
  assertNotCanceled(state);
  if (state.status !== 'Draft' && state.status !== 'Published') {
    throw new DomainError('BAD_STATUS', `Shift status "${state.status}" does not allow edits`);
  }
}

export function assertHasEmployee(state: ShiftState): void {
  if (!state.employeeId) {
    throw new DomainError('SHIFT_NOT_ASSIGNED', 'Shift has no employee assigned');
  }
}

export function assertIsOpen(state: ShiftState): void {
  if (state.employeeId) {
    throw new DomainError(
      'SHIFT_ALREADY_ASSIGNED',
      'Shift already has an employee; use ReassignEmployee',
    );
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/domain/invariants.test.ts`
Expected: All 12 tests PASS

**Step 5: Commit**

```bash
git add src/domain/scheduling/invariants.ts tests/unit/domain/invariants.test.ts
git commit -m "feat(domain): add shift invariant checks with TDD

6 invariant functions: assertTimeValidity, assertIdentityComplete,
assertNotCanceled, assertEditable, assertHasEmployee, assertIsOpen. 12 tests."
```

---

## Task 4: Shift Aggregate (evolve + replay)

**Files:**
- Create: `src/domain/scheduling/shift-aggregate.ts`
- Create: `tests/unit/domain/shift-aggregate.test.ts`

This task implements `evolve` and `replay` only. `decide` comes in Task 5.

**Step 1: Write the failing tests for evolve/replay**

```typescript
// tests/unit/domain/shift-aggregate.test.ts
import { describe, it, expect } from 'vitest';
import { evolve, replay, emptyState } from '@/domain/scheduling/shift-aggregate';
import type { ShiftEvent, Actor } from '@/domain/scheduling/types';

const actor: Actor = { type: 'manager', actorId: 'mgr1' };
const now = '2026-02-28T20:00:00Z';
const shiftId = 's1';

function envelope(type: string) {
  return { eventId: 'ev1', shiftId, occurredAt: now, actor };
}

describe('emptyState', () => {
  it('returns state with version 0 and no fields', () => {
    const s = emptyState('s1');
    expect(s.shiftId).toBe('s1');
    expect(s.version).toBe(0);
    expect(s.status).toBeUndefined();
  });
});

describe('evolve', () => {
  it('applies ShiftCreated', () => {
    const event: ShiftEvent = {
      ...envelope('ShiftCreated'),
      type: 'ShiftCreated',
      payload: {
        restaurantId: 'r1', locationId: 'l1', timezone: 'America/Chicago',
        businessDate: '2026-02-28', startAt: '2026-02-28T14:00:00Z',
        endAt: '2026-02-28T22:00:00Z', roleId: 'cashier', employeeId: null,
      },
    };
    const s = evolve(emptyState(shiftId), event);
    expect(s.status).toBe('Draft');
    expect(s.restaurantId).toBe('r1');
    expect(s.employeeId).toBeNull();
    expect(s.version).toBe(1);
  });

  it('applies ShiftTimeChanged', () => {
    const created: ShiftEvent = {
      ...envelope('ShiftCreated'), type: 'ShiftCreated',
      payload: {
        restaurantId: 'r1', locationId: 'l1', timezone: 'America/Chicago',
        businessDate: '2026-02-28', startAt: '2026-02-28T14:00:00Z',
        endAt: '2026-02-28T22:00:00Z', roleId: 'cashier', employeeId: null,
      },
    };
    const changed: ShiftEvent = {
      ...envelope('ShiftTimeChanged'), type: 'ShiftTimeChanged',
      payload: {
        oldStartAt: '2026-02-28T14:00:00Z', oldEndAt: '2026-02-28T22:00:00Z',
        newStartAt: '2026-02-28T15:00:00Z', newEndAt: '2026-02-28T23:00:00Z',
      },
    };
    const s = evolve(evolve(emptyState(shiftId), created), changed);
    expect(s.startAt).toBe('2026-02-28T15:00:00Z');
    expect(s.endAt).toBe('2026-02-28T23:00:00Z');
    expect(s.version).toBe(2);
  });

  it('applies ShiftAssigned', () => {
    const created: ShiftEvent = {
      ...envelope('ShiftCreated'), type: 'ShiftCreated',
      payload: {
        restaurantId: 'r1', locationId: 'l1', timezone: 'America/Chicago',
        businessDate: '2026-02-28', startAt: '2026-02-28T14:00:00Z',
        endAt: '2026-02-28T22:00:00Z', roleId: 'cashier', employeeId: null,
      },
    };
    const assigned: ShiftEvent = {
      ...envelope('ShiftAssigned'), type: 'ShiftAssigned',
      payload: { employeeId: 'e1' },
    };
    const s = evolve(evolve(emptyState(shiftId), created), assigned);
    expect(s.employeeId).toBe('e1');
  });

  it('applies ShiftUnassigned', () => {
    const s = evolve(
      { ...emptyState(shiftId), employeeId: 'e1', status: 'Draft', version: 2 },
      { ...envelope('ShiftUnassigned'), type: 'ShiftUnassigned', payload: { oldEmployeeId: 'e1' } },
    );
    expect(s.employeeId).toBeNull();
  });

  it('applies ShiftReassigned', () => {
    const s = evolve(
      { ...emptyState(shiftId), employeeId: 'e1', status: 'Draft', version: 2 },
      { ...envelope('ShiftReassigned'), type: 'ShiftReassigned', payload: { oldEmployeeId: 'e1', newEmployeeId: 'e2' } },
    );
    expect(s.employeeId).toBe('e2');
  });

  it('applies ShiftPublished', () => {
    const s = evolve(
      { ...emptyState(shiftId), status: 'Draft', version: 1 },
      { ...envelope('ShiftPublished'), type: 'ShiftPublished', payload: { publishedAt: now } },
    );
    expect(s.status).toBe('Published');
    expect(s.publishedAt).toBe(now);
  });

  it('applies ShiftCanceled', () => {
    const s = evolve(
      { ...emptyState(shiftId), status: 'Draft', version: 1 },
      { ...envelope('ShiftCanceled'), type: 'ShiftCanceled', payload: { canceledAt: now, reasonCode: 'STAFFING_CHANGE' } },
    );
    expect(s.status).toBe('Canceled');
    expect(s.canceledAt).toBe(now);
    expect(s.cancelReasonCode).toBe('STAFFING_CHANGE');
  });

  it('applies ShiftRoleChanged', () => {
    const s = evolve(
      { ...emptyState(shiftId), roleId: 'cashier', status: 'Draft', version: 1 },
      { ...envelope('ShiftRoleChanged'), type: 'ShiftRoleChanged', payload: { oldRoleId: 'cashier', newRoleId: 'bartender' } },
    );
    expect(s.roleId).toBe('bartender');
  });

  it('applies ShiftNotesChanged', () => {
    const s = evolve(
      { ...emptyState(shiftId), status: 'Draft', version: 1 },
      { ...envelope('ShiftNotesChanged'), type: 'ShiftNotesChanged', payload: { oldNotes: undefined, newNotes: 'Training shift' } },
    );
    expect(s.notes).toBe('Training shift');
  });
});

describe('replay', () => {
  it('folds multiple events into final state', () => {
    const events: ShiftEvent[] = [
      {
        ...envelope('ShiftCreated'), type: 'ShiftCreated',
        payload: {
          restaurantId: 'r1', locationId: 'l1', timezone: 'America/Chicago',
          businessDate: '2026-02-28', startAt: '2026-02-28T14:00:00Z',
          endAt: '2026-02-28T22:00:00Z', roleId: 'cashier', employeeId: null,
        },
      },
      { ...envelope('ShiftAssigned'), type: 'ShiftAssigned', payload: { employeeId: 'e1' } },
      { ...envelope('ShiftPublished'), type: 'ShiftPublished', payload: { publishedAt: now } },
    ];
    const s = replay(shiftId, events);
    expect(s.version).toBe(3);
    expect(s.status).toBe('Published');
    expect(s.employeeId).toBe('e1');
    expect(s.restaurantId).toBe('r1');
  });

  it('returns empty state for no events', () => {
    const s = replay('s1', []);
    expect(s.version).toBe(0);
    expect(s.status).toBeUndefined();
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/domain/shift-aggregate.test.ts`
Expected: FAIL (module not found)

**Step 3: Write the implementation**

```typescript
// src/domain/scheduling/shift-aggregate.ts
import type { ShiftState, ShiftEvent, ShiftCommand, UUID, Instant, Actor } from './types';
import { DomainError } from './types';
import {
  assertTimeValidity,
  assertIdentityComplete,
  assertEditable,
  assertNotCanceled,
  assertHasEmployee,
  assertIsOpen,
} from './invariants';

// ---------------------------------------------------------------------------
// Empty state factory
// ---------------------------------------------------------------------------

export function emptyState(shiftId: UUID): ShiftState {
  return { shiftId, version: 0 };
}

// ---------------------------------------------------------------------------
// Evolve: apply a single event to produce new state (pure)
// ---------------------------------------------------------------------------

export function evolve(state: ShiftState, event: ShiftEvent): ShiftState {
  const version = state.version + 1;

  switch (event.type) {
    case 'ShiftCreated':
      return { ...state, ...event.payload, status: 'Draft', version };

    case 'ShiftTimeChanged':
      return { ...state, startAt: event.payload.newStartAt, endAt: event.payload.newEndAt, version };

    case 'ShiftRoleChanged':
      return { ...state, roleId: event.payload.newRoleId, version };

    case 'ShiftTypeChanged':
      return { ...state, shiftTypeId: event.payload.newShiftTypeId, version };

    case 'ShiftStationsChanged':
      return { ...state, stations: event.payload.newStations, version };

    case 'ShiftNotesChanged':
      return { ...state, notes: event.payload.newNotes, version };

    case 'ShiftAssigned':
      return { ...state, employeeId: event.payload.employeeId, version };

    case 'ShiftUnassigned':
      return { ...state, employeeId: null, version };

    case 'ShiftReassigned':
      return { ...state, employeeId: event.payload.newEmployeeId, version };

    case 'ShiftPublished':
      return { ...state, status: 'Published', publishedAt: event.payload.publishedAt, version };

    case 'ShiftUnpublished':
      return { ...state, status: 'Draft', publishedAt: undefined, version };

    case 'ShiftCanceled':
      return {
        ...state,
        status: 'Canceled',
        canceledAt: event.payload.canceledAt,
        cancelReasonCode: event.payload.reasonCode,
        version,
      };
  }
}

// ---------------------------------------------------------------------------
// Replay: fold events from empty state
// ---------------------------------------------------------------------------

export function replay(shiftId: UUID, events: ShiftEvent[]): ShiftState {
  return events.reduce(evolve, emptyState(shiftId));
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/domain/shift-aggregate.test.ts`
Expected: All 12 tests PASS

**Step 5: Commit**

```bash
git add src/domain/scheduling/shift-aggregate.ts tests/unit/domain/shift-aggregate.test.ts
git commit -m "feat(domain): add evolve/replay for shift aggregate

Pure state derivation from events. Handles all 12 event types.
12 tests covering each event application and multi-event replay."
```

---

## Task 5: Shift Aggregate (decide + apply)

**Files:**
- Modify: `src/domain/scheduling/shift-aggregate.ts`
- Modify: `tests/unit/domain/shift-aggregate.test.ts`

**Step 1: Add failing tests for decide/apply**

Append to `tests/unit/domain/shift-aggregate.test.ts`:

```typescript
import { decide, apply } from '@/domain/scheduling/shift-aggregate';
// (add to existing imports at top)

const cmd = (type: string, version: number, payload: Record<string, unknown>) => ({
  commandId: 'cmd1',
  shiftId,
  expectedVersion: version,
  actor,
  type,
  payload,
});

const createPayload = {
  restaurantId: 'r1', locationId: 'l1', timezone: 'America/Chicago',
  startAt: '2026-02-28T14:00:00Z', endAt: '2026-02-28T22:00:00Z', roleId: 'cashier',
};

describe('decide', () => {
  describe('CreateShift', () => {
    it('emits ShiftCreated for valid input', () => {
      const events = decide(emptyState(shiftId), cmd('CreateShift', 0, createPayload) as any);
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('ShiftCreated');
    });

    it('rejects end <= start', () => {
      expect(() => decide(emptyState(shiftId), cmd('CreateShift', 0, {
        ...createPayload, startAt: '2026-02-28T22:00:00Z', endAt: '2026-02-28T22:00:00Z',
      }) as any)).toThrow('CMD_BAD_TIME');
    });

    it('rejects missing required fields', () => {
      expect(() => decide(emptyState(shiftId), cmd('CreateShift', 0, {
        startAt: '2026-02-28T14:00:00Z', endAt: '2026-02-28T22:00:00Z',
      }) as any)).toThrow('CMD_MISSING_FIELDS');
    });

    it('allows open shift (no employeeId)', () => {
      const events = decide(emptyState(shiftId), cmd('CreateShift', 0, createPayload) as any);
      const s = replay(shiftId, events);
      expect(s.employeeId).toBeNull();
      expect(s.status).toBe('Draft');
    });

    it('allows filled shift (with employeeId)', () => {
      const events = decide(emptyState(shiftId), cmd('CreateShift', 0, {
        ...createPayload, employeeId: 'e1',
      }) as any);
      const s = replay(shiftId, events);
      expect(s.employeeId).toBe('e1');
    });
  });

  describe('ChangeShiftTime', () => {
    it('emits ShiftTimeChanged on Draft', () => {
      const state = replay(shiftId, decide(emptyState(shiftId), cmd('CreateShift', 0, createPayload) as any));
      const events = decide(state, cmd('ChangeShiftTime', 1, {
        newStartAt: '2026-02-28T15:00:00Z', newEndAt: '2026-02-28T23:00:00Z',
      }) as any);
      expect(events[0].type).toBe('ShiftTimeChanged');
    });

    it('emits ShiftTimeChanged on Published', () => {
      let events = decide(emptyState(shiftId), cmd('CreateShift', 0, createPayload) as any);
      events = [...events, ...decide(replay(shiftId, events), cmd('PublishShift', 1, {}) as any)];
      const state = replay(shiftId, events);
      const newEvents = decide(state, cmd('ChangeShiftTime', 2, {
        newStartAt: '2026-02-28T15:00:00Z', newEndAt: '2026-02-28T23:00:00Z',
      }) as any);
      expect(newEvents[0].type).toBe('ShiftTimeChanged');
    });

    it('rejects on Canceled', () => {
      let events = decide(emptyState(shiftId), cmd('CreateShift', 0, createPayload) as any);
      events = [...events, ...decide(replay(shiftId, events), cmd('CancelShift', 1, { reasonCode: 'TEST' }) as any)];
      const state = replay(shiftId, events);
      expect(() => decide(state, cmd('ChangeShiftTime', 2, {
        newStartAt: '2026-02-28T15:00:00Z', newEndAt: '2026-02-28T23:00:00Z',
      }) as any)).toThrow('SHIFT_CANCELED');
    });

    it('rejects invalid time window', () => {
      const state = replay(shiftId, decide(emptyState(shiftId), cmd('CreateShift', 0, createPayload) as any));
      expect(() => decide(state, cmd('ChangeShiftTime', 1, {
        newStartAt: '2026-02-28T22:00:00Z', newEndAt: '2026-02-28T22:00:00Z',
      }) as any)).toThrow('CMD_BAD_TIME');
    });
  });

  describe('ChangeRole', () => {
    it('emits ShiftRoleChanged', () => {
      const state = replay(shiftId, decide(emptyState(shiftId), cmd('CreateShift', 0, createPayload) as any));
      const events = decide(state, cmd('ChangeRole', 1, { newRoleId: 'bartender' }) as any);
      expect(events[0].type).toBe('ShiftRoleChanged');
      expect((events[0] as any).payload.oldRoleId).toBe('cashier');
    });
  });

  describe('AssignEmployee', () => {
    it('emits ShiftAssigned for open shift', () => {
      const state = replay(shiftId, decide(emptyState(shiftId), cmd('CreateShift', 0, createPayload) as any));
      const events = decide(state, cmd('AssignEmployee', 1, { employeeId: 'e1' }) as any);
      expect(events[0].type).toBe('ShiftAssigned');
    });

    it('rejects when already assigned', () => {
      let events = decide(emptyState(shiftId), cmd('CreateShift', 0, createPayload) as any);
      events = [...events, ...decide(replay(shiftId, events), cmd('AssignEmployee', 1, { employeeId: 'e1' }) as any)];
      const state = replay(shiftId, events);
      expect(() => decide(state, cmd('AssignEmployee', 2, { employeeId: 'e2' }) as any))
        .toThrow('SHIFT_ALREADY_ASSIGNED');
    });
  });

  describe('UnassignEmployee', () => {
    it('emits ShiftUnassigned', () => {
      let events = decide(emptyState(shiftId), cmd('CreateShift', 0, createPayload) as any);
      events = [...events, ...decide(replay(shiftId, events), cmd('AssignEmployee', 1, { employeeId: 'e1' }) as any)];
      const state = replay(shiftId, events);
      const newEvents = decide(state, cmd('UnassignEmployee', 2, {}) as any);
      expect(newEvents[0].type).toBe('ShiftUnassigned');
    });

    it('rejects when no employee', () => {
      const state = replay(shiftId, decide(emptyState(shiftId), cmd('CreateShift', 0, createPayload) as any));
      expect(() => decide(state, cmd('UnassignEmployee', 1, {}) as any)).toThrow('SHIFT_NOT_ASSIGNED');
    });
  });

  describe('ReassignEmployee', () => {
    it('emits ShiftReassigned', () => {
      let events = decide(emptyState(shiftId), cmd('CreateShift', 0, createPayload) as any);
      events = [...events, ...decide(replay(shiftId, events), cmd('AssignEmployee', 1, { employeeId: 'e1' }) as any)];
      const state = replay(shiftId, events);
      const newEvents = decide(state, cmd('ReassignEmployee', 2, { newEmployeeId: 'e2' }) as any);
      expect(newEvents[0].type).toBe('ShiftReassigned');
      expect((newEvents[0] as any).payload.oldEmployeeId).toBe('e1');
    });

    it('rejects same employee (NO_OP)', () => {
      let events = decide(emptyState(shiftId), cmd('CreateShift', 0, createPayload) as any);
      events = [...events, ...decide(replay(shiftId, events), cmd('AssignEmployee', 1, { employeeId: 'e1' }) as any)];
      const state = replay(shiftId, events);
      expect(() => decide(state, cmd('ReassignEmployee', 2, { newEmployeeId: 'e1' }) as any)).toThrow('NO_OP');
    });
  });

  describe('PublishShift', () => {
    it('emits ShiftPublished from Draft', () => {
      const state = replay(shiftId, decide(emptyState(shiftId), cmd('CreateShift', 0, createPayload) as any));
      const events = decide(state, cmd('PublishShift', 1, {}) as any);
      expect(events[0].type).toBe('ShiftPublished');
    });

    it('rejects from Published', () => {
      let events = decide(emptyState(shiftId), cmd('CreateShift', 0, createPayload) as any);
      events = [...events, ...decide(replay(shiftId, events), cmd('PublishShift', 1, {}) as any)];
      const state = replay(shiftId, events);
      expect(() => decide(state, cmd('PublishShift', 2, {}) as any)).toThrow('BAD_STATUS');
    });

    it('rejects from Canceled', () => {
      let events = decide(emptyState(shiftId), cmd('CreateShift', 0, createPayload) as any);
      events = [...events, ...decide(replay(shiftId, events), cmd('CancelShift', 1, { reasonCode: 'TEST' }) as any)];
      const state = replay(shiftId, events);
      expect(() => decide(state, cmd('PublishShift', 2, {}) as any)).toThrow('SHIFT_CANCELED');
    });
  });

  describe('CancelShift', () => {
    it('emits ShiftCanceled from Draft', () => {
      const state = replay(shiftId, decide(emptyState(shiftId), cmd('CreateShift', 0, createPayload) as any));
      const events = decide(state, cmd('CancelShift', 1, { reasonCode: 'STAFFING_CHANGE' }) as any);
      expect(events[0].type).toBe('ShiftCanceled');
    });

    it('emits ShiftCanceled from Published', () => {
      let events = decide(emptyState(shiftId), cmd('CreateShift', 0, createPayload) as any);
      events = [...events, ...decide(replay(shiftId, events), cmd('PublishShift', 1, {}) as any)];
      const state = replay(shiftId, events);
      const newEvents = decide(state, cmd('CancelShift', 2, { reasonCode: 'NO_LONGER_NEEDED' }) as any);
      expect(newEvents[0].type).toBe('ShiftCanceled');
    });

    it('rejects when already canceled', () => {
      let events = decide(emptyState(shiftId), cmd('CreateShift', 0, createPayload) as any);
      events = [...events, ...decide(replay(shiftId, events), cmd('CancelShift', 1, { reasonCode: 'TEST' }) as any)];
      const state = replay(shiftId, events);
      expect(() => decide(state, cmd('CancelShift', 2, { reasonCode: 'AGAIN' }) as any)).toThrow('ALREADY_CANCELED');
    });

    it('rejects missing reasonCode', () => {
      const state = replay(shiftId, decide(emptyState(shiftId), cmd('CreateShift', 0, createPayload) as any));
      expect(() => decide(state, cmd('CancelShift', 1, {}) as any)).toThrow('CMD_MISSING_REASON');
    });
  });

  describe('Optimistic concurrency', () => {
    it('rejects wrong expectedVersion', () => {
      const state = replay(shiftId, decide(emptyState(shiftId), cmd('CreateShift', 0, createPayload) as any));
      expect(() => decide(state, cmd('PublishShift', 999, {}) as any)).toThrow('CONCURRENCY');
    });
  });
});

describe('apply', () => {
  it('chains decide + evolve to accumulate events', () => {
    let events: ShiftEvent[] = [];
    events = apply(shiftId, events, cmd('CreateShift', 0, createPayload) as any);
    events = apply(shiftId, events, cmd('AssignEmployee', 1, { employeeId: 'e1' }) as any);
    events = apply(shiftId, events, cmd('PublishShift', 2, {}) as any);
    const s = replay(shiftId, events);
    expect(s.version).toBe(3);
    expect(s.status).toBe('Published');
    expect(s.employeeId).toBe('e1');
  });

  it('terminal state: cancel blocks further edits', () => {
    let events: ShiftEvent[] = [];
    events = apply(shiftId, events, cmd('CreateShift', 0, createPayload) as any);
    events = apply(shiftId, events, cmd('CancelShift', 1, { reasonCode: 'STAFFING_CHANGE' }) as any);
    expect(() => apply(shiftId, events, cmd('ChangeShiftTime', 2, {
      newStartAt: '2026-02-28T15:00:00Z', newEndAt: '2026-02-28T23:00:00Z',
    }) as any)).toThrow('SHIFT_CANCELED');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/domain/shift-aggregate.test.ts`
Expected: FAIL (`decide` and `apply` not exported)

**Step 3: Add decide and apply to shift-aggregate.ts**

Append to `src/domain/scheduling/shift-aggregate.ts`:

```typescript
// ---------------------------------------------------------------------------
// Decide: validate command against state, produce events (pure)
// ---------------------------------------------------------------------------

export function decide(state: ShiftState, command: ShiftCommand): ShiftEvent[] {
  if (command.expectedVersion !== state.version) {
    throw new DomainError('CONCURRENCY', `Expected version ${command.expectedVersion}, got ${state.version}`);
  }

  const now = new Date().toISOString();
  const base = { eventId: crypto.randomUUID(), shiftId: command.shiftId, occurredAt: now, actor: command.actor };

  switch (command.type) {
    case 'CreateShift': {
      const p = command.payload;
      if (!p.restaurantId || !p.locationId || !p.timezone || !p.startAt || !p.endAt || !p.roleId) {
        throw new DomainError('CMD_MISSING_FIELDS', 'CreateShift requires restaurantId, locationId, timezone, startAt, endAt, roleId');
      }
      assertTimeValidity(p.startAt, p.endAt);
      return [{
        ...base, type: 'ShiftCreated',
        payload: {
          restaurantId: p.restaurantId, locationId: p.locationId, timezone: p.timezone,
          businessDate: p.businessDate || p.startAt.slice(0, 10),
          startAt: p.startAt, endAt: p.endAt, roleId: p.roleId,
          shiftTypeId: p.shiftTypeId ?? null, employeeId: p.employeeId ?? null,
          stations: p.stations, notes: p.notes,
        },
      }];
    }

    case 'ChangeShiftTime': {
      assertEditable(state);
      assertTimeValidity(command.payload.newStartAt, command.payload.newEndAt);
      return [{
        ...base, type: 'ShiftTimeChanged',
        payload: {
          oldStartAt: state.startAt!, oldEndAt: state.endAt!,
          newStartAt: command.payload.newStartAt, newEndAt: command.payload.newEndAt,
          reason: command.payload.reason,
        },
      }];
    }

    case 'ChangeRole': {
      assertEditable(state);
      if (command.payload.newRoleId === state.roleId) {
        throw new DomainError('NO_OP', 'New role is same as current');
      }
      return [{
        ...base, type: 'ShiftRoleChanged',
        payload: { oldRoleId: state.roleId!, newRoleId: command.payload.newRoleId, reason: command.payload.reason },
      }];
    }

    case 'AssignEmployee': {
      assertEditable(state);
      if (!command.payload.employeeId) {
        throw new DomainError('CMD_MISSING_EMPLOYEE', 'employeeId is required');
      }
      assertIsOpen(state);
      return [{
        ...base, type: 'ShiftAssigned',
        payload: { employeeId: command.payload.employeeId, reason: command.payload.reason },
      }];
    }

    case 'UnassignEmployee': {
      assertEditable(state);
      assertHasEmployee(state);
      return [{
        ...base, type: 'ShiftUnassigned',
        payload: { oldEmployeeId: state.employeeId!, reason: command.payload.reason },
      }];
    }

    case 'ReassignEmployee': {
      assertEditable(state);
      assertHasEmployee(state);
      if (!command.payload.newEmployeeId) {
        throw new DomainError('CMD_MISSING_EMPLOYEE', 'newEmployeeId is required');
      }
      if (command.payload.newEmployeeId === state.employeeId) {
        throw new DomainError('NO_OP', 'New employee is same as current');
      }
      return [{
        ...base, type: 'ShiftReassigned',
        payload: { oldEmployeeId: state.employeeId!, newEmployeeId: command.payload.newEmployeeId, reason: command.payload.reason },
      }];
    }

    case 'PublishShift': {
      assertNotCanceled(state);
      if (state.status !== 'Draft') {
        throw new DomainError('BAD_STATUS', 'Only Draft shifts can be published');
      }
      assertIdentityComplete(state);
      return [{
        ...base, type: 'ShiftPublished',
        payload: { publishedAt: now },
      }];
    }

    case 'CancelShift': {
      if (state.status === 'Canceled') {
        throw new DomainError('ALREADY_CANCELED', 'Shift is already canceled');
      }
      assertEditable(state);
      if (!command.payload.reasonCode) {
        throw new DomainError('CMD_MISSING_REASON', 'CancelShift requires a reasonCode');
      }
      return [{
        ...base, type: 'ShiftCanceled',
        payload: { canceledAt: now, reasonCode: command.payload.reasonCode, notes: command.payload.notes },
      }];
    }
  }
}

// ---------------------------------------------------------------------------
// Apply: convenience — decide + evolve in one step
// ---------------------------------------------------------------------------

export function apply(shiftId: UUID, events: ShiftEvent[], command: ShiftCommand): ShiftEvent[] {
  const state = replay(shiftId, events);
  const newEvents = decide(state, command);
  return [...events, ...newEvents];
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/domain/shift-aggregate.test.ts`
Expected: All ~35 tests PASS

**Step 5: Commit**

```bash
git add src/domain/scheduling/shift-aggregate.ts tests/unit/domain/shift-aggregate.test.ts
git commit -m "feat(domain): add decide/apply for shift aggregate commands

8 command handlers with invariant enforcement, optimistic concurrency,
and state machine transitions. ~23 new tests for all commands."
```

---

## Task 6: Policy Interfaces & Implementations

**Files:**
- Create: `src/domain/scheduling/policies.ts`
- Create: `tests/unit/domain/policies.test.ts`

**Step 1: Write the failing tests**

```typescript
// tests/unit/domain/policies.test.ts
import { describe, it, expect } from 'vitest';
import {
  OverlapPolicy,
  RestHoursPolicy,
  AvailabilityPolicy,
  TimeOffPolicy,
  OvertimeForecastPolicy,
} from '@/domain/scheduling/policies';
import type { PolicyContext } from '@/domain/scheduling/types';

const baseContext: PolicyContext = {
  employeeId: 'e1',
  proposedStartAt: '2026-02-28T14:00:00Z',
  proposedEndAt: '2026-02-28T22:00:00Z',
  businessDate: '2026-02-28',
  existingShifts: [],
};

describe('OverlapPolicy', () => {
  const policy = new OverlapPolicy();

  it('returns ok when no existing shifts', () => {
    const result = policy.evaluate(baseContext);
    expect(result.outcome).toBe('ok');
  });

  it('returns ok when shifts do not overlap', () => {
    const result = policy.evaluate({
      ...baseContext,
      existingShifts: [{ shiftId: 's2', startAt: '2026-02-28T06:00:00Z', endAt: '2026-02-28T12:00:00Z' }],
    });
    expect(result.outcome).toBe('ok');
  });

  it('blocks when shifts overlap', () => {
    const result = policy.evaluate({
      ...baseContext,
      existingShifts: [{ shiftId: 's2', startAt: '2026-02-28T20:00:00Z', endAt: '2026-02-29T04:00:00Z' }],
    });
    expect(result.outcome).toBe('block');
    expect(result.code).toBe('POLICY_OVERLAP');
  });
});

describe('RestHoursPolicy', () => {
  const policy = new RestHoursPolicy();

  it('returns ok when sufficient rest (>= 8h)', () => {
    const result = policy.evaluate({
      ...baseContext,
      // Existing shift ends at 04:00, proposed starts at 14:00 = 10h rest
      existingShifts: [{ shiftId: 's2', startAt: '2026-02-27T20:00:00Z', endAt: '2026-02-28T04:00:00Z' }],
    });
    expect(result.outcome).toBe('ok');
  });

  it('warns when insufficient rest (clopening)', () => {
    const result = policy.evaluate({
      ...baseContext,
      proposedStartAt: '2026-02-28T08:00:00Z',
      proposedEndAt: '2026-02-28T14:00:00Z',
      // Existing shift ends at 02:00, proposed starts at 08:00 = 6h rest
      existingShifts: [{ shiftId: 's2', startAt: '2026-02-27T18:00:00Z', endAt: '2026-02-28T02:00:00Z' }],
    });
    expect(result.outcome).toBe('warn');
    expect(result.code).toBe('POLICY_INSUFFICIENT_REST');
  });

  it('returns ok when no prior shifts', () => {
    const result = policy.evaluate(baseContext);
    expect(result.outcome).toBe('ok');
  });
});

describe('AvailabilityPolicy', () => {
  const policy = new AvailabilityPolicy();

  it('returns ok when no availability data', () => {
    const result = policy.evaluate(baseContext);
    expect(result.outcome).toBe('ok');
  });

  it('returns ok when employee is available', () => {
    const result = policy.evaluate({
      ...baseContext,
      availability: [{ dayOfWeek: 6, startTime: '08:00', endTime: '23:00', isAvailable: true }],
    });
    expect(result.outcome).toBe('ok');
  });

  it('warns when employee is marked unavailable for the day', () => {
    // 2026-02-28 is a Saturday (dayOfWeek 6)
    const result = policy.evaluate({
      ...baseContext,
      availability: [{ dayOfWeek: 6, startTime: '08:00', endTime: '23:00', isAvailable: false }],
    });
    expect(result.outcome).toBe('warn');
    expect(result.code).toBe('POLICY_OUTSIDE_AVAILABILITY');
  });
});

describe('TimeOffPolicy', () => {
  const policy = new TimeOffPolicy();

  it('returns ok when no time-off requests', () => {
    const result = policy.evaluate(baseContext);
    expect(result.outcome).toBe('ok');
  });

  it('blocks when approved time-off covers the date', () => {
    const result = policy.evaluate({
      ...baseContext,
      timeOffRequests: [{ startDate: '2026-02-27', endDate: '2026-03-01', status: 'approved' }],
    });
    expect(result.outcome).toBe('block');
    expect(result.code).toBe('POLICY_TIME_OFF');
  });

  it('returns ok when time-off is pending (not approved)', () => {
    const result = policy.evaluate({
      ...baseContext,
      timeOffRequests: [{ startDate: '2026-02-27', endDate: '2026-03-01', status: 'pending' }],
    });
    expect(result.outcome).toBe('ok');
  });

  it('returns ok when time-off does not cover the date', () => {
    const result = policy.evaluate({
      ...baseContext,
      timeOffRequests: [{ startDate: '2026-03-05', endDate: '2026-03-07', status: 'approved' }],
    });
    expect(result.outcome).toBe('ok');
  });
});

describe('OvertimeForecastPolicy', () => {
  const policy = new OvertimeForecastPolicy();

  it('returns ok when under weekly threshold', () => {
    const result = policy.evaluate({
      ...baseContext,
      weeklyMinutesWorked: 1800, // 30h + 8h proposed = 38h < 40h
    });
    expect(result.outcome).toBe('ok');
  });

  it('warns when proposed shift pushes into overtime', () => {
    const result = policy.evaluate({
      ...baseContext,
      weeklyMinutesWorked: 2100, // 35h + 8h proposed = 43h > 40h
    });
    expect(result.outcome).toBe('warn');
    expect(result.code).toBe('POLICY_OVERTIME_FORECAST');
  });

  it('returns ok when no weekly data provided', () => {
    const result = policy.evaluate(baseContext);
    expect(result.outcome).toBe('ok');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/domain/policies.test.ts`
Expected: FAIL (module not found)

**Step 3: Write the implementation**

```typescript
// src/domain/scheduling/policies.ts
import type { PolicyContext, PolicyResult, ShiftPolicy } from './types';
import { MIN_REST_HOURS, DEFAULT_OT_WEEKLY_MINUTES } from './types';

// ---------------------------------------------------------------------------
// OverlapPolicy — blocks if proposed shift overlaps any existing shift
// ---------------------------------------------------------------------------

export class OverlapPolicy implements ShiftPolicy {
  evaluate(ctx: PolicyContext): PolicyResult {
    const pStart = Date.parse(ctx.proposedStartAt);
    const pEnd = Date.parse(ctx.proposedEndAt);

    for (const shift of ctx.existingShifts) {
      const sStart = Date.parse(shift.startAt);
      const sEnd = Date.parse(shift.endAt);

      if (pStart < sEnd && sStart < pEnd) {
        return {
          outcome: 'block',
          code: 'POLICY_OVERLAP',
          message: `Overlaps with shift ${shift.shiftId}`,
        };
      }
    }

    return { outcome: 'ok' };
  }
}

// ---------------------------------------------------------------------------
// RestHoursPolicy — warns if < MIN_REST_HOURS between shifts (clopening)
// ---------------------------------------------------------------------------

export class RestHoursPolicy implements ShiftPolicy {
  evaluate(ctx: PolicyContext): PolicyResult {
    const pStart = Date.parse(ctx.proposedStartAt);
    const pEnd = Date.parse(ctx.proposedEndAt);

    for (const shift of ctx.existingShifts) {
      const sEnd = Date.parse(shift.endAt);
      const sStart = Date.parse(shift.startAt);

      // Gap before proposed shift
      const gapBefore = (pStart - sEnd) / 3_600_000;
      if (gapBefore > 0 && gapBefore < MIN_REST_HOURS) {
        return {
          outcome: 'warn',
          code: 'POLICY_INSUFFICIENT_REST',
          message: `Only ${gapBefore.toFixed(1)}h rest after shift ${shift.shiftId} (minimum ${MIN_REST_HOURS}h)`,
        };
      }

      // Gap after proposed shift
      const gapAfter = (sStart - pEnd) / 3_600_000;
      if (gapAfter > 0 && gapAfter < MIN_REST_HOURS) {
        return {
          outcome: 'warn',
          code: 'POLICY_INSUFFICIENT_REST',
          message: `Only ${gapAfter.toFixed(1)}h rest before shift ${shift.shiftId} (minimum ${MIN_REST_HOURS}h)`,
        };
      }
    }

    return { outcome: 'ok' };
  }
}

// ---------------------------------------------------------------------------
// AvailabilityPolicy — warns if outside declared availability
// ---------------------------------------------------------------------------

export class AvailabilityPolicy implements ShiftPolicy {
  evaluate(ctx: PolicyContext): PolicyResult {
    if (!ctx.availability?.length) return { outcome: 'ok' };

    const shiftDate = new Date(ctx.businessDate + 'T00:00:00Z');
    const dayOfWeek = shiftDate.getUTCDay();

    const match = ctx.availability.find((a) => a.dayOfWeek === dayOfWeek);
    if (match && !match.isAvailable) {
      return {
        outcome: 'warn',
        code: 'POLICY_OUTSIDE_AVAILABILITY',
        message: `Employee is marked unavailable on day ${dayOfWeek}`,
      };
    }

    return { outcome: 'ok' };
  }
}

// ---------------------------------------------------------------------------
// TimeOffPolicy — blocks if approved time-off covers the business date
// ---------------------------------------------------------------------------

export class TimeOffPolicy implements ShiftPolicy {
  evaluate(ctx: PolicyContext): PolicyResult {
    if (!ctx.timeOffRequests?.length) return { outcome: 'ok' };

    for (const req of ctx.timeOffRequests) {
      if (req.status !== 'approved') continue;
      if (ctx.businessDate >= req.startDate && ctx.businessDate <= req.endDate) {
        return {
          outcome: 'block',
          code: 'POLICY_TIME_OFF',
          message: `Employee has approved time off from ${req.startDate} to ${req.endDate}`,
        };
      }
    }

    return { outcome: 'ok' };
  }
}

// ---------------------------------------------------------------------------
// OvertimeForecastPolicy — warns if total weekly hours would exceed threshold
// ---------------------------------------------------------------------------

export class OvertimeForecastPolicy implements ShiftPolicy {
  evaluate(ctx: PolicyContext): PolicyResult {
    if (ctx.weeklyMinutesWorked == null) return { outcome: 'ok' };

    const proposedMinutes =
      (Date.parse(ctx.proposedEndAt) - Date.parse(ctx.proposedStartAt)) / 60_000;
    const totalMinutes = ctx.weeklyMinutesWorked + proposedMinutes;

    if (totalMinutes > DEFAULT_OT_WEEKLY_MINUTES) {
      return {
        outcome: 'warn',
        code: 'POLICY_OVERTIME_FORECAST',
        message: `Projected ${(totalMinutes / 60).toFixed(1)}h this week (threshold: ${DEFAULT_OT_WEEKLY_MINUTES / 60}h)`,
      };
    }

    return { outcome: 'ok' };
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/domain/policies.test.ts`
Expected: All 12 tests PASS

**Step 5: Commit**

```bash
git add src/domain/scheduling/policies.ts tests/unit/domain/policies.test.ts
git commit -m "feat(domain): add 5 shift scheduling policies with TDD

OverlapPolicy (block), RestHoursPolicy (warn clopening),
AvailabilityPolicy (warn), TimeOffPolicy (block), OvertimeForecastPolicy (warn).
12 tests covering ok/warn/block outcomes."
```

---

## Task 7: Barrel Export & Final Verification

**Files:**
- Create: `src/domain/scheduling/index.ts`

**Step 1: Create barrel export**

```typescript
// src/domain/scheduling/index.ts
export { DomainError, MIN_SHIFT_MINUTES, MAX_SHIFT_HOURS, MIN_REST_HOURS, DEFAULT_OT_WEEKLY_MINUTES } from './types';
export type {
  UUID, Instant, Actor, ShiftStatus, ShiftState,
  ShiftEvent, ShiftCommand, PolicyResult, PolicyContext, ShiftPolicy,
  ShiftCreatedEvent, ShiftTimeChangedEvent, ShiftRoleChangedEvent,
  ShiftTypeChangedEvent, ShiftStationsChangedEvent, ShiftNotesChangedEvent,
  ShiftAssignedEvent, ShiftUnassignedEvent, ShiftReassignedEvent,
  ShiftPublishedEvent, ShiftUnpublishedEvent, ShiftCanceledEvent,
  CreateShiftCommand, ChangeShiftTimeCommand, ChangeRoleCommand,
  AssignEmployeeCommand, UnassignEmployeeCommand, ReassignEmployeeCommand,
  PublishShiftCommand, CancelShiftCommand,
} from './types';
export { ShiftInterval } from './shift-interval';
export { emptyState, evolve, replay, decide, apply } from './shift-aggregate';
export {
  assertTimeValidity, assertIdentityComplete, assertNotCanceled,
  assertEditable, assertHasEmployee, assertIsOpen,
} from './invariants';
export {
  OverlapPolicy, RestHoursPolicy, AvailabilityPolicy,
  TimeOffPolicy, OvertimeForecastPolicy,
} from './policies';
```

**Step 2: Run all domain tests**

Run: `npx vitest run tests/unit/domain/`
Expected: All ~50 tests PASS across 4 test files

**Step 3: Run full test suite to verify no regressions**

Run: `npx vitest run`
Expected: All existing tests + new domain tests PASS

**Step 4: Commit**

```bash
git add src/domain/scheduling/index.ts
git commit -m "feat(domain): add barrel export for scheduling domain layer

Public API: types, ShiftInterval, aggregate (decide/evolve/replay/apply),
invariants, and 5 policy classes."
```

---

## Summary

| Task | Files Created | Tests |
|------|--------------|-------|
| 1. Core Types | `types.ts` | 0 (compiler-verified) |
| 2. ShiftInterval | `shift-interval.ts`, `shift-interval.test.ts` | ~14 |
| 3. Invariants | `invariants.ts`, `invariants.test.ts` | ~12 |
| 4. Evolve/Replay | `shift-aggregate.ts`, `shift-aggregate.test.ts` | ~12 |
| 5. Decide/Apply | `shift-aggregate.ts` (modify), test (modify) | ~23 |
| 6. Policies | `policies.ts`, `policies.test.ts` | ~12 |
| 7. Barrel Export | `index.ts` | 0 (verification run) |
| **Total** | **8 new files** | **~73 tests** |
