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
