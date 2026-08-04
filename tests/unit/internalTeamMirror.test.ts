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
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { INTERNAL_TEAM_ROLES } from '@/lib/permissions/roleMembership';

const MIGRATION = 'supabase/migrations/20260702170000_add_operations_manager_role.sql';

describe('INTERNAL_TEAM_ROLES mirrors user_is_internal_team', () => {
  it('lists exactly the roles the SQL function accepts', () => {
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
