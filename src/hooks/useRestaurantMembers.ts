import { useQuery } from '@tanstack/react-query';

import { supabase } from '@/integrations/supabase/client';
import type { MembershipRoleLiteral } from '@/lib/permissions';

export interface RestaurantMember {
  /**
   * The `user_restaurants` row id — what `assign_membership_role` takes, and
   * what `RolePicker` needs to change this person's role. Not the user id: a
   * user may hold a membership in more than one restaurant.
   */
  membershipId: string;
  userId: string;
  email: string | null;
  fullName: string | null;
  /**
   * Not `Role`: a custom-role membership carries the bare
   * `'collaborator_custom'` literal, which is deliberately not a member of
   * that union (see `invitations.ts`).
   */
  role: MembershipRoleLiteral;
  /**
   * Set only when the membership points at a custom role, whose `role` column
   * is the bare 'collaborator_custom' literal. Callers that display a role
   * name resolve this against the `roles` table.
   */
  roleId: string | null;
}

/**
 * Everyone who already holds a user_restaurants row for this restaurant.
 *
 * Deliberately restaurant-scoped: a global "does this email have an account"
 * lookup would be an account-enumeration oracle. This returns exactly what the
 * caller can already read on the Team page, so it leaks nothing new. RLS on
 * user_restaurants and profiles enforces the same boundary server-side.
 */
export function useRestaurantMembers(restaurantId: string | undefined) {
  return useQuery({
    queryKey: ['restaurant-members', restaurantId],
    enabled: !!restaurantId,
    staleTime: 30000,
    queryFn: async (): Promise<RestaurantMember[]> => {
      const { data: memberships, error: membershipError } = await supabase
        .from('user_restaurants')
        .select('id, user_id, role, role_id')
        .eq('restaurant_id', restaurantId);

      if (membershipError) throw membershipError;
      if (!memberships?.length) return [];

      const { data: profiles, error: profileError } = await supabase
        .from('profiles')
        .select('user_id, full_name, email')
        .in('user_id', memberships.map((m) => m.user_id));

      if (profileError) throw profileError;

      const byUserId = new Map(profiles?.map((p) => [p.user_id, p]) ?? []);
      return memberships.map((m) => {
        const profile = byUserId.get(m.user_id);
        return {
          membershipId: m.id,
          userId: m.user_id,
          email: profile?.email ?? null,
          fullName: profile?.full_name ?? null,
          role: m.role as MembershipRoleLiteral,
          roleId: m.role_id ?? null,
        };
      });
    },
  });
}

/**
 * Case-insensitive lookup of an email against the roster.
 *
 * `profiles.email` is plain TEXT (not CITEXT), so a mixed-case address would
 * false-negative on a strict comparison.
 *
 * Returns null when `members` is undefined — the roster is still loading or
 * the query failed. Callers treat null as "proceed normally", which makes the
 * whole feature fail open rather than stranding an owner behind a guard that
 * could not load.
 */
export function findMemberByEmail(
  members: RestaurantMember[] | undefined,
  email: string
): RestaurantMember | null {
  const normalized = email.trim().toLowerCase();
  if (!normalized || !members) return null;
  return members.find((m) => m.email?.trim().toLowerCase() === normalized) ?? null;
}
