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
  shouldSendNotification,
  NOTIFICATION_FROM,
  APP_URL
} from "../_shared/notificationHelpers.ts";
import { getRestaurantInfo } from "../_shared/restaurantInfo.ts";
import { sendWebPushToUser } from '../_shared/webPushHelper.ts';
import { buildDeletedShiftNotification } from '../_shared/shiftDeletedNotification.ts';

interface RequestBody {
  shiftId: string;
  action: 'created' | 'modified' | 'deleted';
  previousShift?: {
    start_time: string;
    end_time: string;
    position: string;
  };
  // Snapshot for a published-shift delete: the row is already gone by the
  // time this fires, so the client sends what it had. Only display fields
  // (position/start/end) travel from the client — identity (email/user_id)
  // is always looked up server-side below, never trusted from the caller.
  deletedShift?: {
    restaurant_id: string;
    employee_id: string;
    position: string;
    start_time: string;
    end_time: string;
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
    message: (hasChanges: boolean) => hasChanges 
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
    
    // Require a valid user JWT for EVERY action. This function is only ever
    // invoked from authenticated client contexts (fire-and-forget with the
    // caller's own JWT), so a missing/invalid header is rejected up front —
    // closing the gap where the created/modified/deleted-by-refetch path below
    // would otherwise proceed unauthenticated via the service-role client.
    if (!authHeader) {
      return errorResponse('Unauthorized', 401);
    }
    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    );
    if (authError || !user) {
      return errorResponse('Unauthorized', 401);
    }
    const authenticatedUser: { id: string } = user;
    console.log(`Authenticated request from user: ${user.id}`);

    // Parse request body
    const { shiftId, action, previousShift, deletedShift }: RequestBody = await req.json();
    if (!shiftId || !action) {
      return errorResponse('Missing required fields: shiftId, action', 400);
    }

    console.log(`Processing shift notification: shiftId=${shiftId}, action=${action}`);

    // Published-shift delete: the row is gone, so the caller sends a
    // snapshot instead of an id we could re-fetch. This branch is fully
    // separate from the created/modified/deleted-by-refetch flow below.
    if (action === 'deleted' && deletedShift) {
      // A valid JWT is guaranteed (mandatory auth above) — additionally require
      // the caller to be an owner/manager of the snapshot's restaurant, mirroring
      // notify-schedule-published. Without this, any authenticated user could
      // trigger a "shift removed" notification for someone else's restaurant.
      const { data: callerRestaurant, error: callerRoleError } = await supabase
        .from('user_restaurants')
        .select('role')
        .eq('user_id', authenticatedUser.id)
        .eq('restaurant_id', deletedShift.restaurant_id)
        .single();

      if (callerRoleError || !callerRestaurant || !['owner', 'manager'].includes(callerRestaurant.role)) {
        return errorResponse('Access denied', 403);
      }

      const shouldNotifyDeleted = await shouldSendNotification(
        supabase,
        deletedShift.restaurant_id,
        'notify_shift_deleted'
      );
      if (!shouldNotifyDeleted) {
        console.log('Notification disabled for deleted');
        return successResponse({ message: 'Notification disabled by settings' });
      }

      // Authoritative employee lookup — never trust client-supplied
      // email/user_id. Missing/mismatched employee => skip, not an error
      // (the delete already succeeded on the client side). Independent of
      // the restaurant info lookup, so run both concurrently.
      const [
        { data: deletedShiftEmployee, error: deletedShiftEmployeeError },
        { name: deletedShiftRestaurantName, timezone: deletedShiftRestaurantTimezone },
      ] = await Promise.all([
        supabase
          .from('employees')
          .select('id, name, email, user_id')
          .eq('id', deletedShift.employee_id)
          .eq('restaurant_id', deletedShift.restaurant_id)
          .single(),
        getRestaurantInfo(supabase, deletedShift.restaurant_id),
      ]);

      if (deletedShiftEmployeeError || !deletedShiftEmployee) {
        console.log('Employee not found for deleted shift notification');
        return successResponse({ message: 'Employee not found, notification skipped' });
      }

      const plan = buildDeletedShiftNotification({
        shiftId,
        employeeName: deletedShiftEmployee.name ?? null,
        employeeEmail: deletedShiftEmployee.email ?? null,
        employeeUserId: deletedShiftEmployee.user_id ?? null,
        restaurantName: deletedShiftRestaurantName,
        timezone: deletedShiftRestaurantTimezone,
        position: deletedShift.position,
        startTime: deletedShift.start_time,
        endTime: deletedShift.end_time,
        appUrl: APP_URL,
      });

      if (plan.skipped) {
        console.log(`Deleted-shift notification skipped: ${plan.skipped}`);
        return successResponse({ message: plan.skipped });
      }

      let deletedShiftEmailId: string | undefined;
      if (plan.email) {
        const { data: emailResult, error: emailError } = await resend.emails.send({
          from: NOTIFICATION_FROM,
          to: [plan.email.to],
          subject: plan.email.subject,
          html: plan.email.html,
        });

        if (emailError) {
          console.error('Error sending deleted-shift email:', emailError);
        } else {
          deletedShiftEmailId = emailResult?.id;
        }
      }

      if (plan.push) {
        try {
          await sendWebPushToUser(supabase, plan.push.userId, deletedShift.restaurant_id, plan.push.payload);
        } catch (e) {
          console.error('Web push failed:', e);
        }
      }

      console.log(`Successfully sent deleted-shift notification: emailId=${deletedShiftEmailId}`);
      return successResponse({
        message: 'Notification sent',
        emailId: deletedShiftEmailId,
      });
    }

    // Get shift details
    const { data: shift, error: shiftError } = await supabase
      .from('shifts')
      .select(`
        *,
        employee:employees!employee_id(
          id,
          name,
          email,
          user_id
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

    // Get restaurant name + timezone so shift times render in the
    // restaurant's local time, not the edge runtime's UTC.
    const { name: restaurantName, timezone: restaurantTimezone } =
      await getRestaurantInfo(supabase, shift.restaurant_id);

    // Build details card
    const detailsItems = [
      { label: 'Restaurant', value: restaurantName },
      { label: 'Position', value: shift.position },
      { label: 'Start', value: formatDateTime(shift.start_time, restaurantTimezone) },
      { label: 'End', value: formatDateTime(shift.end_time, restaurantTimezone) },
    ];

    // Add previous details if modified
    const hasChanges = action === 'modified' && previousShift;
    if (hasChanges) {
      detailsItems.push(
        { label: '', value: '--- Previous ---' },
        { label: 'Previous Position', value: previousShift!.position },
        { label: 'Previous Start', value: formatDateTime(previousShift!.start_time, restaurantTimezone) },
        { label: 'Previous End', value: formatDateTime(previousShift!.end_time, restaurantTimezone) },
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
      message: config.message(!!hasChanges),
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

    // Send web push notification to the employee
    if (shift.employee?.user_id) {
      try {
        await sendWebPushToUser(supabase, shift.employee.user_id, shift.restaurant_id, {
          title: config.heading,
          body: config.message(!!hasChanges),
          url: '/employee/schedule',
          tag: `shift-${action}-${shiftId}`,
        });
      } catch (e) {
        console.error('Web push failed:', e);
      }
    }

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
