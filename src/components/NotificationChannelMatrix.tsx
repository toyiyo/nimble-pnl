import { useMemo } from 'react';

import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertCircle,
  ArrowLeftRight,
  CalendarClock,
  CalendarDays,
  KeyRound,
  Mail,
  Smartphone,
  type LucideIcon,
} from 'lucide-react';

import { useNotificationChannelSettings } from '@/hooks/useNotificationChannelSettings';
import {
  NOTIFICATION_TYPES,
  type NotificationChannel,
  type NotificationGroup,
  type NotificationTypeDef,
} from '@/lib/notificationTypes';

interface NotificationChannelMatrixProps {
  restaurantId: string;
}

const GROUP_ORDER: NotificationGroup[] = ['Scheduling', 'Trades', 'Time off', 'Access'];
const GROUP_ICON: Record<NotificationGroup, LucideIcon> = {
  Scheduling: CalendarDays,
  Trades: ArrowLeftRight,
  'Time off': CalendarClock,
  Access: KeyRound,
};
const CHANNEL_LABEL: Record<NotificationChannel, string> = { email: 'Email', push: 'Push' };
const CHANNEL_ICON: Record<NotificationChannel, LucideIcon> = { email: Mail, push: Smartphone };

/** One matrix cell: a live `Switch` if `type` supports `channel`, otherwise a
 *  muted "—" with screen-reader context. */
function ChannelCell({
  type,
  channel,
  checked,
  disabled,
  onChange,
}: {
  type: NotificationTypeDef;
  channel: NotificationChannel;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  if (!type.channels.includes(channel)) {
    return (
      <>
        <span aria-hidden="true" className="text-muted-foreground/50">
          —
        </span>
        <span className="sr-only">
          {CHANNEL_LABEL[channel]} is not available for {type.label}
        </span>
      </>
    );
  }

  return (
    <Switch
      checked={checked}
      disabled={disabled}
      onCheckedChange={onChange}
      aria-label={`${type.label} — ${CHANNEL_LABEL[channel]}`}
      className="data-[state=checked]:bg-foreground"
    />
  );
}

/**
 * Admin per-type × per-channel notification matrix (Settings → Notifications).
 * A single `table-fixed` grid so the Email/Push columns line up across every
 * group, with visible column headers and per-group section headers. Each toggle
 * saves immediately (optimistic) — no Save button. See docs/superpowers/specs/
 * 2026-07-13-notification-channel-matrix-design.md.
 */
export function NotificationChannelMatrix({ restaurantId }: NotificationChannelMatrixProps) {
  const { settings, isLoading, isError, refetch, setChannel, isSaving } =
    useNotificationChannelSettings(restaurantId);

  const groups = useMemo(
    () =>
      GROUP_ORDER.map((group) => ({
        group,
        types: NOTIFICATION_TYPES.filter((t) => t.group === group),
      })).filter((g) => g.types.length > 0),
    [],
  );

  if (isLoading) {
    return (
      <div className="rounded-xl border border-border/40 bg-background p-4 space-y-3">
        <Skeleton
          className="h-5 w-48"
          role="status"
          aria-label="Loading notification channel settings"
        />
        <Skeleton className="h-64 w-full rounded-lg" />
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
    <div className="rounded-xl border border-border/40 bg-background overflow-hidden">
      <div className="px-5 pt-5 pb-4">
        <h3 className="text-[15px] font-semibold text-foreground">Notification channels</h3>
        <p className="text-[13px] text-muted-foreground mt-0.5">
          Turn a channel on to send that notification. Changes save automatically.
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full table-fixed border-collapse">
          <caption className="sr-only">
            Notification channel settings. For each notification type, toggle whether it sends over
            email and push.
          </caption>
          <colgroup>
            <col />
            <col className="w-[104px]" />
            <col className="w-[104px]" />
          </colgroup>
          <thead>
            <tr className="border-y border-border/40 bg-muted/40">
              <th
                scope="col"
                className="py-2.5 pl-5 pr-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
              >
                Notification
              </th>
              {(['email', 'push'] as const).map((channel) => {
                const Icon = CHANNEL_ICON[channel];
                return (
                  <th key={channel} scope="col" className="py-2.5 px-3">
                    <span className="flex flex-col items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      <Icon className="h-4 w-4" aria-hidden="true" />
                      {CHANNEL_LABEL[channel]}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          {groups.map(({ group, types }) => {
            const GroupIcon = GROUP_ICON[group];
            return (
              <tbody key={group}>
                <tr className="bg-muted/20">
                  <th
                    scope="colgroup"
                    colSpan={3}
                    className="py-2 pl-5 pr-3 text-left text-[12px] font-semibold text-foreground/80 border-b border-border/40"
                  >
                    <span className="flex items-center gap-2">
                      <GroupIcon className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                      {group}
                    </span>
                  </th>
                </tr>
                {types.map((type) => {
                  const value = settings.get(type.key) ?? { email: true, push: true };
                  return (
                    <tr
                      key={type.key}
                      className="border-b border-border/30 last:border-0 hover:bg-muted/20 transition-colors"
                    >
                      <th
                        scope="row"
                        className="py-3 pl-5 pr-3 text-left text-[14px] font-normal text-foreground"
                      >
                        {type.label}
                      </th>
                      <td className="py-3 px-3 text-center align-middle">
                        <ChannelCell
                          type={type}
                          channel="email"
                          checked={value.email}
                          disabled={isSaving}
                          onChange={(checked) => setChannel(type.key, 'email', checked)}
                        />
                      </td>
                      <td className="py-3 px-3 text-center align-middle">
                        <ChannelCell
                          type={type}
                          channel="push"
                          checked={value.push}
                          disabled={isSaving}
                          onChange={(checked) => setChannel(type.key, 'push', checked)}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            );
          })}
        </table>
      </div>
    </div>
  );
}
