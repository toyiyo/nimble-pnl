import { DomainError, MIN_SHIFT_MINUTES, MAX_SHIFT_HOURS } from './types';
import type { ShiftState, Instant } from './types';

export function assertTimeValidity(startAt: Instant, endAt: Instant): void {
  const minutes = Math.floor((Date.parse(endAt) - Date.parse(startAt)) / 60_000);
  if (minutes <= 0) {
    throw new DomainError('CMD_BAD_TIME', 'Shift end must be after start');
  }
  if (minutes < MIN_SHIFT_MINUTES) {
    throw new DomainError('CMD_TOO_SHORT', `Shift must be at least ${MIN_SHIFT_MINUTES} minutes`);
  }
  if (minutes > MAX_SHIFT_HOURS * 60) {
    throw new DomainError('CMD_TOO_LONG', `Shift must not exceed ${MAX_SHIFT_HOURS} hours`);
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
    throw new DomainError('SHIFT_ALREADY_ASSIGNED', 'Shift already has an employee; use ReassignEmployee');
  }
}
