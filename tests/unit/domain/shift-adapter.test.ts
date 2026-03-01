import { describe, it, expect } from 'vitest';
import {
  dbShiftToState,
  buildCreateCommand,
  buildChangeTimeCommand,
  buildAssignCommand,
  buildUnassignCommand,
  buildReassignCommand,
  buildCancelCommand,
  buildPolicyContext,
} from '@/domain/scheduling/adapter';
import type { Shift } from '@/types/scheduling';
import type { ShiftState } from '@/domain/scheduling/types';

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

function makeShift(overrides: Partial<Shift> = {}): Shift {
  return {
    id: 'shift-1',
    restaurant_id: 'rest-1',
    employee_id: 'emp-1',
    start_time: '2026-03-01T09:00:00.000Z',
    end_time: '2026-03-01T17:00:00.000Z',
    break_duration: 30,
    position: 'cook',
    status: 'scheduled',
    is_published: false,
    locked: false,
    created_at: '2026-02-28T00:00:00Z',
    updated_at: '2026-02-28T00:00:00Z',
    ...overrides,
  } as Shift;
}

function makeState(overrides: Partial<ShiftState> = {}): ShiftState {
  return {
    shiftId: 'shift-1',
    restaurantId: 'rest-1',
    locationId: 'rest-1',
    timezone: 'America/Chicago',
    businessDate: '2026-03-01',
    startAt: '2026-03-01T09:00:00.000Z',
    endAt: '2026-03-01T17:00:00.000Z',
    roleId: 'cook',
    shiftTypeId: null,
    employeeId: 'emp-1',
    status: 'Draft',
    version: 1,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Status Mapping
// ---------------------------------------------------------------------------

describe('dbShiftToState - status mapping', () => {
  it('maps cancelled status to Canceled', () => {
    const shift = makeShift({ status: 'cancelled' });
    const state = dbShiftToState(shift);
    expect(state.status).toBe('Canceled');
  });

  it('maps locked: true to Published', () => {
    const shift = makeShift({ locked: true, status: 'scheduled' });
    const state = dbShiftToState(shift);
    expect(state.status).toBe('Published');
  });

  it('maps locked: false + scheduled to Draft', () => {
    const shift = makeShift({ locked: false, status: 'scheduled' });
    const state = dbShiftToState(shift);
    expect(state.status).toBe('Draft');
  });
});

// ---------------------------------------------------------------------------
// Field Mapping
// ---------------------------------------------------------------------------

describe('dbShiftToState - field mapping', () => {
  it('maps restaurant_id to both restaurantId and locationId', () => {
    const shift = makeShift({ restaurant_id: 'rest-42' });
    const state = dbShiftToState(shift);
    expect(state.restaurantId).toBe('rest-42');
    expect(state.locationId).toBe('rest-42');
  });

  it('maps position to roleId', () => {
    const shift = makeShift({ position: 'bartender' });
    const state = dbShiftToState(shift);
    expect(state.roleId).toBe('bartender');
  });

  it('maps employee_id to employeeId and converts empty string to null', () => {
    const shift = makeShift({ employee_id: 'emp-5' });
    expect(dbShiftToState(shift).employeeId).toBe('emp-5');

    const emptyShift = makeShift({ employee_id: '' });
    expect(dbShiftToState(emptyShift).employeeId).toBeNull();
  });

  it('maps start_time/end_time to startAt/endAt and computes businessDate', () => {
    const shift = makeShift({
      start_time: '2026-04-15T14:30:00.000Z',
      end_time: '2026-04-15T22:00:00.000Z',
    });
    const state = dbShiftToState(shift);
    expect(state.startAt).toBe('2026-04-15T14:30:00.000Z');
    expect(state.endAt).toBe('2026-04-15T22:00:00.000Z');
    expect(state.businessDate).toBe('2026-04-15');
  });

  it('defaults timezone to America/Chicago when not provided', () => {
    const state = dbShiftToState(makeShift());
    expect(state.timezone).toBe('America/Chicago');
  });

  it('uses provided timezone when given', () => {
    const state = dbShiftToState(makeShift(), 'America/New_York');
    expect(state.timezone).toBe('America/New_York');
  });

  it('sets publishedAt from shift.published_at', () => {
    const shift = makeShift({ published_at: '2026-03-01T08:00:00Z' });
    const state = dbShiftToState(shift);
    expect(state.publishedAt).toBe('2026-03-01T08:00:00Z');
  });

  it('sets publishedAt to undefined when published_at is null', () => {
    const shift = makeShift({ published_at: null });
    const state = dbShiftToState(shift);
    expect(state.publishedAt).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Command Builders
// ---------------------------------------------------------------------------

describe('buildCreateCommand', () => {
  it('sets expectedVersion to 0 and generates UUIDs', () => {
    const shift = makeShift();
    const cmd = buildCreateCommand(shift, 'America/Chicago', 'actor-1');

    expect(cmd.type).toBe('CreateShift');
    expect(cmd.expectedVersion).toBe(0);
    expect(cmd.commandId).toBeTruthy();
    expect(cmd.shiftId).toBeTruthy();
    // commandId and shiftId should be distinct UUIDs
    expect(cmd.commandId).not.toBe(cmd.shiftId);
  });

  it('maps shift fields into payload', () => {
    const shift = makeShift({
      restaurant_id: 'rest-9',
      position: 'server',
      employee_id: 'emp-3',
      notes: 'opening shift',
    });
    const cmd = buildCreateCommand(shift, 'America/Denver', 'actor-2');

    expect(cmd.payload.restaurantId).toBe('rest-9');
    expect(cmd.payload.locationId).toBe('rest-9');
    expect(cmd.payload.timezone).toBe('America/Denver');
    expect(cmd.payload.roleId).toBe('server');
    expect(cmd.payload.employeeId).toBe('emp-3');
    expect(cmd.payload.notes).toBe('opening shift');
    expect(cmd.actor).toEqual({ type: 'system', actorId: 'actor-2' });
  });
});

describe('buildChangeTimeCommand', () => {
  it('uses state.version and state.shiftId', () => {
    const state = makeState({ shiftId: 'shift-77', version: 1 });
    const cmd = buildChangeTimeCommand(
      state,
      '2026-03-01T10:00:00Z',
      '2026-03-01T18:00:00Z',
      'actor-1',
    );

    expect(cmd.type).toBe('ChangeShiftTime');
    expect(cmd.shiftId).toBe('shift-77');
    expect(cmd.expectedVersion).toBe(1);
    expect(cmd.payload.newStartAt).toBe('2026-03-01T10:00:00Z');
    expect(cmd.payload.newEndAt).toBe('2026-03-01T18:00:00Z');
  });
});

describe('buildAssignCommand', () => {
  it('creates correct command with employeeId in payload', () => {
    const state = makeState();
    const cmd = buildAssignCommand(state, 'emp-99', 'actor-1');

    expect(cmd.type).toBe('AssignEmployee');
    expect(cmd.payload.employeeId).toBe('emp-99');
    expect(cmd.shiftId).toBe(state.shiftId);
    expect(cmd.expectedVersion).toBe(state.version);
  });
});

describe('buildUnassignCommand', () => {
  it('creates correct command type with empty payload', () => {
    const state = makeState({ shiftId: 'shift-55' });
    const cmd = buildUnassignCommand(state, 'actor-1');

    expect(cmd.type).toBe('UnassignEmployee');
    expect(cmd.shiftId).toBe('shift-55');
    expect(cmd.payload).toEqual({});
  });
});

describe('buildReassignCommand', () => {
  it('creates correct command with newEmployeeId in payload', () => {
    const state = makeState();
    const cmd = buildReassignCommand(state, 'emp-new', 'actor-1');

    expect(cmd.type).toBe('ReassignEmployee');
    expect(cmd.payload.newEmployeeId).toBe('emp-new');
    expect(cmd.shiftId).toBe(state.shiftId);
  });
});

describe('buildCancelCommand', () => {
  it('uses reasonCode user_deleted', () => {
    const state = makeState({ shiftId: 'shift-cancel' });
    const cmd = buildCancelCommand(state, 'actor-1');

    expect(cmd.type).toBe('CancelShift');
    expect(cmd.payload.reasonCode).toBe('user_deleted');
    expect(cmd.shiftId).toBe('shift-cancel');
    expect(cmd.expectedVersion).toBe(state.version);
  });
});

// ---------------------------------------------------------------------------
// Policy Context
// ---------------------------------------------------------------------------

describe('buildPolicyContext', () => {
  it('maps sibling shift DB fields to domain format', () => {
    const siblings = [
      { id: 's1', start_time: '2026-03-01T06:00:00Z', end_time: '2026-03-01T14:00:00Z' },
      { id: 's2', start_time: '2026-03-01T18:00:00Z', end_time: '2026-03-02T02:00:00Z' },
    ];

    const ctx = buildPolicyContext(
      'emp-1',
      '2026-03-01T14:00:00Z',
      '2026-03-01T22:00:00Z',
      '2026-03-01',
      siblings,
    );

    expect(ctx.employeeId).toBe('emp-1');
    expect(ctx.proposedStartAt).toBe('2026-03-01T14:00:00Z');
    expect(ctx.proposedEndAt).toBe('2026-03-01T22:00:00Z');
    expect(ctx.businessDate).toBe('2026-03-01');
    expect(ctx.existingShifts).toEqual([
      { startAt: '2026-03-01T06:00:00Z', endAt: '2026-03-01T14:00:00Z', shiftId: 's1' },
      { startAt: '2026-03-01T18:00:00Z', endAt: '2026-03-02T02:00:00Z', shiftId: 's2' },
    ]);
  });

  it('handles empty sibling list', () => {
    const ctx = buildPolicyContext(
      'emp-1',
      '2026-03-01T09:00:00Z',
      '2026-03-01T17:00:00Z',
      '2026-03-01',
      [],
    );

    expect(ctx.existingShifts).toEqual([]);
  });
});
