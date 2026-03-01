import { describe, it, expect } from 'vitest';
import { evolve, replay, emptyState } from '@/domain/scheduling/shift-aggregate';
import type { ShiftEvent, Actor } from '@/domain/scheduling/types';

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
