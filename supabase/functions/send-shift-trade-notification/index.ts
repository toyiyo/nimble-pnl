import { generateHeader, formatDateTime } from '../_shared/emailTemplates.ts';
import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@4.0.0";
import { sendWebPushToUser, sendWebPushToUsers } from '../_shared/webPushHelper.ts';
import { selectBroadcastPushUserIds } from '../_shared/webPushFanout.ts';
import { resolveCreatedTradeEmailRecipients, type DirectedTarget } from '../_shared/tradeEmailAudience.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Single source of truth for the in-app deep link every shift-trade notification (email
// button, FCM data.route, and both web-push payloads) points at.
const EMPLOYEE_SHIFTS_ROUTE = '/employee/shifts';

interface RequestBody {
  tradeId: string;
  action: 'created' | 'accepted' | 'approved' | 'rejected' | 'cancelled';
}

const ACTION_CONTENT: Record<RequestBody['action'], {
  subject: (employeeName?: string) => string;
  heading: string;
  statusColor: string;
  statusText: string;
  message: (employeeName?: string, shiftDetails?: string) => string;
}> = {
  created: {
    subject: (employeeName) => `New Shift Trade Available from ${employeeName ?? 'Employee'}`,
    heading: 'New Shift Available for Trade',
    statusColor: '#3b82f6',
    statusText: 'Available',
    message: (employeeName, shiftDetails) => `${employeeName ?? 'An employee'} has posted a shift available for trade${shiftDetails ? `: ${shiftDetails}` : ''}.`,
  },
  accepted: {
    subject: () => 'Shift Trade Request Pending Approval',
    heading: 'Shift Trade Pending Approval',
    statusColor: '#f59e0b',
    statusText: 'Pending Approval',
    message: (employeeName, shiftDetails) => `${employeeName ?? 'An employee'} has accepted a shift trade request${shiftDetails ? ` for ${shiftDetails}` : ''}. Manager approval required.`,
  },
  approved: {
    subject: () => 'Shift Trade Approved',
    heading: 'Your Shift Trade Has Been Approved',
    statusColor: '#10b981',
    statusText: 'Approved',
    message: (_, shiftDetails) => `Your shift trade has been approved by management. ${shiftDetails ? `The shift (${shiftDetails}) has been reassigned.` : 'The shift has been reassigned.'}`,
  },
  rejected: {
    subject: () => 'Shift Trade Rejected',
    heading: 'Shift Trade Request Rejected',
    statusColor: '#ef4444',
    statusText: 'Rejected',
    message: (_, shiftDetails) => `A shift trade request has been rejected by management${shiftDetails ? ` for ${shiftDetails}` : ''}.`,
  },
  cancelled: {
    subject: () => 'Shift Trade Cancelled',
    heading: 'Shift Trade Has Been Cancelled',
    statusColor: '#6b7280',
    statusText: 'Cancelled',
    message: (employeeName, shiftDetails) => `${employeeName ?? 'The employee'} has cancelled their shift trade request${shiftDetails ? ` for ${shiftDetails}` : ''}.`,
  },
};

