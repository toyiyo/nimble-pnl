/**
 * Task 4: Duplicated role union in useRestaurants
 *
 * `UserRestaurant.role` in src/hooks/useRestaurants.tsx duplicates the
 * canonical `Role` union from src/lib/permissions/types.ts instead of
 * importing it. Verifies the duplicated union has been widened to include
 * 'collaborator_operations_manager' so `selectedRestaurant.role` flows into
 * Role-typed consumers without a type mismatch
 * (docs/superpowers/specs/2026-07-09-ops-manager-collaborator-design.md).
 */
import { describe, it, expect } from 'vitest';
import type { UserRestaurant } from '@/hooks/useRestaurants';

// Compile-time check: assigning the literal to UserRestaurant['role'] must
// not be a type error. If the duplicated union does not include
// 'collaborator_operations_manager' this line errors under `tsc --noEmit`.
const _typeCheck: UserRestaurant['role'] = 'collaborator_operations_manager';
void _typeCheck;

describe('UserRestaurant.role union — collaborator_operations_manager', () => {
  it('accepts collaborator_operations_manager as a valid role literal', () => {
    const role: UserRestaurant['role'] = 'collaborator_operations_manager';
    expect(role).toBe('collaborator_operations_manager');
  });
});
