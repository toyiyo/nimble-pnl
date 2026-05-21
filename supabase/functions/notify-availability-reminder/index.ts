// deno-lint-ignore-file
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { sendEmail, NOTIFICATION_FROM } from '../_shared/notificationHelpers.ts';
import {
  processAvailabilityReminder,
  buildDeps,
} from '../_shared/availabilityReminderHandler.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');
if (!SUPABASE_URL) throw new Error('SUPABASE_URL is not configured');
if (!SUPABASE_ANON_KEY) throw new Error('SUPABASE_ANON_KEY is not configured');

const deps = buildDeps({
  env: {
    APP_URL: Deno.env.get('APP_URL') ?? undefined,
    RESEND_API_KEY: Deno.env.get('RESEND_API_KEY') ?? undefined,
    NOTIFICATION_FROM: NOTIFICATION_FROM,
  },
  createClient: (authHeader) =>
    createClient(
      SUPABASE_URL,
      SUPABASE_ANON_KEY,
      { global: { headers: authHeader ? { Authorization: authHeader } : {} } },
    ) as never,
  sendEmail: (key, from, to, subject, html) => sendEmail(key, from, to, subject, html),
});

serve((req) => processAvailabilityReminder(req, deps));
