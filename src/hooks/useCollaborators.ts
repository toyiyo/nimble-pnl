import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { ROLE_METADATA } from '@/lib/permissions';
import type { InviteRoleLiteral, Role } from '@/lib/permissions';

export interface Collaborator {
  id: string;
  email: string;
  role: string;
  /**
   * Set only for a custom role, where `role` is the bare
   * 'collaborator_custom' literal and this is what names the actual grant.
   * Callers resolve it against the `roles` table for a display label.
   */
  roleId: string | null;
  createdAt: string;
  profileName?: string;
}

export interface PendingInvite {
  id: string;
  email: string;
  role: string;
  /** As `Collaborator.roleId` — set only for an invitation to a custom role. */
  roleId: string | null;
  status: 'pending' | 'accepted' | 'expired' | 'cancelled';
  createdAt: string;
  expiresAt?: string;
  invitedBy?: string;
}

export const useCollaboratorsQuery = (restaurantId: string | null) => {
  return useQuery({
    queryKey: ['collaborators', restaurantId],
    queryFn: async (): Promise<Collaborator[]> => {
      if (!restaurantId) return [];

      // Get all collaborators for this restaurant
      const { data: userRestaurants, error } = await supabase
        .from('user_restaurants')
        .select(`
          id,
          user_id,
          role,
          role_id,
          created_at
        `)
        .eq('restaurant_id', restaurantId)
        .like('role', 'collaborator_%');

      if (error) throw error;

      // Get user emails from profiles
      const userIds = userRestaurants?.map(ur => ur.user_id) || [];
      let profilesMap = new Map<string, { email: string; full_name?: string }>();

      if (userIds.length > 0) {
        const { data: profiles, error: profilesError } = await supabase
          .from('profiles')
          .select('user_id, email, full_name')
          .in('user_id', userIds);

        if (profilesError) throw profilesError;

        if (profiles) {
          profilesMap = new Map(profiles.map(p => [p.user_id, { email: p.email, full_name: p.full_name }]));
        }
      }

      return (userRestaurants || []).map(ur => ({
        id: ur.id,
        email: profilesMap.get(ur.user_id)?.email || 'Unknown',
        role: ur.role,
        roleId: ur.role_id ?? null,
        createdAt: ur.created_at,
        profileName: profilesMap.get(ur.user_id)?.full_name,
      }));
    },
    enabled: !!restaurantId,
    staleTime: 30000,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
  });
};

export const useCollaboratorInvitesQuery = (restaurantId: string | null) => {
  return useQuery({
    queryKey: ['collaborator-invites', restaurantId],
    queryFn: async (): Promise<PendingInvite[]> => {
      if (!restaurantId) return [];

      const { data: invitations, error } = await supabase
        .from('invitations')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .like('role', 'collaborator_%')
        .order('created_at', { ascending: false });

      if (error) throw error;

      // Get profile names for inviters
      const inviterIds = [...new Set(invitations?.map(inv => inv.invited_by) || [])];
      let profilesMap = new Map<string, string | null>();

      if (inviterIds.length > 0) {
        const { data: profiles, error: profilesError } = await supabase
          .from('profiles')
          .select('user_id, full_name')
          .in('user_id', inviterIds);

        if (profilesError) throw profilesError;

        if (profiles) {
          profilesMap = new Map(profiles.map(p => [p.user_id, p.full_name]));
        }
      }

      return (invitations || []).map(inv => ({
        id: inv.id,
        email: inv.email,
        role: inv.role,
        roleId: inv.role_id ?? null,
        status: inv.status as 'pending' | 'accepted' | 'expired' | 'cancelled',
        createdAt: inv.created_at,
        expiresAt: inv.expires_at,
        invitedBy: profilesMap.get(inv.invited_by) || 'Unknown',
      }));
    },
    enabled: !!restaurantId,
    staleTime: 30000,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
  });
};

