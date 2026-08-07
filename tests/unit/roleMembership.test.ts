import { describe, it, expect } from 'vitest';

import {
  legacyRoleIndex,
  resolveMembershipRoleId,
  membersInRole,
  groupMembersByRole,
} from '@/lib/permissions/roleMembership';
import type { RestaurantMember } from '@/hooks/useRestaurantMembers';
import type { RoleWithGrants } from '@/hooks/useRoles';

/**
 * These tests pin the client resolution to `role_member_counts`
 * (supabase/migrations/20260730200000_role_member_counts.sql:36-46). If the
 * two ever disagree, a role card's count and the roster that card opens show
 * different numbers for the same role.
 */

const OWNER_ROLE_ID = '11111111-1111-1111-1111-111111111111';
const CHEF_ROLE_ID = '22222222-2222-2222-2222-222222222222';
const BARTENDER_ROLE_ID = '33333333-3333-3333-3333-333333333333';

function role(id: string, name: string, legacy: string | null): RoleWithGrants {
  return {
    id,
    restaurant_id: legacy === null ? 'rest-1' : null,
    name,
    description: null,
    flavor: 'collaborator',
    builtin: legacy !== null,
    legacy_role: legacy,
    created_at: '2026-08-03T00:00:00Z',
    role_areas: [],
    role_flags: [],
    memberCount: 0,
  };
}

const ROLES: RoleWithGrants[] = [
  role(OWNER_ROLE_ID, 'Owner', 'owner'),
  role(CHEF_ROLE_ID, 'Chef', 'chef'),
  role(BARTENDER_ROLE_ID, 'Bartender', null),
];

function member(
  userId: string,
  roleLiteral: RestaurantMember['role'],
  roleId: string | null
): RestaurantMember {
  return {
    membershipId: `m-${userId}`,
    userId,
    email: `${userId}@example.com`,
    fullName: userId,
    role: roleLiteral,
    roleId,
  };
}

describe('legacyRoleIndex', () => {
  it('indexes only builtin roles, which are the only ones with a legacy string', () => {
    const index = legacyRoleIndex(ROLES);
    expect(index.get('owner')).toBe(OWNER_ROLE_ID);
    expect(index.get('chef')).toBe(CHEF_ROLE_ID);
    expect(index.size).toBe(2);
  });
});

describe('resolveMembershipRoleId', () => {
  const index = legacyRoleIndex(ROLES);

  it('prefers role_id over the legacy string, as COALESCE does', () => {
    // A row whose columns disagree: COALESCE takes role_id first, so the
    // client must too, or the roster would place this member on the Chef card
    // while the count places them on Bartender.
    const m = member('u1', 'chef', BARTENDER_ROLE_ID);
    expect(resolveMembershipRoleId(m, index)).toBe(BARTENDER_ROLE_ID);
  });

  it('falls back to the legacy string when role_id is null', () => {
    // The pre-backfill shape: 20260730170000 states an INSERT that omits
    // role_id must keep leaving it NULL, so this is not a legacy edge case.
    expect(resolveMembershipRoleId(member('u2', 'chef', null), index)).toBe(CHEF_ROLE_ID);
  });

  it('drops a custom-role membership that never got its role_id', () => {
    // builtin_role_id_for('collaborator_custom') is NULL and no roles row
    // carries that legacy string, so the count drops the row and so do we.
    expect(resolveMembershipRoleId(member('u3', 'collaborator_custom', null), index)).toBeNull();
  });

  it('drops an unrecognised role string', () => {
    const m = { ...member('u4', 'staff', null), role: 'not_a_role' as RestaurantMember['role'] };
    expect(resolveMembershipRoleId(m, index)).toBeNull();
  });
});

describe('membersInRole and groupMembersByRole', () => {
  const members: RestaurantMember[] = [
    member('owner1', 'owner', null),
    member('chef1', 'chef', CHEF_ROLE_ID),
    member('chef2', 'chef', null),
    member('bar1', 'collaborator_custom', BARTENDER_ROLE_ID),
    member('ghost', 'collaborator_custom', null),
  ];
  const index = legacyRoleIndex(ROLES);

  it('collects everyone whose membership resolves to the role', () => {
    expect(membersInRole(members, CHEF_ROLE_ID, index).map((m) => m.userId)).toEqual([
      'chef1',
      'chef2',
    ]);
    expect(membersInRole(members, BARTENDER_ROLE_ID, index).map((m) => m.userId)).toEqual(['bar1']);
  });

  it('groups every resolvable member exactly once and drops the rest', () => {
    const grouped = groupMembersByRole(members, index);
    expect(grouped.get(OWNER_ROLE_ID)?.length).toBe(1);
    expect(grouped.get(CHEF_ROLE_ID)?.length).toBe(2);
    expect(grouped.get(BARTENDER_ROLE_ID)?.length).toBe(1);

    const totalGrouped = [...grouped.values()].reduce((sum, list) => sum + list.length, 0);
    expect(totalGrouped).toBe(members.length - 1); // 'ghost' resolves to nothing
  });

  it('returns an empty list for a role nobody holds, not undefined', () => {
    expect(membersInRole(members, 'no-such-role', index)).toEqual([]);
  });
});
