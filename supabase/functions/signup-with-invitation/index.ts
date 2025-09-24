import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { corsHeaders } from '../_shared/cors.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

interface SignupRequest {
  email: string;
  password: string;
  fullName: string;
  token: string;
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
    
    const { email, password, fullName, token }: SignupRequest = await req.json();
    
    console.log('Processing signup with invitation for:', email);
    
    // First, validate the invitation
    const { data: invitation, error: inviteError } = await supabaseAdmin
      .from('invitations')
      .select('*')
      .eq('token', token)
      .eq('status', 'pending')
      .eq('email', email)
      .single();

    if (inviteError || !invitation) {
      console.error('Invalid invitation:', inviteError);
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid or expired invitation' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    // Check if invitation is expired
    if (new Date(invitation.expires_at) < new Date()) {
      console.error('Invitation expired');
      return new Response(
        JSON.stringify({ success: false, error: 'Invitation has expired' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    // Create the user account first
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      user_metadata: {
        full_name: fullName,
      }
    });

    if (authError) {
      console.error('Error creating user:', authError);
      return new Response(
        JSON.stringify({ success: false, error: authError.message }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    console.log('User created successfully:', authData.user.id);

    // Now confirm the user's email manually
    const { error: confirmError } = await supabaseAdmin.auth.admin.updateUserById(
      authData.user.id,
      { email_confirm: true }
    );

    if (confirmError) {
      console.error('Error confirming user email:', confirmError);
      // Continue anyway, as the user is created
    }

    // Check if user is already a member of the restaurant
    const { data: existingMembership } = await supabaseAdmin
      .from('user_restaurants')
      .select('*')
      .eq('user_id', authData.user.id)
      .eq('restaurant_id', invitation.restaurant_id)
      .single();

    if (!existingMembership) {
      // Add user to restaurant
      const { error: membershipError } = await supabaseAdmin
        .from('user_restaurants')
        .insert({
          user_id: authData.user.id,
          restaurant_id: invitation.restaurant_id,
          role: invitation.role
        });

      if (membershipError) {
        console.error('Error adding user to restaurant:', membershipError);
        return new Response(
          JSON.stringify({ success: false, error: 'Failed to add user to restaurant' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
        );
      }
    }

    // Mark invitation as accepted
    const { error: updateError } = await supabaseAdmin
      .from('invitations')
      .update({
        status: 'accepted',
        accepted_at: new Date().toISOString(),
        accepted_by: authData.user.id,
        updated_at: new Date().toISOString()
      })
      .eq('id', invitation.id);

    if (updateError) {
      console.error('Error updating invitation:', updateError);
    }

    console.log('Invitation accepted successfully');

    // Get restaurant information
    const { data: restaurant } = await supabaseAdmin
      .from('restaurants')
      .select('*')
      .eq('id', invitation.restaurant_id)
      .single();

    return new Response(
      JSON.stringify({
        success: true,
        message: `Welcome to ${restaurant?.name || 'the team'}! Please sign in with your new account.`,
        restaurant: restaurant
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in signup-with-invitation:', error);
    return new Response(
      JSON.stringify({ success: false, error: 'Internal server error' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});