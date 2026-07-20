import { useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertCircle, Bell } from 'lucide-react';

import {
  useNotificationChannelSettings,
  type ChannelSettingsMap,
} from '@/hooks/useNotificationChannelSettings';
import { NOTIFICATION_TYPES, type NotificationGroup, type NotificationType } from '@/lib/notificationTypes';

interface NotificationChannelMatrixProps {
  restaurantId: string;
}

const GROUP_ORDER: NotificationGroup[] = ['Scheduling', 'Trades', 'Time off', 'Access'];

function mapsEqual(a: ChannelSettingsMap, b: ChannelSettingsMap): boolean {
  for (const type of NOTIFICATION_TYPES) {
    const av = a.get(type.key);
    const bv = b.get(type.key);
    if (av?.email !== bv?.email || av?.push !== bv?.push) return false;
  }
  return true;
}

/**
 * Admin per-type × per-channel notification matrix (Settings → Notifications).
 * Grouped `<table>` per domain, mirroring `AvailabilityGrid.tsx`'s a11y
 * pattern. Local-state-then-Save with a sync-guard so a background refetch
 * never clobbers in-progress edits. See docs/superpowers/specs/2026-07-13-
 * notification-channel-matrix-design.md.
 */
export function NotificationChannelMatrix({ restaurantId }: NotificationChannelMatrixProps) {
  const { settings, isLoading, isError, refetch, saveChanges, isSaving } =
    useNotificationChannelSettings(restaurantId);

  const [local, setLocal] = useState<ChannelSettingsMap>(() => new Map(settings));

  // hasChanges is derived by value-comparison (not a dirty flag) so it can
  // never drift from what's actually on screen.
  const hasChanges = useMemo(() => !mapsEqual(local, settings), [local, settings]);

  // Sync-guard: only pull the server snapshot into local state while the form
  // is clean. A background refetch (staleTime elapsing, window refocus, or a
  // post-save invalidation) must never clobber edits the user hasn't saved.
  useEffect(() => {
    if (!hasChanges) {
      setLocal(new Map(settings));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally omits hasChanges: it must not retrigger this sync
  }, [settings]);

  const groups = useMemo(
    () =>
      GROUP_ORDER.map((group) => ({
        group,
        types: NOTIFICATION_TYPES.filter((t) => t.group === group),
      })).filter((g) => g.types.length > 0),
    [],
  );

  function updateChannel(type: NotificationType, channel: 'email' | 'push', value: boolean) {
    setLocal((prev) => {
      const next = new Map(prev);
      const current = next.get(type) ?? { email: true, push: true };
      next.set(type, { ...current, [channel]: value });
      return next;
    });
  }

  async function handleSave() {
    try {
      await saveChanges(local);
    } catch {
      // Failure is already surfaced via toast inside the hook; keep the
      // user's local edits in place (footer stays visible) so they can retry.
    }
  }

  function handleReset() {
    setLocal(new Map(settings));
  }

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton
          className="h-6 w-56"
          role="status"
          aria-label="Loading notification channel settings"
        />
        <Skeleton className="h-40 w-full rounded-xl" />
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    );
  }

  if (isError) {
    return (
      <div
        role="alert"
        className="flex items-center justify-between gap-3 p-4 rounded-xl border border-destructive/20 bg-destructive/10"
      >
        <div className="flex items-center gap-2 text-[13px] text-foreground">
          <AlertCircle className="h-4 w-4 text-destructive" aria-hidden="true" />
          <span>Couldn&apos;t load notification channel settings.</span>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-8 px-3 rounded-lg text-[13px] font-medium"
          onClick={() => refetch()}
        >
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-4">
      <div className="flex items-center gap-2">
        <Bell className="h-5 w-5 text-primary" aria-hidden="true" />
        <div>
          <h2 className="text-[17px] font-semibold text-foreground">Notification channels</h2>
          <p className="text-[13px] text-muted-foreground">
            Choose which channels each notification type sends over.
          </p>
        </div>
      </div>

      {groups.map(({ group, types }) => (
        <div key={group} className="rounded-xl border border-border/40 bg-muted/30 overflow-hidden">
          <div className="px-4 py-3 border-b border-border/40 bg-muted/50">
            <h3 className="text-[13px] font-semibold text-foreground">{group}</h3>
          </div>
          <div className="p-4 overflow-x-auto">
            <table className="w-full border-collapse">
              <caption className="sr-only">{group} notifications</caption>
              <thead>
                <tr>
                  <th scope="col" className="sr-only">
                    Notification type
                  </th>
                  <th scope="col" className="sr-only">
                    Email
                  </th>
                  <th scope="col" className="sr-only">
                    Push
                  </th>
                </tr>
              </thead>
              <tbody>
                {types.map((type) => {
                  const value = local.get(type.key) ?? { email: true, push: true };
                  return (
                    <tr key={type.key} className="border-b border-border/40 last:border-0">
                      <th
                        scope="row"
                        className="py-3 pr-3 text-left text-[14px] font-medium text-foreground"
                      >
                        {type.label}
                      </th>
                      <td className="py-3 pr-3 text-center align-middle">
                        {type.channels.includes('email') ? (
                          <Switch
                            checked={value.email}
                            onCheckedChange={(checked) => updateChannel(type.key, 'email', checked)}
                            aria-label={`${type.label} — Email`}
                            className="data-[state=checked]:bg-foreground"
                          />
                        ) : (
                          <>
                            <span aria-hidden="true" className="text-muted-foreground">
                              —
                            </span>
                            <span className="sr-only">Email not available for {type.label}</span>
                          </>
                        )}
                      </td>
                      <td className="py-3 text-center align-middle">
                        {type.channels.includes('push') ? (
                          <Switch
                            checked={value.push}
                            onCheckedChange={(checked) => updateChannel(type.key, 'push', checked)}
                            aria-label={`${type.label} — Push`}
                            className="data-[state=checked]:bg-foreground"
                          />
                        ) : (
                          <>
                            <span aria-hidden="true" className="text-muted-foreground">
                              —
                            </span>
                            <span className="sr-only">Push not available for {type.label}</span>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {hasChanges && (
        <div className="sticky bottom-0 left-0 right-0 z-10 flex items-center justify-end gap-2 px-4 py-3 border-t border-border/40 bg-background/95 backdrop-blur">
          <Button
            variant="outline"
            className="h-9 px-4 rounded-lg text-[13px] font-medium"
            onClick={handleReset}
            disabled={isSaving}
          >
            Reset
          </Button>
          <Button
            className="h-9 px-4 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[13px] font-medium"
            onClick={handleSave}
            disabled={isSaving}
          >
            {isSaving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      )}
    </div>
  );
}
