import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@4.0.0";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RequestBody {
  tradeId: string;
  action: 'created' | 'accepted' | 'approved' | 'rejected' | 'cancelled';
}

const ACTION_CONTENT: Record<RequestBody['action'], {
  subject: (employeeName?: string) => string;
  heading: string;
  statusBadge: string;
  message: (employeeName?: string, shiftDetails?: string) => string;
}> = {
  created: {
    subject: (employeeName) => `New Shift Trade Available from ${employeeName ?? 'Employee'}`,
    heading: 'New Shift Trade Posted',
    statusBadge: '<span style="background: #3b82f6; color: white; padding: 4px 12px; border-radius: 6px; font-size: 14px; font-weight: 600;">Available</span>',
    message: (employeeName, shiftDetails) => `${employeeName ?? 'An employee'} has posted a shift available for trade${shiftDetails ? `: ${shiftDetails}` : ''}.`,
  },
  accepted: {
    subject: () => 'Shift Trade Request Pending Approval',
    heading: 'Shift Trade Accepted - Awaiting Manager Approval',
    statusBadge: '<span style="background: #f59e0b; color: white; padding: 4px 12px; border-radius: 6px; font-size: 14px; font-weight: 600;">Pending Approval</span>',
    message: (employeeName, shiftDetails) => `${employeeName ?? 'An employee'} has accepted a shift trade request${shiftDetails ? ` for ${shiftDetails}` : ''}. Manager approval required.`,
  },
  approved: {
    subject: () => 'Shift Trade Approved',
    heading: 'Your Shift Trade Has Been Approved',
    statusBadge: '<span style="background: #10b981; color: white; padding: 4px 12px; border-radius: 6px; font-size: 14px; font-weight: 600;">Approved</span>',
    message: (_, shiftDetails) => `Your shift trade has been approved by management. ${shiftDetails ? `The shift (${shiftDetails}) has been reassigned.` : 'The shift has been reassigned.'}`,
  },
  rejected: {
    subject: () => 'Shift Trade Rejected',
    heading: 'Shift Trade Request Rejected',
    statusBadge: '<span style="background: #ef4444; color: white; padding: 4px 12px; border-radius: 6px; font-size: 14px; font-weight: 600;">Rejected</span>',
    message: (_, shiftDetails) => `A shift trade request has been rejected by management${shiftDetails ? ` for ${shiftDetails}` : ''}.`,
  },
  cancelled: {
    subject: () => 'Shift Trade Cancelled',
    heading: 'Shift Trade Has Been Cancelled',
    statusBadge: '<span style="background: #6b7280; color: white; padding: 4px 12px; border-radius: 6px; font-size: 14px; font-weight: 600;">Cancelled</span>',
    message: (employeeName, shiftDetails) => `${employeeName ?? 'The employee'} has cancelled their shift trade request${shiftDetails ? ` for ${shiftDetails}` : ''}.`,
  },
};

const formatDateTime = (date: string) => new Date(date).toLocaleString('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true
});

const buildEmails = async (
  supabase: any,
  restaurantId: string,
  action: RequestBody['action'],
  offeredByEmployeeEmail?: string,
  acceptedByEmployeeEmail?: string
) => {
  const emails: string[] = [];

  // Notify based on action
  if (action === 'created') {
    // Notify all active employees about new marketplace trade
    const { data: employees } = await supabase
      .from('employees')
      .select('email')
      .eq('restaurant_id', restaurantId)
      .eq('is_active', true)
      .not('email', 'is', null);

    if (employees) {
      employees.forEach((emp: any) => {
        if (emp.email) emails.push(emp.email);
      });
    }
  } else if (action === 'accepted') {
    // Notify managers about pending approval
    const { data: managers } = await supabase
      .from('user_restaurants')
      .select('user:auth.users(email)')
      .eq('restaurant_id', restaurantId)
      .in('role', ['owner', 'manager']);

    if (managers) {
      managers.forEach((manager: any) => {
        if (manager.user?.email) emails.push(manager.user.email);
      });
    }

    // Notify original employee
    if (offeredByEmployeeEmail) emails.push(offeredByEmployeeEmail);
  } else if (action === 'approved') {
    // Notify both employees involved
    if (offeredByEmployeeEmail) emails.push(offeredByEmployeeEmail);
    if (acceptedByEmployeeEmail) emails.push(acceptedByEmployeeEmail);
  } else if (action === 'rejected') {
    // Notify both employees
    if (offeredByEmployeeEmail) emails.push(offeredByEmployeeEmail);
    if (acceptedByEmployeeEmail) emails.push(acceptedByEmployeeEmail);
  } else if (action === 'cancelled') {
    // Notify accepting employee if someone had accepted
    if (acceptedByEmployeeEmail) emails.push(acceptedByEmployeeEmail);
  }

  return [...new Set(emails)];
};

