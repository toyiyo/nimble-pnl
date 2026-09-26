// Push and email content for the shift-trade reminders.
//
// The text is written like a teammate who asks for help. All dates and
// times use the restaurant time zone. `{when}` comes from the real time
// left, so a stage that quiet hours delay still tells the truth.
//
// No Deno imports: the unit tests run this file in Node.

import { tentativePushBody, TENTATIVE_NOTE } from './draftTradeNote.ts';
import { generateEmailTemplate } from './emailTemplates.ts';
import { plural } from './plural.ts';
import { safeTz } from './timezone.ts';
import { tradeLinkHref } from './tradeDeepLinkUrl.ts';

export type EmployeeReminderStage = '72h' | '24h' | '6h';

export interface ReminderShiftInfo {
  tradeId: string;
  restaurantId: string;
  restaurantName: string | null;
  restaurantTimezone: string | null;
  startTime: string;
  endTime: string;
  position: string | null;
  isPublished: boolean | null;
  posterName: string | null;
}

export interface ReminderPush {
  title: string;
  body: string;
  url: string;
  tag: string;
}

export interface ReminderEmail {
  subject: string;
  html: string;
}

const MS_PER_MINUTE = 60_000;

export const SCHEDULER_REMINDER_PATH = '/scheduling';
export const POSTER_REMINDER_PATH = '/employee/schedule';

/** The first word of the poster name, or "A teammate". */
export function firstName(name: string | null | undefined): string {
  const first = (name ?? '').trim().split(/\s+/)[0];
  return first ? first : 'A teammate';
}

/** Restaurant-local calendar day as a UTC-midnight epoch value. */
function localDayValue(date: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return Date.UTC(get('year'), get('month') - 1, get('day'));
}

/** "today", "tomorrow" or the weekday name, in the restaurant time zone. */
export function reminderDay(start: Date, now: Date, tz: string | null): string {
  const zone = safeTz(tz);
  const diffDays = Math.round((localDayValue(start, zone) - localDayValue(now, zone)) / 86_400_000);
  if (diffDays === 0) return 'today';
  if (diffDays === 1) return 'tomorrow';
  return new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: 'long' }).format(start);
}

/**
 * "in 5 hours" or "in 45 minutes", from the real time left, rounded down.
 * The minimum is 1 minute, because "in 0 minutes" reads as a bug.
 */
export function reminderWhen(start: Date, now: Date): string {
  const minutes = Math.max(1, Math.floor((start.getTime() - now.getTime()) / MS_PER_MINUTE));
  if (minutes < 60) return `in ${plural(minutes, 'minute')}`;
  return `in ${plural(Math.floor(minutes / 60), 'hour')}`;
}

function clockParts(date: Date, tz: string): { text: string; period: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).formatToParts(date);
  const hour = parts.find((p) => p.type === 'hour')?.value ?? '';
  const minute = parts.find((p) => p.type === 'minute')?.value ?? '00';
  const period = (parts.find((p) => p.type === 'dayPeriod')?.value ?? '').toUpperCase();
  return { text: minute === '00' ? hour : `${hour}:${minute}`, period };
}

/** "5–11 PM" or "10:30 AM–4 PM", in the restaurant time zone. */
export function formatTimeRange(start: Date, end: Date, tz: string | null): string {
  const zone = safeTz(tz);
  const a = clockParts(start, zone);
  const b = clockParts(end, zone);
  if (a.period === b.period) return `${a.text}–${b.text} ${b.period}`;
  return `${a.text} ${a.period}–${b.text} ${b.period}`;
}

function shortWeekday(date: Date, tz: string | null): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: safeTz(tz), weekday: 'short' }).format(date);
}

function positionLabel(info: ReminderShiftInfo): string {
  return info.position?.trim() || 'Shift';
}

