import type {
  ShiftState,
  ShiftCommand,
  PolicyContext,
  PolicyResult,
  ShiftPolicy,
} from './types';
import { DomainError } from './types';
import { decide } from './shift-aggregate';

export interface ValidationResult {
  valid: boolean;
  error?: DomainError;
  warnings?: PolicyResult[];
}

export function validateCommand(
  state: ShiftState,
  command: ShiftCommand,
  policies?: { context: PolicyContext; checks: ShiftPolicy[] },
): ValidationResult {
  // Step 1: Run domain decision logic
  try {
    decide(state, command);
  } catch (err: unknown) {
    if (err instanceof DomainError) {
      return { valid: false, error: err };
    }
    const message = err instanceof Error ? err.message : String(err);
    return { valid: false, error: new DomainError('UNKNOWN', message) };
  }

  // Step 2: If no policies, we're done
  if (!policies) {
    return { valid: true };
  }

  // Step 3: Evaluate each policy
  const warnings: PolicyResult[] = [];

  for (const check of policies.checks) {
    const result = check.evaluate(policies.context);

    if (result.outcome === 'block') {
      return {
        valid: false,
        error: new DomainError(
          result.code || 'POLICY_BLOCK',
          result.message || 'Blocked by policy',
        ),
      };
    }

    if (result.outcome === 'warn') {
      warnings.push(result);
    }
  }

  if (warnings.length > 0) {
    return { valid: true, warnings };
  }

  return { valid: true };
}
