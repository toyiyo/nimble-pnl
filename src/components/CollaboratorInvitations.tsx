import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { Calculator, Package, ChefHat, Clock, CheckCircle, XCircle, Trash2, Check, ArrowLeft, UserPlus, Users } from 'lucide-react';
import { COLLABORATOR_PRESETS, ROLE_METADATA } from '@/lib/permissions';
import type { Role } from '@/lib/permissions';
import {
  useCollaboratorsQuery,
  useCollaboratorInvitesQuery,
  useSendCollaboratorInvitation,
  useCancelCollaboratorInvitation,
  useRemoveCollaborator,
} from '@/hooks/useCollaborators';

interface CollaboratorInvitationsProps {
  restaurantId: string;
  userRole: string;
}

const roleIcons: Record<string, typeof Calculator> = {
  collaborator_accountant: Calculator,
  collaborator_inventory: Package,
  collaborator_chef: ChefHat,
};

export const CollaboratorInvitations = ({ restaurantId, userRole }: CollaboratorInvitationsProps) => {
  const [selectedRole, setSelectedRole] = useState<Role | null>(null);
  const [email, setEmail] = useState('');
  const { toast } = useToast();

  const canManage = userRole === 'owner' || userRole === 'manager';

  // Use React Query hooks
  const { data: collaborators = [], isLoading: collaboratorsLoading } = useCollaboratorsQuery(restaurantId);
  const { data: pendingInvites = [], isLoading: invitesLoading } = useCollaboratorInvitesQuery(restaurantId);

  const sendInvitationMutation = useSendCollaboratorInvitation();
  const cancelInvitationMutation = useCancelCollaboratorInvitation();
  const removeCollaboratorMutation = useRemoveCollaborator();

  const loading = collaboratorsLoading || invitesLoading;

  const handleSendInvitation = () => {
    if (!email || !selectedRole) {
      toast({
        title: "Error",
        description: "Please select a role and enter an email",
        variant: "destructive",
      });
      return;
    }

    sendInvitationMutation.mutate(
      { restaurantId, email, role: selectedRole },
      {
        onSuccess: () => {
          setEmail('');
          setSelectedRole(null);
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

  const statusIcons = {
    pending: <Clock className="h-4 w-4 text-yellow-500" />,
    accepted: <CheckCircle className="h-4 w-4 text-green-500" />,
    expired: <XCircle className="h-4 w-4 text-red-500" />,
    cancelled: <XCircle className="h-4 w-4 text-muted-foreground" />,
  };

  const statusColors = {
    pending: "secondary",
    accepted: "default",
    expired: "destructive",
    cancelled: "outline",
  } as const;

  // Render role selection cards
  const renderRoleSelection = () => (
    <div className="space-y-4">
      <div className="text-center mb-6">
        <h3 className="text-lg font-semibold mb-2">Who is this collaborator?</h3>
        <p className="text-sm text-muted-foreground">
          Select the type of access they need
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {COLLABORATOR_PRESETS.map((preset) => {
          const Icon = roleIcons[preset.role] || Calculator;
          const isSelected = selectedRole === preset.role;

          return (
            <button
              key={preset.role}
              onClick={() => setSelectedRole(preset.role)}
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
                  <h4 className="font-semibold text-sm">{preset.title}</h4>
                  <p className="text-xs text-muted-foreground mt-1">
                    {preset.description}
                  </p>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );

  // Render email input for selected role
  const renderEmailInput = () => {
    const preset = COLLABORATOR_PRESETS.find(p => p.role === selectedRole);
    if (!preset) return null;

    const Icon = roleIcons[preset.role] || Calculator;

    return (
      <div className="space-y-6">
        <button
          onClick={() => setSelectedRole(null)}
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
            <h4 className="font-semibold">{preset.title}</h4>
            <p className="text-sm text-muted-foreground mt-1">{preset.description}</p>
            <div className="mt-3 space-y-1">
              {preset.features.map((feature, i) => (
                <div key={i} className="flex items-center gap-2 text-sm">
                  <Check className="h-3 w-3 text-primary" />
                  <span>{feature}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="collaborator-email">Email address</Label>
          <div className="flex gap-2">
            <Input
              id="collaborator-email"
              type="email"
              placeholder="collaborator@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="flex-1"
            />
            <Button
              onClick={handleSendInvitation}
              disabled={sendInvitationMutation.isPending || !email}
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
      {/* Invite New Collaborator */}
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
            {selectedRole ? renderEmailInput() : renderRoleSelection()}
          </CardContent>
        </Card>
      )}

      {/* Current Collaborators */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Active Collaborators</CardTitle>
          <CardDescription>
            People with limited access to your restaurant
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-8">
              <p className="text-muted-foreground">Loading...</p>
            </div>
          ) : collaborators.length > 0 ? (
            <div className="space-y-3">
              {collaborators.map((collab) => {
                const Icon = roleIcons[collab.role] || Calculator;
                const metadata = ROLE_METADATA[collab.role as Role];

                return (
                  <div
                    key={collab.id}
                    className="flex items-center justify-between p-3 border rounded-lg"
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
                        {metadata?.label || collab.role}
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

      {/* Pending Invitations */}
      {pendingInvites.filter(i => i.status === 'pending').length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Pending Invitations</CardTitle>
            <CardDescription>
              Collaborator invitations waiting to be accepted
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {pendingInvites
                .filter(invite => invite.status === 'pending')
                .map((invite) => {
                  const Icon = roleIcons[invite.role] || Calculator;
                  const metadata = ROLE_METADATA[invite.role as Role];

                  return (
                    <div
                      key={invite.id}
                      className="flex items-center justify-between p-3 border rounded-lg"
                    >
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-muted">
                          <Icon className="h-4 w-4" />
                        </div>
                        <div>
                          <p className="font-medium text-sm">{invite.email}</p>
                          <p className="text-xs text-muted-foreground">
                            Invited by {invite.invitedBy} • Expires{' '}
                            {invite.expiresAt
                              ? new Date(invite.expiresAt).toLocaleDateString()
                              : 'never'}
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
                      </div>
                    </div>
                  );
                })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};
