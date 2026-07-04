import { describe, it, expect } from 'vitest';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Supabase tracks applied migrations by the 14-digit timestamp prefix ALONE
 * (supabase_migrations.schema_migrations.version). Two files sharing a prefix
 * corrupt the pending-set calculation and abort `supabase db push` with a
 * schema_migrations_pkey violation — this broke the production deploy of
 * PR #571 (20260702120000 was used by both focus_backfill_cron and
 * add_pack_quantity_to_receipt_line_items).
 */
describe('supabase migration version uniqueness', () => {
  it('no two migration files share a 14-digit version prefix', () => {
    const migrationsDir = join(__dirname, '..', '..', 'supabase', 'migrations');
    const versions = readdirSync(migrationsDir)
      .map((f) => /^(\d{14})_/.exec(f)?.[1])
      .filter((v): v is string => Boolean(v));

    const seen = new Map<string, number>();
    for (const v of versions) seen.set(v, (seen.get(v) ?? 0) + 1);
    const duplicates = [...seen.entries()].filter(([, n]) => n > 1).map(([v]) => v);

    expect(duplicates, `duplicate migration versions: ${duplicates.join(', ')}`).toEqual([]);
  });
});