const buildEmails = async (
  supabase: SupabaseClient,
  restaurantId: string,
  action: RequestBody['action'],
  offeredByEmployeeEmail?: string,
  acceptedByEmployeeEmail?: string,
  directedTarget: DirectedTarget | null = null
) => {
  const emails: string[] = [];

  // Notify based on action
  if (action === 'created') {
    // Notify all active employees about new marketplace trade — but only for OPEN trades.
    // A DIRECTED trade (target_employee_id set) is private to its target, so skip this
    // broadcast query entirely and resolve recipients from directedTarget instead.
    let broadcastEmails: string[] = [];
    if (!directedTarget) {
      const { data: employees } = await supabase
        .from('employees')
        .select('email')
        .eq('restaurant_id', restaurantId)
        .eq('is_active', true)
        .not('email', 'is', null);

      if (employees) {
        broadcastEmails = employees
          .map((emp: { email: string | null }) => emp.email)
          .filter((email: string | null): email is string => !!email);
      }
    }
    emails.push(...resolveCreatedTradeEmailRecipients(directedTarget, broadcastEmails));
  } else if (action === 'accepted') {
    // Notify managers about pending approval
    const { data: managers } = await supabase
      .from('user_restaurants')
      .select('user_id')
      .eq('restaurant_id', restaurantId)
      .in('role', ['owner', 'manager']);

    if (managers && managers.length > 0) {
      const managerUserIds = managers.map((m: { user_id: string }) => m.user_id);
      const { data: managerProfiles } = await supabase
        .from('profiles')
        .select('email')
        .in('user_id', managerUserIds);
      
      if (managerProfiles) {
        managerProfiles.forEach((profile: { email: string | null }) => {
          if (profile.email) emails.push(profile.email);
        });
      }
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

// HTML escape function to prevent XSS
const escapeHtml = (str: string): string => {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
};

const generateEmailHtml = (
  content: typeof ACTION_CONTENT[keyof typeof ACTION_CONTENT],
  employeeName: string,
  shiftDetails: { startTime: string; endTime: string; position: string } | null,
  restaurantName: string,
  managerNote?: string
) => {
  // Escape all user-provided content
  const safeEmployeeName = escapeHtml(employeeName);
  const safeRestaurantName = escapeHtml(restaurantName);
  const safeManagerNote = managerNote ? escapeHtml(managerNote) : undefined;
  
  const appUrl = "https://app.easyshifthq.com/employee/shifts";
  
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(content.subject(safeEmployeeName))}</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f3f4f6;">
  <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #ffffff;">
    ${generateHeader()}
    
    <!-- Content -->
    <div style="padding: 40px 32px; background-color: #ffffff;">
      <h1 style="color: #1f2937; font-size: 24px; font-weight: 600; margin: 0 0 16px 0; line-height: 1.3;">${escapeHtml(content.heading)}</h1>
      
      <!-- Status Badge -->
      <div style="margin-bottom: 24px;">
        <span style="background-color: ${content.statusColor}; color: white; padding: 6px 14px; border-radius: 6px; font-size: 14px; font-weight: 600;">${content.statusText}</span>
      </div>
      
      <p style="color: #4b5563; line-height: 1.6; font-size: 16px; margin: 0 0 24px 0;">
        ${content.message(safeEmployeeName, shiftDetails ? `${escapeHtml(shiftDetails.position)}` : undefined)}
      </p>
      
      ${shiftDetails ? `
      <!-- Shift Details Card -->
      <div style="background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%); padding: 24px; border-radius: 12px; margin: 24px 0; border-left: 4px solid #10b981;">
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 6px 0; color: #4b5563; font-size: 14px; font-weight: 600;">Restaurant:</td>
            <td style="padding: 6px 0; color: #1f2937; font-size: 14px; text-align: right;">${safeRestaurantName}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #4b5563; font-size: 14px; font-weight: 600;">Position:</td>
            <td style="padding: 6px 0; color: #1f2937; font-size: 14px; text-align: right;">${escapeHtml(shiftDetails.position)}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #4b5563; font-size: 14px; font-weight: 600;">Start:</td>
            <td style="padding: 6px 0; color: #1f2937; font-size: 14px; text-align: right;">${escapeHtml(shiftDetails.startTime)}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #4b5563; font-size: 14px; font-weight: 600;">End:</td>
            <td style="padding: 6px 0; color: #1f2937; font-size: 14px; text-align: right;">${escapeHtml(shiftDetails.endTime)}</td>
          </tr>
        </table>
      </div>
      ` : ''}
      
      ${safeManagerNote ? `
      <!-- Manager Note -->
      <div style="background-color: #fef3c7; border-left: 4px solid #f59e0b; border-radius: 4px; padding: 16px; margin: 24px 0;">
        <p style="margin: 0 0 8px; color: #92400e; font-size: 14px; font-weight: 600;">
          Manager Note:
        </p>
        <p style="margin: 0; color: #78350f; font-size: 14px; line-height: 1.5;">
          ${safeManagerNote}
        </p>
      </div>
      ` : ''}
      
      <div style="text-align: center; margin: 32px 0;">
        <a href="${appUrl}" 
           style="background-color: #059669; background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: #ffffff !important; padding: 14px 32px; text-decoration: none; border-radius: 8px; display: inline-block; font-weight: 600; font-size: 16px; box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3); mso-padding-alt: 14px 32px; border: 2px solid #059669;">
          <span style="color: #ffffff !important;">View Available Trades</span>
        </a>
      </div>
      
      <p style="color: #6b7280; font-size: 14px; margin: 32px 0 0 0; line-height: 1.6;">
        If you have any questions about shift trades, please contact your manager.
      </p>
    </div>
    
    <!-- Footer -->
    <div style="background-color: #f9fafb; padding: 24px 32px; border-radius: 0 0 8px 8px; border-top: 1px solid #e5e7eb;">
      <p style="color: #6b7280; font-size: 13px; text-align: center; margin: 0; line-height: 1.5;">
        <strong style="color: #4b5563;">EasyShiftHQ</strong><br>
        Restaurant Operations Management System
      </p>
      <p style="color: #9ca3af; font-size: 12px; text-align: center; margin: 12px 0 0 0;">
        © ${new Date().getFullYear()} EasyShiftHQ. All rights reserved.
      </p>
      <p style="color: #9ca3af; font-size: 12px; text-align: center; margin: 8px 0 0 0;">
        This is an automated notification. Please do not reply to this email.
      </p>
    </div>
  </div>
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
    // Bare service-role client (no Authorization override) for data/notification reads —
    // the JWT-scoped `supabase` client above runs every `.from()` as the caller
    // (`authenticated`), which silently no-ops against `web_push_subscriptions` RLS
    // (`USING (auth.uid() = user_id)`) for anyone but the caller. `admin` is used for
    // all data access after auth; `supabase` stays limited to `auth.getUser()`.
    const admin = createClient(supabaseUrl, supabaseServiceKey);

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

    console.log(`Processing shift trade notification: tradeId=${tradeId}, action=${action}`);

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
          email,
          user_id
        ),
        accepted_by:employees!accepted_by_employee_id(
          name,
          email,
          user_id
        ),
        restaurant:restaurants(
          name,
          timezone
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

    // Caller authorization: any authenticated user could otherwise POST an arbitrary
    // tradeId and trigger notifications (including the broadcast) for a restaurant
    // they have no membership in. Verify the caller belongs to this trade's restaurant.
    const { data: membership, error: membershipError } = await admin
      .from('user_restaurants')
      .select('role')
      .eq('user_id', user.id)
      .eq('restaurant_id', trade.restaurant_id)
      .maybeSingle();
    if (membershipError) {
      // Distinguish a transient DB failure from a genuine "not a member" so auth
      // failures caused by an infra hiccup are auditable, not silently indistinguishable
      // from a real 403.
      console.error('Error checking caller membership:', membershipError);
    }
    if (!membership) {
      return new Response(
        JSON.stringify({ error: 'Forbidden' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Build shift details object
    const shift = trade.offered_shift;
    // Matches the `restaurants.timezone` column default and Clover/Shift4 fallback.
    const restaurantTimezone = trade.restaurant?.timezone || 'America/Chicago';
    const shiftDetails = shift
      ? {
          startTime: formatDateTime(shift.start_time, restaurantTimezone),
          endTime: formatDateTime(shift.end_time, restaurantTimezone),
          position: shift.position
        }
      : null;

    const restaurantName = trade.restaurant?.name || 'Your Restaurant';
    const offeredByName = trade.offered_by?.name || 'Employee';
    const acceptedByName = trade.accepted_by?.name || '';

    // Resolve the directed-trade email target (if any) via `admin` — reading under RLS with
    // the JWT-scoped `supabase` client can silently return zero rows for another employee's
    // row. Deliberately omits `.eq('is_active', true)`: a directed trade should still notify
    // its target even if a race deactivated them — this intentionally mirrors the directed-
    // trade target lookup in the push block below (no `is_active` filter there either) so the
    // two stay in parity.
    let directedTarget: DirectedTarget | null = null;
    if (action === 'created' && trade.target_employee_id) {
      const { data: t, error: targetErr } = await admin
        .from('employees')
        .select('email')
        .eq('id', trade.target_employee_id)
        .eq('restaurant_id', trade.restaurant_id)
        .maybeSingle();
      if (targetErr) {
        console.error('Error resolving directed-trade email target:', targetErr);
      }
      directedTarget = { email: t?.email ?? null };
    }

    // Determine recipients based on action
    const recipients = await buildEmails(
      supabase,
      trade.restaurant_id,
      action,
      trade.offered_by?.email,
      trade.accepted_by?.email,
      directedTarget
    );

    if (recipients.length === 0) {
      console.warn('No recipients found for notification');
      return new Response(
        JSON.stringify({ success: true, message: 'No recipients to notify' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Sending shift trade notification to ${recipients.length} recipients`);

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
      from: 'EasyShiftHQ <notifications@easyshifthq.com>',
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

    console.log(`Successfully sent shift trade notification: emailId=${emailData?.id}`);

    // Send push notifications to the relevant employees based on action
    const pushUserIds: string[] = [];

    if (action === 'created') {
      // Push on a newly-offered trade. A DIRECTED trade ("Specific Coworker",
      // target_employee_id set) is visible only to its target under RLS + the
      // marketplace filter — so it must push ONLY that employee, never the whole
      // team, or we'd leak/noise a private offer. An OPEN marketplace trade
      // (target_employee_id null) broadcasts to active employees, minus the poster.
      // Bulk fan-out (single subscription lookup + bounded concurrency). Email
      // recipients above are unaffected; this only adds the push channel. The
      // whole block is wrapped so a failure at any step degrades to a logged,
      // skipped push instead of turning the already-sent email into a false 500.
      try {
        let broadcastTargets: string[];
        if (trade.target_employee_id) {
          const { data: targetEmployee, error: targetError } = await admin
            .from('employees')
            .select('user_id')
            .eq('id', trade.target_employee_id)
            .eq('restaurant_id', trade.restaurant_id)
            .maybeSingle();
          if (targetError) {
            console.error('Error fetching directed-trade target for push:', targetError);
          }
          broadcastTargets = selectBroadcastPushUserIds(
            targetEmployee ? [targetEmployee] : [],
            trade.offered_by?.user_id,
          );
        } else {
          const { data: activeEmployees, error: employeesError } = await admin
            .from('employees')
            .select('user_id')
            .eq('restaurant_id', trade.restaurant_id)
            .eq('is_active', true)
            .not('user_id', 'is', null);
          if (employeesError) {
            console.error('Error fetching active employees for broadcast push:', employeesError);
          }
          broadcastTargets = selectBroadcastPushUserIds(activeEmployees ?? [], trade.offered_by?.user_id);
        }
        await sendWebPushToUsers(admin, broadcastTargets, trade.restaurant_id, {
          title: content.heading,
          body: 'A teammate offered a shift for trade. Tap to view.',
          url: EMPLOYEE_SHIFTS_ROUTE,
          tag: `trade-created-${tradeId}`,
        });
      } catch (e) {
        console.error('Broadcast web push failed:', e);
      }
    } else if (action === 'accepted') {
      // Notify the employee who offered the shift
      if (trade.offered_by?.user_id) pushUserIds.push(trade.offered_by.user_id);
    } else if (action === 'approved' || action === 'rejected') {
      // Notify both involved employees
      if (trade.offered_by?.user_id) pushUserIds.push(trade.offered_by.user_id);
      if (trade.accepted_by?.user_id) pushUserIds.push(trade.accepted_by.user_id);
    } else if (action === 'cancelled') {
      // Notify the employee who had accepted
      if (trade.accepted_by?.user_id) pushUserIds.push(trade.accepted_by.user_id);
    }

    for (const userId of [...new Set(pushUserIds)]) {
      try {
        await fetch(`${supabaseUrl}/functions/v1/send-push-notification`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${supabaseServiceKey}`,
          },
          body: JSON.stringify({
            user_id: userId,
            title: 'Shift Trade Request',
            body: 'Someone wants to trade a shift with you',
            data: { route: EMPLOYEE_SHIFTS_ROUTE },
          }),
        });
      } catch (e) {
        console.error('Push notification failed:', e);
      }

      try {
        await sendWebPushToUser(admin, userId, trade.restaurant_id, {
          title: 'Shift Trade Update',
          body: content.subject(employeeName),
          url: EMPLOYEE_SHIFTS_ROUTE,
          tag: `trade-${action}-${tradeId}`,
        });
      } catch (e) {
        console.error('Web push failed:', e);
      }
    }

    return new Response(
      JSON.stringify({ success: true, emailId: emailData?.id, recipients }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    console.error('Unexpected error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
};

serve(handler);
