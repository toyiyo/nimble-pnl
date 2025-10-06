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
    
    // Hash the token using Web Crypto API to match database format
    const encoder = new TextEncoder();
    const data = encoder.encode(token);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashedToken = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    
    console.log('Looking up invitation with hashed token');
    
    // First, validate the invitation
    const { data: invitation, error: inviteError } = await supabaseAdmin
      .from('invitations')
      .select('*')
      .eq('token', hashedToken)
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

    // Check if user already exists
    const { data: existingUsers } = await supabaseAdmin.auth.admin.listUsers();
    const existingUser = existingUsers?.users.find(u => u.email === email);

    let userId: string;

    if (existingUser) {
      console.log('User already exists, using existing account:', existingUser.id);
      userId = existingUser.id;
      
      // Update password for existing user
      const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(
        existingUser.id,
        { 
          password,
          email_confirm: true,
          user_metadata: {
            full_name: fullName,
          }
        }
      );

      if (updateError) {
        console.error('Error updating existing user:', updateError);
        return new Response(
          JSON.stringify({ success: false, error: updateError.message }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
        );
      }
    } else {
      // Create new user account
      const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        user_metadata: {
          full_name: fullName,
        },
        email_confirm: true
      });

      if (authError) {
        console.error('Error creating user:', authError);
        return new Response(
          JSON.stringify({ success: false, error: authError.message }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
        );
      }

      console.log('User created successfully:', authData.user.id);
      userId = authData.user.id;
    }

    // Check if user is already a member of the restaurant
    const { data: existingMembership } = await supabaseAdmin
      .from('user_restaurants')
      .select('*')
      .eq('user_id', userId)
      .eq('restaurant_id', invitation.restaurant_id)
      .single();

    if (!existingMembership) {
      // Add user to restaurant
      const { error: membershipError } = await supabaseAdmin
        .from('user_restaurants')
        .insert({
          user_id: userId,
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
        accepted_by: userId,
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