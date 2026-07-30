import { useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { AreaKey, AreaLevel, SensitiveFlag } from '@/lib/permissions/areas';

/**
 * useRoles — the roles list and its mutations, for the role editor UI
 * (roles-and-areas design, plan task 8d).
 *
 * The list is the restaurant's own custom roles *plus* the global builtins
 * (`restaurant_id IS NULL`), because the design's roles list renders builtin
 * cards too — they open the editor read-only, which is how an owner learns
 * what to put in a custom role.
 *
 * Every mutation invalidates `['restaurants']` as well as `['roles', id]`.
 * That is not belt-and-braces: `useRestaurants` embeds the signed-in user's
 * own `roleRecord` with its areas and flags, so editing a role the editor
 * themselves holds changes their own capabilities, and without that second
 * invalidation they would keep the old set until a reload.
 *
 * No toasts here. The hook returns promises and lets the calling component
 * decide what to say, so the same mutations can back both the editor page
 * and the copy dialog without competing notifications.
 */

export interface RoleAreaGrant {
  area_key: AreaKey;
  level: AreaLevel;
}

export interface RoleWithGrants {
  id: string;
  restaurant_id: string | null;
  name: string;
  description: string | null;
  flavor: 'platform' | 'collaborator';
  builtin: boolean;
  created_at: string;
  role_areas: RoleAreaGrant[];
  role_flags: Array<{ flag: SensitiveFlag }>;
  /** Members of *this restaurant* holding the role — see the count query below. */
  memberCount: number;
}

export interface RoleDraft {
  name: string;
  description: string;
  areas: RoleAreaGrant[];
  flags: SensitiveFlag[];
}

export interface CopyRoleReport {
  copied: string[];
  name_collisions: Array<{ restaurant_id: string; name: string }>;
}

// Explicit fields rather than `*` (CLAUDE.md query optimization), with the
// two child tables embedded so a role's grants arrive in one round trip.
const ROLES_SELECT = `
  id,
  restaurant_id,
  name,
  description,
  flavor,
  builtin,
  created_at,
  role_areas(area_key, level),
  role_flags(flag)
`;

export function useRoles(restaurantId: string | undefined) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['roles', restaurantId],
    enabled: !!restaurantId,
    staleTime: 30000,
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<RoleWithGrants[]> => {
      const { data: roleRows, error } = await supabase
        .from('roles')
        .select(ROLES_SELECT)
        .or(`restaurant_id.is.null,restaurant_id.eq.${restaurantId}`)
        .order('builtin', { ascending: false })
        .order('name');

      if (error) throw error;

      // Counted from this restaurant's memberships, not by role_id alone: a
      // builtin `roles` row is global, so an unscoped count would report
      // every Owner on the platform on this restaurant's Owner card.
      const { data: memberRows, error: memberError } = await supabase
        .from('user_restaurants')
        .select('role_id')
        .eq('restaurant_id', restaurantId!);

      if (memberError) throw memberError;

      const counts = new Map<string, number>();
      for (const row of (memberRows ?? []) as Array<{ role_id: string | null }>) {
        if (!row.role_id) continue;
        counts.set(row.role_id, (counts.get(row.role_id) ?? 0) + 1);
      }

      const rows = Array.isArray(roleRows) ? roleRows : [];
      return (rows as unknown as Omit<RoleWithGrants, 'memberCount'>[]).map((role) => ({
        ...role,
        role_areas: role.role_areas ?? [],
        role_flags: role.role_flags ?? [],
        memberCount: counts.get(role.id) ?? 0,
      }));
    },
  });

  const roles = useMemo(() => query.data ?? [], [query.data]);

  // Builtin immutability is enforced by a BEFORE trigger on `roles` (task 1),
  // which holds even against the service-role key. This client-side check
  // only turns a round trip into an immediate, readable error; it is not the
  // guard. A role we have not loaded is treated as editable and left to the
  // database to reject.
  const assertNotBuiltin = (roleId: string) => {
    if (roles.some((r) => r.id === roleId && r.builtin)) {
      throw new Error('Built-in roles cannot be modified. Duplicate it into a custom role instead.');
    }
  };

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['roles', restaurantId] }),
      // The editing user's own embedded grants live under this key.
      queryClient.invalidateQueries({ queryKey: ['restaurants'] }),
    ]);
  };

  const writeGrants = async (roleId: string, areas: RoleAreaGrant[], flags: SensitiveFlag[]) => {
    if (areas.length > 0) {
      const { error } = await supabase
        .from('role_areas')
        .insert(areas.map((a) => ({ role_id: roleId, area_key: a.area_key, level: a.level })));
      if (error) throw error;
    }
    if (flags.length > 0) {
      const { error } = await supabase
        .from('role_flags')
        .insert(flags.map((flag) => ({ role_id: roleId, flag })));
      if (error) throw error;
    }
  };

  const createMutation = useMutation({
    mutationFn: async (draft: RoleDraft) => {
      if (!restaurantId) throw new Error('No restaurant selected.');

      const { data, error } = await supabase
        .from('roles')
        .insert({
          restaurant_id: restaurantId,
          name: draft.name,
          description: draft.description,
          // Custom roles are collaborator-flavored in this phase, which is
          // what subjects them to the per-area caps in area_catalog.
          flavor: 'collaborator',
          builtin: false,
        })
        .select('id')
        .single();

      if (error) throw error;

      const roleId = (data as { id: string }).id;
      await writeGrants(roleId, draft.areas, draft.flags);
      return roleId;
    },
    onSuccess: invalidate,
  });

  const updateMutation = useMutation({
    mutationFn: async (draft: RoleDraft & { id: string }) => {
      assertNotBuiltin(draft.id);

      const { error } = await supabase
        .from('roles')
        .update({ name: draft.name, description: draft.description })
        .eq('id', draft.id);
      if (error) throw error;

      // Delete-then-insert rather than upsert: ungranting an area has to
      // remove its row, and an upsert-only update would silently leave the
      // old grant in place.
      const { error: areaError } = await supabase
        .from('role_areas')
        .delete()
        .eq('role_id', draft.id);
      if (areaError) throw areaError;

      const { error: flagError } = await supabase
        .from('role_flags')
        .delete()
        .eq('role_id', draft.id);
      if (flagError) throw flagError;

      await writeGrants(draft.id, draft.areas, draft.flags);
      return draft.id;
    },
    onSuccess: invalidate,
  });

  const deleteMutation = useMutation({
    mutationFn: async (roleId: string) => {
      assertNotBuiltin(roleId);

      // role_areas / role_flags cascade from the roles FK.
      const { error } = await supabase.from('roles').delete().eq('id', roleId);
      if (error) throw error;
      return roleId;
    },
    onSuccess: invalidate,
  });

  const copyMutation = useMutation({
    mutationFn: async ({
      roleId,
      targetRestaurantIds,
    }: {
      roleId: string;
      targetRestaurantIds: string[];
    }): Promise<CopyRoleReport> => {
      const { data, error } = await supabase.rpc('copy_role_to_restaurants', {
        p_role_id: roleId,
        p_target_restaurant_ids: targetRestaurantIds,
      });
      if (error) throw error;
      // Name collisions come back in the report rather than raising — the
      // caller shows which targets were skipped.
      return data as unknown as CopyRoleReport;
    },
    onSuccess: invalidate,
  });

  return {
    roles,
    isLoading: query.isLoading,
    error: query.error,
    createRole: createMutation.mutateAsync,
    updateRole: updateMutation.mutateAsync,
    deleteRole: deleteMutation.mutateAsync,
    copyRole: copyMutation.mutateAsync,
    isMutating:
      createMutation.isPending ||
      updateMutation.isPending ||
      deleteMutation.isPending ||
      copyMutation.isPending,
  };
}
