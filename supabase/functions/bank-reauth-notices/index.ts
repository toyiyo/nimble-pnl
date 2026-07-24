// Daily worker — fired by pg_cron at 09:00 UTC (migration
// 20260723130200_schedule_bank_reauth_notices.sql). Walks both escalation
// cohorts (still-down / recovered), sends the appropriate email+push per
// design §4.6, and records a dedupe row per (connected_bank_id, stage,
// deactivated_at). All decision logic lives in the pure, vitest-tested
// `_shared/bankReauthNoticesHandler.ts` — this file only wires real
// Supabase RPC / Resend / web-push clients into that dependency interface,
// mirroring `trial-expiry-emails/index.ts`.
//
// JWT verification is disabled (config.toml) because pg_net cron jobs pass
// the service-role key in the Authorization header, not a user JWT. The
// function accepts no cross-tenant input at all — every candidate row comes
// from service-role-only RPCs.

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { sendEmail, NOTIFICATION_FROM, APP_URL } from '../_shared/notificationHelpers.ts';
import { sendWebPushToUsers } from '../_shared/webPushHelper.ts';
import { resolveChannels, type SupabaseLike } from '../_shared/resolveChannels.ts';
import {
  runBankReauthNotices,
  type FetchCohortAFn,
  type FetchCohortBFn,
  type FetchRecipientsFn,
  type ResolveChannelsFn,
  type SendEmailFn,
  type SendPushFn,
  type RecordNoticeFn,
  type CohortARow,
  type CohortBRow,
  type RecipientRow,
} from '../_shared/bankReauthNoticesHandler.ts';

const JSON_HEADERS = { ...corsHeaders, 'Content-Type': 'application/json' };

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { status: 405, headers: JSON_HEADERS }
    );
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const resendApiKey = Deno.env.get('RESEND_API_KEY');
  // Fail fast on missing config, same as trial-expiry-emails — a silent
  // fallback here would mean the escalation ladder quietly stops running.
  if (!supabaseUrl || !serviceRoleKey || !resendApiKey) {
    console.error('[bank-reauth-notices] missing required env');
    return new Response(
      JSON.stringify({ error: 'Service not configured' }),
      { status: 500, headers: JSON_HEADERS }
    );
  }

  // verify_jwt is disabled at the function level (pg_net cron passes the
  // service-role key, not a user JWT), so the caller is authenticated
  // in-function: only the cron job (or a human invoking with the same key
  // for backfill/debugging) may trigger a run.
  const auth = req.headers.get('authorization') ?? '';
  const expected = `Bearer ${serviceRoleKey}`;
  if (!timingSafeEqual(auth, expected)) {
    return new Response(
      JSON.stringify({ error: 'Unauthorized' }),
      { status: 401, headers: JSON_HEADERS }
    );
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const fetchCohortA: FetchCohortAFn = async () => {
    const { data, error } = await supabase.rpc('bank_reauth_cohort_a_candidates');
    return {
      data: (data ?? null) as CohortARow[] | null,
      error: error ? { message: error.message } : null,
    };
  };

  const fetchCohortB: FetchCohortBFn = async () => {
    const { data, error } = await supabase.rpc('bank_reauth_cohort_b_recovered');
    return {
      data: (data ?? null) as CohortBRow[] | null,
      error: error ? { message: error.message } : null,
    };
  };

  const fetchRecipients: FetchRecipientsFn = async (restaurantId, roles) => {
    const { data, error } = await supabase.rpc('bank_reauth_notice_recipients', {
      p_restaurant_id: restaurantId,
      p_roles: roles,
    });
    return {
      data: (data ?? null) as RecipientRow[] | null,
      error: error ? { message: error.message } : null,
    };
  };

  const resolveChannelsFn: ResolveChannelsFn = (restaurantId) =>
    resolveChannels(supabase as unknown as SupabaseLike, restaurantId, 'bank_reauth_required');

  const send: SendEmailFn = async (msg) => {
    const ok = await sendEmail(resendApiKey, msg.from, msg.to, msg.subject, msg.html);
    return ok
      ? { id: `${msg.to}:${Date.now()}`, error: null }
      : { id: null, error: { message: 'Resend send failed' } };
  };

  const sendPush: SendPushFn = async (userIds, restaurantId, payload) => {
    const result = await sendWebPushToUsers(supabase, userIds, restaurantId, payload);
    return { sent: result.sent };
  };

  const recordNotice: RecordNoticeFn = async (row) => {
    // ON CONFLICT DO NOTHING on bank_reauth_notices_once (connected_bank_id,
    // stage, deactivated_at) — a concurrent double-run of this worker is a
    // silent no-op rather than a 23505 (design §4.6).
    const { error } = await supabase
      .from('bank_reauth_notices')
      .upsert(row, {
        onConflict: 'connected_bank_id,stage,deactivated_at',
        ignoreDuplicates: true,
      });
    return { error: error ? { message: error.message } : null };
  };

  try {
    const result = await runBankReauthNotices({
      fetchCohortA,
      fetchCohortB,
      fetchRecipients,
      resolveChannels: resolveChannelsFn,
      sendEmail: send,
      sendPush,
      recordNotice,
      fromEmail: NOTIFICATION_FROM,
      appUrl: APP_URL,
    });

    console.log(
      `[bank-reauth-notices] cohortA=${result.cohortACount} cohortB=${result.cohortBCount} ` +
        `sent=${result.results.filter((r) => r.status === 'sent').length} ` +
        `errors=${result.results.filter((r) => r.status === 'error').length}`
    );

    return new Response(JSON.stringify({ ok: !result.error, ...result }), {
      status: result.error ? 500 : 200,
      headers: JSON_HEADERS,
    });
  } catch (err) {
    console.error('[bank-reauth-notices] unhandled error', err);
    return new Response(JSON.stringify({ error: 'Internal error' }), {
      status: 500,
      headers: JSON_HEADERS,
    });
  }
});
