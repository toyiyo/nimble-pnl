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
