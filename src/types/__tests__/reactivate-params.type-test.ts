/**
 * Type-level regression test: ReactivateEmployeeParams must NOT expose confirmPin.
 *
 * The `confirmPin` field was removed because the `mutationFn` never used it —
 * the reactivate_employee RPC has no PIN parameter. Keeping it in the public
 * interface was misleading (callers believed toggling it had an effect).
 *
 * If `confirmPin` is re-added to ReactivateEmployeeParams, the @ts-expect-error
 * below becomes an "unused directive" and `npm run typecheck` will fail,
 * preventing the regression from silently slipping in.
 */

import type { ReactivateEmployeeParams } from '@/hooks/useEmployees';

// @ts-expect-error confirmPin must not be a key on ReactivateEmployeeParams
const _typeGuard: ReactivateEmployeeParams = { employeeId: 'emp-x', confirmPin: true };

// Suppress unused-variable lint — this file exists for the type check only.
void _typeGuard;
