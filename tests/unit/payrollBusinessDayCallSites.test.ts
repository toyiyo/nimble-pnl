import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * calculateEmployeePay and calculatePayrollPeriod default their businessDay
 * parameter to HOST_CALENDAR_DAY_FRAME. That default exists ONLY so the ~60
 * pre-existing three-argument test call sites keep compiling -- it is never the
 * right answer in production, where the frame belongs to the restaurant, not to
 * whatever zone the browser happens to be in.
 *
 * A default is silent by construction: forget it at a new production call site
 * and nothing fails, the payroll is just quietly wrong for every restaurant
 * outside the viewer's zone. This test is the thing that isn't silent.
 *
 * If you are here because this test failed: pass the restaurant's
 * BusinessDayConfig at the call site you just added. Do not add it to the
 * allowlist unless the call genuinely has no restaurant (there are none today).
 */

const PRODUCTION_FILES = [
  'src/services/laborCalculations.ts',
  'src/utils/payrollCalculations.ts',
  'src/hooks/usePayroll.tsx',
];

const GUARDED = ['calculateEmployeePay', 'calculatePayrollPeriod'];

/**
 * Extract the argument text of every `fn(...)` CALL in `source`, skipping the
 * declaration itself. Brace/paren depth tracking rather than a regex, because
 * these calls span a dozen lines and nest object and array literals.
 */
function callArguments(source: string, fn: string): string[] {
  const out: string[] = [];
  const needle = `${fn}(`;

  for (let i = source.indexOf(needle); i !== -1; i = source.indexOf(needle, i + 1)) {
    // `export function calculateEmployeePay(` is a declaration, not a call.
    const before = source.slice(Math.max(0, i - 20), i);
    if (/\bfunction\s+$/.test(before)) continue;

    let depth = 0;
    let end = -1;
    for (let j = i + needle.length - 1; j < source.length; j++) {
      const ch = source[j];
      if (ch === '(') depth++;
      else if (ch === ')') {
        depth--;
        if (depth === 0) { end = j; break; }
      }
    }
    if (end === -1) throw new Error(`unbalanced parens after ${fn}( in source`);
    out.push(source.slice(i + needle.length, end));
  }
  return out;
}

describe('payroll call sites pass an explicit business-day frame', () => {
  it.each(PRODUCTION_FILES)('%s', (relPath) => {
    const source = readFileSync(resolve(process.cwd(), relPath), 'utf8');

    for (const fn of GUARDED) {
      const calls = callArguments(source, fn);
      calls.forEach((args, idx) => {
        expect(
          /businessDay|cutoffHour/.test(args),
          `${relPath}: call ${idx + 1} to ${fn}() relies on the HOST_CALENDAR_DAY_FRAME ` +
            `default instead of passing the restaurant's frame.\nArguments were:\n${args}`,
        ).toBe(true);
      });
    }
  });

  it('actually finds the call sites it claims to guard', () => {
    // A scanner that silently matches nothing would pass the assertions above
    // forever. Pin the count so deleting a call site is a deliberate act.
    const total = PRODUCTION_FILES.reduce((sum, relPath) => {
      const source = readFileSync(resolve(process.cwd(), relPath), 'utf8');
      return sum + GUARDED.reduce((n, fn) => n + callArguments(source, fn).length, 0);
    }, 0);
    expect(total).toBe(4);
  });
});
