import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@4.0.0";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RequestBody {
  restaurantId: string;
  email: string;
  role: string;
  employeeId?: string; // Optional employee ID to link when role is "staff"
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

    const { restaurantId, email, role, employeeId }: RequestBody = await req.json();

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

    // Cancel any existing pending invitations for this email and restaurant
    await supabase
      .from('invitations')
      .update({ status: 'cancelled', updated_at: new Date() })
      .eq('email', email)
      .eq('restaurant_id', restaurantId)
      .eq('status', 'pending');

    // Generate secure invitation token
    const tokenBytes = new Uint8Array(32);
    crypto.getRandomValues(tokenBytes);
    const invitationToken = Array.from(tokenBytes, byte => byte.toString(16).padStart(2, '0')).join('');
    
    // Hash the token using Web Crypto API (available in Deno)
    const encoder = new TextEncoder();
    const data = encoder.encode(invitationToken);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashedToken = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    
    console.log('Token hashed successfully with Web Crypto API');
    
    // Store invitation with hashed token in database
    const invitationData: any = {
      restaurant_id: restaurantId,
      invited_by: user.id,
      email,
      role,
      token: hashedToken,
      status: 'pending',
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
    };

    // If employeeId is provided (for staff role), include it in the invitation
    if (employeeId && role === 'staff') {
      invitationData.employee_id = employeeId;
    }

    const { data: invitation, error: invitationError } = await supabase
      .from('invitations')
      .insert(invitationData)
      .select()
      .single();

    if (invitationError) {
      throw invitationError;
    }

    console.log('Team invitation stored:', invitation);

    // Create invitation acceptance URL
    const invitationUrl = `https://app.easyshifthq.com/accept-invitation?token=${invitationToken}`;

    // Send invitation email
    try {
      const emailResponse = await resend.emails.send({
        from: "Restaurant Team <team@easyshifthq.com>",
        to: [email],
        subject: `You're invited to join ${restaurant.name}`,
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff;">
            <!-- Header with Logo -->
            <div style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); padding: 32px 24px; text-align: center; border-radius: 8px 8px 0 0;">
              <div style="display: inline-flex; align-items: center; justify-content: center; background: rgba(255, 255, 255, 0.95); border-radius: 12px; padding: 12px 20px; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);">
                <div style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); border-radius: 8px; padding: 8px; display: inline-block; margin-right: 12px;">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M9 11l3 3L22 4"></path>
                    <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path>
                  </svg>
                </div>
                <span style="font-size: 20px; font-weight: 700; color: #1f2937; letter-spacing: -0.5px;">EasyShiftHQ</span>
              </div>
            </div>
            
            <!-- Content -->
            <div style="padding: 40px 32px; background: #ffffff;">
              <h1 style="color: #1f2937; font-size: 24px; font-weight: 600; margin: 0 0 16px 0; line-height: 1.3;">You're invited to join ${restaurant.name}</h1>
              
              <p style="color: #6b7280; line-height: 1.6; font-size: 16px; margin: 0 0 24px 0;">
                You've been invited to join <strong style="color: #1f2937;">${restaurant.name}</strong> as a <strong style="color: #1f2937;">${role}</strong> on EasyShiftHQ.
              </p>
              
              <div style="background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%); padding: 24px; border-radius: 12px; margin: 24px 0; border-left: 4px solid #10b981;">
                <table style="width: 100%; border-collapse: collapse;">
                  <tr>
                    <td style="padding: 6px 0; color: #6b7280; font-size: 14px; font-weight: 600;">Restaurant:</td>
                    <td style="padding: 6px 0; color: #1f2937; font-size: 14px; text-align: right;">${restaurant.name}</td>
                  </tr>
                  <tr>
                    <td style="padding: 6px 0; color: #6b7280; font-size: 14px; font-weight: 600;">Role:</td>
                    <td style="padding: 6px 0; color: #1f2937; font-size: 14px; text-align: right;">${role}</td>
                  </tr>
                  <tr>
                    <td style="padding: 6px 0; color: #6b7280; font-size: 14px; font-weight: 600;">Expires:</td>
                    <td style="padding: 6px 0; color: #1f2937; font-size: 14px; text-align: right;">${new Date(invitation.expires_at).toLocaleDateString()}</td>
                  </tr>
                </table>
              </div>
              
              <div style="text-align: center; margin: 32px 0;">
                <a href="${invitationUrl}" 
                   style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white; padding: 14px 32px; text-decoration: none; border-radius: 8px; display: inline-block; font-weight: 600; font-size: 16px; box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3); transition: all 0.2s;">
                  Accept Invitation
                </a>
              </div>
              
              <p style="color: #9ca3af; font-size: 14px; margin: 32px 0 0 0; line-height: 1.6;">
                This invitation will expire in 7 days. If you didn't expect this invitation, you can safely ignore this email.
              </p>
            </div>
            
            <!-- Footer -->
            <div style="background: #f9fafb; padding: 24px 32px; border-radius: 0 0 8px 8px; border-top: 1px solid #e5e7eb;">
              <p style="color: #9ca3af; font-size: 13px; text-align: center; margin: 0; line-height: 1.5;">
                <strong style="color: #6b7280;">EasyShiftHQ</strong><br>
                Restaurant Operations Management System
              </p>
              <p style="color: #d1d5db; font-size: 12px; text-align: center; margin: 12px 0 0 0;">
                © ${new Date().getFullYear()} EasyShiftHQ. All rights reserved.
              </p>
            </div>
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