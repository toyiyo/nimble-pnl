import { useState, type ReactNode } from 'react';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { RolePicker } from '@/components/roles/RolePicker';
import { RoleSelect, type RoleSelectProps } from '@/components/roles/RoleSelect';
import { RoleAreaChips } from '@/components/roles/RoleAreaChips';
import { useAuth } from '@/hooks/useAuth';
import { useRestaurantMembers } from '@/hooks/useRestaurantMembers';
import type { RoleWithGrants } from '@/hooks/useRoles';
import { isInternalTeamRole } from '@/lib/permissions/roleMembership';
import { ROLE_METADATA } from '@/lib/permissions/definitions';
import { canAssignAnyRole, CUSTOM_ROLE } from '@/lib/permissions/invitations';
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

/** The card shell every state below shares — the "App access" label plus the
 * same border/background. Only the body differs. */
function AppAccessCard({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-border/40 bg-muted/30 p-3 space-y-2">
      <Label className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
        App access
      </Label>
      {children}
    </div>
  );
}

function AppAccessSkeleton() {
  return (
    <AppAccessCard>
      <Skeleton className="h-4 w-48" />
    </AppAccessCard>
  );
}

/** ROLE_METADATA doesn't have an entry for the bare collaborator_custom
 * literal (see CUSTOM_ROLE in invitations.ts) — mirrors the fallback
 * RolePicker.tsx uses for its own currentLabel. */
function roleLabelFor(role: string): string {
  return ROLE_METADATA[role as Role]?.label ?? (role === CUSTOM_ROLE ? 'Custom role' : role);
}

/** Named against RoleSelect's own props so a typo lands on the object literal
 * that builds it rather than at the spread site. */
type InvitePickerProps = Pick<
  RoleSelectProps,
  'restaurantId' | 'callerRole' | 'value' | 'onSelect' | 'triggerText' | 'triggerLabel' | 'open' | 'onOpenChange'
>;

/** Edit mode: the invite fires on its own button rather than on the dialog's
 * Save, so it lives behind a disclosure instead of sitting open next to
 * unrelated fields. Three states, each its own early return. */
function EditModeInvite({
  savedEmail,
  typedEmailDiffers,
  expanded,
  onExpand,
  picker,
  inviteRole,
  onSendInvite,
  sendingInvite,
}: {
  savedEmail: string | undefined;
  typedEmailDiffers: boolean;
  expanded: boolean;
  onExpand: () => void;
  picker: InvitePickerProps;
  inviteRole: RoleWithGrants | null;
  onSendInvite: () => void;
  sendingInvite?: boolean;
}) {
  if (!savedEmail) {
    return (
      <p className="text-[13px] text-muted-foreground">
        Add an email address and save before inviting this employee to the app.
      </p>
    );
  }

  if (!expanded) {
    return (
      <Button
        type="button"
        variant="ghost"
        onClick={onExpand}
        className="h-9 px-4 -ml-4 rounded-lg text-[13px] font-medium text-muted-foreground hover:text-foreground"
      >
        Invite to the app…
      </Button>
    );
  }

  return (
    <>
      <RoleSelect {...picker} />
      {inviteRole && <RoleAreaChips areas={inviteRole.role_areas} />}
      <Button
        type="button"
        variant="ghost"
        onClick={onSendInvite}
        disabled={sendingInvite || typedEmailDiffers}
        className="h-9 px-4 -ml-4 rounded-lg text-[13px] font-medium text-muted-foreground hover:text-foreground"
      >
        {sendingInvite ? 'Sending…' : 'Send invite'}
      </Button>
      {typedEmailDiffers && (
        <p className="text-[13px] text-muted-foreground">Save the email change before inviting.</p>
      )}
    </>
  );
}

