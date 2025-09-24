import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "npm:resend@2.0.0";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

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

    // Get current user info using the user client
    const { data: { user }, error: authError } = await userSupabase.auth.getUser();
    if (authError || !user) {
      console.error('Auth error:', authError);
      throw new Error('Unauthorized');
    }

    // Check if user has permission to invite (owner or manager)
    const { data: userRole, error: roleError } = await userSupabase
      .from('user_restaurants')
      .select('role')
      .eq('restaurant_id', restaurantId)
      .eq('user_id', user.id)
      .single();

    if (roleError || !userRole || !['owner', 'manager'].includes(userRole.role)) {
      throw new Error('Insufficient permissions to send invitations');
    }

    // Generate secure invitation token
    const tokenBytes = new Uint8Array(32);
    crypto.getRandomValues(tokenBytes);
    const invitationToken = Array.from(tokenBytes, byte => byte.toString(16).padStart(2, '0')).join('');
    
    // Store invitation in database
    const { data: invitation, error: invitationError } = await supabase
      .from('invitations')
      .insert({
        restaurant_id: restaurantId,
        invited_by: user.id,
        email,
        role,
        token: invitationToken,
        status: 'pending',
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      })
      .select()
      .single();

    if (invitationError) {
      if (invitationError.code === '23505') { // Unique violation
        throw new Error('An invitation is already pending for this email address');
      }
      throw invitationError;
    }

    console.log('Team invitation stored:', invitation);

    // Create invitation acceptance URL using the request origin
    const origin = req.headers.get('origin') || req.headers.get('referer')?.split('/').slice(0, 3).join('/') || 'https://app.easyshifthq.com';
    const invitationUrl = `${origin}/accept-invitation?token=${invitationToken}`;

    // Send invitation email
    try {
      const emailResponse = await resend.emails.send({
        from: "Restaurant Team <team@easyshifthq.com>",
        to: [email],
        subject: `You're invited to join ${restaurant.name}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h1 style="color: #333; margin-bottom: 20px;">You're invited to join ${restaurant.name}</h1>
            
            <p style="color: #666; line-height: 1.6;">
              You've been invited to join <strong>${restaurant.name}</strong> as a <strong>${role}</strong>.
            </p>
            
            <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
              <p style="margin: 0; color: #333;">
                <strong>Restaurant:</strong> ${restaurant.name}<br>
                <strong>Role:</strong> ${role}<br>
                <strong>Expires:</strong> ${new Date(invitation.expires_at).toLocaleDateString()}
              </p>
            </div>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="${invitationUrl}" 
                 style="background: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
                Accept Invitation
              </a>
            </div>
            
            <p style="color: #999; font-size: 14px; margin-top: 30px;">
              This invitation will expire in 7 days. If you didn't expect this invitation, you can safely ignore this email.
            </p>
            
            <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
            <p style="color: #999; font-size: 12px; text-align: center;">
              Restaurant Operations Management System
            </p>
          </div>
        `,
      });

      console.log("Invitation email sent successfully:", emailResponse);
    } catch (emailError) {
      console.error("Failed to send invitation email:", emailError);
      // Don't fail the entire request if email fails - invitation is still created
    }
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