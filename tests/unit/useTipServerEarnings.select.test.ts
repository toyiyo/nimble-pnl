import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { TIP_SERVER_EARNINGS_SELECT } from '../../src/hooks/tipServerEarningsSelect';

/**
 * Read the real column names of public.employees from the generated Supabase
 * types. This pins the embed against the actual schema, so a phantom column
 * (like the old first_name / last_name) fails the test instead of the query.
 */
function employeesColumns(): Set<string> {
  const typesPath = resolve(process.cwd(), 'src/integrations/supabase/types.ts');
  const src = readFileSync(typesPath, 'utf8');

  const tableStart = src.indexOf('\n      employees: {');
  if (tableStart === -1) {
    throw new Error('employees table not found in generated types');
  }
  const rowStart = src.indexOf('Row: {', tableStart);
  const rowEnd = src.indexOf('\n        }', rowStart);
  const rowBlock = src.slice(rowStart, rowEnd);

  const columns = new Set<string>();
  for (const match of rowBlock.matchAll(/^ {10}([a-z_][a-z0-9_]*):/gim)) {
    columns.add(match[1]);
  }
  return columns;
}

/** Pull the column list out of the employees(...) embed in the select string. */
function embedColumns(select: string): string[] {
  const match = select.match(/employees\(([^)]*)\)/);
  if (!match) return [];
  return match[1]
    .split(',')
    .map((token) => token.trim().split(':').pop()!.trim())
    .filter(Boolean);
}

describe('TIP_SERVER_EARNINGS_SELECT', () => {
  it('parses the employees column snapshot from the generated types', () => {
    const columns = employeesColumns();
    // Guard against a broken parse that would make the checks below vacuous.
    expect(columns.has('name')).toBe(true);
    expect(columns.has('id')).toBe(true);
    expect(columns.has('restaurant_id')).toBe(true);
    // The bug: these columns never existed on employees.
    expect(columns.has('first_name')).toBe(false);
    expect(columns.has('last_name')).toBe(false);
  });

  it('embeds the employees relation', () => {
    expect(TIP_SERVER_EARNINGS_SELECT).toMatch(/employees\(/);
    expect(embedColumns(TIP_SERVER_EARNINGS_SELECT).length).toBeGreaterThan(0);
  });

  it('names only columns that exist on employees', () => {
    const valid = employeesColumns();
    for (const column of embedColumns(TIP_SERVER_EARNINGS_SELECT)) {
      expect(valid.has(column)).toBe(true);
    }
  });

  it('reads the single name column, not first_name / last_name', () => {
    const embedded = embedColumns(TIP_SERVER_EARNINGS_SELECT);
    expect(embedded).toContain('name');
    expect(embedded).not.toContain('first_name');
    expect(embedded).not.toContain('last_name');
  });
});