interface SendInvitationParams {
  restaurantId: string;
  email: string;
  role: InviteRoleLiteral;
  /**
   * Required when `role` is the 'collaborator_custom' literal, forbidden
   * otherwise — `send-team-invitation` rejects either half on its own, and
   * re-authorizes this id against the inviting restaurant regardless of what
   * the client sends.
   */
  roleId?: string;
  /**
   * The role's display name, for the success toast. Custom roles have no
   * `ROLE_METADATA` entry — without this the toast would read
   * "invited as collaborator_custom".
   */
  roleLabel?: string;
  // Set when the invite email matches an accountless employee record
  // (`employees.user_id IS NULL`) detected client-side — passed through as
  // explicit intent. `send-team-invitation` re-derives/validates it
  // server-side regardless, so this is not the source of truth.
  employeeId?: string;
}

/**
 * Display name for a toast: the caller's label when it has one (custom
 * roles), the role metadata otherwise. Never the raw literal unless both are
 * missing.
 */
function roleLabelOf(role: InviteRoleLiteral, roleLabel?: string): string {
  return roleLabel ?? ROLE_METADATA[role as Role]?.label ?? role;
}

export const useSendCollaboratorInvitation = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ restaurantId, email, role, roleId, employeeId }: SendInvitationParams) => {
      const body: Record<string, unknown> = { restaurantId, email, role };
      if (roleId) body.roleId = roleId;
      if (employeeId) body.employeeId = employeeId;

      const { error } = await supabase.functions.invoke('send-team-invitation', {
        body,
      });

      if (error) throw error;
      return { email, role };
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['collaborator-invites', variables.restaurantId] });
      toast({
        title: 'Invitation sent',
        description: `${data.email} has been invited as ${roleLabelOf(data.role, variables.roleLabel)}`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error sending invitation',
        description: error.message || 'Failed to send invitation',
        variant: 'destructive',
      });
    },
  });
};

interface CancelInvitationParams {
  inviteId: string;
  inviteEmail: string;
  restaurantId: string;
}

export const useCancelCollaboratorInvitation = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ inviteId, restaurantId }: CancelInvitationParams) => {
      const { error } = await supabase
        .from('invitations')
        .delete()
        .eq('id', inviteId)
        .eq('restaurant_id', restaurantId);

      if (error) throw error;
      return { inviteId };
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['collaborator-invites', variables.restaurantId] });
      toast({
        title: 'Invitation cancelled',
        description: `Invitation to ${variables.inviteEmail} has been cancelled`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error cancelling invitation',
        description: error.message || 'Failed to cancel invitation',
        variant: 'destructive',
      });
    },
  });
};

interface RemoveCollaboratorParams {
  collaboratorId: string;
  collaboratorEmail: string;
  restaurantId: string;
}

export const useRemoveCollaborator = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ collaboratorId, restaurantId }: RemoveCollaboratorParams) => {
      const { error } = await supabase
        .from('user_restaurants')
        .delete()
        .eq('id', collaboratorId)
        .eq('restaurant_id', restaurantId);

      if (error) throw error;
      return { collaboratorId };
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['collaborators', variables.restaurantId] });
      toast({
        title: 'Collaborator removed',
        description: `${variables.collaboratorEmail} no longer has access`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error removing collaborator',
        description: error.message || 'Failed to remove collaborator',
        variant: 'destructive',
      });
    },
  });
};

export const useResendCollaboratorInvitation = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ restaurantId, email, role, roleId }: SendInvitationParams) => {
      const { error } = await supabase.functions.invoke('send-team-invitation', {
        // A resend of a custom-role invitation has to carry the same role_id
        // the original did, or the endpoint rejects it as a bare literal.
        body: { restaurantId, email, role, ...(roleId ? { roleId } : {}) },
      });
      if (error) throw error;
      return { email, role };
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['collaborator-invites', variables.restaurantId] });
      toast({
        title: 'Invitation resent',
        description: `New invite sent to ${data.email}`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error resending invitation',
        description: error.message || 'Failed to resend invitation',
        variant: 'destructive',
      });
    },
  });
};
