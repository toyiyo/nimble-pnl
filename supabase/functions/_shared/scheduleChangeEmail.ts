/**
 * The schedule notification email. Pure, so Vitest covers it.
 *
 * The body lists the employee's own changes, one line per shift.
 * Design: docs/superpowers/specs/2026-11-28-mcp-publish-notifications-design.md
 *
 * The subject and the body depend only on the notification row (its change
 * lines), the employee, and the restaurant. A retry of the row then sends the
 * same body under the same Idempotency-Key, which the provider accepts.
 */
import { escapeHtml, generateHeader } from './emailTemplates.ts';
import type { ChangeLine } from './scheduleNotificationDelivery.ts';

export interface ScheduleEmailInput {
  employeeName: string;
  restaurantName: string;
  lines: ChangeLine[];
  appUrl: string;
}

export interface ScheduleEmail {
  subject: string;
  html: string;
}

/** Only new shifts: a first announcement. Anything else: an update. */
const isNewScheduleOnly = (lines: ChangeLine[]): boolean => lines.every((l) => l.kind === 'added');

export function buildScheduleChangeEmail(input: ScheduleEmailInput): ScheduleEmail {
  const hasUpdates = !isNewScheduleOnly(input.lines);
  return {
    subject: hasUpdates
      ? `Schedule changes at ${input.restaurantName}`
      : `New schedule published at ${input.restaurantName}`,
    html: buildScheduleEmailHtml({ ...input, hasUpdates }),
  };
}

function buildScheduleEmailHtml(input: ScheduleEmailInput & { hasUpdates: boolean }): string {
  const { employeeName, restaurantName, hasUpdates, appUrl } = input;
  const lines = input.lines.map((l) => l.text);
  const p = 'color: #4b5563; line-height: 1.6; font-size: 16px; margin: 0 0 24px 0;';
  const changeList = lines.length
    ? `<ul style="color: #1f2937; font-size: 15px; line-height: 1.7; margin: 0 0 24px 0; padding-left: 20px;">${lines
        .map((line) => `<li>${escapeHtml(line)}</li>`)
        .join('')}</ul>`
    : '';

  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #ffffff;">
      ${generateHeader()}
      <div style="padding: 40px 32px; background-color: #ffffff;">
        <h1 style="color: #1f2937; font-size: 24px; font-weight: 600; margin: 0 0 16px 0; line-height: 1.3;">${hasUpdates ? 'Updated Schedule' : 'New Schedule Published'}</h1>
        <p style="${p}">Hi <strong style="color: #1f2937;">${escapeHtml(employeeName)}</strong>,</p>
        <p style="${p}">Your schedule at <strong style="color: #1f2937;">${escapeHtml(restaurantName)}</strong> ${hasUpdates ? 'has changes' : 'is published'}:</p>
        ${changeList}
        <div style="text-align: center; margin: 32px 0;">
          <a href="${appUrl}" style="background-color: #059669; color: #ffffff !important; padding: 14px 32px; text-decoration: none; border-radius: 8px; display: inline-block; font-weight: 600; font-size: 16px; border: 2px solid #059669;">
            <span style="color: #ffffff !important;">View My Schedule</span>
          </a>
        </div>
        <p style="color: #6b7280; font-size: 14px; margin: 32px 0 0 0; line-height: 1.6;">
          If you have any questions or concerns about your schedule, please contact your manager.
        </p>
      </div>
      <div style="background-color: #f9fafb; padding: 24px 32px; border-radius: 0 0 8px 8px; border-top: 1px solid #e5e7eb;">
        <p style="color: #6b7280; font-size: 13px; text-align: center; margin: 0; line-height: 1.5;">
          <strong style="color: #4b5563;">EasyShiftHQ</strong><br>Restaurant Operations Management System
        </p>
        <p style="color: #9ca3af; font-size: 12px; text-align: center; margin: 8px 0 0 0;">
          This is an automated notification. Please do not reply to this email.
        </p>
      </div>
    </div>
  `;
}
