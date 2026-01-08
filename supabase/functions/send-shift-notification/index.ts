import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { Resend } from "https://esm.sh/resend@4.0.0";
import { 
  generateEmailTemplate,
  formatDateTime,
  type EmailTemplateData 
} from "../_shared/emailTemplates.ts";
import {
  corsHeaders,
  handleCorsPreflightRequest,
  errorResponse,
  successResponse,
  getRestaurantName,
  shouldSendNotification,
  NOTIFICATION_FROM,
  APP_URL
} from "../_shared/notificationHelpers.ts";

interface RequestBody {
  shiftId: string;
  action: 'created' | 'modified' | 'deleted';
  previousShift?: {
    start_time: string;
    end_time: string;
    position: string;
  };
}

const ACTION_CONFIG: Record<RequestBody['action'], {
  subject: (restaurantName: string) => string;
  heading: string;
  statusColor: string;
  statusText: string;
  settingKey: string;
  message: (hasChanges: boolean) => string;
}> = {
  created: {
    subject: (restaurantName) => `New Shift Assigned - ${restaurantName}`,
    heading: 'You Have a New Shift',
    statusColor: '#3b82f6',
    statusText: 'New',
    settingKey: 'notify_shift_created',
    message: () => 'A new shift has been added to your schedule.',
  },
  modified: {
    subject: (restaurantName) => `Shift Updated - ${restaurantName}`,
    heading: 'Your Shift Has Been Updated',
    statusColor: '#f59e0b',
    statusText: 'Modified',
    settingKey: 'notify_shift_modified',
    message: (hasChanges) => hasChanges 
      ? 'Your shift details have been changed. Please review the updated information below.'
      : 'Your shift has been updated.',
  },
  deleted: {
    subject: (restaurantName) => `Shift Removed - ${restaurantName}`,
    heading: 'A Shift Has Been Removed',
    statusColor: '#ef4444',
    statusText: 'Removed',
    settingKey: 'notify_shift_deleted',
    message: () => 'One of your scheduled shifts has been removed from the schedule.',
  },
};

const handler = async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return handleCorsPreflightRequest();
  }

  try {
    // Initialize Resend
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    if (!resendApiKey) {
      return errorResponse('Email service not configured', 500);
    }
    const resend = new Resend(resendApiKey);

    // Authenticate request - this should be called from authenticated contexts only
    // (e.g., database triggers, authenticated API calls, or with internal secret)
    const authHeader = req.headers.get('Authorization');
    
    // For this notification, we expect either:
    // 1. A valid user authentication header (for manual triggers)
    // 2. Or it should be called from a secure server-side context
    const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
    
    // Use service role for database access (when called from triggers)
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    
    if (!supabaseUrl || !supabaseServiceKey) {
      return errorResponse('Database configuration error', 500);
    }
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    // If there's an auth header, verify it's valid
    if (authHeader) {
      const { data: { user }, error: authError } = await supabase.auth.getUser(
        authHeader.replace('Bearer ', '')
      );
      
      if (authError || !user) {
        return errorResponse('Unauthorized', 401);
      }
      
      console.log(`Authenticated request from user: ${user.id}`);
    }

    // Parse request body
    const { shiftId, action, previousShift }: RequestBody = await req.json();
    if (!shiftId || !action) {
      return errorResponse('Missing required fields: shiftId, action', 400);
    }

    console.log(`Processing shift notification: shiftId=${shiftId}, action=${action}`);

    // Get shift details
    const { data: shift, error: shiftError } = await supabase
      .from('shifts')
      .select(`
        *,
        employee:employees!employee_id(
          id,
          name,
          email
        )
      `)
      .eq('id', shiftId)
      .single();

    if (shiftError || !shift) {
      // For deleted shifts, we might not have the shift anymore
      if (action === 'deleted') {
        console.log('Shift already deleted, cannot send notification');
        return successResponse({ message: 'Shift deleted, notification skipped' });
      }
      return errorResponse('Shift not found', 404);
    }

    // Check notification settings
    const config = ACTION_CONFIG[action];
    const shouldNotify = await shouldSendNotification(
      supabase, 
      shift.restaurant_id, 
      config.settingKey
    );

    if (!shouldNotify) {
      console.log(`Notification disabled for ${action}`);
      return successResponse({ message: 'Notification disabled by settings' });
    }

    // Get employee email
    const employeeEmail = shift.employee?.email;
    if (!employeeEmail) {
      console.log('Employee has no email address');
      return successResponse({ message: 'No employee email found' });
    }

    // Get restaurant name
    const restaurantName = await getRestaurantName(supabase, shift.restaurant_id);

    // Build details card
    const detailsItems = [
      { label: 'Restaurant', value: restaurantName },
      { label: 'Position', value: shift.position },
      { label: 'Start', value: formatDateTime(shift.start_time) },
      { label: 'End', value: formatDateTime(shift.end_time) },
    ];

    // Add previous details if modified
    const hasChanges = action === 'modified' && previousShift;
    if (hasChanges) {
      detailsItems.push(
        { label: '', value: '--- Previous ---' },
        { label: 'Previous Position', value: previousShift!.position },
        { label: 'Previous Start', value: formatDateTime(previousShift!.start_time) },
        { label: 'Previous End', value: formatDateTime(previousShift!.end_time) },
      );
    }

    // Generate email template
    const emailData: EmailTemplateData = {
      heading: config.heading,
      statusBadge: {
        text: config.statusText,
        color: config.statusColor,
      },
      greeting: `Hi ${shift.employee?.name || 'there'},`,
      message: config.message(hasChanges),
      detailsCard: {
        items: detailsItems,
      },
      ctaButton: {
        text: 'View My Schedule',
        url: `${APP_URL}/employee/schedule`,
      },
      footerNote: 'If you have any questions about your schedule, please contact your manager.',
    };

    const html = generateEmailTemplate(emailData);
    const subject = config.subject(restaurantName);

    // Send email
    const { data: emailResult, error: emailError } = await resend.emails.send({
      from: NOTIFICATION_FROM,
      to: [employeeEmail],
      subject,
      html,
    });

    if (emailError) {
      console.error('Error sending email:', emailError);
      return errorResponse('Failed to send email', 500);
    }

    console.log(`Successfully sent shift notification: emailId=${emailResult?.id}`);

    return successResponse({ 
      message: 'Notification sent',
      emailId: emailResult?.id,
    });

  } catch (error) {
    console.error('Unexpected error:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return errorResponse(message, 500);
  }
};

serve(handler);
