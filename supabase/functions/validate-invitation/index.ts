import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RequestBody {
  token: string;
}

const handler = async (req: Request): Promise<Response> => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { token }: RequestBody = await req.json();

    if (!token) {
      throw new Error('Missing token');
    }

    console.log('Validating invitation with token');

    // Hash the token to look up in database
    const { data: hashedToken, error: hashError } = await supabase
      .rpc('hash_invitation_token', { token });
    
    if (hashError) {
      throw new Error('Failed to validate token');
    }

    // Get invitation details using hashed token (public endpoint - no auth required)
    const { data: invitation, error: invitationError } = await supabase
      .from('invitations')
      .select('*')
      .eq('token', hashedToken)
      .eq('status', 'pending')
      .single();

    console.log('Database query result:', { invitation, invitationError });

    if (invitationError || !invitation) {
      console.error('Invitation not found or error:', invitationError);
      throw new Error('Invalid or expired invitation');
    }

    // Get restaurant details separately
    const { data: restaurant } = await supabase
      .from('restaurants')
      .select('name, address')
      .eq('id', invitation.restaurant_id)
      .single();

    // Get invited by profile details separately
    const { data: invitedByProfile } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('user_id', invitation.invited_by)
      .single();

    // Check if invitation is expired
    if (new Date() > new Date(invitation.expires_at)) {
      throw new Error('Invitation has expired');
    }

    console.log('Invitation validated successfully for email:', invitation.email);

    return new Response(
      JSON.stringify({ 
        success: true,
        invitation: {
          email: invitation.email,
          role: invitation.role,
          restaurant: restaurant,
          invited_by: invitedByProfile?.full_name || 'Restaurant Owner',
          expires_at: invitation.expires_at
        }
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders,
        },
      }
    );
  } catch (error: any) {
    console.error('Error validating invitation:', error);
    return new Response(
      JSON.stringify({ 
        error: error.message,
        success: false 
      }),
      {
        status: 500,
        headers: { 
          'Content-Type': 'application/json', 
          ...corsHeaders 
        },
      }
    );
  }
};

serve(handler);