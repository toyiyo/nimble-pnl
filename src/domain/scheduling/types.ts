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
  availability?: Array<{
    dayOfWeek: number;
    startTime: string;
    endTime: string;
    isAvailable: boolean;
  }>;
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
