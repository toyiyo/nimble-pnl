// Shift trade reminders worker. pg_cron calls it every 15 minutes
// (migration 20260925120000_shift_trade_reminders.sql).
//
// All decision logic is in `_shared/shiftTradeRemindersHandler.ts`, which
// vitest covers. This file only wires the real Supabase RPC, Resend and
// web-push clients into that handler.
//
// verify_jwt is false (config.toml), because pg_net sends the service-role
// key, not a user JWT. The function checks that Bearer with a timing-safe
// compare. It reads no input from the request body. Every row comes from
// service-role-only RPCs.

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { NOTIFICATION_FROM, APP_URL } from '../_shared/notificationHelpers.ts';
import { sendEmailResult } from '../_shared/emailQueue.ts';
import { truncateError } from '../_shared/emailSendSummary.ts';
import { sendWebPushToUsers } from '../_shared/webPushHelper.ts';
import { isServiceRoleBearer } from '../_shared/cronAuth.ts';
import { resolveChannels, type SupabaseLike } from '../_shared/resolveChannels.ts';
import {
  runShiftTradeReminders,
  type ShiftTradeRemindersDeps,
  type ReminderCandidateRow,
  type UnclaimedRecipientRow,
} from '../_shared/shiftTradeRemindersHandler.ts';

const JSON_HEADERS = { ...corsHeaders, 'Content-Type': 'application/json' };

const rpcError = (error: { message: string } | null) => (error ? { message: error.message } : null);

serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: JSON_HEADERS,
    });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const resendApiKey = Deno.env.get('RESEND_API_KEY');
  // Fail fast. A silent fallback would stop the reminders with no signal.
  if (!supabaseUrl || !serviceRoleKey || !resendApiKey) {
    console.error('[shift-trade-reminders] missing required env');
    return new Response(JSON.stringify({ error: 'Service not configured' }), {
      status: 500,
      headers: JSON_HEADERS,
    });
  }

  // Only the cron job (or a person with the same key) can start a run.
  if (!isServiceRoleBearer(req.headers.get('authorization'), serviceRoleKey)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: JSON_HEADERS,
    });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const deps: ShiftTradeRemindersDeps = {
    fetchCandidates: async (nowIso, limit, after) => {
      const { data, error } = await supabase.rpc('get_shift_trade_reminder_candidates', {
        p_now: nowIso,
        p_limit: limit,
        p_after_start: after?.start_time ?? null,
        p_after_trade: after?.shift_trade_id ?? null,
        p_after_stage: after?.stage ?? null,
      });
      return { data: (data ?? null) as ReminderCandidateRow[] | null, error: rpcError(error) };
    },
    claim: async (tradeId, stage) => {
      const { data, error } = await supabase.rpc('claim_shift_trade_reminder', {
        p_trade_id: tradeId,
        p_stage: stage,
      });
      return { data: data === true, error: rpcError(error) };
    },
    resolveChannels: (restaurantId, type) =>
      resolveChannels(supabase as unknown as SupabaseLike, restaurantId, type),
    fetchAudience: async (tradeId) => {
      const { data, error } = await supabase.rpc('get_shift_trade_reminder_audience', {
        p_trade_id: tradeId,
      });
      return { data: (data ?? null) as Array<{ user_id: string }> | null, error: rpcError(error) };
    },
    fetchUnclaimedRecipients: async (tradeId) => {
      const { data, error } = await supabase.rpc('get_shift_trade_unclaimed_recipients', {
        p_trade_id: tradeId,
      });
      return { data: (data ?? null) as UnclaimedRecipientRow[] | null, error: rpcError(error) };
    },
    sendPush: async (userIds, restaurantId, payload) => {
      const res = await sendWebPushToUsers(supabase, userIds, restaurantId, payload);
      return { sent: res.sent, skipped: res.skipped };
    },
    sendEmail: (to, subject, html) => sendEmailResult(resendApiKey, NOTIFICATION_FROM, to, subject, html),
    now: () => Date.now(),
    appUrl: APP_URL,
  };

  try {
    const result = await runShiftTradeReminders(deps);
    return new Response(JSON.stringify(result), {
      status: result.error ? 500 : 200,
      headers: JSON_HEADERS,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[shift-trade-reminders] unhandled error: ${truncateError(message)}`);
    return new Response(JSON.stringify({ error: 'Internal error' }), {
      status: 500,
      headers: JSON_HEADERS,
    });
  }
});
