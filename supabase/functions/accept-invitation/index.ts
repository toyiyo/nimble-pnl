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

    // Get the authorization header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('Missing authorization header');
    }

    // Create a client with the user's token for auth operations
    const userSupabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: {
            Authorization: authHeader,
          },
        },
      }
    );

    const { token }: RequestBody = await req.json();

    if (!token) {
      throw new Error('Missing token');
    }

    console.log('Accepting invitation');

    // Get current user info
    const { data: { user }, error: authError } = await userSupabase.auth.getUser();
    if (authError || !user) {
      console.error('Auth error:', authError);
      throw new Error('Unauthorized');
    }

    // Hash the token to look up in database
    const { data: hashedToken, error: hashError } = await supabase
      .rpc('hash_invitation_token', { token });
    
    if (hashError) {
      throw new Error('Failed to validate token');
    }

    // Get invitation details and validate using hashed token
    const { data: invitation, error: invitationError } = await supabase
      .from('invitations')
      .select('*')
      .eq('token', hashedToken)
      .eq('status', 'pending')
      .single();

    if (invitationError || !invitation) {
      throw new Error('Invalid or expired invitation');
    }

    // Get restaurant details separately
    const { data: restaurant, error: restaurantError } = await supabase
      .from('restaurants')
      .select('name, address')
      .eq('id', invitation.restaurant_id)
      .single();

    if (restaurantError) {
      console.error('Error fetching restaurant:', restaurantError);
      throw new Error('Restaurant not found');
    }

    // Check if invitation is expired
    if (new Date() > new Date(invitation.expires_at)) {
      throw new Error('Invitation has expired');
    }

    // Check if the user's email matches
    if (user.email !== invitation.email) {
      throw new Error(`This invitation was sent to ${invitation.email}, but you're logged in as ${user.email}`);
    }

    // Check if user is already a member of this restaurant
    const { data: existingMember } = await supabase
      .from('user_restaurants')
      .select('id')
      .eq('user_id', user.id)
      .eq('restaurant_id', invitation.restaurant_id)
      .single();

    if (existingMember) {
      throw new Error('You are already a member of this restaurant');
    }

    // Accept the invitation - add user to restaurant and update invitation status
    const { error: memberError } = await supabase
      .from('user_restaurants')
      .insert({
        user_id: user.id,
        restaurant_id: invitation.restaurant_id,
        role: invitation.role,
      });

    if (memberError) {
      console.error('Error adding user to restaurant:', memberError);
      throw new Error('Failed to add you to the restaurant team');
    }

    // Update invitation status
    const { error: updateError } = await supabase
      .from('invitations')
      .update({
        status: 'accepted',
        accepted_at: new Date().toISOString(),
        accepted_by: user.id,
        updated_at: new Date().toISOString(),
      })
      .eq('id', invitation.id);

    if (updateError) {
      console.error('Error updating invitation status:', updateError);
      // Don't fail the request if we can't update the invitation status
    }

    console.log('Invitation accepted successfully for user:', user.email);

    return new Response(
      JSON.stringify({ 
        success: true,
        message: `Welcome to ${restaurant.name}! You are now a ${invitation.role}.`,
        restaurantName: restaurant.name,
        role: invitation.role,
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
    console.error('Error accepting invitation:', error);
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