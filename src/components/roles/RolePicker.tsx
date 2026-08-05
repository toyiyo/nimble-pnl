import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ArrowUp, ArrowDown } from 'lucide-react';
import { useRoles, type RoleWithGrants } from '@/hooks/useRoles';
import { useAssignRole, assignRoleErrorMessage } from '@/hooks/useAssignRole';
import { useToast } from '@/hooks/use-toast';
import { RoleSelect } from '@/components/roles/RoleSelect';
import { ROLE_METADATA } from '@/lib/permissions/definitions';
import { CUSTOM_ROLE } from '@/lib/permissions/invitations';
import { roleDelta, type RoleGrantSet } from '@/lib/permissions/roleDelta';
import type { Role } from '@/lib/permissions/types';

export interface RolePickerProps {
  membershipId: string;
  restaurantId: string;
  /** Display name of the person whose role this is — for the accessible name. */
  personName: string;
  currentRole: string;
  currentRoleId: string | null;
  /** The signed-in user's role in this restaurant — gates the option list. */
  callerRole: Role;
  disabled?: boolean;
  /**
   * Called after the assignment lands. Only needed by hosts that keep their
   * member list outside React Query — `useAssignRole` invalidates
   * `['roles'|'collaborators'|'restaurants']`, which cannot reach a list held
   * in `useState`. TeamMembers is such a host; Collaborators is not.
   */
  onAssigned?: () => void;
}

const grantSetOf = (role: RoleWithGrants | undefined): RoleGrantSet => ({
  areas: role?.role_areas ?? [],
  flags: (role?.role_flags ?? []).map((f) => f.flag),
});

/** One "Gains X" / "Loses X" line per label, styled and iconed by `kind`. */
function renderDeltaLines(labels: string[], kind: 'gain' | 'lose') {
  const Icon = kind === 'gain' ? ArrowUp : ArrowDown;
  const colorClass = kind === 'gain' ? 'text-success' : 'text-destructive';
  const verb = kind === 'gain' ? 'Gains' : 'Loses';
  return labels.map((label) => (
    <p key={`${kind}-${label}`} className={`flex items-center gap-1.5 text-[13px] ${colorClass}`}>
      <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
      {verb} {label}
    </p>
  ));
}

export function RolePicker({
  membershipId,
  restaurantId,
  personName,
  currentRole,
  currentRoleId,
  callerRole,
  disabled = false,
  onAssigned,
}: RolePickerProps) {
  const [open, setOpen] = useState(false);
  const [candidateId, setCandidateId] = useState<string | null>(null);
  const { toast } = useToast();

  // useRoles returns { roles, isLoading, error, ... } — NOT a raw React Query
  // result, so there is no `data` here. RolePicker still needs `roles` for
  // currentRow/candidateRow/currentLabel; RoleSelect makes the same call
  // under the same React Query key, so this is one fetch, two readers.
  const { roles } = useRoles(restaurantId);
  const assign = useAssignRole(restaurantId);

  const isCurrent = (r: RoleWithGrants) =>
    currentRoleId ? r.id === currentRoleId : r.legacy_role === currentRole;

  const currentRow = roles.find(isCurrent);
  const candidateRow = roles.find((r) => r.id === candidateId);
  const delta = candidateRow
    ? roleDelta(grantSetOf(currentRow), grantSetOf(candidateRow))
    : null;

  // `collaborator_custom` is not a `Role` (see CUSTOM_ROLE in invitations.ts)
  // and never has a `legacy_role` row to match when `currentRoleId` is null
  // or points at a role `useRoles` hasn't resolved — so it must never fall
  // through to the raw literal. Mirrors `roleLabelFor` in
  // CollaboratorInvitations.tsx.
  const currentLabel =
    currentRow?.name ??
    ROLE_METADATA[currentRole as Role]?.label ??
    (currentRole === CUSTOM_ROLE ? 'Custom role' : currentRole);

  const commit = () => {
    if (!candidateRow) return;
    const isCustom = candidateRow.legacy_role === null;
    assign.mutate(
      {
        membershipId,
        // `legacy_role` is typed `string | null` because that is the column's
        // shape, but 20260802100000 constrains it to the builtin role names
        // via `builtin_role_id_for` plus a builtin-only CHECK — so on the
        // non-custom branch it is a `Role`.
        role: isCustom ? CUSTOM_ROLE : (candidateRow.legacy_role as Role),
        roleId: isCustom ? candidateRow.id : undefined,
      },
      {
        onSuccess: () => {
          toast({ title: `${personName} is now ${candidateRow.name}` });
          setOpen(false);
          setCandidateId(null);
          onAssigned?.();
        },
        onError: (err) =>
          toast({
            title: "Couldn't change that role",
            description: assignRoleErrorMessage(err),
            variant: 'destructive',
          }),
      }
    );
  };

  // The chip IS the control, so the visible text is the role name alone. WCAG
  // 2.5.3 Label in Name requires the accessible name to CONTAIN that visible
  // text, so a voice-control user saying "click Manager" still hits it —
  // hence the name is embedded rather than replaced.
  const triggerLabel = `${personName}: role is ${currentLabel}. Change role`;

  return (
    <RoleSelect
      restaurantId={restaurantId}
      callerRole={callerRole}
      // The CURRENT role, not the candidate — `isCurrent` above never moves
      // when you click an option, and the footer is what shows the pending
      // choice. Passing `candidateId` here would erase the only on-screen
      // record of the role the person holds today.
      value={currentRow?.id ?? null}
      onSelect={(r) => setCandidateId(r.id)}
      triggerLabel={triggerLabel}
      triggerText={currentLabel}
      disabled={disabled}
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setCandidateId(null);
      }}
      footer={
        delta && candidateRow ? (
          <div className="space-y-2 border-t border-border/40 px-3 py-3">
            {delta.isSame ? (
              <p className="text-[13px] text-muted-foreground">
                Same access — only the label changes.
              </p>
            ) : (
              <div className="space-y-1">
                {renderDeltaLines(
                  [...delta.gains.map((g) => g.label), ...delta.flagGains.map((f) => f.label)],
                  'gain'
                )}
                {renderDeltaLines(
                  [...delta.loses.map((l) => l.label), ...delta.flagLoses.map((f) => f.label)],
                  'lose'
                )}
              </div>
            )}
            <Button
              onClick={commit}
              disabled={assign.isPending}
              aria-label={`Change role to ${candidateRow.name}`}
              className="h-9 w-full rounded-lg bg-foreground text-[13px] font-medium text-background hover:bg-foreground/90"
            >
              {assign.isPending ? 'Changing…' : `Change role to ${candidateRow.name}`}
            </Button>
          </div>
        ) : null
      }
    />
  );
}
