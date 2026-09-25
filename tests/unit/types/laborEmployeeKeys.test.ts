/**
 * Compile-time check: `LABOR_EMPLOYEE_KEYS` lists every key of `LaborEmployee`
 * and only those keys, and the UI `Employee` type is a `LaborEmployee`.
 *
 * `satisfies` in `types.ts` rejects an unknown key. This file also rejects a
 * missing key. `npm run typecheck:types` is the real test.
 */
import { describe, it, expect } from 'vitest';
import {
  LABOR_EMPLOYEE_KEYS,
  type LaborEmployee,
} from '../../../supabase/functions/_shared/labor/types';
import type { Employee } from '@/types/scheduling';

type Listed = (typeof LABOR_EMPLOYEE_KEYS)[number];
type Missing = Exclude<keyof LaborEmployee, Listed>;

const noMissingKey: [Missing] extends [never] ? true : false = true;
const employeeIsLaborEmployee = (employee: Employee): LaborEmployee => employee;

describe('LABOR_EMPLOYEE_KEYS', () => {
  it('lists each LaborEmployee key once', () => {
    expect(noMissingKey).toBe(true);
    expect(typeof employeeIsLaborEmployee).toBe('function');
    expect(new Set(LABOR_EMPLOYEE_KEYS).size).toBe(LABOR_EMPLOYEE_KEYS.length);
  });
});