export function EmployeeAppAccessRow({
  restaurantId,
  callerRole,
  employee,
  email,
  grantAppAccess,
  onGrantAppAccessChange,
  inviteRole,
  onInviteRoleChange,
  onSendInvite,
  sendingInvite,
}: EmployeeAppAccessRowProps) {
  const { data: members, isLoading, isError } = useRestaurantMembers(restaurantId);
  const { user } = useAuth();
  const [inviteExpanded, setInviteExpanded] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  if (isLoading) return <AppAccessSkeleton />;
  if (isError) {
    return (
      <AppAccessCard>
        <p role="alert" className="text-[13px] text-muted-foreground">
          Couldn't load access details.
        </p>
      </AppAccessCard>
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
      <AppAccessCard>
        {/* RestaurantMember.email is nullable -- the roster reads it from a
            joined profiles row that may not have one. "Signed in as" trailing
            off into nothing reads like a rendering bug, so name the state. */}
        <p className="text-[13px] text-muted-foreground truncate">
          {member.email ? (
            <>
              Signed in as <span className="text-foreground">{member.email}</span>
            </>
          ) : (
            'Signed in to the app'
          )}
        </p>
        {callerRole ? (
          <RolePicker
            membershipId={member.membershipId}
            restaurantId={restaurantId}
            personName={employee?.name ?? member.fullName ?? 'this member'}
            currentRole={member.role}
            currentRoleId={member.roleId}
            callerRole={callerRole}
            // The same four conditions RoleRoster and TeamMembers disable on,
            // each mirroring a rule `assign_membership_role` would otherwise
            // raise 42501 for: no assign rights at all, self (rule 2), kiosk
            // (rule 4), an owner changed by a non-owner (rule 5a). Without
            // this, opening your own employee dialog offers a menu where every
            // choice ends in an error toast.
            disabled={
              !canAssignAnyRole(callerRole) ||
              (!!user && member.userId === user.id) ||
              member.role === 'kiosk' ||
              (member.role === 'owner' && callerRole !== 'owner')
            }
          />
        ) : (
          <p className="text-[14px] font-medium text-foreground">{roleLabelFor(member.role)}</p>
        )}
        <p className="text-[13px] text-muted-foreground">
          Roles belong to the EasyShiftHQ account, not the employee record — the same control
          appears on Team members.
        </p>
      </AppAccessCard>
    );
  }

  // No linked account was found. RLS on user_restaurants
  // (20260120100000:201-212) returns every row only to internal team roles —
  // to a collaborator, the roster is just their own row, so a miss here means
  // "cannot see", not "no account". Saying "No access" here would be a
  // confident lie about someone with full access. A null callerRole (e.g. a
  // restaurant-context mismatch) gets the same treatment: we don't know it's
  // safe to say "no account", so say nothing.
  //
  // The `!callerRole ||` half narrows callerRole to non-null for the rest of
  // this branch (isInternalTeamRole itself returns a plain boolean, not a
  // type predicate) — RoleSelect below requires a definite Role.
  if (!callerRole || !isInternalTeamRole(callerRole)) return null;

  const inviteLabel = inviteRole?.name ?? ROLE_METADATA.staff.label;

  // Both invite branches below render the same picker, so they share one set
  // of props — and one open state, since only one of them is ever mounted.
  //
  // Closing on select is the difference between this picker and RolePicker's.
  // There, the choice is a candidate: the footer shows the access delta and a
  // commit button, so the popover has to stay open until the assignment lands.
  // Here the choice IS the whole action — there is no footer and nothing left
  // to confirm — so leaving it open would just park a 340px panel over the
  // rest of the form.
  const invitePickerProps: InvitePickerProps = {
    restaurantId,
    callerRole,
    value: inviteRole?.id ?? null,
    onSelect: (role: RoleWithGrants) => {
      onInviteRoleChange(role);
      setPickerOpen(false);
    },
    triggerText: inviteLabel,
    triggerLabel: `Invite as ${inviteLabel}. Change role`,
    open: pickerOpen,
    onOpenChange: setPickerOpen,
  };

  // Edit mode: `onSendInvite` is only ever passed for an existing employee
  // record, so `employee` is defined here too — its SAVED email (not
  // whatever is currently typed in the dialog's field) is what the invite
  // can safely target, since that's the address the backend already
  // associates with this employee record.
  if (onSendInvite) {
    const savedEmail = employee?.email?.trim();
    // Case-insensitively, for the reason findMemberByEmail documents:
    // profiles.email is plain TEXT, not CITEXT, so the same address can come
    // back in a different case than the user types it. Comparing strictly
    // would block the invite over a capital letter.
    const typedEmailDiffers =
      !!savedEmail && email.trim().toLowerCase() !== savedEmail.toLowerCase();

    return (
      <AppAccessCard>
        <p className="text-[13px] text-muted-foreground">No access</p>
        <EditModeInvite
          savedEmail={savedEmail}
          typedEmailDiffers={typedEmailDiffers}
          expanded={inviteExpanded}
          onExpand={() => setInviteExpanded(true)}
          picker={invitePickerProps}
          inviteRole={inviteRole}
          onSendInvite={onSendInvite}
          sendingInvite={sendingInvite}
        />
      </AppAccessCard>
    );
  }

  return (
    <AppAccessCard>
      <p className="text-[13px] text-muted-foreground">No access</p>
      <div className="flex items-center justify-between">
        <Label
          htmlFor="grantAppAccess"
          className="text-[14px] font-medium text-foreground cursor-pointer"
        >
          Invite to the employee app
        </Label>
        <Switch
          id="grantAppAccess"
          checked={grantAppAccess}
          // aria-disabled rather than disabled: a disabled Switch leaves
          // the tab order, so a keyboard user never hears why it is off.
          aria-disabled={!email.trim() ? true : undefined}
          aria-describedby="grantAppAccessHint"
          onCheckedChange={(checked) => {
            if (!email.trim()) return;
            onGrantAppAccessChange(checked);
          }}
          className="data-[state=checked]:bg-foreground aria-disabled:opacity-50 aria-disabled:cursor-not-allowed"
          aria-label="Invite to the employee app"
        />
      </div>
      <p id="grantAppAccessHint" className="text-[13px] text-muted-foreground">
        {!email.trim()
          ? 'Add an email address to enable.'
          : inviteRole?.description ??
            'Lets them clock in, view their own schedule, and request time off from their phone.'}
      </p>
      {grantAppAccess && email.trim() && (
        <>
          <RoleSelect {...invitePickerProps} />
          {inviteRole && <RoleAreaChips areas={inviteRole.role_areas} />}
        </>
      )}
    </AppAccessCard>
  );
}
