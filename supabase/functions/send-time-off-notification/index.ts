import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@4.0.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RequestBody {
  timeOffRequestId: string;
  action: 'created' | 'approved' | 'rejected';
}

const ACTION_CONTENT: Record<RequestBody['action'], {
  subject: (employeeName?: string) => string;
  heading: string;
  statusBadge: string;
  message: (employeeName?: string) => string;
}> = {
  created: {
    subject: (employeeName) => `New Time-Off Request from ${employeeName ?? 'Employee'}`,
    heading: 'New Time-Off Request Submitted',
    statusBadge: '<span style="background: #f59e0b; color: white; padding: 4px 12px; border-radius: 6px; font-size: 14px; font-weight: 600;">Pending</span>',
    message: (employeeName) => `${employeeName ?? 'An employee'} has submitted a new time-off request.`,
  },
  approved: {
    subject: () => 'Time-Off Request Approved',
    heading: 'Your Time-Off Request Has Been Approved',
    statusBadge: '<span style="background: #10b981; color: white; padding: 4px 12px; border-radius: 6px; font-size: 14px; font-weight: 600;">Approved</span>',
    message: () => 'Your time-off request has been approved.',
  },
  rejected: {
    subject: () => 'Time-Off Request Rejected',
    heading: 'Your Time-Off Request Has Been Rejected',
    statusBadge: '<span style="background: #ef4444; color: white; padding: 4px 12px; border-radius: 6px; font-size: 14px; font-weight: 600;">Rejected</span>',
    message: () => 'Your time-off request has been rejected.',
  },
};

const formatDate = (date: string) => new Date(date).toLocaleDateString('en-US', {
  month: 'long',
  day: 'numeric',
  year: 'numeric'
});

// Use a type alias for the Supabase client that's more permissive
type SupabaseClient = ReturnType<typeof createClient>;

