// Daily worker — fired by pg_cron at 09:00 UTC. Pulls trial-window
// candidates from the RPC, renders the appropriate template variant
// per row, sends via Resend, records the send for dedupe, and
// captures PostHog telemetry. Internal-team callers can invoke this
// manually with the service-role key for backfill / debugging.
//
// JWT verification is disabled (config.toml) because pg_net cron jobs
// pass the service-role key in the Authorization header, not a user
// JWT. The function does not accept any cross-tenant input — every
// candidate row comes from the RPC, which is locked down to
// service_role only.

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { Resend } from 'https://esm.sh/resend@4.0.0';
import { corsHeaders } from '../_shared/cors.ts';
import { captureServerEvent } from '../_shared/posthogServer.ts';
import {
  runTrialExpiryEmails,
  type FetchCandidatesFn,
  type SendEmailFn,
  type RecordSentFn,
  type TrialEmailRow,
} from '../_shared/trialExpiryEmailsHandler.ts';

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

  const fromEmail = Deno.env.get('TRIAL_EMAIL_FROM');
  const appUrl = Deno.env.get('APP_URL');
  const resendApiKey = Deno.env.get('RESEND_API_KEY');
  const unsubscribeSecret = Deno.env.get('UNSUBSCRIBE_TOKEN_SECRET');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  // Fail fast: a missing TRIAL_EMAIL_FROM or APP_URL silently breaks
  // unsubscribe links and sender identity, so we never want a fallback here.
  if (
    !fromEmail ||
    !appUrl ||
    !resendApiKey ||
    !unsubscribeSecret ||
    !supabaseUrl ||
    !serviceRoleKey
  ) {
    console.error('[trial-expiry-emails] missing required env');
    return new Response(
      JSON.stringify({ error: 'Service not configured' }),
      { status: 500, headers: JSON_HEADERS }
    );
  }

  // verify_jwt is disabled at the function level (pg_net cron passes
  // the service-role key, not a user JWT), so we authenticate the
  // caller in-function: only the cron job (or a human invoking with
  // the same key for backfill) is allowed to trigger bulk sends.
  const auth = req.headers.get('authorization') ?? '';
  const expected = `Bearer ${serviceRoleKey}`;
  if (!timingSafeEqual(auth, expected)) {
    return new Response(
      JSON.stringify({ error: 'Unauthorized' }),
      { status: 401, headers: JSON_HEADERS }
    );
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const resend = new Resend(resendApiKey);

  const fetchCandidates: FetchCandidatesFn = async () => {
    const { data, error } = await supabase.rpc('users_in_trial_email_window');
    return {
      data: (data ?? null) as TrialEmailRow[] | null,
      error: error ? { message: error.message } : null,
    };
  };

  const send: SendEmailFn = async (msg) => {
    try {
      const { data, error } = await resend.emails.send({
        from: msg.from,
        to: [msg.to],
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
      });
      if (error) {
        return { id: null, error: { message: error.message } };
      }
      return { id: data?.id ?? null, error: null };
    } catch (e) {
      return { id: null, error: { message: (e as Error).message } };
    }
  };

  const record: RecordSentFn = async (row) => {
    const { error } = await supabase.from('trial_emails_sent').insert(row);
    return { error: error ? { message: error.message } : null };
  };

  const capture = captureServerEvent;

  const result = await runTrialExpiryEmails({
    fetchCandidates,
    send,
    record,
    capture,
    fromEmail,
    appUrl,
    unsubscribeSecret,
  });

  console.log(
    `[trial-expiry-emails] count=${result.count} sent=${result.results.filter(
      (r) => r.status === 'sent'
    ).length} errors=${result.results.filter((r) => r.status === 'error').length}`
  );

  return new Response(JSON.stringify({ ok: !result.error, ...result }), {
    status: result.error ? 500 : 200,
    headers: JSON_HEADERS,
  });
});
