import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { UserPlus } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useRestaurantMembers } from '@/hooks/useRestaurantMembers';
import { useRoles, type RoleWithGrants } from '@/hooks/useRoles';
import { AssignPeopleDialog } from '@/components/roles/AssignPeopleDialog';
import { RolePicker } from '@/components/roles/RolePicker';
import { MemberIdentity } from '@/components/roles/MemberIdentity';
import { memberDisplayName } from '@/components/roles/memberDisplay';
import { canAssignAnyRole, canAssignTargetRole } from '@/lib/permissions/invitations';
import { legacyRoleIndex, membersInRole } from '@/lib/permissions/roleMembership';
import type { Role } from '@/lib/permissions/types';

/**
 * RoleRoster — "Who's in this role", the People tab of the role editor.
 *
 * Each row's role chip is a live `RolePicker`, so moving someone out of this
 * role means naming where they go. The prototype had a bare "Move out" button;
 * that would silently demote to Employee, which is a decision the person
 * clicking it never made.
 *
 * No `onAssigned` callback: this surface reads `useRestaurantMembers`, which
 * `useAssignRole` invalidates directly.
 */

export interface RoleRosterProps {
  role: RoleWithGrants;
  restaurantId: string;
  /** The signed-in user's role in this restaurant. */
  callerRole: Role;
}

export function RoleRoster({ role, restaurantId, callerRole }: RoleRosterProps) {
  const { user } = useAuth();
  const { roles } = useRoles(restaurantId);
  const { data: members, isLoading, error } = useRestaurantMembers(restaurantId);
  const [assignOpen, setAssignOpen] = useState(false);

  // Two different questions. A row's picker offers every role the caller may
  // assign, so it only needs "any at all". "Assign people" names THIS role up
  // front, so it needs "this one" — otherwise an operations_manager (who may
  // assign only staff) gets the button on a custom role, and a manager gets it
  // on Owner, and every person they pick comes back 42501.
  const canAssign = canAssignAnyRole(callerRole);
  const canAssignIntoRole = canAssignTargetRole(callerRole, role, restaurantId);

  const roster = useMemo(
    () => membersInRole(members ?? [], role.id, legacyRoleIndex(roles)),
    [members, role.id, roles]
  );

  // The empty state owns the action when there is nothing else on the panel;
  // showing it in the header too would put the same button on screen twice.
  const showEmptyState = !isLoading && !error && roster.length === 0;

  const assignButton = canAssignIntoRole ? (
    <Button
      onClick={() => setAssignOpen(true)}
      className="h-9 px-4 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[13px] font-medium"
    >
      <UserPlus className="h-4 w-4 mr-1.5" aria-hidden="true" />
      Assign people
    </Button>
  ) : null;

  // One state per branch, as sequential returns rather than a ternary chain.
  // A plain function, not a component: it closes over the values above, and it
  // is called — not mounted — so React never remounts the list.
  const renderRoster = () => {
    if (isLoading) {
      return (
        <div className="space-y-2" data-testid="role-roster-loading">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-14 w-full rounded-xl" />
          ))}
        </div>
      );
    }
    if (error) {
      // The assign button above stays usable: it reads the same query, but a
      // failed roster is no reason to block the action that fixes an empty one.
      return (
        <p role="alert" className="text-[13px] text-destructive">
          Couldn&apos;t load who&apos;s in this role. Please try again.
        </p>
      );
    }
    if (roster.length === 0) {
      return (
        <div className="flex flex-col items-center gap-2 py-10 px-6 rounded-xl border border-dashed border-border/40 text-center">
          <p className="text-[14px] font-medium text-foreground">Nobody is in {role.name} yet</p>
          <p className="text-[13px] text-muted-foreground max-w-sm">
            A role does nothing until someone holds it. Assign people to put this role to work.
          </p>
          {assignButton && <div className="mt-2">{assignButton}</div>}
        </div>
      );
    }
    return (
      <div className="space-y-1.5">
        {roster.map((member) => (
          <div
            key={member.membershipId}
            className="flex items-center justify-between gap-3 p-3 rounded-xl border border-border/40 bg-background"
          >
            <MemberIdentity member={member} />
            <RolePicker
              membershipId={member.membershipId}
              restaurantId={restaurantId}
              personName={memberDisplayName(member)}
              currentRole={member.role}
              currentRoleId={member.roleId}
              callerRole={callerRole}
              // Each condition mirrors a rule assign_membership_role would
              // otherwise raise 42501 on: no assign rights at all, self
              // (rule 2), kiosk (rule 4), an owner changed by a non-owner
              // (rule 5a).
              disabled={
                !canAssign ||
                (!!user && member.userId === user.id) ||
                member.role === 'kiosk' ||
                (member.role === 'owner' && callerRole !== 'owner')
              }
            />
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-[15px] font-semibold text-foreground">Who&apos;s in this role</h3>
          <p className="text-[13px] text-muted-foreground mt-0.5">
            Changing someone&apos;s role here changes what they see everywhere.
          </p>
        </div>
        {!showEmptyState && assignButton}
      </div>

      {renderRoster()}

      {canAssignIntoRole && (
        <AssignPeopleDialog
          role={role}
          restaurantId={restaurantId}
          callerRole={callerRole}
          open={assignOpen}
          onOpenChange={setAssignOpen}
        />
      )}
    </div>
  );
}