const buildEmails = async (
  supabase: SupabaseClient,
  restaurantId: string,
  employeeEmail?: string,
  notifyEmployee?: boolean,
  notifyManagers?: boolean
) => {
  const emails: string[] = [];

  if (notifyEmployee && employeeEmail) {
    emails.push(employeeEmail);
  }

  if (notifyManagers) {
    const { data: managers, error: managersError } = await supabase
      .from('user_restaurants')
      .select(`
        user:auth.users(email)
      `)
      .eq('restaurant_id', restaurantId)
      .in('role', ['owner', 'manager']);

    if (!managersError && managers) {
      managers.forEach((manager: { user?: { email?: string } | null } | null) => {
        if (manager?.user?.email) {
          emails.push(manager.user.email);
        }
      });
    }
  }

  return [...new Set(emails)];
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

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { timeOffRequestId, action }: RequestBody = await req.json();

    if (!timeOffRequestId || !action) {
      throw new Error('Missing required fields: timeOffRequestId or action');
    }

    console.log('Processing time-off notification:', { timeOffRequestId, action });

    const { data: timeOffRequest, error: requestError } = await supabase
      .from('time_off_requests')
      .select(`
        *,
        employee:employees(
          id,
          name,
          email
        )
      `)
      .eq('id', timeOffRequestId)
      .single();

    if (requestError || !timeOffRequest) {
      throw new Error('Time-off request not found');
    }

    const { data: restaurant, error: restaurantError } = await supabase
      .from('restaurants')
      .select('name')
      .eq('id', timeOffRequest.restaurant_id)
      .single();

    if (restaurantError) {
      throw new Error('Restaurant not found');
    }

    const { data: notificationSettings } = await supabase
      .from('notification_settings')
      .select('*')
      .eq('restaurant_id', timeOffRequest.restaurant_id)
      .single();

    const settings = notificationSettings || {
      notify_time_off_request: true,
      notify_time_off_approved: true,
      notify_time_off_rejected: true,
      time_off_notify_managers: true,
      time_off_notify_employee: true,
    };

    const shouldNotify =
      (action === 'created' && settings.notify_time_off_request) ||
      (action === 'approved' && settings.notify_time_off_approved) ||
      (action === 'rejected' && settings.notify_time_off_rejected);

    if (!shouldNotify) {
      console.log('Notification disabled for action:', action);
      return new Response(
        JSON.stringify({
          success: true,
          message: 'Notification disabled by settings'
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        }
      );
    }

    const uniqueEmails = await buildEmails(
      supabase,
      timeOffRequest.restaurant_id,
      timeOffRequest.employee?.email,
      settings.time_off_notify_employee,
      settings.time_off_notify_managers
    );

    if (uniqueEmails.length === 0) {
      console.log('No recipients found for notification');
      return new Response(
        JSON.stringify({
          success: true,
          message: 'No recipients configured'
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        }
      );
    }

    const startDate = formatDate(timeOffRequest.start_date);
    const endDate = formatDate(timeOffRequest.end_date);

    const { subject, heading, statusBadge, message } = ACTION_CONTENT[action];
    const emailSubject = subject(timeOffRequest.employee?.name);
    const emailMessage = message(timeOffRequest.employee?.name);

    // Send notification emails
    try {
      const emailPromises = uniqueEmails.map(email => 
        resend.emails.send({
          from: "EasyShiftHQ <notifications@easyshifthq.com>",
          to: [email],
          subject: `${emailSubject} - ${restaurant.name}`,
          html: `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff;">
              <!-- Header with Logo -->
              <div style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); padding: 32px 24px; text-align: center; border-radius: 8px 8px 0 0;">
                <div style="display: inline-flex; align-items: center; justify-content: center; background: rgba(255, 255, 255, 0.95); border-radius: 12px; padding: 12px 20px; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);">
                  <div style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); border-radius: 8px; padding: 8px; display: inline-block; margin-right: 12px;">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                      <line x1="16" y1="2" x2="16" y2="6"></line>
                      <line x1="8" y1="2" x2="8" y2="6"></line>
                      <line x1="3" y1="10" x2="21" y2="10"></line>
                    </svg>
                  </div>
                  <span style="font-size: 20px; font-weight: 700; color: #1f2937; letter-spacing: -0.5px;">EasyShiftHQ</span>
                </div>
              </div>
              
              <!-- Content -->
              <div style="padding: 40px 32px; background: #ffffff;">
                <div style="text-align: center; margin-bottom: 24px;">
                  ${statusBadge}
                </div>
                
                <h1 style="color: #1f2937; font-size: 24px; font-weight: 600; margin: 0 0 16px 0; line-height: 1.3; text-align: center;">${heading}</h1>
                
                <p style="color: #6b7280; line-height: 1.6; font-size: 16px; margin: 0 0 24px 0; text-align: center;">
                  ${emailMessage}
                </p>
                
                <div style="background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%); padding: 24px; border-radius: 12px; margin: 24px 0; border-left: 4px solid #10b981;">
                  <table style="width: 100%; border-collapse: collapse;">
                    <tr>
                      <td style="padding: 6px 0; color: #6b7280; font-size: 14px; font-weight: 600;">Restaurant:</td>
                      <td style="padding: 6px 0; color: #1f2937; font-size: 14px; text-align: right;">${restaurant.name}</td>
                    </tr>
                    <tr>
                      <td style="padding: 6px 0; color: #6b7280; font-size: 14px; font-weight: 600;">Employee:</td>
                      <td style="padding: 6px 0; color: #1f2937; font-size: 14px; text-align: right;">${timeOffRequest.employee?.name || 'Unknown'}</td>
                    </tr>
                    <tr>
                      <td style="padding: 6px 0; color: #6b7280; font-size: 14px; font-weight: 600;">Start Date:</td>
                      <td style="padding: 6px 0; color: #1f2937; font-size: 14px; text-align: right;">${startDate}</td>
                    </tr>
                    <tr>
                      <td style="padding: 6px 0; color: #6b7280; font-size: 14px; font-weight: 600;">End Date:</td>
                      <td style="padding: 6px 0; color: #1f2937; font-size: 14px; text-align: right;">${endDate}</td>
                    </tr>
                    ${timeOffRequest.reason ? `
                    <tr>
                      <td style="padding: 6px 0; color: #6b7280; font-size: 14px; font-weight: 600;">Reason:</td>
                      <td style="padding: 6px 0; color: #1f2937; font-size: 14px; text-align: right;">${timeOffRequest.reason}</td>
                    </tr>
                    ` : ''}
                  </table>
                </div>
                
                <div style="text-align: center; margin: 32px 0;">
                  <a href="https://app.easyshifthq.com/scheduling" 
                     style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white; padding: 14px 32px; text-decoration: none; border-radius: 8px; display: inline-block; font-weight: 600; font-size: 16px; box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3); transition: all 0.2s;">
                    View Time-Off Requests
                  </a>
                </div>
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
        })
      );

      const results = await Promise.all(emailPromises);
      console.log(`Sent ${results.length} notification emails`);

      return new Response(
        JSON.stringify({ 
          success: true,
          message: `Notifications sent to ${uniqueEmails.length} recipient(s)`,
          recipients: uniqueEmails.length
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        }
      );
    } catch (emailError: unknown) {
      console.error("Failed to send notification emails:", emailError);
      throw new Error('Failed to send notification emails');
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error sending time-off notification:', error);
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
