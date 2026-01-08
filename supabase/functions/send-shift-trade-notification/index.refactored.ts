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
  authenticateRequest,
  errorResponse,
  successResponse,
  getRestaurantName,
  getAllActiveEmployeeEmails,
  getManagerEmails,
  NOTIFICATION_FROM,
  APP_URL
} from "../_shared/notificationHelpers.ts";

interface RequestBody {
  tradeId: string;
  action: 'created' | 'accepted' | 'approved' | 'rejected' | 'cancelled';
}

const ACTION_CONFIG: Record<RequestBody['action'], {
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
    message: (employeeName, shiftDetails) => 
      `${employeeName ?? 'An employee'} has posted a shift available for trade${shiftDetails ? `: ${shiftDetails}` : ''}.`,
  },
  accepted: {
    subject: () => 'Shift Trade Request Pending Approval',
    heading: 'Shift Trade Pending Approval',
    statusColor: '#f59e0b',
    statusText: 'Pending Approval',
    message: (employeeName, shiftDetails) => 
      `${employeeName ?? 'An employee'} has accepted a shift trade request${shiftDetails ? ` for ${shiftDetails}` : ''}. Manager approval required.`,
  },
  approved: {
    subject: () => 'Shift Trade Approved',
    heading: 'Your Shift Trade Has Been Approved',
    statusColor: '#10b981',
    statusText: 'Approved',
    message: (_, shiftDetails) => 
      `Your shift trade has been approved by management. ${shiftDetails ? `The shift (${shiftDetails}) has been reassigned.` : 'The shift has been reassigned.'}`,
  },
  rejected: {
    subject: () => 'Shift Trade Rejected',
    heading: 'Shift Trade Request Rejected',
    statusColor: '#ef4444',
    statusText: 'Rejected',
    message: (_, shiftDetails) => 
      `A shift trade request has been rejected by management${shiftDetails ? ` for ${shiftDetails}` : ''}.`,
  },
  cancelled: {
    subject: () => 'Shift Trade Cancelled',
    heading: 'Shift Trade Has Been Cancelled',
    statusColor: '#6b7280',
    statusText: 'Cancelled',
    message: (employeeName, shiftDetails) => 
      `${employeeName ?? 'The employee'} has cancelled their shift trade request${shiftDetails ? ` for ${shiftDetails}` : ''}.`,
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

    // Authenticate request
    const { user, supabase } = await authenticateRequest(req);

    // Parse request body
    const { tradeId, action }: RequestBody = await req.json();
    if (!tradeId || !action) {
      return errorResponse('Missing required fields: tradeId, action', 400);
    }

    console.log(`Processing shift trade notification: tradeId=${tradeId}, action=${action}`);

    // Fetch trade details
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
        )
      `)
      .eq('id', tradeId)
      .single();

    if (tradeError || !trade) {
      return errorResponse('Trade not found', 404);
    }

    // Get restaurant name
    const restaurantName = await getRestaurantName(supabase, trade.restaurant_id);

    // Determine recipients based on action
    let recipients: string[] = [];
    if (action === 'created') {
      recipients = await getAllActiveEmployeeEmails(supabase, trade.restaurant_id);
    } else if (action === 'accepted') {
      recipients = await getManagerEmails(supabase, trade.restaurant_id);
      if (trade.offered_by?.email) recipients.push(trade.offered_by.email);
    } else if (action === 'approved' || action === 'rejected') {
      if (trade.offered_by?.email) recipients.push(trade.offered_by.email);
      if (trade.accepted_by?.email) recipients.push(trade.accepted_by.email);
    } else if (action === 'cancelled') {
      if (trade.accepted_by?.email) recipients.push(trade.accepted_by.email);
    }

    recipients = [...new Set(recipients)]; // Remove duplicates

    if (recipients.length === 0) {
      return successResponse({ message: 'No recipients to notify' });
    }

    // Build shift details
    const shift = trade.offered_shift;
    const shiftDetailsItems = shift ? [
      { label: 'Restaurant', value: restaurantName },
      { label: 'Position', value: shift.position },
      { label: 'Start', value: formatDateTime(shift.start_time) },
      { label: 'End', value: formatDateTime(shift.end_time) },
    ] : [
      { label: 'Restaurant', value: restaurantName }
    ];

    // Get appropriate content for action
    const config = ACTION_CONFIG[action];
    const employeeName = action === 'accepted' 
      ? trade.accepted_by?.name || 'Employee'
      : trade.offered_by?.name || 'Employee';

    // Generate email template
    const emailData: EmailTemplateData = {
      heading: config.heading,
      statusBadge: {
        text: config.statusText,
        color: config.statusColor,
      },
      message: config.message(
        employeeName,
        shift ? shift.position : undefined
      ),
      detailsCard: {
        items: shiftDetailsItems,
      },
      managerNote: trade.manager_note || undefined,
      ctaButton: {
        text: 'View Available Trades',
        url: `${APP_URL}/employee/shifts`,
      },
      footerNote: 'If you have any questions about shift trades, please contact your manager.',
    };

    const html = generateEmailTemplate(emailData);
    const subject = config.subject(employeeName);

    // Send email
    const { data: emailData, error: emailError } = await resend.emails.send({
      from: NOTIFICATION_FROM,
      to: recipients,
      subject,
      html,
    });

    if (emailError) {
      console.error('Error sending email:', emailError);
      return errorResponse('Failed to send email', 500);
    }

    console.log(`Successfully sent shift trade notification: emailId=${emailData?.id}`);

    return successResponse({ 
      message: `Sent to ${recipients.length} recipient(s)`,
      emailId: emailData?.id,
      recipients: recipients.length 
    });

  } catch (error) {
    console.error('Unexpected error:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return errorResponse(message, 500);
  }
};

serve(handler);
