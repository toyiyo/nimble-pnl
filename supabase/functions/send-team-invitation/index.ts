import { generateHeader } from '../_shared/emailTemplates.ts';
import { resolveAccountlessEmployeeLink, normalizeEmail } from '../_shared/resolveAccountlessEmployeeLink.ts';
import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@4.0.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// MIRRORS src/lib/permissions/invitations.ts — keep in sync (default-deny).
//
// 'collaborator_custom' is deliberately NOT a member of these arrays, exactly
// as it is not a member of the `Role` union client-side. It is not a role, it
// is a *pointer* to one: the actual grant lives in the roles row named by
// `roleId`, so admitting it here would say nothing about what is being
// granted. Whether an inviter may invite one is answered by
// canInviteCustomRole() below, and *which* role they may name is answered by
// the ownership check in the handler.
const INVITABLE_ROLES: Record<string, string[]> = {
  // owner can invite every internal + collaborator role.
  // 'kiosk' is deliberately absent: it is a shared device credential, not a
  // person with an inbox. Kiosk access is provisioned from device setup.
  owner: [
    'owner', 'manager', 'operations_manager', 'chef', 'staff',
    'collaborator_accountant', 'collaborator_inventory', 'collaborator_chef',
    'collaborator_operations_manager',
  ],
  // manager can invite all except owner; collaborators included (separate CollaboratorInvitations UI)
  manager: [
    'manager', 'operations_manager', 'chef', 'staff',
    'collaborator_accountant', 'collaborator_inventory', 'collaborator_chef',
    'collaborator_operations_manager',
  ],
  operations_manager: ['staff'],
};
function canInviteRole(inviter: string, target: string): boolean {
  return (INVITABLE_ROLES[inviter] ?? []).includes(target);
}

// Custom roles are administered by whoever holds manage:collaborators, which
// is owner and manager — the same two roles that may invite the four builtin
// collaborator roles above.
const CUSTOM_ROLE_INVITERS = ['owner', 'manager'];
function canInviteCustomRole(inviter: string): boolean {
  return CUSTOM_ROLE_INVITERS.includes(inviter);
}

const CUSTOM_ROLE = 'collaborator_custom';

interface RequestBody {
  restaurantId: string;
  email: string;
  role: string;
  employeeId?: string; // Optional client hint; server re-resolves for any role (see below)
  // Required when role === 'collaborator_custom', rejected otherwise. Names
  // the roles row whose areas/flags the invitee will receive.
  roleId?: string;
}

