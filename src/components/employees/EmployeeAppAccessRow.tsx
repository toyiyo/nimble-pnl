import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { RolePicker } from '@/components/roles/RolePicker';
import { useRestaurantMembers } from '@/hooks/useRestaurantMembers';
import type { RoleWithGrants } from '@/hooks/useRoles';
import { isInternalTeamRole } from '@/lib/permissions/roleMembership';
import { ROLE_METADATA } from '@/lib/permissions/definitions';
import { CUSTOM_ROLE } from '@/lib/permissions/invitations';
import type { Role } from '@/lib/permissions/types';
import type { Employee } from '@/types/scheduling';

export interface EmployeeAppAccessRowProps {
  restaurantId: string;
  /** Caller's role in THIS restaurant, or null when it can't be established. */
  callerRole: Role | null;
  /** Undefined in create mode. */
  employee?: Employee;
  /** Email currently typed in the dialog. */
  email: string;
  grantAppAccess: boolean;
  onGrantAppAccessChange: (next: boolean) => void;
  /** Chosen invite role. null means "unchosen" — the payload then defaults to staff. */
  inviteRole: RoleWithGrants | null;
  onInviteRoleChange: (role: RoleWithGrants) => void;
  /** Provided in edit mode only. Sends immediately. */
  onSendInvite?: () => void;
  sendingInvite?: boolean;
}

function AppAccessSkeleton() {
  return (
    <div className="rounded-lg border border-border/40 bg-muted/30 p-3 space-y-2">
      <Skeleton className="h-3 w-20" />
      <Skeleton className="h-4 w-48" />
    </div>
  );
}

/** ROLE_METADATA doesn't have an entry for the bare collaborator_custom
 * literal (see CUSTOM_ROLE in invitations.ts) — mirrors the fallback
 * RolePicker.tsx uses for its own currentLabel. */
function roleLabelFor(role: string): string {
  return ROLE_METADATA[role as Role]?.label ?? (role === CUSTOM_ROLE ? 'Custom role' : role);
}

export function EmployeeAppAccessRow({
  restaurantId,
  callerRole,
  employee,
  grantAppAccess,
  onGrantAppAccessChange,
}: EmployeeAppAccessRowProps) {
  const { data: members, isLoading, isError } = useRestaurantMembers(restaurantId);

  if (isLoading) return <AppAccessSkeleton />;
  if (isError) {
    return (
      <div
        role="alert"
        className="rounded-lg border border-border/40 bg-muted/30 p-3 text-[13px] text-muted-foreground"
      >
        Couldn't load access details.
      </div>
    );
  }

  const member = employee?.user_id
    ? members?.find((m) => m.userId === employee.user_id) ?? null
    : null;

  if (member) {
    // The data already came back from a query RLS approved for the real
    // caller — that alone proves this is safe to show, regardless of
    // whether the client-side `callerRole` guess is trustworthy. What
    // `callerRole` decides is only whether the RolePicker (which needs a
    // definite role to gate its option list) is safe to render, or whether
    // to fall back to a read-only display of the same information.
    return (
      <div className="rounded-lg border border-border/40 bg-muted/30 p-3 space-y-2">
        <Label className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
          App access
        </Label>
        <p className="text-[13px] text-muted-foreground truncate">
          Signed in as <span className="text-foreground">{member.email}</span>
        </p>
        {callerRole ? (
          <RolePicker
            membershipId={member.membershipId}
            restaurantId={restaurantId}
            personName={employee?.name ?? member.fullName ?? 'this member'}
            currentRole={member.role}
            currentRoleId={member.roleId}
            callerRole={callerRole}
          />
        ) : (
          <p className="text-[14px] font-medium text-foreground">{roleLabelFor(member.role)}</p>
        )}
        <p className="text-[13px] text-muted-foreground">
          Roles belong to the EasyShiftHQ account, not the employee record — the same control
          appears on Team members.
        </p>
      </div>
    );
  }

  // No linked account was found. RLS on user_restaurants
  // (20260120100000:201-212) returns every row only to internal team roles —
  // to a collaborator, the roster is just their own row, so a miss here means
  // "cannot see", not "no account". Saying "No access" here would be a
  // confident lie about someone with full access. A null callerRole (e.g. a
  // restaurant-context mismatch) gets the same treatment: we don't know it's
  // safe to say "no account", so say nothing.
  if (!isInternalTeamRole(callerRole)) return null;

  return (
    <div className="rounded-lg border border-border/40 bg-muted/30 p-3 space-y-2">
      <Label className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
        App access
      </Label>
      <p className="text-[13px] text-muted-foreground">No access</p>
      <div className="flex items-center justify-between">
        <Label
          htmlFor="employeeAppAccessInvite"
          className="text-[14px] font-medium text-foreground cursor-pointer"
        >
          Invite to the app
        </Label>
        <Switch
          id="employeeAppAccessInvite"
          checked={grantAppAccess}
          onCheckedChange={onGrantAppAccessChange}
          className="data-[state=checked]:bg-foreground"
          aria-label="Invite to the app"
        />
      </div>
    </div>
  );
}
