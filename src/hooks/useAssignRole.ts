import { useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { RestaurantMember } from '@/hooks/useRestaurantMembers';
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

/**
 * The RPC call alone, with no cache side effects.
 *
 * Separate from the mutation so a caller assigning several people in a row can
 * refresh ONCE at the end. Through the mutation, each `mutateAsync` fires the
 * four invalidations below, and the queries behind the open dialog are all
 * active — so assigning K people means 4K refetches for one net change.
 */
export async function assignMembershipRole({
  membershipId,
  role,
  roleId,
}: AssignRoleParams): Promise<void> {
  const { error } = await supabase.rpc('assign_membership_role', {
    p_membership_id: membershipId,
    p_role: role,
    p_role_id: roleId ?? null,
  });
  if (error) throw error;
}

/**
 * Everything a role change moves, refreshed together. Returned as a callback so
 * both the single-assignment mutation and a batch can fire it — the batch after
 * its whole loop rather than inside it.
 */
export function useRefreshAfterAssign(restaurantId: string | undefined) {
  const queryClient = useQueryClient();

  return useCallback(() => {
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
  }, [queryClient, restaurantId]);
}

export function useAssignRole(restaurantId: string | undefined) {
  const refresh = useRefreshAfterAssign(restaurantId);

  return useMutation({
    mutationFn: assignMembershipRole,
    onSuccess: refresh,
  });
}

export interface AssignPeopleParams extends Omit<AssignRoleParams, 'membershipId'> {
  /** Everyone to move into the role, in the order they should be attempted. */
  members: readonly RestaurantMember[];
}

export interface AssignPeopleResult {
  /** How many the RPC accepted. */
  landed: number;
  /** The rest, each paired with the sentence the RPC wrote for it. */
  failures: { member: RestaurantMember; message: string }[];
}

/**
 * Move several people into one role.
 *
 * A partial failure is the normal case, not an exception: `assign_membership_role`
 * decides person by person, so one 42501 among five must not discard the four
 * that landed. So the loop swallows each rejection into `failures` and the
 * mutation itself resolves — the caller reads the result rather than catching.
 *
 * Sequential, not `Promise.all`: rule 5b of
 * 20260802110000_assign_membership_role.sql takes FOR UPDATE on the restaurant's
 * owner rows before counting them, so concurrent calls contend on one lock. One
 * at a time also keeps every failure attributable to a person.
 *
 * `onSettled`, not `onSuccess`: even a run where every call was denied refreshes,
 * because rule 5b's owner count and the invite matrix are both read from data the
 * caller is showing — a denial can mean the screen is stale. It fires once for
 * the batch, not once per person, which is the whole reason `assignMembershipRole`
 * is separate from `useAssignRole`.
 *
 * No optimistic update: the write is a *reassignment*, so rolling one back means
 * restoring each person's previous role individually, and the failures arrive
 * interleaved with successes. The honest cache here is the server's.
 */
export function useAssignPeopleToRole(restaurantId: string | undefined) {
  const refresh = useRefreshAfterAssign(restaurantId);

  return useMutation({
    mutationFn: async ({ members, role, roleId }: AssignPeopleParams): Promise<AssignPeopleResult> => {
      const failures: AssignPeopleResult['failures'] = [];
      for (const member of members) {
        try {
          await assignMembershipRole({ membershipId: member.membershipId, role, roleId });
        } catch (err) {
          failures.push({ member, message: assignRoleErrorMessage(err) });
        }
      }
      return { landed: members.length - failures.length, failures };
    },
    onSettled: refresh,
  });
}