const handler = async (req: Request): Promise<Response> => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Initialize Resend with API key check
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    if (!resendApiKey) {
      console.error('RESEND_API_KEY is not set');
      return new Response(
        JSON.stringify({ error: 'Email service not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    const resend = new Resend(resendApiKey);

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Get the authorization header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('Missing authorization header');
    }

    // Extract JWT token from Authorization header
    const token = authHeader.replace('Bearer ', '');

    const { restaurantId, email, role, employeeId, roleId }: RequestBody = await req.json();

    if (!restaurantId || !email || !role) {
      throw new Error('Missing required fields: restaurantId, email, or role');
    }

    // roleId is meaningful only for a custom-role invite. Reject the mismatch
    // in both directions rather than ignoring the field: a caller that sends a
    // role id with role='manager' has misunderstood something, and silently
    // dropping it would store an invitation that grants a different set of
    // capabilities than the caller believes it sent.
    if (role === CUSTOM_ROLE && !roleId) {
      return new Response(
        JSON.stringify({ error: 'role_id_required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }
    if (role !== CUSTOM_ROLE && roleId) {
      return new Response(
        JSON.stringify({ error: 'role_id_not_applicable' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Canonicalize the email ONCE. Everything downstream — the cancel query, the
    // stored invitations.email, employee matching, and the send address — uses
    // this value so they never drift. Storing the raw (mixed-case/whitespace)
    // email would also break acceptance, where GoTrue's already-lowercased
    // user.email is compared against invitations.email.
    const normalizedEmail = normalizeEmail(email);

    console.log('Sending team invitation:', { restaurantId, email: normalizedEmail, role, employeeId });

    // Get restaurant details
    const { data: restaurant, error: restaurantError } = await supabase
      .from('restaurants')
      .select('name')
      .eq('id', restaurantId)
      .single();

    if (restaurantError) {
      throw new Error('Restaurant not found');
    }

    // Get current user info by passing token directly
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      console.error('Auth error:', authError);
      throw new Error('Unauthorized');
    }

    // Check if user has permission to invite (owner or manager)
    const { data: userRole, error: roleError } = await supabase
      .from('user_restaurants')
      .select('role')
      .eq('restaurant_id', restaurantId)
      .eq('user_id', user.id)
      .single();

    if (roleError || !userRole || !INVITABLE_ROLES[userRole.role]) {
      throw new Error('Insufficient permissions to send invitations');
    }

    // Default-deny: reject any (inviter, target) pair not in the matrix
    // BEFORE inserting the invitation row (prevents storing escalated-role invites).
    // A custom-role invite is gated on the inviter instead, then on the named
    // role itself immediately below.
    if (role === CUSTOM_ROLE ? !canInviteCustomRole(userRole.role) : !canInviteRole(userRole.role, role)) {
      return new Response(
        JSON.stringify({ error: 'role_not_allowed' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // For a custom-role invite, the named role must actually be one this
    // restaurant may grant. `supabase` here is the SERVICE-ROLE client, so
    // this SELECT bypasses RLS on `roles` entirely — the check below is not
    // defense in depth, it is the only thing standing between a caller who
    // administers one restaurant and a role id belonging to another tenant.
    // Same reasoning as copy_role_to_restaurants' source gate
    // (20260730160000:66-78).
    //
    // builtin rows are rejected too: a builtin is granted by its legacy role
    // string, not by pointing collaborator_custom at it, and admitting them
    // here would be a second, unvalidated path to roles the invite matrix
    // above deliberately withholds (e.g. a manager naming the Owner builtin).
    let customRoleName: string | null = null;
    if (role === CUSTOM_ROLE) {
      const { data: customRole, error: customRoleError } = await supabase
        .from('roles')
        .select('id, name, restaurant_id, builtin, flavor')
        .eq('id', roleId)
        .maybeSingle();

      if (customRoleError) {
        console.error('Failed to load the invited custom role:', customRoleError);
        throw new Error('Could not verify the selected role');
      }

      // flavor is checked for the same reason the RLS write policies pin it:
      // area_catalog's per-area cap — the guard that stops a custom role from
      // holding Team & Access — only applies to collaborator-flavored roles.
      // A platform-flavored row is not something the write policies admit, so
      // this is the belt to that suspenders, not a second gate.
      if (
        !customRole ||
        customRole.builtin ||
        customRole.flavor !== 'collaborator' ||
        customRole.restaurant_id !== restaurantId
      ) {
        // One undifferentiated response for "no such role", "that's a builtin"
        // and "that role belongs to someone else", so this endpoint cannot be
        // used to probe which role ids exist in other restaurants.
        return new Response(
          JSON.stringify({ error: 'role_not_allowed' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }

      customRoleName = customRole.name;
    }

    // Cancel any existing pending invitations for this email and restaurant
    await supabase
      .from('invitations')
      .update({ status: 'cancelled', updated_at: new Date() })
      .eq('email', normalizedEmail)
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
    const invitationData: {
      restaurant_id: string;
      invited_by: string;
      email: string;
      role: string;
      token: string;
      status: string;
      expires_at: Date;
      employee_id?: string;
      role_id?: string;
    } = {
      restaurant_id: restaurantId,
      invited_by: user.id,
      email: normalizedEmail,
      role,
      token: hashedToken,
      status: 'pending',
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
    };

    // Only set for a custom-role invite — every builtin invitation leaves
    // role_id NULL and keeps resolving from the role string exactly as before.
    if (role === CUSTOM_ROLE) {
      invitationData.role_id = roleId;
    }

    // Resolve employee_id server-side — for ANY invitable role, not just staff.
    // Restaurant-scoped fetch of accountless active employees (no enumeration
    // oracle; mirrors src/hooks/useAccountlessEmployees.ts). Fetched once and
    // reused for both the client-hint check and the email fallback.
    const { data: accountlessEmployees, error: accountlessError } = await supabase
      .from('employees')
      .select('id, name, email')
      .eq('restaurant_id', restaurantId)
      .is('user_id', null)
      .eq('status', 'active');

    if (accountlessError) {
      // Fail open: never block sending the invitation over this lookup.
      console.error('Failed to fetch accountless employees for linking:', accountlessError);
    }

    // Deterministic resolution (see resolveAccountlessEmployeeLink): a client
    // hint is trusted only if it is an email-matched accountless row, and when
    // multiple active employees share the invited email we link nothing rather
    // than pick an arbitrary row from PostgREST's undefined ordering.
    const link = resolveAccountlessEmployeeLink(accountlessEmployees, normalizedEmail, employeeId);
    if (link.ambiguous) {
      console.warn(
        `Ambiguous accountless-employee link in restaurant ${restaurantId}: ` +
        `multiple active employees share this email and no client hint disambiguated — sending without a link.`,
      );
    }
    if (link.employeeId) {
      invitationData.employee_id = link.employeeId;
    }

    const { data: invitation, error: invitationError } = await supabase
      .from('invitations')
      .insert(invitationData)
      .select()
      .single();

    if (invitationError) {
      throw invitationError;
    }

    console.log('Team invitation stored:', { 
      id: invitation.id, 
      email: invitation.email, 
      role: invitation.role,
      employee_id: invitation.employee_id 
    });

    // Create invitation acceptance URL
    const invitationUrl = `https://app.easyshifthq.com/accept-invitation?token=${invitationToken}`;

    // Get friendly role label for email
    const roleLabels: Record<string, string> = {
      'owner': 'Owner',
      'manager': 'Manager',
      'operations_manager': 'Operations Manager',
      'chef': 'Chef',
      'staff': 'Staff Member',
      'kiosk': 'Kiosk',
      'collaborator_accountant': 'Accountant',
      'collaborator_inventory': 'Inventory Helper',
      'collaborator_chef': 'Recipe Consultant',
      'collaborator_operations_manager': 'Operations Manager (Collaborator)',
    };
    // A custom role has no entry in the static map — its label is the name the
    // owner gave it ("Weekend Supervisor"), which is the only thing that means
    // anything to the person receiving the email.
    const friendlyRole = customRoleName ?? roleLabels[role] ?? role;
    const isCollaborator = role.startsWith('collaborator_');

    // Send invitation email. A team invite is TRANSACTIONAL — the email carries the
    // only copy of the accept link (the token is hashed/unrecoverable server-side),
    // so it is NOT gated by the notification channel matrix (team_invite is
    // deliberately excluded from the catalog) and always sends.
    {
      try {
        const emailResponse = await resend.emails.send({
          from: "EasyShiftHQ <notifications@easyshifthq.com>",
          to: [normalizedEmail],
          subject: isCollaborator
            ? `You're invited to collaborate with ${restaurant.name}`
            : `You're invited to join ${restaurant.name}`,
          html: `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff;">
              ${generateHeader()}

              <!-- Content -->
              <div style="padding: 40px 32px; background: #ffffff;">
                <h1 style="color: #1f2937; font-size: 24px; font-weight: 600; margin: 0 0 16px 0; line-height: 1.3;">${isCollaborator ? `You're invited to collaborate with ${restaurant.name}` : `You're invited to join ${restaurant.name}`}</h1>

                <p style="color: #6b7280; line-height: 1.6; font-size: 16px; margin: 0 0 24px 0;">
                  You've been invited to ${isCollaborator ? 'collaborate with' : 'join'} <strong style="color: #1f2937;">${restaurant.name}</strong> as ${isCollaborator ? 'an' : 'a'} <strong style="color: #1f2937;">${friendlyRole}</strong> on EasyShiftHQ.
                </p>

                <div style="background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%); padding: 24px; border-radius: 12px; margin: 24px 0; border-left: 4px solid #10b981;">
                  <table style="width: 100%; border-collapse: collapse;">
                    <tr>
                      <td style="padding: 6px 0; color: #6b7280; font-size: 14px; font-weight: 600;">Restaurant:</td>
                      <td style="padding: 6px 0; color: #1f2937; font-size: 14px; text-align: right;">${restaurant.name}</td>
                    </tr>
                    <tr>
                      <td style="padding: 6px 0; color: #6b7280; font-size: 14px; font-weight: 600;">Role:</td>
                      <td style="padding: 6px 0; color: #1f2937; font-size: 14px; text-align: right;">${friendlyRole}</td>
                    </tr>
                    <tr>
                      <td style="padding: 6px 0; color: #6b7280; font-size: 14px; font-weight: 600;">Expires:</td>
                      <td style="padding: 6px 0; color: #1f2937; font-size: 14px; text-align: right;">${new Date(invitation.expires_at).toLocaleDateString()}</td>
                    </tr>
                  </table>
                </div>

                <div style="text-align: center; margin: 32px 0;">
                  <a href="${invitationUrl}"
                     style="background-color: #059669; background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: #ffffff !important; padding: 14px 32px; text-decoration: none; border-radius: 8px; display: inline-block; font-weight: 600; font-size: 16px; box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3); mso-padding-alt: 14px 32px; border: 2px solid #059669;">
                    <span style="color: #ffffff !important;">Accept Invitation</span>
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
    }
    return new Response(
      JSON.stringify({
        success: true,
        message: `Invitation sent to ${normalizedEmail}`,
        invitation: {
          id: invitation.id,
          email: normalizedEmail,
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
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error sending team invitation:', error);
    return new Response(
      JSON.stringify({ 
        error: errorMessage,
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