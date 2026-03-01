import { describe, it, expect } from 'vitest';
import { evolve, replay, emptyState, decide, apply } from '@/domain/scheduling/shift-aggregate';
import type { ShiftEvent, ShiftCommand, Actor } from '@/domain/scheduling/types';

const actor: Actor = { type: 'manager', actorId: 'mgr1' };
const now = '2026-02-28T20:00:00Z';
const shiftId = 's1';

function envelope() {
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
      ...envelope(),
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
      ...envelope(), type: 'ShiftCreated',
      payload: {
        restaurantId: 'r1', locationId: 'l1', timezone: 'America/Chicago',
        businessDate: '2026-02-28', startAt: '2026-02-28T14:00:00Z',
        endAt: '2026-02-28T22:00:00Z', roleId: 'cashier', employeeId: null,
      },
    };
    const changed: ShiftEvent = {
      ...envelope(), type: 'ShiftTimeChanged',
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
      ...envelope(), type: 'ShiftCreated',
      payload: {
        restaurantId: 'r1', locationId: 'l1', timezone: 'America/Chicago',
        businessDate: '2026-02-28', startAt: '2026-02-28T14:00:00Z',
        endAt: '2026-02-28T22:00:00Z', roleId: 'cashier', employeeId: null,
      },
    };
    const assigned: ShiftEvent = {
      ...envelope(), type: 'ShiftAssigned',
      payload: { employeeId: 'e1' },
    };
    const s = evolve(evolve(emptyState(shiftId), created), assigned);
    expect(s.employeeId).toBe('e1');
  });

  it('applies ShiftUnassigned', () => {
    const s = evolve(
      { ...emptyState(shiftId), employeeId: 'e1', status: 'Draft', version: 2 },
      { ...envelope(), type: 'ShiftUnassigned', payload: { oldEmployeeId: 'e1' } },
    );
    expect(s.employeeId).toBeNull();
  });

  it('applies ShiftReassigned', () => {
    const s = evolve(
      { ...emptyState(shiftId), employeeId: 'e1', status: 'Draft', version: 2 },
      { ...envelope(), type: 'ShiftReassigned', payload: { oldEmployeeId: 'e1', newEmployeeId: 'e2' } },
    );
    expect(s.employeeId).toBe('e2');
  });

  it('applies ShiftPublished', () => {
    const s = evolve(
      { ...emptyState(shiftId), status: 'Draft', version: 1 },
      { ...envelope(), type: 'ShiftPublished', payload: { publishedAt: now } },
    );
    expect(s.status).toBe('Published');
    expect(s.publishedAt).toBe(now);
  });

  it('applies ShiftCanceled', () => {
    const s = evolve(
      { ...emptyState(shiftId), status: 'Draft', version: 1 },
      { ...envelope(), type: 'ShiftCanceled', payload: { canceledAt: now, reasonCode: 'STAFFING_CHANGE' } },
    );
    expect(s.status).toBe('Canceled');
    expect(s.canceledAt).toBe(now);
    expect(s.cancelReasonCode).toBe('STAFFING_CHANGE');
  });

  it('applies ShiftRoleChanged', () => {
    const s = evolve(
      { ...emptyState(shiftId), roleId: 'cashier', status: 'Draft', version: 1 },
      { ...envelope(), type: 'ShiftRoleChanged', payload: { oldRoleId: 'cashier', newRoleId: 'bartender' } },
    );
    expect(s.roleId).toBe('bartender');
  });

  it('applies ShiftNotesChanged', () => {
    const s = evolve(
      { ...emptyState(shiftId), status: 'Draft', version: 1 },
      { ...envelope(), type: 'ShiftNotesChanged', payload: { oldNotes: undefined, newNotes: 'Training shift' } },
    );
    expect(s.notes).toBe('Training shift');
  });
});

