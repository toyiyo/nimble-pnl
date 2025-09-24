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

    console.log('Validating invitation with token:', token);

    // Get invitation details (public endpoint - no auth required)
    const { data: invitation, error: invitationError } = await supabase
      .from('invitations')
      .select(`
        *,
        restaurants(name, address),
        invited_by_profile:profiles!invited_by(full_name)
      `)
      .eq('token', token)
      .eq('status', 'pending')
      .single();

    if (invitationError || !invitation) {
      throw new Error('Invalid or expired invitation');
    }

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
          restaurant: invitation.restaurants,
          invited_by: invitation.invited_by_profile?.full_name || 'Restaurant Owner',
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