import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  resolve(__dirname, '../../supabase/migrations/20261105120000_availability_local_time.sql'),
  'utf8',
);

describe('availability local time migration order', () => {
  it('runs the steps in the order of spec section 7.4', () => {
    const order = [
      'ADD COLUMN',
      'DROP NOT NULL',
      'DISABLE TRIGGER update_employee_availability_updated_at',
      'SELECT public.backfill_employee_availability_local()',
      'ENABLE TRIGGER update_employee_availability_updated_at',
      'CREATE TRIGGER sync_employee_availability_frames',
      'ADD CONSTRAINT',
    ];
    const positions = order.map((s) => sql.indexOf(s));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it('runs in one explicit transaction', () => {
    expect(sql.trimStart().startsWith('BEGIN;') || /^BEGIN;$/m.test(sql)).toBe(true);
    expect(/^COMMIT;$/m.test(sql)).toBe(true);
  });
});