const generateEmailHtml = (
  content: typeof ACTION_CONTENT[keyof typeof ACTION_CONTENT],
  employeeName: string,
  shiftDetails: string,
  restaurantName: string,
  managerNote?: string
) => {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${content.subject(employeeName)}</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f3f4f6;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f3f4f6; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: white; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); overflow: hidden;">
          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 32px 40px; text-align: center;">
              <h1 style="margin: 0; color: white; font-size: 28px; font-weight: 700;">
                ${content.heading}
              </h1>
            </td>
          </tr>
          
          <!-- Content -->
          <tr>
            <td style="padding: 40px;">
              <!-- Status Badge -->
              <div style="text-align: center; margin-bottom: 24px;">
                ${content.statusBadge}
              </div>
              
              <!-- Restaurant Name -->
              <p style="margin: 0 0 24px; color: #6b7280; font-size: 16px; text-align: center;">
                ${restaurantName}
              </p>
              
              <!-- Message -->
              <p style="margin: 0 0 24px; color: #1f2937; font-size: 16px; line-height: 1.6;">
                ${content.message(employeeName, shiftDetails)}
              </p>
              
              <!-- Shift Details Card -->
              <div style="background-color: #f9fafb; border-radius: 8px; padding: 20px; margin: 24px 0;">
                <h3 style="margin: 0 0 12px; color: #374151; font-size: 16px; font-weight: 600;">
                  Shift Details
                </h3>
                <p style="margin: 0; color: #6b7280; font-size: 14px; line-height: 1.6; white-space: pre-wrap;">
                  ${shiftDetails}
                </p>
              </div>
              
              ${managerNote ? `
              <!-- Manager Note -->
              <div style="background-color: #fef3c7; border-left: 4px solid #f59e0b; border-radius: 4px; padding: 16px; margin: 24px 0;">
                <p style="margin: 0 0 8px; color: #92400e; font-size: 14px; font-weight: 600;">
                  Manager Note:
                </p>
                <p style="margin: 0; color: #78350f; font-size: 14px; line-height: 1.5;">
                  ${managerNote}
                </p>
              </div>
              ` : ''}
              
              <!-- CTA Button -->
              <div style="text-align: center; margin-top: 32px;">
                <a href="${Deno.env.get('FRONTEND_URL') || 'https://app.nimblepnl.com'}/schedule" 
                   style="display: inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600; font-size: 16px;">
                  View Schedule
                </a>
              </div>
            </td>
          </tr>
          
          <!-- Footer -->
          <tr>
            <td style="background-color: #f9fafb; padding: 24px 40px; text-align: center; border-top: 1px solid #e5e7eb;">
              <p style="margin: 0 0 8px; color: #6b7280; font-size: 14px;">
                This is an automated notification from Nimble PnL
              </p>
              <p style="margin: 0; color: #9ca3af; font-size: 12px;">
                © ${new Date().getFullYear()} Nimble PnL. All rights reserved.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;
};

const handler = async (req: Request): Promise<Response> => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      global: { headers: { Authorization: authHeader } }
    });

    // Verify user authentication
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Parse request body
    const { tradeId, action }: RequestBody = await req.json();

    if (!tradeId || !action) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: tradeId, action' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch trade details with employee and shift information
    const { data: trade, error: tradeError } = await supabase
      .from('shift_trades')
      .select(`
        *,
        offered_shift:shifts!offered_shift_id(
          start_time,
          end_time,
          position
        ),
        offered_by:employees!offered_by_employee_id(
          name,
          email
        ),
        accepted_by:employees!accepted_by_employee_id(
          name,
          email
        ),
        restaurant:restaurants(
          name
        )
      `)
      .eq('id', tradeId)
      .single();

    if (tradeError || !trade) {
      console.error('Error fetching trade:', tradeError);
      return new Response(
        JSON.stringify({ error: 'Trade not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Build shift details string
    const shift = trade.offered_shift;
    const shiftDetails = shift
      ? `${formatDateTime(shift.start_time)} - ${formatDateTime(shift.end_time)}\nPosition: ${shift.position}`
      : 'Shift details unavailable';

    const restaurantName = trade.restaurant?.name || 'Your Restaurant';
    const offeredByName = trade.offered_by?.name || 'Employee';
    const acceptedByName = trade.accepted_by?.name || '';

    // Determine recipients based on action
    const recipients = await buildEmails(
      supabase,
      trade.restaurant_id,
      action,
      trade.offered_by?.email,
      trade.accepted_by?.email
    );

    if (recipients.length === 0) {
      console.warn('No recipients found for notification');
      return new Response(
        JSON.stringify({ success: true, message: 'No recipients to notify' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get appropriate content for action
    const content = ACTION_CONTENT[action];
    const employeeName = action === 'accepted' ? acceptedByName : offeredByName;

    // Generate email HTML
    const html = generateEmailHtml(
      content,
      employeeName,
      shiftDetails,
      restaurantName,
      trade.manager_note
    );

    // Send emails via Resend
    const { data: emailData, error: emailError } = await resend.emails.send({
      from: 'Nimble PnL <notifications@nimblepnl.com>',
      to: recipients,
      subject: content.subject(employeeName),
      html: html,
    });

    if (emailError) {
      console.error('Error sending email:', emailError);
      return new Response(
        JSON.stringify({ error: 'Failed to send email', details: emailError }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, emailId: emailData?.id, recipients }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Unexpected error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
};

serve(handler);
