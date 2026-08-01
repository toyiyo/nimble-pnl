/**
 * membershipCapabilities — the capability resolution usePermissions performs,
 * asked about a membership other than the selected one.
 *
 * It exists for the role editor's copy-to-restaurants picker, which has to
 * decide whether the caller may administer a *different* restaurant. The
 * consequence of getting that wrong is not a near-miss: copy_role_to_restaurants
 * authorizes every target before inserting anywhere and raises on the first
 * failure, so one unauthorized target aborts the copies into the authorized
 * ones too.
 */
import { describe, it, expect } from 'vitest';

import { membershipCapabilities } from '../../src/lib/permissions/membershipCapabilities';
import { ROLE_CAPABILITIES } from '../../src/lib/permissions/definitions';

describe('membershipCapabilities', () => {
  it('resolves a membership with no roles row from the legacy table', () => {
    // Not a dead branch: a membership written before the role_id backfill has
    // no `roles` row joined to it.
    expect(membershipCapabilities('owner', null)).toEqual([...ROLE_CAPABILITIES.owner]);
    expect(membershipCapabilities('staff', undefined)).toEqual([...ROLE_CAPABILITIES.staff]);
  });

  it('returns nothing for an unrecognised legacy role rather than throwing', () => {
    // 'collaborator_custom' is deliberately not a Role and has no entry —
    // reaching this branch with one means the roles row failed to join, and
    // failing closed is the only safe reading.
    expect(
      membershipCapabilities('collaborator_custom' as never, null)
    ).toEqual([]);
  });

  it('resolves a custom role from its area grants, not the legacy table', () => {
    const caps = membershipCapabilities('collaborator_custom' as never, {
      role_areas: [
        // 'collaborators' is the area that carries manage:collaborators —
        // 'team' is the adjacent employee-records area and does not.
        { area_key: 'collaborators', level: 'manage' },
        { area_key: 'scheduling', level: 'view' },
      ],
      role_flags: [],
    });

    expect(caps).toContain('manage:collaborators');
    // view-level scheduling grants reading, not writing.
    expect(caps).toContain('view:scheduling');
    expect(caps).not.toContain('edit:scheduling');
  });

  it('withholds manage:collaborators from a role granted every other area at manage', () => {
    // The copy picker keys on exactly this capability, so a role that manages
    // a lot but was never given the collaborators area must not qualify.
    const caps = membershipCapabilities('collaborator_custom' as never, {
      role_areas: [
        { area_key: 'scheduling', level: 'manage' },
        { area_key: 'team', level: 'manage' },
        { area_key: 'inventory', level: 'manage' },
      ],
      role_flags: [],
    });

    expect(caps).not.toContain('manage:collaborators');
  });

  it('withholds sensitive-data flags when asked to', () => {
    const roleRecord = {
      role_areas: [{ area_key: 'inventory', level: 'view' as const }],
      role_flags: [{ flag: 'view:costs' as const }],
    };

    expect(membershipCapabilities('collaborator_custom' as never, roleRecord)).toContain(
      'view:costs'
    );
    // usePermissions passes false while the restaurant list is still loading,
    // so a half-loaded state cannot briefly reveal costs.
    expect(
      membershipCapabilities('collaborator_custom' as never, roleRecord, {
        includeSensitiveFlags: false,
      })
    ).not.toContain('view:costs');
  });

  it('prefers the roles row over the legacy table when both are present', () => {
    // A membership whose legacy string still says 'owner' but whose role row
    // grants one area is the shape a role reassignment leaves behind until the
    // sync trigger catches up. The row is authoritative.
    const caps = membershipCapabilities('owner', {
      role_areas: [{ area_key: 'scheduling', level: 'view' }],
      role_flags: [],
    });

    expect(caps).not.toContain('manage:collaborators');
    expect(caps).toContain('view:scheduling');
  });
});
