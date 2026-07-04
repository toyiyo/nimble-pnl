/**
 * Task 1: operations_manager Role Type Guard
 *
 * Verifies that 'operations_manager' is a recognised member of the Role union
 * and is represented in the runtime maps that are keyed by Role. This test
 * intentionally stays narrow — it only checks existence in the type system
 * and runtime lookup. Full capability / metadata correctness is covered by
 * the operationsManagerRole.test.ts written in Task 2.
 */
import { describe, it, expect } from 'vitest';
import { ROLE_CAPABILITIES, ROLE_METADATA, getInternalRoles } from '@/lib/permissions/definitions';
import type { Role } from '@/lib/permissions/types';

// Compile-time check: assigning the literal to Role must not be a type error.
// If Role does not include 'operations_manager' this line produces a TS error.
const _typeCheck: Role = 'operations_manager';
void _typeCheck;

describe('Role union — operations_manager', () => {
  it("'operations_manager' is a key in ROLE_CAPABILITIES", () => {
    expect(ROLE_CAPABILITIES).toHaveProperty('operations_manager');
  });

  it("'operations_manager' is a key in ROLE_METADATA", () => {
    expect(ROLE_METADATA).toHaveProperty('operations_manager');
  });

  it("'operations_manager' appears in getInternalRoles()", () => {
    expect(getInternalRoles()).toContain('operations_manager');
  });

  it("'operations_manager' is categorised as 'internal'", () => {
    expect(ROLE_METADATA['operations_manager']?.category).toBe('internal');
  });
});
