import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { useToast } from './use-toast';
import { createDefaultChartOfAccounts } from '@/lib/chartOfAccountsUtils';
import type { Role } from '@/lib/permissions/types';
import type { AreaKey, AreaLevel, SensitiveFlag } from '@/lib/permissions/areas';

export interface Restaurant {
  id: string;
  name: string;
  address?: string;
  phone?: string;
  cuisine_type?: string;
  timezone?: string;
  /** Hour (0-11, restaurant-local) at which the business day starts. 0 == calendar day. */
  business_day_start_hour?: number;
  created_at: string;
  updated_at: string;
  // Business info fields
  legal_name?: string;
  address_line1?: string;
  address_line2?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
  business_email?: string;
  ein?: string;
  entity_type?: 'llc' | 'corporation' | 'sole_proprietor' | 'partnership' | 's_corporation' | 'non_profit';
  // Subscription fields
  subscription_tier?: 'starter' | 'growth' | 'pro';
  subscription_status?: 'trialing' | 'active' | 'past_due' | 'canceled' | 'grandfathered';
  subscription_period?: 'monthly' | 'annual';
  stripe_subscription_customer_id?: string;
  stripe_subscription_id?: string;
  trial_ends_at?: string;
  subscription_ends_at?: string;
  grandfathered_until?: string;
  // Geofence fields
  latitude?: number | null;
  longitude?: number | null;
  geofence_radius_meters?: number;
  geofence_enforcement?: 'off' | 'warn' | 'block';
}

/**
 * The joined `roles` row for a membership, embedded in the same round trip
 * as `user_restaurants` (roles-and-areas design — "Keeping usePermissions
 * synchronous"). Deliberately named `roleRecord`, not `role` — `role: Role`
 * below is the existing legacy text column and call sites already read it
 * directly.
 */
export interface RoleRecord {
  id: string;
  name: string;
  flavor: 'platform' | 'collaborator';
  builtin: boolean;
  role_areas: Array<{ area_key: AreaKey; level: AreaLevel }>;
  role_flags: Array<{ flag: SensitiveFlag }>;
}

export interface UserRestaurant {
  id: string;
  user_id: string;
  restaurant_id: string;
  // Canonical Role union (single source of truth) — avoids the literal-union
  // drift that previously required manual patching on every new role (CodeRabbit, PR #596).
  role: Role;
  // Null only for memberships not yet backfilled onto `role_id`
  // (supabase/migrations/20260730120000_add_user_restaurants_role_id.sql).
  roleRecord: RoleRecord | null;
  created_at: string;
  restaurant: Restaurant;
}

// Embeds the joined role's areas and flags in the same query as the
// membership list, so a role's grants travel with `selectedRestaurant`
// without an extra round trip (design doc: "Keeping usePermissions
// synchronous"). Extended from the legacy `*, restaurant:restaurants(*)`
// select — see [useRestaurants.tsx history] / plan task 8.
const USER_RESTAURANTS_SELECT = `
  *,
  restaurant:restaurants(*),
  roleRecord:roles(
    id,
    name,
    flavor,
    builtin,
    role_areas(area_key, level),
    role_flags(flag)
  )
`;

async function fetchUserRestaurants(userId: string): Promise<UserRestaurant[]> {
  const { data, error } = await supabase
    .from('user_restaurants')
    .select(USER_RESTAURANTS_SELECT)
    .eq('user_id', userId);

  if (error) throw error;
  // The embedded to-many arrays are normalized here, at the one place the
  // rows enter the app. `RoleRecord` types them as always-present arrays and
  // usePermissions reads them without a guard, but the row is a raw cast — a
  // null from either embed would take down every consumer of the hook with a
  // "cannot read properties of null" during render.
  return ((data || []) as unknown as UserRestaurant[]).map((row) =>
    row.roleRecord
      ? {
          ...row,
          roleRecord: {
            ...row.roleRecord,
            role_areas: row.roleRecord.role_areas ?? [],
            role_flags: row.roleRecord.role_flags ?? [],
          },
        }
      : row
  );
}

export function useRestaurants() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['restaurants', user?.id],
    queryFn: () => fetchUserRestaurants(user!.id),
    enabled: !!user,
    staleTime: 30000,
    refetchOnWindowFocus: true,
  });

  // Preserve the legacy toast-on-fetch-failure UX; React Query surfaces the
  // error on `query.error` rather than throwing during render.
  useEffect(() => {
    if (query.error) {
      toast({
        title: 'Error fetching restaurants',
        description: (query.error as Error).message,
        variant: 'destructive',
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.error]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['restaurants', user?.id] });

  const createRestaurant = async (restaurantData: {
    name: string;
    address?: string;
    phone?: string;
    cuisine_type?: string;
    timezone?: string;
  }) => {
    if (!user) return null;

    try {
      const { data, error } = await supabase.rpc('create_restaurant_with_owner', {
        restaurant_name: restaurantData.name,
        restaurant_address: restaurantData.address,
        restaurant_phone: restaurantData.phone,
        restaurant_cuisine_type: restaurantData.cuisine_type,
        restaurant_timezone: restaurantData.timezone || 'America/Chicago',
      });

      if (error) throw error;

      // Automatically create default chart of accounts
      try {
        await createDefaultChartOfAccounts(supabase, data);
      } catch (coaError) {
        console.error('Failed to create default chart of accounts:', coaError);
        // Don't block flow, user can try manually later
        toast({
          title: "Setup Note",
          description: "Restaurant created, but default accounts could not be generated automatically. You can add them from the Chart of Accounts page.",
        });
      }

      toast({
        title: "Restaurant created!",
        description: `${restaurantData.name} has been added successfully.`,
      });

      // Refresh the list
      await invalidate();
      return data;
    } catch (error: any) {
      toast({
        title: "Error creating restaurant",
        description: error.message,
        variant: "destructive",
      });
      return null;
    }
  };

  const updateRestaurant = async (restaurantId: string, updates: Partial<Restaurant>) => {
    try {
      const { error } = await supabase
        .from('restaurants')
        .update(updates)
        .eq('id', restaurantId);

      if (error) throw error;

      toast({
        title: "Restaurant updated!",
        description: "Changes have been saved successfully.",
      });

      await invalidate();
    } catch (error: any) {
      toast({
        title: "Error updating restaurant",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  return {
    restaurants: query.data ?? [],
    // isLoading, not isPending: the query is `enabled: !!user`, and a disabled
    // query stays `isPending` forever. Callers now gate rendering on this
    // (StaffRoleChecker holds the route until the role is known), so a `true`
    // that never clears is a permanent spinner rather than a brief one.
    loading: query.isLoading,
    createRestaurant,
    updateRestaurant,
    refetch: invalidate,
  };
}
