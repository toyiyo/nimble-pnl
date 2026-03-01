// ---------------------------------------------------------------------------
// DB <-> Domain Adapter
//
// Pure mapping layer between the Supabase `Shift` row type and the
// domain's `ShiftState` / command types. No runtime imports -- only
// `import type` references to keep the module side-effect-free.
// ---------------------------------------------------------------------------

import type {
  ShiftState,
  UUID,
  Actor,
  CreateShiftCommand,
  ChangeShiftTimeCommand,
  AssignEmployeeCommand,
  UnassignEmployeeCommand,
  ReassignEmployeeCommand,
  CancelShiftCommand,
  PolicyContext,
} from './types';
import type { Shift } from '@/types/scheduling';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract the ISO date portion (YYYY-MM-DD) from an ISO timestamp. */
function isoDate(isoTimestamp: string): string {
  return isoTimestamp.slice(0, 10);
}

/** Map the DB status + locked flag to the domain ShiftStatus. */
function mapStatus(shift: Shift): ShiftState['status'] {
  if (shift.status === 'cancelled') return 'Canceled';
  if (shift.locked) return 'Published';
  return 'Draft';
}

/** Build a system Actor. */
function systemActor(actorId: string): Actor {
  return { type: 'system', actorId };
}

// ---------------------------------------------------------------------------
// DB -> Domain State
// ---------------------------------------------------------------------------

/**
 * Convert a Supabase `Shift` row into the domain `ShiftState`.
 *
 * In this system restaurants ARE locations, so both `restaurantId` and
 * `locationId` receive the same value (`shift.restaurant_id`).
 *
 * `version` is always `1` because the legacy DB does not track aggregate
 * versions yet.
 */
export function dbShiftToState(shift: Shift, timezone?: string): ShiftState {
  const tz = timezone ?? 'America/Chicago';

  return {
    shiftId: shift.id,
    restaurantId: shift.restaurant_id,
    locationId: shift.restaurant_id, // restaurants ARE locations
    timezone: tz,
    businessDate: isoDate(shift.start_time),
    startAt: shift.start_time,
    endAt: shift.end_time,
    roleId: shift.position,
    shiftTypeId: null,
    employeeId: shift.employee_id && shift.employee_id !== '' ? shift.employee_id : null,
    notes: shift.notes,
    status: mapStatus(shift),
    publishedAt: shift.published_at ?? undefined,
    version: 1,
  };
}

// ---------------------------------------------------------------------------
// Command Builders
// ---------------------------------------------------------------------------

/**
 * Build a `CreateShiftCommand` from a DB `Shift` row.
 *
 * Both `commandId` and `shiftId` are freshly generated UUIDs because
 * the domain treats the creation as a new aggregate.
 */
export function buildCreateCommand(
  input: Shift,
  timezone: string,
  actorId: string,
): CreateShiftCommand {
  return {
    type: 'CreateShift',
    commandId: crypto.randomUUID(),
    shiftId: crypto.randomUUID(),
    expectedVersion: 0,
    actor: systemActor(actorId),
    payload: {
      restaurantId: input.restaurant_id,
      locationId: input.restaurant_id,
      timezone,
      businessDate: isoDate(input.start_time),
      startAt: input.start_time,
      endAt: input.end_time,
      roleId: input.position,
      employeeId: input.employee_id && input.employee_id !== '' ? input.employee_id : null,
      notes: input.notes,
    },
  };
}

/**
 * Build a `ChangeShiftTimeCommand` from existing state + new times.
 */
export function buildChangeTimeCommand(
  state: ShiftState,
  newStart: string,
  newEnd: string,
  actorId: string,
): ChangeShiftTimeCommand {
  return {
    type: 'ChangeShiftTime',
    commandId: crypto.randomUUID(),
    shiftId: state.shiftId,
    expectedVersion: state.version,
    actor: systemActor(actorId),
    payload: {
      newStartAt: newStart,
      newEndAt: newEnd,
    },
  };
}

/**
 * Build an `AssignEmployeeCommand`.
 */
export function buildAssignCommand(
  state: ShiftState,
  employeeId: string,
  actorId: string,
): AssignEmployeeCommand {
  return {
    type: 'AssignEmployee',
    commandId: crypto.randomUUID(),
    shiftId: state.shiftId,
    expectedVersion: state.version,
    actor: systemActor(actorId),
    payload: {
      employeeId,
    },
  };
}

/**
 * Build an `UnassignEmployeeCommand`.
 */
export function buildUnassignCommand(
  state: ShiftState,
  actorId: string,
): UnassignEmployeeCommand {
  return {
    type: 'UnassignEmployee',
    commandId: crypto.randomUUID(),
    shiftId: state.shiftId,
    expectedVersion: state.version,
    actor: systemActor(actorId),
    payload: {},
  };
}

/**
 * Build a `ReassignEmployeeCommand`.
 */
export function buildReassignCommand(
  state: ShiftState,
  newEmployeeId: string,
  actorId: string,
): ReassignEmployeeCommand {
  return {
    type: 'ReassignEmployee',
    commandId: crypto.randomUUID(),
    shiftId: state.shiftId,
    expectedVersion: state.version,
    actor: systemActor(actorId),
    payload: {
      newEmployeeId,
    },
  };
}

/**
 * Build a `CancelShiftCommand` with a fixed `user_deleted` reason code.
 */
export function buildCancelCommand(
  state: ShiftState,
  actorId: string,
): CancelShiftCommand {
  return {
    type: 'CancelShift',
    commandId: crypto.randomUUID(),
    shiftId: state.shiftId,
    expectedVersion: state.version,
    actor: systemActor(actorId),
    payload: {
      reasonCode: 'user_deleted',
    },
  };
}

// ---------------------------------------------------------------------------
// Policy Context Builder
// ---------------------------------------------------------------------------

/**
 * Build a `PolicyContext` from DB-shaped sibling shifts.
 *
 * `siblingShifts` use the DB field names (`start_time` / `end_time`)
 * and are mapped to the domain names (`startAt` / `endAt`).
 */
export function buildPolicyContext(
  employeeId: string,
  start: string,
  end: string,
  businessDate: string,
  siblingShifts: Array<{ start_time: string; end_time: string; id: string }>,
): PolicyContext {
  return {
    employeeId,
    proposedStartAt: start,
    proposedEndAt: end,
    businessDate,
    existingShifts: siblingShifts.map((s) => ({
      startAt: s.start_time,
      endAt: s.end_time,
      shiftId: s.id,
    })),
  };
}
