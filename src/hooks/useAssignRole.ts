import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { MembershipRoleLiteral } from '@/lib/permissions/invitations';

/**
 * useAssignRole — change an existing member's role.
 *
 * Wraps the assign_membership_role RPC rather than updating
 * user_restaurants directly. A direct UPDATE is the bug: the PERMISSIVE RLS
 * policy makes another member's row untargetable by a manager, so the update
 * matches zero rows and Postgres raises nothing — a success toast over a
 * no-op. The RPC raises 42501 on every denial instead.
 */
export interface AssignRoleParams {
  membershipId: string;
  /**
   * A builtin role, or the `collaborator_custom` literal. Typed as the shared
   * `MembershipRoleLiteral` rather than `string` so an invalid literal fails at
   * compile time instead of arriving as a runtime 42501 from the RPC.
   */
  role: MembershipRoleLiteral;
  /** Required when `role` is 'collaborator_custom', forbidden otherwise. */
  roleId?: string;
}

const FALLBACK = "Couldn't change that role. Please try again.";

/**
 * The message to show for a failed assignment.
 *
 * PostgREST rejections arrive as plain `{code, message, details, hint}`
 * objects, NOT Error instances, so the `instanceof Error` branch must come
 * last — checking it first would send every 42501 denial to the generic
 * fallback and hide the sentence the RPC took care to write.
 */
export function assignRoleErrorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.length > 0) return message;
  }
  if (error instanceof Error && error.message) return error.message;
  return FALLBACK;
}

export function useAssignRole(restaurantId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ membershipId, role, roleId }: AssignRoleParams) => {
      const { error } = await supabase.rpc('assign_membership_role', {
        p_membership_id: membershipId,
        p_role: role,
        p_role_id: roleId ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      // ['roles'] — member counts moved.
      queryClient.invalidateQueries({ queryKey: ['roles', restaurantId] });
      queryClient.invalidateQueries({ queryKey: ['collaborators', restaurantId] });
      // ['restaurant-members'] — the roster behind a role card reads it, and a
      // reassignment moves someone from one card's list to another's. Without
      // this the count (from ['roles']) updates and the faces do not.
      queryClient.invalidateQueries({ queryKey: ['restaurant-members', restaurantId] });
      // ['restaurants'] is not belt-and-braces: useRestaurants embeds the
      // signed-in user's own roleRecord, so a role change they can see must
      // refresh their resolved capabilities — the same reasoning useRoles.ts
      // documents at :15-19.
      queryClient.invalidateQueries({ queryKey: ['restaurants'] });
    },
  });
}
