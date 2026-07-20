// Pure recipient/content logic for notify-open-shift-claim, extracted so it is
// unit-testable without a Deno runtime (mirrors _shared/tradeEmailAudience.ts).
// IMPORTANT: this helper takes pre-split LOCAL date/time strings — never a
// timestamptz. The claim's shift_date (DATE) + template start/end (TIME) are
// already restaurant-local wall-clock; do not round-trip them through
// ::timestamptz + formatDateTime (that reintroduces the documented off-by-one).

import { escapeHtml } from './emailTemplates.ts';

export type ClaimAction = 'approved' | 'rejected';

export interface ClaimNotifyInput {
  action: ClaimAction;
  employeeName: string;
  templateName: string;
  position: string;
  shiftDateLocal: string; // already formatted local date, e.g. "Saturday, July 25, 2026"
  startTime: string;      // "09:00"
  endTime: string;        // "17:00"
  restaurantName: string;
  reviewerNote: string | null;
}

export interface ClaimNotificationContent {
  subject: string;
  heading: string;
  pushBody: string;
  emailHtml: string;
}

export function buildClaimNotificationContent(
  input: ClaimNotifyInput,
): ClaimNotificationContent {
  const approved = input.action === 'approved';
  const statusText = approved ? 'Approved' : 'Rejected';
  const statusColor = approved ? '#10b981' : '#ef4444';

  const name = escapeHtml(input.employeeName);
  const template = escapeHtml(input.templateName);
  const position = escapeHtml(input.position);
  const dateLocal = escapeHtml(input.shiftDateLocal);
  const start = escapeHtml(input.startTime);
  const end = escapeHtml(input.endTime);
  const restaurant = escapeHtml(input.restaurantName);
  const note = input.reviewerNote ? escapeHtml(input.reviewerNote) : null;

  const subject = approved
    ? 'Your Shift Claim Was Approved'
    : 'Your Shift Claim Was Rejected';
  const heading = approved
    ? 'Your Shift Claim Has Been Approved'
    : 'Your Shift Claim Has Been Rejected';
  const message = approved
    ? `Your claim for ${template} has been approved. The shift has been added to your schedule.`
    : `Your claim for ${template} has been rejected.`;
  const pushBody = approved
    ? `Your claim for ${input.templateName} was approved. Check your schedule.`
    : `Your claim for ${input.templateName} was rejected.`;

  const appUrl = 'https://app.easyshifthq.com/employee/shifts';

  const emailHtml = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;background-color:#f3f4f6;">
  <div style="max-width:600px;margin:0 auto;background-color:#ffffff;">
    <div style="padding:40px 32px;">
      <h1 style="color:#1f2937;font-size:24px;font-weight:600;margin:0 0 16px 0;">${escapeHtml(heading)}</h1>
      <div style="margin-bottom:24px;"><span style="background-color:${statusColor};color:#fff;padding:6px 14px;border-radius:6px;font-size:14px;font-weight:600;">${statusText}</span></div>
      <p style="color:#4b5563;line-height:1.6;font-size:16px;margin:0 0 24px 0;">Hi <strong style="color:#1f2937;">${name}</strong>,</p>
      <p style="color:#4b5563;line-height:1.6;font-size:16px;margin:0 0 24px 0;">${message}</p>
      <div style="background:linear-gradient(135deg,#f0fdf4 0%,#dcfce7 100%);padding:24px;border-radius:12px;margin:24px 0;border-left:4px solid ${statusColor};">
        <table style="width:100%;border-collapse:collapse;">
          <tr><td style="padding:6px 0;color:#4b5563;font-size:14px;font-weight:600;">Restaurant:</td><td style="padding:6px 0;color:#1f2937;font-size:14px;text-align:right;">${restaurant}</td></tr>
          <tr><td style="padding:6px 0;color:#4b5563;font-size:14px;font-weight:600;">Shift:</td><td style="padding:6px 0;color:#1f2937;font-size:14px;text-align:right;">${template}</td></tr>
          <tr><td style="padding:6px 0;color:#4b5563;font-size:14px;font-weight:600;">Position:</td><td style="padding:6px 0;color:#1f2937;font-size:14px;text-align:right;">${position}</td></tr>
          <tr><td style="padding:6px 0;color:#4b5563;font-size:14px;font-weight:600;">Date:</td><td style="padding:6px 0;color:#1f2937;font-size:14px;text-align:right;">${dateLocal}</td></tr>
          <tr><td style="padding:6px 0;color:#4b5563;font-size:14px;font-weight:600;">Time:</td><td style="padding:6px 0;color:#1f2937;font-size:14px;text-align:right;">${start} – ${end}</td></tr>
        </table>
      </div>
      ${note ? `<div style="background-color:#fef3c7;border-left:4px solid #f59e0b;border-radius:4px;padding:16px;margin:24px 0;"><p style="margin:0 0 8px;color:#92400e;font-size:14px;font-weight:600;">Manager Note:</p><p style="margin:0;color:#78350f;font-size:14px;line-height:1.5;">${note}</p></div>` : ''}
      <div style="text-align:center;margin:32px 0;"><a href="${appUrl}" style="background:linear-gradient(135deg,#3b82f6 0%,#2563eb 100%);color:#ffffff !important;padding:14px 32px;text-decoration:none;border-radius:8px;display:inline-block;font-weight:600;font-size:16px;border:2px solid #2563eb;"><span style="color:#ffffff !important;">View My Shifts</span></a></div>
      <p style="color:#6b7280;font-size:14px;margin:32px 0 0 0;line-height:1.6;">If you have any questions, please contact your manager.</p>
    </div>
    <div style="background-color:#f9fafb;padding:24px 32px;border-top:1px solid #e5e7eb;">
      <p style="color:#6b7280;font-size:13px;text-align:center;margin:0;line-height:1.5;"><strong style="color:#4b5563;">EasyShiftHQ</strong><br>Restaurant Operations Management System</p>
      <p style="color:#9ca3af;font-size:12px;text-align:center;margin:8px 0 0 0;">This is an automated notification. Please do not reply to this email.</p>
    </div>
  </div>
</body>
</html>`;

  return { subject, heading, pushBody, emailHtml };
}
