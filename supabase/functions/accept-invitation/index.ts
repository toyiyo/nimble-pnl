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

    // Set auth for supabase client
    supabase.auth.setSession({
      access_token: authHeader.replace('Bearer ', ''),
      refresh_token: '',
    });

    // Get current user
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      throw new Error('Unauthorized');
    }

    const { token }: RequestBody = await req.json();

    if (!token) {
      throw new Error('Missing invitation token');
    }

    console.log('Processing invitation acceptance for token:', token);

    // Find the invitation
    const { data: invitation, error: invitationError } = await supabase
      .from('invitations')
      .select(`
        *,
        restaurants(name)
      `)
      .eq('token', token)
      .eq('status', 'pending')
      .single();

    if (invitationError || !invitation) {
      throw new Error('Invalid or expired invitation');
    }

    // Check if invitation is expired
    if (new Date() > new Date(invitation.expires_at)) {
      await supabase
        .from('invitations')
        .update({ status: 'expired', updated_at: new Date() })
        .eq('id', invitation.id);
      
      throw new Error('This invitation has expired');
    }

    // Check if the user's email matches the invitation email
    if (user.email !== invitation.email) {
      throw new Error('This invitation was sent to a different email address');
    }

    // Check if user is already a member of this restaurant
    const { data: existingMember } = await supabase
      .from('user_restaurants')
      .select('id')
      .eq('user_id', user.id)
      .eq('restaurant_id', invitation.restaurant_id)
      .single();

    if (existingMember) {
      // Update invitation status to accepted anyway
      await supabase
        .from('invitations')
        .update({ 
          status: 'accepted', 
          accepted_at: new Date(),
          accepted_by: user.id,
          updated_at: new Date()
        })
        .eq('id', invitation.id);

      return new Response(
        JSON.stringify({ 
          success: true,
          message: 'You are already a member of this restaurant',
          restaurantName: invitation.restaurants?.name,
          alreadyMember: true
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders,
          },
        }
      );
    }

    // Add user to restaurant with the specified role
    const { error: memberError } = await supabase
      .from('user_restaurants')
      .insert({
        user_id: user.id,
        restaurant_id: invitation.restaurant_id,
        role: invitation.role
      });

    if (memberError) {
      throw memberError;
    }

    // Update invitation status to accepted
    const { error: updateError } = await supabase
      .from('invitations')
      .update({ 
        status: 'accepted', 
        accepted_at: new Date(),
        accepted_by: user.id,
        updated_at: new Date()
      })
      .eq('id', invitation.id);

    if (updateError) {
      throw updateError;
    }

    console.log(`Invitation accepted: User ${user.id} joined restaurant ${invitation.restaurant_id} as ${invitation.role}`);

    return new Response(
      JSON.stringify({ 
        success: true,
        message: `Welcome to ${invitation.restaurants?.name}! You've been added as a ${invitation.role}.`,
        restaurantName: invitation.restaurants?.name,
        role: invitation.role,
        restaurantId: invitation.restaurant_id
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