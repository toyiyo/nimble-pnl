import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import posthog from 'posthog-js';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { recordTeamMemberJoined } from '@/lib/analytics';

export interface PendingInvitation {
  invitationId: string;
  restaurantName: string;
  role: string;
  expiresAt: string;
}

/**
 * Pending invitations for the signed-in user, read through the
 * get_my_pending_invitations RPC (the invitee cannot read
 * restaurants.name under RLS, and the RPC never exposes the token).
 * The accept mutation calls accept_my_invitation: a token-free accept
 * authorized server-side by the auth.email() match.
 */
export function usePendingInvitations() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const pendingInvitationsKey = ['pending-invitations', user?.id];

  const query = useQuery({
    queryKey: pendingInvitationsKey,
    queryFn: async (): Promise<PendingInvitation[]> => {
      const { data, error } = await supabase.rpc('get_my_pending_invitations');
      if (error) throw error;
      return (data ?? []).map((row) => ({
        invitationId: row.invitation_id,
        restaurantName: row.restaurant_name,
        role: row.role,
        expiresAt: row.expires_at,
      }));
    },
    enabled: !!user,
    staleTime: 30000,
    refetchOnWindowFocus: true,
  });

  const acceptMutation = useMutation({
    mutationFn: async (invitationId: string) => {
      const { data, error } = await supabase.rpc('accept_my_invitation', {
        p_invitation_id: invitationId,
      });
      if (error) throw error;
      return Array.isArray(data) ? data[0] : data;
    },
    onSuccess: async (row) => {
      if (row?.accepted) {
        recordTeamMemberJoined(posthog, { source: 'dashboard_banner' });
        toast({
          title: 'Welcome to the team!',
          description: `You joined ${row.restaurant_name}.`,
        });
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: pendingInvitationsKey }),
          queryClient.invalidateQueries({ queryKey: ['restaurants', user?.id] }),
        ]);
        return;
      }
      // accepted=false: the row expired, was cancelled, or was already
      // accepted through the token path in another tab. Refresh both the
      // list (the stale row disappears) and the restaurants (a token-path
      // join in another tab becomes visible).
      toast({
        title: 'Could not accept the invitation',
        description: 'The invitation is no longer valid. Ask your manager to send a new one.',
        variant: 'destructive',
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: pendingInvitationsKey }),
        queryClient.invalidateQueries({ queryKey: ['restaurants', user?.id] }),
      ]);
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : 'Please try again.';
      toast({
        title: 'Could not accept the invitation',
        description: message,
        variant: 'destructive',
      });
    },
  });

  return {
    invitations: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
    accept: acceptMutation.mutate,
    accepting: acceptMutation.isPending,
    // The invitation the in-flight accept targets, so a list with several
    // rows marks only the clicked one as "Accepting...".
    acceptingId: acceptMutation.isPending ? acceptMutation.variables ?? null : null,
  };
}