describe('replay', () => {
  it('folds multiple events into final state', () => {
    const events: ShiftEvent[] = [
      {
        ...envelope(), type: 'ShiftCreated',
        payload: {
          restaurantId: 'r1', locationId: 'l1', timezone: 'America/Chicago',
          businessDate: '2026-02-28', startAt: '2026-02-28T14:00:00Z',
          endAt: '2026-02-28T22:00:00Z', roleId: 'cashier', employeeId: null,
        },
      },
      { ...envelope(), type: 'ShiftAssigned', payload: { employeeId: 'e1' } },
      { ...envelope(), type: 'ShiftPublished', payload: { publishedAt: now } },
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

// Helper to build commands
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
      const events = decide(emptyState(shiftId), cmd('CreateShift', 0, createPayload) as ShiftCommand);
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('ShiftCreated');
    });

    it('rejects end <= start', () => {
      expect(() => decide(emptyState(shiftId), cmd('CreateShift', 0, {
        ...createPayload, startAt: '2026-02-28T22:00:00Z', endAt: '2026-02-28T22:00:00Z',
      }) as ShiftCommand)).toThrow();
    });

    it('rejects missing required fields', () => {
      expect(() => decide(emptyState(shiftId), cmd('CreateShift', 0, {
        startAt: '2026-02-28T14:00:00Z', endAt: '2026-02-28T22:00:00Z',
      }) as ShiftCommand)).toThrow();
    });

    it('allows open shift (no employeeId)', () => {
      const events = decide(emptyState(shiftId), cmd('CreateShift', 0, createPayload) as ShiftCommand);
      const s = replay(shiftId, events);
      expect(s.employeeId).toBeNull();
      expect(s.status).toBe('Draft');
    });

    it('allows filled shift (with employeeId)', () => {
      const events = decide(emptyState(shiftId), cmd('CreateShift', 0, {
        ...createPayload, employeeId: 'e1',
      }) as ShiftCommand);
      const s = replay(shiftId, events);
      expect(s.employeeId).toBe('e1');
    });
  });

  describe('ChangeShiftTime', () => {
    it('emits ShiftTimeChanged on Draft', () => {
      const state = replay(shiftId, decide(emptyState(shiftId), cmd('CreateShift', 0, createPayload) as ShiftCommand));
      const events = decide(state, cmd('ChangeShiftTime', 1, {
        newStartAt: '2026-02-28T15:00:00Z', newEndAt: '2026-02-28T23:00:00Z',
      }) as ShiftCommand);
      expect(events[0].type).toBe('ShiftTimeChanged');
    });

    it('emits ShiftTimeChanged on Published', () => {
      let events = decide(emptyState(shiftId), cmd('CreateShift', 0, createPayload) as ShiftCommand);
      events = [...events, ...decide(replay(shiftId, events), cmd('PublishShift', 1, {}) as ShiftCommand)];
      const state = replay(shiftId, events);
      const newEvents = decide(state, cmd('ChangeShiftTime', 2, {
        newStartAt: '2026-02-28T15:00:00Z', newEndAt: '2026-02-28T23:00:00Z',
      }) as ShiftCommand);
      expect(newEvents[0].type).toBe('ShiftTimeChanged');
    });

    it('rejects on Canceled', () => {
      let events = decide(emptyState(shiftId), cmd('CreateShift', 0, createPayload) as ShiftCommand);
      events = [...events, ...decide(replay(shiftId, events), cmd('CancelShift', 1, { reasonCode: 'TEST' }) as ShiftCommand)];
      const state = replay(shiftId, events);
      expect(() => decide(state, cmd('ChangeShiftTime', 2, {
        newStartAt: '2026-02-28T15:00:00Z', newEndAt: '2026-02-28T23:00:00Z',
      }) as ShiftCommand)).toThrow();
    });

    it('rejects invalid time window', () => {
      const state = replay(shiftId, decide(emptyState(shiftId), cmd('CreateShift', 0, createPayload) as ShiftCommand));
      expect(() => decide(state, cmd('ChangeShiftTime', 1, {
        newStartAt: '2026-02-28T22:00:00Z', newEndAt: '2026-02-28T22:00:00Z',
      }) as ShiftCommand)).toThrow();
    });
  });

  describe('ChangeRole', () => {
    it('emits ShiftRoleChanged', () => {
      const state = replay(shiftId, decide(emptyState(shiftId), cmd('CreateShift', 0, createPayload) as ShiftCommand));
      const events = decide(state, cmd('ChangeRole', 1, { newRoleId: 'bartender' }) as ShiftCommand);
      expect(events[0].type).toBe('ShiftRoleChanged');
      expect((events[0] as ShiftEvent & { payload: { oldRoleId: string } }).payload.oldRoleId).toBe('cashier');
    });
  });

  describe('AssignEmployee', () => {
    it('emits ShiftAssigned for open shift', () => {
      const state = replay(shiftId, decide(emptyState(shiftId), cmd('CreateShift', 0, createPayload) as ShiftCommand));
      const events = decide(state, cmd('AssignEmployee', 1, { employeeId: 'e1' }) as ShiftCommand);
      expect(events[0].type).toBe('ShiftAssigned');
    });

    it('rejects when already assigned', () => {
      let events = decide(emptyState(shiftId), cmd('CreateShift', 0, createPayload) as ShiftCommand);
      events = [...events, ...decide(replay(shiftId, events), cmd('AssignEmployee', 1, { employeeId: 'e1' }) as ShiftCommand)];
      const state = replay(shiftId, events);
      expect(() => decide(state, cmd('AssignEmployee', 2, { employeeId: 'e2' }) as ShiftCommand)).toThrow();
    });
  });

  describe('UnassignEmployee', () => {
    it('emits ShiftUnassigned', () => {
      let events = decide(emptyState(shiftId), cmd('CreateShift', 0, createPayload) as ShiftCommand);
      events = [...events, ...decide(replay(shiftId, events), cmd('AssignEmployee', 1, { employeeId: 'e1' }) as ShiftCommand)];
      const state = replay(shiftId, events);
      const newEvents = decide(state, cmd('UnassignEmployee', 2, {}) as ShiftCommand);
      expect(newEvents[0].type).toBe('ShiftUnassigned');
    });

    it('rejects when no employee', () => {
      const state = replay(shiftId, decide(emptyState(shiftId), cmd('CreateShift', 0, createPayload) as ShiftCommand));
      expect(() => decide(state, cmd('UnassignEmployee', 1, {}) as ShiftCommand)).toThrow();
    });
  });

  describe('ReassignEmployee', () => {
    it('emits ShiftReassigned', () => {
      let events = decide(emptyState(shiftId), cmd('CreateShift', 0, createPayload) as ShiftCommand);
      events = [...events, ...decide(replay(shiftId, events), cmd('AssignEmployee', 1, { employeeId: 'e1' }) as ShiftCommand)];
      const state = replay(shiftId, events);
      const newEvents = decide(state, cmd('ReassignEmployee', 2, { newEmployeeId: 'e2' }) as ShiftCommand);
      expect(newEvents[0].type).toBe('ShiftReassigned');
      expect((newEvents[0] as ShiftEvent & { payload: { oldEmployeeId: string } }).payload.oldEmployeeId).toBe('e1');
    });

    it('rejects same employee (NO_OP)', () => {
      let events = decide(emptyState(shiftId), cmd('CreateShift', 0, createPayload) as ShiftCommand);
      events = [...events, ...decide(replay(shiftId, events), cmd('AssignEmployee', 1, { employeeId: 'e1' }) as ShiftCommand)];
      const state = replay(shiftId, events);
      expect(() => decide(state, cmd('ReassignEmployee', 2, { newEmployeeId: 'e1' }) as ShiftCommand)).toThrow();
    });
  });

  describe('PublishShift', () => {
    it('emits ShiftPublished from Draft', () => {
      const state = replay(shiftId, decide(emptyState(shiftId), cmd('CreateShift', 0, createPayload) as ShiftCommand));
      const events = decide(state, cmd('PublishShift', 1, {}) as ShiftCommand);
      expect(events[0].type).toBe('ShiftPublished');
    });

    it('rejects from Published', () => {
      let events = decide(emptyState(shiftId), cmd('CreateShift', 0, createPayload) as ShiftCommand);
      events = [...events, ...decide(replay(shiftId, events), cmd('PublishShift', 1, {}) as ShiftCommand)];
      const state = replay(shiftId, events);
      expect(() => decide(state, cmd('PublishShift', 2, {}) as ShiftCommand)).toThrow();
    });

    it('rejects from Canceled', () => {
      let events = decide(emptyState(shiftId), cmd('CreateShift', 0, createPayload) as ShiftCommand);
      events = [...events, ...decide(replay(shiftId, events), cmd('CancelShift', 1, { reasonCode: 'TEST' }) as ShiftCommand)];
      const state = replay(shiftId, events);
      expect(() => decide(state, cmd('PublishShift', 2, {}) as ShiftCommand)).toThrow();
    });
  });

  describe('CancelShift', () => {
    it('emits ShiftCanceled from Draft', () => {
      const state = replay(shiftId, decide(emptyState(shiftId), cmd('CreateShift', 0, createPayload) as ShiftCommand));
      const events = decide(state, cmd('CancelShift', 1, { reasonCode: 'STAFFING_CHANGE' }) as ShiftCommand);
      expect(events[0].type).toBe('ShiftCanceled');
    });

    it('emits ShiftCanceled from Published', () => {
      let events = decide(emptyState(shiftId), cmd('CreateShift', 0, createPayload) as ShiftCommand);
      events = [...events, ...decide(replay(shiftId, events), cmd('PublishShift', 1, {}) as ShiftCommand)];
      const state = replay(shiftId, events);
      const newEvents = decide(state, cmd('CancelShift', 2, { reasonCode: 'NO_LONGER_NEEDED' }) as ShiftCommand);
      expect(newEvents[0].type).toBe('ShiftCanceled');
    });

    it('rejects when already canceled', () => {
      let events = decide(emptyState(shiftId), cmd('CreateShift', 0, createPayload) as ShiftCommand);
      events = [...events, ...decide(replay(shiftId, events), cmd('CancelShift', 1, { reasonCode: 'TEST' }) as ShiftCommand)];
      const state = replay(shiftId, events);
      expect(() => decide(state, cmd('CancelShift', 2, { reasonCode: 'AGAIN' }) as ShiftCommand)).toThrow();
    });

    it('rejects missing reasonCode', () => {
      const state = replay(shiftId, decide(emptyState(shiftId), cmd('CreateShift', 0, createPayload) as ShiftCommand));
      expect(() => decide(state, cmd('CancelShift', 1, {}) as ShiftCommand)).toThrow();
    });
  });

  describe('Optimistic concurrency', () => {
    it('rejects wrong expectedVersion', () => {
      const state = replay(shiftId, decide(emptyState(shiftId), cmd('CreateShift', 0, createPayload) as ShiftCommand));
      expect(() => decide(state, cmd('PublishShift', 999, {}) as ShiftCommand)).toThrow();
    });
  });
});

describe('apply', () => {
  it('chains decide + evolve to accumulate events', () => {
    let events: ShiftEvent[] = [];
    events = apply(shiftId, events, cmd('CreateShift', 0, createPayload) as ShiftCommand);
    events = apply(shiftId, events, cmd('AssignEmployee', 1, { employeeId: 'e1' }) as ShiftCommand);
    events = apply(shiftId, events, cmd('PublishShift', 2, {}) as ShiftCommand);
    const s = replay(shiftId, events);
    expect(s.version).toBe(3);
    expect(s.status).toBe('Published');
    expect(s.employeeId).toBe('e1');
  });

  it('terminal state: cancel blocks further edits', () => {
    let events: ShiftEvent[] = [];
    events = apply(shiftId, events, cmd('CreateShift', 0, createPayload) as ShiftCommand);
    events = apply(shiftId, events, cmd('CancelShift', 1, { reasonCode: 'STAFFING_CHANGE' }) as ShiftCommand);
    expect(() => apply(shiftId, events, cmd('ChangeShiftTime', 2, {
      newStartAt: '2026-02-28T15:00:00Z', newEndAt: '2026-02-28T23:00:00Z',
    }) as ShiftCommand)).toThrow();
  });
});
