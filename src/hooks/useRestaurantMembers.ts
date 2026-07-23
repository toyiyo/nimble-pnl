import { useQuery } from '@tanstack/react-query';

import { supabase } from '@/integrations/supabase/client';
import type { Role } from '@/lib/permissions/types';

export interface RestaurantMember {
  userId: string;
  email: string | null;
  fullName: string | null;
  role: Role;
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
        .select('user_id, role')
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
          userId: m.user_id,
          email: profile?.email ?? null,
          fullName: profile?.full_name ?? null,
          role: m.role as Role,
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
