import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { NOTIFICATION_TYPES, type NotificationType } from '@/lib/notificationTypes';

// Per-restaurant admin control for the notification channel matrix (Settings →
// Notifications). See docs/superpowers/specs/2026-07-13-notification-channel-
// matrix-design.md. `notification_channel_settings` isn't in the generated
// Supabase types yet (new table, types not regenerated) — cast through `any`
// at the call site, matching the existing repo convention (see
// `useStaffingSettings.ts`).

export interface ChannelDecision {
  email: boolean;
  push: boolean;
}

/** Map of every catalog notification type to its current channel decision.
 *  Always fully populated (all 16 catalog keys) — absent server rows resolve
 *  to the default-ON baseline, mirroring `resolveChannels()`'s fail-open
 *  semantics on the read side. */
export type ChannelSettingsMap = Map<NotificationType, ChannelDecision>;

interface ChannelSettingsRow {
  id: string;
  notification_type: string;
  email_enabled: boolean;
  push_enabled: boolean;
}

/** Fresh, independently-mutable default-ON map. Used as the merge base inside
 *  `queryFn`/the mutation's snapshot fallback, where the caller mutates the
 *  result — never share one instance across those call sites. */
function createDefaultChannelSettingsMap(): ChannelSettingsMap {
  const map: ChannelSettingsMap = new Map();
  for (const type of NOTIFICATION_TYPES) {
    map.set(type.key, { email: true, push: true });
  }
  return map;
}

/** Referentially-stable default-ON map, computed once at module load. This is
 *  what the hook returns as `settings` whenever `query.data` is undefined
 *  (disabled query, or still loading). It must stay the SAME object across
 *  renders — if it were reallocated every render (as `createDefaultChannel
 *  SettingsMap()` does), `NotificationChannelMatrix`'s sync-guard effect
 *  (`useEffect(..., [settings])`) would see a new reference on every render
 *  and re-fire forever, spinning in an unbounded render loop. Callers must
 *  treat this as read-only (clone before mutating). */
const STABLE_DEFAULT_CHANNEL_SETTINGS: ChannelSettingsMap = createDefaultChannelSettingsMap();

export function useNotificationChannelSettings(restaurantId: string | null) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const queryKey = ['notification-channel-settings', restaurantId];

  const query = useQuery({
    queryKey,
    queryFn: async (): Promise<ChannelSettingsMap> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- table not in generated types yet
      const { data, error } = await (supabase.from as any)('notification_channel_settings')
        .select('id, notification_type, email_enabled, push_enabled')
        .eq('restaurant_id', restaurantId);

      if (error) throw error;

      const merged = createDefaultChannelSettingsMap();
      for (const row of (data ?? []) as ChannelSettingsRow[]) {
        if (merged.has(row.notification_type as NotificationType)) {
          merged.set(row.notification_type as NotificationType, {
            email: row.email_enabled,
            push: row.push_enabled,
          });
        }
      }
      return merged;
    },
    enabled: !!restaurantId,
    staleTime: 60000,
  });

  const mutation = useMutation({
    mutationFn: async (next: ChannelSettingsMap) => {
      if (!restaurantId) throw new Error('No restaurant selected');

      // Diff against the last fetched snapshot — upsert only the rows that
      // actually changed, never the full 16-row grid (design: "Diff-based Save").
      const snapshot = query.data ?? STABLE_DEFAULT_CHANNEL_SETTINGS;
      const changedRows = NOTIFICATION_TYPES.filter((type) => {
        const before = snapshot.get(type.key);
        const after = next.get(type.key);
        return before?.email !== after?.email || before?.push !== after?.push;
      }).map((type) => {
        const value = next.get(type.key) ?? { email: true, push: true };
        return {
          restaurant_id: restaurantId,
          notification_type: type.key,
          email_enabled: value.email,
          push_enabled: value.push,
        };
      });

      if (changedRows.length === 0) return;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- table not in generated types yet
      const { error } = await (supabase.from as any)('notification_channel_settings').upsert(
        changedRows,
        { onConflict: 'restaurant_id,notification_type' },
      );

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error saving notification settings',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  return {
    settings: query.data ?? STABLE_DEFAULT_CHANNEL_SETTINGS,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
    saveChanges: mutation.mutateAsync,
    isSaving: mutation.isPending,
  };
}
