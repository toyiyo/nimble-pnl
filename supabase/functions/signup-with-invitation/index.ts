/**
 * signup-with-invitation/index.ts
 *
 * Creates a new account for an invited email. It never changes an existing
 * account: an email that already has an account gets 409 `account_exists`.
 * All logic is in _shared/signupWithInvitationHandler.ts.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { corsHeaders } from '../_shared/cors.ts';
import {
  handleSignupWithInvitation,
  type SignupWithInvitationAdmin,
} from '../_shared/signupWithInvitationHandler.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
    const result = await handleSignupWithInvitation(
      supabaseAdmin as unknown as SignupWithInvitationAdmin,
      await req.json(),
    );

    return new Response(JSON.stringify(result.body), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: result.status,
    });
  } catch (error) {
    console.error('Error in signup-with-invitation:', error);
    return new Response(
      JSON.stringify({ success: false, error: 'Internal server error' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
