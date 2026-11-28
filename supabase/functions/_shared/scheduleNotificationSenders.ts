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
import { sendEmailResult, sendPaced } from './emailQueue.ts';
import { APP_URL, NOTIFICATION_FROM } from './notificationHelpers.ts';
import { sendWebPushToUser } from './webPushHelper.ts';
import { scheduleThreadHeaders, shiftBusinessDay } from './scheduleEmailThread.ts';
import { addDaysToDateStr } from './labor/restaurantClock.ts';
import { buildScheduleChangeEmail } from './scheduleChangeEmail.ts';
import {
  markNotification,
  summarizeLines,
  type DeliverDeps,
  type DeliveryChange,
  type DeliveryEmployee,
  type RpcClient,
} from './scheduleNotificationDelivery.ts';

const SCHEDULE_URL = `${APP_URL}/employee/schedule`;

/** PostgREST sends `.in()` in the URL; 100 UUIDs stay far below URL limits. */
const ID_CHUNK = 100;

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

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Monday of the week that holds a YYYY-MM-DD day. */
function mondayOf(day: string): string {
  const dow = new Date(`${day}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDaysToDateStr(day, -((dow + 6) % 7));
}

/**
 * Thread the email with the other schedule emails of the week. The header
 * comes from the row's first shift date alone, so a retry of the row sends
 * the same body under the same Idempotency-Key.
 */
function threadHeaders(ctx: SenderContext, startIso: string): Record<string, string> | undefined {
  const day = shiftBusinessDay(startIso, ctx.timeZone);
  return day ? scheduleThreadHeaders(ctx.restaurantId, mondayOf(day)) : undefined;
}

export function makeDeliverDeps(ctx: SenderContext): DeliverDeps {
  const rpcClient = ctx.serviceClient as unknown as RpcClient;
  const apiKey = ctx.resendApiKey;

  return {
    timeZone: ctx.timeZone,
    loadChanges: async (ids) => {
      const rows: DeliveryChange[] = [];
      for (const part of chunks(ids, ID_CHUNK)) {
        const { data, error } = await ctx.serviceClient
          .from('schedule_change_logs')
          .select('id, shift_id, change_type, changed_at, before_data, after_data')
          .eq('restaurant_id', ctx.restaurantId)
          .in('id', part);
        if (error) throw new Error(`Failed to fetch change logs: ${error.message}`);
        rows.push(...((data ?? []) as DeliveryChange[]));
      }
      return rows;
    },
    // A service-role read keeps the column grants: migration 20260806110000
    // revoked SELECT on employees.email from `authenticated`. Each caller
    // checks the user's access before it gets here.
    loadEmployees: async (ids) => {
      const rows: DeliveryEmployee[] = [];
      for (const part of chunks(ids, ID_CHUNK)) {
        const { data, error } = await ctx.serviceClient
          .from('employees')
          .select('id, name, email, user_id')
          .eq('restaurant_id', ctx.restaurantId)
          .in('id', part);
        if (error) throw new Error(`Failed to fetch employees: ${error.message}`);
        rows.push(...((data ?? []) as DeliveryEmployee[]));
      }
      return rows;
    },
    sendEmail:
      ctx.channels.email && apiKey
        ? async (employee, lines, notificationId) => {
            if (!employee.email) return 'failed';
            const email = buildScheduleChangeEmail({
              employeeName: employee.name ?? 'there',
              restaurantName: ctx.restaurantName,
              lines,
              appUrl: SCHEDULE_URL,
            });
            const headers = lines[0]?.sortKey ? threadHeaders(ctx, lines[0].sortKey) : undefined;
            // sendPaced for its 429 backoff; deliverClaimed owns the pacing.
            const [result] = await sendPaced(
              [employee],
              () =>
                sendEmailResult(apiKey, NOTIFICATION_FROM, employee.email ?? '', email.subject, email.html, headers, {
                  idempotencyKey: notificationId,
                }),
              { intervalMs: 0, label: `schedule-notification ${notificationId}` },
            );
            if (result.ok) return 'sent';
            console.error(`schedule notification: email failed for employee ${employee.id} [${result.status}]`, result.error);
            // Status 0 means no answer from Resend (a timeout or a network
            // error): the email may have arrived.
            return result.status === 0 ? 'uncertain' : 'failed';
          }
        : null,
    sendPush: ctx.channels.push
      ? async (employee, lines, notificationId) => {
          if (!employee.user_id) return 'failed';
          const summary = summarizeLines(lines);
          const result = await sendWebPushToUser(ctx.serviceClient, employee.user_id, ctx.restaurantId, {
            title: summary.title,
            body: summary.body,
            url: '/employee/schedule',
            // The row id: a resend of the same row replaces the first push.
            tag: `schedule-notification-${notificationId}`,
          });
          ctx.onPushSent?.(result.sent);
          return result.sent > 0 ? 'sent' : 'failed';
        }
      : null,
    mark: (id, status, channels, error, uncertain) =>
      markNotification(rpcClient, id, status, channels, error, uncertain),
  };
}
