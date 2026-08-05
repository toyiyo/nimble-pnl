/**
 * `user_is_internal_team` decides who can SELECT every row of
 * user_restaurants (20260120100000_add_collaborator_roles.sql:201-212).
 * EmployeeAppAccessRow needs the same answer client-side to know whether a
 * miss in the roster means "no account" or "you just can't see it".
 *
 * That makes INTERNAL_TEAM_ROLES a second copy of a database rule, and
 * roleMembership.ts's own header warns about exactly that. This test is the
 * pin: add a sixth internal role in SQL without updating the constant and it
 * fails here rather than silently blanking the row in production.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { INTERNAL_TEAM_ROLES, isInternalTeamRole } from '@/lib/permissions/roleMembership';
import type { Role } from '@/lib/permissions/types';

const MIGRATIONS_DIR = 'supabase/migrations';

/**
 * The LAST migration that defines the function wins, because that is what a
 * migrated database ends up running. Naming one file here would quietly pin a
 * superseded definition the day someone adds a sixth role in a new migration --
 * which is the exact failure this test exists to catch.
 */
function latestMigrationDefining(fn: string): string {
  const dir = resolve(process.cwd(), MIGRATIONS_DIR);
  const match = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    // Timestamp-prefixed, so lexicographic order is migration order.
    .sort()
    .reverse()
    .find((f) => readFileSync(resolve(dir, f), 'utf8').includes(`FUNCTION public.${fn}`));

  expect(match, `no migration defines ${fn}`).toBeDefined();
  return `${MIGRATIONS_DIR}/${match}`;
}

describe('INTERNAL_TEAM_ROLES mirrors user_is_internal_team', () => {
  it('lists exactly the roles the SQL function accepts', () => {
    const MIGRATION = latestMigrationDefining('user_is_internal_team');
    const sql = readFileSync(resolve(process.cwd(), MIGRATION), 'utf8');

    const fnStart = sql.indexOf('FUNCTION public.user_is_internal_team');
    expect(fnStart, `user_is_internal_team not found in ${MIGRATION}`).toBeGreaterThan(-1);

    // `AND ur.role IN ('owner', 'manager', ...)` — first IN list after the signature.
    const inList = /ur\.role\s+IN\s*\(([^)]*)\)/.exec(sql.slice(fnStart));
    expect(inList, 'role IN (...) list not found').not.toBeNull();

    const fromSql = [...inList![1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(fromSql.length).toBeGreaterThan(0);
    expect([...INTERNAL_TEAM_ROLES].sort()).toEqual([...fromSql].sort());
  });
});

/**
 * The mirror test above pins the LIST. This pins the PREDICATE built on it --
 * the half EmployeeAppAccessRow actually calls, including the nullable inputs
 * its signature accepts (a caller whose role can't be established).
 */
describe('isInternalTeamRole', () => {
  it.each(INTERNAL_TEAM_ROLES)('accepts %s', (role) => {
    expect(isInternalTeamRole(role)).toBe(true);
  });

  it.each([
    'collaborator_accountant',
    'collaborator_inventory',
    'collaborator_chef',
    'collaborator_custom',
    'kiosk',
    'not_a_role',
  ])('rejects %s', (role) => {
    expect(isInternalTeamRole(role as Role)).toBe(false);
  });

  it('rejects an unestablished caller rather than throwing', () => {
    expect(isInternalTeamRole(null)).toBe(false);
    expect(isInternalTeamRole(undefined)).toBe(false);
  });
});
