import { describe, it, expect } from 'vitest';
import { validateCommand } from '@/domain/scheduling/validate';
import { emptyState } from '@/domain/scheduling/shift-aggregate';
import { DomainError } from '@/domain/scheduling/types';
import type {
  ShiftState,
  CreateShiftCommand,
  ChangeShiftTimeCommand,
  PolicyContext,
  PolicyResult,
  ShiftPolicy,
} from '@/domain/scheduling/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCreateCommand(
  shiftId: string,
  overrides: Partial<CreateShiftCommand['payload']> = {},
): CreateShiftCommand {
  return {
    commandId: crypto.randomUUID(),
    shiftId,
    expectedVersion: 0,
    actor: { type: 'system', actorId: 'test' },
    type: 'CreateShift',
    payload: {
      restaurantId: 'rest-1',
      locationId: 'loc-1',
      timezone: 'America/Chicago',
      startAt: '2026-03-01T09:00:00.000Z',
      endAt: '2026-03-01T17:00:00.000Z',
      roleId: 'role-1',
      ...overrides,
    },
  };
}

function makeDraftState(overrides: Partial<ShiftState> = {}): ShiftState {
  return {
    shiftId: 'shift-1',
    restaurantId: 'rest-1',
    locationId: 'loc-1',
    timezone: 'America/Chicago',
    businessDate: '2026-03-01',
    startAt: '2026-03-01T09:00:00.000Z',
    endAt: '2026-03-01T17:00:00.000Z',
    roleId: 'role-1',
    employeeId: null,
    status: 'Draft',
    version: 1,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Policy stubs
// ---------------------------------------------------------------------------

const blockPolicy: ShiftPolicy = {
  evaluate: () => ({ outcome: 'block', code: 'POLICY_OVERLAP', message: 'overlaps' }),
};

const warnPolicy: ShiftPolicy = {
  evaluate: () => ({ outcome: 'warn', code: 'POLICY_INSUFFICIENT_REST', message: 'too close' }),
};

const okPolicy: ShiftPolicy = {
  evaluate: () => ({ outcome: 'ok' }),
};

const minimalContext: PolicyContext = {
  employeeId: 'emp-1',
  proposedStartAt: '2026-03-01T09:00:00.000Z',
  proposedEndAt: '2026-03-01T17:00:00.000Z',
  businessDate: '2026-03-01',
  existingShifts: [],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('validateCommand', () => {
  it('valid command passes', () => {
    const state = emptyState('shift-1');
    const cmd = makeCreateCommand('shift-1');
    const result = validateCommand(state, cmd);

    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.warnings).toBeUndefined();
  });

  it('invalid time is caught', () => {
    const state = emptyState('shift-1');
    const cmd = makeCreateCommand('shift-1', {
      startAt: '2026-03-01T17:00:00.000Z',
      endAt: '2026-03-01T09:00:00.000Z',
    });
    const result = validateCommand(state, cmd);

    expect(result.valid).toBe(false);
    expect(result.error).toBeInstanceOf(DomainError);
    expect(result.error!.code).toBe('CMD_BAD_TIME');
  });

  it('canceled shift blocks commands', () => {
    const state = makeDraftState({ status: 'Canceled' });
    const cmd: ChangeShiftTimeCommand = {
      commandId: crypto.randomUUID(),
      shiftId: 'shift-1',
      expectedVersion: 1,
      actor: { type: 'system', actorId: 'test' },
      type: 'ChangeShiftTime',
      payload: {
        newStartAt: '2026-03-01T10:00:00.000Z',
        newEndAt: '2026-03-01T18:00:00.000Z',
      },
    };
    const result = validateCommand(state, cmd);

    expect(result.valid).toBe(false);
    expect(result.error).toBeInstanceOf(DomainError);
    expect(result.error!.code).toBe('SHIFT_CANCELED');
  });

  it('policy block returns invalid', () => {
    const state = emptyState('shift-1');
    const cmd = makeCreateCommand('shift-1');
    const result = validateCommand(state, cmd, {
      context: minimalContext,
      checks: [blockPolicy],
    });

    expect(result.valid).toBe(false);
    expect(result.error).toBeInstanceOf(DomainError);
    expect(result.error!.code).toBe('POLICY_OVERLAP');
  });

  it('policy warn returns valid with warnings', () => {
    const state = emptyState('shift-1');
    const cmd = makeCreateCommand('shift-1');
    const result = validateCommand(state, cmd, {
      context: minimalContext,
      checks: [warnPolicy],
    });

    expect(result.valid).toBe(true);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings![0]).toEqual({
      outcome: 'warn',
      code: 'POLICY_INSUFFICIENT_REST',
      message: 'too close',
    });
  });

  it('policy ok returns valid without warnings', () => {
    const state = emptyState('shift-1');
    const cmd = makeCreateCommand('shift-1');
    const result = validateCommand(state, cmd, {
      context: minimalContext,
      checks: [okPolicy],
    });

    expect(result.valid).toBe(true);
    expect(result.warnings).toBeUndefined();
  });

  it('mixed policies: block wins', () => {
    const state = emptyState('shift-1');
    const cmd = makeCreateCommand('shift-1');
    const result = validateCommand(state, cmd, {
      context: minimalContext,
      checks: [warnPolicy, blockPolicy],
    });

    expect(result.valid).toBe(false);
    expect(result.error).toBeInstanceOf(DomainError);
    expect(result.error!.code).toBe('POLICY_OVERLAP');
  });

  it('no policies still valid', () => {
    const state = emptyState('shift-1');
    const cmd = makeCreateCommand('shift-1');
    const result = validateCommand(state, cmd);

    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.warnings).toBeUndefined();
  });
});
