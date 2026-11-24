import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Source-contract guards for the recurring availability reads of the edge
 * functions. The legacy start_time / end_time columns hold UTC values that
 * drift one hour across a time change. The readers must select the local
 * columns. The edge entry files use Deno https imports, so Vitest reads the
 * source.
 */

const root = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

const SOURCES = {
  'generate-schedule': read('supabase/functions/generate-schedule/index.ts'),
  schedulingContextTool: read('supabase/functions/_shared/schedulingContextTool.ts'),
};

/** The column list of each select on employee_availability in the source. */
function availabilitySelects(source: string): string[] {
  const out: string[] = [];
  const re = /employee_availability"\)?\s*(?:\.select\()?,?\s*"([^"]+)"/g;
  for (const m of source.matchAll(re)) out.push(m[1]);
  return out;
}

describe('recurring availability reads', () => {
  for (const [name, source] of Object.entries(SOURCES)) {
    it(`${name} selects the local columns and not the legacy UTC columns`, () => {
      const selects = availabilitySelects(source);
      expect(selects.length).toBeGreaterThan(0);
      for (const cols of selects) {
        const list = cols.split(',').map((c) => c.trim());
        expect(list).toContain('start_time_local');
        expect(list).toContain('end_time_local');
        expect(list).not.toContain('start_time');
        expect(list).not.toContain('end_time');
      }
    });
  }

  it('generate-schedule stops when the availability read fails', () => {
    expect(SOURCES['generate-schedule']).toMatch(/if \(recurringAvailResult\.error\) throw/);
  });
});