function shiftSummary(info: ReminderShiftInfo): string {
  const start = new Date(info.startTime);
  const end = new Date(info.endTime);
  return `${positionLabel(info)}, ${shortWeekday(start, info.restaurantTimezone)} ${formatTimeRange(start, end, info.restaurantTimezone)}`;
}

// Separate tags: an unclaimed push must not replace an employee reminder
// on a device that gets both.
function employeeTag(info: ReminderShiftInfo): string {
  return `trade-reminder-${info.tradeId}`;
}

function unclaimedTag(info: ReminderShiftInfo): string {
  return `trade-unclaimed-${info.tradeId}`;
}

/** Push for an eligible employee (the 72h, 24h and 6h stages). */
export function buildEmployeeReminderPush(
  info: ReminderShiftInfo,
  stage: EmployeeReminderStage,
  now: Date,
): ReminderPush {
  const start = new Date(info.startTime);
  const name = firstName(info.posterName);
  const title =
    stage === '6h'
      ? `${name}'s shift starts ${reminderWhen(start, now)}`
      : `${name} needs cover ${reminderDay(start, now, info.restaurantTimezone)}`;
  const body = tentativePushBody(
    `${shiftSummary(info)}. You're free then. Tap to take the shift.`,
    info.isPublished,
  );
  return {
    title,
    body,
    url: tradeLinkHref(info.tradeId, info.restaurantId, 'reminder'),
    tag: employeeTag(info),
  };
}

function schedulerTitle(info: ReminderShiftInfo): string {
  return `Nobody took ${firstName(info.posterName)}'s shift yet`;
}

/** Push for a scheduler (the unclaimed stage). */
export function buildSchedulerUnclaimedPush(info: ReminderShiftInfo): ReminderPush {
  return {
    title: schedulerTitle(info),
    body: tentativePushBody(`${shiftSummary(info)}, still open. Tap to assign it.`, info.isPublished),
    url: SCHEDULER_REMINDER_PATH,
    tag: unclaimedTag(info),
  };
}

/** Push for the poster (the unclaimed stage). */
export function buildPosterUnclaimedPush(info: ReminderShiftInfo): ReminderPush {
  return {
    title: 'Your shift is still up for trade',
    body: tentativePushBody(
      'Nobody took it yet. You still work it unless a manager changes it.',
      info.isPublished,
    ),
    url: POSTER_REMINDER_PATH,
    tag: unclaimedTag(info),
  };
}

/**
 * Email for a scheduler (the unclaimed stage). generateEmailTemplate
 * escapes every text value, so names cannot inject HTML.
 */
export function buildSchedulerUnclaimedEmail(
  info: ReminderShiftInfo,
  now: Date,
  appUrl: string,
): ReminderEmail {
  const start = new Date(info.startTime);
  const end = new Date(info.endTime);
  const tz = info.restaurantTimezone;
  const subject = schedulerTitle(info);
  const posterName = info.posterName?.trim() || 'A teammate';
  const dayText = new Intl.DateTimeFormat('en-US', {
    timeZone: safeTz(tz),
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(start);

  const html = generateEmailTemplate({
    heading: subject,
    statusBadge: { text: 'Still open', color: '#f59e0b' },
    message:
      `${posterName} posted this shift for trade, and nobody took it yet. ` +
      `The shift starts ${reminderWhen(start, now)}. Assign it on the schedule.`,
    detailsCard: {
      items: [
        { label: 'Restaurant', value: info.restaurantName?.trim() || 'Your restaurant' },
        { label: 'Position', value: positionLabel(info) },
        { label: 'When', value: `${dayText}, ${formatTimeRange(start, end, tz)}` },
        { label: 'Posted by', value: posterName },
      ],
    },
    ctaButton: { text: 'Open the schedule', url: `${appUrl}${SCHEDULER_REMINDER_PATH}` },
    ...(info.isPublished === false ? { footerNote: TENTATIVE_NOTE } : {}),
  });

  return { subject, html };
}
