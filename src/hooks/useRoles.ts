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

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function useRoles(restaurantId: string | undefined) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['roles', restaurantId],
    enabled: !!restaurantId,
    staleTime: 30000,
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<RoleWithGrants[]> => {
      // `.or()` takes a raw PostgREST filter string, so restaurantId is
      // interpolated into it rather than bound. It comes from the restaurant
      // context and is always a UUID today, but a value carrying a comma
      // would widen the filter to other restaurants' roles rather than
      // error, so the shape is checked instead of assumed.
      if (!UUID_PATTERN.test(restaurantId ?? '')) {
        throw new Error('useRoles: restaurantId must be a UUID');
      }

      const { data: roleRows, error } = await supabase
        .from('roles')
        .select(ROLES_SELECT)
        .or(`restaurant_id.is.null,restaurant_id.eq.${restaurantId}`)
        .order('builtin', { ascending: false })
        .order('name');

      if (error) throw error;

      // Counted server-side, and scoped to this restaurant's memberships: a
      // builtin `roles` row is global, so an unscoped count would report every
      // Owner on the platform on this restaurant's Owner card.
      //
      // The RPC exists because counting `role_id` alone undercounts —
      // `user_restaurants.role_id` is legitimately NULL on memberships written
      // by code paths that set only the legacy `role` string, and resolving
      // those needs `builtin_role_id_for`, the mapping the migrations call the
      // single source. A copy of it here would be the copy that drifts.
      const { data: countRows, error: memberError } = await supabase
        .rpc('role_member_counts', { p_restaurant_id: restaurantId! });

      if (memberError) throw memberError;

      const counts = new Map<string, number>(
        ((countRows ?? []) as Array<{ role_id: string; member_count: number }>).map(
          (row) => [row.role_id, Number(row.member_count)]
        )
      );

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

  // One RPC rather than four round-trips (delete areas, delete flags, insert
  // areas, insert flags). Each of those was its own transaction, so a failure
  // partway through — a rejected area, a dropped connection — left the role
  // with no grants at all and everyone holding it locked out until someone
  // saved again. replace_role_grants runs the same four statements in one
  // transaction under the caller's own privileges: same RLS policies, same
  // builtin block, same collaborator area cap.
  const replaceGrants = async (roleId: string, areas: RoleAreaGrant[], flags: SensitiveFlag[]) => {
    const { error } = await supabase.rpc('replace_role_grants', {
      p_role_id: roleId,
      p_areas: areas.map((a) => ({ area_key: a.area_key, level: a.level })),
      p_flags: flags,
    });
    if (error) throw error;
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

      try {
        await replaceGrants(roleId, draft.areas, draft.flags);
      } catch (grantError) {
        // The roles row is already committed; the grants are a second
        // statement. Leaving the empty role behind is worse than it sounds —
        // it keeps its name, so the retry the user immediately attempts
        // fails on the name-collision guard instead of on the real problem.
        //
        // PostgREST resolves a rejected delete with an `{ error }` result
        // rather than throwing, so the surrounding catch never saw one: a
        // cleanup blocked by RLS looked exactly like a successful one, and the
        // orphan the compensation exists to prevent survived silently. Both
        // outcomes are reported now, because "the role was created but has no
        // permissions, and its name is taken" is the only message that
        // explains the collision the user is about to hit.
        let cleanupFailed = false;
        try {
          const { error: cleanupError } = await supabase
            .from('roles')
            .delete()
            .eq('id', roleId);
          cleanupFailed = !!cleanupError;
        } catch {
          cleanupFailed = true;
        }

        if (cleanupFailed) {
          throw new Error(
            `The role "${draft.name}" was created but its permissions could not be saved, ` +
              'and the empty role could not be removed. Open it and set its access, or ' +
              `delete it, before creating another role named "${draft.name}". ` +
              `(${grantError instanceof Error ? grantError.message : String(grantError)})`
          );
        }
        throw grantError;
      }

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

      await replaceGrants(draft.id, draft.areas, draft.flags);
      return draft.id;
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
    copyRole: copyMutation.mutateAsync,
    isMutating:
      createMutation.isPending ||
      updateMutation.isPending ||
      copyMutation.isPending,
  };
}
