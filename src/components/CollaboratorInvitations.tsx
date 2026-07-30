import { useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { Calculator, Package, ChefHat, Briefcase, Clock, CheckCircle, XCircle, Trash2, Check, ArrowLeft, UserPlus, Users, AlertCircle, AlertTriangle, RefreshCw } from 'lucide-react';
import { canInviteCustomRole, COLLABORATOR_PRESETS, CUSTOM_ROLE, ROLE_METADATA } from '@/lib/permissions';
import type { CollaboratorPreset, InviteRoleLiteral, Role } from '@/lib/permissions';
import { formatExpiresIn } from '@/lib/invitationUtils';
import { grantMap } from '@/lib/permissions/areas';
import { useRoles, type RoleWithGrants } from '@/hooks/useRoles';
import { RoleAreaChips } from '@/components/roles/RoleAreaChips';
import { buildRolePreview } from '@/lib/permissions/preview';
import {
  useCollaboratorsQuery,
  useCollaboratorInvitesQuery,
  useSendCollaboratorInvitation,
  useCancelCollaboratorInvitation,
  useRemoveCollaborator,
  useResendCollaboratorInvitation,
} from '@/hooks/useCollaborators';
import { useRestaurantMembers, findMemberByEmail } from '@/hooks/useRestaurantMembers';
import { useAccountlessEmployees, resolveAccountlessEmployeeHint, resolveDescribedById } from '@/hooks/useAccountlessEmployees';
import { AccountlessEmployeeHint } from '@/components/invitations/AccountlessEmployeeHint';

interface CollaboratorInvitationsProps {
  restaurantId: string;
  userRole: Role;
}

const roleIcons: Record<string, typeof Calculator> = {
  collaborator_accountant: Calculator,
  collaborator_inventory: Package,
  collaborator_chef: ChefHat,
  collaborator_operations_manager: Briefcase,
  // Every custom role shares this one literal, so this is the icon for all of
  // them — the same `Users` glyph RolesList gives a custom role's card.
  [CUSTOM_ROLE]: Users,
};

/**
 * What the picker has selected. A discriminated union rather than the old
 * `Role | null`, because a user-created role has no member of that closed
 * union: it is identified by a `roles` row, and only *carries* the shared
 * 'collaborator_custom' literal on the wire.
 */
type InviteSelection =
  | { kind: 'builtin'; preset: CollaboratorPreset }
  | { kind: 'custom'; role: RoleWithGrants };

/**
 * One card in the picker. Shared by the four built-in presets and the
 * restaurant's own custom roles so the two are visually the same choice —
 * only the CUSTOM badge distinguishes them.
 */
function RoleChoiceCard({
  icon: Icon,
  title,
  description,
  isSelected,
  isCustom = false,
  onSelect,
}: {
  icon: typeof Calculator;
  title: string;
  description: string | null;
  isSelected: boolean;
  isCustom?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      aria-pressed={isSelected}
      className={`
        relative p-4 rounded-lg border-2 text-left transition-all
        hover:border-primary/50 hover:bg-accent/50
        ${isSelected ? 'border-primary bg-primary/5' : 'border-border'}
      `}
    >
      {isSelected && (
        <div className="absolute top-2 right-2">
          <Check className="h-5 w-5 text-primary" />
        </div>
      )}
      <div className="flex items-start gap-3">
        <div className={`
          p-2 rounded-lg
          ${isSelected ? 'bg-primary text-primary-foreground' : 'bg-muted'}
        `}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="font-semibold text-sm">{title}</h4>
          {description && (
            <p className="text-xs text-muted-foreground mt-1">{description}</p>
          )}
          {isCustom && (
            <span className="inline-block mt-2 text-[10px] px-1.5 py-0.5 rounded-md border border-border/40 font-mono uppercase tracking-wider text-muted-foreground">
              Custom
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

export function CollaboratorInvitations({ restaurantId, userRole }: CollaboratorInvitationsProps) {
  const [selection, setSelection] = useState<InviteSelection | null>(null);
  const [email, setEmail] = useState('');
  const { toast } = useToast();

  const canManage = userRole === 'owner' || userRole === 'manager';
  // Read through the shared predicate rather than reusing `canManage`, so the
  // picker can never offer a role the endpoint would refuse to send.
  const canOfferCustomRoles = canInviteCustomRole(userRole);

  // Loaded for everyone with access to this screen, not just managers: the
  // Active Collaborators list below needs role *names* to label a custom-role
  // member, whose `role` column is only ever the bare literal.
  const { roles, isLoading: rolesLoading, error: rolesError } = useRoles(restaurantId);

  const customRoles = useMemo(
    () => roles.filter((role) => !role.builtin && role.flavor === 'collaborator'),
    [roles]
  );

  const roleNamesById = useMemo(
    () => new Map(roles.map((role) => [role.id, role.name])),
    [roles]
  );

  /**
   * The label to show for a membership or invitation. A custom role's name
   * comes from its `roles` row; anything else falls back to the static
   * metadata, and finally to the raw literal so an unknown role still renders
   * something rather than blank.
   */
  const roleLabelFor = (role: string, roleId: string | null) =>
    (roleId ? roleNamesById.get(roleId) : undefined) ?? ROLE_METADATA[role as Role]?.label ?? role;

  const { data: collaborators, isLoading: collaboratorsLoading, error: collaboratorsError } = useCollaboratorsQuery(restaurantId);
  const { data: pendingInvites, isLoading: invitesLoading, error: invitesError } = useCollaboratorInvitesQuery(restaurantId);

  const sendInvitationMutation = useSendCollaboratorInvitation();
  const cancelInvitationMutation = useCancelCollaboratorInvitation();
  const removeCollaboratorMutation = useRemoveCollaborator();
  const resendInvitationMutation = useResendCollaboratorInvitation();
  const [showCancelledInvites, setShowCancelledInvites] = useState(false);
  const [resendingIds, setResendingIds] = useState<Set<string>>(new Set());

  const { data: members, isLoading: membersLoading, isError: membersIsError } = useRestaurantMembers(restaurantId);
  // null while loading, on error, or for a non-member — all "proceed normally".
  const existingMember = findMemberByEmail(members, email);
  const blockedPanelId = 'collab-existing-member-warning';

  const { data: accountlessEmployees } = useAccountlessEmployees(restaurantId);
  const accountlessEmployee = resolveAccountlessEmployeeHint(
    existingMember,
    membersLoading,
    membersIsError,
    accountlessEmployees,
    email
  );
  const hintPanelId = 'collab-existing-employee-hint';
  const activeDescribedById = resolveDescribedById(existingMember, accountlessEmployee, blockedPanelId, hintPanelId);

  const handleSendInvitation = () => {
    // existingMember only ever soft-disables via aria-disabled (see the Send
    // button below), which deliberately keeps it focusable for screen-reader
    // users — so this guard is load-bearing, not defensive: without it a
    // click would still fire.
    // membersLoading, by contrast, drives the button's real `disabled`
    // attribute, which already blocks clicks natively. It's guarded here too
    // (belt-and-suspenders) because the member lookup hasn't resolved yet, so
    // existingMember can't be trusted to catch a duplicate invite.
    if (membersLoading || existingMember) return;

    // Normalize once so whitespace-only input is rejected and the trimmed
    // address is what we send — matching findMemberByEmail, which also trims.
    const normalizedEmail = email.trim();
    if (!normalizedEmail || !selection) {
      toast({
        title: "Error",
        description: "Please select a role and enter an email",
        variant: "destructive",
      });
      return;
    }

    sendInvitationMutation.mutate(
      {
        restaurantId,
        email: normalizedEmail,
        // A custom role travels as the shared literal plus the id that names
        // the actual grant; a builtin travels as its own role string alone.
        ...(selection.kind === 'custom'
          ? { role: CUSTOM_ROLE, roleId: selection.role.id, roleLabel: selection.role.name }
          : { role: selection.preset.role }),
        ...(accountlessEmployee ? { employeeId: accountlessEmployee.id } : {}),
      },
      {
        onSuccess: () => {
          setEmail('');
          setSelection(null);
        },
      }
    );
  };

  const handleCancelInvitation = (inviteId: string, inviteEmail: string) => {
    cancelInvitationMutation.mutate({
      inviteId,
      inviteEmail,
      restaurantId,
    });
  };

  const handleRemoveCollaborator = (collaboratorId: string, collaboratorEmail: string) => {
    removeCollaboratorMutation.mutate({
      collaboratorId,
      collaboratorEmail,
      restaurantId,
    });
  };

  const handleResendInvitation = (invite: { id: string; email: string; role: string; roleId: string | null }) => {
    setResendingIds(prev => new Set(prev).add(invite.id));
    resendInvitationMutation.mutate(
      {
        restaurantId,
        email: invite.email,
        role: invite.role as InviteRoleLiteral,
        // Carried through so a custom-role resend still names its role.
        ...(invite.roleId ? { roleId: invite.roleId } : {}),
        roleLabel: roleLabelFor(invite.role, invite.roleId),
      },
      { onSettled: () => setResendingIds(prev => { const s = new Set(prev); s.delete(invite.id); return s; }) }
    );
  };

  const statusIcons = {
    pending: <Clock className="h-4 w-4 text-muted-foreground" />,
    accepted: <CheckCircle className="h-4 w-4 text-primary" />,
    expired: <XCircle className="h-4 w-4 text-destructive" />,
    cancelled: <XCircle className="h-4 w-4 text-muted-foreground" />,
  };

  const statusColors = {
    pending: "secondary",
    accepted: "default",
    expired: "destructive",
    cancelled: "outline",
  } as const;

  const cancelledInvites = pendingInvites?.filter(i => i.status === 'cancelled') ?? [];

  const renderRoleSelection = () => (
    <div className="space-y-4">
      <div className="text-center mb-6">
        <h3 className="text-lg font-semibold mb-2">Who is this collaborator?</h3>
        <p className="text-sm text-muted-foreground">
          Select the type of access they need
        </p>
      </div>

      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
        {COLLABORATOR_PRESETS.map((preset) => (
          <RoleChoiceCard
            key={preset.role}
            icon={roleIcons[preset.role] || Calculator}
            title={preset.title}
            description={preset.description}
            isSelected={selection?.kind === 'builtin' && selection.preset.role === preset.role}
            onSelect={() => setSelection({ kind: 'builtin', preset })}
          />
        ))}

        {canOfferCustomRoles && customRoles.map((role) => (
          <RoleChoiceCard
            key={role.id}
            icon={Users}
            title={role.name}
            description={role.description}
            isCustom
            isSelected={selection?.kind === 'custom' && selection.role.id === role.id}
            onSelect={() => setSelection({ kind: 'custom', role })}
          />
        ))}

        {canOfferCustomRoles && rolesLoading && (
          <>
            <Skeleton className="h-[104px] rounded-lg" />
            <Skeleton className="h-[104px] rounded-lg" />
          </>
        )}
      </div>

      {canOfferCustomRoles && rolesError && (
        <div className="flex items-center gap-3 p-4 rounded-lg bg-destructive/10 text-destructive">
          <AlertCircle className="h-5 w-5 flex-shrink-0" />
          <p className="text-sm">
            Failed to load your custom roles — the four built-in ones above still work.
          </p>
        </div>
      )}
    </div>
  );

  const renderEmailInput = () => {
    if (!selection) return null;

    const isCustom = selection.kind === 'custom';
    const title = isCustom ? selection.role.name : selection.preset.title;
    const description = isCustom ? selection.role.description : selection.preset.description;
    const Icon = isCustom ? Users : (roleIcons[selection.preset.role] || Calculator);

    return (
      <div className="space-y-6">
        <button
          onClick={() => setSelection(null)}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to role selection
        </button>

        <div className="flex items-start gap-4 p-4 rounded-lg bg-muted/50 border">
          <div className="p-2 rounded-lg bg-primary text-primary-foreground">
            <Icon className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <h4 className="font-semibold">{title}</h4>
            {description && (
              <p className="text-sm text-muted-foreground mt-1">{description}</p>
            )}
            {/*
              A preset's capabilities are a hand-written feature list; a custom
              role has no such list, so its granted areas stand in — the same
              chips and the same can/can't sentence the role editor's preview
              shows, from the same `buildRolePreview`, so what an owner reads
              here cannot drift from what they granted there.
            */}
            {isCustom ? (
              <div className="mt-3 space-y-2">
                <RoleAreaChips areas={selection.role.role_areas} />
                <p className="text-[13px] text-muted-foreground">
                  {buildRolePreview(
                    grantMap(selection.role.role_areas),
                    selection.role.role_flags.map((f) => f.flag),
                    selection.role.name
                  ).summary}
                </p>
              </div>
            ) : (
              <div className="mt-3 space-y-1">
                {selection.preset.features.map((feature, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm">
                    <Check className="h-3 w-3 text-primary" />
                    <span>{feature}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="collaborator-email">Email address</Label>

          {existingMember && (
            <div
              id={blockedPanelId}
              role="status"
              aria-live="polite"
              className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-[13px]"
            >
              <AlertTriangle className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
              <p className="text-foreground">
                <strong>{existingMember.fullName ?? existingMember.email}</strong> is already
                on your team as {roleLabelFor(existingMember.role, existingMember.roleId)}.
                Sending another invitation will not change their access — accepting it does
                nothing. To change what they can see, use the role dropdown in{' '}
                <strong>Team Members</strong>.
              </p>
            </div>
          )}

          {accountlessEmployee && (
            <AccountlessEmployeeHint
              id={hintPanelId}
              employeeName={accountlessEmployee.name}
              roleLabel={isCustom ? selection.role.name : (ROLE_METADATA[selection.preset.role]?.label ?? selection.preset.title)}
            />
          )}

          <div className="flex gap-2">
            <Input
              id="collaborator-email"
              type="email"
              placeholder="collaborator@example.com"
              value={email}
              aria-describedby={activeDescribedById}
              onChange={(e) => setEmail(e.target.value)}
              className="flex-1"
            />
            <Button
              onClick={handleSendInvitation}
              disabled={membersLoading || sendInvitationMutation.isPending || !email.trim()}
              aria-disabled={existingMember ? true : undefined}
              className="aria-disabled:opacity-50 aria-disabled:cursor-not-allowed"
            >
              {sendInvitationMutation.isPending ? 'Sending...' : 'Send Invite'}
            </Button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {canManage && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <UserPlus className="h-5 w-5 text-primary" />
              </div>
              <div>
                <CardTitle className="text-lg">Invite Collaborator</CardTitle>
                <CardDescription>
                  Invite someone to help with specific tasks
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {selection ? renderEmailInput() : renderRoleSelection()}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Active Collaborators</CardTitle>
          <CardDescription>
            People with limited access to your restaurant
          </CardDescription>
        </CardHeader>
        <CardContent>
          {collaboratorsLoading ? (
            <div className="space-y-3">
              {[1, 2].map((i) => (
                <div key={i} className="flex items-center justify-between p-3 border border-border/40 rounded-xl">
                  <div className="flex items-center gap-3">
                    <Skeleton className="h-8 w-8 rounded-lg" />
                    <div className="space-y-2">
                      <Skeleton className="h-4 w-32" />
                      <Skeleton className="h-3 w-24" />
                    </div>
                  </div>
                  <Skeleton className="h-6 w-20" />
                </div>
              ))}
            </div>
          ) : collaboratorsError ? (
            <div className="flex items-center gap-3 p-4 rounded-lg bg-destructive/10 text-destructive">
              <AlertCircle className="h-5 w-5 flex-shrink-0" />
              <p className="text-sm">Failed to load collaborators</p>
            </div>
          ) : collaborators && collaborators.length > 0 ? (
            <div className="space-y-3">
              {collaborators.map((collab) => {
                const Icon = roleIcons[collab.role] || Calculator;

                return (
                  <div
                    key={collab.id}
                    className="flex items-center justify-between p-3 border border-border/40 rounded-xl hover:border-border transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-muted">
                        <Icon className="h-4 w-4" />
                      </div>
                      <div>
                        <p className="font-medium text-sm">
                          {collab.profileName || collab.email}
                        </p>
                        {collab.profileName && (
                          <p className="text-xs text-muted-foreground">
                            {collab.email}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">
                        {roleLabelFor(collab.role, collab.roleId)}
                      </Badge>
                      {canManage && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRemoveCollaborator(collab.id, collab.email)}
                          className="text-destructive hover:text-destructive hover:bg-destructive/10"
                          aria-label={`Remove collaborator ${collab.email}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-8">
              <Users className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground">No collaborators yet</p>
            </div>
          )}
        </CardContent>
      </Card>

      {(invitesLoading || invitesError || (pendingInvites && pendingInvites.length > 0)) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Invitations</CardTitle>
            <CardDescription>
              Pending and expired collaborator invitations
            </CardDescription>
          </CardHeader>
          <CardContent>
            {invitesLoading ? (
              <div className="space-y-3">
                {[1, 2].map((i) => (
                  <div key={i} className="flex items-center justify-between p-3 border border-border/40 rounded-xl">
                    <div className="flex items-center gap-3">
                      <Skeleton className="h-8 w-8 rounded-lg" />
                      <div className="space-y-2">
                        <Skeleton className="h-4 w-40" />
                        <Skeleton className="h-3 w-32" />
                      </div>
                    </div>
                    <Skeleton className="h-6 w-20" />
                  </div>
                ))}
              </div>
            ) : invitesError ? (
              <div className="flex items-center gap-3 p-4 rounded-lg bg-destructive/10 text-destructive">
                <AlertCircle className="h-5 w-5 flex-shrink-0" />
                <p className="text-sm">Failed to load invitations</p>
              </div>
            ) : (
              <div className="space-y-3">
                {pendingInvites
                  ?.filter(invite => invite.status === 'pending' || invite.status === 'expired')
                  .map((invite) => {
                    const Icon = roleIcons[invite.role] || Calculator;
                    const isExpired = invite.status === 'expired';

                    return (
                      <div
                        key={invite.id}
                        className="flex items-center justify-between p-3 border border-border/40 rounded-xl hover:border-border transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          <div className="p-2 rounded-lg bg-muted">
                            <Icon className="h-4 w-4" />
                          </div>
                          <div>
                            <p className="font-medium text-sm">{invite.email}</p>
                            <p className="text-xs text-muted-foreground">
                              {isExpired
                                ? `Expired — invited by ${invite.invitedBy || 'unknown'}`
                                : `Invited by ${invite.invitedBy || 'unknown'} • ${invite.expiresAt ? formatExpiresIn(invite.expiresAt) : 'No expiry'}`}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant={statusColors[invite.status]}>
                            {statusIcons[invite.status]}
                            <span className="ml-1 capitalize">{invite.status}</span>
                          </Badge>
                          {canManage && invite.status === 'pending' && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleCancelInvitation(invite.id, invite.email)}
                              className="text-destructive hover:text-destructive hover:bg-destructive/10"
                              aria-label={`Cancel invitation for ${invite.email}`}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                          {canManage && invite.status === 'expired' && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleResendInvitation(invite)}
                              disabled={resendingIds.has(invite.id)}
                              aria-busy={resendingIds.has(invite.id)}
                              aria-label={resendingIds.has(invite.id) ? `Sending invitation to ${invite.email}` : `Resend invitation to ${invite.email}`}
                              className="text-primary hover:text-primary hover:bg-primary/10"
                            >
                              <RefreshCw className={`h-4 w-4 ${resendingIds.has(invite.id) ? 'animate-spin' : ''}`} />
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })}

                {cancelledInvites.length > 0 && (
                  <>
                    <button
                      type="button"
                      aria-expanded={showCancelledInvites}
                      onClick={() => setShowCancelledInvites(prev => !prev)}
                      className="w-full text-center text-xs text-muted-foreground hover:text-foreground py-1 transition-colors"
                    >
                      {showCancelledInvites ? 'Hide cancelled' : `Show cancelled (${cancelledInvites.length})`}
                    </button>
                    {showCancelledInvites && cancelledInvites.map((invite) => {
                      const Icon = roleIcons[invite.role] || Calculator;
                      return (
                        <div key={invite.id} className="flex items-center justify-between p-3 border border-border/40 rounded-xl opacity-50">
                          <div className="flex items-center gap-3">
                            <div className="p-2 rounded-lg bg-muted">
                              <Icon className="h-4 w-4" />
                            </div>
                            <div>
                              <p className="font-medium text-sm">{invite.email}</p>
                              <p className="text-xs text-muted-foreground">Cancelled</p>
                            </div>
                          </div>
                          <Badge variant="outline">
                            <span className="capitalize">{invite.status}</span>
                          </Badge>
                        </div>
                      );
                    })}
                  </>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
