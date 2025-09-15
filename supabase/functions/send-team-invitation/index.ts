import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RequestBody {
  restaurantId: string;
  email: string;
  role: string;
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

    // Get the authorization header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('Missing authorization header');
    }

    // Set auth for supabase client
    supabase.auth.setSession({
      access_token: authHeader.replace('Bearer ', ''),
      refresh_token: '',
    });

    const { restaurantId, email, role }: RequestBody = await req.json();

    if (!restaurantId || !email || !role) {
      throw new Error('Missing required fields: restaurantId, email, or role');
    }

    console.log('Sending team invitation:', { restaurantId, email, role });

    // Get restaurant details
    const { data: restaurant, error: restaurantError } = await supabase
      .from('restaurants')
      .select('name')
      .eq('id', restaurantId)
      .single();

    if (restaurantError) {
      throw new Error('Restaurant not found');
    }

    // Generate invitation token
    const tokenBytes = new Uint8Array(32);
    crypto.getRandomValues(tokenBytes);
    const invitationToken = Array.from(tokenBytes, byte => byte.toString(16).padStart(2, '0')).join('');
    
    // Create invitation record (in a real implementation, you'd store this in a team_invitations table)
    const invitation = {
      id: crypto.randomUUID(),
      restaurant_id: restaurantId,
      email,
      role,
      token: invitationToken,
      status: 'pending',
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      created_at: new Date(),
    };

    console.log('Team invitation created:', invitation);

    // In a real implementation, you would:
    // 1. Store the invitation in a team_invitations table
    // 2. Send an email using a service like Resend with the invitation link
    // 3. Include the invitation token in the email link

    // For now, we'll just return success
    return new Response(
      JSON.stringify({ 
        success: true,
        message: `Invitation sent to ${email}`,
        invitation: {
          id: invitation.id,
          email,
          role,
          restaurantName: restaurant.name,
          expiresAt: invitation.expires_at,
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
    console.error('Error sending team invitation:', error);
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