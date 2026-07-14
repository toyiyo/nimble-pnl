/**
 * Pure builder for the "your shift was removed" notification plan.
 *
 * Deleting a *published* shift is the one reachable, unnotified employee-facing
 * change to a locked shift (see design doc). The row is gone by the time we
 * notify, so callers pass a snapshot rather than re-fetching. This module only
 * builds the email/push payloads — it never sends anything, so it stays
 * vitest-importable (no Deno-only imports).
 */
import { generateEmailTemplate, formatDateTime, type EmailTemplateData } from './emailTemplates.ts';

export interface DeletedShiftNotificationInput {
  shiftId: string; // for push tag (dedupe repeat pushes on-device)
  employeeName: string | null;
  employeeEmail: string | null;
  employeeUserId: string | null;
  restaurantName: string;
  timezone: string;
  position: string;
  startTime: string; // ISO
  endTime: string; // ISO
  appUrl: string;
}

export interface DeletedShiftNotificationPlan {
  email?: { subject: string; html: string; to: string };
  push?: {
    userId: string;
    payload: { title: string; body: string; url: string; tag: string };
  };
  skipped?: 'no-email-and-no-user';
}

const HEADING = 'A Shift Has Been Removed';
const MESSAGE = 'One of your scheduled shifts has been removed from the schedule.';

export function buildDeletedShiftNotification(
  input: DeletedShiftNotificationInput,
): DeletedShiftNotificationPlan {
  const {
    shiftId,
    employeeName,
    employeeEmail,
    employeeUserId,
    restaurantName,
    timezone,
    position,
    startTime,
    endTime,
    appUrl,
  } = input;

  if (!employeeEmail && !employeeUserId) {
    return { skipped: 'no-email-and-no-user' };
  }

  const plan: DeletedShiftNotificationPlan = {};

  if (employeeEmail) {
    const emailData: EmailTemplateData = {
      heading: HEADING,
      statusBadge: { text: 'Removed', color: '#ef4444' },
      greeting: `Hi ${employeeName || 'there'},`,
      message: MESSAGE,
      detailsCard: {
        items: [
          { label: 'Restaurant', value: restaurantName },
          { label: 'Position', value: position },
          { label: 'Start', value: formatDateTime(startTime, timezone) },
          { label: 'End', value: formatDateTime(endTime, timezone) },
        ],
      },
      ctaButton: {
        text: 'View My Schedule',
        url: `${appUrl}/employee/schedule`,
      },
      footerNote: 'If you have any questions about your schedule, please contact your manager.',
    };

    plan.email = {
      subject: `Shift Removed - ${restaurantName}`,
      html: generateEmailTemplate(emailData),
      to: employeeEmail,
    };
  }

  if (employeeUserId) {
    plan.push = {
      userId: employeeUserId,
      payload: {
        title: 'Shift Removed',
        body: MESSAGE,
        url: '/employee/schedule',
        tag: `shift-deleted-${shiftId}`,
      },
    };
  }

  return plan;
}
