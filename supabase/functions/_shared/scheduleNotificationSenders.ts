/**
 * The Deno side of schedule notification delivery: the loaders, the email
 * and push senders, and the mark call, for deliverClaimed().
 *
 * Both notifiers use it, so a row sends the same message whichever notifier
 * runs it:
 *   - notify-schedule-published (the UI publish and the MCP publish_week);
 *   - notify-shift-changed (an edit of a published shift).
 *
 * Design: docs/superpowers/specs/2026-11-28-mcp-publish-notifications-design.md
 */
import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { sendEmailResult } from './emailQueue.ts';
import { sendWebPushToUser } from './webPushHelper.ts';
import { scheduleThreadHeaders, shiftBusinessDay } from './scheduleEmailThread.ts';
import { buildScheduleChangeEmail } from './scheduleChangeEmail.ts';
import {
  markNotification,
  summarizeLines,
  type DeliverDeps,
  type DeliveryChange,
  type DeliveryEmployee,
  type RpcClient,
} from './scheduleNotificationDelivery.ts';

export const SCHEDULE_NOTIFICATION_FROM = 'EasyShiftHQ <notifications@easyshifthq.com>';
const APP_URL = 'https://app.easyshifthq.com/employee/schedule';

export interface SenderContext {
  serviceClient: SupabaseClient;
  restaurantId: string;
  restaurantName: string;
  timeZone: string;
  resendApiKey: string | undefined;
  channels: { email: boolean; push: boolean };
  /** Counts push deliveries, for the response. */
  onPushSent?: (count: number) => void;
}

/**
 * Thread the email with the publish emails of the week that holds the shift.
 * Missing data gives no header, never an error.
 */
async function resolveThreadHeaders(
  ctx: SenderContext,
  startIso: string,
): Promise<Record<string, string> | undefined> {
  const businessDay = shiftBusinessDay(startIso, ctx.timeZone);
  if (!businessDay) return undefined;
  const minWeekStart = new Date(`${businessDay}T00:00:00Z`);
  minWeekStart.setUTCDate(minWeekStart.getUTCDate() - 6);

  const { data: publication, error } = await ctx.serviceClient
    .from('schedule_publications')
    .select('week_start_date')
    .eq('restaurant_id', ctx.restaurantId)
    .gte('week_start_date', minWeekStart.toISOString().slice(0, 10))
    .lte('week_start_date', businessDay)
    .gte('week_end_date', businessDay)
    .order('published_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('schedule notification: covering publication lookup failed', error);
    return undefined;
  }
  return publication ? scheduleThreadHeaders(ctx.restaurantId, publication.week_start_date) : undefined;
}

export function makeDeliverDeps(ctx: SenderContext): DeliverDeps {
  const rpcClient = ctx.serviceClient as unknown as RpcClient;

  return {
    timeZone: ctx.timeZone,
    loadChanges: async (ids) => {
      const { data, error } = await ctx.serviceClient
        .from('schedule_change_logs')
        .select('id, shift_id, change_type, changed_at, before_data, after_data')
        .eq('restaurant_id', ctx.restaurantId)
        .in('id', ids);
      if (error) throw new Error(`Failed to fetch change logs: ${error.message}`);
      return (data ?? []) as DeliveryChange[];
    },
    // A service-role read keeps the column grants: migration 20260806110000
    // revoked SELECT on employees.email from `authenticated`. Each caller
    // checks the user's access before it gets here.
    loadEmployees: async (ids) => {
      const { data, error } = await ctx.serviceClient
        .from('employees')
        .select('id, name, email, user_id')
        .eq('restaurant_id', ctx.restaurantId)
        .in('id', ids);
      if (error) throw new Error(`Failed to fetch employees: ${error.message}`);
      return (data ?? []) as DeliveryEmployee[];
    },
    sendEmail:
      ctx.channels.email && ctx.resendApiKey
        ? async (employee, lines, notificationId) => {
            if (!employee.email) return false;
            const email = buildScheduleChangeEmail({
              employeeName: employee.name ?? 'there',
              restaurantName: ctx.restaurantName,
              lines,
              appUrl: APP_URL,
            });
            const headers = lines[0]?.sortKey ? await resolveThreadHeaders(ctx, lines[0].sortKey) : undefined;
            const result = await sendEmailResult(
              ctx.resendApiKey ?? '',
              SCHEDULE_NOTIFICATION_FROM,
              employee.email,
              email.subject,
              email.html,
              headers,
              { idempotencyKey: notificationId },
            );
            if (!result.ok) {
              console.error(`schedule notification: email failed for employee ${employee.id} [${result.status}]`, result.error);
            }
            return result.ok;
          }
        : null,
    sendPush: ctx.channels.push
      ? async (employee, lines, notificationId) => {
          if (!employee.user_id) return false;
          const summary = summarizeLines(lines);
          const result = await sendWebPushToUser(ctx.serviceClient, employee.user_id, ctx.restaurantId, {
            title: summary.title,
            body: summary.body,
            url: '/employee/schedule',
            // The row id: a resend of the same row replaces the first push.
            tag: `schedule-notification-${notificationId}`,
          });
          ctx.onPushSent?.(result.sent);
          return result.sent > 0;
        }
      : null,
    mark: (id, status, channels, error) => markNotification(rpcClient, id, status, channels, error),
  };
}
