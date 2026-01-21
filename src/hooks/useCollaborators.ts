import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { ROLE_METADATA } from '@/lib/permissions';
import type { Role } from '@/lib/permissions';

export interface Collaborator {
  id: string;
  email: string;
  role: string;
  createdAt: string;
  profileName?: string;
}

export interface PendingInvite {
  id: string;
  email: string;
  role: string;
  status: 'pending' | 'accepted' | 'expired' | 'cancelled';
  createdAt: string;
  expiresAt?: string;
  invitedBy?: string;
}

// ============================================================
// Query Hooks
// ============================================================

/**
 * Fetches all collaborators (users with collaborator_* roles) for a restaurant
 */
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
          created_at
        `)
        .eq('restaurant_id', restaurantId)
        .like('role', 'collaborator_%');

      if (error) throw error;

      // Get user emails from profiles
      const userIds = userRestaurants?.map(ur => ur.user_id) || [];
      let profilesMap = new Map<string, { email: string; full_name?: string }>();

      if (userIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('user_id, email, full_name')
          .in('user_id', userIds);

        if (profiles) {
          profilesMap = new Map(profiles.map(p => [p.user_id, { email: p.email, full_name: p.full_name }]));
        }
      }

      return (userRestaurants || []).map(ur => ({
        id: ur.id,
        email: profilesMap.get(ur.user_id)?.email || 'Unknown',
        role: ur.role,
        createdAt: ur.created_at,
        profileName: profilesMap.get(ur.user_id)?.full_name,
      }));
    },
    enabled: !!restaurantId,
    staleTime: 30000, // 30 seconds
    refetchOnWindowFocus: true,
    refetchOnMount: true,
  });
};

/**
 * Fetches pending collaborator invitations for a restaurant
 */
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
      const { data: profiles } = await supabase
        .from('profiles')
        .select('user_id, full_name')
        .in('user_id', inviterIds);

      const profilesMap = new Map(profiles?.map(p => [p.user_id, p.full_name]) || []);

      return (invitations || []).map(inv => ({
        id: inv.id,
        email: inv.email,
        role: inv.role,
        status: inv.status as 'pending' | 'accepted' | 'expired' | 'cancelled',
        createdAt: inv.created_at,
        expiresAt: inv.expires_at,
        invitedBy: profilesMap.get(inv.invited_by) || 'Unknown',
      }));
    },
    enabled: !!restaurantId,
    staleTime: 30000, // 30 seconds
    refetchOnWindowFocus: true,
    refetchOnMount: true,
  });
};

// ============================================================
// Mutation Hooks
// ============================================================

interface SendInvitationParams {
  restaurantId: string;
  email: string;
  role: Role;
}

/**
 * Sends an invitation to a collaborator
 */
export const useSendCollaboratorInvitation = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ restaurantId, email, role }: SendInvitationParams) => {
      const { error } = await supabase.functions.invoke('send-team-invitation', {
        body: {
          restaurantId,
          email,
          role,
        },
      });

      if (error) throw error;
      return { email, role };
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['collaborator-invites', variables.restaurantId] });
      toast({
        title: 'Invitation sent',
        description: `${data.email} has been invited as ${ROLE_METADATA[data.role]?.label || data.role}`,
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

/**
 * Cancels a pending invitation
 */
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

/**
 * Removes a collaborator from a restaurant
 */
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
